import { statements } from "../db.js";

// Phase 4: auto-generated tags. Applied once, right when a recording's row
// is first created (both startRecording and downloadVideo already know
// display_name/title/started_at at that point — no need to wait for the
// file to finish) — see recorder.ts's applyAutoTags call sites. Users can
// still remove any of these or add their own afterward; this just seeds
// sensible defaults so a fresh recording isn't tag-empty.

const BRACKET_TAG_RE = /\[([^\]]+)\]/g;

/** Every bracketed segment in a string, trimmed, e.g. "Stream [ASMR]
 * [Highlights]" -> ["ASMR", "Highlights"]. Covers both a video's title
 * ("[ASMR]" conventions are common there) and a creator's own display name
 * (some creators bracket a category/language/etc. right into it). */
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

export interface AutoTagInput {
  displayName: string;
  title: string | null;
  startedAt: string;
  /** The video's own original publish/air date (yt-dlp's upload_date,
   * YYYYMMDD, converted to YYYY-MM-DD) — only ever known for a manual
   * download (Phase 5); a live capture's "video date" and "recording date"
   * are the same moment, so there's nothing distinct to add there. */
  videoDate?: string;
}

/**
 * The actual set of tags to seed: the creator/uploader's name, the date
 * recorded, the video's own date if it's known and different from the
 * recording date, and any bracketed segment from either the title or the
 * display name.
 */
export function autoTagsFor(input: AutoTagInput): string[] {
  const tags = new Set<string>();
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
