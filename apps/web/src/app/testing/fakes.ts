import { signal } from '@angular/core';
import type { SessioneStaff } from '@kikko/shared';
import { Subject } from 'rxjs';
import type { Socket } from 'socket.io-client';
import type { StatoConnessione } from '../core/realtime/realtime.service';

export function sessioneProva(ruolo: SessioneStaff['utente']['ruolo'] = 'CAMERIERE'): SessioneStaff {
  return {
    accessToken: `token-${ruolo}`,
    scadeTra: 900,
    utente: { id: `id-${ruolo}`, nome: `Utente ${ruolo}`, username: ruolo.toLowerCase(), ruolo },
    dispositivo: null,
  };
}

/** Minimal stand-in for RealtimeService. */
export class RealtimeFinto {
  readonly stato = signal<StatoConnessione>('inattivo');
  readonly eventi$ = new Subject<never>();
  readonly ricarica$ = new Subject<void>();
  readonly terminata$ = new Subject<{ motivo: 'TAVOLO_CHIUSO' }>();
  avviato: unknown = null;
  avvia(config: unknown): void {
    this.avviato = config;
  }
  ferma(): void {
    this.avviato = null;
  }
}

/** Fake Socket.IO client driven by the test. */
export class SocketFinto {
  active = true;
  connesso = false;
  connessioni = 0;
  inviati: { evento: string; dati: unknown }[] = [];
  rispostaSync: unknown = { esito: 'eventi', eventi: [], ultimoSeq: 0 };
  private readonly gestori = new Map<string, ((...args: unknown[]) => void)[]>();

  on(evento: string, fn: (...args: unknown[]) => void): this {
    this.gestori.set(evento, [...(this.gestori.get(evento) ?? []), fn]);
    return this;
  }
  emetti(evento: string, ...args: unknown[]): void {
    (this.gestori.get(evento) ?? []).forEach((fn) => fn(...args));
  }
  connect(): this {
    this.connessioni++;
    return this;
  }
  disconnect(): this {
    this.connesso = false;
    return this;
  }
  removeAllListeners(): this {
    this.gestori.clear();
    return this;
  }
  timeout(): this {
    return this;
  }
  async emitWithAck(evento: string, dati: unknown): Promise<unknown> {
    this.inviati.push({ evento, dati });
    return this.rispostaSync;
  }
  comeSocket(): Socket {
    return this as unknown as Socket;
  }
}
