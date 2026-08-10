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

export const env = {
  port: Number(process.env.PORT || 8080),
  dataDir: resolveDataDir(),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
  twitchClientId: process.env.TWITCH_CLIENT_ID || "",
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET || "",
  twitchEmbedParent: process.env.TWITCH_EMBED_PARENT || "localhost",
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || 90),
};
