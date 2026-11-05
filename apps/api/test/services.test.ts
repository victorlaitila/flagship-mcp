import type { ChangeEvent, EnvironmentConfig } from '@flagship/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { listAudit, rollback } from '../src/services/audit.js';
import type { ServiceContext } from '../src/services/context.js';
import { evaluateOne } from '../src/services/evaluation.js';
import { applyConfig, compareEnvironments, createFlag, getFlag, previewConfig, setFlagStatus } from '../src/services/flags.js';
import { deleteSegment, listSegments, updateSegment } from '../src/services/segments.js';
import { admin, developer, releaseManager, seededContext } from './helpers.js';

let ctx: ServiceContext;
beforeEach(() => {
  ctx = seededContext();
});

const errorCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};
const config = (key: string, env: 'development' | 'staging' | 'production') => getFlag(ctx, key).environments[env];

describe('permissions', () => {
  const disable = (env: 'development' | 'staging' | 'production') => ({ ...config('loyalty_program', env), enabled: false });

  it('lets developers manage only development', () => {
    expect(errorCode(() => applyConfig(ctx, developer, 'loyalty_program', 'development', disable('development'), false))).toBeNull();
    expect(errorCode(() => applyConfig(ctx, developer, 'loyalty_program', 'staging', disable('staging'), false))).toBe('FORBIDDEN');
    expect(errorCode(() => applyConfig(ctx, developer, 'loyalty_program', 'production', disable('production'), true))).toBe('FORBIDDEN');
  });

  it('lets release managers manage development and staging', () => {
    expect(errorCode(() => applyConfig(ctx, releaseManager, 'loyalty_program', 'staging', disable('staging'), false))).toBeNull();
    expect(errorCode(() => applyConfig(ctx, releaseManager, 'loyalty_program', 'production', disable('production'), true))).toBe('FORBIDDEN');
  });

  it('requires explicit confirmation for production, even for admins', () => {
    expect(errorCode(() => applyConfig(ctx, admin, 'loyalty_program', 'production', disable('production'), undefined))).toBe('CONFIRMATION_REQUIRED');
    expect(config('loyalty_program', 'production').enabled).toBe(true);
    applyConfig(ctx, admin, 'loyalty_program', 'production', disable('production'), true);
    expect(config('loyalty_program', 'production').enabled).toBe(false);
  });

  it('restricts archiving and segment edits to admins', () => {
    expect(errorCode(() => setFlagStatus(ctx, releaseManager, 'free_shipping_banner', 'archived'))).toBe('FORBIDDEN');
    expect(errorCode(() => updateSegment(ctx, developer, 'beta_testers', { name: 'x', conditions: [] }))).toBe('FORBIDDEN');
  });
});

describe('config updates', () => {
  it('rejects invalid configs without persisting', () => {
    const before = config('ai_recommendations', 'development');
    expect(errorCode(() => applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...before, rolloutPercentage: 150 }, false)))
      .toBe('VALIDATION_FAILED');
    expect(config('ai_recommendations', 'development')).toEqual(before);
  });

  it('prevents circular prerequisites across flags', () => {
    const payment = config('new_payment_api', 'development');
    expect(errorCode(() => applyConfig(ctx, developer, 'new_payment_api', 'development', { ...payment, prerequisites: ['new_checkout'] }, false)))
      .toBe('VALIDATION_FAILED');
  });

  it('changes evaluation for the storefront and notifies listeners', () => {
    const events: ChangeEvent[] = [];
    ctx.notifier.subscribe((e) => events.push(e));
    expect(evaluateOne(ctx.db, 'loyalty_program', 'development', { userId: 'u_emma', country: 'US', accountType: 'regular' }).enabled).toBe(true);
    applyConfig(ctx, developer, 'loyalty_program', 'development', { ...config('loyalty_program', 'development'), enabled: false }, false);
    const result = evaluateOne(ctx.db, 'loyalty_rewards', 'development', { userId: 'u_emma', country: 'US', accountType: 'regular' });
    expect(result).toMatchObject({ enabled: false, reason: 'PREREQUISITE_FAILED' });
    expect(events).toEqual([expect.objectContaining({ entity: 'config', flagKey: 'loyalty_program', environment: 'development' })]);
  });

  it('writes no audit entry when nothing changed', () => {
    const count = listAudit(ctx, {}).length;
    applyConfig(ctx, developer, 'loyalty_program', 'development', config('loyalty_program', 'development'), false);
    expect(listAudit(ctx, {}).length).toBe(count);
  });
});

describe('audit and rollback', () => {
  it('records previous and new configuration for every change', () => {
    const previous = config('ai_recommendations', 'staging');
    applyConfig(ctx, releaseManager, 'ai_recommendations', 'staging', { ...previous, rolloutPercentage: 75 }, false);
    const [entry] = listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'staging' });
    expect(entry).toMatchObject({
      operation: 'config.updated', actorId: releaseManager.id, actorRole: 'release_manager', previous,
      next: { ...previous, rolloutPercentage: 75 },
    });
  });

  it('restores the previous config as a new entry and keeps history intact', () => {
    const original = config('ai_recommendations', 'development');
    applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...original, rolloutPercentage: 5 }, false);
    const [change] = listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'development' });
    const historyBefore = listAudit(ctx, {});

    rollback(ctx, developer, change.id, false);

    expect(config('ai_recommendations', 'development')).toEqual(original);
    const historyAfter = listAudit(ctx, {});
    expect(historyAfter.length).toBe(historyBefore.length + 1);
    expect(historyAfter.slice(1)).toEqual(historyBefore);
    expect(historyAfter[0]).toMatchObject({ operation: 'config.rolled_back', rollbackOf: change.id, previous: { rolloutPercentage: 5 }, next: original });
  });

  it('applies permissions and confirmation to rollbacks', () => {
    const [seeded] = listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'production' });
    expect(errorCode(() => rollback(ctx, releaseManager, seeded.id, true))).toBe('FORBIDDEN');
    expect(errorCode(() => rollback(ctx, admin, seeded.id, false))).toBe('CONFIRMATION_REQUIRED');
    rollback(ctx, admin, seeded.id, true);
    expect(config('ai_recommendations', 'production').rolloutPercentage).toBe(10);
  });

  it('refuses to roll back non-config entries or no-op rollbacks', () => {
    const [created] = listAudit(ctx, { operation: 'flag.created', limit: 1 });
    expect(errorCode(() => rollback(ctx, admin, created.id, true))).toBe('BAD_REQUEST');
    const [seeded] = listAudit(ctx, { flagKey: 'ai_recommendations', environment: 'production' });
    rollback(ctx, admin, seeded.id, true);
    expect(errorCode(() => rollback(ctx, admin, seeded.id, true))).toBe('CONFLICT');
  });
});

describe('flags and segments', () => {
  it('creates flags disabled in every environment', () => {
    const flag = createFlag(ctx, developer, { key: 'dark_mode', name: 'Dark mode', type: 'boolean', owner: 'Web', tags: ['UI'] });
    expect(Object.values(flag.environments).every((c: EnvironmentConfig) => !c.enabled)).toBe(true);
    expect(flag.tags).toEqual(['ui']);
    expect(errorCode(() => createFlag(ctx, developer, { key: 'dark_mode', name: 'x', type: 'boolean', owner: 'x' }))).toBe('VALIDATION_FAILED');
  });

  it('blocks archiving flags that are prerequisites of active flags', () => {
    expect(errorCode(() => setFlagStatus(ctx, admin, 'loyalty_program', 'archived'))).toBe('CONFLICT');
    expect(setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived', true).status).toBe('archived');
    expect(evaluateOne(ctx.db, 'free_shipping_banner', 'development', { userId: 'u_aino', country: 'FI', accountType: 'regular' }).reason)
      .toBe('FLAG_ARCHIVED');
  });

  it('requires Production confirmation to archive or restore a flag enabled in Production', () => {
    expect(errorCode(() => setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived'))).toBe('CONFIRMATION_REQUIRED');
    expect(getFlag(ctx, 'free_shipping_banner').status).toBe('active');
    setFlagStatus(ctx, admin, 'free_shipping_banner', 'archived', true);
    expect(errorCode(() => setFlagStatus(ctx, admin, 'free_shipping_banner', 'active'))).toBe('CONFIRMATION_REQUIRED');
    expect(setFlagStatus(ctx, admin, 'free_shipping_banner', 'active', true).status).toBe('active');
    // loyalty_rewards is disabled in Production, so archiving it doesn't change Production.
    expect(setFlagStatus(ctx, admin, 'loyalty_rewards', 'archived').status).toBe('archived');
  });

  it('blocks restoring a flag whose prerequisite is archived', () => {
    setFlagStatus(ctx, admin, 'loyalty_rewards', 'archived');
    setFlagStatus(ctx, admin, 'loyalty_program', 'archived', true);
    expect(errorCode(() => setFlagStatus(ctx, admin, 'loyalty_rewards', 'active'))).toBe('CONFLICT');
    expect(getFlag(ctx, 'loyalty_rewards').status).toBe('archived');
    setFlagStatus(ctx, admin, 'loyalty_program', 'active', true);
    expect(setFlagStatus(ctx, admin, 'loyalty_rewards', 'active').status).toBe('active');
  });

  it('blocks deleting referenced segments and reports references', () => {
    const beta = listSegments(ctx).find((s) => s.key === 'beta_testers')!;
    expect(beta.references.length).toBeGreaterThan(0);
    expect(beta.matchingDemoUserIds).toEqual(['u_sanna', 'u_jonas']);
    expect(errorCode(() => deleteSegment(ctx, admin, 'beta_testers'))).toBe('CONFLICT');
  });

  it('previews changes without persisting them', () => {
    const current = config('ai_recommendations', 'production');
    const preview = previewConfig(ctx, 'ai_recommendations', 'production', { ...current, rolloutPercentage: 100 });
    expect(preview.valid).toBe(true);
    expect(preview.results.filter((r) => r.changed).map((r) => r.user.userId)).toEqual(['u_aino', 'u_eero', 'u_jonas']);
    expect(config('ai_recommendations', 'production')).toEqual(current);
    const invalidPreview = previewConfig(ctx, 'ai_recommendations', 'production', { ...current, rolloutPercentage: -5 });
    expect(invalidPreview).toMatchObject({ valid: false, issues: [{ path: 'rolloutPercentage' }] });
    expect(invalidPreview.results.every((r) => r.proposed === null)).toBe(true);
  });

  it('reports which config fields differ between environments', () => {
    const rows = compareEnvironments(ctx);
    expect(rows.find((r) => r.flag.key === 'ai_recommendations')!.differences).toEqual(['rollout', 'rules']);
    expect(rows.find((r) => r.flag.key === 'loyalty_rewards')!.differences).toEqual(['enabled', 'default', 'rules']);
  });
});

describe('atomicity', () => {
  it('rolls back every write in a failed transaction', async () => {
    const { transaction } = await import('../src/database/db.js');
    const before = config('loyalty_program', 'development');
    const auditCount = listAudit(ctx, {}).length;
    expect(() => transaction(ctx.db, () => {
      ctx.db.prepare("UPDATE flag_environments SET config = '{}'").run();
      ctx.db.prepare("INSERT INTO audit_log (timestamp) VALUES ('x')").run(); // violates NOT NULL
    })).toThrow();
    expect(config('loyalty_program', 'development')).toEqual(before);
    expect(listAudit(ctx, {}).length).toBe(auditCount);
  });

  it('publishes change events only after a successful save', () => {
    const events: ChangeEvent[] = [];
    ctx.notifier.subscribe((e) => events.push(e));
    const current = config('ai_recommendations', 'development');
    expect(() => applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...current, rolloutPercentage: 500 }, false)).toThrow();
    expect(() => applyConfig(ctx, developer, 'ai_recommendations', 'production', current, true)).toThrow();
    expect(events).toEqual([]);
  });

  it('keeps a committed change successful even if a listener throws', () => {
    ctx.notifier.subscribe(() => {
      throw new Error('broken SSE client');
    });
    const current = config('ai_recommendations', 'development');
    expect(applyConfig(ctx, developer, 'ai_recommendations', 'development', { ...current, rolloutPercentage: 40 }, false).config.rolloutPercentage).toBe(40);
  });
});
