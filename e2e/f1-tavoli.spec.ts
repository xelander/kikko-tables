import { devices, expect, test } from '@playwright/test';
import { apriTavoloApi, inserisciPin, liberaTavolo, loginStaff } from './helpers.js';

const PIN_SBAGLIATO = (pin: string) => String((Number(pin) + 1) % 10_000).padStart(4, '0');

test.describe('F1 – tables, PIN and live updates', () => {
  // These tests share tables on one database: run them one after the other.
  test.describe.configure({ mode: 'serial' });
  test.skip(({ isMobile }) => isMobile, 'Staff + customer flows use their own devices below');

  test('a waiter opens a table, a customer joins with the PIN, closing ends the customer session', async ({
    page,
    browser,
    request,
  }) => {
    await liberaTavolo(request, 3);
    page.on('dialog', (d) => void d.accept());
    await loginStaff(page);

    // Open table 3 for 2 adults with the suggested formula.
    await page.getByTestId('tavolo-3').click();
    await expect(page.getByRole('heading', { name: 'Tavolo 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Apri tavolo' }).click();
    const pinBox = page.getByTestId('pin');
    await expect(pinBox).toBeVisible();
    const pin = (await pinBox.locator('.pin__cifre').textContent())!.trim();
    expect(pin).toMatch(/^\d{4}$/);
    await page.getByRole('button', { name: 'Fatto' }).click();
    await expect(page.getByTestId('tavolo-3')).toHaveAttribute('data-stato', 'aperto');

    // A customer scans the QR code with a phone.
    const telefono = await browser.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
    const cliente = await telefono.newPage();
    await cliente.goto('/t/tavolo-03');
    await expect(cliente.getByRole('heading', { name: 'Inserisci il PIN del tavolo' })).toBeVisible();
    await inserisciPin(cliente, pin);
    await expect(cliente.getByTestId('connesso')).toContainText('Sei al tavolo 3');

    // The waiter sees the phone appear live, without reloading.
    await expect(page.getByTestId('tavolo-3')).toContainText('📱 1');

    // Reloading the phone keeps it at the table (no PIN again).
    await cliente.reload();
    await expect(cliente.getByTestId('connesso')).toBeVisible();

    // Closing the table ends the session on the phone.
    await page.getByTestId('tavolo-3').click();
    await page.getByRole('button', { name: 'Chiudi tavolo' }).click();
    await expect(page.getByTestId('tavolo-3')).toHaveAttribute('data-stato', 'libero');
    await expect(cliente.getByTestId('tavolo-chiuso')).toContainText('Grazie e a presto!');
    await telefono.close();
  });

  test('a table that is not open asks the customer to call the staff', async ({ browser, request }) => {
    await liberaTavolo(request, 5);
    const telefono = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    const cliente = await telefono.newPage();
    await cliente.goto('/t/tavolo-05');
    await expect(cliente.getByTestId('non-attivo')).toContainText('This table is not active yet');
    await cliente.getByRole('button', { name: 'IT' }).click();
    await expect(cliente.getByTestId('non-attivo')).toContainText('Tavolo non ancora attivo');
    await telefono.close();
  });

  test('five wrong PINs lock the phone for a minute', async ({ browser, request }) => {
    const aperta = await apriTavoloApi(request, 4);
    const telefono = await browser.newContext({ ...devices['Pixel 7'], locale: 'it-IT' });
    const cliente = await telefono.newPage();
    await cliente.goto('/t/tavolo-04');
    const sbagliato = PIN_SBAGLIATO(aperta.pin);

    for (const rimasti of [4, 3, 2, 1]) {
      await inserisciPin(cliente, sbagliato);
      await expect(cliente.getByRole('alert')).toContainText(
        `ancora ${rimasti === 1 ? '1 tentativo' : `${rimasti} tentativi`}`,
      );
    }
    await inserisciPin(cliente, sbagliato);
    await expect(cliente.getByTestId('bloccato')).toContainText(/Troppi tentativi\. Riprova tra (59|60) secondi/);
    await expect(cliente.getByTestId('pin-input')).toBeDisabled();
    await telefono.close();
    await liberaTavolo(request, 4);
  });

  test('a staff device goes back to its page after a reload, and shows the connection banner', async ({
    page,
    context,
  }) => {
    await loginStaff(page);
    await page.reload();
    await expect(page).toHaveURL(/\/staff\/cameriere$/);
    await expect(page.getByTestId('tavolo-1')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'Connessione persa, riprovo…' })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'Ripristinato' })).toBeVisible({ timeout: 20_000 });
  });
});
