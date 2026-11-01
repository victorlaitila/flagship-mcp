import { rmSync } from 'node:fs';
import { DATABASE_PATH } from '../config.js';
import { openDatabase } from './db.js';
import { seed } from './seed.js';

for (const suffix of ['', '-wal', '-shm']) rmSync(DATABASE_PATH + suffix, { force: true });
const db = openDatabase(DATABASE_PATH);
seed(db);
db.close();
console.log(`Database reset and seeded at ${DATABASE_PATH}`);
