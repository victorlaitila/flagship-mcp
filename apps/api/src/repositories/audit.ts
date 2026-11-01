import type { Actor, AuditEntry, AuditOperation, Environment } from '@flagship/shared';
import type { Db } from '../database/db.js';

interface AuditRow {
  id: number;
  timestamp: string;
  actor_id: string;
  actor_name: string;
  actor_role: AuditEntry['actorRole'];
  operation: AuditOperation;
  flag_key: string | null;
  segment_key: string | null;
  environment: Environment | null;
  previous: string | null;
  next: string | null;
  rollback_of: number | null;
}

const toEntry = (row: AuditRow): AuditEntry => ({
  id: row.id,
  timestamp: row.timestamp,
  actorId: row.actor_id,
  actorName: row.actor_name,
  actorRole: row.actor_role,
  operation: row.operation,
  flagKey: row.flag_key,
  segmentKey: row.segment_key,
  environment: row.environment,
  previous: row.previous === null ? null : JSON.parse(row.previous),
  next: row.next === null ? null : JSON.parse(row.next),
  rollbackOf: row.rollback_of,
});

export interface NewAuditEntry {
  timestamp: string;
  actor: Actor;
  operation: AuditOperation;
  flagKey?: string | null;
  segmentKey?: string | null;
  environment?: Environment | null;
  previous: unknown;
  next: unknown;
  rollbackOf?: number | null;
}

export function insertAuditEntry(db: Db, e: NewAuditEntry): number {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO audit_log (timestamp, actor_id, actor_name, actor_role, operation, flag_key, segment_key, environment, previous, next, rollback_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(e.timestamp, e.actor.id, e.actor.name, e.actor.role, e.operation, e.flagKey ?? null, e.segmentKey ?? null,
      e.environment ?? null, e.previous === null ? null : JSON.stringify(e.previous),
      e.next === null ? null : JSON.stringify(e.next), e.rollbackOf ?? null);
  return Number(lastInsertRowid);
}

export interface AuditFilter {
  flagKey?: string;
  environment?: Environment;
  operation?: AuditOperation;
  limit?: number;
}

export function listAuditEntries(db: Db, filter: AuditFilter = {}): AuditEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.flagKey) (where.push('flag_key = ?'), params.push(filter.flagKey));
  if (filter.environment) (where.push('environment = ?'), params.push(filter.environment));
  if (filter.operation) (where.push('operation = ?'), params.push(filter.operation));
  params.push(filter.limit ?? 200);
  const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as unknown as AuditRow[]).map(toEntry);
}

export function getAuditEntry(db: Db, id: number): AuditEntry | null {
  const row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as unknown as AuditRow | undefined;
  return row ? toEntry(row) : null;
}
