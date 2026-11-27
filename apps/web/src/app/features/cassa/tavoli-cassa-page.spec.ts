import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TavoliCassaPage } from './tavoli-cassa-page';
import { attendi, codaProva, providersCassa, rispondiStore, tavoloAperto } from './prova-cassa';

describe('TavoliCassaPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TavoliCassaPage], providers: providersCassa() });
    http = TestBed.inject(HttpTestingController);
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  afterEach(() => http.verify());

  const passato = () => new Date(Date.now() - 5 * 60_000).toISOString();
  const tavoli = () => [
    tavoloAperto(4),
    tavoloAperto(9, { scadeIl: passato(), giriInAttesa: 1 }),
    { ...tavoloAperto(2), seduta: null },
  ];

  async function render() {
    const f = TestBed.createComponent(TavoliCassaPage);
    rispondiStore(http, codaProva([]), tavoli());
    await attendi();
    return f.nativeElement as HTMLElement;
  }
  const bottone = (el: Element, testo: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(testo)) as HTMLButtonElement;

  it('lists the open tables, expired first, with time left and links to the pre-bill', async () => {
    const el = await render();
    const righe = Array.from(el.querySelectorAll('.tavolo'));
    expect(righe.map((r) => r.getAttribute('data-testid'))).toEqual(['cassa-tavolo-9', 'cassa-tavolo-4']);
    expect(righe[0]!.getAttribute('data-stato')).toBe('scaduto');
    expect(righe[0]!.textContent).toContain('Tempo scaduto');
    expect(righe[0]!.textContent).toContain('1 giro in attesa');
    expect(righe[1]!.textContent).toContain('1 h 30 min');
    expect(righe[1]!.querySelector('a.bottone--primario')?.getAttribute('href')).toBe(
      '/staff/cassa/sedute/s4/preconto',
    );
  });

  it('gives extra minutes to one table', async () => {
    const el = await render();
    bottone(el.querySelector('[data-testid="cassa-tavolo-9"]')!, '+15').click();
    const req = http.expectOne('/api/sedute/s9/tempo');
    expect(req.request.body).toEqual({ minuti: 15 });
    req.flush({ sedutaId: 's9', minutiExtra: 15, scadeIl: new Date().toISOString() });
    await attendi();
    http.expectOne('/api/tavoli').flush(tavoli());
    await attendi();
    expect(el.querySelector('.messaggio')?.textContent).toContain('+15 min al tavolo 9');
  });

  it('extends every open table after a confirmation', async () => {
    const el = await render();
    bottone(el, 'Estendi tempo a tutti').click();
    TestBed.tick();
    const dialogo = el.querySelector('dialog')!;
    expect(dialogo.open).toBe(true);
    expect(dialogo.textContent).toContain('Vale per i 2 tavoli aperti');
    bottone(dialogo, '30 min').click();
    TestBed.tick();
    bottone(dialogo, 'Aggiungi 30 min a tutti').click();
    const req = http.expectOne('/api/cassa/estendi-tutti');
    expect(req.request.body).toEqual({ minuti: 30 });
    req.flush({ sedute: 2 });
    await attendi();
    http.expectOne('/api/tavoli').flush(tavoli());
    await attendi();
    expect(el.querySelector('.messaggio')?.textContent).toContain('+30 min a 2 tavoli aperti');
  });
});
