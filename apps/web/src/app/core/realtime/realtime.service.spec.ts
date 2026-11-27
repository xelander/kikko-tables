import { TestBed } from '@angular/core/testing';
import type { EventoDto } from '@kikko/shared';
import { SocketFinto, sessioneProva } from '../../testing/fakes';
import { StaffAuthService } from '../auth/staff-auth.service';
import { RealtimeService } from './realtime.service';

const ev = (seq: number): EventoDto => ({
  seq,
  ts: '',
  tipo: 'TAVOLO_APERTO',
  attore: { ruolo: 'CAMERIERE' },
  sedutaId: null,
  tavoloId: null,
  payload: {},
});

describe('RealtimeService', () => {
  let socket: SocketFinto;
  let service: RealtimeService;
  let authArgs: object | null;
  const rinnova = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    rinnova.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: StaffAuthService, useValue: { accessToken: () => 'tok-1', rinnova } }],
    });
    service = TestBed.inject(RealtimeService);
    socket = new SocketFinto();
    service.creaSocket = (auth) => {
      auth((dati) => (authArgs = dati));
      return socket.comeSocket();
    };
  });

  afterEach(() => service.ferma());

  it('connects with the staff token, syncs and reports connected', async () => {
    const ricariche = vi.fn();
    service.ricarica$.subscribe(ricariche);
    socket.rispostaSync = { esito: 'eventi', eventi: [], ultimoSeq: 42 };
    service.avvia({ modo: 'staff', chiave: 'u1' });
    expect(authArgs).toEqual({ token: 'tok-1' });
    expect(service.stato()).toBe('connessione');

    socket.emetti('connect');
    await vi.waitFor(() => expect(service.stato()).toBe('connesso'));
    expect(socket.inviati[0]).toEqual({ evento: 'sync', dati: { ultimoSeq: null } });
    expect(localStorage.getItem('kk_seq:staff:u1')).toBe('42');
    expect(ricariche).toHaveBeenCalledTimes(1); // first connection: load the state
  });

  it('resumes from the stored seq and emits recovered and live events in order', async () => {
    localStorage.setItem('kk_seq:cliente:s1', '10');
    const ricevuti: number[] = [];
    service.eventi$.subscribe((e) => ricevuti.push(e.seq));
    socket.rispostaSync = { esito: 'eventi', eventi: [ev(11), ev(12)], ultimoSeq: 12 };
    service.avvia({ modo: 'cliente', chiave: 's1' });
    expect(authArgs).toEqual({});

    socket.emetti('connect');
    await vi.waitFor(() => expect(service.stato()).toBe('connesso'));
    socket.emetti('evento', ev(13));
    socket.emetti('evento', ev(12));
    expect(socket.inviati[0]!.dati).toEqual({ ultimoSeq: 10 });
    expect(ricevuti).toEqual([11, 12, 13]);
    expect(localStorage.getItem('kk_seq:cliente:s1')).toBe('13');
  });

  it('shows "reconnecting" after losing an established connection', async () => {
    service.avvia({ modo: 'staff', chiave: 'u1' });
    socket.emetti('connect');
    await vi.waitFor(() => expect(service.stato()).toBe('connesso'));
    socket.emetti('disconnect');
    expect(service.stato()).toBe('riconnessione');
    socket.emetti('connect_error', new Error('xhr poll error'));
    expect(service.stato()).toBe('riconnessione');
  });

  it('asks for a reload when the server requires a snapshot', async () => {
    localStorage.setItem('kk_seq:staff:u1', '5');
    const ricariche = vi.fn();
    service.ricarica$.subscribe(ricariche);
    socket.rispostaSync = { esito: 'snapshot_required', ultimoSeq: 900 };
    service.avvia({ modo: 'staff', chiave: 'u1' });
    socket.emetti('connect');
    await vi.waitFor(() => expect(ricariche).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('kk_seq:staff:u1')).toBe('900');
  });

  it('renews an expired staff token and connects again', async () => {
    rinnova.mockResolvedValue(sessioneProva());
    service.avvia({ modo: 'staff', chiave: 'u1' });
    socket.active = false;
    socket.emetti(
      'connect_error',
      Object.assign(new Error('TOKEN_NON_VALIDO'), { data: { codice: 'TOKEN_NON_VALIDO' } }),
    );
    await vi.waitFor(() => expect(socket.connessioni).toBe(2));
    expect(rinnova).toHaveBeenCalledTimes(1);
    expect(service.stato()).not.toBe('terminato');
  });

  it('ends the customer session when the table is closed', () => {
    const fine = vi.fn();
    service.terminata$.subscribe(fine);
    service.avvia({ modo: 'cliente', chiave: 's1' });
    socket.emetti('sessione_terminata', { motivo: 'TAVOLO_CHIUSO' });
    expect(service.stato()).toBe('terminato');
    expect(fine).toHaveBeenCalledWith({ motivo: 'TAVOLO_CHIUSO' });
  });

  it('treats a refused customer handshake as a closed table', () => {
    const fine = vi.fn();
    service.terminata$.subscribe(fine);
    service.avvia({ modo: 'cliente', chiave: 's1' });
    socket.active = false;
    socket.emetti(
      'connect_error',
      Object.assign(new Error('NON_AUTORIZZATO'), { data: { codice: 'NON_AUTORIZZATO' } }),
    );
    expect(fine).toHaveBeenCalledWith({ motivo: 'TAVOLO_CHIUSO' });
  });
});
