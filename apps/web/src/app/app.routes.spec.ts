import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

describe('app routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding()), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('every top-level route except home is lazy loaded', () => {
    for (const route of routes) {
      expect(route.component).toBeUndefined();
      expect(route.loadComponent ?? route.loadChildren).toBeDefined();
    }
  });

  it.each([
    ['/t/tavolo-07', 'Tavolo tavolo-07', 'F2'],
    ['/staff/cameriere', 'Cameriere', 'F3'],
    ['/staff/cassa', 'Cassa', 'F4'],
    ['/admin', 'Amministratore', 'F5'],
    ['/monitor', 'Monitor', 'F6'],
    ['/non-esiste', 'Pagina non trovata', '404'],
  ])('%s renders its placeholder', async (url, heading, phase) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe(heading);
    expect(el.textContent).toContain(phase);
  });
});
