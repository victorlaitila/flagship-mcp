import { AUDIT_OPERATIONS, type Actor, type AuditEntry, type AuditOperation, type EnvironmentConfig } from '@flagship/shared';
import { AppError, notFound } from '../errors.js';
import type { AuditFilter } from '../repositories/audit.js';
import { LIMITS } from '../validation/validators.js';
import type { ServiceContext } from './context.js';
import { parseEnvironment } from './evaluation.js';
import { applyConfig, type AppliedConfig } from './flags.js';

export async function listAudit(ctx: ServiceContext, query: Record<string, unknown>): Promise<AuditEntry[]> {
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
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.auditEntries) {
      throw new AppError('BAD_REQUEST', `limit must be 1–${LIMITS.auditEntries}.`);
    }
    filter.limit = limit;
  }
  return ctx.store.listAudit(filter);
}

export async function getAudit(ctx: ServiceContext, id: number): Promise<AuditEntry> {
  const entry = await ctx.store.getAudit(id);
  if (!entry) throw notFound(`Audit entry ${id}`);
  return entry;
}

/**
 * Restores the configuration that was in place before the given change, as a new
 * `config.rolled_back` entry. History is never modified. The restored config is
 * re-validated against the current state (e.g. a prerequisite may since have been archived).
 */
export async function rollback(ctx: ServiceContext, actor: Actor, auditId: number, confirmProduction: unknown, expectedConfig?: unknown): Promise<AppliedConfig> {
  const entry = await ctx.store.getAudit(auditId);
  if (!entry) throw notFound(`Audit entry ${auditId}`);
  if ((entry.operation !== 'config.updated' && entry.operation !== 'config.rolled_back') || !entry.flagKey || !entry.environment) {
    throw new AppError('BAD_REQUEST', 'Only configuration changes can be rolled back.');
  }
  const flag = await ctx.store.getFlagWithConfigs(entry.flagKey);
  if (!flag) throw notFound(`Flag "${entry.flagKey}"`);
  if (JSON.stringify(flag.environments[entry.environment]) === JSON.stringify(entry.previous)) {
    throw new AppError('CONFLICT', 'The current configuration already matches the state before this change.');
  }
  return applyConfig(ctx, actor, entry.flagKey, entry.environment, entry.previous as EnvironmentConfig,
    confirmProduction, { operation: 'config.rolled_back', rollbackOf: entry.id, expectedConfig });
}
