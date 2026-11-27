import type { INestApplication } from '@nestjs/common';
import type { SedutaConPin, SessioneStaff, StatoTavoloCliente } from '@kikko/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  type Server,
  apriTavolo,
  avviaApp,
  cookieDa,
  formulaCena,
  login,
  pinSbagliato,
  preparaDatabase,
  setCookieCompleto,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

describe('customer access with QR code and PIN', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let mario: SessioneStaff;
  let aperta: SedutaConPin;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    mario = await login(server, 'mario');
    aperta = await apriTavolo(server, mario, (await tavolo(prisma, 7)).id, (await formulaCena(prisma)).id);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('answers 404 for an unknown table and NON_ATTIVO for a free one', async () => {
    await request(server).get('/api/t/non-esiste').expect(404);
    const libero = await request(server).get('/api/t/tavolo-08').expect(200);
    expect(libero.body).toEqual({ stato: 'NON_ATTIVO', tavolo: { numero: 8 } });
    const join = await request(server).post('/api/t/tavolo-08/join').send({ pin: '1234' }).expect(409);
    expect(join.body.codice).toBe('NON_ATTIVO');
  });

  it('asks for the PIN and gives the device an anonymous id cookie', async () => {
    const res = await request(server).get('/api/t/tavolo-07').expect(200);
    expect(res.body).toEqual({ stato: 'PIN_RICHIESTO', tavolo: { numero: 7 }, bloccatoPerSecondi: 0 });
    expect(setCookieCompleto(res, 'kk_did')).toMatch(/Path=\/api\/t; .*HttpOnly/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('admits a device with the right PIN and recognises it afterwards', async () => {
    const agent = request.agent(server);
    await agent.get('/api/t/tavolo-07').expect(200);
    const join = await agent.post('/api/t/tavolo-07/join').send({ pin: aperta.pin, soprannome: 'Luca' }).expect(200);
    expect(join.body).toMatchObject({ soprannome: 'Luca', emoji: '🐼' });
    const cookie = setCookieCompleto(join, 'kk_ct')!;
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const stato = (await agent.get('/api/t/tavolo-07').expect(200)).body as StatoTavoloCliente;
    expect(stato).toMatchObject({
      stato: 'CONNESSO',
      tavolo: { numero: 7 },
      sedutaId: aperta.seduta.id,
      dispositivo: { soprannome: 'Luca', emoji: '🐼' },
      formula: { nome: { it: 'Cena', en: 'Dinner' } },
    });

    const token = cookie.split(';')[0]!.split('=')[1]!;
    const riga = await prisma.dispositivoCliente.findFirstOrThrow();
    expect(riga.tokenHash).not.toBe(token);
    expect(await prisma.evento.count({ where: { tipo: 'DISPOSITIVO_UNITO' } })).toBe(1);
  });

  it('gives every device of the table a different emoji and a default nickname', async () => {
    const emoji = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(server).post('/api/t/tavolo-07/join').send({ pin: aperta.pin }).expect(200);
      emoji.push(res.body.emoji);
      expect(res.body.soprannome).toBe(`Ospite ${i + 1}`);
    }
    expect(new Set(emoji).size).toBe(3);
  });

  it('does not accept a token of another table', async () => {
    const join = await request(server).post('/api/t/tavolo-07/join').send({ pin: aperta.pin }).expect(200);
    await apriTavolo(server, mario, (await tavolo(prisma, 9)).id, (await formulaCena(prisma)).id);
    const altro = await request(server).get('/api/t/tavolo-09').set('Cookie', cookieDa(join, 'kk_ct')!).expect(200);
    expect(altro.body.stato).toBe('PIN_RICHIESTO');
  });

  it('counts wrong PINs per device, locks after 5 and records PIN_ERRATO events', async () => {
    const agent = request.agent(server);
    await agent.get('/api/t/tavolo-07');
    const sbagliato = pinSbagliato(aperta.pin);

    for (const rimasti of [4, 3, 2, 1]) {
      const res = await agent.post('/api/t/tavolo-07/join').send({ pin: sbagliato }).expect(401);
      expect(res.body).toEqual({ codice: 'PIN_ERRATO', tentativiRimasti: rimasti });
    }
    const quinto = await agent.post('/api/t/tavolo-07/join').send({ pin: sbagliato }).expect(429);
    expect(quinto.body).toEqual({ codice: 'BLOCCATO', riprovaTraSecondi: 60 });

    // Locked: even the right PIN is refused.
    const giusto = await agent.post('/api/t/tavolo-07/join').send({ pin: aperta.pin }).expect(429);
    expect(giusto.body.codice).toBe('BLOCCATO');
    const stato = await agent.get('/api/t/tavolo-07').expect(200);
    expect(stato.body.bloccatoPerSecondi).toBeGreaterThan(55);

    const eventi = await prisma.evento.findMany({ where: { tipo: 'PIN_ERRATO' }, orderBy: { seq: 'asc' } });
    expect(eventi).toHaveLength(5);
    expect(eventi[0]).toMatchObject({
      attoreRuolo: 'CLIENTE',
      sedutaId: aperta.seduta.id,
      payload: { tavoloNumero: 7 },
    });
    expect(JSON.stringify(eventi.map((e) => e.payload))).not.toContain(aperta.pin);
  });

  it('locks the whole table after 5 wrong PINs from different devices', async () => {
    const sbagliato = pinSbagliato(aperta.pin);
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/t/tavolo-07/join')
        .set('Cookie', `kk_did=attaccante-${i}`)
        .send({ pin: sbagliato });
    }
    const nuovo = await request(server)
      .post('/api/t/tavolo-07/join')
      .set('Cookie', 'kk_did=onesto')
      .send({ pin: aperta.pin });
    expect(nuovo.status).toBe(429);

    // Other tables are not affected.
    const altro = await apriTavolo(server, mario, (await tavolo(prisma, 10)).id, (await formulaCena(prisma)).id);
    await request(server)
      .post('/api/t/tavolo-10/join')
      .set('Cookie', 'kk_did=onesto')
      .send({ pin: altro.pin })
      .expect(200);
  });

  it('lets the device in once the lock expires, and grows the next lock', async () => {
    const agent = request.agent(server);
    await agent.get('/api/t/tavolo-07');
    const sbagliato = pinSbagliato(aperta.pin);
    for (let i = 0; i < 5; i++) await agent.post('/api/t/tavolo-07/join').send({ pin: sbagliato });

    // Simulate the passing of 61 seconds.
    await prisma.tentativoPin.updateMany({ data: { bloccatoFino: new Date(Date.now() - 1000) } });
    for (let i = 0; i < 4; i++) await agent.post('/api/t/tavolo-07/join').send({ pin: sbagliato }).expect(401);
    const secondoBlocco = await agent.post('/api/t/tavolo-07/join').send({ pin: sbagliato }).expect(429);
    expect(secondoBlocco.body.riprovaTraSecondi).toBe(120);

    await prisma.tentativoPin.updateMany({ data: { bloccatoFino: new Date(Date.now() - 1000) } });
    await agent.post('/api/t/tavolo-07/join').send({ pin: aperta.pin }).expect(200);
    expect(await prisma.tentativoPin.count()).toBe(0);
  });

  it('validates the PIN format', async () => {
    const res = await request(server).post('/api/t/tavolo-07/join').send({ pin: '12a4' }).expect(400);
    expect(res.body.codice).toBe('DATI_NON_VALIDI');
    await request(server).post('/api/t/tavolo-07/join').send({ pin: '12345' }).expect(400);
  });
});
