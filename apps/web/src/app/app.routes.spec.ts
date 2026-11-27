import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SessioneStaff } from '@kikko/shared';
import { routes } from './app.routes';
import { StaffAuthService } from './core/auth/staff-auth.service';
import { RealtimeService } from './core/realtime/realtime.service';
import { RealtimeFinto, sessioneProva } from './testing/fakes';

describe('app routes', () => {
  let sessione: SessioneStaff | null;

  beforeEach(() => {
    sessione = null;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: new RealtimeFinto() },
        {
          provide: StaffAuthService,
          useValue: {
            assicura: async () => sessione,
            utente: () => sessione?.utente ?? null,
            sessione: () => sessione,
            accessToken: () => sessione?.accessToken ?? null,
            infoDispositivo: async () => ({ registrato: false, nome: null, utenti: [] }),
          },
        },
      ],
    });
  });

  it('every top-level route is lazy loaded', () => {
    for (const route of routes) {
      expect(route.component).toBeUndefined();
      expect(route.loadComponent ?? route.loadChildren).toBeDefined();
    }
  });

  it.each(['/staff/cameriere', '/staff/cassa', '/admin', '/monitor'])(
    '%s sends anonymous users to the login, remembering the page',
    async (url) => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);
      expect(TestBed.inject(Router).url).toBe(`/staff/login?torna=${encodeURIComponent(url)}`);
    },
  );

  it.each([
    ['/admin', 'Amministratore', 'F5'],
    ['/monitor', 'Monitor', 'F6'],
    ['/non-esiste', 'Pagina non trovata', '404'],
  ])('%s renders its placeholder for an admin', async (url, heading, phase) => {
    sessione = sessioneProva('ADMIN');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe(heading);
    expect(el.textContent).toContain(phase);
  });

  it('opens the till (rounds queue) for the manager, with its tabs', async () => {
    sessione = sessioneProva('CAPO');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/staff/cassa');
    const el = harness.fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-cassa-layout app-giri-page')).not.toBeNull();
    expect(Array.from(el.querySelectorAll('.schede a')).map((a) => a.textContent?.trim())).toEqual([
      'Giri',
      'Tavoli',
      'Esauriti',
    ]);
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('redirects a waiter away from areas of other roles', async () => {
    sessione = sessioneProva('CAMERIERE');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toBe('/staff/cameriere');
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('the customer route needs no login', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/t/tavolo-07');
    expect(TestBed.inject(Router).url).toBe('/t/tavolo-07');
    TestBed.inject(HttpTestingController).expectOne('/api/t/tavolo-07');
  });
});
