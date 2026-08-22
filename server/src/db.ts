import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { nanoid } from "nanoid";
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
  /** One-shot — "record the next time they go live", not "always" (auto_record) —
   * consumed (cleared) the moment that recording actually starts. See poller.ts. */
  record_next: 0 | 1;
}

// "stalled" is distinct from "failed": the recording process didn't error
// out, it just stopped making progress (our own pipeline hanging, or not
// noticing the stream ended) — see recorder.ts's stall watcher. Kept
// separate from "completed" so it's obviously distinguishable in the UI,
// since a stalled recording is likely truncated/incomplete even though a
// file does exist for it. "low-disk" is the same idea for the other
// automatic-stop reason — free space dropped below RECORDING_MIN_FREE_GB
// mid-recording — kept distinct from "stalled" so the UI/logs say why it
// actually stopped rather than a misleading "no progress detected".
export type RecordingStatus = "recording" | "completed" | "stalled" | "low-disk" | "failed";

export interface RecordingRow {
  id: string;
  /** Empty string means this recording isn't tied to a tracked creator at
   * all — a manual "download any URL" recording (Phase 5), rather than one
   * captured from a creator going live. A real id otherwise. Deliberately
   * a sentinel rather than a nullable column: creator ids are always
   * non-empty nanoid()s, so "" can never collide with a real one, and it
   * avoids a NOT NULL-loosening migration (SQLite can't ALTER a column's
   * constraint without a full table rebuild). */
  creator_id: string;
  /** A creator-tied recording always matches Platform (it came from
   * creator.platform). A manual download can come from *any* site yt-dlp
   * recognizes, so this is deliberately looser than CreatorRow.platform —
   * see recorder.ts's downloadVideo/platformFromExtractor. Purely a
   * display label at that point, not something routed through a live
   * platform adapter. */
  platform: string;
  display_name: string;
  title: string | null;
  thumbnail_file_name: string | null;
  file_name: string;
  status: RecordingStatus;
  started_at: string;
  ended_at: string | null;
  file_size_bytes: number | null;
  error: string | null;
  /** Where file_name/thumbnail_file_name actually live right now — "local"
   * for the whole lifetime of an in-progress recording (yt-dlp/ffmpeg only
   * ever write to local disk), flipped to "s3" after finishRecording's S3
   * offload succeeds and the local copies are deleted. See recorder.ts and
   * recordings/s3.ts. */
  storage_location: "local" | "s3";
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
for (const column of ["auto_record", "record_next"]) {
  if (!creatorColumns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE creators ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0;`);
  }
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
if (!recordingColumns.some((c) => c.name === "storage_location")) {
  db.exec(`ALTER TABLE recordings ADD COLUMN storage_location TEXT NOT NULL DEFAULT 'local';`);
}

// Phase 4: tagging. A real many-to-many (not a comma-joined column on
// recordings) so a tag has one canonical identity regardless of casing
// (COLLATE NOCASE on the unique constraint — "ASMR" and "asmr" are the same
// tag) and multiple recordings can share it without duplicating the text.
// No FOREIGN KEY constraints, matching the rest of this schema's style
// (e.g. recordings.creator_id already outlives a deleted creator by
// design) — cleanup on delete is handled explicitly in code instead (see
// deleteAllForRecording, called from recorder.ts's deleteRecording).
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS recording_tags (
    recording_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (recording_id, tag_id)
  );
`);

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
const setRecordNextStmt = db.prepare(`UPDATE creators SET record_next = ? WHERE id = ?`);

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
const setStorageLocationStmt = db.prepare(`UPDATE recordings SET storage_location = ? WHERE id = ?`);

const insertTagStmt = db.prepare(`INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)`);
const findTagByNameStmt = db.prepare(`SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE`);
const addRecordingTagStmt = db.prepare(`INSERT OR IGNORE INTO recording_tags (recording_id, tag_id) VALUES (?, ?)`);
const removeRecordingTagStmt = db.prepare(
  `DELETE FROM recording_tags WHERE recording_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)`
);
const deleteRecordingTagsForRecordingStmt = db.prepare(`DELETE FROM recording_tags WHERE recording_id = ?`);
const listAllRecordingTagsStmt = db.prepare(
  `SELECT rt.recording_id AS recording_id, t.name AS name
   FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id
   ORDER BY t.name COLLATE NOCASE ASC`
);

/** Resolves a tag name to its canonical row id, creating it if this exact
 * name (case-insensitively) hasn't been seen before. Not exposed directly —
 * only ever used internally by statements.tags.addToRecording, since a
 * caller never has a legitimate reason to just create an unattached tag. */
function getOrCreateTagId(name: string): string {
  const trimmed = name.trim();
  insertTagStmt.run(nanoid(), trimmed); // no-op (IGNORE) if this name already exists, case-insensitively
  const row = findTagByNameStmt.get(trimmed) as { id: string; name: string } | undefined;
  return row!.id; // guaranteed to exist now, either just-inserted or pre-existing
}

export const statements = {
  insertCreator: {
    // auto_record/record_next are deliberately excluded — neither is part
    // of the INSERT statement, new creators always start with the column
    // DEFAULT (0) for both.
    run: (row: Omit<CreatorRow, "auto_record" | "record_next">) =>
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
  setRecordNext: {
    run: (id: string, recordNext: boolean) => setRecordNextStmt.run(recordNext ? 1 : 0, id),
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
  setStorageLocation: {
    run: (id: string, location: "local" | "s3") => setStorageLocationStmt.run(location, id),
  },
  tags: {
    /** Idempotent — adding a tag a recording already has (even in
     * different casing) is a no-op, not an error. */
    addToRecording: (recordingId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      addRecordingTagStmt.run(recordingId, getOrCreateTagId(trimmed));
    },
    removeFromRecording: (recordingId: string, name: string) => {
      removeRecordingTagStmt.run(recordingId, name.trim());
    },
    deleteAllForRecording: (recordingId: string) => {
      deleteRecordingTagsForRecordingStmt.run(recordingId);
    },
    /** Every recording->tag-name pair in the whole database, in one query
     * — grouped client-side (recorder.ts's listRecordings) rather than one
     * query per recording. Fine at this app's scale, and avoids an N+1
     * that would only get worse as recordings accumulate. */
    listAllByRecording: (): Map<string, string[]> => {
      const rows = listAllRecordingTagsStmt.all() as { recording_id: string; name: string }[];
      const map = new Map<string, string[]>();
      for (const r of rows) {
        const list = map.get(r.recording_id) ?? [];
        list.push(r.name);
        map.set(r.recording_id, list);
      }
      return map;
    },
  },
};

export function listCreators(): CreatorRow[] {
  return statements.listCreators.all();
}
