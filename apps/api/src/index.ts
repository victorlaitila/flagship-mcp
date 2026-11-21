import { createApp } from './app.js';
import { DATABASE_PATH, DYNAMODB_ENDPOINT, PORT, PRODUCTION_READ_ONLY, STORAGE, TABLE_NAME } from './config.js';
import { openDatabase } from './database/db.js';
import { createTable, dynamoClient, DynamoStore } from './database/dynamo-store.js';
import { seed } from './database/seed.js';
import { SqliteStore } from './database/sqlite-store.js';
import type { Store } from './database/store.js';
import { ChangeNotifier } from './events.js';
import { attachLiveUpdates } from './live.js';

async function openStore(): Promise<Store> {
  if (STORAGE === 'sqlite') return new SqliteStore(openDatabase(DATABASE_PATH));
  const client = dynamoClient(DYNAMODB_ENDPOINT);
  if (DYNAMODB_ENDPOINT) await createTable(client, TABLE_NAME).catch((e: Error) => { if (e.name !== 'ResourceInUseException') throw e; });
  return new DynamoStore(client, TABLE_NAME);
}

const store = await openStore();
if ((await store.revision()) === 0) {
  await seed(store);
  console.log('Seeded new database.');
}

const notifier = new ChangeNotifier();
const app = createApp({ store, notifier, now: () => new Date(), productionReadOnly: PRODUCTION_READ_ONLY });
const where = STORAGE === 'sqlite' ? `db: ${DATABASE_PATH}` : `DynamoDB table: ${TABLE_NAME}`;
const server = app.listen(PORT, 'localhost', () => console.log(`Flagship API listening on http://localhost:${PORT} (${where}${PRODUCTION_READ_ONLY ? ', Production read-only' : ''})`));
attachLiveUpdates(server, notifier);
