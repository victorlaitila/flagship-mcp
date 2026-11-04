import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  AUDIT_OPERATIONS,
  canManageEnvironment,
  defaultVariantKey,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  FLAG_TYPES,
  ROLE_LABELS,
  type Actor,
  type AuditEntry,
  type DemoUser,
  type Environment,
  type EnvironmentComparisonRow,
  type EnvironmentConfig,
  type EvaluationResult,
  type FlagWithConfigs,
  type PreviewResult,
} from '@flagship/shared';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { FlagshipError, type FlagshipApi } from './api.js';

const INSTRUCTIONS = `Flagship is a local feature flag platform (dashboard + demo storefront). These tools act on it through its REST API as a fixed, simulated identity (default: "Claude Code", Release Manager).

Workflow for changes: inspect first (get_feature_flag), then plan_configuration_change, explain the plan to the user and get their go-ahead, then apply_configuration_change with the exact arguments the plan returned. Never apply a change the user has not reviewed.
Production is read-only through this server: you may inspect, compare, evaluate and plan Production changes, but an Admin must apply them in the Flagship dashboard.`;

const environment = z.enum(ENVIRONMENTS);
const flagKey = z.string().min(1).describe('Feature flag key, e.g. "new_checkout". Use list_feature_flags to discover keys.');

const condition = z.object({
  attribute: z.enum(['userId', 'country', 'accountType', 'segment']),
  operator: z.enum(['equals', 'not_equals', 'in', 'not_in']),
  values: z.array(z.string()).describe('Country codes (FI), account types (regular, premium, employee), user ids or segment keys.'),
});
const rule = z.object({
  id: z.string().min(1).describe('Unique within the environment. Keep existing ids; invent a short one (e.g. "r_premium_fi") for new rules.'),
  description: z.string().default(''),
  effect: z.enum(['include', 'exclude']).describe('Exclude rules are checked first and always win; the first matching include rule turns the flag on.'),
  conditions: z.array(condition).min(1).describe('All conditions must match (AND).'),
  variant: z.string().nullable().default(null).describe('Multivariate include rules: the variant key to serve. Otherwise null.'),
});

const changes = z.object({
  enabled: z.boolean().optional().describe('Master switch for the environment. Off means everyone gets the off result.'),
  defaultEnabled: z.boolean().optional().describe('Boolean flags only: result for users no rule matched.'),
  rolloutPercentage: z.number().min(0).max(100).optional().describe('Percentage flags only: share of non-targeted users who get the feature.'),
  variantWeights: z.record(z.string(), z.number()).optional().describe('Multivariate flags only: complete map of variant key -> weight, totalling 100.'),
  rules: z.array(rule).optional().describe('Complete, ordered replacement for the targeting rules. Include unchanged rules too.'),
  prerequisites: z.array(z.string()).optional().describe('Complete replacement list of flag keys that must be enabled for the same user first.'),
}).strict().describe('Only the fields to change. Each given field replaces the current value entirely.');

type Changes = z.infer<typeof changes>;
type ConfigChange = { field: keyof EnvironmentConfig; from: unknown; to: unknown };

const CONFIG_FIELDS: (keyof EnvironmentConfig)[] = ['enabled', 'defaultEnabled', 'rolloutPercentage', 'variantWeights', 'rules', 'prerequisites'];

/** Short SHA-256 fingerprint of a value (a stored config, or everything a plan was based on). */
export const revisionOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

// Plan revisions bind an apply/rollback to the exact base config (and changes) the user reviewed:
// any difference in either yields a different revision, so the write is rejected.
const applyRevisionOf = (flagKey: string, environment: Environment, base: EnvironmentConfig, changes: Changes | undefined) =>
  revisionOf({ flagKey, environment, base, changes });
const rollbackRevisionOf = (auditId: number, base: EnvironmentConfig) => revisionOf({ auditId, base });

const planRevision = z.string().min(1).describe('The "planRevision" from the plan\'s applyWith.arguments, unchanged.');

const diffConfigs = (from: EnvironmentConfig, to: EnvironmentConfig): ConfigChange[] =>
  CONFIG_FIELDS.filter((field) => !isDeepStrictEqual(from[field], to[field])).map((field) => ({ field, from: from[field], to: to[field] }));

function summarizeConfig(flag: FlagWithConfigs, config: EnvironmentConfig): string {
  const parts = [config.enabled ? 'enabled' : 'disabled'];
  if (flag.type === 'boolean') parts.push(`default ${config.defaultEnabled ? 'on' : 'off'}`);
  if (flag.type === 'percentage') parts.push(`rollout ${config.rolloutPercentage}%`);
  if (flag.type === 'multivariate') parts.push(Object.entries(config.variantWeights ?? {}).map(([k, w]) => `${k} ${w}%`).join(' / '));
  if (config.rules.length) parts.push(`${config.rules.length} rule${config.rules.length > 1 ? 's' : ''}`);
  if (config.prerequisites.length) parts.push(`requires ${config.prerequisites.join(', ')}`);
  return parts.join(' · ');
}

function fallbackBehavior(flag: FlagWithConfigs, config: EnvironmentConfig): string {
  const off = flag.type === 'multivariate' ? `serves the default variant "${defaultVariantKey(flag)}"` : 'is off';
  const unmatched = {
    boolean: `Users no rule matches get ${config.defaultEnabled ? 'on' : 'off'}.`,
    percentage: `Users no rule matches are on if their deterministic bucket (0–99.99) is below ${config.rolloutPercentage}%.`,
    multivariate: 'Users no rule matches get a variant by deterministic bucket and the weights.',
  }[flag.type];
  return `When disabled, archived, excluded or a prerequisite fails, the flag ${off}. ${unmatched}`;
}

function auditSummary(entry: AuditEntry) {
  const isConfig = entry.operation.startsWith('config.');
  const base = {
    id: entry.id,
    timestamp: entry.timestamp,
    actor: `${entry.actorName} (${ROLE_LABELS[entry.actorRole]}, ${entry.actorId})`,
    operation: entry.operation,
    ...(entry.flagKey && { flagKey: entry.flagKey }),
    ...(entry.segmentKey && { segmentKey: entry.segmentKey }),
    ...(entry.environment && { environment: entry.environment }),
    ...(entry.rollbackOf !== null && { rollbackOf: entry.rollbackOf }),
  };
  if (isConfig && entry.previous && entry.next) {
    return { ...base, changes: diffConfigs(entry.previous as EnvironmentConfig, entry.next as EnvironmentConfig) };
  }
  return { ...base, previous: entry.previous, next: entry.next };
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const rejected = (code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', code, message, ...extra }, null, 2) }],
});

const PRODUCTION_READ_ONLY = 'Production is read-only through the Flagship MCP server. An Admin must apply Production changes in the Flagship dashboard.';

export function createServer(api: FlagshipApi): McpServer {
  const server = new McpServer({ name: 'flagship', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  let identity: Promise<Actor> | undefined;
  const whoami = () => {
    identity ??= api.get<Actor>('/whoami').catch((error) => {
      identity = undefined; // retry on the next call, e.g. once the API is up
      if (error instanceof FlagshipError && error.code === 'UNAUTHENTICATED') {
        throw new FlagshipError('UNAUTHENTICATED', `The configured MCP identity "${api.actorId}" is not a Flagship actor. Check FLAGSHIP_ACTOR_ID.`);
      }
      throw error;
    });
    return identity;
  };

  const permissionFor = async (env: Environment) => {
    const actor = await whoami();
    const as = `${actor.name} (${ROLE_LABELS[actor.role]})`;
    if (env === 'production') return { canApply: false, reason: PRODUCTION_READ_ONLY };
    if (!canManageEnvironment(actor.role, env)) {
      return { canApply: false, reason: `${as} cannot change ${ENVIRONMENT_LABELS[env]}.` };
    }
    return { canApply: true, reason: `${as} may change ${ENVIRONMENT_LABELS[env]}.` };
  };

  /** Runs a tool body and turns backend failures into explicit, non-success tool results. */
  const run = async (body: () => Promise<CallToolResult>): Promise<CallToolResult> => {
    try {
      return await body();
    } catch (error) {
      if (!(error instanceof FlagshipError)) {
        console.error('[flagship-mcp] unexpected error:', error);
        return rejected('INTERNAL', 'Unexpected error in the Flagship MCP server.');
      }
      if (error.code === 'CONFIRMATION_REQUIRED') return rejected('PRODUCTION_READ_ONLY', PRODUCTION_READ_ONLY);
      const hint = error.code === 'FORBIDDEN' ? { hint: 'The MCP identity lacks permission for this; it cannot be changed from a tool call.' }
        : error.code === 'VALIDATION_FAILED' ? { hint: 'Nothing was saved. Fix the listed issues and plan again.' }
          : error.code === 'CONFLICT' ? { hint: 'Nothing was saved. Run plan_configuration_change again against the current configuration.' }
            : {};
      return rejected(error.code, error.message, { ...(error.issues.length && { issues: error.issues }), ...hint });
    }
  };

  server.registerTool('list_feature_flags', {
    title: 'List feature flags',
    description: 'Discover feature flags: key, name, description, type, owner, status and a one-line summary of each environment\'s configuration. Start here when you do not know a flag key.',
    inputSchema: z.object({
      status: z.enum(['active', 'archived', 'all']).default('active'),
      type: z.enum(FLAG_TYPES).optional().describe('Only flags of this type.'),
      environment: environment.optional().describe('Only summarize this environment.'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run(async () => {
    const flags = await api.get<FlagWithConfigs[]>('/flags');
    const envs = args.environment ? [args.environment] : ENVIRONMENTS;
    return ok(flags
      .filter((f) => (args.status === 'all' || f.status === args.status) && (!args.type || f.type === args.type))
      .map((f) => ({
        key: f.key, name: f.name, description: f.description, type: f.type, owner: f.owner, tags: f.tags, status: f.status,
        environments: Object.fromEntries(envs.map((env) => [env, summarizeConfig(f, f.environments[env])])),
      })));
  }));

  server.registerTool('get_feature_flag', {
    title: 'Get feature flag',
    description: 'Inspect one flag in detail: metadata, variants, full configuration (enabled, default/rollout/weights, targeting rules, prerequisites), fallback behavior and recent audit history. Use before planning a change.',
    inputSchema: z.object({
      flagKey,
      environment: environment.optional().describe('Show only this environment. Omit for all three.'),
      historyLimit: z.number().int().min(0).max(50).default(5).describe('Number of recent audit entries to include.'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run(async () => {
    const flag = await api.get<FlagWithConfigs>(`/flags/${encodeURIComponent(args.flagKey)}`);
    const envs = args.environment ? [args.environment] : ENVIRONMENTS;
    const history = args.historyLimit === 0 ? [] : await api.get<AuditEntry[]>(
      `/audit${qs({ flagKey: flag.key, environment: args.environment, limit: args.historyLimit })}`);
    return ok({
      key: flag.key, name: flag.name, description: flag.description, type: flag.type, owner: flag.owner, tags: flag.tags,
      status: flag.status, updatedAt: flag.updatedAt,
      ...(flag.type === 'multivariate' && {
        variants: flag.variants.map((v) => ({ ...v, ...(v.key === defaultVariantKey(flag) && { default: true }) })),
      }),
      environments: Object.fromEntries(envs.map((env) => [env, {
        config: flag.environments[env],
        revision: revisionOf(flag.environments[env]),
        fallback: fallbackBehavior(flag, flag.environments[env]),
      }])),
      recentHistory: history.map(auditSummary),
    });
  }));

  server.registerTool('compare_environments', {
    title: 'Compare environments',
    description: 'Find flags configured differently between two environments (enabled state, default, rollout, variant weights, targeting rules, prerequisites), with both values for every difference. E.g. "what is in Staging but not yet in Production?"',
    inputSchema: z.object({
      from: environment.default('staging'),
      to: environment.default('production'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run(async () => {
    if (args.from === args.to) return rejected('BAD_REQUEST', 'Choose two different environments.');
    const rows = await api.get<EnvironmentComparisonRow[]>(`/environments/compare${qs({ environments: `${args.from},${args.to}` })}`);
    const different = rows.filter((r) => r.differences.length > 0);
    return ok({
      compared: [args.from, args.to],
      differentFlags: different.map(({ flag }) => {
        const [a, b] = [flag.environments[args.from], flag.environments[args.to]];
        return {
          key: flag.key, name: flag.name, type: flag.type, status: flag.status,
          [args.from]: summarizeConfig(flag, a),
          [args.to]: summarizeConfig(flag, b),
          differences: diffConfigs(a, b).map(({ field, from, to }) => ({ field, [args.from]: from, [args.to]: to })),
        };
      }),
      identicalFlags: rows.filter((r) => r.differences.length === 0).map((r) => r.flag.key),
    });
  }));

  server.registerTool('evaluate_flags', {
    title: 'Evaluate flags',
    description: `Ask the real Flagship evaluation engine what a user gets: enabled state, variant, reason and an explanation naming the matched rule, rollout bucket or failed prerequisite.
Pass "userId" for one demo customer, "user" for any other user context, or neither to evaluate every demo customer (this also lists who they are).`,
    inputSchema: z.object({
      environment,
      userId: z.string().optional().describe('Demo customer id, e.g. "u_eero".'),
      user: z.object({
        userId: z.string().min(1).describe('Any id; it determines the deterministic rollout bucket.'),
        country: z.string().min(1).describe('Country code, e.g. "FI", "SE", "US".'),
        accountType: z.string().min(1).describe('e.g. "regular", "premium", "employee".'),
      }).optional().describe('An arbitrary user context instead of a demo customer. Segment membership is derived from these attributes by the backend.'),
      flagKeys: z.array(z.string()).optional().describe('Only these flags. Omit for all flags.'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run(async () => {
    if (args.userId && args.user) return rejected('BAD_REQUEST', 'Pass either "userId" or "user", not both.');
    const flagKeys = args.flagKeys;
    const summarize = (results: EvaluationResult[]) => (flagKeys ? results.filter((r) => flagKeys.includes(r.flagKey)) : results)
      .map((r) => ({ flagKey: r.flagKey, enabled: r.enabled, ...(r.variant !== null && { variant: r.variant }), reason: r.reason, explanation: r.explanation }));

    let evaluations;
    if (args.user) {
      const results = await api.request<EvaluationResult[]>('POST', '/evaluate', { environment: args.environment, user: args.user });
      evaluations = [{ user: { ...args.user, demoCustomer: false }, flags: summarize(results.body) }];
    } else {
      const users = await api.get<DemoUser[]>('/demo-users');
      const selected = args.userId ? users.filter((u) => u.userId === args.userId) : users;
      if (selected.length === 0) {
        return rejected('NOT_FOUND', `Unknown demo customer "${args.userId}". Known: ${users.map((u) => `${u.userId} (${u.name})`).join(', ')}. Use "user" for other users.`);
      }
      evaluations = await Promise.all(selected.map(async (user) => ({
        user: { userId: user.userId, name: user.name, country: user.country, accountType: user.accountType, description: user.description },
        flags: summarize(await api.get<EvaluationResult[]>(`/evaluate${qs({ environment: args.environment, userId: user.userId })}`)),
      })));
    }
    const unknown = flagKeys?.filter((k) => !evaluations[0].flags.some((f) => f.flagKey === k)) ?? [];
    if (unknown.length) return rejected('NOT_FOUND', `Unknown flag key(s): ${unknown.join(', ')}.`);
    return ok({ environment: args.environment, evaluations });
  }));

  server.registerTool('plan_configuration_change', {
    title: 'Plan configuration change',
    description: `Dry run: builds the proposed configuration for one flag in one environment, validates it with the backend and shows which demo customers would be affected. Nothing is saved. Use this before every change and show the result to the user.
Pass either "changes" (only the fields to change) or "restoreFromAuditId" (preview restoring the configuration from before that audit entry, i.e. a rollback).
If the plan is valid and permitted, the result contains "applyWith": the exact arguments for apply_configuration_change (or rollback_configuration_change).`,
    inputSchema: z.object({
      flagKey,
      environment,
      changes: changes.optional(),
      restoreFromAuditId: z.number().int().optional().describe('Audit entry id of a configuration change for this flag and environment.'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run(async () => {
    if ((args.changes === undefined) === (args.restoreFromAuditId === undefined)) {
      return rejected('BAD_REQUEST', 'Pass exactly one of "changes" or "restoreFromAuditId".');
    }
    const path = `/flags/${encodeURIComponent(args.flagKey)}/environments/${args.environment}`;
    const current = await api.get<EnvironmentConfig>(path);
    let requested: EnvironmentConfig;
    if (args.restoreFromAuditId !== undefined) {
      const entry = await api.get<AuditEntry>(`/audit/${args.restoreFromAuditId}`).catch((error) => {
        if (error instanceof FlagshipError && error.code === 'NOT_FOUND') return null;
        throw error;
      });
      if (!entry || !entry.operation.startsWith('config.') || entry.flagKey !== args.flagKey || entry.environment !== args.environment) {
        return rejected('NOT_FOUND', `Audit entry ${args.restoreFromAuditId} is not a configuration change of ${args.flagKey} in ${args.environment}. Use get_audit_history to find one.`);
      }
      requested = entry.previous as EnvironmentConfig;
    } else {
      requested = { ...current, ...(args.changes as Changes) };
    }

    const [preview, permission] = await Promise.all([
      api.request<PreviewResult>('POST', `${path}/preview`, { config: requested }).then((r) => r.body),
      permissionFor(args.environment),
    ]);
    // Show what the backend would actually store (it drops fields that do not apply to the flag type, rounds rollouts).
    const proposed = preview.config ?? requested;
    const diff = diffConfigs(current, proposed);
    const adjusted = preview.config && args.changes
      ? (Object.keys(args.changes) as (keyof Changes)[])
        .filter((field) => !isDeepStrictEqual(args.changes![field], preview.config![field]))
        .map((field) => ({ field, requested: args.changes![field], willBeSaved: preview.config![field] }))
      : [];
    const outcome = (r: EvaluationResult) => r.variant ?? (r.enabled ? 'on' : 'off');
    const affected = preview.results.filter((r) => r.changed && r.proposed).map((r) => ({
      user: `${r.user.name} (${r.user.userId}, ${r.user.country}, ${r.user.accountType})`,
      before: outcome(r.current),
      after: outcome(r.proposed!),
      why: r.proposed!.explanation,
    }));
    const applicable = preview.valid && permission.canApply && diff.length > 0;
    return ok({
      flagKey: args.flagKey,
      environment: args.environment,
      valid: preview.valid,
      ...(preview.issues.length && { validationIssues: preview.issues }),
      ...(diff.length === 0 && { note: 'The proposed configuration equals the current one; applying it would change nothing.' }),
      ...(adjusted.length && { adjustedByBackend: adjusted }),
      permission,
      changes: diff,
      ...(preview.valid && {
        impactOnDemoCustomers: { affected, unaffectedCount: preview.results.length - affected.length },
      }),
      proposedConfig: proposed,
      ...(applicable && {
        applyWith: args.restoreFromAuditId !== undefined
          ? { tool: 'rollback_configuration_change', arguments: { auditId: args.restoreFromAuditId, planRevision: rollbackRevisionOf(args.restoreFromAuditId, current) } }
          : { tool: 'apply_configuration_change', arguments: {
            flagKey: args.flagKey, environment: args.environment, changes: args.changes,
            planRevision: applyRevisionOf(args.flagKey, args.environment, current, args.changes),
          } },
      }),
    });
  }));

  server.registerTool('apply_configuration_change', {
    title: 'Apply configuration change',
    description: `Saves a configuration change that was planned with plan_configuration_change and reviewed by the user. Pass the "applyWith.arguments" from the plan unchanged.
The backend re-validates, enforces permissions, writes an audit entry and pushes the change live to the dashboard and storefront. Rejected if the configuration changed since the plan or the arguments differ from the planned ones (planRevision mismatch). Development and Staging only; Production is read-only through this server.`,
    inputSchema: z.object({
      flagKey,
      environment,
      changes,
      planRevision,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (args) => run(async () => {
    if (args.environment === 'production') return rejected('PRODUCTION_READ_ONLY', PRODUCTION_READ_ONLY);
    const path = `/flags/${encodeURIComponent(args.flagKey)}/environments/${args.environment}`;
    const current = await api.get<EnvironmentConfig>(path);
    if (applyRevisionOf(args.flagKey, args.environment, current, args.changes) !== args.planRevision) {
      return rejected('CONFLICT', 'This change does not match a current plan: the configuration changed since it was planned, or the arguments differ from the planned ones. Nothing was saved.', {
        hint: 'Run plan_configuration_change again and review the new plan with the user.',
      });
    }
    // expectedConfig makes the backend reject the write if anything changed since the GET above.
    const { body: saved, auditId } = await api.request<EnvironmentConfig>('PUT', path, {
      config: { ...current, ...args.changes }, expectedConfig: current,
    });
    if (auditId === null) return ok({ status: 'unchanged', message: 'The configuration already matched; nothing was saved.' });
    return ok({
      status: 'applied', flagKey: args.flagKey, environment: args.environment, auditId,
      changes: diffConfigs(current, saved), config: saved,
    });
  }));

  server.registerTool('get_audit_history', {
    title: 'Get audit history',
    description: 'Read the audit log, newest first: who changed what and when, with field-level before/after values for configuration changes. Use it to explain how a flag reached its current state or to find an entry to roll back.',
    inputSchema: z.object({
      flagKey: flagKey.optional(),
      environment: environment.optional(),
      actorId: z.string().optional().describe('Only entries by this actor id, e.g. "claude-code", "ida", "sara".'),
      operation: z.enum(AUDIT_OPERATIONS).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (args) => run(async () => {
    const entries = await api.get<AuditEntry[]>(`/audit${qs(args)}`);
    return ok(entries.map(auditSummary));
  }));

  server.registerTool('rollback_configuration_change', {
    title: 'Roll back configuration change',
    description: `Restores the configuration that was in place before the given audit entry, as a new audited change (history is never rewritten). Preview it first with plan_configuration_change({ restoreFromAuditId }) and confirm with the user.
Only configuration changes (config.updated / config.rolled_back) can be rolled back. Rejected if the configuration changed since the plan (planRevision mismatch). Development and Staging only; Production is read-only through this server.`,
    inputSchema: z.object({
      auditId: z.number().int().describe('Audit entry id from get_audit_history.'),
      planRevision,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, (args) => run(async () => {
    const target = await api.get<AuditEntry>(`/audit/${args.auditId}`);
    if (target.environment === 'production') return rejected('PRODUCTION_READ_ONLY', PRODUCTION_READ_ONLY);
    if (!target.operation.startsWith('config.') || !target.flagKey || !target.environment) {
      return rejected('BAD_REQUEST', 'Only configuration changes can be rolled back.');
    }
    const current = await api.get<EnvironmentConfig>(`/flags/${encodeURIComponent(target.flagKey)}/environments/${target.environment}`);
    if (rollbackRevisionOf(args.auditId, current) !== args.planRevision) {
      return rejected('CONFLICT', 'The configuration changed after this rollback was planned. Nothing was saved.', {
        hint: 'Run plan_configuration_change({ restoreFromAuditId }) again and review the new plan with the user.',
      });
    }
    // expectedConfig makes the backend reject the rollback if anything changed since the GET above.
    // We never send confirmProduction, so the backend refuses Production rollbacks as well.
    const { body: restored, auditId } = await api.request<EnvironmentConfig>('POST', `/audit/${args.auditId}/rollback`, { expectedConfig: current });
    // The backend refuses no-op rollbacks, so a successful one always reports the audit entry it wrote.
    if (auditId === null) throw new FlagshipError('BAD_RESPONSE', 'The rollback was applied, but the response did not include its audit entry id. Check get_audit_history.');
    const entry = await api.get<AuditEntry>(`/audit/${auditId}`);
    return ok({
      status: 'rolled_back', rolledBackEntry: args.auditId, auditId,
      flagKey: entry.flagKey, environment: entry.environment,
      changes: diffConfigs(entry.previous as EnvironmentConfig, entry.next as EnvironmentConfig),
      config: restored,
    });
  }));

  return server;
}
