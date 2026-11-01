import { expect, test } from '@playwright/test';
import { expectNotReloaded, freeShippingBanner, getConfig, markNoReload, putConfig } from './helpers';

// Each test restores the configuration it changes, so tests are independent of order and repeatable.

test('changing a flag in the dashboard updates the open storefront without a reload', async ({ context, request }) => {
  const original = await getConfig(request, 'new_search', 'production');
  try {
    // Default store context: Aino (FI, regular) in Production, who gets basic search (bucket 45.59 < 80).
    const store = await context.newPage();
    await store.goto('/store/products');
    await expect(store.getByRole('textbox', { name: 'Search products' })).toHaveAttribute('placeholder', 'Search products by name');
    await expect(store.getByLabel('Sort')).toHaveCount(0);
    await markNoReload(store);

    // Default dashboard identity is the admin.
    const dashboard = await context.newPage();
    await dashboard.goto('/flags/new_search?env=production');
    await dashboard.getByLabel('Basic search weight').fill('0');
    await dashboard.getByLabel('Enhanced search weight').fill('100');
    await dashboard.getByRole('button', { name: 'Review & apply' }).click();
    const confirm = dashboard.getByRole('dialog');
    await expect(confirm).toContainText('Apply change to Production');
    await confirm.getByRole('button', { name: 'Apply to production' }).click();
    await expect(dashboard.getByText('No changes')).toBeVisible();

    await expect(store.getByLabel('Sort')).toBeVisible();
    await expect(store.getByRole('button', { name: 'Textiles' })).toBeVisible();
    await expectNotReloaded(store);
  } finally {
    await putConfig(request, 'new_search', 'production', original);
  }
});

test('switching demo customer and environment applies targeting', async ({ page }) => {
  await page.goto('/store');
  const customer = page.getByLabel('Demo customer');
  const loyaltyPoints = page.getByTitle('Nordhem Circle points');

  // Production: free shipping banner targets FI/SE; loyalty program targets Finland + employees.
  await expect(page.getByRole('radio', { name: 'Production' })).toHaveAttribute('aria-checked', 'true');
  await expect(customer).toHaveValue('u_aino');
  await expect(freeShippingBanner(page)).toBeVisible();
  await expect(loyaltyPoints).toBeVisible();

  await customer.selectOption('u_emma'); // US
  await expect(freeShippingBanner(page)).toHaveCount(0);
  await expect(loyaltyPoints).toHaveCount(0);

  await customer.selectOption('u_sanna'); // FI employee: banner exclusion beats the FI inclusion
  await expect(loyaltyPoints).toBeVisible();
  await expect(freeShippingBanner(page)).toHaveCount(0);

  // Development: banner and loyalty are on for everyone.
  await page.getByRole('radio', { name: 'Development' }).click();
  await customer.selectOption('u_emma');
  await expect(freeShippingBanner(page)).toBeVisible();
  await expect(loyaltyPoints).toBeVisible();
});

test('rolling back from the Activity page restores the storefront and records a new entry', async ({ context, request }) => {
  const original = await getConfig(request, 'free_shipping_banner', 'staging');
  try {
    // Set-up change (not under test): show the banner to everyone in Staging.
    await putConfig(request, 'free_shipping_banner', 'staging', { ...original, defaultEnabled: true });

    const store = await context.newPage();
    await store.goto('/store');
    await store.getByLabel('Demo customer').selectOption('u_emma');
    await store.getByRole('radio', { name: 'Staging' }).click();
    await expect(freeShippingBanner(store)).toBeVisible();
    await markNoReload(store);

    const dashboard = await context.newPage();
    await dashboard.goto('/audit?flagKey=free_shipping_banner&environment=staging');
    const entries = dashboard.getByRole('list').first().getByRole('listitem');
    await expect(entries.first()).toContainText('Config changed'); // list loaded; newest is the set-up change
    const before = await entries.count();
    await entries.first().getByRole('button').first().click(); // expand the newest entry (the set-up change)
    await dashboard.getByRole('button', { name: 'Roll back' }).click();
    await dashboard.getByRole('dialog').getByRole('button', { name: 'Restore configuration' }).click();

    await expect(entries).toHaveCount(before + 1);
    await expect(entries.first()).toContainText('Rolled back');
    await expect(freeShippingBanner(store)).toHaveCount(0);
    await expectNotReloaded(store);
    expect(await getConfig(request, 'free_shipping_banner', 'staging')).toEqual(original);
  } finally {
    await putConfig(request, 'free_shipping_banner', 'staging', original);
  }
});

test('a Developer cannot modify Production', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('flagship.actor', 'leo'));
  await page.goto('/flags/new_search?env=production');
  await expect(page.getByText('Your role cannot change Production')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Enabled' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Review & apply|Save changes/ })).toHaveCount(0);

  // The API enforces it too, not just the UI.
  const config = await getConfig(request, 'new_search', 'production');
  const res = await request.put('/api/flags/new_search/environments/production', {
    headers: { 'x-actor-id': 'leo' },
    data: { config: { ...config, enabled: false }, confirmProduction: true },
  });
  expect(res.status()).toBe(403);
  expect(await getConfig(request, 'new_search', 'production')).toEqual(config);
});
