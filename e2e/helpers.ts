import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  devices,
  expect,
} from '@playwright/test';
import type { SedutaConPin, SessioneStaff, TavoloStato } from '@kikko/shared';

let sessioneAdmin: { token: string; scade: number } | null = null;

/** Admin API session used to prepare data (dev seed: admin/admin). Reused to stay under the login rate limit. */
export async function adminApi(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  if (!sessioneAdmin || sessioneAdmin.scade < Date.now()) {
    const res = await request.post('/api/auth/login', { data: { username: 'admin', password: 'admin' } });
    expect(res.status()).toBe(200);
    const sessione = (await res.json()) as SessioneStaff;
    sessioneAdmin = { token: sessione.accessToken, scade: Date.now() + (sessione.scadeTra - 60) * 1000 };
  }
  return { headers: { Authorization: `Bearer ${sessioneAdmin.token}` } };
}

export async function tavoloPerNumero(request: APIRequestContext, numero: number): Promise<TavoloStato> {
  const { headers } = await adminApi(request);
  const tavoli = (await (await request.get('/api/tavoli', { headers })).json()) as TavoloStato[];
  const tavolo = tavoli.find((t) => t.numero === numero);
  if (!tavolo) throw new Error(`Table ${numero} not found`);
  return tavolo;
}

/** Makes sure a table is free (closes its session if open), so tests can run again on the same database. */
export async function liberaTavolo(request: APIRequestContext, numero: number): Promise<TavoloStato> {
  const { headers } = await adminApi(request);
  const tavolo = await tavoloPerNumero(request, numero);
  if (tavolo.seduta) {
    const res = await request.post(`/api/sedute/${tavolo.seduta.id}/chiudi`, { headers });
    expect(res.status()).toBe(204);
  }
  return { ...tavolo, seduta: null };
}

/** Opens a table through the API and returns the PIN. */
export async function apriTavoloApi(
  request: APIRequestContext,
  numero: number,
  coperti = { copertiAdulti: 2, copertiBambini: 0 },
): Promise<SedutaConPin> {
  const { headers } = await adminApi(request);
  const tavolo = await liberaTavolo(request, numero);
  const formule = (await (await request.get('/api/formule', { headers })).json()) as {
    formule: { id: string; codice: string }[];
  };
  const cena = formule.formule.find((f) => f.codice === 'cena') ?? formule.formule[0]!;
  const res = await request.post(`/api/tavoli/${tavolo.id}/apri`, {
    headers,
    data: { formulaId: cena.id, ...coperti },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as SedutaConPin;
}

export async function loginStaff(page: Page, username = 'admin', password = 'admin'): Promise<void> {
  await page.goto('/staff/cameriere');
  await expect(page.getByRole('heading', { level: 1, name: 'Accesso staff' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Entra' }).click();
  await expect(page).toHaveURL(/\/staff\/cameriere$/);
  await expect(page.getByTestId('tavolo-1')).toBeVisible();
}

export async function inserisciPin(page: Page, pin: string): Promise<void> {
  await page.getByTestId('pin-input').fill(pin);
  await page.getByRole('button', { name: 'Entra' }).click();
}

/** A phone that scans the QR code of a table and joins with the PIN. */
export async function telefonoAlTavolo(
  browser: Browser,
  numero: number,
  pin: string,
  locale = 'it-IT',
): Promise<{ page: Page; close: () => Promise<void>; context: BrowserContext }> {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale });
  const page = await context.newPage();
  await page.goto(`/t/tavolo-${String(numero).padStart(2, '0')}`);
  await page.getByTestId('pin-input').fill(pin);
  await page.locator('form.pin button[type="submit"]').click();
  await expect(page.getByTestId('contatore-giro')).toBeVisible();
  return { page, context, close: () => context.close() };
}
