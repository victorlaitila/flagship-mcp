// Read-only logical snapshot of a Flagship SQLite database: row count + content hash per table.
// Usage: node db-snapshot.mjs [path]   (default: apps/api/data/flagship.db, relative to the cwd)
// Compares content, not file bytes: SQLite may touch the -shm/-wal files even on read.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const path = process.argv[2] ?? 'apps/api/data/flagship.db';
if (!existsSync(path)) {
  console.log(`no database at ${path}`);
  process.exit(0);
}
const db = new DatabaseSync(path, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
for (const { name } of tables) {
  const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
  console.log(`${name} ${rows.length} ${createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)}`);
}
