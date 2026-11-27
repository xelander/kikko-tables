import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { sessioneProva } from '../../testing/fakes';
import { LoginPage, messaggioErrore } from './login-page';

describe('LoginPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const attendi = async () => {
    await new Promise((r) => setTimeout(r, 0));
    TestBed.tick();
  };

  it('on a shared device lets staff pick their name and type the PIN', async () => {
    const naviga = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const f = TestBed.createComponent(LoginPage);
    TestBed.tick();
    http.expectOne('/api/auth/dispositivo').flush({
      registrato: true,
      nome: 'Tablet cassa',
      utenti: [{ id: 'u-mario', nome: 'Mario', ruolo: 'CAMERIERE' }],
    });
    await attendi();
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Dispositivo: Tablet cassa');

    (el.querySelector('button.utente') as HTMLButtonElement).click();
    TestBed.tick();
    for (const c of '1234') {
      (
        Array.from(el.querySelectorAll('button.tasto')).find((b) => b.textContent?.trim() === c) as HTMLButtonElement
      ).click();
    }
    TestBed.tick();
    expect(el.querySelectorAll('.pin__punto--pieno')).toHaveLength(4);
    (el.querySelector('button.primario') as HTMLButtonElement).click();
    const req = http.expectOne('/api/auth/pin');
    expect(req.request.body).toEqual({ utenteId: 'u-mario', pin: '1234' });
    req.flush(sessioneProva());
    await attendi();
    expect(naviga).toHaveBeenCalledWith('/staff/cameriere');
  });

  it('shows the password form on a personal device', async () => {
    const f = TestBed.createComponent(LoginPage);
    TestBed.tick();
    http.expectOne('/api/auth/dispositivo').flush({ registrato: false, nome: null, utenti: [] });
    await attendi();
    expect((f.nativeElement as HTMLElement).querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  });

  it('explains login errors', () => {
    const err = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });
    expect(messaggioErrore(err(401), 'pin')).toBe('PIN errato.');
    expect(messaggioErrore(err(401), 'password')).toBe('Username o password errati.');
    expect(messaggioErrore(err(429, { riprovaTraSecondi: 120 }), 'pin')).toContain('120 secondi');
    expect(messaggioErrore(err(0), 'pin')).toBe('Nessuna connessione con il server.');
  });
});
