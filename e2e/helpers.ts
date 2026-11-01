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
