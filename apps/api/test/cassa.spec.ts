import type { INestApplication } from '@nestjs/common';
import type {
  CodaCassaDto,
  ErroreGiroDto,
  GiroDto,
  MenuDto,
  PiattoCassaDto,
  PrecontoDto,
  SedutaClienteDto,
  SessioneStaff,
  TempoSedutaDto,
} from '@kikko/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CassaService } from '../src/cassa/cassa.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  type Server,
  apriTavolo,
  avviaApp,
  bearer,
  clienteAlTavolo,
  formulaCena,
  login,
  preparaDatabase,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

describe('till (manager): rounds, sold out, time, pre-bill', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let mario: SessioneStaff;
  let capo: SessioneStaff;
  let menu: MenuDto;
  let sedutaId: string;
  let anna: string;

  const id = (numero: string) => menu.piatti.find((p) => p.numero === numero)!.id;
  const bevanda = () => menu.piatti.find((p) => !p.inFormula && p.prezzoExtraCent)!;
  const metti = (cookie: string, piattoId: string, quantita: number) =>
    request(server).put(`/api/cliente/carrello/${piattoId}`).set('Cookie', cookie).send({ quantita });
  const invia = (cookie: string) =>
    request(server).post('/api/cliente/giri').set('Cookie', cookie).send({ chiaveIdempotenza: randomUUID() });
  const statoCliente = async (cookie: string) =>
    (await request(server).get('/api/cliente/seduta').set('Cookie', cookie).expect(200)).body as SedutaClienteDto;
  const coda = async () =>
    (await request(server).get('/api/cassa/giri').set(bearer(capo)).expect(200)).body as CodaCassaDto;
  const eventi = (
    tipo:
      | 'GIRO_APPROVATO'
      | 'GIRO_RIFIUTATO'
      | 'PIATTO_ESAURITO'
      | 'PIATTO_RIPRISTINATO'
      | 'TEMPO_SCADUTO'
      | 'TEMPO_ESTESO'
      | 'PRECONTO_GENERATO',
  ) => prisma.evento.findMany({ where: { tipo }, orderBy: { seq: 'asc' } });

  /** Customer at table 4 sends a round of `pezzi` nigiri (+ optional extras); returns it. */
  async function giro(pezzi: number, extra: { piattoId: string; quantita: number }[] = []): Promise<GiroDto> {
    if (pezzi > 0) await metti(anna, id('46'), pezzi).expect(200);
    for (const e of extra) await metti(anna, e.piattoId, e.quantita).expect(200);
    return (await invia(anna).expect(201)).body as GiroDto;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    mario = await login(server, 'mario');
    capo = await login(server, 'capo');
    menu = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
    // Table 4: dinner, 2 adults + 1 child.
    const aperta = await apriTavolo(server, mario, (await tavolo(prisma, 4)).id, (await formulaCena(prisma)).id, {
      copertiAdulti: 2,
      copertiBambini: 1,
    });
    sedutaId = aperta.seduta.id;
    anna = await clienteAlTavolo(server, 4, aperta.pin);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('rounds queue', () => {
    it('lists the rounds waiting, oldest first, with table, dishes and who sent them', async () => {
      const g = await giro(3, [{ piattoId: bevanda().id, quantita: 2 }]);
      const c = await coda();
      expect(c.inAttesa).toHaveLength(1);
      expect(c.inAttesa[0]).toMatchObject({
        id: g.id,
        sedutaId,
        numero: 1,
        stato: 'INVIATO',
        tavoli: [4],
        formula: 'Cena',
        coperti: 3,
        inviatoDa: { soprannome: 'Ospite 1', emoji: expect.any(String) },
      });
      expect(c.inAttesa[0]!.voci).toEqual(
        expect.arrayContaining([
          { piattoId: id('46'), quantita: 3, inFormula: true },
          { piattoId: bevanda().id, quantita: 2, inFormula: false },
        ]),
      );
      expect(c.recenti).toEqual([]);
    });

    it('is for the manager only', async () => {
      await request(server).get('/api/cassa/giri').set(bearer(mario)).expect(403);
      await request(server).get('/api/cassa/giri').set('Cookie', anna).expect(401);
      const g = await giro(2);
      await request(server).post(`/api/giri/${g.id}/approva`).set(bearer(mario)).expect(403);
    });

    it('approves a round: the table sees it, the event is recorded, it moves to the recent list', async () => {
      const g = await giro(2);
      const res = await request(server).post(`/api/giri/${g.id}/approva`).set(bearer(capo)).expect(200);
      expect(res.body).toMatchObject({ id: g.id, stato: 'APPROVATO', gestitoDa: 'Capo sala' });

      expect((await statoCliente(anna)).giri[0]).toMatchObject({ id: g.id, stato: 'APPROVATO' });
      const [evento] = await eventi('GIRO_APPROVATO');
      expect(evento).toMatchObject({
        sedutaId,
        attoreRuolo: 'CAPO',
        payload: { giroId: g.id, numero: 1, tavoli: [4] },
      });
      const c = await coda();
      expect(c.inAttesa).toEqual([]);
      expect(c.recenti.map((r) => [r.id, r.stato, r.gestitoDa])).toEqual([[g.id, 'APPROVATO', 'Capo sala']]);
    });

    it('rejects a round with a reason shown to the table', async () => {
      const g = await giro(2);
      await request(server).post(`/api/giri/${g.id}/rifiuta`).set(bearer(capo)).send({ motivo: ' ' }).expect(400);
      const res = await request(server)
        .post(`/api/giri/${g.id}/rifiuta`)
        .set(bearer(capo))
        .send({ motivo: 'Il salmone è finito' })
        .expect(200);
      expect(res.body).toMatchObject({ stato: 'RIFIUTATO', motivoRifiuto: 'Il salmone è finito' });
      expect((await statoCliente(anna)).giri[0]).toMatchObject({
        stato: 'RIFIUTATO',
        motivoRifiuto: 'Il salmone è finito',
      });
      const [evento] = await eventi('GIRO_RIFIUTATO');
      expect(evento!.payload).toMatchObject({ giroId: g.id, motivo: 'Il salmone è finito' });
    });

    it('a rejected round uses neither the limits nor the wait between rounds', async () => {
      // Bao: at most once per person → 3 in the whole session (3 covers).
      await metti(anna, id('113'), 3).expect(200);
      const g = (await invia(anna).expect(201)).body as GiroDto;
      await request(server).post(`/api/giri/${g.id}/rifiuta`).set(bearer(capo)).send({ motivo: 'No' }).expect(200);
      // Right away (no 10 minutes wait) and with the same 3 bao.
      await metti(anna, id('113'), 3).expect(200);
      const secondo = (await invia(anna).expect(201)).body as GiroDto;
      await request(server).post(`/api/giri/${secondo.id}/approva`).set(bearer(capo)).expect(200);
      // An approved round does count.
      await prisma.giro.updateMany({ data: { inviatoIl: new Date(Date.now() - 11 * 60_000) } });
      await metti(anna, id('113'), 1).expect(200);
      const res = await invia(anna).expect(422);
      expect((res.body as ErroreGiroDto).errori.map((e) => e.codice)).toEqual(['MAX_PER_PERSONA']);
    });

    it('handles each round once: a second tablet gets "already handled"', async () => {
      const g = await giro(2);
      await request(server).post(`/api/giri/${g.id}/approva`).set(bearer(capo)).expect(200);
      const res = await request(server).post(`/api/giri/${g.id}/rifiuta`).set(bearer(capo)).send({ motivo: 'x' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ codice: 'GIRO_GIA_GESTITO', stato: 'APPROVATO' });
    });

    it('two tablets acting at the same time: exactly one wins', async () => {
      const g = await giro(2);
      const risposte = await Promise.all([
        request(server).post(`/api/giri/${g.id}/approva`).set(bearer(capo)),
        request(server).post(`/api/giri/${g.id}/rifiuta`).set(bearer(capo)).send({ motivo: 'x' }),
        request(server).post(`/api/giri/${g.id}/approva`).set(bearer(capo)),
      ]);
      expect(risposte.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const totale = (await eventi('GIRO_APPROVATO')).length + (await eventi('GIRO_RIFIUTATO')).length;
      expect(totale).toBe(1);
    });

    it('leaves out the rounds of closed tables', async () => {
      const g = await giro(2);
      await request(server).post(`/api/sedute/${sedutaId}/chiudi`).set(bearer(capo)).expect(204);
      expect((await coda()).inAttesa).toEqual([]);
      const res = await request(server).post(`/api/giri/${g.id}/approva`).set(bearer(capo)).expect(409);
      expect(res.body).toMatchObject({ codice: 'SEDUTA_CHIUSA' });
      await request(server).post(`/api/giri/${randomUUID()}/approva`).set(bearer(capo)).expect(404);
    });
  });

  describe('sold-out dishes', () => {
    it('lists every dish for the manager', async () => {
      const piatti = (await request(server).get('/api/cassa/piatti').set(bearer(capo)).expect(200))
        .body as PiattoCassaDto[];
      expect(piatti).toHaveLength(menu.piatti.length);
      expect(piatti.find((p) => p.id === id('113'))).toMatchObject({
        nome: 'Bao bun',
        disponibile: true,
        inFormula: true,
      });
      await request(server).get('/api/cassa/piatti').set(bearer(mario)).expect(403);
    });

    it('marks a dish sold out and back, for every open menu, recording each change once', async () => {
      const piatto = id('46');
      const esaurito = await request(server)
        .patch(`/api/piatti/${piatto}/disponibilita`)
        .set(bearer(capo))
        .send({ disponibile: false })
        .expect(200);
      expect(esaurito.body).toMatchObject({ id: piatto, disponibile: false });
      // Same request again (double tap): no second event.
      await request(server)
        .patch(`/api/piatti/${piatto}/disponibilita`)
        .set(bearer(capo))
        .send({ disponibile: false })
        .expect(200);
      expect(await eventi('PIATTO_ESAURITO')).toHaveLength(1);
      expect((await eventi('PIATTO_ESAURITO'))[0]).toMatchObject({ sedutaId: null, payload: { piattoId: piatto } });

      const menuDopo = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
      expect(menuDopo.piatti.find((p) => p.id === piatto)!.disponibile).toBe(false);
      await metti(anna, piatto, 2).expect(200);
      const rifiutato = await invia(anna).expect(422);
      expect((rifiutato.body as ErroreGiroDto).errori.map((e) => e.codice)).toEqual(['PIATTO_NON_DISPONIBILE']);

      await request(server)
        .patch(`/api/piatti/${piatto}/disponibilita`)
        .set(bearer(capo))
        .send({ disponibile: true })
        .expect(200);
      expect(await eventi('PIATTO_RIPRISTINATO')).toHaveLength(1);
      await invia(anna).expect(201);
    });

    it('validates the request', async () => {
      await request(server)
        .patch(`/api/piatti/${id('46')}/disponibilita`)
        .set(bearer(capo))
        .send({})
        .expect(400);
      await request(server)
        .patch(`/api/piatti/${randomUUID()}/disponibilita`)
        .set(bearer(capo))
        .send({ disponibile: false })
        .expect(404);
      await request(server)
        .patch(`/api/piatti/${id('46')}/disponibilita`)
        .set(bearer(mario))
        .send({ disponibile: false })
        .expect(403);
    });
  });

  describe('time', () => {
    const scaduta = () =>
      // Dinner lasts 150 minutes: opened 151 minutes ago.
      prisma.seduta.update({ where: { id: sedutaId }, data: { apertaIl: new Date(Date.now() - 151 * 60_000) } });

    it('records TEMPO_SCADUTO once when a table passes its maximum duration, without closing it', async () => {
      const cassa = app.get(CassaService);
      expect(await cassa.controllaScadenze()).toBe(0);
      await scaduta();
      expect(await cassa.controllaScadenze()).toBe(1);
      expect(await cassa.controllaScadenze()).toBe(0);
      const [evento] = await eventi('TEMPO_SCADUTO');
      expect(evento).toMatchObject({ sedutaId, attoreRuolo: 'SISTEMA', payload: { tavoli: [4] } });
      expect((await prisma.seduta.findUniqueOrThrow({ where: { id: sedutaId } })).stato).toBe('APERTA');
      await metti(anna, id('46'), 1).expect(200);
      const res = await invia(anna).expect(422);
      expect((res.body as ErroreGiroDto).errori.map((e) => e.codice)).toEqual(['TEMPO_SCADUTO']);
    });

    it('gives extra minutes to a table: it can order again and the alarm can fire again later', async () => {
      const cassa = app.get(CassaService);
      await scaduta();
      await cassa.controllaScadenze();
      const res = await request(server)
        .post(`/api/sedute/${sedutaId}/tempo`)
        .set(bearer(capo))
        .send({ minuti: 15 })
        .expect(200);
      const tempo = res.body as TempoSedutaDto;
      expect(tempo.minutiExtra).toBe(15);
      expect(Date.parse(tempo.scadeIl)).toBeGreaterThan(Date.now() + 13 * 60_000);
      expect((await eventi('TEMPO_ESTESO'))[0]).toMatchObject({ sedutaId, payload: { minuti: 15, tutti: false } });
      expect((await statoCliente(anna)).scadeIl).toBe(tempo.scadeIl);
      await giro(1);

      // The new deadline passes too.
      await prisma.seduta.update({ where: { id: sedutaId }, data: { apertaIl: new Date(Date.now() - 170 * 60_000) } });
      expect(await cassa.controllaScadenze()).toBe(1);
      expect(await eventi('TEMPO_SCADUTO')).toHaveLength(2);
    });

    it('extends every open table at once (after a blackout)', async () => {
      const altra = await apriTavolo(server, mario, (await tavolo(prisma, 9)).id, (await formulaCena(prisma)).id);
      const res = await request(server)
        .post('/api/cassa/estendi-tutti')
        .set(bearer(capo))
        .send({ minuti: 20 })
        .expect(200);
      expect(res.body).toEqual({ sedute: 2 });
      const sedute = await prisma.seduta.findMany({ where: { id: { in: [sedutaId, altra.seduta.id] } } });
      expect(sedute.map((s) => s.minutiExtra)).toEqual([20, 20]);
      const estesi = await eventi('TEMPO_ESTESO');
      expect(estesi).toHaveLength(2);
      expect(estesi.every((e) => (e.payload as { tutti: boolean }).tutti)).toBe(true);
    });

    it('validates the minutes and needs an open table', async () => {
      await request(server).post(`/api/sedute/${sedutaId}/tempo`).set(bearer(capo)).send({ minuti: 0 }).expect(400);
      await request(server).post(`/api/sedute/${sedutaId}/tempo`).set(bearer(mario)).send({ minuti: 10 }).expect(403);
      await request(server).post('/api/cassa/estendi-tutti').set(bearer(mario)).send({ minuti: 10 }).expect(403);
      await request(server).post(`/api/sedute/${sedutaId}/chiudi`).set(bearer(capo)).expect(204);
      await request(server).post(`/api/sedute/${sedutaId}/tempo`).set(bearer(capo)).send({ minuti: 10 }).expect(409);
    });
  });

  describe('pre-bill', () => {
    it('bills formula × covers plus the extras of approved rounds, and records it', async () => {
      const birra = bevanda();
      const prezzo = birra.prezzoExtraCent!;
      const approvato = await giro(3, [{ piattoId: birra.id, quantita: 2 }]);
      await request(server).post(`/api/giri/${approvato.id}/approva`).set(bearer(capo)).expect(200);
      await giro(0, [{ piattoId: birra.id, quantita: 5 }]); // drinks only, still waiting

      const res = await request(server).post(`/api/sedute/${sedutaId}/preconto`).set(bearer(capo)).expect(200);
      const p = res.body as PrecontoDto;
      const cena = await formulaCena(prisma);
      expect(p).toMatchObject({
        sedutaId,
        nomeLocale: expect.any(String),
        valuta: 'EUR',
        tavoli: [4],
        formula: 'Cena',
        copertiAdulti: 2,
        copertiBambini: 1,
        giriInAttesa: 1,
      });
      expect(p.righe.map((r) => [r.tipo, r.quantita, r.prezzoUnitarioCent])).toEqual([
        ['ADULTI', 2, cena.prezzoAdultoCent],
        ['BAMBINI', 1, cena.prezzoBambinoCent],
        ['EXTRA', 2, prezzo],
      ]);
      expect(p.righe[2]!.descrizione).toBe(birra.nome.it);
      expect(p.totaleCent).toBe(2 * cena.prezzoAdultoCent + cena.prezzoBambinoCent + 2 * prezzo);
      expect((await eventi('PRECONTO_GENERATO'))[0]).toMatchObject({ sedutaId, payload: { totaleCent: p.totaleCent } });
    });

    it('is for the manager only, and works for a closed table too (reprint)', async () => {
      await request(server).post(`/api/sedute/${sedutaId}/preconto`).set(bearer(mario)).expect(403);
      await request(server).post(`/api/sedute/${sedutaId}/chiudi`).set(bearer(capo)).expect(204);
      await request(server).post(`/api/sedute/${sedutaId}/preconto`).set(bearer(capo)).expect(200);
      await request(server).post(`/api/sedute/${randomUUID()}/preconto`).set(bearer(capo)).expect(404);
    });
  });
});
