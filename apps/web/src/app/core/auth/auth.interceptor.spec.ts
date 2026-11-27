import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { sessioneProva } from '../../testing/fakes';
import { authInterceptor } from './auth.interceptor';
import { StaffAuthService } from './staff-auth.service';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let token: string | null;
  const rinnova = vi.fn();

  beforeEach(() => {
    token = 'vecchio';
    rinnova.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: StaffAuthService, useValue: { accessToken: () => token, rinnova } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => http.verify());

  it('adds the staff token to API calls', () => {
    void firstValueFrom(client.get('/api/tavoli'));
    expect(http.expectOne('/api/tavoli').request.headers.get('Authorization')).toBe('Bearer vecchio');
  });

  it.each(['/api/t/tavolo-01', '/api/auth/refresh', '/api/auth/login', '/assets/x.json'])(
    'does not add it to %s',
    (url) => {
      void firstValueFrom(client.get(url));
      expect(http.expectOne(url).request.headers.has('Authorization')).toBe(false);
    },
  );

  it('renews an expired token once and retries the request', async () => {
    rinnova.mockResolvedValue({ ...sessioneProva(), accessToken: 'nuovo' });
    const risposta = firstValueFrom(client.get('/api/tavoli'));
    http.expectOne('/api/tavoli').flush({}, { status: 401, statusText: 'Unauthorized' });
    await new Promise((r) => setTimeout(r, 0));
    const retry = http.expectOne('/api/tavoli');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer nuovo');
    retry.flush([1]);
    expect(await risposta).toEqual([1]);
  });

  it('gives up when the session cannot be renewed', async () => {
    rinnova.mockResolvedValue(null);
    const risposta = firstValueFrom(client.get('/api/tavoli'));
    http.expectOne('/api/tavoli').flush({}, { status: 401, statusText: 'Unauthorized' });
    await expect(risposta).rejects.toMatchObject({ status: 401 });
  });
});
