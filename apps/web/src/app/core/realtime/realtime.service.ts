import { Injectable, type OnDestroy, inject, signal } from '@angular/core';
import type { EventoDto, SessioneTerminata, SyncRisposta } from '@kikko/shared';
import { SOCKET } from '@kikko/shared/browser';
import { Subject } from 'rxjs';
import { type Socket, io } from 'socket.io-client';
import { StaffAuthService } from '../auth/staff-auth.service';
import { archivio } from '../storage';
import { SincronizzatoreEventi } from './sincronizzatore';

export type StatoConnessione = 'inattivo' | 'connessione' | 'connesso' | 'riconnessione' | 'terminato';

export type ConfigRealtime = { modo: 'staff'; chiave: string } | { modo: 'cliente'; chiave: string };

/** Factory for the Socket.IO client, replaceable in tests. */
export type CreaSocket = (auth: (cb: (dati: object) => void) => void) => Socket;

export const creaSocketPredefinito: CreaSocket = (auth) =>
  io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    auth,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
  });

/**
 * Live connection to the server (CLAUDE.md §6):
 * - automatic reconnection with growing, randomised delays (Socket.IO);
 * - the last seq is kept in localStorage and sent on every (re)connection to recover missed events,
 *   or to learn that a full reload is needed;
 * - staff tokens are renewed when the server refuses an expired one.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private readonly auth = inject(StaffAuthService);
  private socket: Socket | null = null;
  private config: ConfigRealtime | null = null;
  private sincronizzatore: SincronizzatoreEventi | null = null;
  private eraConnesso = false;

  /** Replaced in tests. */
  creaSocket: CreaSocket = creaSocketPredefinito;

  private readonly _stato = signal<StatoConnessione>('inattivo');
  readonly stato = this._stato.asReadonly();

  /** Events in seq order, each at most once. */
  readonly eventi$ = new Subject<EventoDto>();
  /** The client must reload its state from the REST API (too many missed events, or first connection). */
  readonly ricarica$ = new Subject<void>();
  /** The server ended the session (table closed, access revoked). */
  readonly terminata$ = new Subject<SessioneTerminata>();

  avvia(config: ConfigRealtime): void {
    if (this.config?.modo === config.modo && this.config.chiave === config.chiave && this.socket) return;
    this.ferma();
    this.config = config;
    const chiaveSeq = `kk_seq:${config.modo}:${config.chiave}`;
    const salvato = Number(archivio.leggi(chiaveSeq));
    this.sincronizzatore = new SincronizzatoreEventi(
      Number.isSafeInteger(salvato) && salvato > 0 ? salvato : null,
      (e) => {
        archivio.scrivi(chiaveSeq, String(e.seq));
        this.eventi$.next(e);
      },
    );

    const socket = this.creaSocket((cb) => cb(config.modo === 'staff' ? { token: this.auth.accessToken() ?? '' } : {}));
    this.socket = socket;
    this._stato.set('connessione');

    socket.on('connect', () => void this.sincronizza(socket, chiaveSeq));
    socket.on('disconnect', () => {
      if (this._stato() !== 'terminato') this._stato.set(this.eraConnesso ? 'riconnessione' : 'connessione');
      this.sincronizzatore?.annullaSync();
    });
    socket.on(SOCKET.evento, (e: EventoDto) => this.sincronizzatore?.ricevi(e));
    socket.on(SOCKET.terminata, (m: SessioneTerminata) => this.termina(m));
    socket.on(
      'connect_error',
      (err: Error & { data?: { codice?: string } }) => void this.erroreConnessione(socket, err),
    );
    socket.connect();
  }

  ferma(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.config = null;
    this.sincronizzatore = null;
    this.eraConnesso = false;
    if (this._stato() !== 'terminato') this._stato.set('inattivo');
  }

  ngOnDestroy(): void {
    this.ferma();
  }

  private async sincronizza(socket: Socket, chiaveSeq: string): Promise<void> {
    const sincronizzatore = this.sincronizzatore;
    if (!sincronizzatore) return;
    const primaVolta = sincronizzatore.ultimoSeq === null;
    sincronizzatore.inizioSync();
    try {
      const risposta = (await socket.timeout(10_000).emitWithAck(SOCKET.sync, {
        ultimoSeq: sincronizzatore.ultimoSeq,
      })) as SyncRisposta;
      const snapshot = sincronizzatore.fineSync(risposta);
      if (sincronizzatore.ultimoSeq !== null) archivio.scrivi(chiaveSeq, String(sincronizzatore.ultimoSeq));
      this.eraConnesso = true;
      this._stato.set('connesso');
      if (snapshot || primaVolta) this.ricarica$.next();
    } catch {
      sincronizzatore.annullaSync();
    }
  }

  private async erroreConnessione(socket: Socket, err: Error & { data?: { codice?: string } }): Promise<void> {
    if (socket.active) {
      // Network or server down: Socket.IO keeps retrying with backoff.
      this._stato.set(this.eraConnesso ? 'riconnessione' : 'connessione');
      return;
    }
    // Refused by the server during the handshake.
    if (err.data?.codice === 'TOKEN_NON_VALIDO' && this.config?.modo === 'staff') {
      const sessione = await this.auth.rinnova();
      if (sessione && this.socket === socket) {
        socket.connect();
        return;
      }
    }
    this.termina({ motivo: this.config?.modo === 'cliente' ? 'TAVOLO_CHIUSO' : 'NON_AUTORIZZATO' });
  }

  private termina(motivo: SessioneTerminata): void {
    this._stato.set('terminato');
    this.terminata$.next(motivo);
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.config = null;
  }
}
