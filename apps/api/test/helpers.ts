import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SedutaConPin, SessioneStaff, TavoloStato } from '@kikko/shared';
import request from 'supertest';
import { expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { runSeed } from '../src/seed/seed-runner.js';
import { truncateAll } from './test-db.js';

export type Server = Parameters<typeof request>[0];

/** Boots the whole API. With `porta` it listens on a real port (needed by Socket.IO tests). */
export async function avviaApp(opzioni: { porta?: number } = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  if (opzioni.porta !== undefined) await app.listen(opzioni.porta, '127.0.0.1');
  else await app.init();
  return app;
}

/** Empty database + default config, demo menu, 24 tables, admin/admin and demo staff (mario, capo, monitor). */
export async function preparaDatabase(prisma: PrismaClient): Promise<void> {
  await truncateAll(prisma);
  await runSeed(prisma, {
    adminUsername: 'admin',
    adminPassword: 'admin',
    utentiDemo: true,
    mediaDir: process.env['MEDIA_DIR'],
  });
}

/** Opens a table and joins it with a new customer device; returns the device cookie. */
export async function clienteAlTavolo(server: Server, numero: number, pin: string): Promise<string> {
  const slug = `tavolo-${String(numero).padStart(2, '0')}`;
  const res = await request(server).post(`/api/t/${slug}/join`).send({ pin });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return cookieDa(res, 'kk_ct')!;
}

export async function login(server: Server, username: string, password = username): Promise<SessioneStaff> {
  const res = await request(server).post('/api/auth/login').send({ username, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as SessioneStaff;
}

export const bearer = (s: SessioneStaff) => ({ Authorization: `Bearer ${s.accessToken}` });

export async function tavolo(prisma: PrismaClient, numero: number) {
  return prisma.tavolo.findUniqueOrThrow({ where: { numero } });
}

export async function formulaCena(prisma: PrismaClient) {
  return prisma.formula.findUniqueOrThrow({ where: { codice: 'cena' } });
}

export async function apriTavolo(
  server: Server,
  staff: SessioneStaff,
  tavoloId: string,
  formulaId: string,
  coperti = { copertiAdulti: 2, copertiBambini: 1 },
): Promise<SedutaConPin> {
  const res = await request(server)
    .post(`/api/tavoli/${tavoloId}/apri`)
    .set(bearer(staff))
    .send({ formulaId, ...coperti });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as SedutaConPin;
}

export async function elencoTavoli(server: Server, staff: SessioneStaff): Promise<TavoloStato[]> {
  const res = await request(server).get('/api/tavoli').set(bearer(staff)).expect(200);
  return res.body as TavoloStato[];
}

/** Extracts `name=value` of a cookie from a Set-Cookie response header. */
export function cookieDa(res: { headers: Record<string, unknown> }, nome: string): string | null {
  const header = res.headers['set-cookie'];
  const lista = Array.isArray(header) ? (header as string[]) : typeof header === 'string' ? [header] : [];
  const riga = lista.find((c) => c.startsWith(`${nome}=`));
  return riga ? riga.split(';')[0]! : null;
}

export function setCookieCompleto(res: { headers: Record<string, unknown> }, nome: string): string | null {
  const header = res.headers['set-cookie'];
  const lista = Array.isArray(header) ? (header as string[]) : [];
  return lista.find((c) => c.startsWith(`${nome}=`)) ?? null;
}

/** A PIN guaranteed to be different from `pin`. */
export const pinSbagliato = (pin: string) => String((Number(pin) + 1) % 10_000).padStart(4, '0');
