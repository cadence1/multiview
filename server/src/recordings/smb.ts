import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { statements, type SmbSettingsRow } from "../db.js";
import { env } from "../env.js";

// Optional offload for *finished* recordings — same role as s3.ts, a
// different backend. Unlike s3.ts, this isn't a network client at all: it
// mounts the SMB share as a real kernel CIFS filesystem (via the `mount`
// command, same shell-out pattern this app already uses for yt-dlp/ffmpeg)
// onto env.smbMountDir, and from that point on it's an ordinary local
// directory to everything — Node's fs, ffmpeg, yt-dlp, none of them know
// or care it's remote. That gives full native Range/seek support on
// playback for free, which a pure-JS SMB client library couldn't
// (confirmed directly this session: the one realistic option,
// @marsaud/smb2, crashed the process on every write — an uncaught
// exception inside its own stream cleanup, not fixable from the outside —
// and even a working client library would still need its own custom
// byte-range serving logic, which a real mount makes entirely unnecessary).
//
// Requires the container to be granted CAP_SYS_ADMIN (docker-compose.yml)
// — Docker's own default seccomp profile already allows mount/umount2
// conditionally on that capability being present, confirmed directly by
// reading the actual profile JSON (moby/moby's profiles/seccomp/default.json),
// not just documentation — so no seccomp changes are needed on top of it.

const CIFS_TEST_MOUNT_DIR = path.join(env.dataDir, "smb-mount-test");

export function getSettings(): SmbSettingsRow {
  return statements.smbSettings.get();
}

export function isEnabled(): boolean {
  const s = getSettings();
  return Boolean(s.enabled && s.host && s.share);
}

function shareRoot(s: Pick<SmbSettingsRow, "host" | "share">): string {
  return `//${s.host}/${s.share}`;
}

function shareTarget(s: Pick<SmbSettingsRow, "host" | "share" | "base_path">): string {
  const base = s.base_path.replace(/^\/+|\/+$/g, "");
  return base ? `${shareRoot(s)}/${base}` : shareRoot(s);
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let output = "";
    proc.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    proc.on("error", (err) => resolve({ ok: false, output: err.message }));
    proc.on("close", (code) => resolve({ ok: code === 0, output: output.trim() }));
  });
}

/** Whether `dir` currently has *anything* mounted on it — checked via
 * /proc/mounts rather than assuming based on our own last mount() call
 * succeeding, since a container restart wipes any real kernel mount but
 * doesn't touch the smb_settings row that says "enabled". */
async function isMountedAt(dir: string): Promise<boolean> {
  try {
    const mounts = await fs.readFile("/proc/mounts", "utf8");
    return mounts.split("\n").some((line) => line.split(" ")[1] === dir);
  } catch {
    return false; // not on Linux, or /proc unavailable — can't be mounted either way
  }
}

/**
 * Credentials go in a temp file (mount.cifs's `credentials=` option), not
 * inline `-o username=...,password=...` — an inline password can contain a
 * comma (breaking the comma-separated -o option parsing outright) and would
 * sit in plain sight in `ps aux` for the whole mount command's lifetime.
 * The file only needs to exist for the single mount.cifs invocation that
 * reads it, so it's deleted immediately after regardless of outcome.
 */
async function withCredentialsFile<T>(
  s: Pick<SmbSettingsRow, "username" | "password" | "domain">,
  fn: (credentialsPath: string | null) => Promise<T>
): Promise<T> {
  if (!s.username) return fn(null); // guest/anonymous — no file needed
  const credPath = path.join(os.tmpdir(), `multiview-smb-cred-${process.pid}-${Date.now()}`);
  const lines = [`username=${s.username}`, `password=${s.password}`];
  if (s.domain) lines.push(`domain=${s.domain}`);
  await fs.writeFile(credPath, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    return await fn(credPath);
  } finally {
    await fs.unlink(credPath).catch(() => {});
  }
}

async function runMount(target: string, dir: string, s: Pick<SmbSettingsRow, "username" | "password" | "domain">) {
  return withCredentialsFile(s, async (credPath) => {
    const opts = ["uid=0", "gid=0", "vers=3.0"];
    opts.push(credPath ? `credentials=${credPath}` : "guest");
    return run("mount", ["-t", "cifs", target, dir, "-o", opts.join(",")]);
  });
}

async function mountAt(
  dir: string,
  s: Pick<SmbSettingsRow, "host" | "share" | "base_path" | "username" | "password" | "domain">
): Promise<{ ok: boolean; error?: string }> {
  await fs.mkdir(dir, { recursive: true });
  const base = s.base_path.replace(/^\/+|\/+$/g, "");

  if (base) {
    // A CIFS mount can't target a subdirectory that doesn't already exist
    // on the share (confirmed directly — "No such file or directory", not
    // something `mount` will create for you the way a local mkdir would).
    // Mount the share root first, create the subdirectory there if it's
    // missing, unmount, then mount the real target — this only ever
    // happens once per distinct base_path (every mount after the first
    // finds the directory already there and skips straight to the direct
    // mount below).
    const rootResult = await runMount(shareRoot(s), dir, s);
    if (!rootResult.ok) {
      console.error(`[smb] mount (root, to prepare base_path) failed: ${rootResult.output}`);
      return { ok: false, error: rootResult.output || "mount failed" };
    }
    await fs.mkdir(path.join(dir, base), { recursive: true }).catch(() => {});
    await unmountAt(dir);
  }

  const result = await runMount(shareTarget(s), dir, s);
  if (!result.ok) {
    console.error(`[smb] mount failed: ${result.output}`);
    return { ok: false, error: result.output || "mount failed" };
  }
  return { ok: true };
}

async function unmountAt(dir: string): Promise<void> {
  if (!(await isMountedAt(dir))) return;
  const result = await run("umount", [dir]);
  if (!result.ok) console.error(`[smb] unmount of ${dir} failed: ${result.output}`);
}

/** Mounts the currently-saved settings onto env.smbMountDir — a no-op if
 * something's already mounted there (idempotent, safe to call on every
 * server startup regardless of whether a previous mount is still live). */
export async function mount(): Promise<{ ok: boolean; error?: string }> {
  if (!isEnabled()) return { ok: false, error: "SMB storage isn't enabled" };
  if (await isMountedAt(env.smbMountDir)) return { ok: true };
  const s = getSettings();
  const result = await mountAt(env.smbMountDir, s);
  if (result.ok) console.log(`[smb] mounted ${shareTarget(s)} at ${env.smbMountDir}`);
  return result;
}

export async function unmount(): Promise<void> {
  await unmountAt(env.smbMountDir);
  console.log(`[smb] unmounted ${env.smbMountDir}`);
}

export async function isMounted(): Promise<boolean> {
  return isMountedAt(env.smbMountDir);
}

/**
 * Powers the settings UI's "Test connection" button — mounts the candidate
 * settings at a dedicated, separate test directory (never env.smbMountDir
 * itself, so this can never disrupt an already-active real mount an
 * existing recording might be relying on), writes+reads+deletes a marker
 * file through plain fs to prove real read/write access, then unmounts.
 * Takes the candidate settings directly rather than reading from the DB,
 * so the UI can test *before* saving.
 */
export async function testConnection(
  candidate: Omit<SmbSettingsRow, "id" | "enabled" | "updated_at">
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mountResult = await mountAt(CIFS_TEST_MOUNT_DIR, candidate);
  if (!mountResult.ok) return { ok: false, error: mountResult.error ?? "mount failed" };

  try {
    const probePath = path.join(CIFS_TEST_MOUNT_DIR, ".multiview-connection-test");
    const marker = `ok ${Date.now()}`;
    await fs.writeFile(probePath, marker);
    const readBack = await fs.readFile(probePath, "utf8");
    await fs.unlink(probePath).catch(() => {});
    if (readBack !== marker) {
      return { ok: false, error: "wrote a test file but read back different content — something's off with this share" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await unmountAt(CIFS_TEST_MOUNT_DIR);
  }
}
