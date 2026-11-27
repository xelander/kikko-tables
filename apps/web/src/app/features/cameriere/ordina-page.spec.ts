import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { RealtimeFinto, menuProva, sedutaProva, sessioneProva } from '../../testing/fakes';
import { OrdinaPage } from './ordina-page';

describe('OrdinaPage (waiter orders for a table)', () => {
  let http: HttpTestingController;
  let realtime: RealtimeFinto;

  beforeEach(() => {
    localStorage.clear();
    realtime = new RealtimeFinto();
    TestBed.configureTestingModule({
      imports: [OrdinaPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ sedutaId: 's7' }) } } },
        { provide: StaffAuthService, useValue: { utente: () => sessioneProva().utente, accessToken: () => 'x' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(I18nService).imposta('it');
  });

  afterEach(() => vi.useRealTimers());

  it('uses the staff endpoints of the session and goes back to the table', async () => {
    const naviga = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const f = TestBed.createComponent(OrdinaPage);
    TestBed.tick();
    expect(realtime.avviato).toEqual({ modo: 'staff', chiave: 'id-CAMERIERE' });
    http.expectOne('/api/menu').flush(menuProva());
    http.expectOne('/api/sedute/s7/sala').flush(sedutaProva({ io: { id: 'cam', soprannome: 'Mario', emoji: '🧑‍🍳' } }));
    await new Promise((r) => setTimeout(r, 0));
    TestBed.tick();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Ordine per conto del tavolo');

    vi.useFakeTimers();
    (el.querySelector('[aria-label="Aggiungi Nigiri salmone"]') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/sedute/s7/carrello/p-salmone');
    expect(req.request.body).toEqual({ quantita: 1 });
    req.flush([{ piattoId: 'p-salmone', dispositivoId: 'cam', quantita: 1 }]);
    vi.useRealTimers();

    (el.querySelector('.testata__indietro') as HTMLButtonElement).click();
    expect(naviga).toHaveBeenCalledWith(['/staff/cameriere/sedute', 's7']);
  });
});
