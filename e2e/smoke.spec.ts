import { expect, test } from '@playwright/test';

test.describe('F0 smoke', () => {
  test('the API health endpoint reports the database up', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  test('the web app loads and sees a healthy API', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Kikko' })).toBeVisible();
    const status = page.getByTestId('api-status');
    await expect(status).toHaveAttribute('data-status', 'ok');
    await expect(status).toContainText('API online · database connesso');
  });

  test('areas are lazy loaded and reachable from the home page', async ({ page }) => {
    const loadedScripts: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'script') loadedScripts.push(req.url());
    });

    await page.goto('/');
    await expect(page.getByTestId('api-status')).toHaveAttribute('data-status', 'ok');
    const scriptsOnHome = loadedScripts.length;

    await page.getByRole('link', { name: /Cliente/ }).click();
    await expect(page).toHaveURL(/\/t\/tavolo-01$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tavolo tavolo-01');
    await expect(page).toHaveTitle('Il tuo tavolo');
    expect(loadedScripts.length).toBeGreaterThan(scriptsOnHome);
  });

  test('deep links to each area work', async ({ page }) => {
    for (const [path, heading] of [
      ['/staff/cameriere', 'Cameriere'],
      ['/staff/cassa', 'Cassa'],
      ['/admin', 'Amministratore'],
      ['/monitor', 'Monitor'],
      ['/pagina-inesistente', 'Pagina non trovata'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    }
  });
});
