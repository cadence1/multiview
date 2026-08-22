import crypto from "node:crypto";
import { env } from "./env.js";
import { listCreators } from "./db.js";

// YouTube's own PubSubHubbub push-notification feature
// (https://developers.google.com/youtube/v3/guides/push_notifications) —
// subscribe to a channel's video feed and Google's hub POSTs a near-instant
// notification whenever it changes, instead of us having to poll for it.
// Google's own docs only name "uploads/retitles/re-describes a video" as
// the guaranteed triggers — going live isn't officially documented as its
// own event, but in practice (this is the same mechanism most "new video"
// Discord/Telegram bots use) a stream going live does fire one too, since a
// livestream is itself a video resource. Treated accordingly: a
// notification here just triggers an immediate real status check via the
// normal adapter (see poller.ts's pollPlatformNow) rather than being
// trusted as "definitely live now" on its own.
const HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";

// Google's hub doesn't document a fixed lease duration; this is comfortably
// inside the ~5-day lease community tooling commonly observes it grant, and
// resubscribeAll() runs well inside that window anyway (see poller.ts) so
// the exact value here mostly just documents the ask, not the outcome —
// the hub can grant something shorter and we just renew more often.
const LEASE_SECONDS = 5 * 24 * 60 * 60;

function topicUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/** Whether both required env vars are set — push is entirely optional. */
export function pushEnabled(): boolean {
  return Boolean(env.youtubePushCallbackUrl && env.youtubePushSecret);
}

async function sendHubRequest(mode: "subscribe" | "unsubscribe", channelId: string): Promise<void> {
  const body = new URLSearchParams({
    "hub.callback": env.youtubePushCallbackUrl,
    "hub.topic": topicUrl(channelId),
    "hub.mode": mode,
    "hub.secret": env.youtubePushSecret,
  });
  if (mode === "subscribe") {
    body.set("hub.lease_seconds", String(LEASE_SECONDS));
  }
  const res = await fetch(HUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`hub returned ${res.status}: ${detail.slice(0, 200)}`);
  }
  // A 2xx here only means "the hub accepted the request for processing" —
  // the hub still separately calls back to hub.callback (GET, with
  // hub.challenge) to actually verify+activate it, asynchronously. There's
  // no synchronous "yes, it's live now" signal in this protocol.
}

/** Subscribes (or renews) push notifications for a batch of channel ids. */
export async function subscribeAll(channelIds: string[]): Promise<void> {
  if (!pushEnabled() || channelIds.length === 0) return;
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < channelIds.length) {
      const channelId = channelIds[i++];
      try {
        await sendHubRequest("subscribe", channelId);
      } catch (err) {
        console.error(`[youtube-push] subscribe failed for ${channelId}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

/** Best-effort — failing to unsubscribe just leaves a stale subscription that expires on its own (see LEASE_SECONDS). */
export async function unsubscribe(channelId: string): Promise<void> {
  if (!pushEnabled()) return;
  try {
    await sendHubRequest("unsubscribe", channelId);
  } catch (err) {
    console.error(`[youtube-push] unsubscribe failed for ${channelId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Verifies a notification's X-Hub-Signature header against the *raw*
 * request body — this is the actual security boundary (see server/index.ts
 * for why IP filtering belongs at the Cloudflare edge instead of here).
 * Per the PubSubHubbub spec, a bad signature should be silently dropped,
 * not answered with an error status (callers still return 2xx either way).
 */
export function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader || !env.youtubePushSecret) return false;
  const eq = signatureHeader.indexOf("=");
  if (eq === -1) return false;
  const algo = signatureHeader.slice(0, eq);
  const sigHex = signatureHeader.slice(eq + 1);
  if (algo !== "sha1" || !/^[0-9a-f]+$/i.test(sigHex)) return false;

  const expected = crypto.createHmac("sha1", env.youtubePushSecret).update(rawBody).digest();
  const actual = Buffer.from(sigHex, "hex");
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard explicitly rather than let a malformed header 500 the request.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily — comfortably inside LEASE_SECONDS

let renewalTimer: NodeJS.Timeout | null = null;

/**
 * Subscribes every currently-tracked YouTube channel now, then re-reads the
 * tracked list and re-subscribes everyone daily — both renews leases before
 * they lapse and self-heals any individual subscribe that silently failed
 * earlier (subscribing is idempotent and cheap, so there's no reason to
 * track per-channel expiry to avoid "unnecessary" re-requests).
 */
export function startPushRenewal(): void {
  if (!pushEnabled()) return;
  const renew = () => {
    const channelIds = listCreators()
      .filter((c) => c.platform === "youtube")
      .map((c) => c.platform_id);
    subscribeAll(channelIds).catch((err) => console.error("[youtube-push] renewal failed:", err));
  };
  renew();
  renewalTimer = setInterval(renew, RENEWAL_INTERVAL_MS);
}

export function stopPushRenewal(): void {
  if (renewalTimer) clearInterval(renewalTimer);
}

export interface PushedVideo {
  channelId: string;
  videoId: string;
}

/**
 * Pulls {channelId, videoId} out of a PubSubHubbub Atom notification body.
 * Regex-based rather than a full XML parser, matching the rest of this
 * codebase's approach to scraped/semi-structured feeds (see youtube.ts) —
 * the feed shape is simple and Google-documented, and this avoids adding a
 * new dependency for it.
 */
export function parseNotification(xml: string): PushedVideo[] {
  const results: PushedVideo[] = [];
  const entryRe = /<entry\b[\s\S]*?<\/entry>/g;
  const channelIdRe = /<yt:channelId>([^<]+)<\/yt:channelId>/;
  const videoIdRe = /<yt:videoId>([^<]+)<\/yt:videoId>/;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const channelId = channelIdRe.exec(m[0])?.[1];
    const videoId = videoIdRe.exec(m[0])?.[1];
    if (channelId && videoId) results.push({ channelId, videoId });
  }
  return results;
}
