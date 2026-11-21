import { rmSync } from 'node:fs';
import { DATABASE_PATH, DYNAMODB_ENDPOINT, STORAGE, TABLE_NAME } from '../config.js';
import { openDatabase } from './db.js';
import { resetDynamo } from './dynamo-reset.js';
import { createTableIfMissing, dynamoClient } from './dynamo-store.js';
import { seed } from './seed.js';
import { SqliteStore } from './sqlite-store.js';

if (STORAGE === 'dynamodb') {
  const client = dynamoClient(DYNAMODB_ENDPOINT);
  if (DYNAMODB_ENDPOINT) await createTableIfMissing(client, TABLE_NAME);
  await resetDynamo(client, TABLE_NAME);
  console.log(`DynamoDB table ${TABLE_NAME} reset and seeded`);
} else {
  for (const suffix of ['', '-wal', '-shm']) rmSync(DATABASE_PATH + suffix, { force: true });
  const db = openDatabase(DATABASE_PATH);
  await seed(new SqliteStore(db));
  db.close();
  console.log(`Database reset and seeded at ${DATABASE_PATH}`);
}
