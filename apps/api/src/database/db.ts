import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('boolean', 'percentage', 'multivariate')),
  owner TEXT NOT NULL,
  tags TEXT NOT NULL,          -- JSON string[]
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  variants TEXT NOT NULL,      -- JSON Variant[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flag_environments (
  flag_id TEXT NOT NULL REFERENCES flags(id),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  config TEXT NOT NULL,        -- JSON EnvironmentConfig
  updated_at TEXT NOT NULL,
  PRIMARY KEY (flag_id, environment)
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  conditions TEXT NOT NULL,    -- JSON Condition[]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  operation TEXT NOT NULL,
  flag_key TEXT,
  segment_key TEXT,
  environment TEXT,
  previous TEXT,               -- JSON
  next TEXT,                   -- JSON
  rollback_of INTEGER REFERENCES audit_log(id)
);
CREATE INDEX IF NOT EXISTS audit_log_flag ON audit_log(flag_key);
`;

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
