import type { AuditEntry, Environment, EnvironmentConfig, Flag, FlagWithConfigs, Segment } from '@flagship/shared';
import type { AuditFilter, NewAuditEntry } from '../repositories/audit.js';

/** One change inside a commit. */
export type Write =
  | { type: 'putFlag'; flag: Flag }
  /** Also sets the flag's `updatedAt` to `timestamp`, without touching its other fields. */
  | { type: 'putConfig'; flag: Flag; environment: Environment; config: EnvironmentConfig; timestamp: string }
  | { type: 'putSegment'; segment: Segment }
  | { type: 'deleteSegment'; segment: Segment };

/** Persistence used by the services. Every change is one commit: its writes and one audit entry, all or nothing. */
export interface Store {
  getFlag(key: string): Promise<Flag | null>;
  listFlagsWithConfigs(): Promise<FlagWithConfigs[]>;
  getFlagWithConfigs(key: string): Promise<FlagWithConfigs | null>;
  listSegments(): Promise<Segment[]>;
  getSegment(key: string): Promise<Segment | null>;
  listAudit(filter?: AuditFilter): Promise<AuditEntry[]>;
  getAudit(id: number): Promise<AuditEntry | null>;
  /** Applies the writes and appends the audit entry atomically; returns the new audit entry's id. */
  commit(writes: Write[], audit: NewAuditEntry): Promise<number>;
}
