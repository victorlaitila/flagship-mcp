import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../api/src/app.js';
import { seededContext } from '../../api/test/helpers.js';

// The real entry point (src/index.ts) as a separate process over stdio, started the way `.mcp.json`
// starts it, against the real API on a fresh in-memory database. tools.test.ts covers tool behaviour
// in depth; this covers what only the real process shows: env configuration, stdout hygiene, wiring.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
let httpServer: Server;
let apiUrl: string;
const clients: Client[] = [];

async function start(env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['--no-install', 'tsx', 'apps/mcp/src/index.ts'],
    cwd: ROOT,
    env: { ...process.env, FLAGSHIP_API_URL: apiUrl, ...env } as Record<string, string>,
    stderr: 'pipe',
  });
  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport); // fails if anything but protocol messages appears on stdout
  clients.push(client);
  return { client, stderr };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: any }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, data: JSON.parse((result.content as { text: string }[])[0].text) };
}

const api = async (path: string) => (await fetch(`${apiUrl}/api${path}`)).json();

beforeAll(async () => {
  httpServer = createApp(seededContext()).listen(0);
  await new Promise((resolve) => httpServer.once('listening', resolve));
  apiUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('MCP server over stdio', () => {
  it('starts with its tools and instructions, and logs only to stderr', async () => {
    const { client, stderr } = await start();
    expect((await client.listTools()).tools).toHaveLength(8);
    expect(client.getInstructions()).toContain('Production is read-only');
    expect(stderr.join('')).toContain(`[flagship-mcp] ready (api: ${apiUrl}, identity: claude-code)`);
  });

  it('plans, applies and rolls back a change through the real process, audited as Claude Code', async () => {
    const { client } = await start();
    const path = '/flags/ai_recommendations/environments/staging';
    const original = await api(path);

    const { data: plan } = await call(client, 'plan_configuration_change', { flagKey: 'ai_recommendations', environment: 'staging', changes: { rolloutPercentage: 80 } });
    const { data: applied } = await call(client, 'apply_configuration_change', plan.applyWith.arguments);
    expect(applied.status).toBe('applied');
    expect(await api(`/audit/${applied.auditId}`)).toMatchObject({ actorId: 'claude-code', actorName: 'Claude Code' });

    const { data: rollbackPlan } = await call(client, 'plan_configuration_change', { flagKey: 'ai_recommendations', environment: 'staging', restoreFromAuditId: applied.auditId });
    expect((await call(client, 'rollback_configuration_change', rollbackPlan.applyWith.arguments)).data.status).toBe('rolled_back');
    expect(await api(path)).toEqual(original);

    expect(await call(client, 'apply_configuration_change', { ...plan.applyWith.arguments, environment: 'production' }))
      .toMatchObject({ isError: true, data: { code: 'PRODUCTION_READ_ONLY' } });
  });

  it('takes its API URL (trailing slash tolerated) and identity from the environment', async () => {
    const { client, stderr } = await start({ FLAGSHIP_API_URL: `${apiUrl}/`, FLAGSHIP_ACTOR_ID: 'leo' });
    const { data } = await call(client, 'plan_configuration_change', { flagKey: 'new_search', environment: 'staging', changes: { enabled: false } });
    expect(data.permission).toEqual({ canApply: false, reason: 'Leo Nieminen (Developer) cannot change Staging.' });
    expect(stderr.join('')).toContain('identity: leo');
  });

  it('starts without an API and explains how to start it', async () => {
    const { client } = await start({ FLAGSHIP_API_URL: 'http://localhost:9' });
    const result = await call(client, 'list_feature_flags');
    expect(result).toMatchObject({ isError: true, data: { code: 'UNAVAILABLE' } });
    expect(result.data.message).toContain('npm run dev');
  });
}, 60_000);
