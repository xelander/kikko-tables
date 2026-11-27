import type { INestApplication } from '@nestjs/common';
import { type EventoDto, SOCKET, type SessioneStaff, type SyncRisposta } from '@kikko/shared';
import type { AddressInfo } from 'node:net';
import { type Socket, io } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  apriTavolo,
  avviaApp,
  cookieDa,
  formulaCena,
  login,
  pinSbagliato,
  preparaDatabase,
  tavolo,
} from './helpers.js';
import { createTestPrisma } from './test-db.js';

/**
 * A Socket.IO client that records events and remembers the last seq, like the web app does.
 * While a `sync` is in flight, live events are queued and applied after the recovered ones.
 */
class ClientProva {
  readonly ricevuti: EventoDto[] = [];
  private coda: EventoDto[] | null = null;
  ultimoSeq: number | null = null;
  terminata: unknown = null;
  readonly socket: Socket;

  constructor(url: string, opzioni: { token?: string | (() => string); cookie?: string; riconnessione?: boolean }) {
    this.socket = io(url, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: opzioni.riconnessione ?? false,
      reconnectionDelay: 100,
      reconnectionDelayMax: 300,
      auth: (cb) => {
        const t = typeof opzioni.token === 'function' ? opzioni.token() : opzioni.token;
        cb(t ? { token: t } : {});
      },
      extraHeaders: opzioni.cookie ? { cookie: opzioni.cookie } : {},
      autoConnect: false,
    });
    this.socket.on(SOCKET.evento, (e: EventoDto) => (this.coda ? this.coda.push(e) : this.applica(e)));
    this.socket.on(SOCKET.terminata, (m: unknown) => (this.terminata = m));
    this.socket.on('connect', () => void this.sincronizza());
  }

  private applica(e: EventoDto): void {
    if (this.ultimoSeq !== null && e.seq <= this.ultimoSeq) return;
    this.ricevuti.push(e);
    this.ultimoSeq = e.seq;
  }

  async sincronizza(): Promise<SyncRisposta> {
    this.coda = [];
    const risposta = (await this.socket.emitWithAck(SOCKET.sync, { ultimoSeq: this.ultimoSeq })) as SyncRisposta;
    if (risposta.esito === 'eventi') risposta.eventi.forEach((e) => this.applica(e));
    const inAttesa = this.coda.sort((a, b) => a.seq - b.seq);
    this.coda = null;
    // Live events up to the head were already part of the backlog (or not meant for us).
    this.ultimoSeq = Math.max(this.ultimoSeq ?? 0, risposta.ultimoSeq);
    inAttesa.forEach((e) => this.applica(e));
    this.ultimaSync = risposta;
    return risposta;
  }
  ultimaSync: SyncRisposta | null = null;

  connetti(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('connect', () => resolve());
      this.socket.once('connect_error', (err) => reject(err));
      this.socket.connect();
    });
  }

  tipi(): string[] {
    return this.ricevuti.map((e) => e.tipo);
  }

  diTipo(tipo: EventoDto['tipo']): EventoDto[] {
    return this.ricevuti.filter((e) => e.tipo === tipo);
  }

  chiudi(): void {
    this.socket.disconnect();
  }
}

async function attendi(condizione: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const inizio = Date.now();
  while (!(await condizione())) {
    if (Date.now() - inizio > timeoutMs) throw new Error('Condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('real-time gateway', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let url: string;
  let porta: number;
  let mario: SessioneStaff;
  const clients: ClientProva[] = [];

  function client(opzioni: ConstructorParameters<typeof ClientProva>[1]): ClientProva {
    const c = new ClientProva(url, opzioni);
    clients.push(c);
    return c;
  }

  async function clienteAlTavolo(numero: number, pin: string): Promise<string> {
    const slug = `tavolo-${String(numero).padStart(2, '0')}`;
    const res = await request(app.getHttpServer()).post(`/api/t/${slug}/join`).send({ pin }).expect(200);
    return cookieDa(res, 'kk_ct')!;
  }

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await avviaApp({ porta: 0 });
    porta = (app.getHttpServer().address() as AddressInfo).port;
    url = `http://127.0.0.1:${porta}`;
  });

  beforeEach(async () => {
    await preparaDatabase(prisma);
    mario = await login(app.getHttpServer(), 'mario');
  });

  afterEach(() => {
    clients.splice(0).forEach((c) => c.chiudi());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('refuses connections without credentials or with an invalid token', async () => {
    await expect(client({}).connetti()).rejects.toMatchObject({ message: 'NON_AUTENTICATO' });
    await expect(client({ token: 'abc' }).connetti()).rejects.toMatchObject({ message: 'TOKEN_NON_VALIDO' });
    await expect(client({ cookie: 'kk_ct=falso' }).connetti()).rejects.toMatchObject({ message: 'NON_AUTORIZZATO' });
  });

  it('delivers events live to staff, in order, after commit', async () => {
    const staff = client({ token: mario.accessToken });
    await staff.connetti();
    const cena = await formulaCena(prisma);
    const aperta = await apriTavolo(app.getHttpServer(), mario, (await tavolo(prisma, 1)).id, cena.id);
    await clienteAlTavolo(1, aperta.pin);

    await attendi(() => staff.ricevuti.length >= 2);
    expect(staff.tipi()).toEqual(['TAVOLO_APERTO', 'DISPOSITIVO_UNITO']);
    expect(staff.ricevuti[0]).toMatchObject({
      attore: { ruolo: 'CAMERIERE', id: mario.utente.id },
      sedutaId: aperta.seduta.id,
    });
    expect(staff.ricevuti[1]!.seq).toBeGreaterThan(staff.ricevuti[0]!.seq);
  });

  it('sends customers only the sanitised events of their own table', async () => {
    const cena = await formulaCena(prisma);
    const server = app.getHttpServer();
    const a = await apriTavolo(server, mario, (await tavolo(prisma, 1)).id, cena.id);
    const b = await apriTavolo(server, mario, (await tavolo(prisma, 2)).id, cena.id);

    const clienteA = client({ cookie: await clienteAlTavolo(1, a.pin) });
    await clienteA.connetti();
    await attendi(() => clienteA.ultimaSync !== null);

    await clienteAlTavolo(1, a.pin); // a second phone at table 1
    await clienteAlTavolo(2, b.pin); // someone at table 2
    await request(server)
      .post('/api/t/tavolo-01/join')
      .send({ pin: pinSbagliato(a.pin) }); // wrong PIN at table 1
    await request(server).post(`/api/sedute/${a.seduta.id}/pin`).set('Authorization', `Bearer ${mario.accessToken}`);

    const staff = client({ token: mario.accessToken });
    await staff.connetti();
    await attendi(async () => (await prisma.evento.count({ where: { tipo: 'PIN_RIGENERATO' } })) === 1);
    await attendi(() => clienteA.ricevuti.length >= 1);
    await new Promise((r) => setTimeout(r, 200));

    expect(clienteA.tipi()).toEqual(['DISPOSITIVO_UNITO']);
    const evento = clienteA.ricevuti[0]!;
    expect(evento.sedutaId).toBe(a.seduta.id);
    expect(evento.attore).toEqual({ ruolo: 'CLIENTE', id: expect.any(String) });
    expect(Object.keys(evento.payload).sort()).toEqual(['dispositivoId', 'emoji', 'soprannome']);
  });

  it('recovers the events missed while disconnected, then records CLIENT_RICONNESSO', async () => {
    const staff = client({ token: mario.accessToken });
    await staff.connetti();
    const cena = await formulaCena(prisma);
    const server = app.getHttpServer();
    await apriTavolo(server, mario, (await tavolo(prisma, 1)).id, cena.id);
    await attendi(() => staff.ricevuti.length === 1);

    staff.socket.disconnect();
    // While offline: three tables are opened.
    for (const n of [2, 3, 4]) await apriTavolo(server, mario, (await tavolo(prisma, n)).id, cena.id);

    await staff.connetti();
    await attendi(() => staff.diTipo('TAVOLO_APERTO').length === 4);
    expect(staff.ultimaSync).toMatchObject({ esito: 'eventi' });
    expect(staff.diTipo('TAVOLO_APERTO').map((e) => e.payload['tavoloNumero'])).toEqual([1, 2, 3, 4]);
    const seqs = staff.ricevuti.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const riconnessi = await prisma.evento.findMany({ where: { tipo: 'CLIENT_RICONNESSO' } });
    expect(riconnessi).toHaveLength(1);
    expect(riconnessi[0]).toMatchObject({ attoreId: mario.utente.id, payload: { eventiMancanti: 3 } });
  });

  it('asks for a full snapshot when too many events were missed', async () => {
    const staff = client({ token: mario.accessToken });
    await staff.connetti();
    await attendi(() => staff.ultimaSync !== null);
    staff.socket.disconnect();
    const ultimo = staff.ultimoSeq!;

    await prisma.evento.createMany({
      data: Array.from({ length: 501 }, () => ({
        tipo: 'CONFIG_MODIFICATA' as const,
        attoreRuolo: 'SISTEMA' as const,
      })),
    });

    staff.ultimaSync = null;
    await staff.connetti();
    await attendi(() => staff.ultimaSync !== null);
    expect(staff.ultimaSync).toMatchObject({ esito: 'snapshot_required' });
    expect(staff.ultimoSeq).toBeGreaterThanOrEqual(ultimo + 501);
  });

  it('a customer catches up only on its own events after reconnecting', async () => {
    const cena = await formulaCena(prisma);
    const server = app.getHttpServer();
    const a = await apriTavolo(server, mario, (await tavolo(prisma, 1)).id, cena.id);
    const cliente = client({ cookie: await clienteAlTavolo(1, a.pin) });
    await cliente.connetti();
    await attendi(() => cliente.ultimaSync !== null);
    cliente.socket.disconnect();

    const b = await apriTavolo(server, mario, (await tavolo(prisma, 2)).id, cena.id);
    await clienteAlTavolo(2, b.pin);
    await clienteAlTavolo(1, a.pin);

    await cliente.connetti();
    await attendi(() => cliente.ricevuti.length >= 1);
    expect(cliente.tipi()).toEqual(['DISPOSITIVO_UNITO']);
    expect(cliente.ricevuti[0]!.sedutaId).toBe(a.seduta.id);
    // The cursor moves to the head of the log even though most events were not for this table.
    expect(cliente.ultimoSeq).toBe(Number((await prisma.evento.aggregate({ _max: { seq: true } }))._max.seq) - 1);
  });

  it('shares cart changes and sent rounds live with the other phones of the table', async () => {
    const cena = await formulaCena(prisma);
    const server = app.getHttpServer();
    const a = await apriTavolo(server, mario, (await tavolo(prisma, 2)).id, cena.id);
    const annaCookie = await clienteAlTavolo(2, a.pin);
    const luca = client({ cookie: await clienteAlTavolo(2, a.pin) });
    await luca.connetti();
    await attendi(() => luca.ultimaSync !== null);

    const piatto = await prisma.piatto.findUniqueOrThrow({ where: { numero: '46' } });
    await request(server)
      .put(`/api/cliente/carrello/${piatto.id}`)
      .set('Cookie', annaCookie)
      .send({ quantita: 3 })
      .expect(200);
    await attendi(() => luca.diTipo('CARRELLO_MODIFICATO').length === 1);
    expect(luca.diTipo('CARRELLO_MODIFICATO')[0]!.payload).toMatchObject({ piattoId: piatto.id, quantita: 3 });

    await request(server)
      .post('/api/cliente/giri')
      .set('Cookie', annaCookie)
      .send({ chiaveIdempotenza: crypto.randomUUID() })
      .expect(201);
    await attendi(() => luca.diTipo('GIRO_INVIATO').length === 1);
    expect(Object.keys(luca.diTipo('GIRO_INVIATO')[0]!.payload).sort()).toEqual(['giroId', 'numero']);
  });

  it('when two open tables are merged, the absorbed phones reconnect into the merged session', async () => {
    const cena = await formulaCena(prisma);
    const server = app.getHttpServer();
    const a = await apriTavolo(server, mario, (await tavolo(prisma, 7)).id, cena.id);
    const b = await apriTavolo(server, mario, (await tavolo(prisma, 8)).id, cena.id);
    const cookieLuca = await clienteAlTavolo(8, b.pin);
    const luca = client({ cookie: cookieLuca });
    await luca.connetti();
    await attendi(() => luca.ultimaSync !== null);

    await request(server)
      .post(`/api/sedute/${a.seduta.id}/unisci`)
      .set('Authorization', `Bearer ${mario.accessToken}`)
      .send({ sedutaId: b.seduta.id })
      .expect(200);
    await attendi(() => luca.terminata !== null && !luca.socket.connected);
    expect(luca.terminata).toEqual({ motivo: 'TAVOLI_UNITI' });

    // reconnecting with the same cookie puts the phone in the merged session's room
    const dopo = client({ cookie: cookieLuca });
    await dopo.connetti();
    await attendi(() => dopo.ultimaSync !== null);
    await clienteAlTavolo(7, a.pin);
    await attendi(() => dopo.diTipo('DISPOSITIVO_UNITO').length === 1);
    expect(dopo.diTipo('DISPOSITIVO_UNITO')[0]!.sedutaId).toBe(a.seduta.id);
  });

  it('closing the table ends the customer session and refuses reconnection', async () => {
    const cena = await formulaCena(prisma);
    const server = app.getHttpServer();
    const a = await apriTavolo(server, mario, (await tavolo(prisma, 3)).id, cena.id);
    const cookie = await clienteAlTavolo(3, a.pin);
    const cliente = client({ cookie });
    await cliente.connetti();
    await attendi(() => cliente.ultimaSync !== null);

    const capo = await login(server, 'capo');
    await request(server)
      .post(`/api/sedute/${a.seduta.id}/chiudi`)
      .set('Authorization', `Bearer ${capo.accessToken}`)
      .expect(204);

    await attendi(() => cliente.terminata !== null && !cliente.socket.connected);
    expect(cliente.terminata).toEqual({ motivo: 'TAVOLO_CHIUSO' });
    expect(cliente.tipi()).toContain('TAVOLO_CHIUSO');
    await expect(client({ cookie }).connetti()).rejects.toMatchObject({ message: 'NON_AUTORIZZATO' });
  });

  it('reconnects by itself after a server restart and recovers what happened meanwhile', async () => {
    const staff = client({ token: mario.accessToken, riconnessione: true });
    await staff.connetti();
    await attendi(() => staff.ultimaSync !== null);
    const cena = await formulaCena(prisma);

    // The server goes down (power cut)…
    await app.close();
    await attendi(() => !staff.socket.connected);

    // …something is written by another instance while this one is down…
    const altra = await avviaApp();
    await apriTavolo(altra.getHttpServer(), mario, (await tavolo(prisma, 5)).id, cena.id);
    await altra.close();

    // …and the server comes back on the same port.
    app = await avviaApp({ porta });
    await attendi(() => staff.socket.connected && staff.diTipo('TAVOLO_APERTO').length === 1, 10_000);
    expect(staff.diTipo('TAVOLO_APERTO')[0]).toMatchObject({ payload: { tavoloNumero: 5 } });

    // Live events flow again after the restart.
    await apriTavolo(app.getHttpServer(), mario, (await tavolo(prisma, 6)).id, cena.id);
    await attendi(() => staff.diTipo('TAVOLO_APERTO').length === 2);
  });
});
