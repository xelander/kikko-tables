import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MOTIVI_RIFIUTO } from '@kikko/shared/browser';
import { RealtimeFinto } from '../../testing/fakes';
import { CHIAVE_CARICATI } from './cassa.store';
import { GiriPage } from './giri-page';
import { attendi, codaProva, giroProva, providersCassa, rispondiStore } from './prova-cassa';

const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
/** Two rounds waiting: table 4 (oldest) and table 9. */
const dueGiri = () =>
  codaProva([
    giroProva({ inviatoIl: minutiFa(3) }),
    giroProva({
      id: 'g9',
      sedutaId: 's9',
      tavoli: [9],
      inviatoIl: minutiFa(1),
      voci: [{ piattoId: 'p-bao', quantita: 2, inFormula: true }],
    }),
  ]);

describe('GiriPage', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;

  beforeEach(() => {
    localStorage.clear();
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({ imports: [GiriPage], providers: providersCassa(realtime) });
    http = TestBed.inject(HttpTestingController);
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  afterEach(() => http.verify());

  async function render(coda = dueGiri()) {
    const f = TestBed.createComponent(GiriPage);
    rispondiStore(http, coda);
    await attendi();
    return f.nativeElement as HTMLElement;
  }
  const bottone = (el: Element, testo: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(testo)) as HTMLButtonElement;
  const dettaglio = (el: HTMLElement) => el.querySelector('[data-testid="dettaglio-giro"]');
  const testo = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('opens the oldest round in the detail by itself, ready to be typed into the cash register', async () => {
    const el = await render();
    const d = dettaglio(el)!;
    expect(testo(d.querySelector('h1'))).toBe('Tavolo 4');
    expect(testo(d)).toContain('Giro 1 · Cena · 3 coperti · 🐼 Anna');
    expect(testo(d.querySelector('[data-testid="progresso-caricati"]'))).toContain('Caricati 0 di 2');
    const righe = Array.from(d.querySelectorAll('.carico__riga')).map((r) =>
      Array.from(r.children).map((c) => testo(c)),
    );
    expect(righe).toEqual([
      ['4 ×', '46 · Nigiri salmone', 'Caricato?'],
      ['1 ×', 'Acqua extra', 'Caricato?'],
    ]);
    // The other round waits, one tap away.
    expect(testo(d.querySelector('.altri'))).toContain('Tavolo 9 · da 1 min');
  });

  it('ticks a dish as loaded (and back), remembering it on this tablet', async () => {
    const el = await render();
    const salmone = el.querySelector('[data-testid="carica-p-salmone"]') as HTMLButtonElement;
    salmone.click();
    TestBed.tick();
    expect(salmone.getAttribute('aria-pressed')).toBe('true');
    expect(testo(salmone)).toContain('✓ Caricato');
    expect(testo(el.querySelector('[data-testid="progresso-caricati"]'))).toContain('Caricati 1 di 2');
    expect(JSON.parse(localStorage.getItem(CHIAVE_CARICATI)!)).toEqual({ g1: ['p-salmone'] });

    (el.querySelector('[data-testid="carica-p-acqua"]') as HTMLButtonElement).click();
    TestBed.tick();
    expect(testo(el.querySelector('[data-testid="progresso-caricati"]'))).toContain('✓ tutto in cassa');

    salmone.click();
    TestBed.tick();
    expect(salmone.getAttribute('aria-pressed')).toBe('false');
    expect(testo(el.querySelector('[data-testid="progresso-caricati"]'))).toContain('Caricati 1 di 2');
  });

  it('after approving, the next round opens by itself', async () => {
    const el = await render();
    bottone(dettaglio(el)!, 'Approva').click();
    TestBed.tick();
    expect(testo(dettaglio(el)!.querySelector('h1'))).toBe('Tavolo 9');
    http.expectOne({ method: 'POST', url: '/api/giri/g1/approva' }).flush(giroProva({ stato: 'APPROVATO' }));
    await attendi();
    http.expectOne('/api/cassa/giri').flush(codaProva([dueGiri().inAttesa[1]!]));
    await attendi();
    expect(testo(dettaglio(el)!.querySelector('h1'))).toBe('Tavolo 9');
  });

  it('rejects with a quick reason or a typed one', async () => {
    const el = await render();
    bottone(dettaglio(el)!, 'Rifiuta').click();
    TestBed.tick();
    const dialogo = el.querySelector('dialog')!;
    expect(dialogo.open).toBe(true);
    const conferma = bottone(dialogo, 'Rifiuta giro');
    expect(conferma.disabled).toBe(true);

    bottone(dialogo, MOTIVI_RIFIUTO[0]!.it).click();
    TestBed.tick();
    expect(conferma.disabled).toBe(false);
    const area = dialogo.querySelector('textarea')!;
    area.value = 'La cucina chiude tra 5 minuti';
    area.dispatchEvent(new Event('input'));
    TestBed.tick();
    conferma.click();
    const req = http.expectOne('/api/giri/g1/rifiuta');
    expect(req.request.body).toEqual({ motivo: 'La cucina chiude tra 5 minuti' });
    req.flush(giroProva({ stato: 'RIFIUTATO' }));
    await attendi();
    http.expectOne('/api/cassa/giri').flush(codaProva([]));
    await attendi();
    expect(dialogo.open).toBe(false);
  });

  it('goes back to the queue, and opens the detail again when a new round arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      const el = await (async () => {
        const f = TestBed.createComponent(GiriPage);
        rispondiStore(http, codaProva([giroProva({ inviatoIl: minutiFa(7) })]));
        await vi.advanceTimersByTimeAsync(0);
        TestBed.tick();
        return f.nativeElement as HTMLElement;
      })();
      bottone(dettaglio(el)!, 'Tutti i giri').click();
      TestBed.tick();
      expect(dettaglio(el)).toBeNull();
      const card = el.querySelector('[data-testid="giro-4"]')!;
      expect(card.classList).toContain('giro--lungo');
      expect(testo(card)).toContain('da 7 min');
      expect(testo(card)).toContain('4 piatti');

      realtime.eventi$.next({
        seq: 2,
        ts: '',
        tipo: 'GIRO_INVIATO',
        attore: { ruolo: 'CLIENTE' },
        sedutaId: 's9',
        tavoloId: null,
        payload: {},
      });
      await vi.advanceTimersByTimeAsync(200);
      http.expectOne('/api/cassa/giri').flush(dueGiri());
      http.expectOne('/api/tavoli').flush([]);
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();
      expect(dettaglio(el)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an empty queue and the rounds handled recently', async () => {
    const el = await render(
      codaProva(
        [],
        [
          giroProva({
            stato: 'RIFIUTATO',
            gestitoDa: 'Capo sala',
            gestitoIl: new Date().toISOString(),
            motivoRifiuto: 'Finito',
          }),
        ],
      ),
    );
    expect(dettaglio(el)).toBeNull();
    expect(el.querySelector('[data-testid="coda-vuota"]')?.textContent).toContain('Nessun giro in attesa');
    const recenti = testo(el.querySelector('.recenti'));
    expect(recenti).toContain('Tavolo 4 · giro 1 · rifiutato da Capo sala');
    expect(recenti).toContain('“Finito”');
  });
});
