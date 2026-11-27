import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { SedutaRiepilogo, TavoloStato } from '@kikko/shared';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto, sessioneProva } from '../../testing/fakes';
import { TavoliPage, filtraTavoli, statoTavolo } from './tavoli-page';
import { tempoRimanente } from './tempo';

const libero = (numero: number): TavoloStato => ({
  id: `t${numero}`,
  numero,
  slugQr: `tavolo-${String(numero).padStart(2, '0')}`,
  posti: 4,
  posX: 0,
  posY: 0,
  seduta: null,
});

function aperto(numero: number, over: Partial<SedutaRiepilogo> = {}, ora = Date.now()): TavoloStato {
  return {
    ...libero(numero),
    seduta: {
      id: `s${numero}`,
      apertaIl: new Date(ora).toISOString(),
      scadeIl: new Date(ora + 90 * 60_000).toISOString(),
      scaduta: false,
      copertiAdulti: 2,
      copertiBambini: 1,
      formula: { id: 'f', codice: 'cena', nome: { it: 'Cena', en: 'Dinner' } },
      dispositiviCollegati: 2,
      tavoli: [numero],
      giriInAttesa: 0,
      pezziNelCarrello: 0,
      ultimoGiroIl: null,
      ...over,
    },
  };
}

describe('table helpers', () => {
  it('formats the time left', () => {
    expect(tempoRimanente(-1)).toBe('scaduto');
    expect(tempoRimanente(12 * 60_000)).toBe('12 min');
    expect(tempoRimanente(65 * 60_000)).toBe('1 h 05 min');
  });

  it('derives the table state from the server deadline', () => {
    const ora = Date.parse('2026-11-27T20:00:00Z');
    const conScadenza = (min: number) => aperto(1, { scadeIl: new Date(ora + min * 60_000).toISOString() });
    expect(statoTavolo(libero(1), ora)).toBe('libero');
    expect(statoTavolo(conScadenza(60), ora)).toBe('aperto');
    expect(statoTavolo(conScadenza(10), ora)).toBe('quasi-scaduto');
    expect(statoTavolo(conScadenza(-1), ora)).toBe('scaduto');
  });

  it('filters by state and searches by number', () => {
    const tavoli = [libero(1), aperto(2), aperto(12, { giriInAttesa: 1 }), libero(21)];
    expect(filtraTavoli(tavoli, 'aperti', '').map((t) => t.numero)).toEqual([2, 12]);
    expect(filtraTavoli(tavoli, 'liberi', '').map((t) => t.numero)).toEqual([1, 21]);
    expect(filtraTavoli(tavoli, 'attesa', '').map((t) => t.numero)).toEqual([12]);
    expect(filtraTavoli(tavoli, 'tutti', '2').map((t) => t.numero)).toEqual([2, 21]);
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
            utente: () => sessioneProva('CAMERIERE').utente,
            sessione: () => sessioneProva(),
            accessToken: () => 'x',
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
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

  it('lists the tables with covers, phones, cart and rounds waiting, with filters', async () => {
    const f = TestBed.createComponent(TavoliPage);
    TestBed.tick();
    http
      .expectOne('/api/tavoli')
      .flush([libero(1), aperto(2, { pezziNelCarrello: 3, giriInAttesa: 1, tavoli: [2, 3] }), libero(4)]);
    await attendi();
    const el = f.nativeElement as HTMLElement;
    const riga = el.querySelector('[data-testid="tavolo-2"]')!;
    expect(riga.textContent).toContain('Cena · 3 coperti');
    expect(riga.textContent).toContain('uniti 2+3');
    expect(riga.textContent).toContain('📱 2');
    expect(riga.textContent).toContain('🛒 3');
    expect(riga.textContent).toContain('1 giro');

    (
      Array.from(el.querySelectorAll('.filtro')).find((b) => b.textContent?.includes('Liberi')) as HTMLButtonElement
    ).click();
    TestBed.tick();
    expect(Array.from(el.querySelectorAll('.riga__numero')).map((n) => n.textContent?.trim())).toEqual(['1', '4']);
  });

  it('goes to the table page when an open table is tapped', async () => {
    const naviga = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(TavoliPage);
    TestBed.tick();
    http.expectOne('/api/tavoli').flush([aperto(2)]);
    await attendi();
    (f.nativeElement.querySelector('[data-testid="tavolo-2"]') as HTMLButtonElement).click();
    await attendi();
    expect(naviga).toHaveBeenCalledWith(['/staff/cameriere/sedute', 's2']);
  });

  it('opens a free table, shows the PIN and goes to the table', async () => {
    const naviga = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(TavoliPage);
    TestBed.tick();
    http.expectOne('/api/tavoli').flush([libero(1), libero(2)]);
    await attendi();
    const el = f.nativeElement as HTMLElement;

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
    (el.querySelector('form.apertura') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await attendi();
    const req = http.expectOne('/api/tavoli/t2/apri');
    expect(req.request.body).toEqual({ formulaId: 'f2', copertiAdulti: 3, copertiBambini: 0 });
    req.flush({ pin: '0427', tavoloId: 't2', seduta: { id: 's-nuova' } });
    await attendi();
    http.expectOne('/api/tavoli').flush([libero(1), aperto(2)]);
    await attendi();
    expect(el.querySelector('[data-testid="pin"]')?.textContent).toContain('0427');

    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Vai al tavolo'),
      ) as HTMLButtonElement
    ).click();
    await attendi();
    expect(naviga).toHaveBeenCalledWith(['/staff/cameriere/sedute', 's-nuova']);
  });

  it('reloads the list when a relevant event arrives', async () => {
    vi.useFakeTimers();
    TestBed.createComponent(TavoliPage);
    TestBed.tick();
    http.expectOne('/api/tavoli').flush([libero(1)]);
    realtime.ricarica$.next();
    await vi.advanceTimersByTimeAsync(250);
    http.expectOne('/api/tavoli').flush([libero(1)]);
    vi.useRealTimers();
  });
});
