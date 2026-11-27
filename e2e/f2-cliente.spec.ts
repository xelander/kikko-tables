import { expect, test } from '@playwright/test';
import { apriTavoloApi, liberaTavolo, telefonoAlTavolo } from './helpers.js';

const aggiungi = (nome: string) => ({ name: `Aggiungi ${nome}`, exact: true });

test.describe('F2 – customer ordering', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(({ isMobile }) => isMobile, 'Each test opens its own phones');

  test('two phones share the cart live and one of them sends the round', async ({ browser, request }) => {
    const aperta = await apriTavoloApi(request, 14);
    const anna = await telefonoAlTavolo(browser, 14, aperta.pin);
    const luca = await telefonoAlTavolo(browser, 14, aperta.pin);

    await expect(anna.page.getByText('Tavolo 14')).toBeVisible();
    await expect(anna.page.getByTestId('contatore-giro')).toContainText('0/12');

    // Anna adds two salmon nigiri: Luca sees them immediately, with Anna's emoji.
    await anna.page.getByRole('button', aggiungi('Nigiri salmone')).click();
    await anna.page.getByRole('button', aggiungi('Nigiri salmone')).click();
    await expect(anna.page.getByTestId('contatore-giro')).toContainText('2/12');
    await expect(luca.page.getByTestId('piatto-46')).toContainText('🐼 2 al tavolo');
    await expect(luca.page.getByTestId('contatore-giro')).toContainText('2/12');

    // Luca adds a drink (does not count) and sends the round for the whole table.
    await luca.page.getByRole('button', { name: 'Bevande', exact: true }).click();
    await luca.page.getByRole('button', aggiungi('Cola 33 cl')).click();
    await luca.page.getByTestId('apri-carrello').click();
    const carrello = luca.page.getByTestId('carrello');
    await expect(carrello).toContainText('Nigiri salmone');
    await expect(carrello).toContainText('Totale extra: 3,50');
    await carrello.getByTestId('invia-giro').click();
    await expect(carrello.getByTestId('giro-inviato')).toBeVisible();
    await expect(carrello.getByTestId('giri')).toContainText('Giro 1');
    await expect(carrello.getByTestId('giri')).toContainText('In attesa di conferma');

    // Anna's cart empties and she sees the countdown to the next round.
    await expect(anna.page.getByTestId('contatore-giro')).toContainText('0/12');
    await expect(anna.page.getByTestId('timer')).toContainText(/Prossimo giro tra 0?9:\d\d|10:00/);

    await anna.close();
    await luca.close();
    await liberaTavolo(request, 14);
  });

  test('a round sent while offline leaves when the connection comes back', async ({ browser, request }) => {
    const aperta = await apriTavoloApi(request, 15);
    const tel = await telefonoAlTavolo(browser, 15, aperta.pin);
    // wait for the cart change to reach the server before going offline
    const salvato = tel.page.waitForResponse((r) => r.url().includes('/api/cliente/carrello/') && r.ok());
    await tel.page.getByRole('button', aggiungi('Nigiri salmone')).click();
    await expect(tel.page.getByTestId('contatore-giro')).toContainText('1/12');
    await salvato;
    await tel.page.getByTestId('apri-carrello').click();

    await tel.context.setOffline(true);
    await tel.page.getByTestId('invia-giro').click();
    await expect(tel.page.getByTestId('giro-in-coda')).toBeVisible();

    await tel.context.setOffline(false);
    await expect(tel.page.getByTestId('giro-inviato')).toBeVisible({ timeout: 20_000 });
    await expect(tel.page.getByTestId('giri').locator('li')).toHaveCount(1);
    await tel.close();
    await liberaTavolo(request, 15);
  });

  test('"at most once per person": with 2 covers the table can order 2 bao', async ({ browser, request }) => {
    const aperta = await apriTavoloApi(request, 16);
    const tel = await telefonoAlTavolo(browser, 16, aperta.pin);
    const bao = tel.page.getByTestId('piatto-113');
    await bao.scrollIntoViewIfNeeded();
    await expect(bao).toContainText('max 1 a persona');
    await bao.getByRole('button', aggiungi('Bao bun')).click();
    await bao.getByRole('button', aggiungi('Bao bun')).click();
    await expect(bao.getByRole('button', aggiungi('Bao bun'))).toBeDisabled();
    await tel.close();
    await liberaTavolo(request, 16);
  });

  test('menu in English with photos, dish details and allergen filter', async ({ browser, request }) => {
    const aperta = await apriTavoloApi(request, 17);
    const tel = await telefonoAlTavolo(browser, 17, aperta.pin, 'en-GB');
    const page = tel.page;
    await expect(page.getByRole('button', { name: 'Send round' }).or(page.getByTestId('apri-carrello'))).toBeVisible();
    await expect(page.getByTestId('piatto-1')).toContainText('Spring rolls');

    const foto = page.getByTestId('piatto-1').locator('img');
    await expect(foto).toHaveJSProperty('complete', true);
    expect(await foto.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);

    await page.getByTestId('piatto-3').getByRole('button', { name: '3 Meat gyoza', exact: true }).click();
    await expect(page.getByTestId('allergeni')).toContainText('Celery');
    await page.keyboard.press('Escape');

    await page.locator('.filtro').click();
    await page.getByTestId('escludi-CRUSTACEANS').check();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('piatto-2')).toHaveCount(0); // Haki maki: prawns
    await expect(page.getByTestId('piatto-1')).toBeVisible();
    await tel.close();
    await liberaTavolo(request, 17);
  });
});
