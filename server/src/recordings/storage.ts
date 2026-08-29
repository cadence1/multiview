import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

// Everything that touches the filesystem for recordings lives here,
// isolated from recorder.ts's process-management logic — an SMB share
// already works today for free (RECORDINGS_DIR just points at a mounted
// path, indistinguishable from local disk to Node), and an eventual S3
// backend would mean swapping this one module rather than reworking the
// recorder itself.

/** Strips anything that isn't a plain filename component — no path
 * separators, no "..", so a value that ends up in a URL param (recording
 * ids are server-generated, but this guards the file name derived from
 * user-influenced text like a creator's display name) can never escape
 * RECORDINGS_DIR. */
export function sanitizeFileNameComponent(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
  return cleaned || "untitled";
}

function resolveWithin(baseDir: string, fileName: string): string | null {
  const resolved = path.resolve(baseDir, fileName);
  const dir = path.resolve(baseDir) + path.sep;
  if (!resolved.startsWith(dir)) return null; // path traversal attempt
  return resolved;
}

function resolveSafe(fileName: string): string | null {
  return resolveWithin(env.recordingsDir, fileName);
}

export function absolutePath(fileName: string): string | null {
  return resolveSafe(fileName);
}

/** Same as absolutePath, but rooted at the SMB mount point (env.smbMountDir)
 * instead of RECORDINGS_DIR — see recordings/smb.ts. Once mounted, this is
 * an ordinary local path like any other; the only reason it's a separate
 * function is that it's a different directory, not different mechanics. */
export function smbAbsolutePath(fileName: string): string | null {
  return resolveWithin(env.smbMountDir, fileName);
}

// How long a single request is willing to wait on the SMB mount before
// giving up and answering "not found" rather than hanging — confirmed
// directly against a real outage (the NAS's own IP blocked while still
// mounted) that a dead CIFS connection's own timeout is far longer than
// this: a request against it was still unresolved past several minutes.
// This doesn't cancel the underlying stat() — Node's fs promises can't be
// cancelled, and it keeps running on libuv's threadpool in the background
// regardless — it just stops *this request* from waiting on it, so a real
// outage costs one slow response instead of one that never comes back.
const SMB_ACCESS_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Deliberately async, not fs.existsSync — confirmed this matters
 * directly: existsSync is synchronous, and Node is single-threaded for
 * synchronous I/O, so a stat() against a CIFS mount whose remote host has
 * gone unreachable (network partition, NAS down — mounted but no longer
 * actually answering, not the same as cleanly unmounted) would block the
 * *entire* server process for however long that syscall takes to time
 * out — every other request, every creator, everything, not just this
 * one file. fsPromises.access lets that one request wait it out without
 * freezing anything else — and the timeout wrapper below keeps that one
 * request itself from hanging indefinitely too. */
export async function smbFileExists(fileName: string): Promise<boolean> {
  const abs = smbAbsolutePath(fileName);
  if (!abs) return false;
  try {
    await withTimeout(fsPromises.access(abs, fs.constants.F_OK), SMB_ACCESS_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

/** Copies a finished recording's file from local disk onto the (already
 * mounted) SMB share — a real filesystem copy, not a network upload client,
 * since the mount already makes the destination an ordinary path. Doesn't
 * delete the local source; the caller verifies the copy first (see
 * recorder.ts's offloadToSmb) same as the S3 path's own upload-then-verify
 * order. */
export async function copyToSmbMount(fileName: string): Promise<boolean> {
  const src = resolveSafe(fileName);
  const dest = smbAbsolutePath(fileName);
  if (!src || !dest) return false;
  try {
    await fsPromises.copyFile(src, dest);
    return true;
  } catch (err) {
    console.error(`[storage] copy to SMB mount failed for ${fileName}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function smbStatFile(fileName: string): Promise<{ size: number } | null> {
  const abs = smbAbsolutePath(fileName);
  if (!abs) return null;
  try {
    const stat = await fsPromises.stat(abs);
    return { size: stat.size };
  } catch {
    return null;
  }
}

export async function deleteSmbFile(fileName: string | null): Promise<void> {
  if (!fileName) return;
  const abs = smbAbsolutePath(fileName);
  if (!abs) return;
  await fsPromises.unlink(abs).catch(() => {}); // already gone is fine
}

export async function checkWritable(): Promise<{ ok: true } | { ok: false; error: string }> {
  const probe = path.join(env.recordingsDir, `.write-check-${process.pid}`);
  try {
    await fsPromises.writeFile(probe, "ok");
    await fsPromises.unlink(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface VolumeStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

/**
 * Stats for the whole volume backing RECORDINGS_DIR — not just what the
 * recordings themselves take up, the actual disk (or share) they live on,
 * matching what RECORDING_MIN_FREE_GB's safety check is really weighing
 * against. usedBytes is everything else on that volume too, not just
 * Multiview's own recordings.
 */
export async function volumeStats(): Promise<VolumeStats | null> {
  try {
    const stat = await fsPromises.statfs(env.recordingsDir);
    const totalBytes = stat.blocks * stat.bsize;
    const freeBytes = stat.bavail * stat.bsize;
    return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  } catch {
    return null; // statfs not supported on this platform/volume
  }
}

/** RECORDING_MIN_FREE_GB=0 disables the check entirely. */
export async function hasEnoughFreeSpace(): Promise<boolean> {
  if (env.recordingMinFreeGb <= 0) return true;
  const stats = await volumeStats();
  if (!stats) return true; // couldn't check — don't block on a check we can't perform
  return stats.freeBytes / 1024 ** 3 >= env.recordingMinFreeGb;
}

export async function statFile(fileName: string): Promise<{ size: number; mtimeMs: number } | null> {
  const abs = resolveSafe(fileName);
  if (!abs) return null;
  try {
    const stat = await fsPromises.stat(abs);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** Every plain file directly in RECORDINGS_DIR — used by the orphan-file
 * sweep in recorder.ts to find anything nothing in the app still
 * references. Not recursive: this directory has never had subdirectories
 * of its own. */
export async function listFiles(): Promise<string[]> {
  try {
    const entries = await fsPromises.readdir(env.recordingsDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Async for the same reason as smbFileExists — RECORDINGS_DIR is local
 * disk in the overwhelmingly common case (so this is low-risk in
 * practice), but keeping both async keeps the two symmetric rather than
 * leaving a synchronous local-only path as an exception to reason about. */
export async function fileExists(fileName: string): Promise<boolean> {
  const abs = resolveSafe(fileName);
  if (!abs) return false;
  try {
    await fsPromises.access(abs, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(fileName: string | null): Promise<void> {
  if (!fileName) return;
  const abs = resolveSafe(fileName);
  if (!abs) return;
  await fsPromises.unlink(abs).catch(() => {}); // already gone is fine
}

export async function renameFile(fromFileName: string, toFileName: string): Promise<boolean> {
  const fromAbs = resolveSafe(fromFileName);
  const toAbs = resolveSafe(toFileName);
  if (!fromAbs || !toAbs) return false;
  try {
    await fsPromises.rename(fromAbs, toAbs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds whichever file yt-dlp actually produced for a given recording,
 * rather than assuming a filename in advance: verified directly against a
 * real yt-dlp run that when its own internally-determined container
 * extension disagrees with a literal -o filename's, it appends its own
 * rather than respecting or replacing the given one (e.g. asking for
 * "name.ts" can produce "name.ts.mp4" on disk) — so predicting the exact
 * output name isn't reliable. `excludeFileName` skips the thumbnail, which
 * shares the same name prefix.
 */
export async function findRecordingFile(
  namePrefix: string,
  excludeFileName: string | null
): Promise<string | null> {
  try {
    const entries = await fsPromises.readdir(env.recordingsDir);
    const match = entries.find((e) => e.startsWith(namePrefix) && e !== excludeFileName);
    return match ?? null;
  } catch {
    return null;
  }
}

export function readStream(fileName: string): fs.ReadStream | null {
  const abs = resolveSafe(fileName);
  if (!abs) return null;
  return fs.createReadStream(abs);
}
