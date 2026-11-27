import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EventoDto } from '@kikko/shared';
import { RealtimeService } from '../../../core/realtime/realtime.service';
import { RealtimeFinto, menuProva, sedutaProva } from '../../../testing/fakes';
import { RITARDO_INVIO_CARRELLO_MS, SalaStore } from './sala.store';

const evento = (payload: Record<string, unknown>, tipo: EventoDto['tipo'] = 'CARRELLO_MODIFICATO'): EventoDto => ({
  seq: 1,
  ts: '',
  tipo,
  attore: { ruolo: 'CLIENTE' },
  sedutaId: 'seduta-1',
  tavoloId: null,
  payload,
});

describe('SalaStore', () => {
  let http: HttpTestingController;
  let store: SalaStore;
  let realtime: RealtimeFinto;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    localStorage.clear();
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      providers: [
        SalaStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SalaStore);
    const caricamento = store.carica();
    http.expectOne('/api/menu').flush(menuProva());
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    await caricamento;
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('applies my changes at once and sends taps grouped after a short pause', async () => {
    store.imposta('p-salmone', 1);
    store.imposta('p-salmone', 2);
    store.imposta('p-salmone', 3);
    expect(store.quantitaMia('p-salmone')).toBe(3);
    expect(store.contatoreGiro()).toEqual({ nelGiro: 3, limite: 6 });
    http.expectNone('/api/cliente/carrello/p-salmone');

    await vi.advanceTimersByTimeAsync(RITARDO_INVIO_CARRELLO_MS);
    const req = http.expectOne('/api/cliente/carrello/p-salmone');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ quantita: 3 });
    req.flush([{ piattoId: 'p-salmone', dispositivoId: 'io', quantita: 3 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.quantitaMia('p-salmone')).toBe(3);
  });

  it('rolls back a change the server did not save', async () => {
    store.imposta('p-salmone', 2);
    await vi.advanceTimersByTimeAsync(RITARDO_INVIO_CARRELLO_MS);
    http.expectOne('/api/cliente/carrello/p-salmone').error(new ProgressEvent('error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.quantitaMia('p-salmone')).toBe(0);
    expect(store.errore()).toBe('carrello');
  });

  it('shows the other phones of the table live, and counts extras apart', () => {
    realtime.eventi$.next(evento({ piattoId: 'p-salmone', quantita: 2, dispositivoId: 'altro' }));
    realtime.eventi$.next(evento({ piattoId: 'p-acqua', quantita: 2, dispositivoId: 'altro' }));
    expect(store.quantitaMia('p-salmone')).toBe(0);
    expect(store.pezziNelCarrello()).toBe(4);
    expect(store.contatoreGiro()).toEqual({ nelGiro: 2, limite: 6 });
    expect(store.totaleExtraCent()).toBe(500);
    realtime.eventi$.next(evento({ piattoId: 'p-salmone', quantita: 0, dispositivoId: 'altro' }));
    expect(store.pezziNelCarrello()).toBe(2);
  });

  it('ignores events of other tables (staff receive them all) and reloads after a move or a merge', async () => {
    realtime.eventi$.next({ ...evento({ piattoId: 'p-salmone', quantita: 5, dispositivoId: 'x' }), sedutaId: 'altra' });
    expect(store.pezziNelCarrello()).toBe(0);
    for (const tipo of ['TAVOLO_SPOSTATO', 'TAVOLI_UNITI', 'COPERTI_MODIFICATI'] as const) {
      realtime.eventi$.next(evento({}, tipo));
      http.expectOne('/api/cliente/seduta').flush(sedutaProva({ tavoli: [9] }));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(store.seduta()?.tavoli).toEqual([9]);
  });

  it('reloads the session to learn the emoji of a new device in the cart', () => {
    realtime.eventi$.next(evento({ piattoId: 'p-salmone', quantita: 1, dispositivoId: 'cameriere' }));
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
  });

  it('knows how many more of a dish can be added (bao: 1 per person × 2)', () => {
    expect(store.disponibili('p-bao')).toBe(2);
    store.imposta('p-bao', 2);
    expect(store.disponibili('p-bao')).toBe(0);
    expect(store.disponibili('p-salmone')).toBe(4);
  });

  it('sends pending cart changes before the round, then the round with an idempotency key', async () => {
    store.imposta('p-salmone', 2);
    const invio = store.inviaGiro();
    await vi.advanceTimersByTimeAsync(0);
    http
      .expectOne('/api/cliente/carrello/p-salmone')
      .flush([{ piattoId: 'p-salmone', dispositivoId: 'io', quantita: 2 }]);
    await vi.advanceTimersByTimeAsync(0);
    const req = http.expectOne('/api/cliente/giri');
    expect(req.request.body.chiaveIdempotenza).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({
      id: 'g1',
      numero: 1,
      stato: 'INVIATO',
      soloExtra: false,
      inviatoIl: new Date().toISOString(),
      motivoRifiuto: null,
      voci: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    await invio;
    expect(store.statoInvio()).toBe('inviato');
    expect(localStorage.getItem('kk_giro:seduta-1')).toBeNull();
  });

  it('keeps an offline round queued and retries it with the same key', async () => {
    store.imposta('p-salmone', 1);
    await vi.advanceTimersByTimeAsync(RITARDO_INVIO_CARRELLO_MS);
    http
      .expectOne('/api/cliente/carrello/p-salmone')
      .flush([{ piattoId: 'p-salmone', dispositivoId: 'io', quantita: 1 }]);
    await vi.advanceTimersByTimeAsync(0);

    const invio = store.inviaGiro();
    await vi.advanceTimersByTimeAsync(0);
    const primo = http.expectOne('/api/cliente/giri');
    const chiave = primo.request.body.chiaveIdempotenza as string;
    primo.error(new ProgressEvent('error'));
    await invio;
    expect(store.statoInvio()).toBe('in-coda');
    expect(localStorage.getItem('kk_giro:seduta-1')).toBe(chiave);

    // the connection is back: the realtime service asks for a reload
    realtime.ricarica$.next();
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    const secondo = http.expectOne('/api/cliente/giri');
    expect(secondo.request.body.chiaveIdempotenza).toBe(chiave);
    secondo.flush({
      id: 'g1',
      numero: 1,
      stato: 'INVIATO',
      soloExtra: false,
      inviatoIl: '',
      motivoRifiuto: null,
      voci: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.statoInvio()).toBe('inviato');
    expect(localStorage.getItem('kk_giro:seduta-1')).toBeNull();
  });

  it('shows the rules broken by a refused round and forgets its key', async () => {
    const invio = store.inviaGiro();
    await vi.advanceTimersByTimeAsync(0);
    http
      .expectOne('/api/cliente/giri')
      .flush(
        { codice: 'REGOLE_VIOLATE', errori: [{ codice: 'LIMITE_GIRO', richiesti: 8, limite: 6 }] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    await vi.advanceTimersByTimeAsync(0);
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    await invio;
    expect(store.erroriGiro()).toEqual([{ codice: 'LIMITE_GIRO', richiesti: 8, limite: 6 }]);
    expect(store.statoInvio()).toBe('pronto');
    expect(localStorage.getItem('kk_giro:seduta-1')).toBeNull();
  });

  it('computes the wait before the next round from the server clock', async () => {
    const ricarica = store.caricaSeduta();
    const ora = Date.now();
    http.expectOne('/api/cliente/seduta').flush(
      sedutaProva({
        ora: new Date(ora + 60_000).toISOString(), // the server clock is one minute ahead
        giri: [
          {
            id: 'g',
            numero: 1,
            stato: 'INVIATO',
            soloExtra: false,
            inviatoIl: new Date(ora).toISOString(),
            motivoRifiuto: null,
            voci: [],
          },
        ],
      }),
    );
    await ricarica;
    const attesa = store.attesaProssimoGiro();
    expect(attesa).toBeGreaterThan(8.9 * 60_000);
    expect(attesa).toBeLessThanOrEqual(9 * 60_000 + 1000);
  });
});
