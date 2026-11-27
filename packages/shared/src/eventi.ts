/** Event types of the event log (CLAUDE.md §7). Kept in sync with the Prisma enum `TipoEvento`. */
export const TIPI_EVENTO = [
  'TAVOLO_APERTO',
  'PIN_RIGENERATO',
  'PIN_ERRATO',
  'DISPOSITIVO_UNITO',
  'CARRELLO_MODIFICATO',
  'GIRO_INVIATO',
  'GIRO_APPROVATO',
  'GIRO_RIFIUTATO',
  'PIATTO_ESAURITO',
  'PIATTO_RIPRISTINATO',
  'TEMPO_SCADUTO',
  'TEMPO_ESTESO',
  'TAVOLI_UNITI',
  'TAVOLO_SPOSTATO',
  'PRECONTO_GENERATO',
  'TAVOLO_CHIUSO',
  'CONFIG_MODIFICATA',
  'CLIENT_RICONNESSO',
  'COPERTI_MODIFICATI',
] as const;
export type TipoEvento = (typeof TIPI_EVENTO)[number];

/** Who performed an action. Kept in sync with the Prisma enum `RuoloAttore`. */
export const RUOLI_ATTORE = ['CLIENTE', 'CAMERIERE', 'CAPO', 'ADMIN', 'MONITOR', 'SISTEMA'] as const;
export type RuoloAttore = (typeof RUOLI_ATTORE)[number];

export interface AttoreEvento {
  ruolo: RuoloAttore;
  /** Staff user or customer device id. Omitted in what customers receive. */
  id?: string | null;
  /** Shared staff device the action came from, if any. */
  dispositivoStaffId?: string | null;
}

/** An event as sent over the WebSocket and the REST API. */
export interface EventoDto {
  seq: number;
  ts: string;
  tipo: TipoEvento;
  attore: AttoreEvento;
  sedutaId: string | null;
  tavoloId: string | null;
  payload: Record<string, unknown>;
}

/** Socket.IO message names shared by client and server. */
export const SOCKET = {
  /** server → client: a new event */
  evento: 'evento',
  /** client → server (with ack): catch up from the last seq seen */
  sync: 'sync',
  /** server → client: the session or login ended, stop reconnecting */
  terminata: 'sessione_terminata',
} as const;

/** Above this many missed events the server asks the client to reload a full snapshot. */
export const MAX_EVENTI_RECUPERO = 500;

export interface SyncRichiesta {
  /**
   * Highest `seq` the client has processed, or null for a client starting from scratch
   * (it loads the current state over REST and only needs the cursor).
   */
  ultimoSeq: number | null;
}

export type SyncRisposta =
  { esito: 'eventi'; eventi: EventoDto[]; ultimoSeq: number } | { esito: 'snapshot_required'; ultimoSeq: number };

export interface SessioneTerminata {
  /** TAVOLI_UNITI: the table joined another open table; the client reloads and follows the new session. */
  motivo: 'TAVOLO_CHIUSO' | 'TAVOLI_UNITI' | 'LOGOUT' | 'NON_AUTORIZZATO';
}
