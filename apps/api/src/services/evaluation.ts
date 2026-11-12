import { ENVIRONMENTS, type Environment, type EvaluationResult, type UserContext } from '@flagship/shared';
import type { Store } from '../database/store.js';
import { DEMO_USERS } from '../demo.js';
import { AppError, notFound } from '../errors.js';
import { evaluateFlag, type EvaluationSnapshot } from '../evaluation/engine.js';

export async function loadSnapshot(store: Store): Promise<EvaluationSnapshot> {
  const [flags, segments] = await Promise.all([store.listFlagsWithConfigs(), store.listSegments()]);
  return {
    flags: new Map(flags.map((f) => [f.key, f])),
    configs: new Map(flags.map((f) => [f.key, f.environments])),
    segments: new Map(segments.map((s) => [s.key, s])),
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

export async function evaluateOne(store: Store, flagKey: string, environment: Environment, user: UserContext): Promise<EvaluationResult> {
  const result = evaluateFlag(await loadSnapshot(store), flagKey, environment, user);
  if (!result) throw notFound(`Flag "${flagKey}"`);
  return result;
}

export async function evaluateAll(store: Store, environment: Environment, user: UserContext): Promise<EvaluationResult[]> {
  const snapshot = await loadSnapshot(store);
  return [...snapshot.flags.keys()].map((key) => evaluateFlag(snapshot, key, environment, user)!);
}
