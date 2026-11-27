import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { StatoTavoloCliente } from '@kikko/shared';
import { I18nService } from '../../core/i18n/i18n.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto } from '../../testing/fakes';
import { TavoloPage } from './tavolo-page';

describe('TavoloPage (customer)', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;

  beforeEach(() => {
    localStorage.clear();
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      imports: [TavoloPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: RealtimeService, useValue: realtime }],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(I18nService).imposta('it');
  });

  function render() {
    const fixture = TestBed.createComponent(TavoloPage);
    fixture.componentRef.setInput('slug', 'tavolo-07');
    TestBed.tick();
    return fixture;
  }

  async function stabile(f: ReturnType<typeof render>) {
    await new Promise((r) => setTimeout(r, 0));
    TestBed.tick();
    return f.nativeElement as HTMLElement;
  }

  const pinRichiesto: StatoTavoloCliente = { stato: 'PIN_RICHIESTO', tavolo: { numero: 7 }, bloccatoPerSecondi: 0 };
  const connesso: StatoTavoloCliente = {
    stato: 'CONNESSO',
    tavolo: { numero: 7 },
    sedutaId: 'seduta-1',
    dispositivo: { id: 'd1', soprannome: 'Luca', emoji: '🐼' },
    scadeIl: new Date(Date.now() + 90 * 60_000).toISOString(),
    formula: { nome: { it: 'Cena', en: 'Dinner' } },
  };

  it('tells the customer to ask the staff when the table is not active', async () => {
    const f = render();
    http.expectOne('/api/t/tavolo-07').flush({ stato: 'NON_ATTIVO', tavolo: { numero: 7 } });
    const el = await stabile(f);
    expect(el.querySelector('[data-testid="non-attivo"]')?.textContent).toContain('Tavolo non ancora attivo');
  });

  it('switches language', async () => {
    const f = render();
    http.expectOne('/api/t/tavolo-07').flush({ stato: 'NON_ATTIVO', tavolo: { numero: 7 } });
    const el = await stabile(f);
    (
      Array.from(el.querySelectorAll('button.lingua')).find((b) => b.textContent?.trim() === 'EN') as HTMLButtonElement
    ).click();
    TestBed.tick();
    expect(el.textContent).toContain('This table is not active yet');
    expect(document.documentElement.lang).toBe('en');
  });

  it('sends the PIN, shows attempts left on a wrong PIN, then the lock', async () => {
    const f = render();
    http.expectOne('/api/t/tavolo-07').flush(pinRichiesto);
    const el = await stabile(f);
    const input = el.querySelector('[data-testid="pin-input"]') as HTMLInputElement;
    const invia = () => (el.querySelector('form.pin') as HTMLFormElement).dispatchEvent(new Event('submit'));

    input.value = '12a34';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(el.querySelectorAll('.pin__casella--piena')).toHaveLength(4);

    invia();
    const req = http.expectOne('/api/t/tavolo-07/join');
    expect(req.request.body).toEqual({ pin: '1234' });
    req.flush({ codice: 'PIN_ERRATO', tentativiRimasti: 2 }, { status: 401, statusText: 'Unauthorized' });
    await stabile(f);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ancora 2 tentativi');

    input.value = '9999';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    invia();
    http
      .expectOne('/api/t/tavolo-07/join')
      .flush({ codice: 'BLOCCATO', riprovaTraSecondi: 60 }, { status: 429, statusText: 'Too Many Requests' });
    await stabile(f);
    expect(el.querySelector('[data-testid="bloccato"]')?.textContent).toMatch(/Riprova tra (59|60) secondi/);
    expect(input.disabled).toBe(true);
  });

  it('joins the table and opens the live connection', async () => {
    const f = render();
    http.expectOne('/api/t/tavolo-07').flush(pinRichiesto);
    const el = await stabile(f);
    const input = el.querySelector('[data-testid="pin-input"]') as HTMLInputElement;
    input.value = '1234';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    (el.querySelector('form.pin') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne('/api/t/tavolo-07/join').flush({ id: 'd1', soprannome: 'Luca', emoji: '🐼' });
    await stabile(f);
    http.expectOne('/api/t/tavolo-07').flush(connesso);
    await stabile(f);

    expect(el.querySelector('app-sala-cliente')).not.toBeNull();
    expect(realtime.avviato).toEqual({ modo: 'cliente', chiave: 'seduta-1' });
    http.match('/api/menu');
    http.match('/api/cliente/seduta');
  });

  it('follows the merged session when the table is joined to another one', async () => {
    const f = render();
    http.expectOne('/api/t/tavolo-07').flush(connesso);
    await stabile(f);
    http.match('/api/menu');
    http.match('/api/cliente/seduta');
    realtime.terminata$.next({ motivo: 'TAVOLI_UNITI' });
    await stabile(f);
    http.expectOne('/api/t/tavolo-07').flush({ ...connesso, sedutaId: 'seduta-unita' });
    await stabile(f);
    expect(realtime.avviato).toEqual({ modo: 'cliente', chiave: 'seduta-unita' });
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="tavolo-chiuso"]')).toBeNull();
    http.match(() => true);
  });

  it('shows the goodbye screen when the table is closed', async () => {
    const f = render();
    http.expectOne('/api/t/tavolo-07').flush(connesso);
    const el = await stabile(f);
    http.match('/api/menu');
    http.match('/api/cliente/seduta');
    realtime.terminata$.next({ motivo: 'TAVOLO_CHIUSO' });
    TestBed.tick();
    expect(el.querySelector('[data-testid="tavolo-chiuso"]')?.textContent).toContain('Grazie e a presto!');
  });
});
