import type { CreatorStatus } from "./platforms/types.js";

/**
 * In-memory cache of the latest known status per creator, written by the poller
 * and read by the API. Never blocks a request on a live network call.
 */
class StatusCache {
  private byCreatorId = new Map<string, CreatorStatus>();

  set(status: CreatorStatus) {
    this.byCreatorId.set(status.creatorId, status);
  }

  setMany(statuses: Iterable<CreatorStatus>) {
    for (const s of statuses) this.set(s);
  }

  get(creatorId: string): CreatorStatus | undefined {
    return this.byCreatorId.get(creatorId);
  }

  all(): CreatorStatus[] {
    return Array.from(this.byCreatorId.values());
  }

  remove(creatorId: string) {
    this.byCreatorId.delete(creatorId);
  }
}

export const statusCache = new StatusCache();
