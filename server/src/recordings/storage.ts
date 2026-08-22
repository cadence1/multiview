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

function resolveSafe(fileName: string): string | null {
  const resolved = path.resolve(env.recordingsDir, fileName);
  const dir = path.resolve(env.recordingsDir) + path.sep;
  if (!resolved.startsWith(dir)) return null; // path traversal attempt
  return resolved;
}

export function absolutePath(fileName: string): string | null {
  return resolveSafe(fileName);
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

/** Free space on the recordings volume, in GB. */
export async function freeSpaceGb(): Promise<number> {
  const stat = await fsPromises.statfs(env.recordingsDir);
  return (stat.bavail * stat.bsize) / 1024 ** 3;
}

/** RECORDING_MIN_FREE_GB=0 disables the check entirely. */
export async function hasEnoughFreeSpace(): Promise<boolean> {
  if (env.recordingMinFreeGb <= 0) return true;
  try {
    return (await freeSpaceGb()) >= env.recordingMinFreeGb;
  } catch {
    return true; // statfs not supported on this platform/volume — don't block on a check we can't perform
  }
}

export async function statFile(fileName: string): Promise<{ size: number } | null> {
  const abs = resolveSafe(fileName);
  if (!abs) return null;
  try {
    const stat = await fsPromises.stat(abs);
    return { size: stat.size };
  } catch {
    return null;
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
