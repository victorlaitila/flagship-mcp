import type { Segment } from '@flagship/shared';
import type { Db } from '../database/db.js';

interface SegmentRow {
  id: string;
  key: string;
  name: string;
  description: string;
  conditions: string;
  created_at: string;
  updated_at: string;
}

const toSegment = (row: SegmentRow): Segment => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  conditions: JSON.parse(row.conditions),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function listSegments(db: Db): Segment[] {
  return (db.prepare('SELECT * FROM segments ORDER BY name').all() as unknown as SegmentRow[]).map(toSegment);
}

export function getSegment(db: Db, key: string): Segment | null {
  const row = db.prepare('SELECT * FROM segments WHERE key = ?').get(key) as unknown as SegmentRow | undefined;
  return row ? toSegment(row) : null;
}

export function upsertSegment(db: Db, s: Segment): void {
  db.prepare(
    `INSERT INTO segments (id, key, name, description, conditions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
       conditions = excluded.conditions, updated_at = excluded.updated_at`,
  ).run(s.id, s.key, s.name, s.description, JSON.stringify(s.conditions), s.createdAt, s.updatedAt);
}

export function deleteSegment(db: Db, id: string): void {
  db.prepare('DELETE FROM segments WHERE id = ?').run(id);
}
