import { Router } from "express";
import { statements } from "../db.js";
import { statusCache } from "../cache.js";
import * as recorder from "../recordings/recorder.js";
import * as storage from "../recordings/storage.js";
import * as s3 from "../recordings/s3.js";

export const recordingsRouter = Router();

recordingsRouter.get("/", (_req, res) => {
  res.json(recorder.listRecordings());
});

recordingsRouter.get("/storage", async (_req, res) => {
  const stats = await storage.volumeStats();
  if (!stats) return res.status(501).json({ error: "disk usage isn't available on this platform/volume" });
  res.json(stats);
});

recordingsRouter.post("/", async (req, res) => {
  const { creatorId } = req.body ?? {};
  if (typeof creatorId !== "string" || !creatorId) {
    return res.status(400).json({ error: "creatorId is required" });
  }
  const creator = statements.getCreator.get(creatorId);
  if (!creator) return res.status(404).json({ error: "creator not found" });

  const status = statusCache.get(creatorId);
  if (!status) return res.status(409).json({ error: "no known status for this creator yet" });

  const result = await recorder.startRecording(creator, status);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(201).json(result.recording);
});

// Phase 5: manually download an arbitrary URL, not tied to a tracked
// creator's live status at all — see recorder.ts's downloadVideo for why
// this is simpler than a live capture. A static path, not /:id/..., so no
// ambiguity with the id-scoped routes below.
recordingsRouter.post("/download", async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "url is required" });
  }
  const result = await recorder.downloadVideo(url);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(201).json(result.recording);
});

recordingsRouter.post("/:id/stop", (req, res) => {
  const result = recorder.stopRecording(req.params.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(204).end();
});

// Local disk is always checked first, S3 only as a fallback — not just an
// optimization. The video and thumbnail can genuinely end up on different
// storage independently (a thumbnail upload can fail while the video's own
// succeeds — see recorder.ts's offloadToS3), so storage_location alone
// isn't a reliable enough signal for which one actually holds a given file;
// checking local existence directly is.

recordingsRouter.get("/:id/file", async (req, res) => {
  const row = recorder.getRecording(req.params.id);
  if (!row) return res.status(404).end();
  const abs = storage.absolutePath(row.file_name);
  if (abs && storage.existsSync(row.file_name)) {
    // sendFile natively supports Range requests, needed both for seeking a
    // finished recording and for progressively downloading a large one.
    return res.sendFile(abs);
  }
  if (row.storage_location === "s3") {
    return s3.streamObject(row.file_name, req.headers.range, res);
  }
  res.status(404).end();
});

recordingsRouter.get("/:id/thumbnail", async (req, res) => {
  const row = recorder.getRecording(req.params.id);
  if (!row?.thumbnail_file_name) return res.status(404).end();
  const abs = storage.absolutePath(row.thumbnail_file_name);
  if (abs && storage.existsSync(row.thumbnail_file_name)) {
    return res.sendFile(abs);
  }
  if (row.storage_location === "s3") {
    return s3.streamObject(row.thumbnail_file_name, undefined, res);
  }
  res.status(404).end();
});

recordingsRouter.delete("/:id", async (req, res) => {
  const result = await recorder.deleteRecording(req.params.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(204).end();
});
