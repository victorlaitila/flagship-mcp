import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Environment, EnvironmentConfig } from '@flagship/shared';
import { expectNotReloaded, freeShippingBanner, getConfig, markNoReload, putConfig, startRestartableStack } from './helpers';

// Dashboard writes must never silently overwrite other changes, reviews must show what is really applied,
// and live updates must recover. Each test restores the configuration it changes.

const ELSEWHERE_RULE = {
  id: 'r_elsewhere', description: 'Added elsewhere', effect: 'include', variant: null,
  conditions: [{ attribute: 'country', operator: 'in', values: ['SE'] }],
} as const;

/** Writes a config through the API (as admin) and returns the audit entry id it created. */
async function putAudited(request: APIRequestContext, flagKey: string, env: Environment, config: EnvironmentConfig) {
  const res = await request.put(`/api/flags/${flagKey}/environments/${env}`, { headers: { 'x-actor-id': 'sara' }, data: { config, confirmProduction: true } });
  expect(res.ok(), await res.text()).toBe(true);
  return Number(res.headers()['x-audit-id']);
}

/** Cuts the page's live-update stream so it can't learn about a change before acting (the 409 path). */
const blockLiveUpdates = (page: Page) => page.route('**/api/events', (route) => route.abort());

const rollout = (page: Page) => page.getByLabel('Rollout percentage value');
const conflictBanner = (page: Page) => page.getByText(/changed elsewhere since you started editing/);

test.describe('concurrent saves', () => {
  test('a save rejected as stale keeps the draft and never overwrites the other change', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'staging');
    try {
      await blockLiveUpdates(page);
      await page.goto('/flags/ai_recommendations?env=staging');
      await rollout(page).fill('77');

      const elsewhere = { ...original, rules: [ELSEWHERE_RULE] };
      await putConfig(request, 'ai_recommendations', 'staging', elsewhere);
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(conflictBanner(page)).toBeVisible();
      await expect(rollout(page)).toHaveValue('77'); // draft kept
      await expect(page.getByText('Unsaved changes')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      expect(await getConfig(request, 'ai_recommendations', 'staging')).toEqual(elsewhere);

      await page.getByRole('button', { name: 'Discard my edits and load the latest' }).click();
      await expect(rollout(page)).toHaveValue(String(original.rolloutPercentage));
      await expect(page.getByPlaceholder('Description (optional)')).toHaveValue('Added elsewhere');
      await expect(page.getByText('No changes')).toBeVisible();
    } finally {
      await putConfig(request, 'ai_recommendations', 'staging', original);
    }
  });

  test('a change arriving live while editing blocks saving and keeps the draft', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'staging');
    try {
      await page.goto('/flags/ai_recommendations?env=staging');
      await rollout(page).fill('77');
      await putConfig(request, 'ai_recommendations', 'staging', { ...original, rules: [ELSEWHERE_RULE] });

      await expect(conflictBanner(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      await expect(rollout(page)).toHaveValue('77');
    } finally {
      await putConfig(request, 'ai_recommendations', 'staging', original);
    }
  });
});

test.describe('saving', () => {
  test('the editor never flips back to the pre-save value while the flag list reloads', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'staging');
    try {
      await page.goto('/flags/ai_recommendations?env=staging');
      // Slow down the list reload that follows the save, to widen the window where the old copy is still shown.
      await page.route('**/api/flags', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fallback();
      });
      await rollout(page).fill('71');
      await page.getByRole('button', { name: 'Save changes' }).click();
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(await rollout(page).inputValue());
        await page.waitForTimeout(50);
      }
      expect([...seen]).toEqual(['71']);
      await expect(page.getByText('No changes')).toBeVisible();
      expect((await getConfig(request, 'ai_recommendations', 'staging')).rolloutPercentage).toBe(71);
    } finally {
      await putConfig(request, 'ai_recommendations', 'staging', original);
    }
  });

  test('a save whose response is lost is checked against the backend instead of guessed', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'staging');
    const configPath = '**/api/flags/ai_recommendations/environments/staging';
    try {
      await page.goto('/flags/ai_recommendations?env=staging');

      // The write reaches the API, but its response never arrives.
      await page.route(configPath, async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await route.fetch();
        await route.abort('connectionreset');
      });
      await rollout(page).fill('64');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/confirmed that your change was saved/)).toBeVisible();
      await expect(page.getByText('No changes')).toBeVisible();
      expect((await getConfig(request, 'ai_recommendations', 'staging')).rolloutPercentage).toBe(64);

      // The request never reaches the API: reported as not saved, draft kept.
      await page.unroute(configPath);
      await page.route(configPath, (route) => (route.request().method() === 'PUT' ? route.abort('connectionreset') : route.fallback()));
      await rollout(page).fill('65');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/the change was not saved/)).toBeVisible();
      await expect(rollout(page)).toHaveValue('65');
      await expect(page.getByText('Unsaved changes')).toBeVisible();
      expect((await getConfig(request, 'ai_recommendations', 'staging')).rolloutPercentage).toBe(64);
    } finally {
      await putConfig(request, 'ai_recommendations', 'staging', original);
    }
  });
});

test.describe('Production review', () => {
  test('compares against the stored config and shows the value as the backend will save it', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'production');
    try {
      await page.goto('/flags/ai_recommendations?env=production');
      await putConfig(request, 'ai_recommendations', 'production', { ...original, rolloutPercentage: 30 });
      await expect(rollout(page)).toHaveValue('30'); // followed live while not editing

      await rollout(page).fill('33.333');
      await page.getByRole('button', { name: 'Review & apply' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('30%');
      await expect(dialog).toContainText('33.33%');
      await expect(dialog).not.toContainText('33.333');

      await dialog.getByRole('button', { name: 'Apply to production' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(rollout(page)).toHaveValue('33.33');
      expect((await getConfig(request, 'ai_recommendations', 'production')).rolloutPercentage).toBe(33.33);
    } finally {
      await putConfig(request, 'ai_recommendations', 'production', original);
    }
  });

  test('is not offered over a change the editor has not seen', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'production');
    try {
      await blockLiveUpdates(page);
      await page.goto('/flags/ai_recommendations?env=production');
      await rollout(page).fill('40');
      const elsewhere = { ...original, rules: [ELSEWHERE_RULE] };
      await putConfig(request, 'ai_recommendations', 'production', elsewhere);

      await page.getByRole('button', { name: 'Review & apply' }).click();
      await expect(conflictBanner(page)).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(rollout(page)).toHaveValue('40');
      expect(await getConfig(request, 'ai_recommendations', 'production')).toEqual(elsewhere);
    } finally {
      await putConfig(request, 'ai_recommendations', 'production', original);
    }
  });
});

test.describe('rollback', () => {
  test('shows its full effect against the current config, including later changes it removes', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'staging');
    try {
      const changeId = await putAudited(request, 'ai_recommendations', 'staging', { ...original, rolloutPercentage: 30 });
      const later = { ...original, rolloutPercentage: 30, rules: [ELSEWHERE_RULE] };
      await putConfig(request, 'ai_recommendations', 'staging', later);

      await page.goto('/audit?flagKey=ai_recommendations&environment=staging');
      await page.getByRole('button', { name: new RegExp(`#${changeId}$`) }).click();
      await page.getByRole('button', { name: 'Roll back' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`This flag has changed since #${changeId}`);
      await expect(dialog).toContainText('is in list SE'); // the later rule, which the rollback removes
      await expect(dialog).toContainText(`${original.rolloutPercentage}%`);

      await dialog.getByRole('button', { name: 'Restore configuration' }).click();
      await expect(dialog).toHaveCount(0);
      expect(await getConfig(request, 'ai_recommendations', 'staging')).toEqual(original);
    } finally {
      await putConfig(request, 'ai_recommendations', 'staging', original);
    }
  });

  test('is refused when the config changes between preview and execution', async ({ page, request }) => {
    const original = await getConfig(request, 'ai_recommendations', 'staging');
    try {
      const changeId = await putAudited(request, 'ai_recommendations', 'staging', { ...original, rolloutPercentage: 30 });
      await page.goto('/audit?flagKey=ai_recommendations&environment=staging');
      await page.getByRole('button', { name: new RegExp(`#${changeId}$`) }).click();
      await page.getByRole('button', { name: 'Roll back' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Restore configuration' })).toBeEnabled();

      const intervening = { ...original, rolloutPercentage: 30, enabled: false };
      await putConfig(request, 'ai_recommendations', 'staging', intervening);
      await dialog.getByRole('button', { name: 'Restore configuration' }).click();

      await expect(dialog).toContainText('changed while this dialog was open');
      await expect(dialog).toContainText('Disabled'); // the refreshed comparison now includes the intervening change
      expect(await getConfig(request, 'ai_recommendations', 'staging')).toEqual(intervening);
    } finally {
      await putConfig(request, 'ai_recommendations', 'staging', original);
    }
  });
});

test.describe('live updates after an API restart', () => {
  let stack: Awaited<ReturnType<typeof startRestartableStack>>;
  test.beforeAll(async () => {
    test.setTimeout(90_000);
    stack = await startRestartableStack();
  });
  test.afterAll(async () => stack?.stop());

  test('the store and dashboard reconnect, show it honestly, and resync missed changes', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ baseURL: stack.webUrl });
    const store = await context.newPage();
    await store.goto('/store'); // Aino (FI) in Production: sees the Nordic free-shipping banner
    await expect(freeShippingBanner(store)).toBeVisible();
    await expect(store.getByText('Live flags')).toBeVisible();
    const dashboard = await context.newPage();
    await dashboard.goto('/flags/free_shipping_banner?env=production');
    const enabled = dashboard.getByRole('switch', { name: 'Enabled' });
    await expect(enabled).toBeChecked();
    await markNoReload(store);
    await markNoReload(dashboard);

    await stack.stopApi();
    await expect(store.getByText(/Reconnecting|Live updates offline/)).toBeVisible();
    await expect(store.getByText('Live flags')).toHaveCount(0);
    await expect(dashboard.getByRole('status')).toContainText('Live updates');

    // The API comes back and a change happens while the pages are still disconnected, so its event is missed.
    for (const page of [store, dashboard]) await page.route('**/api/events', (route) => route.fulfill({ status: 503, body: '' }));
    await stack.startApi();
    const path = `${stack.apiUrl}/api/flags/free_shipping_banner/environments/production`;
    const config = await (await fetch(path)).json();
    const put = await fetch(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-actor-id': 'sara' },
      body: JSON.stringify({ config: { ...config, enabled: false }, confirmProduction: true }),
    });
    expect(put.ok).toBe(true);
    await store.waitForTimeout(1500);
    await expect(freeShippingBanner(store)).toBeVisible(); // missed, and...
    await expect(store.getByText('Live flags')).toHaveCount(0); // ...not presented as live

    for (const page of [store, dashboard]) await page.unroute('**/api/events');
    await expect(store.getByText('Live flags')).toBeVisible({ timeout: 40_000 });
    await expect(freeShippingBanner(store)).toHaveCount(0);
    await expect(enabled).not.toBeChecked({ timeout: 40_000 });
    await expect(dashboard.getByRole('status')).toHaveCount(0);
    await expectNotReloaded(store);
    await expectNotReloaded(dashboard);
    await context.close();
  });
});
