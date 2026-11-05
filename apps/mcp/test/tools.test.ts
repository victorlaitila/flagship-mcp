import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { seededContext } from '../../api/test/helpers.js';
import { FlagshipApi } from '../src/api.js';
import { createServer } from '../src/tools.js';

// The real backend, in-process on a fresh in-memory database; the MCP server talks to it over HTTP.
let httpServer: Server;
let apiUrl: string;

async function connect(api: FlagshipApi): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer(api).connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

let client: Client;
beforeAll(async () => {
  httpServer = createApp(seededContext()).listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));
  apiUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  client = await connect(new FlagshipApi(apiUrl, 'claude-code'));
});
afterAll(() => new Promise((resolve) => httpServer.close(resolve)));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}, c = client): Promise<{ isError: boolean; data: any }> {
  const result = await c.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch { /* plain-text SDK error */ }
  return { isError: result.isError === true, data };
}

const api = async (path: string) => (await fetch(`${apiUrl}/api${path}`)).json();
const auditCount = async () => (await api('/audit?limit=1000')).length;
const send = async (method: string, path: string, actor: string, json?: unknown) => (await fetch(`${apiUrl}/api${path}`, {
  method, headers: { 'content-type': 'application/json', 'x-actor-id': actor }, body: json === undefined ? undefined : JSON.stringify(json),
})).json();
const adminPost = (path: string) => send('POST', path, 'sara', { confirmProduction: true });

describe('tool discovery', () => {
  it('registers the eight Flagship tools with descriptions and schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'apply_configuration_change', 'compare_environments', 'evaluate_flags', 'get_audit_history',
      'get_feature_flag', 'list_feature_flags', 'plan_configuration_change', 'rollback_configuration_change',
    ]);
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThan(40);
      // Identity is server-side configuration only: no tool lets the caller pick an actor or role.
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toEqual(expect.arrayContaining(['actor']));
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/"(actor|actorRole|role|confirmProduction)"/);
    }
    const writes = tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(writes).toEqual(['apply_configuration_change', 'rollback_configuration_change']);
  });

  it('rejects arguments that do not match the input schema', async () => {
    const bad = await call('evaluate_flags', { environment: 'qa' }).catch((e: Error) => ({ isError: true, data: e.message }));
    expect(bad.isError).toBe(true);
    const unknownField = await call('plan_configuration_change', {
      flagKey: 'new_search', environment: 'staging', changes: { enabled: true, owner: 'me' },
    }).catch((e: Error) => ({ isError: true, data: e.message }));
    expect(unknownField.isError).toBe(true);
  });
});

describe('read tools', () => {
  it('lists and filters flags with per-environment summaries', async () => {
    const { data: all } = await call('list_feature_flags');
    expect(all).toHaveLength(10);
    const { data: multi } = await call('list_feature_flags', { type: 'multivariate', environment: 'production' });
    expect(multi.map((f: { key: string }) => f.key).sort()).toEqual(['cart_redesign', 'new_checkout', 'new_search']);
    expect(Object.keys(multi[0].environments)).toEqual(['production']);
    expect(multi.find((f: { key: string }) => f.key === 'new_search').environments.production).toMatch(/enabled · basic \d+% \/ enhanced \d+%/);
  });

  it('shows one flag with config, default variant, fallback and history', async () => {
    const { data } = await call('get_feature_flag', { flagKey: 'new_search', environment: 'production' });
    expect(Object.keys(data.environments)).toEqual(['production']);
    expect(data.environments.production.config).toEqual(await api('/flags/new_search/environments/production'));
    expect(data.variants[0]).toMatchObject({ key: 'basic', default: true });
    expect(data.environments.production.fallback).toContain('default variant "basic"');

    const { data: seeded } = await call('get_feature_flag', { flagKey: 'ai_recommendations', environment: 'production' });
    expect(seeded.recentHistory[0]).toMatchObject({ operation: 'config.updated', changes: [{ field: 'rolloutPercentage' }] });

    const missing = await call('get_feature_flag', { flagKey: 'nope' });
    expect(missing).toMatchObject({ isError: true, data: { status: 'rejected', code: 'NOT_FOUND' } });
  });

  it('compares two environments using the backend comparison', async () => {
    const { data } = await call('compare_environments', { from: 'staging', to: 'production' });
    const banner = data.differentFlags.find((f: { key: string }) => f.key === 'free_shipping_banner');
    // free_shipping_banner's default only differs in development, so only its rules differ here.
    expect(banner.differences.map((d: { field: string }) => d.field)).toEqual(['rules']);
    expect(banner.differences[0]).toHaveProperty('staging');
    expect(banner.differences[0]).toHaveProperty('production');
    expect((await call('compare_environments', { from: 'staging', to: 'staging' })).isError).toBe(true);
  });

  it('evaluates with the backend engine', async () => {
    const { data } = await call('evaluate_flags', { environment: 'production', userId: 'u_eero', flagKeys: ['new_checkout'] });
    const direct = (await api('/evaluate?environment=production&userId=u_eero')).find((r: { flagKey: string }) => r.flagKey === 'new_checkout');
    expect(data.evaluations).toHaveLength(1);
    expect(data.evaluations[0].user).toMatchObject({ userId: 'u_eero', country: 'FI', accountType: 'premium' });
    expect(data.evaluations[0].flags[0]).toMatchObject({ enabled: direct.enabled, reason: direct.reason, explanation: direct.explanation });

    const everyone = await call('evaluate_flags', { environment: 'staging', flagKeys: ['free_shipping_banner'] });
    expect(everyone.data.evaluations).toHaveLength(5);
    expect((await call('evaluate_flags', { environment: 'staging', userId: 'u_nobody' })).data.message).toContain('u_eero');
    expect((await call('evaluate_flags', { environment: 'staging', flagKeys: ['nope'] })).isError).toBe(true);
  });

  it('evaluates an arbitrary user context with the backend engine', async () => {
    const user = { userId: 'visitor_42', country: 'SE', accountType: 'regular' };
    const { isError, data } = await call('evaluate_flags', { environment: 'production', user, flagKeys: ['free_shipping_banner', 'loyalty_program'] });
    expect(isError).toBe(false);
    const direct = await (await fetch(`${apiUrl}/api/evaluate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ environment: 'production', user }),
    })).json();
    expect(data.evaluations).toHaveLength(1);
    expect(data.evaluations[0].user).toEqual({ ...user, demoCustomer: false });
    for (const flag of data.evaluations[0].flags) {
      const expected = direct.find((r: { flagKey: string }) => r.flagKey === flag.flagKey);
      expect(flag).toMatchObject({ enabled: expected.enabled, reason: expected.reason, explanation: expected.explanation });
    }
    expect(data.evaluations[0].flags.find((f: { flagKey: string }) => f.flagKey === 'free_shipping_banner')).toMatchObject({ enabled: true, reason: 'TARGETING_MATCH' });

    expect((await call('evaluate_flags', { environment: 'production', userId: 'u_eero', user })).data.code).toBe('BAD_REQUEST');
    const incomplete = await call('evaluate_flags', { environment: 'production', user: { userId: 'x' } }).catch((e: Error) => ({ isError: true, data: e.message }));
    expect(incomplete.isError).toBe(true);
  });

  it('filters audit history by actor', async () => {
    const { data } = await call('get_audit_history', { actorId: 'ida', limit: 50 });
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((e: { actor: string }) => e.actor.includes('ida'))).toBe(true);
  });
});

describe('planning', () => {
  it('plans a change without persisting it', async () => {
    const before = await api('/flags/order_tracking_v2/environments/staging');
    const count = await auditCount();
    const { isError, data } = await call('plan_configuration_change', {
      flagKey: 'order_tracking_v2', environment: 'staging', changes: { defaultEnabled: !before.defaultEnabled },
    });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ valid: true, permission: { canApply: true } });
    expect(data.changes).toEqual([{ field: 'defaultEnabled', from: before.defaultEnabled, to: !before.defaultEnabled }]);
    expect(data.impactOnDemoCustomers.affected.length).toBeGreaterThan(0);
    expect(data.applyWith.tool).toBe('apply_configuration_change');
    expect(await api('/flags/order_tracking_v2/environments/staging')).toEqual(before);
    expect(await auditCount()).toBe(count);
  });

  it('reports backend validation issues for an invalid proposal', async () => {
    const { data } = await call('plan_configuration_change', {
      flagKey: 'new_search', environment: 'staging', changes: { variantWeights: { basic: 30, enhanced: 30 } },
    });
    expect(data.valid).toBe(false);
    expect(data.validationIssues[0].path).toBe('variantWeights');
    expect(data).not.toHaveProperty('applyWith');
  });

  it('plans Production changes but marks them as not applicable', async () => {
    const { data } = await call('plan_configuration_change', { flagKey: 'loyalty_program', environment: 'production', changes: { enabled: false } });
    expect(data.valid).toBe(true);
    expect(data.permission).toMatchObject({ canApply: false, reason: expect.stringContaining('read-only') });
    expect(data).not.toHaveProperty('applyWith');
  });
});

describe('applying and rolling back', () => {
  it('applies a planned Staging change, audits it as Claude Code, and rolls it back', async () => {
    const path = '/flags/ai_recommendations/environments/staging';
    const original = await api(path);
    const plan = (await call('plan_configuration_change', {
      flagKey: 'ai_recommendations', environment: 'staging', changes: { rolloutPercentage: 42 },
    })).data;

    const applied = await call('apply_configuration_change', plan.applyWith.arguments);
    expect(applied).toMatchObject({ isError: false, data: { status: 'applied', config: { rolloutPercentage: 42 } } });
    const [entry] = await api('/audit?limit=1');
    expect(entry).toMatchObject({ id: applied.data.auditId, actorId: 'claude-code', actorName: 'Claude Code', flagKey: 'ai_recommendations' });

    // Reusing the plan after the config changed is rejected and writes nothing.
    const count = await auditCount();
    const stale = await call('apply_configuration_change', { ...plan.applyWith.arguments, changes: { rolloutPercentage: 43 } });
    expect(stale).toMatchObject({ isError: true, data: { code: 'CONFLICT' } });
    expect(await auditCount()).toBe(count);

    const rollbackPlan = (await call('plan_configuration_change', {
      flagKey: 'ai_recommendations', environment: 'staging', restoreFromAuditId: applied.data.auditId,
    })).data;
    expect(rollbackPlan.changes).toEqual([{ field: 'rolloutPercentage', from: 42, to: original.rolloutPercentage }]);
    expect(rollbackPlan.applyWith).toEqual({
      tool: 'rollback_configuration_change', arguments: { auditId: applied.data.auditId, planRevision: expect.any(String) },
    });

    const rolled = await call('rollback_configuration_change', rollbackPlan.applyWith.arguments);
    expect(rolled.data).toMatchObject({
      status: 'rolled_back', rolledBackEntry: applied.data.auditId, flagKey: 'ai_recommendations', environment: 'staging',
      changes: [{ field: 'rolloutPercentage', from: 42, to: original.rolloutPercentage }],
    });
    // The reported id is exactly the entry the rollback wrote.
    expect(await api(`/audit/${rolled.data.auditId}`)).toMatchObject({
      operation: 'config.rolled_back', rollbackOf: applied.data.auditId, actorId: 'claude-code', next: original,
    });
    expect(await api(path)).toEqual(original);
  });

  it('rejects configurations the backend finds invalid at apply time without auditing', async () => {
    const { data: plan } = await call('plan_configuration_change', {
      flagKey: 'order_tracking_v2', environment: 'staging', changes: { prerequisites: ['personalized_homepage'] },
    });
    expect(plan.valid).toBe(true);
    // The prerequisite is archived after planning: the backend re-validates on apply and refuses.
    await adminPost('/flags/personalized_homepage/archive');
    const count = await auditCount();
    const result = await call('apply_configuration_change', plan.applyWith.arguments);
    await adminPost('/flags/personalized_homepage/restore');
    expect(result).toMatchObject({ isError: true, data: { status: 'rejected', code: 'VALIDATION_FAILED' } });
    expect(result.data.issues[0].path).toMatch(/^prerequisites/);
    expect(await auditCount()).toBe(count + 1); // only the restore
  });

  it('never writes to Production', async () => {
    const before = await api('/flags/loyalty_program/environments/production');
    const count = await auditCount();
    const applied = await call('apply_configuration_change', {
      flagKey: 'loyalty_program', environment: 'production', changes: { enabled: false }, planRevision: 'x',
    });
    expect(applied).toMatchObject({ isError: true, data: { code: 'PRODUCTION_READ_ONLY' } });

    const [prodEntry] = await api('/audit?environment=production&operation=config.updated&limit=1');
    const rollback = await call('rollback_configuration_change', { auditId: prodEntry.id, planRevision: 'x' });
    expect(rollback).toMatchObject({ isError: true, data: { code: 'PRODUCTION_READ_ONLY' } });

    // Not even with an Admin identity.
    const admin = await connect(new FlagshipApi(apiUrl, 'sara'));
    expect((await call('rollback_configuration_change', { auditId: prodEntry.id, planRevision: 'x' }, admin)).data.code).toBe('PRODUCTION_READ_ONLY');

    expect(await api('/flags/loyalty_program/environments/production')).toEqual(before);
    expect(await auditCount()).toBe(count);
  });

  it('lets the backend refuse environments the identity cannot manage', async () => {
    const developer = await connect(new FlagshipApi(apiUrl, 'leo'));
    const { data: plan } = await call('plan_configuration_change', {
      flagKey: 'order_tracking_v2', environment: 'staging', changes: { enabled: false },
    }, developer);
    expect(plan.permission).toMatchObject({ canApply: false, reason: 'Leo Nieminen (Developer) cannot change Staging.' });
    // A plan made by a Release Manager, applied by a Developer: the backend enforces the permission.
    const { data: rmPlan } = await call('plan_configuration_change', { flagKey: 'order_tracking_v2', environment: 'staging', changes: { enabled: false } });
    const result = await call('apply_configuration_change', rmPlan.applyWith.arguments, developer);
    expect(result).toMatchObject({ isError: true, data: { code: 'FORBIDDEN' } });
  });
});

describe('plans match what is saved', () => {
  it('does not offer a change the backend would drop (rollout on an on/off flag)', async () => {
    const path = '/flags/new_payment_api/environments/staging';
    const before = await api(path);
    const { isError, data } = await call('plan_configuration_change', {
      flagKey: 'new_payment_api', environment: 'staging', changes: { rolloutPercentage: 50 },
    });
    expect(isError).toBe(false);
    expect(data.changes).toEqual([]);
    expect(data.proposedConfig).toEqual(before);
    expect(data.adjustedByBackend).toEqual([{ field: 'rolloutPercentage', requested: 50, willBeSaved: null }]);
    expect(data.note).toContain('change nothing');
    expect(data).not.toHaveProperty('applyWith');
  });

  it('shows and saves the normalized rollout (33.333 → 33.33)', async () => {
    const path = '/flags/ai_recommendations/environments/development';
    const original = await api(path);
    const { data: plan } = await call('plan_configuration_change', {
      flagKey: 'ai_recommendations', environment: 'development', changes: { rolloutPercentage: 33.333 },
    });
    expect(plan.changes).toEqual([{ field: 'rolloutPercentage', from: original.rolloutPercentage, to: 33.33 }]);
    expect(plan.proposedConfig.rolloutPercentage).toBe(33.33);
    expect(plan.adjustedByBackend).toEqual([{ field: 'rolloutPercentage', requested: 33.333, willBeSaved: 33.33 }]);

    const { data: applied } = await call('apply_configuration_change', plan.applyWith.arguments);
    expect(applied.status).toBe('applied');
    expect(await api(path)).toEqual(plan.proposedConfig);
    expect(applied.changes).toEqual(plan.changes);
  });
});

describe('apply is bound to the reviewed plan', () => {
  it('rejects different changes reusing a valid plan revision, without saving or auditing', async () => {
    const path = '/flags/loyalty_program/environments/staging';
    const before = await api(path);
    const { data: plan } = await call('plan_configuration_change', {
      flagKey: 'loyalty_program', environment: 'staging', changes: { defaultEnabled: !before.defaultEnabled },
    });
    const count = await auditCount();
    for (const tampered of [
      { ...plan.applyWith.arguments, changes: { enabled: false } },
      { ...plan.applyWith.arguments, changes: { ...plan.applyWith.arguments.changes, enabled: false } },
      { ...plan.applyWith.arguments, flagKey: 'personalized_homepage' },
      { ...plan.applyWith.arguments, environment: 'development' },
    ]) {
      expect(await call('apply_configuration_change', tampered)).toMatchObject({ isError: true, data: { code: 'CONFLICT' } });
    }
    expect(await api(path)).toEqual(before);
    expect(await auditCount()).toBe(count);
  });
});

describe('rollback is protected against concurrent changes', () => {
  it('rejects a planned rollback after an intervening edit and keeps that edit', async () => {
    const path = '/flags/new_search/environments/development';
    const { data: plan } = await call('plan_configuration_change', {
      flagKey: 'new_search', environment: 'development', changes: { variantWeights: { basic: 30, enhanced: 70 } },
    });
    const { data: applied } = await call('apply_configuration_change', plan.applyWith.arguments);
    const { data: rollbackPlan } = await call('plan_configuration_change', {
      flagKey: 'new_search', environment: 'development', restoreFromAuditId: applied.auditId,
    });

    // Someone else changes the flag after the rollback was planned.
    const intervening = { ...(await api(path)), enabled: false };
    await send('PUT', path, 'leo', { config: intervening });
    const count = await auditCount();

    const result = await call('rollback_configuration_change', rollbackPlan.applyWith.arguments);
    expect(result).toMatchObject({ isError: true, data: { code: 'CONFLICT' } });
    expect(await api(path)).toEqual(intervening);
    expect(await auditCount()).toBe(count);
  });
});

describe('rollback planning', () => {
  it('reads the exact audit entry instead of scanning the log, with the same errors', async () => {
    const urls: string[] = [];
    const recording = ((input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return fetch(input, init);
    }) as typeof fetch;
    const recorded = await connect(new FlagshipApi(apiUrl, 'claude-code', recording));
    const [entry] = await api('/audit?flagKey=ai_recommendations&environment=production&operation=config.updated&limit=1');

    const { data } = await call('plan_configuration_change', { flagKey: 'ai_recommendations', environment: 'production', restoreFromAuditId: entry.id }, recorded);
    expect(data.proposedConfig).toEqual(entry.previous);
    expect(urls).toContain(`${apiUrl}/api/audit/${entry.id}`);
    expect(urls.some((u) => u.includes('/api/audit?'))).toBe(false);

    const [created] = await api('/audit?operation=flag.created&flagKey=ai_recommendations&limit=1');
    for (const [flag, id] of [['new_search', entry.id], ['ai_recommendations', 999999], ['ai_recommendations', created.id]] as const) {
      const result = await call('plan_configuration_change', { flagKey: flag, environment: 'production', restoreFromAuditId: id });
      expect(result).toMatchObject({ isError: true, data: { code: 'NOT_FOUND', message: expect.stringContaining('get_audit_history') } });
    }
  });
});

describe('failure handling', () => {
  it('reports an unreachable backend clearly', async () => {
    const offline = await connect(new FlagshipApi('http://127.0.0.1:9', 'claude-code'));
    const result = await call('list_feature_flags', {}, offline);
    expect(result).toMatchObject({ isError: true, data: { code: 'UNAVAILABLE' } });
    expect(result.data.message).toContain('npm run dev');
  });

  it('reports malformed backend responses', async () => {
    const html = (async () => new Response('<html>oops</html>', { status: 502 })) as typeof fetch;
    const result = await call('list_feature_flags', {}, await connect(new FlagshipApi(apiUrl, 'claude-code', html)));
    expect(result).toMatchObject({ isError: true, data: { code: 'BAD_RESPONSE' } });
  });

  it('does not report a rollback without the audit id from the backend', async () => {
    const path = '/flags/order_tracking_v2/environments/development';
    const original = await api(path);
    const { data: plan } = await call('plan_configuration_change', {
      flagKey: 'order_tracking_v2', environment: 'development', changes: { defaultEnabled: !original.defaultEnabled },
    });
    const { data: applied } = await call('apply_configuration_change', plan.applyWith.arguments);
    const withoutHeader = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      const headers = new Headers(res.headers);
      headers.delete('x-audit-id');
      return new Response(await res.text(), { status: res.status, headers });
    }) as typeof fetch;
    const { data: rollbackPlan } = await call('plan_configuration_change', {
      flagKey: 'order_tracking_v2', environment: 'development', restoreFromAuditId: applied.auditId,
    });
    const result = await call('rollback_configuration_change', rollbackPlan.applyWith.arguments,
      await connect(new FlagshipApi(apiUrl, 'claude-code', withoutHeader)));
    expect(result).toMatchObject({ isError: true, data: { code: 'BAD_RESPONSE' } });
    expect(await api(path)).toEqual(original); // the rollback itself did go through
  });

  it('explains a misconfigured identity', async () => {
    const stranger = await connect(new FlagshipApi(apiUrl, 'mallory'));
    const result = await call('plan_configuration_change', { flagKey: 'new_search', environment: 'staging', changes: { enabled: true } }, stranger);
    expect(result).toMatchObject({ isError: true, data: { code: 'UNAUTHENTICATED' } });
    expect(result.data.message).toContain('FLAGSHIP_ACTOR_ID');
  });
});
