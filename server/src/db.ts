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

export const statements = {
  insertCreator: {
    run: (row: CreatorRow) =>
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
};

export function listCreators(): CreatorRow[] {
  return statements.listCreators.all();
}
