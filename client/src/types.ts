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

/** Portable creator shape used for export/import — no internal id/created_at. */
export interface ExportedCreator {
  platform: Platform;
  platform_id: string;
  handle: string;
  display_name: string;
  avatar_url: string;
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
