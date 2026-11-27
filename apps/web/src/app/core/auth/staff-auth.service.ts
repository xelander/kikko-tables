import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, type OnDestroy, computed, inject, signal } from '@angular/core';
import type { DispositivoCondivisoInfo, LoginPinRichiesta, LoginRichiesta, SessioneStaff } from '@kikko/shared';
import { firstValueFrom } from 'rxjs';

const URL_AUTH = '/api/auth';
/** Renew the access token this many seconds before it expires. */
const ANTICIPO_RINNOVO_S = 60;

/**
 * Staff session in the browser (CLAUDE.md §5–6).
 * The access token lives only in memory; the refresh token is an httpOnly cookie, so after a reload
 * or a reboot `assicura()` silently gets a new access token and the device goes back to work.
 */
@Injectable({ providedIn: 'root' })
export class StaffAuthService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly _sessione = signal<SessioneStaff | null>(null);
  private inCorso: Promise<SessioneStaff | null> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly sessione = this._sessione.asReadonly();
  readonly utente = computed(() => this._sessione()?.utente ?? null);
  readonly autenticato = computed(() => this._sessione() !== null);

  accessToken(): string | null {
    return this._sessione()?.accessToken ?? null;
  }

  /** Returns a valid session, renewing it from the refresh cookie if needed. */
  async assicura(): Promise<SessioneStaff | null> {
    return this._sessione() ?? this.rinnova();
  }

  async login(dati: LoginRichiesta): Promise<SessioneStaff> {
    return this.imposta(await firstValueFrom(this.http.post<SessioneStaff>(`${URL_AUTH}/login`, dati)));
  }

  async loginPin(dati: LoginPinRichiesta): Promise<SessioneStaff> {
    return this.imposta(await firstValueFrom(this.http.post<SessioneStaff>(`${URL_AUTH}/pin`, dati)));
  }

  async logout(): Promise<void> {
    this.imposta(null);
    await firstValueFrom(this.http.post<void>(`${URL_AUTH}/logout`, {})).catch(() => undefined);
  }

  infoDispositivo(): Promise<DispositivoCondivisoInfo> {
    return firstValueFrom(this.http.get<DispositivoCondivisoInfo>(`${URL_AUTH}/dispositivo`));
  }

  registraDispositivo(nome: string): Promise<{ id: string; nome: string }> {
    return firstValueFrom(this.http.post<{ id: string; nome: string }>(`${URL_AUTH}/dispositivo`, { nome }));
  }

  /**
   * Renews the session from the refresh cookie. Concurrent calls share one request; across tabs the
   * Web Locks API serialises refreshes (the server also answers 409 when two tabs race: retry once).
   */
  rinnova(): Promise<SessioneStaff | null> {
    this.inCorso ??= this.conLock(() => this.chiamaRefresh()).finally(() => (this.inCorso = null));
    return this.inCorso;
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  private async chiamaRefresh(tentativo = 0): Promise<SessioneStaff | null> {
    try {
      return this.imposta(await firstValueFrom(this.http.post<SessioneStaff>(`${URL_AUTH}/refresh`, {})));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && tentativo === 0) {
        return this.chiamaRefresh(1);
      }
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 409)) {
        return this.imposta(null);
      }
      // Network error (e.g. offline): keep the current session, the caller may retry.
      return this._sessione();
    }
  }

  private imposta(sessione: SessioneStaff): SessioneStaff;
  private imposta(sessione: null): null;
  private imposta(sessione: SessioneStaff | null): SessioneStaff | null {
    clearTimeout(this.timer);
    this._sessione.set(sessione);
    if (sessione) {
      const ritardo = Math.max(10, sessione.scadeTra - ANTICIPO_RINNOVO_S) * 1000;
      this.timer = setTimeout(() => void this.rinnova(), ritardo);
    }
    return sessione;
  }

  private conLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks;
    return locks ? locks.request('kikko-refresh', fn) : fn();
  }
}
