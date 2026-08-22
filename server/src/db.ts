import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { env } from "./env.js";
import type { Platform } from "./platforms/types.js";

export interface CreatorRow {
  id: string;
  platform: Platform;
  platform_id: string;
  handle: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  auto_record: 0 | 1;
}

// "stalled" is distinct from "failed": the recording process didn't error
// out, it just stopped making progress (our own pipeline hanging, or not
// noticing the stream ended) — see recorder.ts's stall watcher. Kept
// separate from "completed" so it's obviously distinguishable in the UI,
// since a stalled recording is likely truncated/incomplete even though a
// file does exist for it.
export type RecordingStatus = "recording" | "completed" | "stalled" | "failed";

export interface RecordingRow {
  id: string;
  creator_id: string;
  platform: Platform;
  display_name: string;
  title: string | null;
  thumbnail_file_name: string | null;
  file_name: string;
  status: RecordingStatus;
  started_at: string;
  ended_at: string | null;
  file_size_bytes: number | null;
  error: string | null;
}

const dbPath = path.join(env.dataDir, "multiview.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(platform, platform_id)
  );
`);

// ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, and this runs on
// every startup (same as the CREATE TABLE IF NOT EXISTS above) — so check
// first rather than let it fail on every run after the first.
const creatorColumns = db.prepare(`PRAGMA table_info(creators)`).all() as { name: string }[];
if (!creatorColumns.some((c) => c.name === "auto_record")) {
  db.exec(`ALTER TABLE creators ADD COLUMN auto_record INTEGER NOT NULL DEFAULT 0;`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    display_name TEXT NOT NULL,
    title TEXT,
    thumbnail_file_name TEXT,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    file_size_bytes INTEGER,
    error TEXT
  );
`);

// Same reasoning as the auto_record migration above — this table's shape
// grew after it was first written (title/thumbnail_file_name came later),
// and CREATE TABLE IF NOT EXISTS only applies to a table that doesn't
// exist yet at all, not to adding columns to one that already does.
const recordingColumns = db.prepare(`PRAGMA table_info(recordings)`).all() as { name: string }[];
for (const column of ["title", "thumbnail_file_name"]) {
  if (!recordingColumns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE recordings ADD COLUMN ${column} TEXT;`);
  }
}

const insertCreatorStmt = db.prepare(
  `INSERT INTO creators (id, platform, platform_id, handle, display_name, avatar_url, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const listCreatorsStmt = db.prepare(`SELECT * FROM creators ORDER BY created_at ASC`);
const getCreatorStmt = db.prepare(`SELECT * FROM creators WHERE id = ?`);
const deleteCreatorStmt = db.prepare(`DELETE FROM creators WHERE id = ?`);
const findByPlatformStmt = db.prepare(
  `SELECT * FROM creators WHERE platform = ? AND platform_id = ?`
);
const setAutoRecordStmt = db.prepare(`UPDATE creators SET auto_record = ? WHERE id = ?`);

const insertRecordingStmt = db.prepare(
  `INSERT INTO recordings (id, creator_id, platform, display_name, title, thumbnail_file_name, file_name, status, started_at, ended_at, file_size_bytes, error)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
);
const listRecordingsStmt = db.prepare(`SELECT * FROM recordings ORDER BY started_at DESC`);
const getRecordingStmt = db.prepare(`SELECT * FROM recordings WHERE id = ?`);
const finishRecordingStmt = db.prepare(
  `UPDATE recordings SET status = ?, ended_at = ?, file_name = ?, file_size_bytes = ?, error = ? WHERE id = ?`
);
const deleteRecordingStmt = db.prepare(`DELETE FROM recordings WHERE id = ?`);

export const statements = {
  insertCreator: {
    // auto_record is deliberately excluded — it's not part of the INSERT
    // statement at all, new creators always start with the column DEFAULT (0).
    run: (row: Omit<CreatorRow, "auto_record">) =>
      insertCreatorStmt.run(
        row.id,
        row.platform,
        row.platform_id,
        row.handle,
        row.display_name,
        row.avatar_url,
        row.created_at
      ),
  },
  listCreators: {
    all: () => listCreatorsStmt.all() as unknown as CreatorRow[],
  },
  getCreator: {
    get: (id: string) => getCreatorStmt.get(id) as unknown as CreatorRow | undefined,
  },
  deleteCreator: {
    run: (id: string) => deleteCreatorStmt.run(id),
  },
  findByPlatform: {
    get: (platform: string, platformId: string) =>
      findByPlatformStmt.get(platform, platformId) as unknown as CreatorRow | undefined,
  },
  setAutoRecord: {
    run: (id: string, autoRecord: boolean) => setAutoRecordStmt.run(autoRecord ? 1 : 0, id),
  },
  insertRecording: {
    run: (
      row: Pick<
        RecordingRow,
        "id" | "creator_id" | "platform" | "display_name" | "title" | "thumbnail_file_name" | "file_name" | "status" | "started_at"
      >
    ) =>
      insertRecordingStmt.run(
        row.id,
        row.creator_id,
        row.platform,
        row.display_name,
        row.title,
        row.thumbnail_file_name,
        row.file_name,
        row.status,
        row.started_at
      ),
  },
  listRecordings: {
    all: () => listRecordingsStmt.all() as unknown as RecordingRow[],
  },
  getRecording: {
    get: (id: string) => getRecordingStmt.get(id) as unknown as RecordingRow | undefined,
  },
  finishRecording: {
    run: (
      id: string,
      status: RecordingStatus,
      endedAt: string,
      fileName: string,
      fileSizeBytes: number | null,
      error: string | null
    ) => finishRecordingStmt.run(status, endedAt, fileName, fileSizeBytes, error, id),
  },
  deleteRecording: {
    run: (id: string) => deleteRecordingStmt.run(id),
  },
};

export function listCreators(): CreatorRow[] {
  return statements.listCreators.all();
}
