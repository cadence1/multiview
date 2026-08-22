export type Platform = "youtube" | "twitch" | "kick" | "rplay";
export type StreamState = "live" | "upcoming" | "offline";

export interface Creator {
  id: string;
  platform: Platform;
  platform_id: string;
  handle: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  auto_record: 0 | 1;
  /** One-shot — "record the next time they go live", distinct from auto_record's "every time". */
  record_next: 0 | 1;
}

export type RecordingStatus = "recording" | "completed" | "stalled" | "low-disk" | "failed";

/** Stats for the whole volume backing RECORDINGS_DIR, not just the recordings themselves. */
export interface VolumeStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface Recording {
  id: string;
  /** Empty string when this isn't tied to a tracked creator — a manual
   * "download any URL" recording rather than one captured from a
   * creator going live. */
  creator_id: string;
  /** Loose on purpose: a manual download's source can be anything yt-dlp
   * recognizes, not just the app's own four live platforms — see
   * PlatformBadge for how an unrecognized one renders. */
  platform: string;
  display_name: string;
  title: string | null;
  thumbnail_file_name: string | null;
  file_name: string;
  status: RecordingStatus;
  started_at: string;
  ended_at: string | null;
  file_size_bytes: number | null;
  error: string | null;
  isActive: boolean;
  /** "s3" once a finished recording has been offloaded — see the server's recorder.ts. */
  storage_location: "local" | "s3";
}

export interface CreatorStatus {
  creatorId: string;
  state: StreamState;
  title?: string;
  thumbnailUrl?: string;
  startTime?: string;
  viewerCount?: number;
  embedId?: string;
  updatedAt: string;
}

/**
 * Portable creator shape used for export/import — no internal id/created_at
 * (the server mints a fresh id on every import; platform/platform_id is the
 * actual stable identity). autoAdd/volume are pure client-side prefs (the
 * server import endpoint doesn't know about either) — carried here so a
 * re-import restores them too, matched by platform_id on the client side
 * after the import call resolves.
 */
export interface ExportedCreator {
  platform: Platform;
  platform_id: string;
  handle: string;
  display_name: string;
  avatar_url: string;
  autoAdd?: boolean;
  volume?: number;
}

export interface ExportFile {
  version: 1;
  exportedAt: string;
  creators: ExportedCreator[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}
