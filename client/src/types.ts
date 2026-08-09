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
