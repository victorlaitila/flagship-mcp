import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async (value: string | undefined, env: Record<string, string | undefined> = { STORAGE: undefined }) => {
  vi.resetModules();
  vi.stubEnv('PRODUCTION_READ_ONLY', value);
  for (const [name, v] of Object.entries(env)) vi.stubEnv(name, v);
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

describe('STORAGE', () => {
  afterEach(() => void vi.unstubAllEnvs());

  it('defaults to SQLite and accepts DynamoDB with a table name', async () => {
    expect((await load(undefined)).STORAGE).toBe('sqlite');
    expect(await load(undefined, { STORAGE: 'dynamodb', TABLE_NAME: 'flagship' })).toMatchObject({ STORAGE: 'dynamodb', TABLE_NAME: 'flagship' });
  });

  it('refuses to start on an unknown storage or without a table name', async () => {
    await expect(load(undefined, { STORAGE: 'dynamo' })).rejects.toThrow('STORAGE must be');
    await expect(load(undefined, { STORAGE: 'dynamodb', TABLE_NAME: undefined })).rejects.toThrow('needs TABLE_NAME');
  });
});
