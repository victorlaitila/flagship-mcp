import { changedMeanwhile } from '../errors.js';
import { getAuditEntry, insertAuditEntry, latestAuditId, listAuditEntries, type AuditFilter, type NewAuditEntry } from '../repositories/audit.js';
import * as flags from '../repositories/flags.js';
import * as segments from '../repositories/segments.js';
import { transaction, type Db } from './db.js';
import type { Store, Write } from './store.js';

/**
 * SQLite-backed store. Its methods never wait on real I/O, so HTTP requests never interleave between a service's
 * reads and its commit; the revision check only refuses calls started together in the same tick.
 */
export class SqliteStore implements Store {
  constructor(readonly db: Db) {}

  async revision() {
    return latestAuditId(this.db);
  }

  async getFlag(key: string) {
    return flags.getFlag(this.db, key);
  }

  async listFlagsWithConfigs() {
    return flags.listFlagsWithConfigs(this.db);
  }

  async getFlagWithConfigs(key: string) {
    return flags.getFlagWithConfigs(this.db, key);
  }

  async listSegments() {
    return segments.listSegments(this.db);
  }

  async getSegment(key: string) {
    return segments.getSegment(this.db, key);
  }

  async listAudit(filter?: AuditFilter) {
    return listAuditEntries(this.db, filter);
  }

  async getAudit(id: number) {
    return getAuditEntry(this.db, id);
  }

  async commit(writes: Write[], audit: NewAuditEntry, revision: number) {
    return transaction(this.db, () => {
      if (latestAuditId(this.db) !== revision) throw changedMeanwhile();
      for (const write of writes) {
        switch (write.type) {
          case 'putFlag':
            flags.upsertFlag(this.db, write.flag);
            break;
          case 'putConfig':
            flags.setConfig(this.db, write.flag.id, write.environment, write.config, write.timestamp);
            flags.touchFlag(this.db, write.flag.id, write.timestamp);
            break;
          case 'putSegment':
            segments.upsertSegment(this.db, write.segment);
            break;
          case 'deleteSegment':
            segments.deleteSegment(this.db, write.segment.id);
            break;
        }
      }
      return insertAuditEntry(this.db, audit);
    });
  }
}
