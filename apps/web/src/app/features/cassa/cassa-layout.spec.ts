import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { sessioneProva } from '../../testing/fakes';
import { CassaLayout } from './cassa-layout';
import { CHIAVE_SUONI } from './cassa.store';
import { attendi, codaProva, giroProva, providersCassa, rispondiStore, tavoloAperto } from './prova-cassa';

describe('CassaLayout', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [CassaLayout],
      providers: [
        ...providersCassa(),
        {
          provide: StaffAuthService,
          useValue: { utente: () => sessioneProva('CAPO').utente, sessione: () => sessioneProva('CAPO') },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render() {
    const f = TestBed.createComponent(CassaLayout);
    TestBed.tick();
    rispondiStore(http, codaProva([giroProva(), giroProva({ id: 'g2' })]), [
      tavoloAperto(4),
      tavoloAperto(6, { scadeIl: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    await attendi();
    return f.nativeElement as HTMLElement;
  }

  it('counts the rounds waiting and raises the expired-time alarm', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid="badge-giri"]')?.textContent?.trim()).toBe('2');
    expect(el.querySelector('[data-testid="allarme-scaduti"]')?.textContent).toContain('Tempo scaduto: Tavolo 6');
  });

  it('links the hall and the till for the manager', async () => {
    const el = await render();
    const aree = Array.from(el.querySelectorAll('.barra__aree a')).map((a) => a.getAttribute('href'));
    expect(aree).toEqual(['/staff/cameriere', '/staff/cassa']);
  });

  it('turns sounds on and remembers it on this tablet', async () => {
    const el = await render();
    const suoni = el.querySelector('[data-testid="suoni"]') as HTMLButtonElement;
    expect(suoni.textContent).toContain('Attiva suoni');
    suoni.click();
    TestBed.tick();
    expect(suoni.textContent).toContain('Suoni attivi');
    expect(localStorage.getItem(CHIAVE_SUONI)).toBe('1');
  });
});
