import { randomUUID } from 'node:crypto';
import { ENVIRONMENTS, type Actor, type Segment, type SegmentReference, type SegmentWithUsage } from '@flagship/shared';
import { transaction } from '../database/db.js';
import { DEMO_USERS } from '../demo.js';
import { AppError, invalid, notFound } from '../errors.js';
import { userInSegment } from '../evaluation/engine.js';
import { insertAuditEntry } from '../repositories/audit.js';
import { listFlagsWithConfigs } from '../repositories/flags.js';
import * as repo from '../repositories/segments.js';
import { validateSegment } from '../validation/validators.js';
import { assertCanManageGlobal, type ServiceContext } from './context.js';

function findReferences(ctx: ServiceContext, segmentKey: string): SegmentReference[] {
  return listFlagsWithConfigs(ctx.db).flatMap((flag) =>
    ENVIRONMENTS.flatMap((environment) =>
      flag.environments[environment].rules
        .filter((rule) => rule.conditions.some((c) => c.attribute === 'segment' && c.values.includes(segmentKey)))
        .map((rule) => ({ flagKey: flag.key, environment, ruleId: rule.id })),
    ),
  );
}

const withUsage = (ctx: ServiceContext, segment: Segment): SegmentWithUsage => ({
  ...segment,
  matchingDemoUserIds: DEMO_USERS.filter((u) => userInSegment(segment, u)).map((u) => u.userId),
  references: findReferences(ctx, segment.key),
});

export function listSegments(ctx: ServiceContext): SegmentWithUsage[] {
  return repo.listSegments(ctx.db).map((s) => withUsage(ctx, s));
}

function requireSegment(ctx: ServiceContext, key: string): Segment {
  const segment = repo.getSegment(ctx.db, key);
  if (!segment) throw notFound(`Segment "${key}"`);
  return segment;
}

export function getSegment(ctx: ServiceContext, key: string): SegmentWithUsage {
  return withUsage(ctx, requireSegment(ctx, key));
}

export function createSegment(ctx: ServiceContext, actor: Actor, input: unknown): SegmentWithUsage {
  assertCanManageGlobal(actor, 'manage segments (they apply to every environment)');
  const existing = new Set(repo.listSegments(ctx.db).map((s) => s.key));
  const { value, issues } = validateSegment(input, existing, null);
  if (!value) throw invalid(issues);
  const timestamp = ctx.now().toISOString();
  const segment: Segment = { id: randomUUID(), ...value, createdAt: timestamp, updatedAt: timestamp };
  const auditId = transaction(ctx.db, () => {
    repo.upsertSegment(ctx.db, segment);
    return insertAuditEntry(ctx.db, { timestamp, actor, operation: 'segment.created', segmentKey: segment.key, previous: null, next: segment });
  });
  ctx.notifier.publish({ entity: 'segment', segmentKey: segment.key, auditId });
  return withUsage(ctx, segment);
}

export function updateSegment(ctx: ServiceContext, actor: Actor, key: string, input: unknown): SegmentWithUsage {
  assertCanManageGlobal(actor, 'manage segments (they apply to every environment)');
  const previous = requireSegment(ctx, key);
  const { value, issues } = validateSegment(input, new Set(), key);
  if (!value) throw invalid(issues);
  const next: Segment = { ...previous, ...value, key, updatedAt: ctx.now().toISOString() };
  const auditId = transaction(ctx.db, () => {
    repo.upsertSegment(ctx.db, next);
    return insertAuditEntry(ctx.db, { timestamp: next.updatedAt, actor, operation: 'segment.updated', segmentKey: key, previous, next });
  });
  ctx.notifier.publish({ entity: 'segment', segmentKey: key, auditId });
  return withUsage(ctx, next);
}

/** Referenced segments cannot be deleted: rules would silently stop matching. */
export function deleteSegment(ctx: ServiceContext, actor: Actor, key: string): void {
  assertCanManageGlobal(actor, 'manage segments (they apply to every environment)');
  const segment = requireSegment(ctx, key);
  const refs = findReferences(ctx, key);
  if (refs.length > 0) {
    throw new AppError('CONFLICT', `Segment "${key}" is used by ${refs.length} targeting rule(s). Remove those rules first.`, undefined, { references: refs });
  }
  const auditId = transaction(ctx.db, () => {
    repo.deleteSegment(ctx.db, segment.id);
    return insertAuditEntry(ctx.db, { timestamp: ctx.now().toISOString(), actor, operation: 'segment.deleted', segmentKey: key, previous: segment, next: null });
  });
  ctx.notifier.publish({ entity: 'segment', segmentKey: key, auditId });
}
