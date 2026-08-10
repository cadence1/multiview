import { Router } from "express";
import { nanoid } from "nanoid";
import { statements, listCreators } from "../db.js";
import { statusCache } from "../cache.js";
import { adapters } from "../platforms/index.js";
import type { Platform } from "../platforms/types.js";
import { pollPlatformNow } from "../poller.js";

const PLATFORMS: Platform[] = ["youtube", "twitch", "kick", "rplay"];

export const creatorsRouter = Router();

creatorsRouter.get("/", (_req, res) => {
  res.json(listCreators());
});

creatorsRouter.post("/", async (req, res) => {
  const { platform, query } = req.body ?? {};
  if (!PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of ${PLATFORMS.join(", ")}` });
  }
  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const existing = statements.findByPlatform.get(platform, query.trim());
  if (existing) {
    return res.status(409).json({ error: "already tracked", creator: existing });
  }

  let resolved;
  try {
    resolved = await adapters[platform as Platform].resolveChannel(query.trim());
  } catch (err) {
    console.error(`[creators] resolve failed for ${platform}/${query}:`, err);
    // Surface the adapter's own message when it deliberately threw one
    // (e.g. Twitch's "not configured" — a real, actionable distinction
    // from "channel not found") rather than a generic string that would
    // hide it.
    return res.status(502).json({
      error: err instanceof Error ? err.message : "failed to look up channel on the platform",
    });
  }
  if (!resolved) {
    return res.status(404).json({ error: "channel not found" });
  }

  const dupe = statements.findByPlatform.get(resolved.platform, resolved.platformId);
  if (dupe) {
    return res.status(409).json({ error: "already tracked", creator: dupe });
  }

  const row = {
    id: nanoid(),
    platform: resolved.platform,
    platform_id: resolved.platformId,
    handle: resolved.handle,
    display_name: resolved.displayName,
    avatar_url: resolved.avatarUrl,
    created_at: new Date().toISOString(),
  };
  statements.insertCreator.run(row);

  // Fire off an immediate status check so the UI doesn't wait a full poll cycle.
  pollPlatformNow(resolved.platform, [
    { id: row.id, platform: row.platform, platformId: row.platform_id, handle: row.handle },
  ]).catch(() => {});

  res.status(201).json(row);
});

interface ImportEntry {
  platform?: unknown;
  platform_id?: unknown;
  handle?: unknown;
  display_name?: unknown;
  avatar_url?: unknown;
}

function isValidImportEntry(
  entry: unknown
): entry is { platform: Platform; platform_id: string; handle: string; display_name?: string; avatar_url?: string } {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as ImportEntry;
  return (
    typeof e.platform === "string" &&
    PLATFORMS.includes(e.platform as Platform) &&
    typeof e.platform_id === "string" &&
    e.platform_id.trim().length > 0 &&
    typeof e.handle === "string" &&
    e.handle.trim().length > 0
  );
}

// Bulk-import creators previously exported via GET /api/creators (client
// reshapes that into {creators: [...]}). Unlike POST /, this skips
// re-resolving each channel over the network — the export already has the
// resolved platform_id/handle/display_name/avatar_url, so this is just a
// direct, deduped insert. Immediate status checks are still kicked off for
// whatever actually got inserted.
creatorsRouter.post("/import", async (req, res) => {
  const { creators } = req.body ?? {};
  if (!Array.isArray(creators)) {
    return res.status(400).json({ error: "body must be { creators: [...] }" });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const newlyInserted: { id: string; platform: Platform; platformId: string; handle: string }[] = [];

  for (let i = 0; i < creators.length; i++) {
    const entry = creators[i];
    if (!isValidImportEntry(entry)) {
      errors.push(`entry ${i}: missing/invalid platform, platform_id, or handle`);
      continue;
    }

    const platformId = entry.platform_id.trim();
    if (statements.findByPlatform.get(entry.platform, platformId)) {
      skipped++;
      continue;
    }

    const row = {
      id: nanoid(),
      platform: entry.platform,
      platform_id: platformId,
      handle: entry.handle.trim(),
      display_name: entry.display_name?.trim() || entry.handle.trim(),
      avatar_url: typeof entry.avatar_url === "string" ? entry.avatar_url : "",
      created_at: new Date().toISOString(),
    };
    statements.insertCreator.run(row);
    imported++;
    newlyInserted.push({ id: row.id, platform: row.platform, platformId: row.platform_id, handle: row.handle });
  }

  const byPlatform = new Map<Platform, typeof newlyInserted>();
  for (const c of newlyInserted) {
    const list = byPlatform.get(c.platform) ?? [];
    list.push(c);
    byPlatform.set(c.platform, list);
  }
  for (const [platform, list] of byPlatform) {
    pollPlatformNow(platform, list).catch(() => {});
  }

  res.json({ imported, skipped, errors });
});

creatorsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const existing = statements.getCreator.get(id);
  if (!existing) return res.status(404).json({ error: "not found" });
  statements.deleteCreator.run(id);
  statusCache.remove(id);
  res.status(204).end();
});
