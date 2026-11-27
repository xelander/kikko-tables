import { type Locator, type Page, expect, test } from '@playwright/test';
import { MOTIVI_RIFIUTO } from '@kikko/shared/browser';
import { apriTavoloApi, liberaTavolo, telefonoAlTavolo } from './helpers.js';

const aggiungi = (nome: string) => ({ name: `Aggiungi ${nome}`, exact: true });

/** The manager's tablet: logs in and lands on the till. */
async function tabletCassa(page: Page): Promise<void> {
  await page.goto('/staff/cassa');
  await expect(page.getByRole('heading', { level: 1, name: 'Accesso staff' })).toBeVisible();
  await page.getByLabel('Username').fill('capo');
  await page.getByLabel('Password').fill('capo');
  await page.getByRole('button', { name: 'Entra' }).click();
  await expect(page).toHaveURL(/\/staff\/cassa$/);
  await expect(page.getByRole('link', { name: /^Giri/ })).toBeVisible();
}

/**
 * Brings the round of table `n` into the detail view. Other tests run in parallel and may leave rounds waiting,
 * and the detail opens by itself on the oldest one: go back to the queue and open the right one.
 */
async function apriGiro(page: Page, n: number): Promise<Locator> {
  const dettaglio = page.getByTestId('dettaglio-giro');
  const titolo = dettaglio.locator('h1');
  await expect(async () => {
    if ((await titolo.isVisible()) && (await titolo.textContent())?.trim() === `Tavolo ${n}`) return;
    if (await titolo.isVisible()) await page.getByRole('button', { name: '‹ Tutti i giri' }).click();
    await page.getByTestId(`giro-${n}`).getByRole('button', { name: 'Apri dettaglio' }).click({ timeout: 1_000 });
    await expect(titolo).toHaveText(`Tavolo ${n}`, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return dettaglio;
}

async function inviaGiro(tel: Page, piatto: string, volte = 1): Promise<void> {
  for (let i = 0; i < volte; i++) await tel.getByRole('button', aggiungi(piatto)).click();
  await tel.getByTestId('apri-carrello').click();
  await tel.getByTestId('invia-giro').click();
  await expect(tel.getByTestId('giro-inviato')).toBeVisible();
  await tel.keyboard.press('Escape');
}

test.describe('F4 – manager at the till', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ locale: 'it-IT' });
  test.skip(({ isMobile }) => isMobile, 'The tablet and the phones are opened by the tests below');

  test('a round is rejected with a reason, sent again and approved: the table sees each answer', async ({
    page,
    browser,
    request,
  }) => {
    const aperta = await apriTavoloApi(request, 10);
    const tel = await telefonoAlTavolo(browser, 10, aperta.pin);
    await tabletCassa(page);

    await inviaGiro(tel.page, 'Nigiri salmone', 2);
    // The round opens in the detail: the manager ticks each dish while typing it into the cash register.
    const giro = await apriGiro(page, 10);
    await expect(giro).toContainText('Giro 1');
    const salmone = giro.getByRole('button', { name: /Nigiri salmone/ });
    await expect(salmone).toContainText('2 ×');
    await salmone.click();
    await expect(salmone).toHaveAttribute('aria-pressed', 'true');
    await expect(giro.getByTestId('progresso-caricati')).toContainText('tutto in cassa');

    // Rejected with a quick reason: the phone gets a notice with the reason, and can send again at once.
    const motivo = MOTIVI_RIFIUTO[1]!.it;
    await giro.getByRole('button', { name: 'Rifiuta', exact: true }).click();
    await page.getByRole('button', { name: motivo }).click();
    await page.getByRole('button', { name: 'Rifiuta giro' }).click();
    await expect(tel.page.getByTestId('notifica-giro')).toContainText('Giro 1 non accettato');
    await expect(tel.page.getByTestId('notifica-giro')).toContainText(motivo);

    await inviaGiro(tel.page, 'Nigiri salmone', 1);
    await (await apriGiro(page, 10)).getByRole('button', { name: 'Approva' }).click();
    await expect(tel.page.getByTestId('notifica-giro')).toContainText('Giro 2 confermato');
    await expect(page.locator('.recenti')).toContainText('Tavolo 10 · giro 2 · approvato da Capo sala');

    await tel.close();
    await liberaTavolo(request, 10);
  });

  test('a dish marked sold out disappears from the open menus at once', async ({ page, browser, request }) => {
    const aperta = await apriTavoloApi(request, 11);
    const tel = await telefonoAlTavolo(browser, 11, aperta.pin);
    const shumai = tel.page.getByTestId('piatto-5');
    await shumai.scrollIntoViewIfNeeded();
    await expect(shumai.getByRole('button', aggiungi('Shu mai'))).toBeVisible();

    await tabletCassa(page);
    await page.getByRole('link', { name: 'Esauriti' }).click();
    await page.getByPlaceholder('Cerca per numero o nome').fill('shu');
    await page.getByTestId('disponibile-5').click();
    await expect(page.getByTestId('disponibile-5')).toHaveText('Esaurito');

    await expect(shumai).toContainText('Esaurito');
    await expect(shumai.getByRole('button', aggiungi('Shu mai'))).toHaveCount(0);

    await page.getByTestId('disponibile-5').click();
    await expect(shumai.getByRole('button', aggiungi('Shu mai'))).toBeVisible();
    await tel.close();
    await liberaTavolo(request, 11);
  });

  test('extra time, pre-bill with drinks, and closing the table', async ({ page, browser, request }) => {
    const aperta = await apriTavoloApi(request, 12, { copertiAdulti: 2, copertiBambini: 1 });
    const tel = await telefonoAlTavolo(browser, 12, aperta.pin);
    await tel.page.getByRole('button', { name: 'Bevande' }).click();
    await inviaGiro(tel.page, 'Cola 33 cl', 2);

    await tabletCassa(page);
    await (await apriGiro(page, 12)).getByRole('button', { name: 'Approva' }).click();
    await expect(tel.page.getByTestId('notifica-giro')).toContainText('confermato');

    await page.getByRole('link', { name: 'Tavoli' }).click();
    const riga = page.getByTestId('cassa-tavolo-12');
    const prima = await riga.getByTestId('tempo').textContent();
    await riga.getByRole('button', { name: '+15′' }).click();
    await expect(page.getByText('+15 min al tavolo 12.')).toBeVisible();
    await expect(riga.getByTestId('tempo')).not.toHaveText(prima!);

    await riga.getByRole('link', { name: 'Pre-conto' }).click();
    const scontrino = page.getByTestId('preconto');
    await expect(scontrino).toContainText('Documento non fiscale');
    await expect(scontrino).toContainText('2 adulti + 1 bambino');
    await expect(scontrino).toContainText('Cola 33 cl');

    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Chiudi tavolo' }).click();
    await expect(page).toHaveURL(/\/staff\/cassa\/tavoli$/);
    await expect(page.getByTestId('cassa-tavolo-12')).toHaveCount(0);
    await expect(tel.page.getByText('Grazie e a presto!')).toBeVisible();
    await tel.close();
  });
});
