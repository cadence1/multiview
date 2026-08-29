import { config as loadDotenv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// dotenv's default `import "dotenv/config"` resolves .env relative to
// process.cwd(), which varies by how the server is started (npm workspaces
// and `cd server && node dist/index.js` both set cwd to server/, not the
// repo root where .env actually lives) — so it silently found nothing in
// every local run. Resolve explicitly relative to this file instead: two
// levels up from both server/src/env.ts and server/dist/env.js is the repo
// root. Docker doesn't need this at all (env_file injects real process env
// vars directly), but local/non-Docker runs do.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../../.env") });

function resolveDataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function resolveRecordingsDir(dataDir: string): string {
  const dir = process.env.RECORDINGS_DIR || path.join(dataDir, "recordings");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Where the SMB share gets mounted when enabled — a real kernel CIFS
 * mount (see recordings/smb.ts), not a network client, so anything under
 * here is an ordinary local path to yt-dlp/ffmpeg/Node's own fs the moment
 * it's mounted. Deliberately separate from recordingsDir, not the same
 * directory: an in-progress recording always writes to local disk first
 * (network-mount latency/reliability isn't something an hours-long active
 * capture should be exposed to), only moving here once finished — see
 * recorder.ts's finishRecording. Just an empty local directory (the mount
 * point) until smb.mount() actually mounts something onto it.*/
function resolveSmbMountDir(dataDir: string): string {
  const dir = path.join(dataDir, "smb-mount");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const dataDir = resolveDataDir();

export const env = {
  port: Number(process.env.PORT || 8080),
  dataDir,
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  twitchClientId: process.env.TWITCH_CLIENT_ID || "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
  twitchEmbedParent: process.env.TWITCH_EMBED_PARENT || "localhost",
  kickClientId: process.env.KICK_CLIENT_ID || "",
  kickClientSecret: process.env.KICK_CLIENT_SECRET || "",
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || 300),
  recordingsDir: resolveRecordingsDir(dataDir),
  smbMountDir: resolveSmbMountDir(dataDir),
  // Refuses to *start* a new recording below this much free disk space, and
  // also stops every currently-active recording if free space drops below
  // it mid-recording (checked independently of the start-time gate — see
  // recorder.ts's diskCheckInterval) — not a retention/cleanup policy
  // (there isn't one; recordings are only ever removed by an explicit
  // delete), just a safety net against ever filling the disk completely.
  // 0 disables both checks entirely.
  recordingMinFreeGb: Number(process.env.RECORDING_MIN_FREE_GB ?? 5),
  // Live recordings only (manual + auto-record) — a 5th concurrent attempt
  // is rejected outright rather than queued, since queueing something
  // time-sensitive just means missing the part spent waiting.
  recordingMaxConcurrent: Number(process.env.RECORDING_MAX_CONCURRENT ?? 4),

  // Optional S3-compatible offload for finished recordings (Phase 2 of the
  // recording feature — see recorder.ts's finishRecording). Recording
  // itself is always local first regardless (yt-dlp/ffmpeg need a real
  // filesystem path, and a live source can't be written straight into an
  // object store) — this is only about what happens to the *finished* file.
  // "Enabled" means bucket + both credentials are set; endpoint/region are
  // meaningful either way (endpoint blank = talk to real AWS S3).
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Region: process.env.S3_REGION || "us-east-1",
  s3Bucket: process.env.S3_BUCKET || "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  // Optional "subfolder" within the bucket — keys become `${prefix}${fileName}`.
  s3KeyPrefix: process.env.S3_KEY_PREFIX || "",
  // Path-style (bucket in the URL path, not a subdomain) is what
  // self-hosted S3-compatible servers (MinIO, etc.) generally need — real
  // AWS S3 supports it too, just deprecated there. Defaults to on whenever
  // a custom endpoint is set (i.e. probably not real AWS), off otherwise;
  // explicitly overridable either way.
  s3ForcePathStyle:
    process.env.S3_FORCE_PATH_STYLE !== undefined
      ? process.env.S3_FORCE_PATH_STYLE === "true"
      : Boolean(process.env.S3_ENDPOINT),
};
