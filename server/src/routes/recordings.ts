import { Router } from "express";
import { statements } from "../db.js";
import { statusCache } from "../cache.js";
import * as recorder from "../recordings/recorder.js";
import * as storage from "../recordings/storage.js";

export const recordingsRouter = Router();

recordingsRouter.get("/", (_req, res) => {
  res.json(recorder.listRecordings());
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

recordingsRouter.post("/:id/stop", (req, res) => {
  const result = recorder.stopRecording(req.params.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(204).end();
});

recordingsRouter.get("/:id/file", (req, res) => {
  const row = recorder.getRecording(req.params.id);
  if (!row) return res.status(404).end();
  const abs = storage.absolutePath(row.file_name);
  if (!abs || !storage.existsSync(row.file_name)) return res.status(404).end();
  // sendFile natively supports Range requests, needed both for seeking a
  // finished recording and for progressively downloading a large one.
  res.sendFile(abs);
});

recordingsRouter.get("/:id/thumbnail", (req, res) => {
  const row = recorder.getRecording(req.params.id);
  if (!row?.thumbnail_file_name) return res.status(404).end();
  const abs = storage.absolutePath(row.thumbnail_file_name);
  if (!abs || !storage.existsSync(row.thumbnail_file_name)) return res.status(404).end();
  res.sendFile(abs);
});

recordingsRouter.delete("/:id", async (req, res) => {
  const result = await recorder.deleteRecording(req.params.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(204).end();
});
