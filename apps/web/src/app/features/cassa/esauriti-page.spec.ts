import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PiattoCassaDto } from '@kikko/shared';
import { RealtimeFinto } from '../../testing/fakes';
import { EsauritiPage } from './esauriti-page';
import { attendi, providersCassa } from './prova-cassa';

const piatti = (): PiattoCassaDto[] => [
  { id: 'p-salmone', numero: '46', nome: 'Nigiri salmone', categoria: 'Nigiri', inFormula: true, disponibile: true },
  { id: 'p-bao', numero: '113', nome: 'Bao bun', categoria: 'Bao', inFormula: true, disponibile: false },
  { id: 'p-acqua', numero: null, nome: 'Acqua', categoria: 'Bevande', inFormula: false, disponibile: true },
];

describe('EsauritiPage', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;

  beforeEach(() => {
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({ imports: [EsauritiPage], providers: providersCassa(realtime) });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render() {
    const f = TestBed.createComponent(EsauritiPage);
    http.expectOne('/api/cassa/piatti').flush(piatti());
    await attendi();
    return f.nativeElement as HTMLElement;
  }
  const interruttore = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="disponibile-${id}"]`) as HTMLButtonElement;
  const nomi = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('.piatto__nome')).map((n) => n.textContent?.trim().replace(/\s+/g, ' '));

  it('lists the dishes by category with their state', async () => {
    const el = await render();
    expect(Array.from(el.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Nigiri', 'Bao', 'Bevande']);
    expect(interruttore(el, '46').getAttribute('aria-checked')).toBe('true');
    expect(interruttore(el, '113').getAttribute('aria-checked')).toBe('false');
    expect(interruttore(el, '113').textContent).toContain('Esaurito');
  });

  it('marks a dish sold out at once, and switches it back if the server refuses', async () => {
    const el = await render();
    interruttore(el, '46').click();
    TestBed.tick();
    expect(interruttore(el, '46').getAttribute('aria-checked')).toBe('false');
    const req = http.expectOne('/api/piatti/p-salmone/disponibilita');
    expect(req.request.body).toEqual({ disponibile: false });
    req.flush({ codice: 'X' }, { status: 500, statusText: 'Error' });
    await attendi();
    expect(interruttore(el, '46').getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.errore')).not.toBeNull();
  });

  it('searches by number or name and filters the sold-out ones', async () => {
    const el = await render();
    const cerca = el.querySelector('input') as HTMLInputElement;
    cerca.value = '11';
    cerca.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(nomi(el)).toEqual(['113 Bao bun']);
    cerca.value = 'acq';
    cerca.dispatchEvent(new Event('input'));
    TestBed.tick();
    expect(nomi(el)).toEqual(['Acqua extra']);
    cerca.value = '';
    cerca.dispatchEvent(new Event('input'));
    (
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Solo esauriti')) as HTMLElement
    ).click();
    TestBed.tick();
    expect(nomi(el)).toEqual(['113 Bao bun']);
  });

  it('follows the changes made from another tablet', async () => {
    const el = await render();
    realtime.eventi$.next({
      seq: 1,
      ts: '',
      tipo: 'PIATTO_RIPRISTINATO',
      attore: { ruolo: 'CAPO' },
      sedutaId: null,
      tavoloId: null,
      payload: { piattoId: 'p-bao' },
    });
    TestBed.tick();
    expect(interruttore(el, '113').getAttribute('aria-checked')).toBe('true');
  });
});
