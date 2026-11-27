import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type EventoDto,
  MAX_EVENTI_RECUPERO,
  type RuoloStaff,
  SOCKET,
  type SessioneTerminata,
  type SyncRisposta,
} from '@kikko/shared';
import { parse as parseCookie } from 'cookie';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { type JwtPayload, utenteDaPayload } from '../auth/auth.types.js';
import { ClienteService } from '../cliente/cliente.service.js';
import type { Attore } from '../common/attore.js';
import { COOKIE } from '../common/cookies.js';
import { EventiService } from '../eventi/eventi.service.js';
import { TIPI_VISIBILI_CLIENTE, perCliente } from '../eventi/visibilita.js';

/** Who is on the other side of a socket, set by the handshake middleware. */
export type IdentitaSocket =
  | { tipo: 'staff'; utenteId: string; ruolo: RuoloStaff; dispositivoStaffId: string | null }
  | { tipo: 'cliente'; dispositivoId: string; sedutaId: string };

interface DatiSocket {
  identita: IdentitaSocket;
}

export const stanza = {
  seduta: (id: string) => `seduta:${id}`,
  staff: (ruolo: RuoloStaff) => `staff:${ruolo}`,
  monitor: 'monitor',
} as const;

const STANZE_STAFF = (['CAMERIERE', 'CAPO', 'ADMIN', 'MONITOR'] as const).map(stanza.staff);
/** At most one CLIENT_RICONNESSO per actor in this window, so flapping networks do not flood the log. */
const INTERVALLO_LOG_RICONNESSIONE_MS = 60_000;

/** Error sent to the client when the handshake is refused (socket.io `connect_error`). */
function rifiuto(codice: 'NON_AUTENTICATO' | 'TOKEN_NON_VALIDO' | 'NON_AUTORIZZATO'): Error {
  return Object.assign(new Error(codice), { data: { codice } });
}

/**
 * Real-time gateway (CLAUDE.md §6 and §12).
 * - Handshake: staff send their access token in `auth.token`; customers are recognised by their cookie.
 * - Rooms: `seduta:{id}` for customers, `staff:{ruolo}` and `monitor` for staff.
 * - `sync` returns the events missed since the client's last seq, or asks for a full snapshot.
 */
@WebSocketGateway({ path: '/socket.io', serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;
  private sottoscrizione: Subscription | undefined;
  private readonly ultimaRiconnessione = new Map<string, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly clienti: ClienteService,
    private readonly eventi: EventiService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.autentica(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
    this.sottoscrizione = this.eventi.flusso$.subscribe((evento) => this.diffondi(evento));
  }

  onModuleDestroy(): void {
    this.sottoscrizione?.unsubscribe();
  }

  @SubscribeMessage(SOCKET.sync)
  async sync(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<SyncRisposta> {
    const identita = (socket.data as DatiSocket).identita;
    const richiesto = (body as { ultimoSeq?: unknown } | null)?.ultimoSeq;
    const ultimoSeq =
      typeof richiesto === 'number' && Number.isSafeInteger(richiesto) && richiesto >= 0 ? richiesto : null;

    // Read the head first: everything up to it is either in the backlog or already sent live.
    const testa = await this.eventi.ultimoSeq();
    // A client starting from scratch loads the current state over REST: it only needs the cursor.
    if (ultimoSeq === null || ultimoSeq >= testa) return { esito: 'eventi', eventi: [], ultimoSeq: testa };

    const filtro =
      identita.tipo === 'cliente' ? { sedutaId: identita.sedutaId, tipo: { in: TIPI_VISIBILI_CLIENTE } } : {};
    const grezzi = await this.eventi.dopo(ultimoSeq, MAX_EVENTI_RECUPERO + 1, {
      ...filtro,
      seq: { lte: BigInt(testa) },
    });
    const risposta: SyncRisposta =
      grezzi.length > MAX_EVENTI_RECUPERO
        ? { esito: 'snapshot_required', ultimoSeq: testa }
        : { esito: 'eventi', eventi: this.filtra(grezzi, identita), ultimoSeq: testa };

    // Recorded after answering, so the client gets its backlog before the new event.
    setImmediate(() => void this.registraRiconnessione(identita, ultimoSeq, grezzi.length));
    return risposta;
  }

  // ---------- internals ----------

  private async autentica(socket: Socket): Promise<void> {
    const token: unknown = socket.handshake.auth?.['token'];
    if (typeof token === 'string' && token.length > 0) {
      let payload: JwtPayload;
      try {
        payload = await this.jwt.verifyAsync<JwtPayload>(token);
      } catch {
        throw rifiuto('TOKEN_NON_VALIDO');
      }
      const utente = utenteDaPayload(payload);
      const identita: IdentitaSocket = {
        tipo: 'staff',
        utenteId: utente.id,
        ruolo: utente.ruolo,
        dispositivoStaffId: utente.dispositivoStaffId,
      };
      (socket.data as DatiSocket).identita = identita;
      await socket.join(stanza.staff(utente.ruolo));
      if (utente.ruolo === 'MONITOR' || utente.ruolo === 'ADMIN') await socket.join(stanza.monitor);
      return;
    }

    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const cliente = await this.clienti.autentica(cookies[COOKIE.cliente] ?? null);
    if (!cliente) throw rifiuto(socket.handshake.headers.cookie ? 'NON_AUTORIZZATO' : 'NON_AUTENTICATO');
    (socket.data as DatiSocket).identita = {
      tipo: 'cliente',
      dispositivoId: cliente.dispositivo.id,
      sedutaId: cliente.seduta.id,
    };
    await socket.join(stanza.seduta(cliente.seduta.id));
  }

  /** Sends a committed event to every room allowed to see it. */
  private diffondi(evento: EventoDto): void {
    this.server.to([...STANZE_STAFF, stanza.monitor]).emit(SOCKET.evento, evento);
    if (!evento.sedutaId) return;
    const versioneCliente = perCliente(evento, evento.sedutaId);
    const room = stanza.seduta(evento.sedutaId);
    if (versioneCliente) this.server.to(room).emit(SOCKET.evento, versioneCliente);
    if (evento.tipo === 'TAVOLO_CHIUSO') {
      const motivo: SessioneTerminata = { motivo: 'TAVOLO_CHIUSO' };
      this.server.to(room).emit(SOCKET.terminata, motivo);
      this.server.in(room).disconnectSockets(true);
    }
  }

  private filtra(eventi: EventoDto[], identita: IdentitaSocket): EventoDto[] {
    if (identita.tipo === 'staff') return eventi;
    return eventi.map((e) => perCliente(e, identita.sedutaId)).filter((e): e is EventoDto => e !== null);
  }

  private async registraRiconnessione(identita: IdentitaSocket, ultimoSeq: number, mancanti: number): Promise<void> {
    const chiave = identita.tipo === 'staff' ? `staff:${identita.utenteId}` : `cliente:${identita.dispositivoId}`;
    const ora = Date.now();
    const precedente = this.ultimaRiconnessione.get(chiave) ?? 0;
    if (ora - precedente < INTERVALLO_LOG_RICONNESSIONE_MS) return;
    this.ultimaRiconnessione.set(chiave, ora);
    if (this.ultimaRiconnessione.size > 5_000) this.ultimaRiconnessione.clear();

    const attore: Attore =
      identita.tipo === 'staff'
        ? { ruolo: identita.ruolo, id: identita.utenteId, dispositivoStaffId: identita.dispositivoStaffId }
        : { ruolo: 'CLIENTE', id: identita.dispositivoId };
    try {
      await this.eventi.registra({
        tipo: 'CLIENT_RICONNESSO',
        attore,
        sedutaId: identita.tipo === 'cliente' ? identita.sedutaId : null,
        payload: { ultimoSeq, eventiMancanti: Math.min(mancanti, MAX_EVENTI_RECUPERO + 1) },
      });
    } catch (error) {
      this.logger.warn(`Could not record reconnection: ${(error as Error).message}`);
    }
  }
}
