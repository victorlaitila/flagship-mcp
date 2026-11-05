import type { EnvironmentConfig, Flag } from '@flagship/shared';
import { describe, expect, it } from 'vitest';
import { findCycle, validateEnvironmentConfig, validateSegment, type ConfigContext } from '../src/validation/validators.js';

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
