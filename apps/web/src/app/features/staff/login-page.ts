import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { DispositivoCondivisoInfo, SessioneStaff } from '@kikko/shared';
import { paginaIniziale } from '../../core/auth/staff.guard';
import { StaffAuthService } from '../../core/auth/staff-auth.service';

type Utente = DispositivoCondivisoInfo['utenti'][number];

export function messaggioErrore(error: unknown, credenziali: 'password' | 'pin'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 429) {
      const secondi = (error.error as { riprovaTraSecondi?: number } | null)?.riprovaTraSecondi ?? 60;
      return `Troppi tentativi: riprova tra ${secondi} secondi.`;
    }
    if (error.status === 401) return credenziali === 'pin' ? 'PIN errato.' : 'Username o password errati.';
    if (error.status === 0) return 'Nessuna connessione con il server.';
  }
  return 'Accesso non riuscito, riprova.';
}

/**
 * Staff login (decision 14.5): on a registered shared device staff pick their name and type their
 * personal PIN; otherwise (or on request) username and password.
 */
@Component({
  selector: 'app-login-page',
  imports: [FormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly auth = inject(StaffAuthService);
  private readonly router = inject(Router);

  /** Where to go back after login (query param set by the guard). */
  readonly torna = input<string | undefined>();

  protected readonly dispositivo = signal<DispositivoCondivisoInfo | null>(null);
  protected readonly modoPassword = signal(false);
  protected readonly scelto = signal<Utente | null>(null);
  protected readonly pin = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly errore = signal<string | null>(null);
  protected readonly invio = signal(false);
  protected readonly cifre = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  constructor() {
    void this.caricaDispositivo();
  }

  protected scegli(utente: Utente | null): void {
    this.scelto.set(utente);
    this.pin.set('');
    this.errore.set(null);
  }

  protected tasto(cifra: string): void {
    if (this.pin().length >= 6 || this.invio()) return;
    this.pin.update((p) => p + cifra);
    this.errore.set(null);
  }

  protected cancella(): void {
    this.pin.update((p) => p.slice(0, -1));
  }

  protected async entraConPin(): Promise<void> {
    const utente = this.scelto();
    if (!utente || this.pin().length < 4) return;
    await this.esegui(() => this.auth.loginPin({ utenteId: utente.id, pin: this.pin() }), 'pin');
    this.pin.set('');
  }

  protected async entraConPassword(): Promise<void> {
    if (!this.username() || !this.password()) return;
    await this.esegui(() => this.auth.login({ username: this.username(), password: this.password() }), 'password');
  }

  private async esegui(azione: () => Promise<SessioneStaff>, tipo: 'password' | 'pin'): Promise<void> {
    this.invio.set(true);
    this.errore.set(null);
    try {
      const sessione = await azione();
      const torna = this.torna();
      await this.router.navigateByUrl(
        torna?.startsWith('/') && !torna.startsWith('//') ? torna : paginaIniziale(sessione.utente.ruolo),
      );
    } catch (error) {
      this.errore.set(messaggioErrore(error, tipo));
    } finally {
      this.invio.set(false);
    }
  }

  private async caricaDispositivo(): Promise<void> {
    try {
      this.dispositivo.set(await this.auth.infoDispositivo());
    } catch {
      this.dispositivo.set({ registrato: false, nome: null, utenti: [] });
    }
  }
}
