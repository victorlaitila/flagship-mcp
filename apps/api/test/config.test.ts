import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (value: string | undefined) => {
  vi.resetModules();
  vi.stubEnv('PRODUCTION_READ_ONLY', value);
  return import('../src/config.js');
};

describe('PRODUCTION_READ_ONLY', () => {
  afterEach(() => void vi.unstubAllEnvs());

  it('is off when unset and follows "true"/"false"', async () => {
    expect((await load(undefined)).PRODUCTION_READ_ONLY).toBe(false);
    expect((await load('true')).PRODUCTION_READ_ONLY).toBe(true);
    expect((await load('false')).PRODUCTION_READ_ONLY).toBe(false);
  });

  it('refuses to start on any other value instead of silently turning the guardrail off', async () => {
    await expect(load('TRUE')).rejects.toThrow('PRODUCTION_READ_ONLY must be');
    await expect(load('1')).rejects.toThrow('PRODUCTION_READ_ONLY must be');
  });
});
