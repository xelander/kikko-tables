import type { INestApplication } from '@nestjs/common';
import type { DispositivoCondivisoInfo, SessioneStaff } from '@kikko/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  type Server,
  avviaApp,
  bearer,
  cookieDa,
  login,
  preparaDatabase,
  setCookieCompleto,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

describe('staff authentication', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp();
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('personal login', () => {
    it('returns an access token and sets an httpOnly refresh cookie scoped to /api/auth', async () => {
      const res = await request(server)
        .post('/api/auth/login')
        .send({ username: 'mario', password: 'mario' })
        .expect(200);
      const sessione = res.body as SessioneStaff;
      expect(sessione.utente).toMatchObject({ username: 'mario', ruolo: 'CAMERIERE' });
      expect(sessione.dispositivo).toBeNull();
      expect(sessione.scadeTra).toBe(900);

      const cookie = setCookieCompleto(res, 'kk_rt')!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/auth/);

      const me = await request(server).get('/api/auth/me').set(bearer(sessione)).expect(200);
      expect(me.body).toMatchObject({ username: 'mario', ruolo: 'CAMERIERE', dispositivoStaffId: null });

      const riga = await prisma.refreshToken.findFirstOrThrow();
      const giorni = (riga.scadeIl.getTime() - Date.now()) / 86_400_000;
      expect(giorni).toBeGreaterThan(89);
      expect(riga.tokenHash).not.toContain(cookie.split(';')[0]!.split('=')[1]!);
    });

    it('rejects wrong credentials and locks the username after 5 failures', async () => {
      for (let i = 0; i < 5; i++) {
        await request(server).post('/api/auth/login').send({ username: 'mario', password: 'nope' }).expect(401);
      }
      const bloccato = await request(server).post('/api/auth/login').send({ username: 'mario', password: 'mario' });
      expect(bloccato.status).toBe(429);
      expect(bloccato.body).toMatchObject({ codice: 'BLOCCATO' });
      expect(bloccato.body.riprovaTraSecondi).toBeGreaterThan(50);
    });

    it('validates the request body', async () => {
      const res = await request(server).post('/api/auth/login').send({ username: '' }).expect(400);
      expect(res.body.codice).toBe('DATI_NON_VALIDI');
    });

    it('rejects missing, malformed and forged access tokens', async () => {
      await request(server).get('/api/auth/me').expect(401);
      await request(server).get('/api/auth/me').set('Authorization', 'Bearer abc').expect(401);
      const forged =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwicnVvbG8iOiJBRE1JTiIsImlzcyI6Imtpa2tvIn0.c2lnbmF0dXJlLWZhbHNh';
      await request(server).get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token on every use', async () => {
      const agent = request.agent(server);
      await agent.post('/api/auth/login').send({ username: 'mario', password: 'mario' }).expect(200);
      const primo = await agent.post('/api/auth/refresh').expect(200);
      const secondo = await agent.post('/api/auth/refresh').expect(200);
      expect(cookieDa(primo, 'kk_rt')).not.toBe(cookieDa(secondo, 'kk_rt'));
      await request(server)
        .get('/api/auth/me')
        .set(bearer(secondo.body as SessioneStaff))
        .expect(200);
      expect(await prisma.refreshToken.count()).toBe(3);
    });

    it('answers 409 (retry) when two tabs refresh at the same time', async () => {
      const login = await request(server).post('/api/auth/login').send({ username: 'mario', password: 'mario' });
      const vecchio = cookieDa(login, 'kk_rt')!;
      await request(server).post('/api/auth/refresh').set('Cookie', vecchio).expect(200);
      const res = await request(server).post('/api/auth/refresh').set('Cookie', vecchio).expect(409);
      expect(res.body.codice).toBe('RIPROVA');
    });

    it('revokes the whole family when an old token is reused later (theft)', async () => {
      const login = await request(server).post('/api/auth/login').send({ username: 'mario', password: 'mario' });
      const rubato = cookieDa(login, 'kk_rt')!;
      const rinnovo = await request(server).post('/api/auth/refresh').set('Cookie', rubato).expect(200);
      const nuovo = cookieDa(rinnovo, 'kk_rt')!;
      await prisma.refreshToken.updateMany({
        where: { usatoIl: { not: null } },
        data: { usatoIl: new Date(Date.now() - 60_000) },
      });

      const res = await request(server).post('/api/auth/refresh').set('Cookie', rubato).expect(401);
      expect(res.body.codice).toBe('SESSIONE_REVOCATA');
      await request(server).post('/api/auth/refresh').set('Cookie', nuovo).expect(401);
    });

    it('logout revokes the session and clears the cookie', async () => {
      const agent = request.agent(server);
      await agent.post('/api/auth/login').send({ username: 'mario', password: 'mario' }).expect(200);
      const out = await agent.post('/api/auth/logout').expect(204);
      expect(setCookieCompleto(out, 'kk_rt')).toMatch(/Expires=Thu, 01 Jan 1970/);
      await agent.post('/api/auth/refresh').expect(401);
    });

    it('refuses refresh for a deactivated user', async () => {
      const agent = request.agent(server);
      await agent.post('/api/auth/login').send({ username: 'mario', password: 'mario' }).expect(200);
      await prisma.utenteStaff.update({ where: { username: 'mario' }, data: { attivo: false } });
      await agent.post('/api/auth/refresh').expect(401);
    });
  });

  describe('roles', () => {
    it('applies the role hierarchy on endpoints', async () => {
      const t = await tavolo(prisma, 1);
      const mario = await login(server, 'mario');
      const monitor = await login(server, 'monitor');
      const capo = await login(server, 'capo');
      const fintoId = '00000000-0000-4000-8000-000000000000';

      await request(server).get('/api/tavoli').expect(401);
      await request(server).get('/api/tavoli').set(bearer(monitor)).expect(200);
      await request(server).post(`/api/tavoli/${t.id}/apri`).set(bearer(monitor)).send({}).expect(403);
      await request(server).post(`/api/sedute/${fintoId}/chiudi`).set(bearer(mario)).expect(403);
      await request(server).post(`/api/sedute/${fintoId}/chiudi`).set(bearer(capo)).expect(404);
      await request(server).post('/api/auth/dispositivo').set(bearer(mario)).send({ nome: 'x' }).expect(403);
    });
  });

  describe('shared restaurant device', () => {
    async function registraTablet() {
      const agent = request.agent(server);
      const capo = await login(server, 'capo');
      const res = await agent
        .post('/api/auth/dispositivo')
        .set(bearer(capo))
        .send({ nome: 'Tablet cassa' })
        .expect(201);
      const cookie = setCookieCompleto(res, 'kk_dev')!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Path=\/api\/auth/);
      return { agent, dispositivoId: (res.body as { id: string }).id };
    }

    it('lists the staff who can log in with a PIN, only on a registered device', async () => {
      const anonimo = await request(server).get('/api/auth/dispositivo').expect(200);
      expect(anonimo.body).toEqual({ registrato: false, nome: null, utenti: [] });

      const { agent } = await registraTablet();
      const info = (await agent.get('/api/auth/dispositivo').expect(200)).body as DispositivoCondivisoInfo;
      expect(info.registrato).toBe(true);
      expect(info.nome).toBe('Tablet cassa');
      expect(info.utenti.map((u) => u.nome)).toEqual(['Capo sala', 'Mario']);
    });

    it('logs a waiter in with the personal PIN and records the device in the token', async () => {
      const { agent, dispositivoId } = await registraTablet();
      const mario = await prisma.utenteStaff.findUniqueOrThrow({ where: { username: 'mario' } });

      await agent.post('/api/auth/pin').send({ utenteId: mario.id, pin: '9999' }).expect(401);
      const res = await agent.post('/api/auth/pin').send({ utenteId: mario.id, pin: '1234' }).expect(200);
      const sessione = res.body as SessioneStaff;
      expect(sessione.dispositivo).toEqual({ id: dispositivoId, nome: 'Tablet cassa' });

      const me = await request(server).get('/api/auth/me').set(bearer(sessione)).expect(200);
      expect(me.body.dispositivoStaffId).toBe(dispositivoId);

      // A user session on a shared device lasts a shift, not months.
      const riga = await prisma.refreshToken.findFirstOrThrow({ where: { utenteId: mario.id, revocatoIl: null } });
      const ore = (riga.scadeIl.getTime() - Date.now()) / 3_600_000;
      expect(ore).toBeGreaterThan(13);
      expect(ore).toBeLessThanOrEqual(14);

      // Logging out keeps the device registered.
      await agent.post('/api/auth/logout').expect(204);
      expect(((await agent.get('/api/auth/dispositivo')).body as DispositivoCondivisoInfo).registrato).toBe(true);
    });

    it('refuses PIN login from a browser that is not a registered device', async () => {
      const mario = await prisma.utenteStaff.findUniqueOrThrow({ where: { username: 'mario' } });
      const res = await request(server).post('/api/auth/pin').send({ utenteId: mario.id, pin: '1234' }).expect(401);
      expect(res.body.codice).toBe('DISPOSITIVO_NON_REGISTRATO');
    });

    it('locks a staff PIN after 5 wrong attempts', async () => {
      const { agent } = await registraTablet();
      const mario = await prisma.utenteStaff.findUniqueOrThrow({ where: { username: 'mario' } });
      for (let i = 0; i < 5; i++)
        await agent.post('/api/auth/pin').send({ utenteId: mario.id, pin: '0001' }).expect(401);
      await agent.post('/api/auth/pin').send({ utenteId: mario.id, pin: '1234' }).expect(429);
    });

    it('stops working once the device is revoked', async () => {
      const { agent, dispositivoId } = await registraTablet();
      const mario = await prisma.utenteStaff.findUniqueOrThrow({ where: { username: 'mario' } });
      await agent.post('/api/auth/pin').send({ utenteId: mario.id, pin: '1234' }).expect(200);
      await prisma.dispositivoStaff.update({ where: { id: dispositivoId }, data: { revocatoIl: new Date() } });
      await agent.post('/api/auth/refresh').expect(401);
      await agent.post('/api/auth/pin').send({ utenteId: mario.id, pin: '1234' }).expect(401);
    });
  });
});
