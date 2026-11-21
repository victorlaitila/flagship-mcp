import type { AuditEntry, Environment, EnvironmentConfig, Flag, FlagWithConfigs, Segment } from '@flagship/shared';
import type { AuditFilter, NewAuditEntry } from '../repositories/audit.js';

/** One change inside a commit. */
export type Write =
  | { type: 'putFlag'; flag: Flag }
  /** Also sets the flag's `updatedAt` to `timestamp`, without touching its other fields. */
  | { type: 'putConfig'; flag: Flag; environment: Environment; config: EnvironmentConfig; timestamp: string }
  | { type: 'putSegment'; segment: Segment }
  | { type: 'deleteSegment'; segment: Segment };

/**
 * Persistence used by the services. Every change is one commit: its writes and one audit entry, all or nothing.
 * The revision is the id of the latest audit entry. A service reads it before its checks and passes it to `commit`,
 * which refuses (409) if anything was committed in between, so checks made on older data never get saved.
 */
export interface Store {
  revision(): Promise<number>;
  getFlag(key: string): Promise<Flag | null>;
  listFlagsWithConfigs(): Promise<FlagWithConfigs[]>;
  getFlagWithConfigs(key: string): Promise<FlagWithConfigs | null>;
  listSegments(): Promise<Segment[]>;
  getSegment(key: string): Promise<Segment | null>;
  listAudit(filter?: AuditFilter): Promise<AuditEntry[]>;
  getAudit(id: number): Promise<AuditEntry | null>;
  /** Applies the writes and appends the audit entry atomically if the revision is unchanged; returns the new audit entry's id. */
  commit(writes: Write[], audit: NewAuditEntry, revision: number): Promise<number>;
}
