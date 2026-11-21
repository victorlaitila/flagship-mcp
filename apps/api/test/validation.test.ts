import type { EnvironmentConfig, Flag } from '@flagship/shared';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS } from '@flagship/shared';
import { findCycle, LIMITS, validateCreateFlag, validateEnvironmentConfig, validateSegment, validateUpdateFlag, type ConfigContext } from '../src/validation/validators.js';
import { seededContext } from './helpers.js';

const mv: Flag = {
  id: 'm', key: 'mv', name: 'mv', description: '', type: 'multivariate', owner: 't', tags: [], status: 'active',
  variants: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }], createdAt: '', updatedAt: '',
};
const pct: Flag = { ...mv, id: 'p', key: 'pct', type: 'percentage', variants: [] };
const ctx = (flag: Flag, prereqs: [string, string[]][] = []): ConfigContext => ({
  flag,
  flags: new Map([[mv.key, mv], [pct.key, pct], ['other', { ...pct, key: 'other' }]]),
  prerequisitesByFlag: new Map(prereqs),
  segmentKeys: new Set(['beta']),
});
const base: EnvironmentConfig = {
  enabled: true, defaultEnabled: null, rolloutPercentage: 50, variantWeights: null, rules: [], prerequisites: [],
};
const paths = (r: { issues: { path: string }[] }) => r.issues.map((i) => i.path);

describe('environment config validation', () => {
  it('accepts a valid config and normalizes fields that do not apply', () => {
    const r = validateEnvironmentConfig({ ...base, defaultEnabled: true, variantWeights: { x: 1 } }, ctx(pct));
    expect(r.issues).toEqual([]);
    expect(r.value).toMatchObject({ rolloutPercentage: 50, defaultEnabled: null, variantWeights: null });
  });

  it('rejects rollout outside 0–100', () => {
    expect(paths(validateEnvironmentConfig({ ...base, rolloutPercentage: 101 }, ctx(pct)))).toContain('rolloutPercentage');
    expect(paths(validateEnvironmentConfig({ ...base, rolloutPercentage: -1 }, ctx(pct)))).toContain('rolloutPercentage');
  });

  it('requires variant weights to total 100 and reference known variants', () => {
    expect(validateEnvironmentConfig({ ...base, variantWeights: { a: 50, b: 40 } }, ctx(mv)).issues[0].message).toMatch(/total 100/);
    expect(paths(validateEnvironmentConfig({ ...base, variantWeights: { a: 50, b: 40, c: 10 } }, ctx(mv)))).toContain('variantWeights.c');
    expect(validateEnvironmentConfig({ ...base, variantWeights: { a: 50, b: 50 } }, ctx(mv)).value).not.toBeNull();
  });

  it('validates targeting attributes, operators, values and segments', () => {
    const rule = (conditions: unknown[], extra = {}) => ({ ...base, rules: [{ id: 'r', effect: 'include', conditions, ...extra }] });
    expect(paths(validateEnvironmentConfig(rule([{ attribute: 'email', operator: 'equals', values: ['x'] }]), ctx(pct))))
      .toContain('rules[0].conditions[0].attribute');
    expect(paths(validateEnvironmentConfig(rule([{ attribute: 'country', operator: 'contains', values: ['x'] }]), ctx(pct))))
      .toContain('rules[0].conditions[0].operator');
    expect(paths(validateEnvironmentConfig(rule([{ attribute: 'country', operator: 'equals', values: ['FI', 'SE'] }]), ctx(pct))))
      .toContain('rules[0].conditions[0].values');
    expect(validateEnvironmentConfig(rule([{ attribute: 'segment', operator: 'in', values: ['nope'] }]), ctx(pct)).issues[0].message)
      .toMatch(/Unknown segment/);
    expect(paths(validateEnvironmentConfig(rule([]), ctx(pct)))).toContain('rules[0].conditions');
    // Multivariate include rules must name a variant.
    expect(paths(validateEnvironmentConfig({ ...rule([{ attribute: 'segment', operator: 'in', values: ['beta'] }]), variantWeights: { a: 100, b: 0 } }, ctx(mv))))
      .toContain('rules[0].variant');
  });

  it('rejects unknown, archived, self and circular prerequisites', () => {
    expect(validateEnvironmentConfig({ ...base, prerequisites: ['ghost'] }, ctx(pct)).issues[0].message).toMatch(/does not exist/);
    expect(validateEnvironmentConfig({ ...base, prerequisites: ['pct'] }, ctx(pct)).issues.map((i) => i.message).join())
      .toMatch(/own prerequisite/);
    const archivedCtx = { ...ctx(pct), flags: new Map([['old', { ...pct, key: 'old', status: 'archived' as const }]]) };
    expect(validateEnvironmentConfig({ ...base, prerequisites: ['old'] }, archivedCtx).issues[0].message).toMatch(/archived/);
    const cyclic = validateEnvironmentConfig({ ...base, prerequisites: ['other'] }, ctx(pct, [['other', ['mv']], ['mv', ['pct']]]));
    expect(cyclic.issues[0].message).toBe('Circular prerequisite: pct → other → mv → pct.');
  });

  it('rejects enabling an archived flag', () => {
    expect(paths(validateEnvironmentConfig(base, ctx({ ...pct, status: 'archived' })))).toContain('enabled');
    expect(validateEnvironmentConfig({ ...base, enabled: false }, ctx({ ...pct, status: 'archived' })).value).not.toBeNull();
  });

  it('rejects non-object input', () => {
    expect(validateEnvironmentConfig(null, ctx(pct)).value).toBeNull();
  });
});

describe('findCycle', () => {
  it('finds no cycle in a DAG', () => {
    expect(findCycle('a', ['b'], new Map([['b', ['c']], ['c', []]]))).toBeNull();
  });

  it('visits each flag once in a graph with shared prerequisites', () => {
    const graph = new Map(Array.from({ length: 34 }, (_, i) => [`f${i}`, i < 2 ? [] : [`f${i - 1}`, `f${i - 2}`]]));
    const start = performance.now();
    expect(findCycle('x', ['f33', 'f32'], graph)).toBeNull();
    // f0 → f33 → f32 → … → f2 → f0
    expect(findCycle('f0', ['f33'], graph)).toEqual(['f0', ...Array.from({ length: 32 }, (_, i) => `f${33 - i}`), 'f0']);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('segment validation', () => {
  it('rejects segment conditions that reference segments', () => {
    const r = validateSegment({ key: 'x_y', name: 'X', conditions: [{ attribute: 'segment', operator: 'in', values: ['a'] }] }, new Set(), null);
    expect(paths(r)).toContain('conditions[0].attribute');
  });
});

describe('size limits', () => {
  const long = (n: number) => 'x'.repeat(n);
  const cond = (values: string[]) => ({ attribute: 'country', operator: 'in', values });
  const rule = (i: number, extra = {}) => ({ id: `r${i}`, effect: 'include', conditions: [cond(['FI'])], ...extra });

  it('accepts values exactly at each limit', () => {
    const ok = (config: unknown) => expect(validateEnvironmentConfig(config, ctx(pct)).issues).toEqual([]);
    ok({ ...base, rules: Array.from({ length: LIMITS.rules }, (_, i) => rule(i)) });
    ok({ ...base, rules: [rule(0, { id: long(LIMITS.ruleId), description: long(LIMITS.name) })] });
    ok({ ...base, rules: [rule(0, { conditions: Array.from({ length: LIMITS.conditions }, () => cond(['FI'])) })] });
    ok({ ...base, rules: [rule(0, { conditions: [cond([...Array.from({ length: LIMITS.values - 1 }, (_, i) => `v${i}`), long(LIMITS.value)])] })] });
    expect(validateUpdateFlag({
      name: long(LIMITS.name), owner: long(LIMITS.owner), description: long(LIMITS.description),
      tags: Array.from({ length: LIMITS.tags }, (_, i) => `${i}${long(LIMITS.tag - 2)}`),
    }).issues).toEqual([]);
  });

  it('rejects oversized targeting rules with a path to the field', () => {
    const v = (config: unknown) => paths(validateEnvironmentConfig(config, ctx(pct)));
    expect(v({ ...base, rules: Array.from({ length: LIMITS.rules + 1 }, (_, i) => rule(i)) })).toContain('rules');
    expect(v({ ...base, rules: [rule(0, { id: long(LIMITS.ruleId + 1) })] })).toContain('rules[0].id');
    expect(v({ ...base, rules: [rule(0, { description: long(LIMITS.name + 1) })] })).toContain('rules[0].description');
    expect(v({ ...base, rules: [rule(0, { conditions: Array.from({ length: LIMITS.conditions + 1 }, () => cond(['FI'])) })] }))
      .toContain('rules[0].conditions');
    expect(v({ ...base, rules: [rule(0, { conditions: [cond(Array.from({ length: LIMITS.values + 1 }, (_, i) => `v${i}`))] })] }))
      .toContain('rules[0].conditions[0].values');
    expect(v({ ...base, rules: [rule(0, { conditions: [cond([long(LIMITS.value + 1)])] })] })).toContain('rules[0].conditions[0].values[0]');
  });

  it('rejects oversized flag and segment text, tags and variants', () => {
    const flag = { key: 'k_ok', name: 'n', owner: 'o', type: 'boolean' };
    const create = (extra: object) => paths(validateCreateFlag({ ...flag, ...extra }, new Set()));
    expect(create({ name: long(LIMITS.name + 1) })).toEqual(['name']);
    expect(create({ owner: long(LIMITS.owner + 1) })).toEqual(['owner']);
    expect(create({ description: long(LIMITS.description + 1) })).toEqual(['description']);
    expect(create({ tags: Array.from({ length: LIMITS.tags + 1 }, (_, i) => `t${i}`) })).toEqual(['tags']);
    expect(create({ tags: [long(LIMITS.tag + 1)] })).toEqual(['tags[0]']);
    const variants = Array.from({ length: LIMITS.variants + 1 }, (_, i) => ({ key: `v${i}`, name: `V${i}` }));
    expect(create({ type: 'multivariate', variants })).toEqual(['variants']);
    expect(create({ type: 'multivariate', variants: [{ key: 'va', name: long(LIMITS.name + 1) }, { key: 'vb', name: 'B' }] })).toEqual(['variants[0].name']);
    expect(paths(validateUpdateFlag({ name: long(LIMITS.name + 1) }))).toEqual(['name']);
    const segment = { key: 'seg', name: 'n', conditions: [cond(['FI'])] };
    expect(paths(validateSegment({ ...segment, name: long(LIMITS.name + 1) }, new Set(), null))).toEqual(['name']);
    expect(paths(validateSegment({ ...segment, description: long(LIMITS.description + 1) }, new Set(), null))).toEqual(['description']);
    expect(paths(validateSegment({ ...segment, conditions: Array.from({ length: LIMITS.conditions + 1 }, () => cond(['FI'])) }, new Set(), null)))
      .toEqual(['conditions']);
  });

  it('caps the total size of a config and of a segment\'s conditions', () => {
    // Each field is within its own limit, but together they are too large to store.
    const values = Array.from({ length: LIMITS.values }, (_, i) => `${i}${long(LIMITS.value - 3)}`);
    const big = { ...base, rules: [rule(0, { conditions: [cond(values)] })] };
    expect(validateEnvironmentConfig(big, ctx(pct)).issues).toEqual([
      { path: 'config', message: expect.stringMatching(/at most 4096 bytes/) },
    ]);
    const segment = { key: 'seg', name: 'n', conditions: [cond(values)] };
    expect(paths(validateSegment(segment, new Set(), null))).toEqual(['conditions']);
  });

  it('explains what a valid variant key looks like', () => {
    const r = validateCreateFlag({ key: 'k_ok', name: 'n', owner: 'o', type: 'multivariate', variants: [{ key: 'a', name: 'A' }, { key: 'bb', name: 'B' }] }, new Set());
    expect(r.issues[0]).toMatchObject({ path: 'variants[0].key', message: expect.stringContaining('2–64 chars') });
  });

  it('keeps the seeded data within every limit', async () => {
    const seeded = await seededContext();
    const flags = await seeded.store.listFlagsWithConfigs();
    const segments = await seeded.store.listSegments();
    expect(flags.length).toBeLessThanOrEqual(LIMITS.flags);
    expect(segments.length).toBeLessThanOrEqual(LIMITS.segments);
    for (const f of flags) {
      expect(validateUpdateFlag({ name: f.name, owner: f.owner, description: f.description, tags: f.tags }).issues).toEqual([]);
      const context: ConfigContext = {
        flag: f, flags: new Map(flags.map((x) => [x.key, x])), prerequisitesByFlag: new Map(), segmentKeys: new Set(segments.map((s) => s.key)),
      };
      for (const env of ENVIRONMENTS) expect(validateEnvironmentConfig(f.environments[env], context).issues).toEqual([]);
    }
    for (const s of segments) expect(validateSegment(s, new Set(), s.key).issues).toEqual([]);
  });
});
