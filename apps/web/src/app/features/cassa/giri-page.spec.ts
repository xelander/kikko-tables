import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MOTIVI_RIFIUTO } from '@kikko/shared/browser';
import { GiriPage } from './giri-page';
import { attendi, codaProva, giroProva, providersCassa, rispondiStore } from './prova-cassa';

describe('GiriPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [GiriPage], providers: providersCassa() });
    http = TestBed.inject(HttpTestingController);
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  afterEach(() => http.verify());

  async function render(coda = codaProva()) {
    const f = TestBed.createComponent(GiriPage);
    rispondiStore(http, coda);
    await attendi();
    return f.nativeElement as HTMLElement;
  }
  const bottone = (el: Element, testo: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(testo)) as HTMLButtonElement;

  it('shows each round waiting with table, dishes, extras and who sent it', async () => {
    const el = await render();
    const giro = el.querySelector('[data-testid="giro-4"]')!;
    expect(giro.textContent).toContain('Tavolo 4');
    expect(giro.textContent).toContain('Giro 1 · Cena · 3 coperti');
    expect(giro.textContent).toContain('🐼 Anna');
    expect(giro.textContent).toContain('4 piatti');
    expect(giro.textContent).toContain('1 extra');
    const voci = Array.from(giro.querySelectorAll('.voce')).map((v) =>
      Array.from(v.children).map((c) => c.textContent?.trim()),
    );
    expect(voci).toEqual([
      ['4 ×', '46 · Nigiri salmone'],
      ['1 ×', 'Acqua', 'extra'],
    ]);
    expect(giro.textContent).toContain('adesso');
    expect(giro.classList).not.toContain('giro--lungo');
  });

  it('highlights a round waiting for a long time', async () => {
    const el = await render(codaProva([giroProva({ inviatoIl: new Date(Date.now() - 7 * 60_000).toISOString() })]));
    const giro = el.querySelector('[data-testid="giro-4"]')!;
    expect(giro.classList).toContain('giro--lungo');
    expect(giro.textContent).toContain('da 7 min');
  });

  it('approves with one tap', async () => {
    const el = await render();
    bottone(el, 'Approva').click();
    TestBed.tick();
    expect(el.querySelector('[data-testid="coda-vuota"]')).not.toBeNull(); // hidden at once
    http.expectOne({ method: 'POST', url: '/api/giri/g1/approva' }).flush(giroProva({ stato: 'APPROVATO' }));
    await attendi();
    http.expectOne('/api/cassa/giri').flush(codaProva([]));
    await attendi();
  });

  it('rejects with a quick reason or a typed one', async () => {
    const el = await render();
    bottone(el, 'Rifiuta').click();
    TestBed.tick();
    const dialogo = el.querySelector('dialog')!;
    expect(dialogo.open).toBe(true);
    const conferma = bottone(dialogo, 'Rifiuta giro');
    expect(conferma.disabled).toBe(true);

    bottone(dialogo, MOTIVI_RIFIUTO[0]!.it).click();
    TestBed.tick();
    expect(conferma.disabled).toBe(false);
    const testo = dialogo.querySelector('textarea')!;
    testo.value = 'La cucina chiude tra 5 minuti';
    testo.dispatchEvent(new Event('input'));
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
    expect(el.querySelector('[data-testid="coda-vuota"]')?.textContent).toContain('Nessun giro in attesa');
    const recenti = el.querySelector('.recenti')!.textContent!.replace(/\s+/g, ' ');
    expect(recenti).toContain('Tavolo 4 · giro 1 · rifiutato da Capo sala');
    expect(recenti).toContain('“Finito”');
  });
});
