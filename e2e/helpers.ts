import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Environment, EnvironmentConfig } from '@flagship/shared';

export const ADMIN = { 'x-actor-id': 'sara' };

export async function getConfig(request: APIRequestContext, flagKey: string, env: Environment): Promise<EnvironmentConfig> {
  const res = await request.get(`/api/flags/${flagKey}/environments/${env}`);
  expect(res.ok()).toBe(true);
  return res.json();
}

/** Writes a config through the real API (as admin), e.g. to set up or restore state. */
export async function putConfig(request: APIRequestContext, flagKey: string, env: Environment, config: EnvironmentConfig) {
  const res = await request.put(`/api/flags/${flagKey}/environments/${env}`, {
    headers: ADMIN,
    data: { config, confirmProduction: true },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Marks the page so a test can prove later that it was never reloaded. */
export async function markNoReload(page: Page) {
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
}

export async function expectNotReloaded(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

export const freeShippingBanner = (page: Page) => page.getByText(/Free shipping on all orders over/);

async function waitUntilUp(url: string) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not come up`);
}

/**
 * A second API + web server pair owned by one test, so the test can stop and restart the API
 * (the shared Playwright servers can't be). Uses its own throwaway database and ports.
 */
export async function startRestartableStack(apiPort = 4120, webPort = 5181) {
  const dbPath = join(tmpdir(), 'flagship-e2e-restart.db');
  const removeDb = () => ['', '-wal', '-shm'].forEach((s) => rmSync(dbPath + s, { force: true }));
  removeDb();
  // Detached process groups, so stopping also ends the children npm/npx start.
  const run = (args: string[], env: Record<string, string>, cwd = process.cwd()) =>
    spawn('npx', args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: 'ignore' });
  const kill = (child: ChildProcess | null) => {
    if (child?.pid) process.kill(-child.pid, 'SIGTERM');
  };
  const apiUrl = `http://localhost:${apiPort}`;
  let api: ChildProcess | null = null;

  const startApi = async () => {
    api = run(['tsx', 'apps/api/src/index.ts'], { PORT: String(apiPort), DATABASE_PATH: dbPath });
    await waitUntilUp(`${apiUrl}/api/health`);
  };
  const stopApi = async () => {
    kill(api);
    api = null;
    for (let i = 0; i < 40; i++) {
      try {
        await fetch(`${apiUrl}/api/health`);
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  await startApi();
  const web = run(['vite', '--port', String(webPort), '--strictPort'], { API_URL: apiUrl }, join(process.cwd(), 'apps/web'));
  const webUrl = `http://localhost:${webPort}`;
  await waitUntilUp(webUrl);

  return {
    apiUrl,
    webUrl,
    startApi,
    stopApi,
    stop: async () => {
      kill(web);
      await stopApi();
      removeDb();
    },
  };
}
