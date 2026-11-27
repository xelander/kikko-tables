import type { INestApplication } from '@nestjs/common';
import type { FormulaSnapshot, FormuleDisponibili, SessioneStaff } from '@kikko/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  type Server,
  apriTavolo,
  avviaApp,
  bearer,
  cookieDa,
  elencoTavoli,
  formulaCena,
  login,
  pinSbagliato,
  preparaDatabase,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

describe('tables and sessions', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let mario: SessioneStaff;
  let capo: SessioneStaff;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    mario = await login(server, 'mario');
    capo = await login(server, 'capo');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists the active formulas with a suggestion for now', async () => {
    const res = await request(server).get('/api/formule').set(bearer(mario)).expect(200);
    const body = res.body as FormuleDisponibili;
    expect(body.formule.map((f) => f.codice)).toEqual(['pranzo-feriale', 'cena', 'weekend']);
    if (body.propostaId !== null) expect(body.formule.map((f) => f.id)).toContain(body.propostaId);
  });

  it('lists 24 free tables', async () => {
    const tavoli = await elencoTavoli(server, mario);
    expect(tavoli).toHaveLength(24);
    expect(tavoli.every((t) => t.seduta === null)).toBe(true);
    expect(tavoli[0]).toMatchObject({ numero: 1, slugQr: 'tavolo-01' });
  });

  it('opens a table: session with formula snapshot, 4-digit PIN and an event', async () => {
    const t = await tavolo(prisma, 5);
    const cena = await formulaCena(prisma);
    const aperta = await apriTavolo(server, mario, t.id, cena.id, { copertiAdulti: 3, copertiBambini: 2 });

    expect(aperta.pin).toMatch(/^\d{4}$/);
    expect(aperta.tavoloId).toBe(t.id);
    expect(aperta.seduta).toMatchObject({
      copertiAdulti: 3,
      copertiBambini: 2,
      scaduta: false,
      dispositiviCollegati: 0,
      formula: { codice: 'cena', nome: { it: 'Cena', en: 'Dinner' } },
    });
    const durata = Date.parse(aperta.seduta.scadeIl) - Date.parse(aperta.seduta.apertaIl);
    expect(durata).toBe(150 * 60_000);

    const riga = await prisma.seduta.findUniqueOrThrow({ where: { id: aperta.seduta.id } });
    expect(riga.pinHash).not.toContain(aperta.pin);
    expect(riga.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(riga.apertaDaId).toBe(mario.utente.id);

    const tavoli = await elencoTavoli(server, mario);
    expect(tavoli.find((x) => x.numero === 5)?.seduta?.id).toBe(aperta.seduta.id);

    const eventi = await prisma.evento.findMany({ where: { tipo: 'TAVOLO_APERTO' } });
    expect(eventi).toHaveLength(1);
    expect(eventi[0]).toMatchObject({
      attoreRuolo: 'CAMERIERE',
      attoreId: mario.utente.id,
      sedutaId: aperta.seduta.id,
      tavoloId: t.id,
      payload: { tavoloNumero: 5, copertiAdulti: 3, copertiBambini: 2, formula: 'cena' },
    });
    expect(JSON.stringify(eventi[0]!.payload)).not.toContain(aperta.pin);
  });

  it('keeps the formula snapshot when the administrator changes the formula later', async () => {
    const t = await tavolo(prisma, 1);
    const cena = await formulaCena(prisma);
    const aperta = await apriTavolo(server, mario, t.id, cena.id);

    await prisma.formula.update({
      where: { id: cena.id },
      data: { nomeIt: 'Cena nuova', piattiPerPersonaPerGiro: 99, durataMaxMinuti: 10 },
    });

    const riga = await prisma.seduta.findUniqueOrThrow({ where: { id: aperta.seduta.id } });
    const snapshot = riga.formulaSnapshot as unknown as FormulaSnapshot;
    expect(snapshot).toMatchObject({ versione: 1, codice: 'cena', piattiPerPersonaPerGiro: 6, durataMaxMinuti: 150 });
    const tavoli = await elencoTavoli(server, mario);
    expect(tavoli.find((x) => x.numero === 1)?.seduta).toMatchObject({
      formula: { nome: { it: 'Cena' } },
      scaduta: false,
    });
  });

  it('validates the opening request', async () => {
    const t = await tavolo(prisma, 1);
    const cena = await formulaCena(prisma);
    const apri = (body: object) => request(server).post(`/api/tavoli/${t.id}/apri`).set(bearer(mario)).send(body);

    expect((await apri({ formulaId: cena.id, copertiAdulti: 0, copertiBambini: 0 })).status).toBe(400);
    expect((await apri({ formulaId: 'x', copertiAdulti: 2, copertiBambini: 0 })).status).toBe(400);
    await prisma.formula.update({ where: { id: cena.id }, data: { attiva: false } });
    const disattiva = await apri({ formulaId: cena.id, copertiAdulti: 2, copertiBambini: 0 });
    expect(disattiva.status).toBe(400);
    expect(disattiva.body.codice).toBe('FORMULA_NON_VALIDA');
    await request(server)
      .post('/api/tavoli/00000000-0000-4000-8000-000000000000/apri')
      .set(bearer(mario))
      .send({ formulaId: cena.id, copertiAdulti: 2, copertiBambini: 0 })
      .expect(404);
  });

  it('refuses to open a table that is already open, even with concurrent requests', async () => {
    const t = await tavolo(prisma, 2);
    const cena = await formulaCena(prisma);
    const body = { formulaId: cena.id, copertiAdulti: 2, copertiBambini: 0 };
    const risposte = await Promise.all(
      Array.from({ length: 5 }, () => request(server).post(`/api/tavoli/${t.id}/apri`).set(bearer(mario)).send(body)),
    );
    expect(risposte.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.seduta.count()).toBe(1);
    expect(await prisma.evento.count({ where: { tipo: 'TAVOLO_APERTO' } })).toBe(1);
  });

  it('regenerates the PIN: the old one stops working, the new one works', async () => {
    const t = await tavolo(prisma, 3);
    const cena = await formulaCena(prisma);
    const aperta = await apriTavolo(server, mario, t.id, cena.id);

    const res = await request(server).post(`/api/sedute/${aperta.seduta.id}/pin`).set(bearer(mario)).expect(200);
    const nuovoPin = res.body.pin as string;
    expect(nuovoPin).toMatch(/^\d{4}$/);

    if (nuovoPin !== aperta.pin) {
      await request(server).post('/api/t/tavolo-03/join').send({ pin: aperta.pin }).expect(401);
    }
    await request(server).post('/api/t/tavolo-03/join').send({ pin: nuovoPin }).expect(200);
    expect(await prisma.evento.count({ where: { tipo: 'PIN_RIGENERATO', sedutaId: aperta.seduta.id } })).toBe(1);
  });

  it('regenerating the PIN lifts a table lock', async () => {
    const t = await tavolo(prisma, 4);
    const cena = await formulaCena(prisma);
    const aperta = await apriTavolo(server, mario, t.id, cena.id);
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/t/tavolo-04/join')
        .set('Cookie', `kk_did=dev${i}`)
        .send({ pin: pinSbagliato(aperta.pin) });
    }
    await request(server)
      .post('/api/t/tavolo-04/join')
      .set('Cookie', 'kk_did=nuovo')
      .send({ pin: aperta.pin })
      .expect(429);

    const nuovo = await request(server).post(`/api/sedute/${aperta.seduta.id}/pin`).set(bearer(mario)).expect(200);
    await request(server)
      .post('/api/t/tavolo-04/join')
      .set('Cookie', 'kk_did=nuovo')
      .send({ pin: nuovo.body.pin })
      .expect(200);
  });

  it('closing frees the table and revokes every customer device', async () => {
    const t = await tavolo(prisma, 6);
    const cena = await formulaCena(prisma);
    const aperta = await apriTavolo(server, mario, t.id, cena.id);
    const join = await request(server).post('/api/t/tavolo-06/join').send({ pin: aperta.pin }).expect(200);
    const cookieCliente = cookieDa(join, 'kk_ct')!;

    const prima = await request(server).get('/api/t/tavolo-06').set('Cookie', cookieCliente).expect(200);
    expect(prima.body.stato).toBe('CONNESSO');

    await request(server).post(`/api/sedute/${aperta.seduta.id}/chiudi`).set(bearer(capo)).expect(204);

    const dopo = await request(server).get('/api/t/tavolo-06').set('Cookie', cookieCliente).expect(200);
    expect(dopo.body).toEqual({ stato: 'NON_ATTIVO', tavolo: { numero: 6 } });
    const seduta = await prisma.seduta.findUniqueOrThrow({
      where: { id: aperta.seduta.id },
      include: { dispositivi: true },
    });
    expect(seduta).toMatchObject({ stato: 'CHIUSA', chiusaDaId: capo.utente.id });
    expect(seduta.dispositivi.every((d) => d.revocatoIl !== null)).toBe(true);
    expect((await elencoTavoli(server, mario)).find((x) => x.numero === 6)?.seduta).toBeNull();

    // The table can be opened again, and the old token does not work on the new session.
    const riaperta = await apriTavolo(server, mario, t.id, cena.id);
    const ancora = await request(server).get('/api/t/tavolo-06').set('Cookie', cookieCliente).expect(200);
    expect(ancora.body.stato).toBe('PIN_RICHIESTO');
    expect(riaperta.seduta.id).not.toBe(aperta.seduta.id);

    await request(server).post(`/api/sedute/${aperta.seduta.id}/chiudi`).set(bearer(capo)).expect(409);
    const chiusi = await prisma.evento.findMany({ where: { tipo: 'TAVOLO_CHIUSO' } });
    expect(chiusi).toHaveLength(1);
    expect(chiusi[0]!.payload).toEqual({ tavoli: [6] });
  });

  it('numbers events in commit order', async () => {
    const cena = await formulaCena(prisma);
    const tavoli = await prisma.tavolo.findMany({ orderBy: { numero: 'asc' }, take: 8 });
    await Promise.all(tavoli.map((t) => apriTavolo(server, mario, t.id, cena.id)));
    const eventi = await prisma.evento.findMany({ orderBy: { seq: 'asc' } });
    expect(eventi).toHaveLength(8);
    for (let i = 1; i < eventi.length; i++) {
      expect(eventi[i]!.seq).toBeGreaterThan(eventi[i - 1]!.seq);
      expect(eventi[i]!.ts.getTime()).toBeGreaterThanOrEqual(eventi[i - 1]!.ts.getTime());
    }
  });
});
