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
  // Refuses to *start* a new recording below this much free disk space —
  // not a retention/cleanup policy (there isn't one; recordings are only
  // ever removed by an explicit delete), just a safety net against ever
  // filling the disk completely. 0 disables the check entirely.
  recordingMinFreeGb: Number(process.env.RECORDING_MIN_FREE_GB ?? 2),
  // Live recordings only (manual + auto-record) — a 5th concurrent attempt
  // is rejected outright rather than queued, since queueing something
  // time-sensitive just means missing the part spent waiting.
  recordingMaxConcurrent: Number(process.env.RECORDING_MAX_CONCURRENT ?? 4),
};
