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
import { DEMO_USERS } from '../demo.js';
import { AppError, invalid, notFound } from '../errors.js';
import { evaluateFlag } from '../evaluation/engine.js';
import { validateCreateFlag, validateEnvironmentConfig, validateUpdateFlag } from '../validation/validators.js';
import { assertCanManageEnvironment, assertCanManageGlobal, assertProductionConfirmed, assertProductionWritable, type ServiceContext } from './context.js';
import { loadSnapshot } from './evaluation.js';

export function listFlags(ctx: ServiceContext): Promise<FlagWithConfigs[]> {
  return ctx.store.listFlagsWithConfigs();
}

export async function getFlag(ctx: ServiceContext, key: string): Promise<FlagWithConfigs> {
  const flag = await ctx.store.getFlagWithConfigs(key);
  if (!flag) throw notFound(`Flag "${key}"`);
  return flag;
}

async function requireFlag(ctx: ServiceContext, key: string): Promise<Flag> {
  const flag = await ctx.store.getFlag(key);
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

export async function createFlag(ctx: ServiceContext, actor: Actor, input: unknown): Promise<FlagWithConfigs> {
  const existing = new Set((await listFlags(ctx)).map((f) => f.key));
  const { value, issues } = validateCreateFlag(input, existing);
  if (!value) throw invalid(issues);
  const timestamp = ctx.now().toISOString();
  const flag: Flag = {
    id: randomUUID(), ...value, variants: value.variants ?? [], status: 'active', createdAt: timestamp, updatedAt: timestamp,
  };
  const auditId = await ctx.store.commit(
    [
      { type: 'putFlag', flag },
      ...ENVIRONMENTS.map((environment) => ({ type: 'putConfig' as const, flag, environment, config: initialConfig(flag), timestamp })),
    ],
    { timestamp, actor, operation: 'flag.created', flagKey: flag.key, previous: null, next: flag },
  );
  ctx.notifier.publish({ entity: 'flag', flagKey: flag.key, auditId });
  return getFlag(ctx, flag.key);
}

export async function updateFlag(ctx: ServiceContext, actor: Actor, key: string, input: unknown): Promise<FlagWithConfigs> {
  const flag = await requireFlag(ctx, key);
  const { value, issues } = validateUpdateFlag(input);
  if (!value) throw invalid(issues);
  // An unchanged save writes nothing, as for configs.
  if (Object.entries(value).every(([field, v]) => isDeepStrictEqual(flag[field as keyof Flag], v))) return getFlag(ctx, key);
  const next: Flag = { ...flag, ...value, updatedAt: ctx.now().toISOString() };
  const auditId = await ctx.store.commit([{ type: 'putFlag', flag: next }],
    { timestamp: next.updatedAt, actor, operation: 'flag.updated', flagKey: key, previous: flag, next });
  ctx.notifier.publish({ entity: 'flag', flagKey: key, auditId });
  return getFlag(ctx, key);
}

export async function setFlagStatus(
  ctx: ServiceContext,
  actor: Actor,
  key: string,
  status: Flag['status'],
  confirmProduction?: unknown,
): Promise<FlagWithConfigs> {
  assertCanManageGlobal(actor, status === 'archived' ? 'archive flags' : 'restore flags');
  const flag = await requireFlag(ctx, key);
  if (flag.status === status) return getFlag(ctx, key);
  const flags = await listFlags(ctx);
  const configs = flags.find((f) => f.key === key)!.environments;
  if (status === 'active') {
    const archived = [...new Set(ENVIRONMENTS.flatMap((env) => configs[env].prerequisites))]
      .filter((prerequisite) => flags.find((f) => f.key === prerequisite)?.status === 'archived');
    if (archived.length > 0) {
      throw new AppError('CONFLICT', `Cannot restore "${key}": it requires ${archived.join(', ')}, which ${archived.length > 1 ? 'are' : 'is'} archived.`, undefined, { archived });
    }
  }
  if (status === 'archived') {
    const dependents = flags.flatMap((f) =>
      f.status === 'active'
        ? ENVIRONMENTS.filter((env) => f.environments[env].prerequisites.includes(key)).map((env) => `${f.key} (${env})`)
        : [],
    );
    if (dependents.length > 0) {
      throw new AppError('CONFLICT', `Cannot archive "${key}": it is a prerequisite of ${dependents.join(', ')}.`, undefined, { dependents });
    }
  }
  // Archiving or restoring a flag that is enabled in Production changes Production evaluation.
  if (configs.production.enabled) {
    assertProductionWritable(ctx);
    assertProductionConfirmed('production', confirmProduction);
  }
  const next: Flag = { ...flag, status, updatedAt: ctx.now().toISOString() };
  const auditId = await ctx.store.commit([{ type: 'putFlag', flag: next }], {
    timestamp: next.updatedAt, actor, operation: status === 'archived' ? 'flag.archived' : 'flag.restored',
    flagKey: key, previous: flag, next,
  });
  ctx.notifier.publish({ entity: 'flag', flagKey: key, auditId });
  return getFlag(ctx, key);
}

export async function getConfig(ctx: ServiceContext, key: string, environment: Environment): Promise<EnvironmentConfig> {
  return (await getFlag(ctx, key)).environments[environment];
}

async function validateAgainstCurrentState(ctx: ServiceContext, flag: Flag, environment: Environment, input: unknown) {
  const [flags, segments] = await Promise.all([listFlags(ctx), ctx.store.listSegments()]);
  return validateEnvironmentConfig(input, {
    flag,
    flags: new Map(flags.map((f) => [f.key, f])),
    prerequisitesByFlag: new Map(flags.map((f) => [f.key, f.environments[environment].prerequisites])),
    segmentKeys: new Set(segments.map((s) => s.key)),
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
export async function applyConfig(
  ctx: ServiceContext,
  actor: Actor,
  flagKey: string,
  environment: Environment,
  input: unknown,
  confirmProduction: unknown,
  { operation = 'config.updated', rollbackOf = null, expectedConfig }: ApplyOptions = {},
): Promise<AppliedConfig> {
  const flag = await requireFlag(ctx, flagKey);
  assertCanManageEnvironment(actor, environment);
  if (environment === 'production') assertProductionWritable(ctx);
  assertProductionConfirmed(environment, confirmProduction);
  const { value, issues } = await validateAgainstCurrentState(ctx, flag, environment, input);
  if (!value) throw invalid(issues, 'Configuration is invalid.');
  const previous = await getConfig(ctx, flagKey, environment);
  if (expectedConfig !== undefined && !isDeepStrictEqual(previous, expectedConfig)) {
    throw new AppError('CONFLICT', 'The configuration has changed since this proposal was made. Review the current configuration and try again.', undefined, { current: previous });
  }
  if (JSON.stringify(previous) === JSON.stringify(value)) return { config: previous, auditId: null };

  const timestamp = ctx.now().toISOString();
  const auditId = await ctx.store.commit(
    [{ type: 'putConfig', flag, environment, config: value, timestamp }, { type: 'putFlag', flag: { ...flag, updatedAt: timestamp } }],
    { timestamp, actor, operation, flagKey, environment, previous, next: value, rollbackOf },
  );
  ctx.notifier.publish({ entity: 'config', flagKey, environment, auditId });
  return { config: value, auditId };
}

/** Validates a proposed config and evaluates it for demo users without persisting anything. */
export async function previewConfig(ctx: ServiceContext, flagKey: string, environment: Environment, input: unknown, userIds?: unknown): Promise<PreviewResult> {
  const flag = await requireFlag(ctx, flagKey);
  const users = Array.isArray(userIds) && userIds.length > 0
    ? DEMO_USERS.filter((u) => userIds.includes(u.userId))
    : DEMO_USERS;
  const { value, issues } = await validateAgainstCurrentState(ctx, flag, environment, input);
  const current = await loadSnapshot(ctx.store);
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

export async function compareEnvironments(ctx: ServiceContext, environments: readonly Environment[] = ENVIRONMENTS): Promise<EnvironmentComparisonRow[]> {
  return (await listFlags(ctx)).map((flag) => ({
    flag,
    differences: (Object.keys(FIELD_SELECTORS) as ConfigField[]).filter((field) => {
      const values = environments.map((env) => JSON.stringify(FIELD_SELECTORS[field](flag.environments[env])));
      return new Set(values).size > 1;
    }),
  }));
}
