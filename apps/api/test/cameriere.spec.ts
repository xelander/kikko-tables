import type { INestApplication } from '@nestjs/common';
import type {
  ErroreGiroDto,
  GiroDto,
  MenuDto,
  SedutaClienteDto,
  SedutaDettaglioDto,
  SedutaRiepilogo,
  SessioneStaff,
  StatoTavoloCliente,
  TavoloStato,
} from '@kikko/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  type Server,
  apriTavolo,
  avviaApp,
  bearer,
  clienteAlTavolo,
  elencoTavoli,
  formulaCena,
  login,
  preparaDatabase,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

describe('waiter app: ordering for the table, covers, moving and joining tables', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let mario: SessioneStaff;
  let menu: MenuDto;

  const id = (numero: string) => menu.piatti.find((p) => p.numero === numero)!.id;
  const apri = async (numero: number, adulti = 2, formula?: string) => {
    const f = formula
      ? await prisma.formula.findUniqueOrThrow({ where: { codice: formula } })
      : await formulaCena(prisma);
    return apriTavolo(server, mario, (await tavolo(prisma, numero)).id, f.id, {
      copertiAdulti: adulti,
      copertiBambini: 0,
    });
  };
  const staff = (s: SessioneStaff = mario) => bearer(s);

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    mario = await login(server, 'mario');
    menu = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('table list', () => {
    it('shows covers, joined tables, phones, cart and rounds waiting for approval', async () => {
      const aperta = await apri(3);
      const anna = await clienteAlTavolo(server, 3, aperta.pin);
      await request(server)
        .put(`/api/cliente/carrello/${id('46')}`)
        .set('Cookie', anna)
        .send({ quantita: 2 })
        .expect(200);
      await request(server)
        .post('/api/cliente/giri')
        .set('Cookie', anna)
        .send({ chiaveIdempotenza: randomUUID() })
        .expect(201);
      await request(server)
        .put(`/api/cliente/carrello/${id('47')}`)
        .set('Cookie', anna)
        .send({ quantita: 3 })
        .expect(200);

      const t = (await elencoTavoli(server, mario)).find((x) => x.numero === 3)!;
      expect(t.seduta).toMatchObject({
        tavoli: [3],
        dispositiviCollegati: 1,
        giriInAttesa: 1,
        pezziNelCarrello: 3,
      });
      expect(t.seduta?.ultimoGiroIl).not.toBeNull();
    });
  });

  describe('ordering for the table', () => {
    it('adds to the shared cart as the waiter and sends the round with the same rules', async () => {
      const aperta = await apri(5, 1);
      const anna = await clienteAlTavolo(server, 5, aperta.pin);
      const base = `/api/sedute/${aperta.seduta.id}`;

      const sala = (await request(server).get(`${base}/sala`).set(staff()).expect(200)).body as SedutaClienteDto;
      expect(sala.io).toMatchObject({ soprannome: 'Mario', emoji: '🧑‍🍳' });

      await request(server)
        .put(`${base}/carrello/${id('46')}`)
        .set(staff())
        .send({ quantita: 2 })
        .expect(200);
      // the customer sees the waiter's line in the shared cart
      const vistaCliente = (await request(server).get('/api/cliente/seduta').set('Cookie', anna))
        .body as SedutaClienteDto;
      expect(vistaCliente.carrello).toEqual([{ piattoId: id('46'), dispositivoId: sala.io.id, quantita: 2 }]);
      expect(vistaCliente.dispositivi.map((d) => d.emoji)).toContain('🧑‍🍳');

      // same limits: 1 cover → at most 1 bao
      await request(server)
        .put(`${base}/carrello/${id('113')}`)
        .set(staff())
        .send({ quantita: 2 })
        .expect(200);
      const rifiuto = await request(server).post(`${base}/giri`).set(staff()).send({ chiaveIdempotenza: randomUUID() });
      expect(rifiuto.status).toBe(422);
      expect((rifiuto.body as ErroreGiroDto).errori.map((e) => e.codice)).toContain('MAX_PER_PERSONA');

      await request(server)
        .put(`${base}/carrello/${id('113')}`)
        .set(staff())
        .send({ quantita: 1 })
        .expect(200);
      const giro = (
        await request(server).post(`${base}/giri`).set(staff()).send({ chiaveIdempotenza: randomUUID() }).expect(201)
      ).body as GiroDto;
      expect(giro.numero).toBe(1);

      const evento = await prisma.evento.findFirstOrThrow({ where: { tipo: 'GIRO_INVIATO' } });
      expect(evento).toMatchObject({ attoreRuolo: 'CAMERIERE', attoreId: mario.utente.id });
      // the staff device is not a customer phone
      const t = (await elencoTavoli(server, mario)).find((x) => x.numero === 5)!;
      expect(t.seduta?.dispositiviCollegati).toBe(1);
    });

    it('does not count the waiter as a guest when the next phone joins', async () => {
      const aperta = await apri(4);
      await request(server).get(`/api/sedute/${aperta.seduta.id}/sala`).set(staff()).expect(200);
      const res = await request(server).post('/api/t/tavolo-04/join').send({ pin: aperta.pin }).expect(200);
      expect(res.body).toMatchObject({ soprannome: 'Ospite 1', emoji: '🐼' });
    });

    it('is for waiters only, on open tables only', async () => {
      const aperta = await apri(6);
      const monitor = await login(server, 'monitor');
      await request(server).get(`/api/sedute/${aperta.seduta.id}/sala`).set(bearer(monitor)).expect(403);
      await request(server).get(`/api/sedute/${aperta.seduta.id}/sala`).expect(401);
      const capo = await login(server, 'capo');
      await request(server).post(`/api/sedute/${aperta.seduta.id}/chiudi`).set(bearer(capo)).expect(204);
      await request(server).get(`/api/sedute/${aperta.seduta.id}/sala`).set(staff()).expect(409);
    });
  });

  describe('session detail and covers', () => {
    it('shows everything the waiter needs', async () => {
      const aperta = await apri(7, 3);
      await clienteAlTavolo(server, 7, aperta.pin);
      const d = (await request(server).get(`/api/sedute/${aperta.seduta.id}`).set(staff()).expect(200))
        .body as SedutaDettaglioDto;
      expect(d).toMatchObject({
        tavoli: [{ numero: 7, slugQr: 'tavolo-07' }],
        copertiAdulti: 3,
        apertaDa: 'Mario',
        formula: { codice: 'cena', piattiPerPersonaPerGiro: 6 },
      });
      expect(d.dispositivi).toEqual([expect.objectContaining({ staff: false, emoji: '🐼' })]);
    });

    it('always shows the PIN to staff, never to customers, and never stores it in clear', async () => {
      const aperta = await apri(2);
      const anna = await clienteAlTavolo(server, 2, aperta.pin);
      const riga = (await elencoTavoli(server, mario)).find((t) => t.numero === 2)!;
      expect(riga.seduta?.pin).toBe(aperta.pin);
      const d = (await request(server).get(`/api/sedute/${aperta.seduta.id}`).set(staff()).expect(200))
        .body as SedutaDettaglioDto;
      expect(d.pin).toBe(aperta.pin);

      const riga2 = await prisma.seduta.findUniqueOrThrow({ where: { id: aperta.seduta.id } });
      expect(riga2.pinCifrato).not.toContain(aperta.pin);
      expect(riga2.pinHash).not.toContain(aperta.pin);

      const vistaCliente = await request(server).get('/api/cliente/seduta').set('Cookie', anna);
      expect(JSON.stringify(vistaCliente.body)).not.toMatch(/"pin/);
      const statoCliente = await request(server).get('/api/t/tavolo-02').set('Cookie', anna);
      expect(JSON.stringify(statoCliente.body)).not.toMatch(/"pin/);
      // optional new PIN: shown right away, the old one stops working, the phone stays in
      const nuovo = (await request(server).post(`/api/sedute/${aperta.seduta.id}/pin`).set(staff()).expect(200)).body;
      const dopo = (await request(server).get(`/api/sedute/${aperta.seduta.id}`).set(staff()))
        .body as SedutaDettaglioDto;
      expect(dopo.pin).toBe(nuovo.pin);
      const ancora = (await request(server).get('/api/t/tavolo-02').set('Cookie', anna)).body as StatoTavoloCliente;
      expect(ancora.stato).toBe('CONNESSO');
    });

    it('changes the covers: the round limit follows, the formula copy does not change', async () => {
      const aperta = await apri(8, 1);
      const anna = await clienteAlTavolo(server, 8, aperta.pin);
      await request(server)
        .put(`/api/cliente/carrello/${id('46')}`)
        .set('Cookie', anna)
        .send({ quantita: 10 })
        .expect(200);
      await request(server)
        .post('/api/cliente/giri')
        .set('Cookie', anna)
        .send({ chiaveIdempotenza: randomUUID() })
        .expect(422);

      const r = (
        await request(server)
          .patch(`/api/sedute/${aperta.seduta.id}/coperti`)
          .set(staff())
          .send({ copertiAdulti: 1, copertiBambini: 1 })
          .expect(200)
      ).body as SedutaRiepilogo;
      expect(r).toMatchObject({ copertiAdulti: 1, copertiBambini: 1 });
      await request(server)
        .post('/api/cliente/giri')
        .set('Cookie', anna)
        .send({ chiaveIdempotenza: randomUUID() })
        .expect(201);
      expect(await prisma.evento.count({ where: { tipo: 'COPERTI_MODIFICATI' } })).toBe(1);

      await request(server)
        .patch(`/api/sedute/${aperta.seduta.id}/coperti`)
        .set(staff())
        .send({ copertiAdulti: 0, copertiBambini: 0 })
        .expect(400);
    });
  });

  describe('moving a table', () => {
    it('moves the session to a free table; phones stay in, also through the old QR code', async () => {
      const aperta = await apri(9);
      const anna = await clienteAlTavolo(server, 9, aperta.pin);
      const da = await tavolo(prisma, 9);
      const a = await tavolo(prisma, 10);

      const r = (
        await request(server)
          .post(`/api/sedute/${aperta.seduta.id}/sposta`)
          .set(staff())
          .send({ daTavoloId: da.id, aTavoloId: a.id })
          .expect(200)
      ).body as SedutaRiepilogo;
      expect(r.tavoli).toEqual([10]);

      const tavoli = await elencoTavoli(server, mario);
      expect(tavoli.find((t) => t.numero === 9)?.seduta).toBeNull();
      expect(tavoli.find((t) => t.numero === 10)?.seduta?.id).toBe(aperta.seduta.id);

      for (const slug of ['tavolo-09', 'tavolo-10']) {
        const stato = (await request(server).get(`/api/t/${slug}`).set('Cookie', anna)).body as StatoTavoloCliente;
        expect(stato).toMatchObject({ stato: 'CONNESSO', tavolo: { numero: 10 } });
      }
      // the same PIN works at the new table
      await request(server).post('/api/t/tavolo-10/join').send({ pin: aperta.pin }).expect(200);
      const evento = await prisma.evento.findFirstOrThrow({ where: { tipo: 'TAVOLO_SPOSTATO' } });
      expect(evento.payload).toMatchObject({ daNumero: 9, tavoloNumero: 10 });
    });

    it('refuses an occupied target, also with concurrent moves', async () => {
      const a = await apri(11);
      const b = await apri(12);
      const t11 = await tavolo(prisma, 11);
      const t12 = await tavolo(prisma, 12);
      const t13 = await tavolo(prisma, 13);
      const occupato = await request(server)
        .post(`/api/sedute/${a.seduta.id}/sposta`)
        .set(staff())
        .send({ daTavoloId: t11.id, aTavoloId: t12.id })
        .expect(409);
      expect(occupato.body.codice).toBe('TAVOLO_OCCUPATO');

      const [x, y] = await Promise.all([
        request(server)
          .post(`/api/sedute/${a.seduta.id}/sposta`)
          .set(staff())
          .send({ daTavoloId: t11.id, aTavoloId: t13.id }),
        request(server)
          .post(`/api/sedute/${b.seduta.id}/sposta`)
          .set(staff())
          .send({ daTavoloId: t12.id, aTavoloId: t13.id }),
      ]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      const occupanti = await prisma.tavolo.count({ where: { numero: 13, sedutaCorrenteId: { not: null } } });
      expect(occupanti).toBe(1);
    });
  });

  describe('joining tables', () => {
    it('adds a free table: both QR codes lead to the same session', async () => {
      const aperta = await apri(14);
      const r = (
        await request(server)
          .post(`/api/sedute/${aperta.seduta.id}/tavoli`)
          .set(staff())
          .send({ tavoloId: (await tavolo(prisma, 15)).id })
          .expect(200)
      ).body as SedutaRiepilogo;
      expect(r.tavoli).toEqual([14, 15]);
      await request(server).post('/api/t/tavolo-15/join').send({ pin: aperta.pin }).expect(200);
      const tavoli = (await elencoTavoli(server, mario)) as TavoloStato[];
      expect(tavoli.find((t) => t.numero === 15)?.seduta?.id).toBe(aperta.seduta.id);
    });

    it('merges two open tables with the same formula: phones, cart and rounds move, covers add up', async () => {
      const a = await apri(16, 2);
      const b = await apri(17, 3);
      const anna = await clienteAlTavolo(server, 16, a.pin);
      const luca = await clienteAlTavolo(server, 17, b.pin);
      // table 17 already had a round with 3 bao (max 1 per person × 3)
      await request(server)
        .put(`/api/cliente/carrello/${id('113')}`)
        .set('Cookie', luca)
        .send({ quantita: 3 })
        .expect(200);
      await request(server)
        .post('/api/cliente/giri')
        .set('Cookie', luca)
        .send({ chiaveIdempotenza: randomUUID() })
        .expect(201);
      await request(server)
        .put(`/api/cliente/carrello/${id('46')}`)
        .set('Cookie', luca)
        .send({ quantita: 1 })
        .expect(200);
      await prisma.seduta.update({
        where: { id: b.seduta.id },
        data: { apertaIl: new Date(Date.now() - 30 * 60_000) },
      });

      const r = (
        await request(server)
          .post(`/api/sedute/${a.seduta.id}/unisci`)
          .set(staff())
          .send({ sedutaId: b.seduta.id })
          .expect(200)
      ).body as SedutaRiepilogo;
      expect(r).toMatchObject({
        tavoli: [16, 17],
        copertiAdulti: 5,
        dispositiviCollegati: 2,
        giriInAttesa: 1,
        pezziNelCarrello: 1,
      });
      // the oldest opening counts for the time
      expect(Date.parse(r.apertaIl)).toBeLessThan(Date.now() - 29 * 60_000);

      // Luca's phone now belongs to the merged session, through either QR code
      const statoLuca = (await request(server).get('/api/t/tavolo-17').set('Cookie', luca)).body as StatoTavoloCliente;
      expect(statoLuca).toMatchObject({ stato: 'CONNESSO', sedutaId: a.seduta.id });
      const sala = (await request(server).get('/api/cliente/seduta').set('Cookie', anna)).body as SedutaClienteDto;
      expect(sala.giri.map((g) => g.numero)).toEqual([1]);
      expect(sala.carrello).toHaveLength(1);

      // previous rounds still count: 5 covers → 5 bao in total, 3 already ordered
      await request(server)
        .put(`/api/cliente/carrello/${id('113')}`)
        .set('Cookie', anna)
        .send({ quantita: 3 })
        .expect(200);
      const troppi = await request(server)
        .post('/api/cliente/giri')
        .set('Cookie', anna)
        .send({ chiaveIdempotenza: randomUUID() });
      expect(troppi.status).toBe(422);

      const assorbita = await prisma.seduta.findUniqueOrThrow({ where: { id: b.seduta.id } });
      expect(assorbita).toMatchObject({ stato: 'CHIUSA', unitaInId: a.seduta.id });
      // the PIN of the absorbed table no longer works, the main one does
      await request(server).post('/api/t/tavolo-17/join').send({ pin: a.pin }).expect(200);
    });

    it('refuses to merge tables with different formulas', async () => {
      const a = await apri(18, 2, 'cena');
      const b = await apri(19, 2, 'weekend');
      const res = await request(server)
        .post(`/api/sedute/${a.seduta.id}/unisci`)
        .set(staff())
        .send({ sedutaId: b.seduta.id });
      expect(res.status).toBe(409);
      expect(res.body.codice).toBe('FORMULE_DIVERSE');
    });
  });
});
