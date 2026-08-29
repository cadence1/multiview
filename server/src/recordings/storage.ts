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

export function smbExistsSync(fileName: string): boolean {
  const abs = smbAbsolutePath(fileName);
  return abs ? fs.existsSync(abs) : false;
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

export function existsSync(fileName: string): boolean {
  const abs = resolveSafe(fileName);
  return abs ? fs.existsSync(abs) : false;
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
