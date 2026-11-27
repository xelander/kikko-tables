import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CodaCassaDto, EventoDto, GiroCassaDto, MenuDto, TavoloStato } from '@kikko/shared';
import { SOGLIA_GIRO_IN_ATTESA_MIN } from '@kikko/shared/browser';
import { debounceTime, filter } from 'rxjs';
import { archivio } from '../../core/storage';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { messaggioErroreStaff } from '../cameriere/errori';
import { TavoliApi } from '../cameriere/tavoli.api';
import { CassaApi } from './cassa.api';
import { Suono } from './suono';

export const CHIAVE_SUONI = 'kk_cassa_suoni';

/** Events that change the rounds queue. */
const TIPI_CODA = new Set<string>([
  'GIRO_INVIATO',
  'GIRO_APPROVATO',
  'GIRO_RIFIUTATO',
  'TAVOLO_CHIUSO',
  'TAVOLI_UNITI',
  'TAVOLO_SPOSTATO',
  'COPERTI_MODIFICATI',
]);

/** Events that change the open tables (time, covers, rounds waiting). */
const TIPI_TAVOLI = new Set<string>([
  ...TIPI_CODA,
  'TAVOLO_APERTO',
  'TEMPO_SCADUTO',
  'TEMPO_ESTESO',
  'DISPOSITIVO_UNITO',
]);

/**
 * State of the till area, shared by its pages (provided on the `/staff/cassa` route):
 * rounds queue, open tables with their time, alarms and sounds. The server is the source of truth:
 * every relevant event reloads the affected list, and a reconnection reloads everything.
 */
@Injectable()
export class CassaStore {
  private readonly api = inject(CassaApi);
  private readonly tavoliApi = inject(TavoliApi);
  private readonly realtime = inject(RealtimeService);
  private readonly suono = inject(Suono);

  readonly coda = signal<CodaCassaDto | null>(null);
  readonly tavoli = signal<TavoloStato[] | null>(null);
  readonly menu = signal<MenuDto | null>(null);
  readonly errore = signal<string | null>(null);
  readonly ora = signal(Date.now());
  /** Sounds wanted (remembered on this device); audio still needs one tap after each reload. */
  readonly suoni = signal(archivio.leggi(CHIAVE_SUONI) === '1');
  readonly audioPronto = signal(this.suono.pronto);
  /** Rounds being approved or rejected: hidden at once (optimistic), shown again if the request fails. */
  private readonly inLavorazione = signal<ReadonlySet<string>>(new Set());
  /** Difference between the server clock and this device's clock (ms). */
  private scarto = 0;

  readonly inAttesa = computed(() => (this.coda()?.inAttesa ?? []).filter((g) => !this.inLavorazione().has(g.id)));
  readonly recenti = computed(() => this.coda()?.recenti ?? []);
  readonly aperti = computed(() => (this.tavoli() ?? []).filter((t) => t.seduta !== null));
  /** One entry per open session (merged tables appear once). */
  readonly sedute = computed(() => {
    const viste = new Set<string>();
    return this.aperti().filter((t) => {
      const id = t.seduta!.id;
      if (viste.has(id)) return false;
      viste.add(id);
      return true;
    });
  });
  readonly scaduti = computed(() => this.sedute().filter((t) => Date.parse(t.seduta!.scadeIl) <= this.adesso()));
  readonly nomi = computed(
    () =>
      new Map(
        (this.menu()?.piatti ?? []).map((p) => [p.id, p.numero ? `${p.numero} · ${p.nome.it}` : p.nome.it] as const),
      ),
  );

  constructor() {
    const eventi$ = this.realtime.eventi$.pipe(takeUntilDestroyed());
    eventi$.subscribe((e) => this.suonaPer(e));
    eventi$
      .pipe(
        filter((e) => TIPI_CODA.has(e.tipo)),
        debounceTime(150),
      )
      .subscribe(() => void this.caricaCoda());
    eventi$
      .pipe(
        filter((e) => TIPI_TAVOLI.has(e.tipo)),
        debounceTime(150),
      )
      .subscribe(() => void this.caricaTavoli());
    this.realtime.ricarica$.pipe(takeUntilDestroyed()).subscribe(() => void this.carica());

    const timer = setInterval(() => this.ora.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    void this.carica();
    void this.tavoliApi.menu().then(
      (m) => this.menu.set(m),
      () => undefined,
    );
  }

  /** Now, by the server clock. */
  adesso(): number {
    return this.ora() + this.scarto;
  }

  nome(piattoId: string): string {
    return this.nomi().get(piattoId) ?? '…';
  }

  minutiAttesa(g: GiroCassaDto): number {
    return Math.max(0, Math.floor((this.adesso() - Date.parse(g.inviatoIl)) / 60_000));
  }

  attesaLunga(g: GiroCassaDto): boolean {
    return this.minutiAttesa(g) >= SOGLIA_GIRO_IN_ATTESA_MIN;
  }

  async carica(): Promise<void> {
    await Promise.all([this.caricaCoda(), this.caricaTavoli()]);
  }

  async caricaCoda(): Promise<void> {
    try {
      const coda = await this.api.coda();
      this.scarto = Date.parse(coda.ora) - Date.now();
      this.ora.set(Date.now());
      this.coda.set(coda);
    } catch (error) {
      if (!this.coda()) this.errore.set(messaggioErroreStaff(error));
    }
  }

  async caricaTavoli(): Promise<void> {
    try {
      this.tavoli.set(await this.tavoliApi.elenco());
    } catch {
      // The queue is what matters: the table list catches up with the next event or reload.
    }
  }

  approva(g: GiroCassaDto): Promise<boolean> {
    return this.gestisci(g, () => this.api.approva(g.id));
  }

  rifiuta(g: GiroCassaDto, motivo: string): Promise<boolean> {
    return this.gestisci(g, () => this.api.rifiuta(g.id, motivo));
  }

  private async gestisci(g: GiroCassaDto, azione: () => Promise<unknown>): Promise<boolean> {
    this.errore.set(null);
    this.inLavorazione.update((s) => new Set(s).add(g.id));
    try {
      await azione();
      return true;
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
      // Already handled elsewhere: the reload below removes it for good.
      return error instanceof HttpErrorResponse && error.status === 409;
    } finally {
      await this.caricaCoda();
      this.inLavorazione.update((s) => {
        const n = new Set(s);
        n.delete(g.id);
        return n;
      });
    }
  }

  /** Must be called from a tap: browsers only allow audio after a user gesture. */
  attivaSuoni(attivi: boolean): void {
    this.suoni.set(attivi);
    archivio.scrivi(CHIAVE_SUONI, attivi ? '1' : '0');
    if (attivi) {
      this.sbloccaAudio();
      this.suono.suona('giro');
    }
  }

  /** After a reload the first tap anywhere unlocks audio again. */
  sbloccaAudio(): void {
    this.suono.sblocca();
    this.audioPronto.set(true);
  }

  private suonaPer(e: EventoDto): void {
    if (!this.suoni()) return;
    if (e.tipo === 'GIRO_INVIATO') this.suono.suona('giro');
    else if (e.tipo === 'TEMPO_SCADUTO') this.suono.suona('allarme');
  }
}
