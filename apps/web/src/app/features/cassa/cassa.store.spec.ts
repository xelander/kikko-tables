import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EventoDto } from '@kikko/shared';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto, menuProva } from '../../testing/fakes';
import { CHIAVE_SUONI, CassaStore } from './cassa.store';
import { codaProva, giroProva, tavoloAperto } from './prova-cassa';
import { Suono } from './suono';

const evento = (tipo: EventoDto['tipo']): EventoDto => ({
  seq: 1,
  ts: '',
  tipo,
  attore: { ruolo: 'CLIENTE' },
  sedutaId: 's4',
  tavoloId: null,
  payload: {},
});

describe('CassaStore', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;
  let suono: { pronto: boolean; sblocca: ReturnType<typeof vi.fn>; suona: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    localStorage.clear();
    realtime = new RealtimeFinto();
    suono = { pronto: false, sblocca: vi.fn(), suona: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        CassaStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
        { provide: Suono, useValue: suono },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  async function crea(coda = codaProva(), tavoli = [tavoloAperto(4)]): Promise<CassaStore> {
    const store = TestBed.inject(CassaStore);
    http.expectOne('/api/cassa/giri').flush(coda);
    http.expectOne('/api/tavoli').flush(tavoli);
    http.expectOne('/api/menu').flush(menuProva());
    await vi.advanceTimersByTimeAsync(0);
    return store;
  }

  it('loads the queue, the open tables and the dish names', async () => {
    const store = await crea();
    expect(store.inAttesa().map((g) => g.id)).toEqual(['g1']);
    expect(store.sedute()).toHaveLength(1);
    expect(store.nome('p-salmone')).toBe('46 · Nigiri salmone');
  });

  it('hides a round at once when approving it, then reloads the queue', async () => {
    const store = await crea();
    const esito = store.approva(giroProva());
    expect(store.inAttesa()).toEqual([]);
    http.expectOne({ method: 'POST', url: '/api/giri/g1/approva' }).flush(giroProva({ stato: 'APPROVATO' }));
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cassa/giri').flush(codaProva([], [giroProva({ stato: 'APPROVATO' })]));
    expect(await esito).toBe(true);
    expect(store.recenti()).toHaveLength(1);
  });

  it('brings a round back when the request fails, and explains a round handled by a colleague', async () => {
    const store = await crea();
    const esito = store.rifiuta(giroProva(), 'Esaurito');
    const req = http.expectOne('/api/giri/g1/rifiuta');
    expect(req.request.body).toEqual({ motivo: 'Esaurito' });
    req.flush({ codice: 'GIRO_GIA_GESTITO', stato: 'APPROVATO' }, { status: 409, statusText: 'Conflict' });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cassa/giri').flush(codaProva([]));
    expect(await esito).toBe(true);
    expect(store.errore()).toBe('Questo giro è già stato gestito da un collega.');

    const store2 = store;
    http.expectNone('/api/cassa/giri');
    // A network error: the round comes back.
    realtime.eventi$.next(evento('GIRO_INVIATO'));
    await vi.advanceTimersByTimeAsync(200);
    http.expectOne('/api/cassa/giri').flush(codaProva());
    http.expectOne('/api/tavoli').flush([tavoloAperto(4)]);
    const fallito = store2.approva(giroProva());
    http.expectOne('/api/giri/g1/approva').flush(null, { status: 0, statusText: 'offline' });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cassa/giri').flush(codaProva());
    expect(await fallito).toBe(false);
    expect(store2.inAttesa().map((g) => g.id)).toEqual(['g1']);
    expect(store2.errore()).toBe('Nessuna connessione con il server.');
  });

  it('rings for a new round and for an expired table only when sounds are on', async () => {
    const store = await crea();
    realtime.eventi$.next(evento('GIRO_INVIATO'));
    expect(suono.suona).not.toHaveBeenCalled();

    store.attivaSuoni(true);
    expect(localStorage.getItem(CHIAVE_SUONI)).toBe('1');
    expect(suono.sblocca).toHaveBeenCalled();
    suono.suona.mockClear();
    realtime.eventi$.next(evento('GIRO_INVIATO'));
    realtime.eventi$.next(evento('TEMPO_SCADUTO'));
    expect(suono.suona.mock.calls).toEqual([['giro'], ['allarme']]);

    // Both lists are reloaded once, after a short pause.
    await vi.advanceTimersByTimeAsync(200);
    http.expectOne('/api/cassa/giri').flush(codaProva());
    http.expectOne('/api/tavoli').flush([tavoloAperto(4)]);
  });

  it('lists the expired tables once per session (merged tables appear once)', async () => {
    const passato = new Date(Date.now() - 60_000).toISOString();
    const unito = { scadeIl: passato, tavoli: [7, 8] };
    const store = await crea(codaProva([]), [
      tavoloAperto(4),
      { ...tavoloAperto(7, unito), seduta: { ...tavoloAperto(7, unito).seduta!, id: 's78' } },
      { ...tavoloAperto(8, unito), seduta: { ...tavoloAperto(8, unito).seduta!, id: 's78' } },
    ]);
    expect(store.sedute()).toHaveLength(2);
    expect(store.scaduti().map((t) => t.seduta!.tavoli)).toEqual([[7, 8]]);
  });

  it('highlights a round waiting for 5 minutes or more', async () => {
    const store = await crea();
    expect(store.attesaLunga(giroProva())).toBe(false);
    expect(store.attesaLunga(giroProva({ inviatoIl: new Date(Date.now() - 6 * 60_000).toISOString() }))).toBe(true);
    expect(store.minutiAttesa(giroProva({ inviatoIl: new Date(Date.now() - 6 * 60_000).toISOString() }))).toBe(6);
  });
});
