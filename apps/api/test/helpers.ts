import { randomUUID } from 'node:crypto';
import type { Actor } from '@flagship/shared';
import { openDatabase } from '../src/database/db.js';
import { createTable, dynamoClient, DynamoStore } from '../src/database/dynamo-store.js';
import { seed } from '../src/database/seed.js';
import { SqliteStore } from '../src/database/sqlite-store.js';
import { ACTORS } from '../src/demo.js';
import { ChangeNotifier } from '../src/events.js';
import type { ServiceContext } from '../src/services/context.js';

export const [developer, releaseManager, admin] = ACTORS as [Actor, Actor, Actor];

export async function seededContext({ productionReadOnly = false } = {}): Promise<ServiceContext & { notifier: ChangeNotifier }> {
  const store = await emptyStore();
  await seed(store, Date.parse('2026-10-01T12:00:00Z'));
  return { store, notifier: new ChangeNotifier(), now: () => new Date('2026-10-31T12:00:00Z'), productionReadOnly };
}

/** An empty store of the kind under test: SQLite in memory, or DynamoDB Local with `npm run test:dynamodb`. */
export const emptyStore = () => (process.env.STORAGE === 'dynamodb' ? newDynamoStore() : Promise.resolve(new SqliteStore(openDatabase(':memory:'))));

/** A fresh table on DynamoDB Local (`npm run test:dynamodb`). */
export async function newDynamoStore(table = `test_${randomUUID()}`) {
  const client = dynamoClient(process.env.DYNAMODB_ENDPOINT);
  await createTable(client, table);
  return new DynamoStore(client, table);
}
