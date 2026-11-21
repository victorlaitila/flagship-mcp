import { randomUUID } from 'node:crypto';
import { ENVIRONMENTS, type Actor, type FlagWithConfigs, type Segment, type SegmentReference, type SegmentWithUsage } from '@flagship/shared';
import { DEMO_USERS } from '../demo.js';
import { AppError, invalid, notFound } from '../errors.js';
import { userInSegment } from '../evaluation/engine.js';
import { LIMITS, validateSegment } from '../validation/validators.js';
import { assertCanManageGlobal, assertProductionWritable, publishChange, type ServiceContext } from './context.js';

function findReferences(flags: FlagWithConfigs[], segmentKey: string): SegmentReference[] {
  return flags.flatMap((flag) =>
    ENVIRONMENTS.flatMap((environment) =>
      flag.environments[environment].rules
        .filter((rule) => rule.conditions.some((c) => c.attribute === 'segment' && c.values.includes(segmentKey)))
        .map((rule) => ({ flagKey: flag.key, environment, ruleId: rule.id })),
    ),
  );
}

const withUsage = (segment: Segment, flags: FlagWithConfigs[]): SegmentWithUsage => ({
  ...segment,
  matchingDemoUserIds: DEMO_USERS.filter((u) => userInSegment(segment, u)).map((u) => u.userId),
  references: findReferences(flags, segment.key),
});

export async function listSegments(ctx: ServiceContext): Promise<SegmentWithUsage[]> {
  const [segments, flags] = await Promise.all([ctx.store.listSegments(), ctx.store.listFlagsWithConfigs()]);
  return segments.map((s) => withUsage(s, flags));
}

async function requireSegment(ctx: ServiceContext, key: string): Promise<Segment> {
  const segment = await ctx.store.getSegment(key);
  if (!segment) throw notFound(`Segment "${key}"`);
  return segment;
}

export async function getSegment(ctx: ServiceContext, key: string): Promise<SegmentWithUsage> {
  return withUsage(await requireSegment(ctx, key), await ctx.store.listFlagsWithConfigs());
}

export async function createSegment(ctx: ServiceContext, actor: Actor, input: unknown): Promise<SegmentWithUsage> {
  assertCanManageGlobal(actor, 'manage segments (they apply to every environment)');
  const revision = await ctx.store.revision();
  const segments = await ctx.store.listSegments();
  if (segments.length >= LIMITS.segments) {
    throw new AppError('CONFLICT', `Flagship allows at most ${LIMITS.segments} segments. Delete an unused one first.`);
  }
  const existing = new Set(segments.map((s) => s.key));
  const { value, issues } = validateSegment(input, existing, null);
  if (!value) throw invalid(issues);
  const timestamp = ctx.now().toISOString();
  const segment: Segment = { id: randomUUID(), ...value, createdAt: timestamp, updatedAt: timestamp };
  const auditId = await ctx.store.commit([{ type: 'putSegment', segment }],
    { timestamp, actor, operation: 'segment.created', segmentKey: segment.key, previous: null, next: segment }, revision);
  await publishChange(ctx, { entity: 'segment', segmentKey: segment.key, auditId });
  return withUsage(segment, await ctx.store.listFlagsWithConfigs());
}

export async function updateSegment(ctx: ServiceContext, actor: Actor, key: string, input: unknown): Promise<SegmentWithUsage> {
  assertCanManageGlobal(actor, 'manage segments (they apply to every environment)');
  const revision = await ctx.store.revision();
  const previous = await requireSegment(ctx, key);
  // Production rules that use the segment would change with it.
  const flags = await ctx.store.listFlagsWithConfigs();
  if (findReferences(flags, key).some((r) => r.environment === 'production')) assertProductionWritable(ctx);
  const { value, issues } = validateSegment(input, new Set(), key);
  if (!value) throw invalid(issues);
  const next: Segment = { ...previous, ...value, key, updatedAt: ctx.now().toISOString() };
  const auditId = await ctx.store.commit([{ type: 'putSegment', segment: next }],
    { timestamp: next.updatedAt, actor, operation: 'segment.updated', segmentKey: key, previous, next }, revision);
  await publishChange(ctx, { entity: 'segment', segmentKey: key, auditId });
  return withUsage(next, flags);
}

/** Referenced segments cannot be deleted: rules would silently stop matching. */
export async function deleteSegment(ctx: ServiceContext, actor: Actor, key: string): Promise<void> {
  assertCanManageGlobal(actor, 'manage segments (they apply to every environment)');
  const revision = await ctx.store.revision();
  const segment = await requireSegment(ctx, key);
  const refs = findReferences(await ctx.store.listFlagsWithConfigs(), key);
  if (refs.length > 0) {
    throw new AppError('CONFLICT', `Segment "${key}" is used by ${refs.length} targeting rule(s). Remove those rules first.`, undefined, { references: refs });
  }
  const auditId = await ctx.store.commit([{ type: 'deleteSegment', segment }],
    { timestamp: ctx.now().toISOString(), actor, operation: 'segment.deleted', segmentKey: key, previous: segment, next: null }, revision);
  await publishChange(ctx, { entity: 'segment', segmentKey: key, auditId });
}
