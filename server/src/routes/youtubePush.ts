import { Router, raw } from "express";
import { listCreators } from "../db.js";
import { pollPlatformNow } from "../poller.js";
import { verifySignature, parseNotification, pushEnabled } from "../youtubePush.js";

export const youtubePushRouter = Router();

function channelIdFromTopic(topic: string | undefined): string | null {
  if (!topic) return null;
  try {
    return new URL(topic).searchParams.get("channel_id");
  } catch {
    return null;
  }
}

// Google's hub verifies a (un)subscribe request with a GET carrying
// hub.challenge, which must be echoed back verbatim to confirm it — see
// PubSubHubbub Core 0.4 §5.3. Only confirms for a channel we actually
// track, rejecting anything else with a 404 as the spec expects for a
// subscription we don't recognize.
youtubePushRouter.get("/", (req, res) => {
  // Never respond to anything here at all when the feature isn't
  // configured — we'd never have sent a subscribe request in the first
  // place, so there's no legitimate reason a verification handshake for
  // this endpoint should exist.
  if (!pushEnabled()) return res.status(404).end();

  const mode = req.query["hub.mode"];
  const topic = req.query["hub.topic"];
  const challenge = req.query["hub.challenge"];
  const channelId = channelIdFromTopic(typeof topic === "string" ? topic : undefined);

  const tracked = channelId
    ? listCreators().some((c) => c.platform === "youtube" && c.platform_id === channelId)
    : false;

  if (!tracked || typeof challenge !== "string") {
    console.warn(`[youtube-push] rejected verification: mode=${String(mode)} topic=${String(topic)}`);
    return res.status(404).end();
  }
  res.status(200).type("text/plain").send(challenge);
});

// The actual push notification. Body is raw (not JSON — Google sends
// application/atom+xml) specifically so the HMAC in verifySignature is
// computed over the exact bytes the hub signed; re-serializing a parsed
// body would not reliably reproduce them.
youtubePushRouter.post("/", raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = req.header("X-Hub-Signature");

  // Per PubSubHubbub Core 0.4 §8: an invalid signature is silently
  // dropped, not answered with an error status — a 4xx here just teaches
  // an attacker they found the right shape of endpoint.
  if (!verifySignature(rawBody, signature)) {
    console.warn("[youtube-push] dropped notification with invalid/missing signature");
    return res.status(204).end();
  }

  const videos = parseNotification(rawBody.toString("utf-8"));
  const rows = listCreators();
  for (const { channelId, videoId } of videos) {
    const creator = rows.find((c) => c.platform === "youtube" && c.platform_id === channelId);
    if (!creator) continue; // not a channel we track — ignore
    console.log(`[youtube-push] notified for ${creator.display_name} (video ${videoId}) — checking now`);
    pollPlatformNow("youtube", [
      { id: creator.id, platform: "youtube", platformId: creator.platform_id, handle: creator.handle },
    ]).catch(() => {});
  }

  res.status(204).end();
});
