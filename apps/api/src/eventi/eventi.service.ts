import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { EventoDto, TipoEvento } from '@kikko/shared';
import { Subject } from 'rxjs';
import type { Attore } from '../common/attore.js';
import { Prisma, type Evento } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type Tx = Prisma.TransactionClient;

export interface NuovoEvento {
  tipo: TipoEvento;
  attore: Attore;
  sedutaId?: string | null;
  tavoloId?: string | null;
  payload?: Record<string, unknown>;
}

/** Passed to the body of `transazione()`: records events inside the same transaction. */
export interface RegistroTx {
  registra(evento: NuovoEvento): Promise<void>;
}

/**
 * Key of the transaction-scoped advisory lock taken before writing events.
 * Serialising event writes makes `seq` order equal to commit order, so a client that has
 * seen seq N can never later receive a committed event with seq < N.
 */
const LOCK_EVENTI = 727_001;
const INTERVALLO_SICUREZZA_MS = 5_000;
const PAGINA = 500;

export function eventoToDto(e: Evento): EventoDto {
  return {
    seq: Number(e.seq),
    ts: e.ts.toISOString(),
    tipo: e.tipo,
    attore: { ruolo: e.attoreRuolo, id: e.attoreId, dispositivoStaffId: e.dispositivoStaffId },
    sedutaId: e.sedutaId,
    tavoloId: e.tavoloId,
    payload: (e.payload ?? {}) as Record<string, unknown>,
  };
}

/**
 * Event log (CLAUDE.md §7).
 * - Events are written in the same transaction as the change they describe.
 * - After commit a single "pump" reads new events in `seq` order and publishes them on `flusso$`,
 *   so subscribers (the WebSocket gateway) always see them in order and only once committed.
 */
@Injectable()
export class EventiService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EventiService.name);
  private readonly subject = new Subject<EventoDto>();
  readonly flusso$ = this.subject.asObservable();

  private ultimoPubblicato: bigint | null = null;
  private catena: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    // Events committed before this process started are recovered by clients through `sync`.
    try {
      const r = await this.prisma.evento.aggregate({ _max: { seq: true } });
      this.ultimoPubblicato ??= r._max.seq ?? 0n;
    } catch (error) {
      this.logger.warn(`Event log not readable at startup: ${(error as Error).message}`);
    }
    this.timer = setInterval(() => void this.pubblica(), INTERVALLO_SICUREZZA_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.subject.complete();
  }

  /**
   * Runs `fn` in a transaction; events recorded through `registro` are committed with it
   * and published right after the commit (awaited, so HTTP responses follow the broadcast).
   */
  async transazione<T>(
    fn: (tx: Tx, registro: RegistroTx) => Promise<T>,
    opzioni?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
  ): Promise<T> {
    let primoSeq: bigint | null = null;
    const risultato = await this.prisma.$transaction(async (tx) => {
      let bloccato = false;
      const registro: RegistroTx = {
        registra: async (evento) => {
          if (!bloccato) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_EVENTI})`;
            bloccato = true;
          }
          const creato = await tx.evento.create({ data: datiEvento(evento), select: { seq: true } });
          primoSeq ??= creato.seq;
        },
      };
      return fn(tx, registro);
    }, opzioni);
    if (primoSeq !== null) await this.pubblica(primoSeq);
    return risultato;
  }

  /** Records a single event on its own (e.g. a wrong PIN, a reconnection). */
  async registra(evento: NuovoEvento): Promise<void> {
    await this.transazione((_tx, registro) => registro.registra(evento));
  }

  /** Highest committed seq, 0 if the log is empty. */
  async ultimoSeq(): Promise<number> {
    const r = await this.prisma.evento.aggregate({ _max: { seq: true } });
    return Number(r._max.seq ?? 0n);
  }

  /** Events after `dopoSeq`, oldest first, optionally filtered. At most `limite` rows. */
  async dopo(dopoSeq: number, limite: number, filtro: Prisma.EventoWhereInput = {}): Promise<EventoDto[]> {
    const righe = await this.prisma.evento.findMany({
      where: { ...filtro, seq: { gt: BigInt(dopoSeq) } },
      orderBy: { seq: 'asc' },
      take: limite,
    });
    return righe.map(eventoToDto);
  }

  /**
   * Publishes every committed event not yet published, in order. Calls are serialised.
   * `daSeq` is the first event written by the caller: it anchors the cursor if the database
   * was unreachable at startup, so this process never skips its own events.
   */
  pubblica(daSeq?: bigint): Promise<void> {
    this.catena = this.catena.then(
      () => this.drena(daSeq),
      () => this.drena(daSeq),
    );
    return this.catena.catch((error: unknown) => {
      this.logger.warn(`Event publishing failed, will retry: ${(error as Error).message}`);
    });
  }

  private async drena(daSeq?: bigint): Promise<void> {
    if (daSeq !== undefined && (this.ultimoPubblicato === null || daSeq <= this.ultimoPubblicato)) {
      // Not initialised yet, or the log went backwards (e.g. database restored from a backup).
      this.ultimoPubblicato = daSeq - 1n;
    }
    if (this.ultimoPubblicato === null) return;
    for (;;) {
      const dopo: bigint = this.ultimoPubblicato;
      const righe: Evento[] = await this.prisma.evento.findMany({
        where: { seq: { gt: dopo } },
        orderBy: { seq: 'asc' },
        take: PAGINA,
      });
      for (const riga of righe) {
        this.ultimoPubblicato = riga.seq;
        this.subject.next(eventoToDto(riga));
      }
      if (righe.length < PAGINA) return;
    }
  }
}

function datiEvento(e: NuovoEvento): Prisma.EventoUncheckedCreateInput {
  return {
    tipo: e.tipo,
    attoreRuolo: e.attore.ruolo,
    attoreId: e.attore.id,
    dispositivoStaffId: e.attore.dispositivoStaffId ?? null,
    sedutaId: e.sedutaId ?? null,
    tavoloId: e.tavoloId ?? null,
    payload: (e.payload ?? {}) as Prisma.InputJsonObject,
  };
}
