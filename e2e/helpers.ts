import { type APIRequestContext, type Page, expect } from '@playwright/test';
import type { SedutaConPin, SessioneStaff, TavoloStato } from '@kikko/shared';

/** Admin API session used to prepare data (dev seed: admin/admin). */
export async function adminApi(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/login', { data: { username: 'admin', password: 'admin' } });
  expect(res.status()).toBe(200);
  const sessione = (await res.json()) as SessioneStaff;
  return { headers: { Authorization: `Bearer ${sessione.accessToken}` } };
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
export async function apriTavoloApi(request: APIRequestContext, numero: number): Promise<SedutaConPin> {
  const { headers } = await adminApi(request);
  const tavolo = await liberaTavolo(request, numero);
  const formule = (await (await request.get('/api/formule', { headers })).json()) as { formule: { id: string }[] };
  const res = await request.post(`/api/tavoli/${tavolo.id}/apri`, {
    headers,
    data: { formulaId: formule.formule[0]!.id, copertiAdulti: 2, copertiBambini: 0 },
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
