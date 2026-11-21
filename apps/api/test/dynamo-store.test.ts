import { randomUUID } from 'node:crypto';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTable, dynamoClient, DynamoStore } from '../src/database/dynamo-store.js';
import { seed } from '../src/database/seed.js';
import { admin } from './helpers.js';

// Runs only with `npm run test:dynamodb`; every other suite also runs against DynamoDB there.
describe.skipIf(process.env.STORAGE !== 'dynamodb')('DynamoDB store', () => {
  const client = dynamoClient(process.env.DYNAMODB_ENDPOINT);
  const bClient = dynamoClient(process.env.DYNAMODB_ENDPOINT);
  let table: string;
  // Two stores on one table, like two Lambda instances.
  let a: DynamoStore;
  let b: DynamoStore;

  beforeEach(async () => {
    table = `test_${randomUUID()}`;
    await createTable(client, table);
    a = new DynamoStore(client, table);
    b = new DynamoStore(bClient, table);
    await seed(a);
  });

  const renameCommit = async (store: DynamoStore, name: string, revision: number) => {
    const flag = (await store.getFlag('new_search'))!;
    return store.commit([{ type: 'putFlag', flag: { ...flag, name } }],
      { timestamp: '2026-11-01T00:00:00Z', actor: admin, operation: 'flag.updated', flagKey: flag.key, previous: flag, next: null }, revision);
  };

  it('sees changes committed by another instance', async () => {
    expect((await b.getFlag('new_search'))!.name).toBe('New search'); // b caches the state
    await renameCommit(a, 'Renamed by a', await a.revision());
    expect((await b.getFlag('new_search'))!.name).toBe('Renamed by a');
  });

  it('re-reads flags and segments only when the revision changes', async () => {
    const send = vi.spyOn(bClient, 'send');
    const queries = () => send.mock.calls.filter(([command]) => command instanceof QueryCommand).length;
    await b.listFlagsWithConfigs();
    await b.listSegments();
    await b.getFlag('new_search');
    expect(queries()).toBe(1);
    await renameCommit(a, 'Renamed', await a.revision());
    await b.listFlagsWithConfigs();
    expect(queries()).toBe(2);
    send.mockRestore();
  });

  it('lets only one of two instances commit on the same revision', async () => {
    const revision = await a.revision();
    const results = await Promise.allSettled([renameCommit(a, 'From a', revision), renameCommit(b, 'From b', revision)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } });
    expect(await a.revision()).toBe(revision + 1);
  });

  it('refuses to use a state where a flag has no configs instead of crashing on it', async () => {
    const flag = (await a.getFlag('new_search'))!;
    await client.send(new PutCommand({ TableName: table, Item: { pk: 'state', sk: 'flag#orphan', data: JSON.stringify({ ...flag, key: 'orphan' }), updatedAt: flag.updatedAt } }));
    await expect(b.listFlagsWithConfigs()).rejects.toThrow('could not read a consistent state');
  });
});
