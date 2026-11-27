import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../../core/i18n/i18n.service';
import { RealtimeService } from '../../../core/realtime/realtime.service';
import { MOTIVI_RIFIUTO } from '@kikko/shared/browser';
import { RealtimeFinto, menuProva, sedutaProva } from '../../../testing/fakes';
import { SalaCliente } from './sala-cliente';

describe('SalaCliente', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;

  beforeEach(() => {
    localStorage.clear();
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      imports: [SalaCliente],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: RealtimeService, useValue: realtime }],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(I18nService).imposta('it');
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  async function render() {
    const f = TestBed.createComponent(SalaCliente);
    TestBed.tick();
    http.expectOne('/api/menu').flush(menuProva());
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    await new Promise((r) => setTimeout(r, 0));
    TestBed.tick();
    return f.nativeElement as HTMLElement;
  }

  const piatti = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('app-scheda-piatto h3')).map((h) => h.textContent?.trim().replace(/\s+/g, ' '));

  it('shows the menu and the drinks on separate pages, with the round counter', async () => {
    const el = await render();
    expect(piatti(el)).toEqual(['46 Nigiri salmone', '113 Bao bun']);
    expect(el.querySelector('[data-testid="contatore-giro"]')?.textContent).toContain('0/6');
    expect(el.textContent).toContain('max 1 a persona');

    (
      Array.from(el.querySelectorAll('.sezioni button')).find((b) =>
        b.textContent?.includes('Bevande'),
      ) as HTMLButtonElement
    ).click();
    TestBed.tick();
    expect(piatti(el)).toEqual(['Acqua']);
    expect(el.textContent).toContain('2,50');
  });

  it('hides dishes with an excluded allergen and remembers the filter', async () => {
    const el = await render();
    const fish = el.querySelector('[data-testid="escludi-FISH"]') as HTMLInputElement;
    fish.checked = true;
    fish.dispatchEvent(new Event('change'));
    TestBed.tick();
    expect(piatti(el)).toEqual(['113 Bao bun']);
    expect(el.querySelector('.filtro')?.textContent).toContain('Filtri (1)');
    expect(JSON.parse(localStorage.getItem('kk_filtri')!).esclusi).toEqual(['FISH']);
  });

  it('greys out a dish as soon as the till marks it sold out', async () => {
    const el = await render();
    realtime.eventi$.next({
      seq: 9,
      ts: '',
      tipo: 'PIATTO_ESAURITO',
      attore: { ruolo: 'CAPO' },
      sedutaId: null,
      tavoloId: null,
      payload: { piattoId: 'p-bao' },
    });
    TestBed.tick();
    expect(el.querySelector('[aria-label="Aggiungi Bao bun"]')).toBeNull();
    expect(el.textContent).toContain('Esaurito');
  });

  it('shows the rejection notice with the reason in the customer language', async () => {
    const el = await render();
    TestBed.inject(I18nService).imposta('en');
    const motivo = MOTIVI_RIFIUTO[1]!;
    realtime.eventi$.next({
      seq: 9,
      ts: '',
      tipo: 'GIRO_RIFIUTATO',
      attore: { ruolo: 'CAPO' },
      sedutaId: 'seduta-1',
      tavoloId: null,
      payload: { giroId: 'g1', numero: 1, motivo: motivo.it },
    });
    http.expectOne('/api/cliente/seduta').flush(sedutaProva());
    TestBed.tick();
    const notifica = el.querySelector('[data-testid="notifica-giro"]')!;
    expect(notifica.textContent).toContain('Round 1 not accepted');
    expect(notifica.textContent).toContain(motivo.en);
    (notifica.querySelector('button') as HTMLButtonElement).click();
    TestBed.tick();
    expect(el.querySelector('[data-testid="notifica-giro"]')).toBeNull();
  });

  it('disables "+" when the per-person limit is reached', async () => {
    const el = await render();
    const piu = () => el.querySelector('[aria-label="Aggiungi Bao bun"]') as HTMLButtonElement;
    piu().click();
    TestBed.tick();
    piu().click();
    TestBed.tick();
    expect(piu().disabled).toBe(true);
    expect(el.querySelector('[data-testid="contatore-giro"]')?.textContent).toContain('2/6');
  });
});
