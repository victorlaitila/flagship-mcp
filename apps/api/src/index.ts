import { createApp } from './app.js';
import { DATABASE_PATH, PORT } from './config.js';
import { openDatabase } from './database/db.js';
import { isSeeded, seed } from './database/seed.js';
import { ChangeNotifier } from './events.js';

const db = openDatabase(DATABASE_PATH);
if (!isSeeded(db)) {
  seed(db);
  console.log('Seeded new database.');
}

const app = createApp({ db, notifier: new ChangeNotifier(), now: () => new Date() });
app.listen(PORT, () => console.log(`Flagship API listening on http://localhost:${PORT} (db: ${DATABASE_PATH})`));
