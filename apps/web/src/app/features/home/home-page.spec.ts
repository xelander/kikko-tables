import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { HealthResponse } from '@kikko/shared';
import { HomePage } from './home-page';

describe('HomePage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Renders without waiting for stability: the health request stays pending until flushed. */
  function render() {
    const fixture = TestBed.createComponent(HomePage);
    TestBed.tick();
    return fixture;
  }

  function statusEl(el: HTMLElement): HTMLElement {
    return el.querySelector('[data-testid="api-status"]') as HTMLElement;
  }

  const healthy: HealthResponse = {
    status: 'ok',
    database: 'up',
    version: '1.2.3',
    uptimeSeconds: 5,
    time: '2026-01-01T00:00:00.000Z',
  };

  it('shows the API as online when health is ok', async () => {
    const fixture = render();
    expect(statusEl(fixture.nativeElement).dataset['status']).toBe('loading');

    http.expectOne('/api/health').flush(healthy);
    await fixture.whenStable();

    const status = statusEl(fixture.nativeElement);
    expect(status.dataset['status']).toBe('ok');
    expect(status.textContent).toContain('API online · database connesso');
    expect(status.textContent).toContain('v1.2.3');
    expect(status.querySelector('button')).toBeNull();
  });

  it('shows a degraded state when the database is down (503)', async () => {
    const fixture = render();
    http
      .expectOne('/api/health')
      .flush({ ...healthy, status: 'degraded', database: 'down' }, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();

    const status = statusEl(fixture.nativeElement);
    expect(status.dataset['status']).toBe('degraded');
    expect(status.textContent).toContain('database non raggiungibile');
  });

  it('shows the API offline on network errors and retries on demand', async () => {
    const fixture = render();
    http.expectOne('/api/health').error(new ProgressEvent('error'));
    await fixture.whenStable();

    const status = statusEl(fixture.nativeElement);
    expect(status.dataset['status']).toBe('offline');

    (status.querySelector('button') as HTMLButtonElement).click();
    TestBed.tick();
    http.expectOne('/api/health').flush(healthy);
    await fixture.whenStable();
    expect(statusEl(fixture.nativeElement).dataset['status']).toBe('ok');
  });

  it('links to every area of the app', async () => {
    const fixture = render();
    http.expectOne('/api/health').flush(healthy);
    const links = Array.from(fixture.nativeElement.querySelectorAll('a.area')).map((a) =>
      (a as HTMLAnchorElement).getAttribute('href'),
    );
    expect(links).toEqual(['/t/tavolo-01', '/staff/cameriere', '/staff/cassa', '/admin', '/monitor']);
  });
});
