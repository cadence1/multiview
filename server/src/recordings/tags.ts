import { statements } from "../db.js";

// Phase 4: auto-generated tags. Applied once, right when a recording's row
// is first created (both startRecording and downloadVideo already know
// display_name/title/started_at at that point — no need to wait for the
// file to finish) — see recorder.ts's applyAutoTags call sites. Users can
// still remove any of these or add their own afterward; this just seeds
// sensible defaults so a fresh recording isn't tag-empty.

// ASCII [...] plus every CJK bracket-pair style actually used for this same
// "category/tag in a title" convention — confirmed directly against real
// titles/names that were silently going untagged because a plain \[...\]
// regex doesn't match any of these:
//   ［...］ fullwidth (U+FF3B/FF3D)     — looks deceptively close to ASCII
//   【...】 lenticular (U+3010/3011)    — the standard Japanese "tag" bracket
//   「...」 corner (U+300C/300D)        — the most common Japanese quote/marker
//   『...』 white corner (U+300E/300F)  — titles/emphasis
//   〈...〉 angle (U+3008/3009)
//   《...》 double angle (U+300A/300B)  — titles, common in Chinese
//   〔...〕 tortoise shell (U+3014/3015)
//   〖...〗 white lenticular (U+3016/3017)
// Deliberately not (...)／（...） — parentheses are used for asides/
// clarifications in these titles ("(It's been 84 years)"), not the
// category-tag convention, so including them would just add noise. Loosely
// paired (any opener with any closer) rather than enforcing matching
// styles — simpler, and a mismatched pair is rare enough not to matter.
const BRACKET_TAG_RE = /[\[［【「『〈《〔〖]([^\]］】」』〉》〕〗]+)[\]］】」』〉》〕〗]/g;

/** Every bracketed segment in a string, trimmed, e.g. "Stream [ASMR]
 * 【Highlights】" -> ["ASMR", "Highlights"]. Covers both a video's title
 * (bracketed category tags are common there) and a creator's own display
 * name (some creators bracket a category/language/group/etc. right into
 * it). */
function extractBracketTags(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(BRACKET_TAG_RE)].map((m) => m[1].trim()).filter(Boolean);
}

/** ISO timestamp -> just the date portion, used as a tag on its own (e.g.
 * "2026-08-22") — coarser than the full timestamp already in started_at,
 * which is what actually makes it useful as a browsable tag rather than a
 * near-unique value. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

// Nicer display form for the handful of sources with a live adapter — a
// manual download's platform can be anything yt-dlp itself calls it
// (RecordingRow.platform is a plain string, not the strict Platform union;
// see its doc comment), so this only special-cases the ones we know and
// just capitalizes whatever else shows up (e.g. "vimeo" -> "Vimeo").
const PLATFORM_TAG_LABEL: Record<string, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
  rplay: "RPlay",
};

function platformTag(platform: string): string {
  const p = platform.trim();
  if (!p) return "";
  return PLATFORM_TAG_LABEL[p.toLowerCase()] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export interface AutoTagInput {
  displayName: string;
  title: string | null;
  startedAt: string;
  /** youtube/twitch/kick/etc — same string as RecordingRow.platform. */
  platform: string;
  /** The video's own original publish/air date (yt-dlp's upload_date,
   * YYYYMMDD, converted to YYYY-MM-DD) — only ever known for a manual
   * download (Phase 5); a live capture's "video date" and "recording date"
   * are the same moment, so there's nothing distinct to add there. */
  videoDate?: string;
}

/**
 * The actual set of tags to seed: the source platform, the creator/
 * uploader's name, the date recorded, the video's own date if it's known
 * and different from the recording date, and any bracketed segment from
 * either the title or the display name.
 */
export function autoTagsFor(input: AutoTagInput): string[] {
  const tags = new Set<string>();
  const pt = platformTag(input.platform);
  if (pt) tags.add(pt);
  if (input.displayName.trim()) tags.add(input.displayName.trim());

  const recordedDate = dateOnly(input.startedAt);
  tags.add(recordedDate);
  if (input.videoDate && input.videoDate !== recordedDate) tags.add(input.videoDate);

  for (const t of extractBracketTags(input.title)) tags.add(t);
  for (const t of extractBracketTags(input.displayName)) tags.add(t);

  return [...tags];
}

/** Returns what it applied (not just void) so the caller can hand it
 * straight back in an API response — recorder.ts's startRecording/
 * downloadVideo both need the freshly-created recording's tags in their
 * own return value, not just written to the DB, so the client's optimistic
 * update has the real list immediately instead of an empty one until the
 * next poll. */
export function applyAutoTags(recordingId: string, input: AutoTagInput): string[] {
  const generated = autoTagsFor(input);
  for (const tag of generated) {
    statements.tags.addToRecording(recordingId, tag);
  }
  return generated;
}

/**
 * Re-runs auto-tagging over every existing recording, called once at
 * server startup (see index.ts). Tags are otherwise only ever generated
 * once, at creation time — so a recording made before this file existed,
 * or before a bug fix here (e.g. the bracket regex originally missing
 * fullwidth ［］/【】), would stay permanently under-tagged with no other
 * way to pick up the fix. addToRecording is idempotent (INSERT OR IGNORE
 * underneath), so re-running this against a recording that's already
 * fully tagged just does nothing extra — safe to run unconditionally on
 * every startup rather than needing a "have I already migrated" flag.
 * Can't recover a download's original videoDate tag this way (yt-dlp's
 * upload_date was never persisted as its own column, only ever used
 * transiently at download time) — everything else backfills fully.
 */
export function backfillAutoTags(): void {
  const rows = statements.listRecordings.all();
  for (const row of rows) {
    applyAutoTags(row.id, {
      displayName: row.display_name,
      title: row.title,
      startedAt: row.started_at,
      platform: row.platform,
    });
  }
}
