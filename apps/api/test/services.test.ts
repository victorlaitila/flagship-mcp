import type { ChangeEvent, EnvironmentConfig, Segment } from '@flagship/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { listAudit, rollback } from '../src/services/audit.js';
import type { ServiceContext } from '../src/services/context.js';
import { evaluateOne } from '../src/services/evaluation.js';
import { applyConfig, compareEnvironments, createFlag, getFlag, previewConfig, setFlagStatus } from '../src/services/flags.js';
import { createSegment, deleteSegment, listSegments, updateSegment } from '../src/services/segments.js';
import { admin, developer, releaseManager, seededContext } from './helpers.js';

let ctx: ServiceContext;
beforeEach(async () => {
  ctx = await seededContext();
});

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};
const config = async (key: string, env: 'development' | 'staging' | 'production') => (await getFlag(ctx, key)).environments[env];

describe('permissions', () => {
  const disable = async (env: 'development' | 'staging' | 'production') => ({ ...(await config('loyalty_program', env)), enabled: false });

  it('lets developers manage only development', async () => {
    expect(await errorCode(applyConfig(ctx, developer, 'loyalty_program', 'development', await disable('development'), false))).toBeNull();
    expect(await errorCode(applyConfig(ctx, developer, 'loyalty_program', 'staging', await disable('staging'), false))).toBe('FORBIDDEN');
    expect(await errorCode(applyConfig(ctx, developer, 'loyalty_program', 'production', await disable('production'), true))).toBe('FORBIDDEN');
  });

  it('lets release managers manage development and staging', async () => {
    expect(await errorCode(applyConfig(ctx, releaseManager, 'loyalty_program', 'staging', await disable('staging'), false))).toBeNull();
    expect(await errorCode(applyConfig(ctx, releaseManager, 'loyalty_program', 'production', await disable('production'), true))).toBe('FORBIDDEN');
  });

  it('requires explicit confirmation for production, even for admins', async () => {
    expect(await errorCode(applyConfig(ctx, admin, 'loyalty_program', 'production', await disable('production'), undefined))).toBe('CONFIRMATION_REQUIRED');
    expect((await config('loyalty_program', 'production')).enabled).toBe(true);
    await applyConfig(ctx, admin, 'loyalty_program', 'production', await disable('production'), true);
    expect((await config('loyalty_program', 'production')).enabled).toBe(false);
  });

  it('restricts archiving and segment edits to admins', async () => {
    expect(await errorCode(setFlagStatus(ctx, releaseManager, 'free_shipping_banner', 'archived'))).toBe('FORBIDDEN');
    expect(await errorCode(updateSegment(ctx, developer, 'beta_testers', { name: 'x', conditions: [] }))).toBe('FORBIDDEN');
  });
});

describe('config updates', () => {
  it('rejects invalid configs without persisting', async () => {
    const before = await config('ai_recommendations', 'development');
    expect(await errorCode(applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...before, rolloutPercentage: 150 }, false)))
      .toBe('VALIDATION_FAILED');
    expect(await config('ai_recommendations', 'development')).toEqual(before);
  });

  it('prevents circular prerequisites across flags', async () => {
    const payment = await config('new_payment_api', 'development');
    expect(await errorCode(applyConfig(ctx, developer, 'new_payment_api', 'development', { ...payment, prerequisites: ['new_checkout'] }, false)))
      .toBe('VALIDATION_FAILED');
  });

  it('changes evaluation for the storefront and notifies listeners', async () => {
    const events: ChangeEvent[] = [];
    ctx.notifier.subscribe((e) => events.push(e));
    expect((await evaluateOne(ctx.store, 'loyalty_program', 'development', { userId: 'u_emma', country: 'US', accountType: 'regular' })).enabled).toBe(true);
    await applyConfig(ctx, developer, 'loyalty_program', 'development', { ...(await config('loyalty_program', 'development')), enabled: false }, false);
    const result = await evaluateOne(ctx.store, 'loyalty_rewards', 'development', { userId: 'u_emma', country: 'US', accountType: 'regular' });
    expect(result).toMatchObject({ enabled: false, reason: 'PREREQUISITE_FAILED' });
    expect(events).toEqual([expect.objectContaining({ entity: 'config', flagKey: 'loyalty_program', environment: 'development' })]);
  });

  it('writes no audit entry when nothing changed', async () => {
    const count = (await listAudit(ctx, {})).length;
    await applyConfig(ctx, developer, 'loyalty_program', 'development', await config('loyalty_program', 'development'), false);
    expect((await listAudit(ctx, {})).length).toBe(count);
  });
});

describe('audit and rollback', () => {
  it('records previous and new configuration for every change', async () => {
    const previous = await config('ai_recommendations', 'staging');
    await applyConfig(ctx, releaseManager, 'ai_recommendations', 'staging', { ...previous, rolloutPercentage: 75 }, false);
    const [entry] = await listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'staging' });
    expect(entry).toMatchObject({
      operation: 'config.updated', actorId: releaseManager.id, actorRole: 'release_manager', previous,
      next: { ...previous, rolloutPercentage: 75 },
    });
  });

  it('restores the previous config as a new entry and keeps history intact', async () => {
    const original = await config('ai_recommendations', 'development');
    await applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...original, rolloutPercentage: 5 }, false);
    const [change] = await listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'development' });
    const historyBefore = await listAudit(ctx, {});

    await rollback(ctx, developer, change.id, false);

    expect(await config('ai_recommendations', 'development')).toEqual(original);
    const historyAfter = await listAudit(ctx, {});
    expect(historyAfter.length).toBe(historyBefore.length + 1);
    expect(historyAfter.slice(1)).toEqual(historyBefore);
    expect(historyAfter[0]).toMatchObject({ operation: 'config.rolled_back', rollbackOf: change.id, previous: { rolloutPercentage: 5 }, next: original });
  });

  it('applies permissions and confirmation to rollbacks', async () => {
    const [seeded] = await listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'production' });
    expect(await errorCode(rollback(ctx, releaseManager, seeded.id, true))).toBe('FORBIDDEN');
    expect(await errorCode(rollback(ctx, admin, seeded.id, false))).toBe('CONFIRMATION_REQUIRED');
    await rollback(ctx, admin, seeded.id, true);
    expect((await config('ai_recommendations', 'production')).rolloutPercentage).toBe(10);
  });

  it('refuses to roll back non-config entries or no-op rollbacks', async () => {
    const [created] = await listAudit(ctx, { operation: 'flag.created', limit: 1 });
    expect(await errorCode(rollback(ctx, admin, created.id, true))).toBe('BAD_REQUEST');
    const [seeded] = await listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'production' });
    await rollback(ctx, admin, seeded.id, true);
    expect(await errorCode(rollback(ctx, admin, seeded.id, true))).toBe('CONFLICT');
  });
});

describe('flags and segments', () => {
  it('creates flags disabled in every environment', async () => {
    const flag = await createFlag(ctx, developer, { key: 'dark_mode', name: 'Dark mode', type: 'boolean', owner: 'Web', tags: ['UI'] });
    expect(Object.values(flag.environments).every((c: EnvironmentConfig) => !c.enabled)).toBe(true);
    expect(flag.tags).toEqual(['ui']);
    expect(await errorCode(createFlag(ctx, developer, { key: 'dark_mode', name: 'x', type: 'boolean', owner: 'x' }))).toBe('VALIDATION_FAILED');
  });

  it('blocks archiving flags that are prerequisites of active flags', async () => {
    expect(await errorCode(setFlagStatus(ctx, admin, 'loyalty_program', 'archived'))).toBe('CONFLICT');
    expect((await setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived', true)).status).toBe('archived');
    expect((await evaluateOne(ctx.store, 'free_shipping_banner', 'development', { userId: 'u_aino', country: 'FI', accountType: 'regular' })).reason)
      .toBe('FLAG_ARCHIVED');
  });

  it('requires Production confirmation to archive or restore a flag enabled in Production', async () => {
    expect(await errorCode(setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived'))).toBe('CONFIRMATION_REQUIRED');
    expect((await getFlag(ctx, 'free_shipping_banner')).status).toBe('active');
    await setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived', true);
    expect(await errorCode(setFlagStatus(ctx, admin, 'free_shipping_banner', 'active'))).toBe('CONFIRMATION_REQUIRED');
    expect((await setFlagStatus(ctx, admin, 'free_shipping_banner', 'active', true)).status).toBe('active');
    // loyalty_rewards is disabled in Production, so archiving it doesn't change Production.
    expect((await setFlagStatus(ctx, admin, 'loyalty_rewards', 'archived')).status).toBe('archived');
  });

  it('blocks restoring a flag whose prerequisite is archived', async () => {
    await setFlagStatus(ctx, admin, 'loyalty_rewards', 'archived');
    await setFlagStatus(ctx, admin, 'loyalty_program', 'archived', true);
    expect(await errorCode(setFlagStatus(ctx, admin, 'loyalty_rewards', 'active'))).toBe('CONFLICT');
    expect((await getFlag(ctx, 'loyalty_rewards')).status).toBe('archived');
    await setFlagStatus(ctx, admin, 'loyalty_program', 'active', true);
    expect((await setFlagStatus(ctx, admin, 'loyalty_rewards', 'active')).status).toBe('active');
  });

  it('blocks deleting referenced segments and reports references', async () => {
    const beta = (await listSegments(ctx)).find((s) => s.key === 'beta_testers')!;
    expect(beta.references.length).toBeGreaterThan(0);
    expect(beta.matchingDemoUserIds).toEqual(['u_sanna', 'u_jonas']);
    expect(await errorCode(deleteSegment(ctx, admin, 'beta_testers'))).toBe('CONFLICT');
  });

  it('previews changes without persisting them', async () => {
    const current = await config('ai_recommendations', 'production');
    const preview = await previewConfig(ctx, 'ai_recommendations', 'production', { ...current, rolloutPercentage: 100 });
    expect(preview.valid).toBe(true);
    expect(preview.results.filter((r) => r.changed).map((r) => r.user.userId)).toEqual(['u_aino', 'u_eero', 'u_jonas']);
    expect(await config('ai_recommendations', 'production')).toEqual(current);
    const invalidPreview = await previewConfig(ctx, 'ai_recommendations', 'production', { ...current, rolloutPercentage: -5 });
    expect(invalidPreview).toMatchObject({ valid: false, issues: [{ path: 'rolloutPercentage' }] });
    expect(invalidPreview.results.every((r) => r.proposed === null)).toBe(true);
  });

  it('reports which config fields differ between environments', async () => {
    const rows = await compareEnvironments(ctx);
    expect(rows.find((r) => r.flag.key === 'ai_recommendations')!.differences).toEqual(['rollout', 'rules']);
    expect(rows.find((r) => r.flag.key === 'loyalty_rewards')!.differences).toEqual(['enabled', 'default', 'rules']);
  });
});

describe('atomicity', () => {
  it('rolls back every write in a failed commit', async () => {
    const flag = (await ctx.store.getFlag('loyalty_program'))!;
    const before = await config('loyalty_program', 'development');
    const auditCount = (await listAudit(ctx, {})).length;
    await expect(ctx.store.commit(
      [
        { type: 'putConfig', flag, environment: 'development', config: { ...before, enabled: false }, timestamp: '2026-10-31T12:00:00Z' },
        { type: 'putSegment', segment: { id: 'broken' } as Segment }, // violates NOT NULL
      ],
      { timestamp: '2026-10-31T12:00:00Z', actor: admin, operation: 'config.updated', previous: null, next: null },
    )).rejects.toThrow();
    expect(await config('loyalty_program', 'development')).toEqual(before);
    expect((await listAudit(ctx, {})).length).toBe(auditCount);
  });

  it('publishes change events only after a successful save', async () => {
    const events: ChangeEvent[] = [];
    ctx.notifier.subscribe((e) => events.push(e));
    const current = await config('ai_recommendations', 'development');
    await expect(applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...current, rolloutPercentage: 500 }, false)).rejects.toThrow();
    await expect(applyConfig(ctx, developer, 'ai_recommendations', 'production', current, true)).rejects.toThrow();
    expect(events).toEqual([]);
  });

  it('keeps a committed change successful even if a listener throws', async () => {
    ctx.notifier.subscribe(() => {
      throw new Error('broken SSE client');
    });
    const current = await config('ai_recommendations', 'development');
    expect((await applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...current, rolloutPercentage: 40 }, false)).config.rolloutPercentage).toBe(40);
  });
});

describe('production read-only', () => {
  beforeEach(async () => {
    ctx = await seededContext({ productionReadOnly: true });
  });

  it('refuses Production config changes and rollbacks, even confirmed by an admin', async () => {
    const before = await config('loyalty_program', 'production');
    expect(await errorCode(applyConfig(ctx, admin, 'loyalty_program', 'production', { ...before, enabled: false }, true))).toBe('FORBIDDEN');
    const [seeded] = await listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'production' });
    expect(await errorCode(rollback(ctx, admin, seeded.id, true))).toBe('FORBIDDEN');
    expect(await config('loyalty_program', 'production')).toEqual(before);
    expect((await config('ai_recommendations', 'production')).rolloutPercentage).not.toBe(10);
  });

  it('still allows changes to other environments', async () => {
    const staging = await config('loyalty_program', 'staging');
    await applyConfig(ctx, admin, 'loyalty_program', 'staging', { ...staging, enabled: false }, false);
    expect((await config('loyalty_program', 'staging')).enabled).toBe(false);
  });

  it('refuses archiving or restoring a flag enabled in Production, but not one disabled there', async () => {
    expect(await errorCode(setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived', true))).toBe('FORBIDDEN');
    expect((await getFlag(ctx, 'free_shipping_banner')).status).toBe('active');
    expect((await setFlagStatus(ctx, admin, 'loyalty_rewards', 'archived')).status).toBe('archived');
  });

  it('refuses editing a segment used by Production rules, but not other segments', async () => {
    const segment = { name: 'Changed', conditions: [{ attribute: 'country', operator: 'in', values: ['SE'] }] };
    expect(await errorCode(updateSegment(ctx, admin, 'finnish_customers', segment))).toBe('FORBIDDEN');
    expect((await listSegments(ctx)).find((s) => s.key === 'finnish_customers')!.name).not.toBe('Changed');
    await createSegment(ctx, admin, { key: 'swedish_customers', name: 'Swedish customers', conditions: segment.conditions });
    expect((await updateSegment(ctx, admin, 'swedish_customers', segment)).name).toBe('Changed');
  });
});
