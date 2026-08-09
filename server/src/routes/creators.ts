import { Router } from "express";
import { nanoid } from "nanoid";
import { statements, listCreators } from "../db.js";
import { statusCache } from "../cache.js";
import { adapters } from "../platforms/index.js";
import type { Platform } from "../platforms/types.js";
import { pollPlatformNow } from "../poller.js";

const PLATFORMS: Platform[] = ["youtube", "twitch", "kick"];

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
    return res.status(502).json({ error: "failed to look up channel on the platform" });
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

creatorsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const existing = statements.getCreator.get(id);
  if (!existing) return res.status(404).json({ error: "not found" });
  statements.deleteCreator.run(id);
  statusCache.remove(id);
  res.status(204).end();
});
