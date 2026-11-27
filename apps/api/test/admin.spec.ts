import type { INestApplication } from '@nestjs/common';
import type {
  CategoriaAdminDto,
  FormulaAdminDto,
  FormulaSnapshot,
  ImpostazioniAdminDto,
  MenuDto,
  PiattoAdminDto,
  PiattoAdminRichiesta,
  SessioneStaff,
  TavoloAdminDto,
  TavoloStato,
  UtenteAdminDto,
} from '@kikko/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const nuovoPiatto = (over: Partial<PiattoAdminRichiesta> = {}) => ({
  numero: '901',
  nome: { it: 'Gyoza al tartufo', en: 'Truffle gyoza' },
  descrizione: { it: 'Ravioli al vapore', en: 'Steamed dumplings' },
  categoria: 'antipasti',
  pezzi: 4,
  allergeni: ['GLUTEN'],
  vegetariano: false,
  piccante: false,
  senzaGlutine: false,
  inFormula: true,
  prezzoExtraCent: null,
  prezzoCartaCent: 650,
  maxPerPersona: 1,
  maxPerGiro: null,
  gruppo: null,
  disponibile: true,
  ordine: 99,
  ...over,
});

describe('administrator area', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let admin: SessioneStaff;
  let capo: SessioneStaff;

  const get = <T>(url: string) =>
    request(server)
      .get(`/api/admin/${url}`)
      .set(bearer(admin))
      .expect(200)
      .then((r) => r.body as T);
  const eventi = (ambito: string) =>
    prisma.evento
      .findMany({ where: { tipo: 'CONFIG_MODIFICATA' } })
      .then((e) => e.filter((x) => (x.payload as { ambito: string }).ambito === ambito));

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    admin = await login(server, 'admin');
    capo = await login(server, 'capo');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('is for administrators only', async () => {
    for (const url of ['impostazioni', 'formule', 'categorie', 'piatti', 'tavoli', 'utenti']) {
      await request(server).get(`/api/admin/${url}`).set(bearer(capo)).expect(403);
      await request(server).get(`/api/admin/${url}`).expect(401);
    }
  });

  describe('settings', () => {
    it('reads and saves the settings, validating them', async () => {
      const prima = await get<ImpostazioniAdminDto>('impostazioni');
      expect(prima).toMatchObject({ valuta: 'EUR', sogliaGiroAttesaMin: 5, urlBaseQr: null });
      const res = await request(server)
        .put('/api/admin/impostazioni')
        .set(bearer(admin))
        .send({ ...prima, sogliaGiroAttesaMin: 8, urlBaseQr: 'https://ordina.example.it/' })
        .expect(200);
      expect(res.body).toMatchObject({ sogliaGiroAttesaMin: 8, urlBaseQr: 'https://ordina.example.it' });
      await request(server)
        .put('/api/admin/impostazioni')
        .set(bearer(admin))
        .send({ ...prima, fusoOrario: 'Marte/Olympus' })
        .expect(400);
      // The till uses the new threshold.
      const coda = await request(server).get('/api/cassa/giri').set(bearer(capo)).expect(200);
      expect(coda.body.sogliaAttesaMin).toBe(8);
      expect(await eventi('impostazioni')).toHaveLength(1);
    });
  });

  describe('formulas', () => {
    it('creates and edits formulas; open tables keep their copy', async () => {
      const mario = await login(server, 'mario');
      const cena = await formulaCena(prisma);
      const aperta = await apriTavolo(server, mario, (await tavolo(prisma, 3)).id, cena.id);

      const formule = await get<FormulaAdminDto[]>('formule');
      const dto = formule.find((f) => f.codice === 'cena')!;
      const modificata = await request(server)
        .put(`/api/admin/formule/${dto.id}`)
        .set(bearer(admin))
        .send({ ...dto, prezzoAdultoCent: 3490, piattiPerPersonaPerGiro: 4 })
        .expect(200);
      expect(modificata.body).toMatchObject({ prezzoAdultoCent: 3490, piattiPerPersonaPerGiro: 4 });

      const seduta = await prisma.seduta.findUniqueOrThrow({ where: { id: aperta.seduta.id } });
      const copia = seduta.formulaSnapshot as unknown as FormulaSnapshot;
      expect(copia.prezzoAdultoCent).toBe(cena.prezzoAdultoCent);
      expect(copia.piattiPerPersonaPerGiro).toBe(cena.piattiPerPersonaPerGiro);

      const nuova = { ...dto, codice: 'brunch', nome: { it: 'Brunch', en: 'Brunch' } };
      await request(server).post('/api/admin/formule').set(bearer(admin)).send(nuova).expect(201);
      const dup = await request(server).post('/api/admin/formule').set(bearer(admin)).send(nuova).expect(409);
      expect(dup.body).toMatchObject({ codice: 'DUPLICATO' });
      await request(server)
        .post('/api/admin/formule')
        .set(bearer(admin))
        .send({ ...nuova, codice: 'notte', fasce: [{ giorni: [1], da: '23:00', a: '22:00' }] })
        .expect(400);
      expect(await eventi('formule')).toHaveLength(2);
    });
  });

  describe('menu', () => {
    it('manages categories: a category with dishes cannot be deleted, drinks are always paid', async () => {
      await request(server)
        .post('/api/admin/categorie')
        .set(bearer(admin))
        .send({ codice: 'dolci', nome: { it: 'Dolci', en: 'Desserts' }, sezione: 'MENU', ordine: 50 })
        .expect(204);
      const categorie = await get<CategoriaAdminDto[]>('categorie');
      const dolci = categorie.find((c) => c.codice === 'dolci')!;
      expect(dolci.piatti).toBe(0);
      const antipasti = categorie.find((c) => c.codice === 'antipasti')!;
      const res = await request(server).delete(`/api/admin/categorie/${antipasti.id}`).set(bearer(admin)).expect(409);
      expect(res.body).toMatchObject({ codice: 'CATEGORIA_NON_VUOTA' });
      await request(server)
        .put(`/api/admin/categorie/${antipasti.id}`)
        .set(bearer(admin))
        .send({ codice: 'antipasti', nome: antipasti.nome, sezione: 'BEVANDE', ordine: 0 })
        .expect(400);
      await request(server).delete(`/api/admin/categorie/${dolci.id}`).set(bearer(admin)).expect(204);
    });

    it('creates a dish (code from its name) that appears in the customer menu, without the à la carte price', async () => {
      const res = await request(server).post('/api/admin/piatti').set(bearer(admin)).send(nuovoPiatto()).expect(201);
      const piatto = res.body as PiattoAdminDto;
      expect(piatto).toMatchObject({
        codice: 'gyoza-al-tartufo',
        prezzoCartaCent: 650,
        ordinato: false,
        immagine: null,
      });

      const menu = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
      const nelMenu = menu.piatti.find((p) => p.id === piatto.id)!;
      expect(nelMenu).toMatchObject({ numero: '901', nome: { en: 'Truffle gyoza' }, maxPerPersona: 1 });
      expect(JSON.stringify(nelMenu)).not.toContain('650');

      const dup = await request(server)
        .post('/api/admin/piatti')
        .set(bearer(admin))
        .send(nuovoPiatto({ nome: { it: 'Altro', en: 'Other' } }))
        .expect(409);
      expect(dup.body).toMatchObject({ codice: 'DUPLICATO' });
      await request(server)
        .post('/api/admin/piatti')
        .set(bearer(admin))
        .send(nuovoPiatto({ numero: '902', inFormula: false }))
        .expect(400);
      await request(server)
        .post('/api/admin/piatti')
        .set(bearer(admin))
        .send(nuovoPiatto({ numero: '903', categoria: 'non-esiste' }))
        .expect(400);
      const doppione = await request(server)
        .post('/api/admin/piatti')
        .set(bearer(admin))
        .send(nuovoPiatto({ numero: '904' }))
        .expect(201);
      expect(doppione.body.codice).toBe('gyoza-al-tartufo-2');
      expect((await eventi('menu')).length).toBeGreaterThanOrEqual(2);
    });

    it('deletes a dish never ordered, archives one already ordered, and can bring it back', async () => {
      const mai = (await request(server).post('/api/admin/piatti').set(bearer(admin)).send(nuovoPiatto()).expect(201))
        .body as PiattoAdminDto;
      expect((await request(server).delete(`/api/admin/piatti/${mai.id}`).set(bearer(admin)).expect(200)).body).toEqual(
        {
          esito: 'ELIMINATO',
        },
      );

      // Dish 46 is ordered by a table.
      const mario = await login(server, 'mario');
      const aperta = await apriTavolo(server, mario, (await tavolo(prisma, 5)).id, (await formulaCena(prisma)).id);
      const cookie = await clienteAlTavolo(server, 5, aperta.pin);
      const salmone = await prisma.piatto.findUniqueOrThrow({ where: { numero: '46' } });
      await request(server).put(`/api/cliente/carrello/${salmone.id}`).set('Cookie', cookie).send({ quantita: 2 });
      await request(server).post('/api/cliente/giri').set('Cookie', cookie).send({ chiaveIdempotenza: randomUUID() });

      const archiviato = await request(server).delete(`/api/admin/piatti/${salmone.id}`).set(bearer(admin)).expect(200);
      expect(archiviato.body).toEqual({ esito: 'ARCHIVIATO' });
      const menu = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
      expect(menu.piatti.some((p) => p.id === salmone.id)).toBe(false);
      const cassa = await request(server).get('/api/cassa/piatti').set(bearer(capo)).expect(200);
      expect((cassa.body as { id: string }[]).some((p) => p.id === salmone.id)).toBe(false);
      const admin1 = (await get<PiattoAdminDto[]>('piatti')).find((p) => p.id === salmone.id)!;
      expect(admin1).toMatchObject({ archiviato: true, ordinato: true });

      await request(server).post(`/api/admin/piatti/${salmone.id}/ripristina`).set(bearer(admin)).expect(200);
      const dopo = (await request(server).get('/api/menu').expect(200)).body as MenuDto;
      expect(dopo.piatti.some((p) => p.id === salmone.id)).toBe(true);
    });

    it('uploads a photo as two WebP sizes with a blurred preview, replacing the previous one', async () => {
      const piatto = (
        await request(server).post('/api/admin/piatti').set(bearer(admin)).send(nuovoPiatto()).expect(201)
      ).body as PiattoAdminDto;
      const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#c33' } })
        .png()
        .toBuffer();
      const res = await request(server)
        .post(`/api/admin/piatti/${piatto.id}/foto`)
        .set(bearer(admin))
        .attach('foto', png, 'foto.png')
        .expect(200);
      const conFoto = res.body as PiattoAdminDto;
      expect(conFoto.immagine).toMatchObject({ larghezza: 480, altezza: 360 });
      expect(conFoto.immagine!.anteprima).toMatch(/^data:image\/webp;base64,/);
      const file = (src: string) => join(process.env['MEDIA_DIR']!, 'piatti', src.replace('/media/piatti/', ''));
      expect(existsSync(file(conFoto.immagine!.src480))).toBe(true);
      await request(server).get(conFoto.immagine!.src240).expect(200);

      const seconda = (
        await request(server)
          .post(`/api/admin/piatti/${piatto.id}/foto`)
          .set(bearer(admin))
          .attach('foto', png, 'foto.png')
          .expect(200)
      ).body as PiattoAdminDto;
      expect(seconda.immagine!.src480).not.toBe(conFoto.immagine!.src480);
      expect(existsSync(file(conFoto.immagine!.src480))).toBe(false);

      await request(server)
        .post(`/api/admin/piatti/${piatto.id}/foto`)
        .set(bearer(admin))
        .attach('foto', Buffer.from('non è una foto'), 'foto.jpg')
        .expect(400);
      const senza = await request(server).delete(`/api/admin/piatti/${piatto.id}/foto`).set(bearer(admin)).expect(200);
      expect(senza.body.immagine).toBeNull();
      expect(existsSync(file(seconda.immagine!.src480))).toBe(false);
    });
  });

  describe('tables and QR codes', () => {
    it('adds and renumbers tables keeping the QR code; an open table cannot be switched off', async () => {
      await request(server).post('/api/admin/tavoli').set(bearer(admin)).send({ numero: 25, posti: 8 }).expect(204);
      let tavoli = await get<TavoloAdminDto[]>('tavoli');
      const nuovo = tavoli.find((t) => t.numero === 25)!;
      expect(nuovo).toMatchObject({ slugQr: 'tavolo-25', posti: 8, attivo: true, aperto: false });
      await request(server)
        .put(`/api/admin/tavoli/${nuovo.id}`)
        .set(bearer(admin))
        .send({ numero: 30, posti: 8, attivo: true })
        .expect(204);
      tavoli = await get<TavoloAdminDto[]>('tavoli');
      expect(tavoli.find((t) => t.id === nuovo.id)).toMatchObject({ numero: 30, slugQr: 'tavolo-25' });
      await request(server).post('/api/admin/tavoli').set(bearer(admin)).send({ numero: 30, posti: 2 }).expect(409);

      const mario = await login(server, 'mario');
      const t1 = await tavolo(prisma, 1);
      await apriTavolo(server, mario, t1.id, (await formulaCena(prisma)).id);
      const res = await request(server)
        .put(`/api/admin/tavoli/${t1.id}`)
        .set(bearer(admin))
        .send({ numero: 1, posti: 4, attivo: false })
        .expect(409);
      expect(res.body).toMatchObject({ codice: 'TAVOLO_APERTO' });

      // A switched-off table leaves the waiter list and its QR code stops working.
      await request(server)
        .put(`/api/admin/tavoli/${nuovo.id}`)
        .set(bearer(admin))
        .send({ numero: 30, posti: 8, attivo: false })
        .expect(204);
      const lista = (await request(server).get('/api/tavoli').set(bearer(mario)).expect(200)).body as TavoloStato[];
      expect(lista.some((t) => t.numero === 30)).toBe(false);
      await request(server).get('/api/t/tavolo-25').expect(404);
    });

    it('prints the QR cards of the active tables as a PDF', async () => {
      await request(server).get('/api/admin/tavoli/qr.pdf').set(bearer(admin)).expect(400);
      const res = await request(server)
        .get('/api/admin/tavoli/qr.pdf?origine=https://ordina.example.it&tavoli=1,2,3')
        .set(bearer(admin))
        .buffer(true)
        .parse((r, cb) => {
          const parti: Buffer[] = [];
          r.on('data', (c: Buffer) => parti.push(c));
          r.on('end', () => cb(null, Buffer.concat(parti)));
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const pdf = res.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(5_000);
      await request(server).get('/api/admin/tavoli/qr.pdf?origine=https://x.it').set(bearer(capo)).expect(403);
    });
  });

  describe('staff', () => {
    it('creates staff who can log in; deactivating logs them out everywhere', async () => {
      const res = await request(server)
        .post('/api/admin/utenti')
        .set(bearer(admin))
        .send({ username: 'Giulia', nome: 'Giulia', ruolo: 'CAMERIERE', password: 'segreta1', pin: '2468' })
        .expect(201);
      const giulia = res.body as UtenteAdminDto;
      expect(giulia).toMatchObject({ username: 'giulia', ruolo: 'CAMERIERE', attivo: true, haPin: true });
      expect(JSON.stringify(giulia)).not.toContain('segreta1');
      const accesso = await request(server).post('/api/auth/login').send({ username: 'giulia', password: 'segreta1' });
      expect(accesso.status).toBe(200);
      await request(server)
        .post('/api/admin/utenti')
        .set(bearer(admin))
        .send({ username: 'giulia', nome: 'Altra', ruolo: 'CAPO', password: 'segreta2' })
        .expect(409);

      await request(server)
        .put(`/api/admin/utenti/${giulia.id}`)
        .set(bearer(admin))
        .send({ nome: 'Giulia', ruolo: 'CAMERIERE', attivo: false, pin: null })
        .expect(200);
      await request(server).post('/api/auth/login').send({ username: 'giulia', password: 'segreta1' }).expect(401);
      const refresh = await prisma.refreshToken.findMany({ where: { utenteId: giulia.id } });
      expect(refresh.every((r) => r.revocatoIl !== null)).toBe(true);
      expect((await get<UtenteAdminDto[]>('utenti')).find((u) => u.id === giulia.id)).toMatchObject({
        attivo: false,
        haPin: false,
      });
    });

    it('never leaves the restaurant without an active administrator', async () => {
      const io = { nome: 'Amministratore', ruolo: 'CAMERIERE', attivo: true };
      const res = await request(server)
        .put(`/api/admin/utenti/${admin.utente.id}`)
        .set(bearer(admin))
        .send(io)
        .expect(409);
      expect(res.body).toMatchObject({ codice: 'NON_SU_SE_STESSI' });
    });
  });

  describe('restore the defaults', () => {
    it('restores formulas and rules without touching the menu or the open tables', async () => {
      const mario = await login(server, 'mario');
      const cena = await formulaCena(prisma);
      await prisma.formula.update({ where: { id: cena.id }, data: { prezzoAdultoCent: 1, durataMaxMinuti: 30 } });
      const aperta = await apriTavolo(server, mario, (await tavolo(prisma, 6)).id, cena.id);
      await prisma.piatto.update({ where: { numero: '46' }, data: { nomeIt: 'Nigiri modificato' } });

      const res = await request(server).post('/api/admin/ripristina/formule').set(bearer(admin)).expect(200);
      expect(res.body).toEqual({ formule: 3 });
      const dopo = await formulaCena(prisma);
      expect(dopo.prezzoAdultoCent).not.toBe(1);
      expect((await prisma.piatto.findUniqueOrThrow({ where: { numero: '46' } })).nomeIt).toBe('Nigiri modificato');
      const seduta = await prisma.seduta.findUniqueOrThrow({ where: { id: aperta.seduta.id } });
      expect((seduta.formulaSnapshot as unknown as FormulaSnapshot).durataMaxMinuti).toBe(30);
    });

    it('reloads the example menu: changes undone, new dishes removed (archived if already ordered)', async () => {
      await prisma.piatto.update({ where: { numero: '46' }, data: { nomeIt: 'Nigiri modificato' } });
      const mai = (await request(server).post('/api/admin/piatti').set(bearer(admin)).send(nuovoPiatto()).expect(201))
        .body as PiattoAdminDto;
      const ordinato = (
        await request(server)
          .post('/api/admin/piatti')
          .set(bearer(admin))
          .send(nuovoPiatto({ numero: '905', nome: { it: 'Speciale', en: 'Special' } }))
          .expect(201)
      ).body as PiattoAdminDto;
      const mario = await login(server, 'mario');
      const aperta = await apriTavolo(server, mario, (await tavolo(prisma, 7)).id, (await formulaCena(prisma)).id);
      const cookie = await clienteAlTavolo(server, 7, aperta.pin);
      await request(server).put(`/api/cliente/carrello/${ordinato.id}`).set('Cookie', cookie).send({ quantita: 1 });
      await request(server).post('/api/cliente/giri').set('Cookie', cookie).send({ chiaveIdempotenza: randomUUID() });

      const res = await request(server).post('/api/admin/ripristina/menu').set(bearer(admin)).expect(200);
      expect(res.body).toMatchObject({ categorie: expect.any(Number), piatti: 167, archiviati: 1 });
      expect((await prisma.piatto.findUniqueOrThrow({ where: { numero: '46' } })).nomeIt).toBe('Nigiri salmone');
      expect(await prisma.piatto.findUnique({ where: { id: mai.id } })).toBeNull();
      expect(await prisma.piatto.findUniqueOrThrow({ where: { id: ordinato.id } })).toMatchObject({ archiviato: true });
      const ripristini = (await eventi('menu')).filter(
        (e) => (e.payload as { azione: string }).azione === 'RIPRISTINATO',
      );
      expect(ripristini).toHaveLength(1);
    });
  });
});
