export type Platform = "youtube" | "twitch" | "kick";
export type StreamState = "live" | "upcoming" | "offline";

export interface Creator {
  id: string;
  platform: Platform;
  platform_id: string;
  handle: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
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
