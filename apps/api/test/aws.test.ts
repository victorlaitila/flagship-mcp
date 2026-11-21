import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyWebsocketEventV2, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionPublisher, Connections, MAX_CONNECTIONS } from '../src/aws/connections.js';
import { resetDynamo } from '../src/database/dynamo-reset.js';
import { createTable, dynamoClient, DynamoStore } from '../src/database/dynamo-store.js';
import { seed } from '../src/database/seed.js';
import { createFlag, listFlags, setFlagStatus } from '../src/services/flags.js';
import { listAudit } from '../src/services/audit.js';
import { ChangeNotifier } from '../src/events.js';
import type { ServiceContext } from '../src/services/context.js';
import { admin } from './helpers.js';

// Runs only with `npm run test:dynamodb`.
describe.skipIf(process.env.STORAGE !== 'dynamodb')('AWS handlers', () => {
  const client = dynamoClient(process.env.DYNAMODB_ENDPOINT);
  let table: string;

  beforeEach(async () => {
    table = `test_${randomUUID()}`;
    await createTable(client, table);
  });

  const context = (store: DynamoStore): ServiceContext =>
    ({ store, notifier: new ChangeNotifier(), now: () => new Date(), productionReadOnly: false });

  describe('connections', () => {
    it(`accepts at most ${MAX_CONNECTIONS} open connections, and a closed one frees its slot`, async () => {
      const connections = new Connections(client, table);
      for (let i = 0; i < MAX_CONNECTIONS; i++) expect(await connections.add(`c${i}`)).toBe(true);
      expect(await connections.add('one-too-many')).toBe(false);
      await connections.remove('c0');
      expect(await connections.add('next')).toBe(true);
    });

    it('stops counting a connection after API Gateway\'s 2-hour limit, even without a $disconnect', async () => {
      let now = Date.parse('2026-11-21T00:00:00Z');
      const connections = new Connections(client, table, () => now);
      for (let i = 0; i < MAX_CONNECTIONS; i++) await connections.add(`c${i}`);
      now += 2 * 60 * 60 * 1000 + 1000;
      expect(await connections.list()).toEqual([]);
      expect(await connections.add('fresh')).toBe(true);
    });

    it('sends each change to every connection and drops the ones that are gone', async () => {
      const connections = new Connections(client, table);
      for (const id of ['a', 'gone', 'broken']) await connections.add(id);
      const sent: string[] = [];
      const publisher = new ConnectionPublisher(connections, async (id, data) => {
        if (id === 'gone') throw Object.assign(new Error('gone'), { name: 'GoneException' });
        if (id === 'broken') throw new Error('network');
        sent.push(`${id}:${data}`);
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await publisher.publish({ entity: 'flag', flagKey: 'new_search', auditId: 7 });
      expect(sent).toEqual([`a:${JSON.stringify({ type: 'change', event: { entity: 'flag', flagKey: 'new_search', auditId: 7 } })}`]);
      expect((await connections.list()).sort()).toEqual(['a', 'broken']); // a failed send may be temporary
    });
  });

  describe('reset', () => {
    it('restores the seeded state, keeps live connections, and makes warm instances drop their cache', async () => {
      const seeded = new DynamoStore(client, table);
      await seed(seeded);
      const seededKeys = (await seeded.listFlagsWithConfigs()).map((f) => f.key);
      const seededAudit = (await seeded.listAudit()).length;
      // Vandalism, seen by a warm instance.
      const warm = new DynamoStore(client, table);
      await createFlag(context(warm), admin, { key: 'junk', name: 'Junk', type: 'boolean', owner: 'x', description: '', tags: [] });
      await setFlagStatus(context(warm), admin, 'loyalty_rewards', 'archived');
      const staleRevision = await warm.revision();
      await new Connections(client, table).add('open-tab');

      await resetDynamo(client, table);

      const flags = await listFlags(context(warm));
      expect(flags.map((f) => f.key)).toEqual(seededKeys);
      expect(flags.every((f) => f.status === 'active')).toBe(true);
      expect((await listAudit(context(warm), {})).length).toBe(seededAudit);
      expect(await warm.revision()).toBeGreaterThan(staleRevision); // never reused
      expect(await new Connections(client, table).list()).toEqual(['open-tab']);
      // A write checked against pre-reset data can't land.
      await expect(warm.commit([], { timestamp: '2026-11-21T03:00:00Z', actor: admin, operation: 'flag.updated', previous: null, next: null }, staleRevision))
        .rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('seeds an empty table (the first run after a deploy)', async () => {
      await resetDynamo(client, table);
      expect(await new DynamoStore(client, table).listFlagsWithConfigs()).toHaveLength(10);
    });
  });

  describe('Lambda entry', () => {
    const load = async (env: Record<string, string | undefined>) => {
      vi.resetModules();
      for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
      return import('../src/lambda.js');
    };
    const awsEnv = () => ({ STORAGE: 'dynamodb', TABLE_NAME: table, LIVE_CALLBACK_URL: 'http://127.0.0.1:9', PRODUCTION_READ_ONLY: 'true' });
    const httpEvent = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const [path, query = ''] = url.split('?');
      return {
        version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: query, isBase64Encoded: false,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        requestContext: { http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' }, routeKey: '$default', stage: '$default', requestId: 'r', timeEpoch: 0 },
      };
    };
    const wsEvent = (routeKey: string, connectionId: string) => ({ requestContext: { routeKey, connectionId } }) as unknown as APIGatewayProxyWebsocketEventV2;

    it('serves the API from DynamoDB, with Production read-only', async () => {
      const { api, reset } = await load({ ...awsEnv(), DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT });
      await reset();
      const flags = (await api(httpEvent('GET', '/api/flags'), {} as Context)) as { statusCode: number; body: string };
      expect(flags.statusCode).toBe(200);
      expect(JSON.parse(flags.body)).toHaveLength(10);
      const config = JSON.parse(flags.body).find((f: { key: string }) => f.key === 'new_search').environments.production;
      const put = (await api(httpEvent('PUT', '/api/flags/new_search/environments/production', { config: { ...config, enabled: !config.enabled }, confirmProduction: true }, { 'x-actor-id': 'sara' }), {} as Context)) as { statusCode: number };
      expect(put.statusCode).toBe(403);
      const audit = (await api(httpEvent('GET', '/api/audit?limit=3&flagKey=ai_recommendations'), {} as Context)) as { statusCode: number; body: string };
      expect(JSON.parse(audit.body).map((e: { flagKey: string }) => e.flagKey)).toEqual(['ai_recommendations', 'ai_recommendations', 'ai_recommendations']);
      vi.unstubAllEnvs();
    });

    it('registers and removes live connections', async () => {
      const { live } = await load({ ...awsEnv(), DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT });
      expect(await live(wsEvent('$connect', 'tab-1'))).toEqual({ statusCode: 200 });
      expect(await new Connections(client, table).list()).toEqual(['tab-1']);
      expect(await live(wsEvent('$disconnect', 'tab-1'))).toEqual({ statusCode: 200 });
      expect(await new Connections(client, table).list()).toEqual([]);
      vi.unstubAllEnvs();
    });

    it('refuses to start without DynamoDB or the WebSocket callback URL', async () => {
      await expect(load({ ...awsEnv(), STORAGE: 'sqlite' })).rejects.toThrow('need STORAGE=dynamodb');
      await expect(load({ ...awsEnv(), LIVE_CALLBACK_URL: undefined })).rejects.toThrow('need LIVE_CALLBACK_URL');
      vi.unstubAllEnvs();
    });
  });
});
