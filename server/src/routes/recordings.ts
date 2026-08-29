import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { statements } from "../db.js";
import { env } from "../env.js";
import { statusCache } from "../cache.js";
import * as recorder from "../recordings/recorder.js";
import * as storage from "../recordings/storage.js";
import * as s3 from "../recordings/s3.js";

export const recordingsRouter = Router();

// Phase 6: import a file the user already has. Streams straight into
// RECORDINGS_DIR under a throwaway temp name (multer's diskStorage writes
// incrementally to disk as the request body arrives — never buffers a
// multi-GB upload in memory) — recorder.ts's importRecording renames it
// into its real place afterward, once it knows the recording's real id.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.recordingsDir),
    filename: (_req, file, cb) => cb(null, `upload-${Date.now()}-${nanoid(8)}${path.extname(file.originalname)}`),
  }),
});

recordingsRouter.get("/", (_req, res) => {
  res.json(recorder.listRecordings());
});

recordingsRouter.get("/storage", async (_req, res) => {
  const stats = await storage.volumeStats();
  if (!stats) return res.status(501).json({ error: "disk usage isn't available on this platform/volume" });
  res.json(stats);
});

recordingsRouter.post("/", async (req, res) => {
  const { creatorId, fromStart } = req.body ?? {};
  if (typeof creatorId !== "string" || !creatorId) {
    return res.status(400).json({ error: "creatorId is required" });
  }
  const creator = statements.getCreator.get(creatorId);
  if (!creator) return res.status(404).json({ error: "creator not found" });

  const status = statusCache.get(creatorId);
  if (!status) return res.status(409).json({ error: "no known status for this creator yet" });

  const result = await recorder.startRecording(creator, status, { fromStart: Boolean(fromStart) });
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

// Phase 6: import a video file the user already has (captured on another
// device, moved here manually, whatever it is) rather than a URL yt-dlp
// can pull from. Pre-checked here (before multer starts consuming the
// request body) and re-checked in recorder.ts's importRecording once the
// upload's real size is known — same two-point gate startRecording/
// downloadVideo already use, just split around the upload itself instead
// of before a download.
recordingsRouter.post("/upload", async (req, res, next) => {
  if (!(await storage.hasEnoughFreeSpace())) {
    return res.status(507).json({ error: `less than ${env.recordingMinFreeGb}GB free disk space — refusing the upload` });
  }
  next();
}, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });

  if (!(await storage.hasEnoughFreeSpace())) {
    // This specific upload was the thing that tipped it over — the
    // pre-check above only ever catches the common case (already low
    // before a large new upload even starts), not this one.
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(507).json({ error: `free disk space dropped below ${env.recordingMinFreeGb}GB during the upload — deleted` });
  }

  const result = await recorder.importRecording(req.file.path, req.file.originalname, {
    title: typeof req.body.title === "string" ? req.body.title : undefined,
    displayName: typeof req.body.displayName === "string" ? req.body.displayName : undefined,
  });
  if (!result.ok) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(409).json({ error: result.error });
  }
  res.status(201).json(result.recording);
});

recordingsRouter.post("/:id/stop", (req, res) => {
  const result = recorder.stopRecording(req.params.id);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.status(204).end();
});

// Local disk is always checked first, then the SMB mount (also a plain
// local path once mounted — see recordings/smb.ts), S3 only as the last
// resort since it's the one actual network client left. Not just an
// optimization: the video and thumbnail can genuinely end up on different
// storage independently (a copy/upload can fail while the video's own
// succeeds — see recorder.ts's offloadToS3/offloadToSmb), so
// storage_location alone isn't a reliable enough signal for which one
// actually holds a given file; checking existence directly is.

recordingsRouter.get("/:id/file", async (req, res) => {
  const row = recorder.getRecording(req.params.id);
  if (!row) return res.status(404).end();
  const abs = storage.absolutePath(row.file_name);
  if (abs && (await storage.fileExists(row.file_name))) {
    // sendFile natively supports Range requests, needed both for seeking a
    // finished recording and for progressively downloading a large one.
    return res.sendFile(abs);
  }
  // Gated on storage_location, unlike the local check above — a slow/timed-
  // out check against a down SMB share is a real cost worth avoiding for a
  // recording that was never SMB-backed in the first place, not just a
  // pointless one.
  if (row.storage_location === "smb") {
    const smbAbs = storage.smbAbsolutePath(row.file_name);
    if (smbAbs && (await storage.smbFileExists(row.file_name))) {
      return res.sendFile(smbAbs);
    }
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
  if (abs && (await storage.fileExists(row.thumbnail_file_name))) {
    return res.sendFile(abs);
  }
  if (row.storage_location === "smb") {
    const smbAbs = storage.smbAbsolutePath(row.thumbnail_file_name);
    if (smbAbs && (await storage.smbFileExists(row.thumbnail_file_name))) {
      return res.sendFile(smbAbs);
    }
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

// Phase 4: tagging. Most tags on a recording come pre-seeded automatically
// (see recorder.ts's applyAutoTags) — these two just let a user add their
// own on top or remove one they don't want, auto-generated or not.
recordingsRouter.post("/:id/tags", (req, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const result = recorder.addTag(req.params.id, name);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.status(204).end();
});

// Tag name in the path, not the body — DELETE conventionally carries no
// body, and req.params already URL-decodes it for us.
recordingsRouter.delete("/:id/tags/:tag", (req, res) => {
  const result = recorder.removeTag(req.params.id, req.params.tag);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.status(204).end();
});
