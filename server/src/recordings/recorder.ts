import { spawn, type ChildProcess } from "node:child_process";
import { nanoid } from "nanoid";
import { env } from "../env.js";
import { statements, type CreatorRow, type RecordingRow, type RecordingStatus } from "../db.js";
import type { CreatorStatus } from "../platforms/types.js";
import * as storage from "./storage.js";

// Live recording via yt-dlp writing MPEG-TS (its own default for live
// sources — resilient to interruption, unlike fragmented mp4), remuxed to a
// real, browser-playable .mp4 once finalized (fast, lossless — just
// repackaging, not re-encoding). See README for why this two-step shape is
// necessary rather than recording straight to .mp4.
//
// The output filename is deliberately NOT predicted in advance — yt-dlp is
// given a template (%(ext)s), not a literal ".ts" path, and the actual
// result is discovered afterward via storage.findRecordingFile(). Verified
// directly against a real run that a literal filename whose extension
// disagrees with what yt-dlp internally determines doesn't get respected or
// cleanly replaced — yt-dlp appends its own on top instead (asking for
// "name.ts" produced "name.ts.mp4" on disk), which silently broke every
// stat-by-assumed-filename check downstream.

interface ActiveRecording {
  recordingId: string;
  creatorId: string;
  process: ChildProcess;
  namePart: string;
  thumbnailFileName: string | null;
  stopRequested: boolean;
  stalled: boolean;
  killTimer: NodeJS.Timeout | null;
  stallInterval: NodeJS.Timeout | null;
  lastSize: number;
  noGrowthCount: number;
}

const active = new Map<string, ActiveRecording>();

// Stall watcher: two consecutive checks (~8 minutes) with no meaningful
// file growth means our own pipeline has hung or didn't notice the stream
// ended — not a duration cap, just a dead-process detector. See the
// conversation this was designed in: explicitly not meant to catch a
// creator's own feed going to dead air while nominally still live, only
// this recorder's own pipeline stalling.
const STALL_CHECK_INTERVAL_MS = 4 * 60 * 1000;
const STALL_CHECK_COUNT_THRESHOLD = 2;
const MIN_GROWTH_BYTES = 16 * 1024;

// SIGINT is yt-dlp's own documented graceful-stop signal for a live
// download (finalizes the file rather than corrupting it) — but verified
// directly in this project that a child process can simply not act on it
// promptly, so this is a hard backstop, not a nicety: escalate to an
// unconditional kill if the process hasn't actually exited by then.
const GRACEFUL_STOP_TIMEOUT_MS = 25_000;

const IS_WINDOWS = process.platform === "win32";

/**
 * Kills the *entire* process tree, not just the immediate child — yt-dlp
 * shells out to ffmpeg as its own child process for anything HLS-based
 * (i.e. every live recording), and verified directly in this project that
 * calling ChildProcess#kill() only ever reached yt-dlp itself: ffmpeg kept
 * running indefinitely as an orphan regardless of which signal was sent.
 * POSIX: spawn() below runs detached specifically so the process group can
 * be signaled as a unit via the negative-PID convention — verified this
 * actually resolves the stop within a few seconds on a real Linux
 * container. Windows has no real equivalent of a graceful stop for an
 * arbitrary console process, so this always force-kills the whole tree
 * there via taskkill /t /f — a known platform gap, not something worth
 * chasing further given the actual deployment target (the Docker image) is
 * Linux.
 */
function killTree(child: ChildProcess, signal: "SIGINT" | "SIGKILL") {
  if (!child.pid) return;
  if (IS_WINDOWS) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]).on("error", () => {});
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal); // process group already gone — fall back to a direct signal
  }
}

export function isRecording(creatorId: string): boolean {
  for (const rec of active.values()) {
    if (rec.creatorId === creatorId) return true;
  }
  return false;
}

export function activeCount(): number {
  return active.size;
}

function sourceUrlFor(creator: CreatorRow, status: CreatorStatus): string | null {
  switch (creator.platform) {
    case "youtube":
      return status.embedId ? `https://www.youtube.com/watch?v=${status.embedId}` : null;
    case "twitch":
      return `https://www.twitch.tv/${creator.handle}`;
    case "kick":
      return `https://kick.com/${creator.handle}`;
    case "rplay":
      return null; // yt-dlp doesn't support RPlay
  }
}

async function downloadThumbnail(url: string | undefined, fileName: string): Promise<string | null> {
  if (!url) return null;
  const abs = storage.absolutePath(fileName);
  if (!abs) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const fs = await import("node:fs/promises");
    await fs.writeFile(abs, buf);
    return fileName;
  } catch {
    return null; // a missing thumbnail isn't worth failing the recording over
  }
}

/** Remuxes to a fresh .mp4 (lossless, just repackaging) — always attempted
 * on whatever yt-dlp produced regardless of its own extension, since a live
 * source's actual container is effectively always MPEG-TS internally no
 * matter what extension got assigned to it. */
function remux(sourceFileName: string, mp4FileName: string): Promise<boolean> {
  const sourceAbs = storage.absolutePath(sourceFileName);
  const mp4Abs = storage.absolutePath(mp4FileName);
  if (!sourceAbs || !mp4Abs) return Promise.resolve(false);
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-y", "-i", sourceAbs, "-c", "copy", "-movflags", "+faststart", mp4Abs]);
    proc.on("error", () => resolve(false)); // ffmpeg missing, etc.
    proc.on("close", (code) => resolve(code === 0));
  });
}

function requestStop(rec: ActiveRecording, stalled: boolean) {
  if (rec.stopRequested) return; // never re-signal — a second SIGINT can hard-abort instead of finalizing
  rec.stopRequested = true;
  rec.stalled = stalled;
  killTree(rec.process, "SIGINT");
  rec.killTimer = setTimeout(() => {
    console.warn(`[recorder] ${rec.recordingId} didn't stop within ${GRACEFUL_STOP_TIMEOUT_MS / 1000}s of SIGINT — force-killing`);
    killTree(rec.process, "SIGKILL");
  }, GRACEFUL_STOP_TIMEOUT_MS);
}

export function stopRecording(recordingId: string): { ok: boolean; error?: string } {
  const rec = active.get(recordingId);
  if (!rec) return { ok: false, error: "not currently recording" };
  requestStop(rec, false);
  return { ok: true };
}

async function finishRecording(rec: ActiveRecording, code: number | null, stderrTail: string) {
  if (rec.stallInterval) clearInterval(rec.stallInterval);
  if (rec.killTimer) clearTimeout(rec.killTimer);
  active.delete(rec.recordingId);

  const endedAt = new Date().toISOString();
  const producedFileName = await storage.findRecordingFile(rec.namePart, rec.thumbnailFileName);
  const producedStat = producedFileName ? await storage.statFile(producedFileName) : null;
  const hasContent = Boolean(producedStat && producedStat.size > 0);

  let status: RecordingStatus;
  let error: string | null = null;

  if (rec.stalled) {
    status = "stalled";
    error = "stopped automatically — no recording progress detected";
  } else if (rec.stopRequested) {
    status = hasContent ? "completed" : "failed"; // an explicit manual stop is a clean end, but only if it actually captured something
  } else if (code === 0) {
    status = "completed"; // the source stream ended naturally
  } else if (hasContent) {
    status = "completed"; // interrupted, but there's a real partial capture worth keeping
    error = stderrTail.trim().slice(-500) || `yt-dlp exited with code ${code}`;
  } else {
    status = "failed";
    error = stderrTail.trim().slice(-500) || `yt-dlp exited with code ${code}`;
  }

  let fileName = producedFileName ?? rec.namePart;
  let fileSizeBytes = producedStat?.size ?? null;

  if (hasContent && producedFileName && status !== "failed") {
    // yt-dlp's own extension choice for a live source can itself be ".mp4"
    // even though the actual container is MPEG-TS (verified directly) — so
    // the remux target can't just be "<namePart>.mp4" unconditionally, that
    // can collide with producedFileName itself and have ffmpeg try to read
    // and write the same file. Remux to a name that's guaranteed distinct
    // from anything yt-dlp's own template resolution would produce, then
    // rename into place only once the remux is confirmed to have worked.
    const remuxTempFileName = `${rec.namePart}.remuxed.mp4`;
    const remuxOk = await remux(producedFileName, remuxTempFileName);
    const remuxedStat = remuxOk ? await storage.statFile(remuxTempFileName) : null;
    if (remuxedStat && remuxedStat.size > 0) {
      await storage.deleteFile(producedFileName);
      const finalFileName = `${rec.namePart}.mp4`;
      await storage.renameFile(remuxTempFileName, finalFileName);
      fileName = finalFileName;
      fileSizeBytes = remuxedStat.size;
    } else {
      // remux failed or produced nothing — keep whatever yt-dlp made and
      // clean up any empty/partial temp file. Still a valid,
      // downloadable/VLC-playable file, just not necessarily natively
      // browser-playable.
      await storage.deleteFile(remuxTempFileName);
    }
  }

  statements.finishRecording.run(rec.recordingId, status, endedAt, fileName, fileSizeBytes, error);
  console.log(`[recorder] ${rec.recordingId} finished: status=${status} file=${fileName} size=${fileSizeBytes ?? 0}`);
}

export interface StartRecordingResult {
  ok: boolean;
  recording?: RecordingRow;
  error?: string;
}

export async function startRecording(creator: CreatorRow, status: CreatorStatus): Promise<StartRecordingResult> {
  if (creator.platform === "rplay") {
    return { ok: false, error: "RPlay recordings aren't supported — no extraction tool covers it." };
  }
  if (status.state !== "live") {
    return { ok: false, error: "creator isn't currently live" };
  }
  if (isRecording(creator.id)) {
    return { ok: false, error: "already recording this creator" };
  }
  if (active.size >= env.recordingMaxConcurrent) {
    return { ok: false, error: `at the concurrent recording limit (${env.recordingMaxConcurrent})` };
  }
  const sourceUrl = sourceUrlFor(creator, status);
  if (!sourceUrl) {
    return { ok: false, error: "couldn't determine a source URL to record" };
  }
  if (!(await storage.hasEnoughFreeSpace())) {
    return { ok: false, error: `less than ${env.recordingMinFreeGb}GB free disk space — refusing to start` };
  }

  const recordingId = nanoid();
  const startedAt = new Date().toISOString();
  const namePart = storage.sanitizeFileNameComponent(`${creator.platform}-${creator.handle}-${startedAt}`);
  // A template (%(ext)s), not a literal extension — see the module-level
  // comment for why letting yt-dlp pick its own is the reliable choice.
  const outputTemplate = storage.absolutePath(`${namePart}.%(ext)s`);
  if (!outputTemplate) return { ok: false, error: "invalid output path" };

  const thumbnailFileName = await downloadThumbnail(status.thumbnailUrl, `${namePart}.jpg`);

  const row: RecordingRow = {
    id: recordingId,
    creator_id: creator.id,
    platform: creator.platform,
    display_name: creator.display_name,
    title: status.title ?? null,
    thumbnail_file_name: thumbnailFileName,
    file_name: `${namePart}.ts`, // best-guess placeholder until finishRecording discovers the real one
    status: "recording",
    started_at: startedAt,
    ended_at: null,
    file_size_bytes: null,
    error: null,
  };
  statements.insertRecording.run(row);

  const child = spawn("yt-dlp", [sourceUrl, "-o", outputTemplate, "--no-playlist", "--no-part", "--newline"], {
    stdio: ["ignore", "ignore", "pipe"],
    // detached so killTree's process-group signal (POSIX) reaches yt-dlp's
    // own ffmpeg child too, not just yt-dlp itself — see killTree's comment.
    detached: !IS_WINDOWS,
  });

  let stderrTail = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });

  const rec: ActiveRecording = {
    recordingId,
    creatorId: creator.id,
    process: child,
    namePart,
    thumbnailFileName,
    stopRequested: false,
    stalled: false,
    killTimer: null,
    stallInterval: null,
    lastSize: 0,
    noGrowthCount: 0,
  };
  active.set(recordingId, rec);

  rec.stallInterval = setInterval(() => {
    storage.findRecordingFile(namePart, thumbnailFileName).then(async (found) => {
      const stat = found ? await storage.statFile(found) : null;
      const size = stat?.size ?? 0;
      if (size - rec.lastSize < MIN_GROWTH_BYTES) {
        rec.noGrowthCount++;
        if (rec.noGrowthCount >= STALL_CHECK_COUNT_THRESHOLD) {
          const minutes = (STALL_CHECK_INTERVAL_MS * STALL_CHECK_COUNT_THRESHOLD) / 60_000;
          console.warn(`[recorder] ${creator.display_name}'s recording looks stalled (no growth for ~${minutes}min) — stopping it`);
          requestStop(rec, true);
        }
      } else {
        rec.noGrowthCount = 0;
      }
      rec.lastSize = size;
    });
  }, STALL_CHECK_INTERVAL_MS);

  child.on("error", (err) => {
    console.error(`[recorder] failed to start yt-dlp for ${creator.display_name}:`, err.message);
  });
  child.on("close", (code) => {
    finishRecording(rec, code, stderrTail).catch((err) =>
      console.error(`[recorder] error finishing recording ${recordingId}:`, err)
    );
  });

  return { ok: true, recording: row };
}

export async function deleteRecording(recordingId: string): Promise<{ ok: boolean; error?: string }> {
  if (active.has(recordingId)) {
    return { ok: false, error: "recording is still in progress — stop it first" };
  }
  const row = statements.getRecording.get(recordingId);
  if (!row) return { ok: false, error: "not found" };
  await storage.deleteFile(row.file_name);
  await storage.deleteFile(row.thumbnail_file_name);
  statements.deleteRecording.run(recordingId);
  return { ok: true };
}

export function listRecordings(): (RecordingRow & { isActive: boolean })[] {
  return statements.listRecordings.all().map((r) => ({ ...r, isActive: active.has(r.id) }));
}

export function getRecording(recordingId: string): RecordingRow | undefined {
  return statements.getRecording.get(recordingId);
}
