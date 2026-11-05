import type { Environment, EnvironmentConfig, Flag, Segment, UserContext } from '@flagship/shared';
import { describe, expect, it } from 'vitest';
import { bucketFor, evaluateFlag, type EvaluationSnapshot } from '../src/evaluation/engine.js';

const flag = (key: string, type: Flag['type'], extra: Partial<Flag> = {}): Flag => ({
  id: key, key, name: key, description: '', type, owner: 't', tags: [], status: 'active',
  variants: type === 'multivariate' ? [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] : [],
  createdAt: '', updatedAt: '', ...extra,
});
const cfg = (c: Partial<EnvironmentConfig> = {}): EnvironmentConfig => ({
  enabled: true, defaultEnabled: null, rolloutPercentage: null, variantWeights: null, rules: [], prerequisites: [], ...c,
});
const allEnvs = (c: EnvironmentConfig, overrides: Partial<Record<Environment, EnvironmentConfig>> = {}) =>
  ({ development: c, staging: c, production: c, ...overrides });

const finnishSegment: Segment = {
  id: 's', key: 'finns', name: 'Finns', description: '', createdAt: '', updatedAt: '',
  conditions: [{ attribute: 'country', operator: 'equals', values: ['FI'] }],
};

function snapshot(entries: [Flag, Record<Environment, EnvironmentConfig>][]): EvaluationSnapshot {
  return {
    flags: new Map(entries.map(([f]) => [f.key, f])),
    configs: new Map(entries.map(([f, c]) => [f.key, c])),
    segments: new Map([[finnishSegment.key, finnishSegment]]),
  };
}

const fi: UserContext = { userId: 'u1', country: 'FI', accountType: 'regular' };
const us: UserContext = { userId: 'u2', country: 'US', accountType: 'premium' };
const users = Array.from({ length: 2000 }, (_, i): UserContext => ({ userId: `user-${i}`, country: 'SE', accountType: 'regular' }));

describe('boolean flags', () => {
  it('returns the default when enabled and the off result when disabled', () => {
    const s = snapshot([[flag('f', 'boolean'), allEnvs(cfg({ defaultEnabled: true }), { production: cfg({ enabled: false, defaultEnabled: true }) })]]);
    expect(evaluateFlag(s, 'f', 'development', fi)).toMatchObject({ enabled: true, reason: 'DEFAULT' });
    expect(evaluateFlag(s, 'f', 'production', fi)).toMatchObject({ enabled: false, reason: 'FLAG_DISABLED' });
  });

  it('treats archived flags as off regardless of config', () => {
    const s = snapshot([[flag('f', 'boolean', { status: 'archived' }), allEnvs(cfg({ defaultEnabled: true }))]]);
    expect(evaluateFlag(s, 'f', 'development', fi)).toMatchObject({ enabled: false, reason: 'FLAG_ARCHIVED' });
  });

  it('returns null for unknown flags', () => {
    expect(evaluateFlag(snapshot([]), 'missing', 'development', fi)).toBeNull();
  });
});

describe('targeting', () => {
  const rules = [
    { id: 'inc', description: 'Finns', effect: 'include' as const, variant: null,
      conditions: [{ attribute: 'segment' as const, operator: 'in' as const, values: ['finns'] }] },
    { id: 'exc', description: 'No premium', effect: 'exclude' as const, variant: null,
      conditions: [{ attribute: 'accountType' as const, operator: 'equals' as const, values: ['premium'] }] },
  ];

  it('includes users matching an include rule (via segment)', () => {
    const s = snapshot([[flag('f', 'boolean'), allEnvs(cfg({ defaultEnabled: false, rules }))]]);
    expect(evaluateFlag(s, 'f', 'development', fi)).toMatchObject({ enabled: true, reason: 'TARGETING_MATCH', match: { ruleId: 'inc' } });
    expect(evaluateFlag(s, 'f', 'development', { ...fi, country: 'SE' })).toMatchObject({ enabled: false, reason: 'DEFAULT' });
  });

  it('lets exclusions win over inclusions and rollout', () => {
    const premiumFinn = { ...fi, accountType: 'premium' };
    const s = snapshot([
      [flag('b', 'boolean'), allEnvs(cfg({ defaultEnabled: true, rules }))],
      [flag('p', 'percentage'), allEnvs(cfg({ rolloutPercentage: 100, rules }))],
    ]);
    expect(evaluateFlag(s, 'b', 'development', premiumFinn)).toMatchObject({ enabled: false, reason: 'TARGETING_EXCLUDED' });
    expect(evaluateFlag(s, 'p', 'development', us)).toMatchObject({ enabled: false, reason: 'TARGETING_EXCLUDED' });
  });

  it('supports not_equals and not_in operators', () => {
    const s = snapshot([[flag('f', 'boolean'), allEnvs(cfg({ defaultEnabled: false, rules: [
      { id: 'r', description: '', effect: 'include', variant: null, conditions: [
        { attribute: 'country', operator: 'not_in', values: ['US', 'CA'] },
        { attribute: 'userId', operator: 'not_equals', values: ['blocked'] },
      ] },
    ] }))]]);
    expect(evaluateFlag(s, 'f', 'development', fi)?.enabled).toBe(true);
    expect(evaluateFlag(s, 'f', 'development', us)?.enabled).toBe(false);
    expect(evaluateFlag(s, 'f', 'development', { ...fi, userId: 'blocked' })?.enabled).toBe(false);
  });
});

describe('percentage rollout', () => {
  it('is deterministic per user and flag', () => {
    expect(bucketFor('flag', 'user-1')).toBe(bucketFor('flag', 'user-1'));
    expect(bucketFor('flag', 'user-1')).not.toBe(bucketFor('other', 'user-1'));
  });

  it('includes roughly the configured share and grows monotonically', () => {
    const at = (rolloutPercentage: number) => {
      const s = snapshot([[flag('r', 'percentage'), allEnvs(cfg({ rolloutPercentage }))]]);
      return new Set(users.filter((u) => evaluateFlag(s, 'r', 'development', u)!.enabled).map((u) => u.userId));
    };
    const at25 = at(25);
    const at50 = at(50);
    expect(at25.size / users.length).toBeGreaterThan(0.2);
    expect(at25.size / users.length).toBeLessThan(0.3);
    // Raising the rollout never removes previously included users.
    expect([...at25].every((id) => at50.has(id))).toBe(true);
    expect(at(0).size).toBe(0);
    expect(at(100).size).toBe(users.length);
  });

  it('uses the environment-specific percentage', () => {
    const s = snapshot([[flag('r', 'percentage'), allEnvs(cfg({ rolloutPercentage: 100 }), { production: cfg({ rolloutPercentage: 0 }) })]]);
    expect(evaluateFlag(s, 'r', 'development', fi)).toMatchObject({ enabled: true, reason: 'ROLLOUT_INCLUDED' });
    expect(evaluateFlag(s, 'r', 'production', fi)).toMatchObject({ enabled: false, reason: 'ROLLOUT_EXCLUDED' });
  });
});

describe('multivariate', () => {
  it('assigns variants by weight, deterministically', () => {
    const s = snapshot([[flag('m', 'multivariate'), allEnvs(cfg({ variantWeights: { a: 60, b: 40 } }))]]);
    const variants = users.map((u) => evaluateFlag(s, 'm', 'development', u)!.variant);
    const shareA = variants.filter((v) => v === 'a').length / users.length;
    expect(shareA).toBeGreaterThan(0.55);
    expect(shareA).toBeLessThan(0.65);
    expect(users.map((u) => evaluateFlag(s, 'm', 'development', u)!.variant)).toEqual(variants);
  });

  it('serves the baseline variant when off and the rule variant when targeted', () => {
    const s = snapshot([[flag('m', 'multivariate'), allEnvs(
      cfg({ variantWeights: { a: 100, b: 0 }, rules: [{ id: 'r', description: '', effect: 'include', variant: 'b',
        conditions: [{ attribute: 'country', operator: 'equals', values: ['FI'] }] }] }),
      { production: cfg({ enabled: false, variantWeights: { a: 0, b: 100 } }) },
    )]]);
    expect(evaluateFlag(s, 'm', 'production', fi)).toMatchObject({ enabled: false, variant: 'a' });
    expect(evaluateFlag(s, 'm', 'production', fi)!.explanation).toContain('Serving default variant "a"');
    expect(evaluateFlag(s, 'm', 'development', fi)).toMatchObject({ enabled: true, variant: 'b', reason: 'TARGETING_MATCH' });
    expect(evaluateFlag(s, 'm', 'development', us)).toMatchObject({ enabled: true, variant: 'a', reason: 'VARIANT_ASSIGNED' });
  });
});

describe('prerequisites', () => {
  it('turns a flag off when its prerequisite is off for the user', () => {
    const s = snapshot([
      [flag('parent', 'boolean'), allEnvs(cfg({ defaultEnabled: false, rules: [{ id: 'fi', description: '', effect: 'include', variant: null,
        conditions: [{ attribute: 'country', operator: 'equals', values: ['FI'] }] }] }))],
      [flag('child', 'boolean'), allEnvs(cfg({ defaultEnabled: true, prerequisites: ['parent'] }))],
    ]);
    expect(evaluateFlag(s, 'child', 'development', fi)?.enabled).toBe(true);
    expect(evaluateFlag(s, 'child', 'development', us)).toMatchObject({
      enabled: false, reason: 'PREREQUISITE_FAILED', match: { prerequisiteKey: 'parent' },
    });
  });

  it('does not recurse forever on a cycle that slipped into storage', () => {
    const s = snapshot([
      [flag('a', 'boolean'), allEnvs(cfg({ defaultEnabled: true, prerequisites: ['b'] }))],
      [flag('b', 'boolean'), allEnvs(cfg({ defaultEnabled: true, prerequisites: ['a'] }))],
    ]);
    expect(evaluateFlag(s, 'a', 'development', fi)).toMatchObject({ enabled: false, reason: 'PREREQUISITE_FAILED' });
  });

  it('evaluates shared prerequisites once, not once per path', () => {
    // Each flag requires the previous two: without memoization the work doubles with every flag.
    const s = snapshot(Array.from({ length: 34 }, (_, i) =>
      [flag(`f${i}`, 'boolean'), allEnvs(cfg({ defaultEnabled: true, prerequisites: i < 2 ? [] : [`f${i - 1}`, `f${i - 2}`] }))]));
    const start = performance.now();
    expect(evaluateFlag(s, 'f33', 'development', fi)?.enabled).toBe(true);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
