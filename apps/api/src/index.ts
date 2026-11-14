import { createApp } from './app.js';
import { DATABASE_PATH, PORT, PRODUCTION_READ_ONLY } from './config.js';
import { openDatabase } from './database/db.js';
import { isSeeded, seed } from './database/seed.js';
import { SqliteStore } from './database/sqlite-store.js';
import { ChangeNotifier } from './events.js';

const db = openDatabase(DATABASE_PATH);
const store = new SqliteStore(db);
if (!isSeeded(db)) {
  await seed(store);
  console.log('Seeded new database.');
}

const app = createApp({ store, notifier: new ChangeNotifier(), now: () => new Date(), productionReadOnly: PRODUCTION_READ_ONLY });
app.listen(PORT, 'localhost', () => console.log(`Flagship API listening on http://localhost:${PORT} (db: ${DATABASE_PATH}${PRODUCTION_READ_ONLY ? ', Production read-only' : ''})`));
