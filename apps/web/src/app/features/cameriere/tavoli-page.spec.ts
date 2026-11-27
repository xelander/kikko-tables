import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TavoloStato } from '@kikko/shared';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto, sessioneProva } from '../../testing/fakes';
import { TavoliPage, statoTavolo } from './tavoli-page';
import { tempoRimanente } from './tempo';

const libero = (numero: number): TavoloStato => ({
  id: `t${numero}`,
  numero,
  slugQr: `tavolo-0${numero}`,
  posti: 4,
  posX: 0,
  posY: 0,
  seduta: null,
});

describe('table helpers', () => {
  it('formats the time left', () => {
    expect(tempoRimanente(-1)).toBe('scaduto');
    expect(tempoRimanente(12 * 60_000)).toBe('12 min');
    expect(tempoRimanente(65 * 60_000)).toBe('1 h 05 min');
  });

  it('derives the table state from the server deadline', () => {
    const ora = Date.parse('2026-11-27T20:00:00Z');
    const conScadenza = (min: number): TavoloStato => ({
      ...libero(1),
      seduta: {
        id: 's',
        apertaIl: '',
        scadeIl: new Date(ora + min * 60_000).toISOString(),
        scaduta: false,
        copertiAdulti: 2,
        copertiBambini: 0,
        formula: { id: 'f', codice: 'cena', nome: { it: 'Cena', en: 'Dinner' } },
        dispositiviCollegati: 0,
      },
    });
    expect(statoTavolo(libero(1), ora)).toBe('libero');
    expect(statoTavolo(conScadenza(60), ora)).toBe('aperto');
    expect(statoTavolo(conScadenza(10), ora)).toBe('quasi-scaduto');
    expect(statoTavolo(conScadenza(-1), ora)).toBe('scaduto');
  });
});

describe('TavoliPage', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;

  beforeEach(() => {
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      imports: [TavoliPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
        {
          provide: StaffAuthService,
          useValue: {
            utente: () => sessioneProva('CAPO').utente,
            sessione: () => sessioneProva('CAPO'),
            accessToken: () => 'x',
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    // jsdom has no <dialog> methods.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  const attendi = async () => {
    await new Promise((r) => setTimeout(r, 0));
    TestBed.tick();
  };

  it('opens a table and shows the PIN', async () => {
    const f = TestBed.createComponent(TavoliPage);
    TestBed.tick();
    http.expectOne('/api/tavoli').flush([libero(1), libero(2)]);
    await attendi();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('0 aperti');

    (el.querySelector('[data-testid="tavolo-2"]') as HTMLButtonElement).click();
    await attendi();
    http.expectOne('/api/formule').flush({
      formule: [
        {
          id: 'f1',
          codice: 'pranzo-feriale',
          nome: { it: 'Pranzo feriale', en: 'Lunch' },
          prezzoAdultoCent: 1,
          prezzoBambinoCent: 1,
        },
        { id: 'f2', codice: 'cena', nome: { it: 'Cena', en: 'Dinner' }, prezzoAdultoCent: 1, prezzoBambinoCent: 1 },
      ],
      propostaId: 'f2',
    });
    await attendi();
    expect((el.querySelector('input[value="f2"]') as HTMLInputElement).checked).toBe(true);
    (el.querySelector('[aria-label="Un adulto in più"]') as HTMLButtonElement).click();
    TestBed.tick();
    expect(el.querySelector('[data-testid="adulti"]')?.textContent).toBe('3');

    (el.querySelector('form.apertura') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await attendi();
    const req = http.expectOne('/api/tavoli/t2/apri');
    expect(req.request.body).toEqual({ formulaId: 'f2', copertiAdulti: 3, copertiBambini: 0 });
    req.flush({ pin: '0427', tavoloId: 't2', seduta: {} });
    await attendi();
    http.expectOne('/api/tavoli').flush([libero(1), libero(2)]);
    await attendi();
    expect(el.querySelector('[data-testid="pin"]')?.textContent).toContain('0427');
  });

  it('reloads the map when a relevant event arrives', async () => {
    vi.useFakeTimers();
    TestBed.createComponent(TavoliPage);
    TestBed.tick();
    http.expectOne('/api/tavoli').flush([libero(1)]);
    realtime.ricarica$.next();
    await vi.advanceTimersByTimeAsync(200);
    http.expectOne('/api/tavoli').flush([libero(1)]);
    vi.useRealTimers();
  });
});
