import type { EventoDto, SyncRisposta } from '@kikko/shared';

/**
 * Pure bookkeeping of the event stream on the client (CLAUDE.md §6).
 * - Remembers the highest seq processed.
 * - While a `sync` is in flight, live events are queued and applied after the recovered ones,
 *   so a live event can never make the client skip older events that are still being recovered.
 * - Events already seen are ignored (idempotent).
 */
export class SincronizzatoreEventi {
  private coda: EventoDto[] | null = null;

  constructor(
    private ultimo: number | null,
    private readonly applica: (evento: EventoDto) => void,
  ) {}

  get ultimoSeq(): number | null {
    return this.ultimo;
  }

  /** A live event from the socket. */
  ricevi(evento: EventoDto): void {
    if (this.coda) this.coda.push(evento);
    else this.processa(evento);
  }

  /** Call right before sending `sync`. */
  inizioSync(): void {
    this.coda = [];
  }

  /** Call with the server answer. Returns true if the client must reload a full snapshot. */
  fineSync(risposta: SyncRisposta): boolean {
    if (risposta.esito === 'eventi') risposta.eventi.forEach((e) => this.processa(e));
    const inAttesa = (this.coda ?? []).sort((a, b) => a.seq - b.seq);
    this.coda = null;
    // Up to the head, everything meant for us was in the backlog.
    this.ultimo = Math.max(this.ultimo ?? 0, risposta.ultimoSeq);
    inAttesa.forEach((e) => this.processa(e));
    return risposta.esito === 'snapshot_required';
  }

  /** The sync failed (e.g. disconnected meanwhile): keep the queued events for the next attempt. */
  annullaSync(): void {
    const inAttesa = (this.coda ?? []).sort((a, b) => a.seq - b.seq);
    this.coda = null;
    inAttesa.forEach((e) => this.processa(e));
  }

  private processa(evento: EventoDto): void {
    if (this.ultimo !== null && evento.seq <= this.ultimo) return;
    this.ultimo = evento.seq;
    this.applica(evento);
  }
}
