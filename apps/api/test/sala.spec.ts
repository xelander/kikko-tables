import type { INestApplication } from '@nestjs/common';
import type { ErroreGiroDto, GiroDto, MenuDto, SedutaClienteDto, SessioneStaff, VoceCarrelloDto } from '@kikko/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  type Server,
  apriTavolo,
  avviaApp,
  clienteAlTavolo,
  formulaCena,
  login,
  preparaDatabase,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

describe('customer menu, shared cart and rounds', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let mario: SessioneStaff;
  let menu: MenuDto;
  let pin: string;
  let sedutaId: string;
  let anna: string;
  let luca: string;

  const id = (numero: string) => menu.piatti.find((p) => p.numero === numero)!.id;
  const bevanda = () => menu.piatti.find((p) => !p.inFormula)!.id;
  const metti = (cookie: string, piattoId: string, quantita: number) =>
    request(server).put(`/api/cliente/carrello/${piattoId}`).set('Cookie', cookie).send({ quantita });
  const invia = (cookie: string, chiave: string = randomUUID()) =>
    request(server).post('/api/cliente/giri').set('Cookie', cookie).send({ chiaveIdempotenza: chiave });
  const errori = (res: { body: unknown }) => (res.body as ErroreGiroDto).errori.map((e) => e.codice);

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    mario = await login(server, 'mario');
    menu = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
    // Table 4, 2 adults: dinner formula = 6 dishes per person per round → 12, 10 minutes between rounds
    const aperta = await apriTavolo(server, mario, (await tavolo(prisma, 4)).id, (await formulaCena(prisma)).id, {
      copertiAdulti: 2,
      copertiBambini: 0,
    });
    pin = aperta.pin;
    sedutaId = aperta.seduta.id;
    anna = await clienteAlTavolo(server, 4, pin);
    luca = await clienteAlTavolo(server, 4, pin);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('menu', () => {
    it('serves the whole menu with photos and drinks, without à la carte prices', async () => {
      expect(menu.piatti).toHaveLength(167);
      expect(menu.piatti.filter((p) => p.inFormula)).toHaveLength(155);
      expect(JSON.stringify(menu)).not.toContain('prezzoCarta');
      const bao = menu.piatti.find((p) => p.numero === '113')!;
      expect(bao).toMatchObject({
        nome: { it: 'Bao bun', en: 'Bao bun' },
        maxPerPersona: 1,
        pezzi: 1,
        prezzoExtraCent: null,
      });
      expect(bao.immagine?.src480).toMatch(/^\/media\/piatti\/foto-\d{3}-480\.webp$/);
      expect(bao.immagine?.anteprima).toMatch(/^data:image\/webp;base64,/);
      const sezioni = new Set(menu.categorie.map((c) => c.sezione));
      expect(sezioni).toEqual(new Set(['MENU', 'BEVANDE']));
      expect(menu.gruppi.map((g) => g.maxPerPersona)).toEqual([4, 4]);
    });

    it('answers 304 when the menu did not change', async () => {
      const prima = await request(server).get('/api/menu').expect(200);
      const etag = prima.headers['etag'] as string;
      await request(server).get('/api/menu').set('If-None-Match', etag).expect(304);
      await prisma.piatto.update({ where: { id: id('1') }, data: { disponibile: false } });
      const dopo = await request(server).get('/api/menu').set('If-None-Match', etag).expect(200);
      expect(dopo.headers['etag']).not.toBe(etag);
    });

    it('serves the dish photos', async () => {
      const src = menu.piatti.find((p) => p.immagine)!.immagine!.src240;
      const res = await request(server).get(src).expect(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.headers['cache-control']).toContain('max-age=86400');
      await request(server).get('/media/piatti/non-esiste.webp').expect(404);
    });
  });

  describe('shared cart', () => {
    it('needs a valid customer device', async () => {
      await request(server).get('/api/cliente/seduta').expect(401);
      await metti('kk_ct=falso', id('1'), 1).expect(401);
    });

    it('keeps one line per device, visible to the whole table, and records each change', async () => {
      await metti(anna, id('46'), 2).expect(200);
      const res = await metti(luca, id('46'), 3).expect(200);
      const carrello = res.body as VoceCarrelloDto[];
      expect(carrello).toHaveLength(2);
      expect(carrello.reduce((t, v) => t + v.quantita, 0)).toBe(5);

      const stato = (await request(server).get('/api/cliente/seduta').set('Cookie', anna).expect(200))
        .body as SedutaClienteDto;
      expect(stato.carrello).toHaveLength(2);
      expect(stato.dispositivi).toHaveLength(2);
      expect(stato.tavoli).toEqual([4]);
      expect(stato.formula).toMatchObject({ piattiPerPersonaPerGiro: 6, minutiTraGiri: 10 });
      expect(stato.copertiAdulti).toBe(2);

      await metti(anna, id('46'), 0).expect(200);
      await metti(anna, id('46'), 0).expect(200); // no change, no event
      const eventi = await prisma.evento.findMany({ where: { tipo: 'CARRELLO_MODIFICATO' }, orderBy: { seq: 'asc' } });
      expect(eventi.map((e) => (e.payload as { quantita: number }).quantita)).toEqual([2, 3, 0]);
    });

    it('validates the request', async () => {
      await metti(anna, id('46'), -1).expect(400);
      await metti(anna, id('46'), 100).expect(400);
      await metti(anna, '00000000-0000-4000-8000-000000000000', 1).expect(404);
    });
  });

  describe('sending a round', () => {
    it('sends the whole table cart as one round and empties the cart', async () => {
      await metti(anna, id('46'), 4).expect(200);
      await metti(luca, id('73'), 4).expect(200);
      await metti(luca, bevanda(), 2).expect(200);
      const res = await invia(luca).expect(201);
      const giro = res.body as GiroDto;
      expect(giro).toMatchObject({ numero: 1, stato: 'INVIATO', soloExtra: false });
      expect(giro.voci).toHaveLength(3);

      const stato = (await request(server).get('/api/cliente/seduta').set('Cookie', anna)).body as SedutaClienteDto;
      expect(stato.carrello).toEqual([]);
      expect(stato.giri).toHaveLength(1);

      const evento = await prisma.evento.findFirstOrThrow({ where: { tipo: 'GIRO_INVIATO' } });
      expect(evento).toMatchObject({ sedutaId, payload: { numero: 1, pezzi: 10 } });
      const voceBevanda = await prisma.voceGiro.findFirstOrThrow({ where: { inFormula: false } });
      expect(voceBevanda.prezzoExtraCent).toBeGreaterThan(0);
    });

    it('is idempotent: the same key returns the same round, even with concurrent retries', async () => {
      await metti(anna, id('46'), 2).expect(200);
      const chiave = randomUUID();
      const risposte = await Promise.all(Array.from({ length: 5 }, () => invia(anna, chiave)));
      expect(risposte.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
      expect(new Set(risposte.map((r) => (r.body as GiroDto).id)).size).toBe(1);
      expect(await prisma.giro.count()).toBe(1);
      expect(await prisma.evento.count({ where: { tipo: 'GIRO_INVIATO' } })).toBe(1);
    });

    it('lets only one of two phones send at the same time', async () => {
      await metti(anna, id('46'), 2).expect(200);
      const [a, b] = await Promise.all([invia(anna), invia(luca)]);
      expect([a.status, b.status].sort()).toEqual([201, 422]);
      expect(await prisma.giro.count()).toBe(1);
    });

    it('refuses an empty cart', async () => {
      const res = await invia(anna).expect(422);
      expect(errori(res)).toEqual(['CARRELLO_VUOTO']);
    });

    it('enforces the round limit (6 per person × 2) without counting drinks', async () => {
      await metti(anna, id('46'), 8).expect(200);
      await metti(luca, id('73'), 5).expect(200);
      expect(errori(await invia(anna).expect(422))).toEqual(['LIMITE_GIRO']);
      await metti(luca, id('73'), 4).expect(200);
      await metti(luca, bevanda(), 5).expect(200);
      await invia(anna).expect(201);
    });

    it('enforces "at most N times" per person: 2 covers → 2 bao in the whole session', async () => {
      await metti(anna, id('113'), 1).expect(200);
      await metti(luca, id('113'), 2).expect(200);
      const res = await invia(anna).expect(422);
      expect((res.body as ErroreGiroDto).errori).toEqual([
        { codice: 'MAX_PER_PERSONA', piattoId: id('113'), richiesti: 3, giaOrdinati: 0, limite: 2 },
      ]);
      await metti(luca, id('113'), 1).expect(200);
      await invia(anna).expect(201);
    });

    it('enforces the sashimi group limit (4 per person in total)', async () => {
      await metti(anna, id('66'), 5).expect(200);
      await metti(luca, id('67'), 4).expect(200);
      expect(errori(await invia(anna).expect(422))).toEqual(['LIMITE_GRUPPO']);
    });

    it('waits 10 minutes between rounds, but drinks can always be ordered', async () => {
      await metti(anna, id('46'), 2).expect(200);
      await invia(anna).expect(201);
      await metti(anna, id('47'), 2).expect(200);
      const res = await invia(anna).expect(422);
      expect(errori(res)).toEqual(['ATTESA_TRA_GIRI']);
      await metti(anna, id('47'), 0).expect(200);
      await metti(anna, bevanda(), 2).expect(200);
      const soloBevande = (await invia(anna).expect(201)).body as GiroDto;
      expect(soloBevande.soloExtra).toBe(true);

      // Ten minutes later (moving the previous rounds back in time).
      await prisma.giro.updateMany({ data: { inviatoIl: new Date(Date.now() - 11 * 60_000) } });
      await metti(anna, id('47'), 2).expect(200);
      await invia(anna).expect(201);
    });

    it('does not count rejected rounds', async () => {
      await metti(anna, id('113'), 2).expect(200);
      await invia(anna).expect(201);
      await prisma.giro.updateMany({ data: { stato: 'RIFIUTATO', motivoRifiuto: 'Prova' } });
      await metti(anna, id('113'), 2).expect(200);
      await invia(anna).expect(201);
    });

    it('refuses unavailable dishes and rounds after the maximum duration', async () => {
      await metti(anna, id('46'), 1).expect(200);
      await prisma.piatto.update({ where: { id: id('46') }, data: { disponibile: false } });
      expect(errori(await invia(anna).expect(422))).toEqual(['PIATTO_NON_DISPONIBILE']);
      await prisma.piatto.update({ where: { id: id('46') }, data: { disponibile: true } });
      await prisma.seduta.update({ where: { id: sedutaId }, data: { apertaIl: new Date(Date.now() - 151 * 60_000) } });
      expect(errori(await invia(anna).expect(422))).toEqual(['TEMPO_SCADUTO']);
      await prisma.seduta.update({ where: { id: sedutaId }, data: { minutiExtra: 30 } });
      await invia(anna).expect(201);
    });

    it('uses the formula copied on the session, not the current one', async () => {
      await prisma.formula.update({ where: { codice: 'cena' }, data: { piattiPerPersonaPerGiro: 1 } });
      await metti(anna, id('46'), 12).expect(200);
      await invia(anna).expect(201);
    });

    it('stops working once the table is closed', async () => {
      const capo = await login(server, 'capo');
      await request(server)
        .post(`/api/sedute/${sedutaId}/chiudi`)
        .set('Authorization', `Bearer ${capo.accessToken}`)
        .expect(204);
      await metti(anna, id('46'), 1).expect(401);
      await invia(anna).expect(401);
    });
  });
});
