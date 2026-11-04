import { AUDIT_OPERATIONS, type Actor, type AuditEntry, type AuditOperation, type EnvironmentConfig } from '@flagship/shared';
import { AppError, notFound } from '../errors.js';
import { getFlagWithConfigs } from '../repositories/flags.js';
import { getAuditEntry, listAuditEntries, type AuditFilter } from '../repositories/audit.js';
import type { ServiceContext } from './context.js';
import { parseEnvironment } from './evaluation.js';
import { applyConfig, type AppliedConfig } from './flags.js';

export function listAudit(ctx: ServiceContext, query: Record<string, unknown>): AuditEntry[] {
  const filter: AuditFilter = {};
  if (typeof query.flagKey === 'string' && query.flagKey) filter.flagKey = query.flagKey;
  if (typeof query.actorId === 'string' && query.actorId) filter.actorId = query.actorId;
  if (query.environment) filter.environment = parseEnvironment(query.environment);
  if (query.operation) {
    if (!AUDIT_OPERATIONS.includes(query.operation as AuditOperation)) {
      throw new AppError('BAD_REQUEST', `Unknown operation "${String(query.operation)}".`);
    }
    filter.operation = query.operation as AuditOperation;
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new AppError('BAD_REQUEST', 'limit must be 1–1000.');
    filter.limit = limit;
  }
  return listAuditEntries(ctx.db, filter);
}

export function getAudit(ctx: ServiceContext, id: number): AuditEntry {
  const entry = getAuditEntry(ctx.db, id);
  if (!entry) throw notFound(`Audit entry ${id}`);
  return entry;
}

/**
 * Restores the configuration that was in place before the given change, as a new
 * `config.rolled_back` entry. History is never modified. The restored config is
 * re-validated against the current state (e.g. a prerequisite may since have been archived).
 */
export function rollback(ctx: ServiceContext, actor: Actor, auditId: number, confirmProduction: unknown, expectedConfig?: unknown): AppliedConfig {
  const entry = getAuditEntry(ctx.db, auditId);
  if (!entry) throw notFound(`Audit entry ${auditId}`);
  if ((entry.operation !== 'config.updated' && entry.operation !== 'config.rolled_back') || !entry.flagKey || !entry.environment) {
    throw new AppError('BAD_REQUEST', 'Only configuration changes can be rolled back.');
  }
  const flag = getFlagWithConfigs(ctx.db, entry.flagKey);
  if (!flag) throw notFound(`Flag "${entry.flagKey}"`);
  if (JSON.stringify(flag.environments[entry.environment]) === JSON.stringify(entry.previous)) {
    throw new AppError('CONFLICT', 'The current configuration already matches the state before this change.');
  }
  return applyConfig(ctx, actor, entry.flagKey, entry.environment, entry.previous as EnvironmentConfig,
    confirmProduction, { operation: 'config.rolled_back', rollbackOf: entry.id, expectedConfig });
}
