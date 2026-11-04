import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  defaultVariantKey,
  ENVIRONMENTS,
  type Actor,
  type AuditOperation,
  type ConfigField,
  type Environment,
  type EnvironmentComparisonRow,
  type EnvironmentConfig,
  type Flag,
  type FlagWithConfigs,
  type PreviewResult,
} from '@flagship/shared';
import { transaction } from '../database/db.js';
import { DEMO_USERS } from '../demo.js';
import { AppError, invalid, notFound } from '../errors.js';
import { evaluateFlag } from '../evaluation/engine.js';
import { insertAuditEntry } from '../repositories/audit.js';
import * as repo from '../repositories/flags.js';
import { listSegments } from '../repositories/segments.js';
import { validateCreateFlag, validateEnvironmentConfig, validateUpdateFlag } from '../validation/validators.js';
import { assertCanManageEnvironment, assertCanManageGlobal, assertProductionConfirmed, type ServiceContext } from './context.js';
import { loadSnapshot } from './evaluation.js';

export function listFlags(ctx: ServiceContext): FlagWithConfigs[] {
  return repo.listFlagsWithConfigs(ctx.db);
}

export function getFlag(ctx: ServiceContext, key: string): FlagWithConfigs {
  const flag = repo.getFlagWithConfigs(ctx.db, key);
  if (!flag) throw notFound(`Flag "${key}"`);
  return flag;
}

function requireFlag(ctx: ServiceContext, key: string): Flag {
  const flag = repo.getFlag(ctx.db, key);
  if (!flag) throw notFound(`Flag "${key}"`);
  return flag;
}

/** New flags start disabled everywhere, so creating one never changes behaviour. */
function initialConfig(flag: Flag): EnvironmentConfig {
  return {
    enabled: false,
    defaultEnabled: flag.type === 'boolean' ? false : null,
    rolloutPercentage: flag.type === 'percentage' ? 0 : null,
    variantWeights: flag.type === 'multivariate'
      ? Object.fromEntries(flag.variants.map((v) => [v.key, v.key === defaultVariantKey(flag) ? 100 : 0]))
      : null,
    rules: [],
    prerequisites: [],
  };
}

export function createFlag(ctx: ServiceContext, actor: Actor, input: unknown): FlagWithConfigs {
  const existing = new Set(repo.listFlags(ctx.db).map((f) => f.key));
  const { value, issues } = validateCreateFlag(input, existing);
  if (!value) throw invalid(issues);
  const timestamp = ctx.now().toISOString();
  const flag: Flag = {
    id: randomUUID(), ...value, variants: value.variants ?? [], status: 'active', createdAt: timestamp, updatedAt: timestamp,
  };
  const auditId = transaction(ctx.db, () => {
    repo.insertFlag(ctx.db, flag);
    for (const env of ENVIRONMENTS) repo.setConfig(ctx.db, flag.id, env, initialConfig(flag), timestamp);
    return insertAuditEntry(ctx.db, { timestamp, actor, operation: 'flag.created', flagKey: flag.key, previous: null, next: flag });
  });
  ctx.notifier.publish({ entity: 'flag', flagKey: flag.key, auditId });
  return getFlag(ctx, flag.key);
}

export function updateFlag(ctx: ServiceContext, actor: Actor, key: string, input: unknown): FlagWithConfigs {
  const flag = requireFlag(ctx, key);
  const { value, issues } = validateUpdateFlag(input);
  if (!value) throw invalid(issues);
  const next: Flag = { ...flag, ...value, updatedAt: ctx.now().toISOString() };
  const auditId = transaction(ctx.db, () => {
    repo.updateFlag(ctx.db, next);
    return insertAuditEntry(ctx.db, { timestamp: next.updatedAt, actor, operation: 'flag.updated', flagKey: key, previous: flag, next });
  });
  ctx.notifier.publish({ entity: 'flag', flagKey: key, auditId });
  return getFlag(ctx, key);
}

export function setFlagStatus(ctx: ServiceContext, actor: Actor, key: string, status: Flag['status']): FlagWithConfigs {
  assertCanManageGlobal(actor, status === 'archived' ? 'archive flags' : 'restore flags');
  const flag = requireFlag(ctx, key);
  if (flag.status === status) return getFlag(ctx, key);
  if (status === 'archived') {
    const dependents = repo.listFlagsWithConfigs(ctx.db).flatMap((f) =>
      f.status === 'active'
        ? ENVIRONMENTS.filter((env) => f.environments[env].prerequisites.includes(key)).map((env) => `${f.key} (${env})`)
        : [],
    );
    if (dependents.length > 0) {
      throw new AppError('CONFLICT', `Cannot archive "${key}": it is a prerequisite of ${dependents.join(', ')}.`, undefined, { dependents });
    }
  }
  const next: Flag = { ...flag, status, updatedAt: ctx.now().toISOString() };
  const auditId = transaction(ctx.db, () => {
    repo.updateFlag(ctx.db, next);
    return insertAuditEntry(ctx.db, {
      timestamp: next.updatedAt, actor, operation: status === 'archived' ? 'flag.archived' : 'flag.restored',
      flagKey: key, previous: flag, next,
    });
  });
  ctx.notifier.publish({ entity: 'flag', flagKey: key, auditId });
  return getFlag(ctx, key);
}

export function getConfig(ctx: ServiceContext, key: string, environment: Environment): EnvironmentConfig {
  return repo.getConfig(ctx.db, requireFlag(ctx, key).id, environment);
}

function validateAgainstCurrentState(ctx: ServiceContext, flag: Flag, environment: Environment, input: unknown) {
  const flags = repo.listFlagsWithConfigs(ctx.db);
  return validateEnvironmentConfig(input, {
    flag,
    flags: new Map(flags.map((f) => [f.key, f])),
    prerequisitesByFlag: new Map(flags.map((f) => [f.key, f.environments[environment].prerequisites])),
    segmentKeys: new Set(listSegments(ctx.db).map((s) => s.key)),
  });
}

export interface AppliedConfig {
  config: EnvironmentConfig;
  /** Null when the config was unchanged and nothing was written. */
  auditId: number | null;
}

export interface ApplyOptions {
  operation?: Extract<AuditOperation, 'config.updated' | 'config.rolled_back'>;
  rollbackOf?: number | null;
  /** Optimistic concurrency: reject with CONFLICT unless the stored config still equals this. */
  expectedConfig?: unknown;
}

/** Validates and persists a config, writing an audit entry. Shared by updates and rollbacks. */
export function applyConfig(
  ctx: ServiceContext,
  actor: Actor,
  flagKey: string,
  environment: Environment,
  input: unknown,
  confirmProduction: unknown,
  { operation = 'config.updated', rollbackOf = null, expectedConfig }: ApplyOptions = {},
): AppliedConfig {
  const flag = requireFlag(ctx, flagKey);
  assertCanManageEnvironment(actor, environment);
  assertProductionConfirmed(environment, confirmProduction);
  const { value, issues } = validateAgainstCurrentState(ctx, flag, environment, input);
  if (!value) throw invalid(issues, 'Configuration is invalid.');
  const previous = repo.getConfig(ctx.db, flag.id, environment);
  if (expectedConfig !== undefined && !isDeepStrictEqual(previous, expectedConfig)) {
    throw new AppError('CONFLICT', 'The configuration has changed since this proposal was made. Review the current configuration and try again.', undefined, { current: previous });
  }
  if (JSON.stringify(previous) === JSON.stringify(value)) return { config: previous, auditId: null };

  const timestamp = ctx.now().toISOString();
  const auditId = transaction(ctx.db, () => {
    repo.setConfig(ctx.db, flag.id, environment, value, timestamp);
    repo.touchFlag(ctx.db, flag.id, timestamp);
    return insertAuditEntry(ctx.db, { timestamp, actor, operation, flagKey, environment, previous, next: value, rollbackOf });
  });
  ctx.notifier.publish({ entity: 'config', flagKey, environment, auditId });
  return { config: value, auditId };
}

/** Validates a proposed config and evaluates it for demo users without persisting anything. */
export function previewConfig(ctx: ServiceContext, flagKey: string, environment: Environment, input: unknown, userIds?: unknown): PreviewResult {
  const flag = requireFlag(ctx, flagKey);
  const users = Array.isArray(userIds) && userIds.length > 0
    ? DEMO_USERS.filter((u) => userIds.includes(u.userId))
    : DEMO_USERS;
  const { value, issues } = validateAgainstCurrentState(ctx, flag, environment, input);
  const current = loadSnapshot(ctx.db);
  const proposed = value
    ? { ...current, configs: new Map(current.configs).set(flagKey, { ...current.configs.get(flagKey)!, [environment]: value }) }
    : null;
  const results = users.map((user) => {
    const before = evaluateFlag(current, flagKey, environment, user)!;
    const after = proposed ? evaluateFlag(proposed, flagKey, environment, user)! : null;
    const changed = after !== null && (after.enabled !== before.enabled || after.variant !== before.variant);
    return { user, current: before, proposed: after, changed };
  });
  return { valid: value !== null, issues, config: value, results };
}

const FIELD_SELECTORS: Record<ConfigField, (c: EnvironmentConfig) => unknown> = {
  enabled: (c) => c.enabled,
  default: (c) => c.defaultEnabled,
  rollout: (c) => c.rolloutPercentage,
  variants: (c) => c.variantWeights,
  rules: (c) => c.rules,
  prerequisites: (c) => [...c.prerequisites].sort(),
};

export function compareEnvironments(ctx: ServiceContext, environments: readonly Environment[] = ENVIRONMENTS): EnvironmentComparisonRow[] {
  return listFlags(ctx).map((flag) => ({
    flag,
    differences: (Object.keys(FIELD_SELECTORS) as ConfigField[]).filter((field) => {
      const values = environments.map((env) => JSON.stringify(FIELD_SELECTORS[field](flag.environments[env])));
      return new Set(values).size > 1;
    }),
  }));
}
