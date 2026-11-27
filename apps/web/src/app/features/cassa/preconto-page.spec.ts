import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { PrecontoDto } from '@kikko/shared';
import { PrecontoPage } from './preconto-page';
import { attendi, codaProva, providersCassa, rispondiStore } from './prova-cassa';

function preconto(over: Partial<PrecontoDto> = {}): PrecontoDto {
  return {
    sedutaId: 's4',
    nomeLocale: 'Kikko',
    valuta: 'EUR',
    tavoli: [4],
    formula: 'Cena',
    apertaIl: '2026-11-27T19:00:00.000Z',
    generatoIl: '2026-11-27T21:00:00.000Z',
    copertiAdulti: 2,
    copertiBambini: 1,
    righe: [
      {
        tipo: 'ADULTI',
        piattoId: null,
        descrizione: 'Cena – adulti',
        quantita: 2,
        prezzoUnitarioCent: 2990,
        totaleCent: 5980,
      },
      {
        tipo: 'BAMBINI',
        piattoId: null,
        descrizione: 'Cena – bambini',
        quantita: 1,
        prezzoUnitarioCent: 1590,
        totaleCent: 1590,
      },
      {
        tipo: 'EXTRA',
        piattoId: 'p-acqua',
        descrizione: 'Acqua',
        quantita: 2,
        prezzoUnitarioCent: 250,
        totaleCent: 500,
      },
    ],
    totaleCent: 8070,
    giriInAttesa: 0,
    ...over,
  };
}

describe('PrecontoPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PrecontoPage], providers: providersCassa() });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  async function render(p = preconto()) {
    const f = TestBed.createComponent(PrecontoPage);
    f.componentRef.setInput('sedutaId', 's4');
    TestBed.tick();
    rispondiStore(http);
    http.expectOne({ method: 'POST', url: '/api/sedute/s4/preconto' }).flush(p);
    await attendi();
    return f.nativeElement as HTMLElement;
  }
  const bottone = (el: Element, testo: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(testo)) as HTMLButtonElement;
  const testo = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ') ?? '';

  it('shows the pre-bill as a non-fiscal document with covers, extras and total', async () => {
    const el = await render();
    const scontrino = el.querySelector('[data-testid="preconto"]')!;
    expect(testo(scontrino)).toContain('PRE-CONTO');
    expect(testo(scontrino)).toContain('Documento non fiscale');
    const dati = Array.from(scontrino.querySelectorAll('dd')).map((d) => testo(d).trim());
    expect(dati.slice(0, 3)).toEqual(['4', 'Cena', '2 adulti + 1 bambino']);
    const righe = Array.from(scontrino.querySelectorAll('tbody tr')).map((r) =>
      Array.from(r.querySelectorAll('td')).map((c) => testo(c).trim()),
    );
    expect(righe).toEqual([
      ['Cena – adulti 29,90 € cad.', '2', '59,80 €'],
      ['Cena – bambini 15,90 € cad.', '1', '15,90 €'],
      ['Acqua 2,50 € cad.', '2', '5,00 €'],
    ]);
    expect(testo(scontrino.querySelector('[data-testid="totale"]'))).toBe('80,70 €');
    expect(el.querySelector('.preconto-avviso')).toBeNull();
  });

  it('warns when rounds are still waiting', async () => {
    const el = await render(preconto({ giriInAttesa: 1 }));
    expect(testo(el.querySelector('.preconto-avviso'))).toContain('1 giro è ancora in attesa');
  });

  it('prints', async () => {
    const stampa = vi.fn();
    vi.stubGlobal('print', stampa);
    const el = await render();
    bottone(el, 'Stampa').click();
    expect(stampa).toHaveBeenCalled();
  });

  it('closes the table after a confirmation and goes back to the tables', async () => {
    const conferma = vi.fn(() => true);
    vi.stubGlobal('confirm', conferma);
    const naviga = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const el = await render(preconto({ giriInAttesa: 2 }));
    bottone(el, 'Chiudi tavolo').click();
    expect(conferma).toHaveBeenCalledWith(expect.stringContaining('ci sono 2 giri ancora da approvare'));
    http.expectOne({ method: 'POST', url: '/api/sedute/s4/chiudi' }).flush(null);
    await attendi();
    // The till reloads its queue and tables, so the closed table disappears.
    http.expectOne('/api/cassa/giri').flush(codaProva([]));
    http.expectOne('/api/tavoli').flush([]);
    await attendi();
    expect(naviga).toHaveBeenCalledWith(['/staff/cassa/tavoli']);
  });
});
