import type { Actor } from '@flagship/shared';
import { openDatabase } from '../src/database/db.js';
import { seed } from '../src/database/seed.js';
import { ACTORS } from '../src/demo.js';
import { ChangeNotifier } from '../src/events.js';
import type { ServiceContext } from '../src/services/context.js';

export const [developer, releaseManager, admin] = ACTORS as [Actor, Actor, Actor];

export function seededContext(): ServiceContext {
  const db = openDatabase(':memory:');
  seed(db, Date.parse('2026-10-01T12:00:00Z'));
  return { db, notifier: new ChangeNotifier(), now: () => new Date('2026-10-31T12:00:00Z') };
}
