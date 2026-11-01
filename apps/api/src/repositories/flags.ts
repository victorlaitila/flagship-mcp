import { ENVIRONMENTS, type Environment, type EnvironmentConfig, type Flag, type FlagWithConfigs } from '@flagship/shared';
import type { Db } from '../database/db.js';

interface FlagRow {
  id: string;
  key: string;
  name: string;
  description: string;
  type: Flag['type'];
  owner: string;
  tags: string;
  status: Flag['status'];
  variants: string;
  created_at: string;
  updated_at: string;
}

const toFlag = (row: FlagRow): Flag => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  type: row.type,
  owner: row.owner,
  tags: JSON.parse(row.tags),
  status: row.status,
  variants: JSON.parse(row.variants),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function listFlags(db: Db): Flag[] {
  return (db.prepare('SELECT * FROM flags ORDER BY key').all() as unknown as FlagRow[]).map(toFlag);
}

export function getFlag(db: Db, key: string): Flag | null {
  const row = db.prepare('SELECT * FROM flags WHERE key = ?').get(key) as unknown as FlagRow | undefined;
  return row ? toFlag(row) : null;
}

export function insertFlag(db: Db, flag: Flag): void {
  db.prepare(
    `INSERT INTO flags (id, key, name, description, type, owner, tags, status, variants, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(flag.id, flag.key, flag.name, flag.description, flag.type, flag.owner, JSON.stringify(flag.tags),
    flag.status, JSON.stringify(flag.variants), flag.createdAt, flag.updatedAt);
}

export function updateFlag(db: Db, flag: Flag): void {
  db.prepare(
    `UPDATE flags SET name = ?, description = ?, owner = ?, tags = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(flag.name, flag.description, flag.owner, JSON.stringify(flag.tags), flag.status, flag.updatedAt, flag.id);
}

export function touchFlag(db: Db, flagId: string, timestamp: string): void {
  db.prepare('UPDATE flags SET updated_at = ? WHERE id = ?').run(timestamp, flagId);
}

/** Configs for all flags, keyed by flag key. */
export function listConfigs(db: Db): Map<string, Record<Environment, EnvironmentConfig>> {
  const rows = db
    .prepare('SELECT f.key, e.environment, e.config FROM flag_environments e JOIN flags f ON f.id = e.flag_id')
    .all() as unknown as { key: string; environment: Environment; config: string }[];
  const map = new Map<string, Record<Environment, EnvironmentConfig>>();
  for (const row of rows) {
    const configs = map.get(row.key) ?? ({} as Record<Environment, EnvironmentConfig>);
    configs[row.environment] = JSON.parse(row.config);
    map.set(row.key, configs);
  }
  return map;
}

export function getConfig(db: Db, flagId: string, environment: Environment): EnvironmentConfig {
  const row = db
    .prepare('SELECT config FROM flag_environments WHERE flag_id = ? AND environment = ?')
    .get(flagId, environment) as { config: string } | undefined;
  if (!row) throw new Error(`Missing ${environment} config for flag ${flagId}`);
  return JSON.parse(row.config);
}

export function setConfig(db: Db, flagId: string, environment: Environment, config: EnvironmentConfig, timestamp: string): void {
  db.prepare(
    `INSERT INTO flag_environments (flag_id, environment, config, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (flag_id, environment) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
  ).run(flagId, environment, JSON.stringify(config), timestamp);
}

export function listFlagsWithConfigs(db: Db): FlagWithConfigs[] {
  const configs = listConfigs(db);
  return listFlags(db).map((flag) => ({ ...flag, environments: configs.get(flag.key)! }));
}

export function getFlagWithConfigs(db: Db, key: string): FlagWithConfigs | null {
  const flag = getFlag(db, key);
  if (!flag) return null;
  const environments = Object.fromEntries(
    ENVIRONMENTS.map((env) => [env, getConfig(db, flag.id, env)]),
  ) as Record<Environment, EnvironmentConfig>;
  return { ...flag, environments };
}
