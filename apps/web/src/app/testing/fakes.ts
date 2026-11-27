import { signal } from '@angular/core';
import type { EventoDto, MenuDto, SedutaClienteDto, SessioneStaff } from '@kikko/shared';
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
  readonly eventi$ = new Subject<EventoDto>();
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

/** A small menu: two included dishes (one with a per-person limit) and a paid drink. */
export function menuProva(): MenuDto {
  const base = {
    descrizione: { it: '', en: '' },
    categoriaId: 'cat-sushi',
    pezzi: 4,
    immagine: null,
    allergeni: [],
    vegetariano: false,
    piccante: false,
    senzaGlutine: false,
    inFormula: true,
    prezzoExtraCent: null,
    maxPerPersona: null,
    maxPerGiro: null,
    gruppoId: null,
    disponibile: true,
  };
  return {
    versione: 'v1',
    categorie: [
      { id: 'cat-sushi', codice: 'nigiri', nome: { it: 'Nigiri', en: 'Nigiri' }, sezione: 'MENU' },
      { id: 'cat-bevande', codice: 'bevande', nome: { it: 'Bevande', en: 'Drinks' }, sezione: 'BEVANDE' },
    ],
    gruppi: [],
    piatti: [
      {
        ...base,
        id: 'p-salmone',
        numero: '46',
        nome: { it: 'Nigiri salmone', en: 'Salmon nigiri' },
        allergeni: ['FISH'],
      },
      {
        ...base,
        id: 'p-bao',
        numero: '113',
        nome: { it: 'Bao bun', en: 'Bao bun' },
        maxPerPersona: 1,
        allergeni: ['SESAME', 'SOY'],
      },
      {
        ...base,
        id: 'p-acqua',
        numero: null,
        categoriaId: 'cat-bevande',
        nome: { it: 'Acqua', en: 'Water' },
        pezzi: null,
        inFormula: false,
        prezzoExtraCent: 250,
      },
    ],
  };
}

export function sedutaProva(over: Partial<SedutaClienteDto> = {}): SedutaClienteDto {
  const ora = new Date();
  return {
    sedutaId: 'seduta-1',
    ora: ora.toISOString(),
    tavoli: [4],
    copertiAdulti: 2,
    copertiBambini: 0,
    formula: {
      nome: { it: 'Cena', en: 'Dinner' },
      piattiPerPersonaPerGiro: 3,
      minutiTraGiri: 10,
      durataMaxMinuti: 150,
      maxGiri: null,
    },
    apertaIl: new Date(ora.getTime() - 5 * 60_000).toISOString(),
    minutiExtra: 0,
    scadeIl: new Date(ora.getTime() + 145 * 60_000).toISOString(),
    io: { id: 'io', soprannome: 'Anna', emoji: '🐼' },
    dispositivi: [
      { id: 'io', soprannome: 'Anna', emoji: '🐼' },
      { id: 'altro', soprannome: 'Luca', emoji: '🦊' },
    ],
    carrello: [],
    giri: [],
    ...over,
  };
}
