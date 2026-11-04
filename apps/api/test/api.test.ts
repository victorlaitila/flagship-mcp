import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { seededContext } from './helpers.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp(seededContext()).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const call = async (path: string, init: RequestInit & { actor?: string; json?: unknown } = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.actor ? { 'x-actor-id': init.actor } : {}) },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  return { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() };
};

describe('REST API', () => {
  it('lists the ten seeded flags with all environment configs', async () => {
    const { status, body } = await call('/flags');
    expect(status).toBe(200);
    expect(body).toHaveLength(10);
    expect(Object.keys(body[0].environments)).toEqual(['development', 'staging', 'production']);
  });

  it('evaluates all flags for a demo user with structured results', async () => {
    const { body } = await call('/evaluate?environment=production&userId=u_emma');
    expect(body.find((r: { flagKey: string }) => r.flagKey === 'new_payment_api')).toMatchObject({
      enabled: false, reason: 'TARGETING_EXCLUDED', match: { type: 'rule', ruleId: 'r_us' },
    });
  });

  it('evaluates a single flag for an arbitrary user context', async () => {
    const { body } = await call('/evaluate/free_shipping_banner', {
      method: 'POST', json: { environment: 'production', user: { userId: 'x', country: 'SE', accountType: 'regular' } },
    });
    expect(body).toMatchObject({ flagKey: 'free_shipping_banner', enabled: true, reason: 'TARGETING_MATCH' });
  });

  it('returns structured errors', async () => {
    expect((await call('/evaluate?environment=qa&userId=u_emma')).body.error.code).toBe('BAD_REQUEST');
    expect((await call('/flags/nope')).status).toBe(404);
    const unauth = await call('/flags/new_search/environments/development', { method: 'PUT', json: { config: {} } });
    expect(unauth).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    const invalid = await call('/flags/new_search/environments/development', { method: 'PUT', actor: 'leo', json: {
      config: { enabled: true, variantWeights: { basic: 10, enhanced: 10 }, rules: [], prerequisites: [] },
    } });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.issues[0]).toMatchObject({ path: 'variantWeights' });
  });

  it('updates a config, audits it and rolls it back over HTTP', async () => {
    const { body: current } = await call('/flags/new_search/environments/production');
    const forbidden = await call('/flags/new_search/environments/production', { method: 'PUT', actor: 'ida', json: { config: current } });
    expect(forbidden.status).toBe(403);
    const unconfirmed = await call('/flags/new_search/environments/production', { method: 'PUT', actor: 'sara',
      json: { config: { ...current, variantWeights: { basic: 50, enhanced: 50 } } } });
    expect(unconfirmed.status).toBe(428);
    const ok = await call('/flags/new_search/environments/production', { method: 'PUT', actor: 'sara',
      json: { config: { ...current, variantWeights: { basic: 50, enhanced: 50 } }, confirmProduction: true } });
    expect(ok.body.variantWeights).toEqual({ basic: 50, enhanced: 50 });

    const { body: [entry] } = await call('/audit?flagKey=new_search&environment=production&operation=config.updated');
    expect(entry.next.variantWeights).toEqual({ basic: 50, enhanced: 50 });
    const rolled = await call(`/audit/${entry.id}/rollback`, { method: 'POST', actor: 'sara', json: { confirmProduction: true } });
    expect(rolled.body).toEqual(current);
  });

  it('previews without persisting', async () => {
    const { body: current } = await call('/flags/order_tracking_v2/environments/production');
    const { body } = await call('/flags/order_tracking_v2/environments/production/preview', {
      method: 'POST', json: { config: { ...current, defaultEnabled: true }, userIds: ['u_aino', 'u_jonas'] },
    });
    expect(body.results.map((r: { changed: boolean }) => r.changed)).toEqual([true, false]);
    expect((await call('/flags/order_tracking_v2/environments/production')).body).toEqual(current);
  });

  it('manages segments', async () => {
    const created = await call('/segments', { method: 'POST', actor: 'sara', json: {
      key: 'swedish_customers', name: 'Swedish Customers', conditions: [{ attribute: 'country', operator: 'equals', values: ['SE'] }],
    } });
    expect(created.body.matchingDemoUserIds).toEqual(['u_jonas']);
    expect((await call('/segments/swedish_customers', { method: 'DELETE', actor: 'sara' })).status).toBe(204);
    const blocked = await call('/segments/beta_testers', { method: 'DELETE', actor: 'sara' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.references.length).toBeGreaterThan(0);
  });

  it('accepts the hidden Claude Code service actor without listing it in the dashboard', async () => {
    expect((await call('/whoami', { actor: 'claude-code' })).body).toEqual({ id: 'claude-code', name: 'Claude Code', role: 'release_manager' });
    expect((await call('/actors')).body.map((a: { id: string }) => a.id)).not.toContain('claude-code');
    expect((await call('/whoami')).status).toBe(401);
  });

  it('returns the audit id of a write and rejects stale proposals', async () => {
    const path = '/flags/order_tracking_v2/environments/staging';
    const { body: current } = await call(path);
    const ok = await call(path, { method: 'PUT', actor: 'claude-code',
      json: { config: { ...current, defaultEnabled: !current.defaultEnabled }, expectedConfig: current } });
    expect(ok.status).toBe(200);
    const auditId = Number(ok.headers.get('x-audit-id'));
    const { body: [entry] } = await call('/audit?actorId=claude-code&limit=1');
    expect(entry).toMatchObject({ id: auditId, actorName: 'Claude Code', flagKey: 'order_tracking_v2', environment: 'staging' });

    // `current` is now stale: the write must be rejected and nothing audited.
    const stale = await call(path, { method: 'PUT', actor: 'claude-code', json: { config: current, expectedConfig: current } });
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
    expect((await call('/audit?actorId=claude-code')).body).toHaveLength(1);

    const rolled = await call(`/audit/${auditId}/rollback`, { method: 'POST', actor: 'claude-code' });
    expect(rolled.body).toEqual(current);
    const rollbackId = Number(rolled.headers.get('x-audit-id'));
    expect((await call(`/audit/${rollbackId}`)).body).toMatchObject({ id: rollbackId, operation: 'config.rolled_back', rollbackOf: auditId, next: current });
    expect((await call('/audit/999999')).status).toBe(404);
    expect((await call('/audit/abc')).status).toBe(400);
  });

  it('previews the normalized configuration that saving would store', async () => {
    const preview = async (key: string, config: unknown) =>
      (await call(`/flags/${key}/environments/staging/preview`, { method: 'POST', json: { config } })).body;
    const { body: boolean } = await call('/flags/new_payment_api/environments/staging');
    expect((await preview('new_payment_api', { ...boolean, rolloutPercentage: 50 })).config).toEqual(boolean);
    const { body: percentage } = await call('/flags/ai_recommendations/environments/staging');
    expect((await preview('ai_recommendations', { ...percentage, rolloutPercentage: 33.333 })).config.rolloutPercentage).toBe(33.33);
    expect(await preview('ai_recommendations', { ...percentage, rolloutPercentage: -5 })).toMatchObject({ valid: false, config: null });
  });

  it('rejects a rollback whose expected configuration is stale and keeps the newer change', async () => {
    const path = '/flags/loyalty_rewards/environments/development';
    const { body: original } = await call(path);
    const changed = await call(path, { method: 'PUT', actor: 'leo', json: { config: { ...original, defaultEnabled: !original.defaultEnabled } } });
    const auditId = changed.headers.get('x-audit-id');
    const { body: inspected } = await call(path);
    const { body: newer } = await call(path, { method: 'PUT', actor: 'leo', json: { config: { ...inspected, enabled: !inspected.enabled } } });

    const stale = await call(`/audit/${auditId}/rollback`, { method: 'POST', actor: 'leo', json: { expectedConfig: inspected } });
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
    expect((await call(path)).body).toEqual(newer);
    expect((await call(`/audit/${auditId}/rollback`, { method: 'POST', actor: 'leo', json: { expectedConfig: newer } })).status).toBe(200);
  });

  it('compares a chosen pair of environments', async () => {
    const { body: pair } = await call('/environments/compare?environments=staging,production');
    const { body: all } = await call('/environments/compare');
    const diff = (rows: { flag: { key: string }; differences: string[] }[], key: string) => rows.find((r) => r.flag.key === key)!.differences;
    // free_shipping_banner's default only differs in development.
    expect(diff(all, 'free_shipping_banner')).toEqual(['default', 'rules']);
    expect(diff(pair, 'free_shipping_banner')).toEqual(['rules']);
    expect((await call('/environments/compare?environments=staging')).status).toBe(400);
    expect((await call('/environments/compare?environments=staging,qa')).status).toBe(400);
  });

  it('streams change events over SSE', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/events`, { signal: controller.signal });
    const reader = res.body!.getReader();
    const { body: current } = await call('/flags/cart_redesign/environments/development');
    await call('/flags/cart_redesign/environments/development', { method: 'PUT', actor: 'leo',
      json: { config: { ...current, variantWeights: { classic: 50, redesigned: 50 } } } });
    let text = '';
    while (!text.includes('event: change')) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).toContain('"flagKey":"cart_redesign"');
  });
});
