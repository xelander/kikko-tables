import { expect, test } from '@playwright/test';
import { apriTavoloApi, liberaTavolo, loginStaff, telefonoAlTavolo } from './helpers.js';

test.describe('F3 – waiter app', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ locale: 'it-IT' });
  test.skip(({ isMobile }) => isMobile, 'Staff and customers use their own devices below');

  test('a waiter opens a table and orders for guests without a phone', async ({ page, request }) => {
    await liberaTavolo(request, 20);
    await loginStaff(page, 'mario', 'mario');

    await page.getByTestId('tavolo-20').click();
    await page.getByRole('button', { name: 'Apri tavolo' }).click();
    await expect(page.getByTestId('pin')).toBeVisible();
    await page.getByRole('button', { name: 'Vai al tavolo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tavolo 20');

    await page.getByTestId('ordina').click();
    await expect(page.getByText('Ordine per conto del tavolo')).toBeVisible();
    const piu = page.getByRole('button', { name: 'Aggiungi Nigiri salmone', exact: true });
    await piu.click();
    await piu.click();
    // the limit depends on the formula suggested for the current time
    await expect(page.getByTestId('contatore-giro')).toContainText(/2\/\d+/);
    await page.getByTestId('apri-carrello').click();
    await expect(page.getByTestId('carrello')).toContainText('🧑‍🍳 2');
    await page.getByTestId('invia-giro').click();
    await expect(page.getByTestId('giro-inviato')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Torna al tavolo' }).click();
    await expect(page.getByTestId('giri-tavolo')).toContainText('Giro 1');
    await expect(page.getByTestId('giri-tavolo')).toContainText('2 × Nigiri salmone');
    await expect(page.getByTestId('giri-tavolo')).toContainText('In attesa');

    await page.getByRole('link', { name: '‹ Tutti i tavoli' }).click();
    await expect(page.getByTestId('tavolo-20')).toContainText('1 giro');
    await liberaTavolo(request, 20);
  });

  test('moving a table keeps the customer phone in, with the new table number', async ({ page, browser, request }) => {
    await liberaTavolo(request, 22);
    const aperta = await apriTavoloApi(request, 21);
    const tel = await telefonoAlTavolo(browser, 21, aperta.pin);
    await expect(tel.page.getByText('Tavolo 21', { exact: true })).toBeVisible();

    await loginStaff(page);
    await page.getByTestId('tavolo-21').click();
    await page.getByRole('button', { name: '↔ Sposta' }).click();
    await page.getByTestId('tavoli-liberi').getByRole('button', { name: '22', exact: true }).click();
    await expect(page.getByText('Tavolo spostato al 22.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tavolo 22');

    // the phone follows live, and still works after a reload of the old QR code
    await expect(tel.page.getByText('Tavolo 22', { exact: true })).toBeVisible();
    await tel.page.reload();
    await expect(tel.page.getByText('Tavolo 22', { exact: true })).toBeVisible();
    await tel.close();
    await liberaTavolo(request, 22);
  });

  test('merging two open tables moves the phones of the second one', async ({ page, browser, request }) => {
    const a = await apriTavoloApi(request, 23);
    const b = await apriTavoloApi(request, 24);
    const tel = await telefonoAlTavolo(browser, 24, b.pin);

    await loginStaff(page);
    await page.getByTestId('tavolo-23').click();
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '➕ Unisci' }).click();
    await page.getByTestId('tavoli-unibili').getByRole('button', { name: '24', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tavolo 23 + 24');
    await expect(page.getByTestId('coperti')).toContainText('4');

    // the phone at table 24 reloads by itself into the merged session
    await expect(tel.page.getByText('Tavolo 23 + 24', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(tel.page.getByTestId('contatore-giro')).toContainText('0/24');
    await tel.close();
    await liberaTavolo(request, 23);
    expect(a.seduta.id).not.toBe(b.seduta.id);
  });
});
