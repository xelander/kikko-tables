import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { EventoDto, SedutaDettaglioDto, TavoloStato } from '@kikko/shared';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto, menuProva, sessioneProva } from '../../testing/fakes';
import { SedutaPage } from './seduta-page';

function dettaglio(over: Partial<SedutaDettaglioDto> = {}): SedutaDettaglioDto {
  const ora = new Date();
  return {
    sedutaId: 's1',
    ora: ora.toISOString(),
    tavoli: [{ id: 't4', numero: 4, slugQr: 'tavolo-04' }],
    copertiAdulti: 2,
    copertiBambini: 1,
    formula: {
      codice: 'cena',
      nome: { it: 'Cena', en: 'Dinner' },
      piattiPerPersonaPerGiro: 6,
      minutiTraGiri: 10,
      durataMaxMinuti: 150,
      maxGiri: null,
    },
    apertaIl: ora.toISOString(),
    apertaDa: 'Mario',
    minutiExtra: 0,
    scadeIl: new Date(ora.getTime() + 150 * 60_000).toISOString(),
    pinGeneratoIl: ora.toISOString(),
    pin: '0427',
    dispositivi: [
      { id: 'd1', soprannome: 'Anna', emoji: '🐼', staff: false },
      { id: 'd2', soprannome: 'Mario', emoji: '🧑‍🍳', staff: true },
    ],
    carrello: [
      { piattoId: 'p-salmone', dispositivoId: 'd1', quantita: 2 },
      { piattoId: 'p-salmone', dispositivoId: 'd2', quantita: 1 },
    ],
    giri: [
      {
        id: 'g1',
        numero: 1,
        stato: 'INVIATO',
        soloExtra: false,
        inviatoIl: ora.toISOString(),
        motivoRifiuto: null,
        voci: [{ piattoId: 'p-bao', quantita: 2 }],
      },
    ],
    ...over,
  };
}

const tavolo = (numero: number, seduta: TavoloStato['seduta'] = null): TavoloStato => ({
  id: `t${numero}`,
  numero,
  slugQr: `tavolo-${numero}`,
  posti: 4,
  posX: 0,
  posY: 0,
  seduta,
});

describe('SedutaPage', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;
  let ruolo: 'CAMERIERE' | 'CAPO';

  beforeEach(() => {
    ruolo = 'CAMERIERE';
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      imports: [SedutaPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
        {
          provide: StaffAuthService,
          useValue: {
            utente: () => sessioneProva(ruolo).utente,
            sessione: () => sessioneProva(ruolo),
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

  async function render(d = dettaglio()) {
    const f = TestBed.createComponent(SedutaPage);
    f.componentRef.setInput('sedutaId', 's1');
    TestBed.tick();
    http.expectOne('/api/menu').flush(menuProva());
    http.expectOne('/api/sedute/s1').flush(d);
    await attendi();
    return f.nativeElement as HTMLElement;
  }
  const bottone = (el: HTMLElement, testo: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(testo)) as HTMLButtonElement;

  it('shows covers, the shared cart with who added what, rounds and phones', async () => {
    const el = await render();
    expect(el.querySelector('h1')?.textContent).toContain('Tavolo 4');
    expect(el.querySelector('[data-testid="coperti"]')?.textContent).toContain('3');
    expect(el.querySelector('[data-testid="carrello-tavolo"]')?.textContent).toContain('3 × Nigiri salmone');
    expect(el.querySelector('[data-testid="carrello-tavolo"]')?.textContent).toContain('🐼 2 · 🧑‍🍳 1');
    expect(el.querySelector('[data-testid="giri-tavolo"]')?.textContent).toContain('2 × Bao bun');
    expect(el.querySelector('[data-testid="giri-tavolo"]')?.textContent).toContain('In attesa');
    expect(el.textContent).toContain('🐼 Anna');
    expect(el.querySelector('[data-testid="ordina"]')?.getAttribute('href')).toBe('/staff/cameriere/sedute/s1/ordina');
    expect(bottone(el, 'Chiudi tavolo')).toBeUndefined(); // waiters cannot close
  });

  it('always shows the PIN', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="pin-tavolo"]')?.textContent).toContain('0427');
  });

  it('can generate a new PIN after a confirmation, and it replaces the one shown', async () => {
    const conferma = vi.fn(() => true);
    vi.stubGlobal('confirm', conferma);
    const el = await render();
    bottone(el, 'Nuovo PIN').click();
    expect(conferma).toHaveBeenCalledWith(expect.stringContaining('i telefoni già al tavolo restano collegati'));
    await attendi();
    http.expectOne('/api/sedute/s1/pin').flush({ pin: '5521', tavoloId: 't4', seduta: {} });
    await attendi();
    http.expectOne('/api/sedute/s1').flush(dettaglio({ pin: '5521' }));
    await attendi();
    expect(el.querySelector('[data-testid="pin-tavolo"]')?.textContent).toContain('5521');
    expect(el.textContent).toContain('Nuovo PIN: 5521');
    vi.unstubAllGlobals();
  });

  it('changes the covers', async () => {
    const el = await render();
    (el.querySelector('[data-testid="coperti"]') as HTMLButtonElement).click();
    TestBed.tick();
    (el.querySelector('[aria-label="Un adulto in più"]') as HTMLButtonElement).click();
    TestBed.tick();
    bottone(el, 'Salva').click();
    await attendi();
    const req = http.expectOne('/api/sedute/s1/coperti');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ copertiAdulti: 3, copertiBambini: 1 });
    req.flush({});
    await attendi();
    http.expectOne('/api/sedute/s1').flush(dettaglio({ copertiAdulti: 3 }));
    await attendi();
    expect(el.textContent).toContain('Coperti aggiornati.');
  });

  it('moves the table to a free one', async () => {
    const el = await render();
    bottone(el, 'Sposta').click();
    await attendi();
    http.expectOne('/api/tavoli').flush([tavolo(4), tavolo(9)]);
    await attendi();
    const scelte = el.querySelector('[data-testid="tavoli-liberi"]')!;
    (
      Array.from(scelte.querySelectorAll('button')).find((b) => b.textContent?.trim() === '9') as HTMLButtonElement
    ).click();
    await attendi();
    const req = http.expectOne('/api/sedute/s1/sposta');
    expect(req.request.body).toEqual({ daTavoloId: 't4', aTavoloId: 't9' });
    req.flush({});
    await attendi();
    http.expectOne('/api/sedute/s1').flush(dettaglio({ tavoli: [{ id: 't9', numero: 9, slugQr: 'tavolo-09' }] }));
    await attendi();
    expect(el.textContent).toContain('Tavolo spostato al 9.');
  });

  it('offers to merge only open tables with the same formula', async () => {
    const el = await render();
    bottone(el, 'Unisci').click();
    await attendi();
    const base = {
      apertaIl: '',
      scadeIl: '',
      scaduta: false,
      copertiAdulti: 2,
      copertiBambini: 0,
      dispositiviCollegati: 0,
      pin: '1111',
      giriInAttesa: 0,
      pezziNelCarrello: 0,
      ultimoGiroIl: null,
    };
    http.expectOne('/api/tavoli').flush([
      tavolo(5, {
        ...base,
        id: 's5',
        tavoli: [5],
        formula: { id: 'f', codice: 'cena', nome: { it: 'Cena', en: 'Dinner' } },
      }),
      tavolo(6, {
        ...base,
        id: 's6',
        tavoli: [6],
        formula: { id: 'w', codice: 'weekend', nome: { it: 'Weekend', en: 'Weekend' } },
      }),
    ]);
    await attendi();
    expect(el.querySelector('[data-testid="tavoli-unibili"]')?.textContent?.trim()).toBe('5');
  });

  it('follows the session when this table is merged into another one', async () => {
    const naviga = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    const e: EventoDto = {
      seq: 9,
      ts: '',
      tipo: 'TAVOLI_UNITI',
      attore: { ruolo: 'CAMERIERE' },
      sedutaId: 's-principale',
      tavoloId: null,
      payload: { sedutaAssorbitaId: 's1', tavoli: [3, 4] },
    };
    realtime.eventi$.next(e);
    expect(naviga).toHaveBeenCalledWith(['/staff/cameriere/sedute', 's-principale']);
  });
});
