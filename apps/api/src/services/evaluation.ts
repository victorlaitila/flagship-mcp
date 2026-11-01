import { ENVIRONMENTS, type Environment, type EvaluationResult, type UserContext } from '@flagship/shared';
import type { Db } from '../database/db.js';
import { DEMO_USERS } from '../demo.js';
import { AppError, notFound } from '../errors.js';
import { evaluateFlag, type EvaluationSnapshot } from '../evaluation/engine.js';
import { listConfigs, listFlags } from '../repositories/flags.js';
import { listSegments } from '../repositories/segments.js';

export function loadSnapshot(db: Db): EvaluationSnapshot {
  return {
    flags: new Map(listFlags(db).map((f) => [f.key, f])),
    configs: listConfigs(db),
    segments: new Map(listSegments(db).map((s) => [s.key, s])),
  };
}

export function parseEnvironment(value: unknown): Environment {
  if (!ENVIRONMENTS.includes(value as Environment)) {
    throw new AppError('BAD_REQUEST', `Unknown environment "${String(value)}". Use one of: ${ENVIRONMENTS.join(', ')}.`);
  }
  return value as Environment;
}

/** Accepts a demo user id (attributes filled in) or a full user context. */
export function resolveUser(input: unknown): UserContext {
  const raw = (typeof input === 'string' ? { userId: input } : input) as Partial<UserContext> | null;
  if (!raw || typeof raw.userId !== 'string' || raw.userId === '') {
    throw new AppError('BAD_REQUEST', 'A user with a userId is required.');
  }
  const demo = DEMO_USERS.find((u) => u.userId === raw.userId);
  if (raw.country === undefined && raw.accountType === undefined) {
    if (!demo) throw new AppError('BAD_REQUEST', `Unknown demo user "${raw.userId}". Pass country and accountType for other users.`);
    return { userId: demo.userId, country: demo.country, accountType: demo.accountType };
  }
  if (typeof raw.country !== 'string' || typeof raw.accountType !== 'string') {
    throw new AppError('BAD_REQUEST', 'country and accountType must be strings.');
  }
  return { userId: raw.userId, country: raw.country, accountType: raw.accountType };
}

export function evaluateOne(db: Db, flagKey: string, environment: Environment, user: UserContext): EvaluationResult {
  const result = evaluateFlag(loadSnapshot(db), flagKey, environment, user);
  if (!result) throw notFound(`Flag "${flagKey}"`);
  return result;
}

export function evaluateAll(db: Db, environment: Environment, user: UserContext): EvaluationResult[] {
  const snapshot = loadSnapshot(db);
  return [...snapshot.flags.keys()].map((key) => evaluateFlag(snapshot, key, environment, user)!);
}
