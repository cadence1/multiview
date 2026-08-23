import { spawn, type ChildProcess } from "node:child_process";
import { nanoid } from "nanoid";
import { env } from "../env.js";
import { statements, type CreatorRow, type RecordingRow, type RecordingStatus } from "../db.js";
import type { CreatorStatus } from "../platforms/types.js";
import * as storage from "./storage.js";
import * as s3 from "./s3.js";
import * as tags from "./tags.js";

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

/** Why an automatic (non-manual) stop was requested — null means either
 * still running or a manual/explicit stop, both of which finishRecording
 * distinguishes some other way (see stopRequested). */
type AutoStopReason = "stalled" | "low-disk" | null;

interface ActiveRecording {
  recordingId: string;
  creatorId: string;
  process: ChildProcess;
  namePart: string;
  thumbnailFileName: string | null;
  stopRequested: boolean;
  autoStopReason: AutoStopReason;
  killTimer: NodeJS.Timeout | null;
  stallInterval: NodeJS.Timeout | null;
  lastSize: number;
  noGrowthCount: number;
  /** True for a manual downloadVideo() download (Phase 5), false for a live
   * creator capture from startRecording(). Gates finishRecording's remux
   * step — a download is never MPEG-TS in the first place (yt-dlp's own
   * --remux-video/--merge-output-format flags already guarantee an mp4/mkv
   * container for it directly), so there's nothing to repackage. */
  isDownload: boolean;
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

// Disk space can be exhausted by an active recording much faster than the
// 4-minute stall check would ever notice (that's watching for *no*
// progress, this is watching for *too much*) — checked independently, on a
// short interval, across every active recording at once rather than
// per-recording, since free space is a whole-volume condition none of them
// individually control.
const DISK_CHECK_INTERVAL_MS = 30 * 1000;

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

function requestStop(rec: ActiveRecording, autoStopReason: AutoStopReason) {
  if (rec.stopRequested) return; // never re-signal — a second SIGINT can hard-abort instead of finalizing
  rec.stopRequested = true;
  rec.autoStopReason = autoStopReason;
  killTree(rec.process, "SIGINT");
  rec.killTimer = setTimeout(() => {
    console.warn(`[recorder] ${rec.recordingId} didn't stop within ${GRACEFUL_STOP_TIMEOUT_MS / 1000}s of SIGINT — force-killing`);
    killTree(rec.process, "SIGKILL");
  }, GRACEFUL_STOP_TIMEOUT_MS);
}

export function stopRecording(recordingId: string): { ok: boolean; error?: string } {
  const rec = active.get(recordingId);
  if (!rec) return { ok: false, error: "not currently recording" };
  requestStop(rec, null);
  return { ok: true };
}

/** Stops every active recording once free disk space drops below
 * RECORDING_MIN_FREE_GB — see DISK_CHECK_INTERVAL_MS. requestStop is a
 * no-op on a recording already stopping, so a still-below-threshold tick
 * while the graceful stop is in flight just does nothing extra. */
function checkDiskSpace() {
  if (active.size === 0 || env.recordingMinFreeGb <= 0) return;
  storage.hasEnoughFreeSpace().then((ok) => {
    if (ok) return;
    console.warn(
      `[recorder] free disk space below ${env.recordingMinFreeGb}GB — stopping ${active.size} active recording(s)`
    );
    for (const rec of active.values()) requestStop(rec, "low-disk");
  });
}

setInterval(checkDiskSpace, DISK_CHECK_INTERVAL_MS);

// How long a file must sit unrecognized before the sweep below treats it as
// orphaned rather than a legitimate in-flight recording's own working file —
// guards the narrow window between yt-dlp actually creating a file on disk
// and this recording being registered in `active` (both happen synchronously
// before spawn() returns, so in practice this margin is generous, not
// tight).
const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000; // 10 minutes
const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Sweeps RECORDINGS_DIR for files nothing in this app still references —
 * confirmed directly that yt-dlp can leave its own intermediate fragment
 * files (e.g. "<name>.f137.mp4", "<name>.f140.mp4") and ".ytdl" sidecar
 * files behind on disk even after finishing a clean merge, and
 * deleteRecording only ever knew to remove the DB row's own tracked
 * file_name/thumbnail_file_name, never yt-dlp's working files alongside it.
 * Same risk after an unclean server restart mid-recording.
 *
 * RECORDINGS_DIR is exclusively this app's own working directory — never a
 * user-shared folder — so anything on disk that isn't a currently-tracked
 * recording's file and isn't part of a still-active recording is debris,
 * not something to be cautious about removing. The active-recording
 * namePart check (not just the age margin) is what actually protects an
 * in-flight recording's own fragments, since a long capture can easily have
 * fragments older than ORPHAN_MIN_AGE_MS that are still very much in use.
 */
async function cleanupOrphanedFiles() {
  const entries = await storage.listFiles();
  if (entries.length === 0) return;

  const known = new Set<string>();
  for (const row of statements.listRecordings.all()) {
    known.add(row.file_name);
    if (row.thumbnail_file_name) known.add(row.thumbnail_file_name);
  }
  const activeNameParts = Array.from(active.values(), (rec) => rec.namePart);

  const now = Date.now();
  for (const fileName of entries) {
    if (known.has(fileName)) continue;
    if (activeNameParts.some((namePart) => fileName.startsWith(namePart))) continue;
    const stat = await storage.statFile(fileName);
    if (!stat || now - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
    await storage.deleteFile(fileName);
    console.log(`[recorder] cleanup: removed orphaned file ${fileName}`);
  }
}

setInterval(() => {
  cleanupOrphanedFiles().catch((err) => console.error("[recorder] orphan cleanup failed:", err));
}, ORPHAN_SWEEP_INTERVAL_MS);
// Also once at startup — catches anything left over from a crash or an
// unclean restart while a recording was in flight, without waiting a full
// sweep interval to notice.
cleanupOrphanedFiles().catch((err) => console.error("[recorder] orphan cleanup failed:", err));

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

  if (rec.autoStopReason === "stalled") {
    status = "stalled";
    error = "stopped automatically — no recording progress detected";
  } else if (rec.autoStopReason === "low-disk") {
    status = "low-disk";
    error = `stopped automatically — free disk space dropped below ${env.recordingMinFreeGb}GB`;
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

  if (!rec.isDownload && hasContent && producedFileName && status !== "failed") {
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

  // Same gate as the remux step above: nothing worth offloading without
  // real content. Runs after finishRecording is already persisted, so a
  // crash or slow upload here never leaves the DB row itself inconsistent
  // — worst case is a recording that stays local when it should've moved,
  // which is just the pre-Phase-2 behavior.
  if (hasContent && status !== "failed" && s3.isEnabled()) {
    await offloadToS3(rec.recordingId, fileName, rec.thumbnailFileName);
  }
}

async function offloadToS3(recordingId: string, fileName: string, thumbnailFileName: string | null) {
  const videoAbs = storage.absolutePath(fileName);
  if (!videoAbs) return;
  const videoUploaded = await s3.uploadFile(videoAbs, fileName);
  if (!videoUploaded) {
    console.warn(`[recorder] ${recordingId} S3 offload failed — keeping local copy`);
    return;
  }
  // Flip the DB row *before* removing the local copy, not after — if the
  // process were to crash in between, "DB says s3, local file still
  // present too" is a harmless, self-cleaning state (the serving routes
  // check local disk first and only fall back to S3 — see recordings.ts),
  // whereas the reverse order risks "DB says local, but the file is
  // already gone" if the crash lands between the delete and this write.
  statements.setStorageLocation.run(recordingId, "s3");

  // Best-effort and independent of the video's own success — a missing
  // preview image isn't worth losing the disk-space win over, same
  // reasoning as downloadThumbnail's own failure handling elsewhere. Same
  // local-first fallback in the serving routes means it's fine for this to
  // end up local while the video ends up in S3.
  if (thumbnailFileName) {
    const thumbAbs = storage.absolutePath(thumbnailFileName);
    if (thumbAbs && (await s3.uploadFile(thumbAbs, thumbnailFileName))) {
      await storage.deleteFile(thumbnailFileName);
    }
  }
  await storage.deleteFile(fileName);
  console.log(`[recorder] ${recordingId} offloaded to S3, local copy removed`);
}

export interface StartRecordingResult {
  ok: boolean;
  // isActive/tags aren't real RecordingRow columns (see listRecordings) —
  // included here too so a freshly-started recording's API response
  // already matches the shape the client's Recording type expects,
  // instead of the client only finding out on the next GET /recordings
  // poll. A real bug this fixed: the options menu's recording indicator
  // used to only update after a refresh, since the optimistic client-side
  // insert had isActive/tags silently undefined until then.
  recording?: RecordingRow & { isActive: boolean; tags: string[] };
  error?: string;
}

export interface StartRecordingOptions {
  /** Passes yt-dlp --live-from-start instead of joining at the live edge.
   * Meaningful for two different reasons depending on what's actually
   * airing: for a YouTube Premiere, the whole file already exists on
   * YouTube's CDN before and during the "premiere" (verified directly —
   * yt-dlp reports the exact same is_live/HLS shape for an in-progress
   * premiere as a genuine live stream, so there's no way to special-case
   * premieres automatically), so this recovers everything from the start
   * even if recording begins well after it began airing. For a genuine
   * live stream it depends entirely on how much of the DVR window YouTube
   * still has available — may only partially succeed, or yt-dlp may error,
   * for a stream that started long enough ago. Not all extractors support
   * it at all (confirmed Twitch does not keep a rewindable live buffer);
   * passing it there is harmless — yt-dlp just can't honor it. */
  fromStart?: boolean;
}

export async function startRecording(
  creator: CreatorRow,
  status: CreatorStatus,
  opts: StartRecordingOptions = {}
): Promise<StartRecordingResult> {
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
    storage_location: "local", // matches the column's own DEFAULT — insertRecording doesn't write this column at all
  };
  statements.insertRecording.run(row);
  // Right away, not after the file finishes — display_name/title/started_at
  // are all already known, and it means the tags show up in the UI even
  // while status is still "recording".
  const appliedTags = tags.applyAutoTags(recordingId, {
    displayName: creator.display_name,
    title: row.title,
    startedAt,
    platform: creator.platform,
  });

  const args = [sourceUrl, "-o", outputTemplate, "--no-playlist", "--no-part", "--newline"];
  if (opts.fromStart) args.push("--live-from-start");

  const child = spawn("yt-dlp", args, {
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
    autoStopReason: null,
    killTimer: null,
    stallInterval: null,
    lastSize: 0,
    noGrowthCount: 0,
    isDownload: false,
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
          requestStop(rec, "stalled");
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

  return { ok: true, recording: { ...row, isActive: true, tags: appliedTags } };
}

/** Maps yt-dlp's extractor name to one of our own platform labels when it's
 * a site we already have a live adapter for, otherwise just lowercases
 * whatever yt-dlp itself calls it (e.g. "vimeo", "tiktok", "generic") — see
 * db.ts's RecordingRow.platform doc comment on why this is a plain string,
 * not the strict Platform union CreatorRow uses. */
function platformFromExtractor(extractorKey: unknown): string {
  const key = (typeof extractorKey === "string" ? extractorKey : "generic").toLowerCase();
  if (key.startsWith("youtube")) return "youtube";
  if (key.startsWith("twitch")) return "twitch";
  if (key.startsWith("kick")) return "kick";
  return key;
}

interface VideoMetadata {
  title: string;
  displayName: string;
  thumbnailUrl: string | undefined;
  platform: string;
  /** The video's own original publish/air date (YYYY-MM-DD), from yt-dlp's
   * upload_date (YYYYMMDD) — distinct from when *we* downloaded it. Used
   * for the "video date" auto-tag, separate from the "recording date" one
   * every recording gets — see tags.ts. */
  videoDate: string | undefined;
}

/** yt-dlp's upload_date is "YYYYMMDD" with no separators — reshape to the
 * same YYYY-MM-DD form the "recording date" tag already uses, so the two
 * are directly comparable (and dedupe correctly when they happen to
 * match). */
function formatUploadDate(uploadDate: unknown): string | undefined {
  if (typeof uploadDate !== "string" || !/^\d{8}$/.test(uploadDate)) return undefined;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

/** A quick metadata-only pass (--skip-download) before the real download —
 * lets the DB row (and the UI) show the real title/uploader/thumbnail from
 * the moment it's created, same as a live recording already gets from the
 * poller's own CreatorStatus, rather than a placeholder until the download
 * finishes. Also doubles as upfront validation: if yt-dlp can't even read
 * the URL's metadata, it's not going to be able to download it either. */
function fetchVideoMetadata(url: string): Promise<VideoMetadata | null> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", ["--dump-json", "--skip-download", "--no-playlist", "--no-warnings", url], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.warn(`[recorder] metadata fetch failed for ${url}: ${stderr.trim().slice(-300) || `exit ${code}`}`);
        resolve(null);
        return;
      }
      try {
        // Just the first line — --dump-json prints one JSON object per
        // line, and --no-playlist already limits this to a single video.
        const info = JSON.parse(stdout.trim().split("\n")[0]);
        const platform = platformFromExtractor(info.extractor_key);
        resolve({
          title: typeof info.title === "string" ? info.title : "Untitled",
          displayName:
            typeof info.uploader === "string"
              ? info.uploader
              : typeof info.channel === "string"
                ? info.channel
                : platform,
          thumbnailUrl: typeof info.thumbnail === "string" ? info.thumbnail : undefined,
          platform,
          videoDate: formatUploadDate(info.upload_date),
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Phase 5: manually download an arbitrary URL — anything yt-dlp itself
 * recognizes, not tied to a tracked creator's live status at all. Simpler
 * than a live capture in a real way: no interruption-resilience concern (a
 * finished upload isn't a live stream that can go dead mid-download the way
 * a creator's feed can), so no MPEG-TS-then-remux dance — yt-dlp's own
 * --remux-video/--merge-output-format flags below produce a directly
 * browser-playable file on their own. Shares the concurrency cap, disk-space
 * gate, stall watcher, and S3 offload with live recordings via the same
 * `active` map — a large download can exhaust disk or hang just as easily.
 */
export async function downloadVideo(url: string): Promise<StartRecordingResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: "url is required" };
  }
  if (active.size >= env.recordingMaxConcurrent) {
    return { ok: false, error: `at the concurrent recording limit (${env.recordingMaxConcurrent})` };
  }
  if (!(await storage.hasEnoughFreeSpace())) {
    return { ok: false, error: `less than ${env.recordingMinFreeGb}GB free disk space — refusing to start` };
  }

  const metadata = await fetchVideoMetadata(trimmed);
  if (!metadata) {
    return { ok: false, error: "couldn't read that URL — check it's a valid, publicly accessible video link yt-dlp supports" };
  }

  const recordingId = nanoid();
  const startedAt = new Date().toISOString();
  const namePart = storage.sanitizeFileNameComponent(`${metadata.platform}-${metadata.displayName}-${startedAt}`);
  const outputTemplate = storage.absolutePath(`${namePart}.%(ext)s`);
  if (!outputTemplate) return { ok: false, error: "invalid output path" };

  const thumbnailFileName = await downloadThumbnail(metadata.thumbnailUrl, `${namePart}.jpg`);

  const row: RecordingRow = {
    id: recordingId,
    creator_id: "", // not tied to a tracked creator — see db.ts's doc comment
    platform: metadata.platform,
    display_name: metadata.displayName,
    title: metadata.title,
    thumbnail_file_name: thumbnailFileName,
    file_name: `${namePart}.mp4`, // best-guess placeholder until finishRecording discovers the real one
    status: "recording",
    started_at: startedAt,
    ended_at: null,
    file_size_bytes: null,
    error: null,
    storage_location: "local",
  };
  statements.insertRecording.run(row);
  const appliedTags = tags.applyAutoTags(recordingId, {
    displayName: metadata.displayName,
    title: metadata.title,
    startedAt,
    videoDate: metadata.videoDate,
    platform: metadata.platform,
  });

  const child = spawn(
    "yt-dlp",
    [
      trimmed,
      "-o",
      outputTemplate,
      "--no-playlist",
      "--no-part",
      "--newline",
      // Guarantees a directly browser-playable container without our own
      // remux step: merges to mp4 when a merge is needed at all, and
      // remuxes losslessly to mp4 (falling back to mkv only if the
      // video/audio codec genuinely can't go in an mp4 container) either
      // way, covering both the merged and already-single-file cases.
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4/mkv",
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
      detached: !IS_WINDOWS,
    }
  );

  let stderrTail = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });

  const rec: ActiveRecording = {
    recordingId,
    creatorId: "",
    process: child,
    namePart,
    thumbnailFileName,
    stopRequested: false,
    autoStopReason: null,
    killTimer: null,
    stallInterval: null,
    lastSize: 0,
    noGrowthCount: 0,
    isDownload: true,
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
          console.warn(`[recorder] download ${recordingId} looks stalled (no growth for ~${minutes}min) — stopping it`);
          requestStop(rec, "stalled");
        }
      } else {
        rec.noGrowthCount = 0;
      }
      rec.lastSize = size;
    });
  }, STALL_CHECK_INTERVAL_MS);

  child.on("error", (err) => {
    console.error(`[recorder] failed to start yt-dlp download for ${trimmed}:`, err.message);
  });
  child.on("close", (code) => {
    finishRecording(rec, code, stderrTail).catch((err) =>
      console.error(`[recorder] error finishing download ${recordingId}:`, err)
    );
  });

  return { ok: true, recording: { ...row, isActive: true, tags: appliedTags } };
}

export async function deleteRecording(recordingId: string): Promise<{ ok: boolean; error?: string }> {
  if (active.has(recordingId)) {
    return { ok: false, error: "recording is still in progress — stop it first" };
  }
  const row = statements.getRecording.get(recordingId);
  if (!row) return { ok: false, error: "not found" };
  // Best-effort against both local disk and S3 rather than branching on
  // storage_location — a missing file/object either way is already a no-op
  // in both deleteFile and deleteObject, and the video/thumbnail can end up
  // on different storage independently (offloadToS3 keeps the thumbnail
  // local if only its own upload failed), so a single flag isn't reliable
  // enough to pick just one to check.
  await storage.deleteFile(row.file_name);
  await storage.deleteFile(row.thumbnail_file_name);
  await s3.deleteObject(row.file_name);
  if (row.thumbnail_file_name) await s3.deleteObject(row.thumbnail_file_name);
  statements.tags.deleteAllForRecording(recordingId);
  statements.deleteRecording.run(recordingId);
  return { ok: true };
}

export function listRecordings(): (RecordingRow & { isActive: boolean; tags: string[] })[] {
  const tagsByRecording = statements.tags.listAllByRecording();
  return statements.listRecordings.all().map((r) => ({
    ...r,
    isActive: active.has(r.id),
    tags: tagsByRecording.get(r.id) ?? [],
  }));
}

export function getRecording(recordingId: string): RecordingRow | undefined {
  return statements.getRecording.get(recordingId);
}

export function addTag(recordingId: string, name: string): { ok: boolean; error?: string } {
  if (!statements.getRecording.get(recordingId)) return { ok: false, error: "not found" };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "tag name is required" };
  statements.tags.addToRecording(recordingId, trimmed);
  return { ok: true };
}

export function removeTag(recordingId: string, name: string): { ok: boolean; error?: string } {
  if (!statements.getRecording.get(recordingId)) return { ok: false, error: "not found" };
  statements.tags.removeFromRecording(recordingId, name);
  return { ok: true };
}
