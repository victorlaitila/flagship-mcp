import type { Actor } from '@flagship/shared';
import { openDatabase } from '../src/database/db.js';
import { seed } from '../src/database/seed.js';
import { SqliteStore } from '../src/database/sqlite-store.js';
import { ACTORS } from '../src/demo.js';
import { ChangeNotifier } from '../src/events.js';
import type { ServiceContext } from '../src/services/context.js';

export const [developer, releaseManager, admin] = ACTORS as [Actor, Actor, Actor];

export async function seededContext({ productionReadOnly = false } = {}): Promise<ServiceContext & { notifier: ChangeNotifier }> {
  const store = new SqliteStore(openDatabase(':memory:'));
  await seed(store, Date.parse('2026-10-01T12:00:00Z'));
  return { store, notifier: new ChangeNotifier(), now: () => new Date('2026-10-31T12:00:00Z'), productionReadOnly };
}
