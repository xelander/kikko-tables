import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { sessioneProva } from '../../testing/fakes';
import { StaffAuthService } from './staff-auth.service';

describe('StaffAuthService', () => {
  let http: HttpTestingController;
  let auth: StaffAuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(StaffAuthService);
  });

  afterEach(() => {
    http.verify();
    auth.ngOnDestroy();
  });

  const flushPending = () => new Promise((r) => setTimeout(r, 0));

  it('restores the session from the refresh cookie after a reload', async () => {
    const promessa = auth.assicura();
    await flushPending();
    http.expectOne({ method: 'POST', url: '/api/auth/refresh' }).flush(sessioneProva());
    expect((await promessa)?.utente.ruolo).toBe('CAMERIERE');
    expect(auth.accessToken()).toBe('token-CAMERIERE');
    expect(await auth.assicura()).not.toBeNull(); // no second request
  });

  it('shares one refresh between concurrent callers', async () => {
    const a = auth.rinnova();
    const b = auth.rinnova();
    await flushPending();
    http.expectOne('/api/auth/refresh').flush(sessioneProva());
    expect(await a).toEqual(await b);
  });

  it('returns null when there is no valid session', async () => {
    const promessa = auth.assicura();
    await flushPending();
    http
      .expectOne('/api/auth/refresh')
      .flush({ codice: 'SESSIONE_SCADUTA' }, { status: 401, statusText: 'Unauthorized' });
    expect(await promessa).toBeNull();
    expect(auth.autenticato()).toBe(false);
  });

  it('retries once when another tab refreshed at the same time (409)', async () => {
    const promessa = auth.rinnova();
    await flushPending();
    http.expectOne('/api/auth/refresh').flush({ codice: 'RIPROVA' }, { status: 409, statusText: 'Conflict' });
    await flushPending();
    http.expectOne('/api/auth/refresh').flush(sessioneProva('CAPO'));
    expect((await promessa)?.utente.ruolo).toBe('CAPO');
  });

  it('keeps the session on network errors', async () => {
    const login = auth.login({ username: 'mario', password: 'mario' });
    http.expectOne('/api/auth/login').flush(sessioneProva());
    await login;
    const promessa = auth.rinnova();
    await flushPending();
    http.expectOne('/api/auth/refresh').error(new ProgressEvent('error'));
    expect(await promessa).not.toBeNull();
    expect(auth.autenticato()).toBe(true);
  });

  it('logout clears the session even if the server is unreachable', async () => {
    const login = auth.login({ username: 'mario', password: 'mario' });
    http.expectOne('/api/auth/login').flush(sessioneProva());
    await login;
    const out = auth.logout();
    http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));
    await out;
    expect(auth.autenticato()).toBe(false);
  });
});
