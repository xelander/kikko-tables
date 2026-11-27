import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  ErroreGiroDto,
  ErroreRegola,
  EventoDto,
  MenuDto,
  PiattoMenuDto,
  SedutaClienteDto,
  VoceCarrelloDto,
} from '@kikko/shared';
import {
  type ContestoGiro,
  type QuantitaPiatto,
  disponibiliPerPiatto,
  limiteGiro,
  piattiInFormula,
  prossimoGiroIl,
  scadenzaSeduta,
  soloExtra,
} from '@kikko/shared/browser';
import { RealtimeService } from '../../../core/realtime/realtime.service';
import { archivio } from '../../../core/storage';
import { SalaApi } from './sala.api';

/** Taps on +/− are grouped for this long before being sent. */
export const RITARDO_INVIO_CARRELLO_MS = 250;
/** While a round is waiting for the network, try again this often. */
export const INTERVALLO_RIPROVA_GIRO_MS = 5_000;

export type StatoInvio = 'pronto' | 'invio' | 'in-coda' | 'inviato';

/** How long the "round approved / rejected" notice stays on screen. */
export const DURATA_NOTIFICA_MS = 8_000;

/** The till approved or rejected a round of this table (shown as an animated notice). */
export interface NotificaGiro {
  tipo: 'APPROVATO' | 'RIFIUTATO';
  numero: number;
  motivo: string | null;
}

interface Modifica {
  quantita: number;
  timer: ReturnType<typeof setTimeout> | null;
  inVolo: Promise<void> | null;
}

/** A network failure (offline, server down): the request may be retried. */
function erroreDiRete(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}

/**
 * State of the customer ordering screen (CLAUDE.md §3, §6, §11).
 * - The server is the source of truth; own cart changes are applied at once (optimistic) and rolled back on error.
 * - Other phones' changes arrive as events.
 * - "Send round" is queued with an idempotency key kept in localStorage: if the network is down the round
 *   leaves when it comes back, and retries can never create a duplicate.
 */
@Injectable()
export class SalaStore {
  private readonly api = inject(SalaApi);
  private readonly realtime = inject(RealtimeService);

  readonly menu = signal<MenuDto | null>(null);
  readonly seduta = signal<SedutaClienteDto | null>(null);
  readonly errore = signal<string | null>(null);
  readonly statoInvio = signal<StatoInvio>('pronto');
  readonly erroriGiro = signal<ErroreRegola[]>([]);
  readonly notifica = signal<NotificaGiro | null>(null);
  private timerNotifica: ReturnType<typeof setTimeout> | undefined;
  /** Difference between the server clock and this device's clock (ms). */
  private readonly scarto = signal(0);
  readonly ora = signal(Date.now());

  private readonly carrelloServer = signal<VoceCarrelloDto[]>([]);
  private readonly modifiche = new Map<string, Modifica>();
  private readonly mieModifiche = signal<ReadonlyMap<string, number>>(new Map());
  private riprova: ReturnType<typeof setInterval> | undefined;

  readonly io = computed(() => this.seduta()?.io ?? null);

  readonly piattiPerId = computed(() => new Map((this.menu()?.piatti ?? []).map((p) => [p.id, p])));

  /** The shared cart as shown: server lines with this device's pending changes applied. */
  readonly carrello = computed<VoceCarrelloDto[]>(() => {
    const io = this.io()?.id;
    const mie = this.mieModifiche();
    const righe = this.carrelloServer().filter((r) => !(r.dispositivoId === io && mie.has(r.piattoId)));
    if (io)
      for (const [piattoId, quantita] of mie) if (quantita > 0) righe.push({ piattoId, dispositivoId: io, quantita });
    return righe;
  });

  readonly contesto = computed<ContestoGiro | null>(() => {
    const s = this.seduta();
    const m = this.menu();
    if (!s || !m) return null;
    return {
      formula: s.formula,
      coperti: s.copertiAdulti + s.copertiBambini,
      apertaIl: s.apertaIl,
      minutiExtra: s.minutiExtra,
      ora: new Date(this.ora() + this.scarto()),
      giri: s.giri,
      piatti: new Map(
        m.piatti.map((p) => [
          p.id,
          {
            id: p.id,
            inFormula: p.inFormula,
            disponibile: p.disponibile,
            maxPerPersona: p.maxPerPersona,
            maxPerGiro: p.maxPerGiro,
            gruppoId: p.gruppoId,
          },
        ]),
      ),
      gruppi: new Map(m.gruppi.map((g) => [g.id, { id: g.id, maxPerPersona: g.maxPerPersona }])),
    };
  });

  readonly vociCarrello = computed<QuantitaPiatto[]>(() =>
    this.carrello().map((r) => ({ piattoId: r.piattoId, quantita: r.quantita })),
  );

  /** "This round: 14/20". */
  readonly contatoreGiro = computed(() => {
    const ctx = this.contesto();
    if (!ctx) return { nelGiro: 0, limite: 0 };
    return { nelGiro: piattiInFormula(ctx, this.vociCarrello()), limite: limiteGiro(ctx) };
  });

  readonly pezziNelCarrello = computed(() => this.carrello().reduce((t, r) => t + r.quantita, 0));

  readonly totaleExtraCent = computed(() => {
    const piatti = this.piattiPerId();
    return this.carrello().reduce((t, r) => t + (piatti.get(r.piattoId)?.prezzoExtraCent ?? 0) * r.quantita, 0);
  });

  /** Milliseconds until the next round can be sent (0: now). */
  readonly attesaProssimoGiro = computed(() => {
    const ctx = this.contesto();
    const prossimo = ctx ? prossimoGiroIl(ctx) : null;
    return prossimo ? Math.max(0, prossimo.getTime() - ctx!.ora.getTime()) : 0;
  });

  readonly tempoRimasto = computed(() => {
    const ctx = this.contesto();
    return ctx ? Math.max(0, scadenzaSeduta(ctx).getTime() - ctx.ora.getTime()) : 0;
  });

  readonly soloExtraNelCarrello = computed(() => {
    const ctx = this.contesto();
    return !!ctx && soloExtra(ctx, this.vociCarrello());
  });

  constructor() {
    const orologio = setInterval(() => this.ora.set(Date.now()), 1_000);
    const online = () => void this.riprovaGiro();
    globalThis.addEventListener?.('online', online);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(orologio);
      clearInterval(this.riprova);
      clearTimeout(this.timerNotifica);
      globalThis.removeEventListener?.('online', online);
      for (const m of this.modifiche.values()) if (m.timer) clearTimeout(m.timer);
    });
    this.realtime.eventi$.pipe(takeUntilDestroyed()).subscribe((e) => this.applicaEvento(e));
    this.realtime.ricarica$.pipe(takeUntilDestroyed()).subscribe(() => {
      void this.caricaSeduta();
      void this.riprovaGiro();
      // Sold-out changes may have been missed while offline.
      if (this.menu())
        void this.api.menu().then(
          (m) => this.menu.set(m),
          () => undefined,
        );
    });
  }

  async carica(): Promise<void> {
    try {
      const [menu] = await Promise.all([this.api.menu(), this.caricaSeduta()]);
      this.menu.set(menu);
      this.errore.set(null);
      if (this.chiaveInCoda()) void this.riprovaGiro();
    } catch {
      this.errore.set('rete');
    }
  }

  async caricaSeduta(): Promise<void> {
    const seduta = await this.api.seduta();
    this.scarto.set(Date.parse(seduta.ora) - Date.now());
    this.seduta.set(seduta);
    this.carrelloServer.set(seduta.carrello);
  }

  piatto(id: string): PiattoMenuDto | undefined {
    return this.piattiPerId().get(id);
  }

  /** This device's quantity of a dish. */
  quantitaMia(piattoId: string): number {
    const io = this.io()?.id;
    return this.carrello().find((r) => r.piattoId === piattoId && r.dispositivoId === io)?.quantita ?? 0;
  }

  /** How many more of this dish the table can add now (null: no limit). */
  disponibili(piattoId: string): number | null {
    const ctx = this.contesto();
    return ctx ? disponibiliPerPiatto(ctx, this.vociCarrello(), piattoId) : 0;
  }

  /** Optimistic change of this device's quantity; sent after a short pause, rolled back if refused. */
  imposta(piattoId: string, quantita: number): void {
    const valore = Math.max(0, Math.min(99, quantita));
    const m = this.modifiche.get(piattoId) ?? { quantita: valore, timer: null, inVolo: null };
    m.quantita = valore;
    if (m.timer) clearTimeout(m.timer);
    m.timer = setTimeout(() => this.invia(piattoId), RITARDO_INVIO_CARRELLO_MS);
    this.modifiche.set(piattoId, m);
    this.mieModifiche.update((prev) => new Map(prev).set(piattoId, valore));
    this.erroriGiro.set([]);
  }

  /** Sends every pending cart change now (before sending the round). */
  async svuotaModifiche(): Promise<void> {
    for (const [piattoId, m] of this.modifiche) {
      if (m.timer) {
        clearTimeout(m.timer);
        m.timer = null;
        void this.invia(piattoId);
      }
    }
    await Promise.all([...this.modifiche.values()].map((m) => m.inVolo));
  }

  /** Sends the table's round. Safe to call again: the same key is reused until the server answers. */
  async inviaGiro(): Promise<void> {
    if (this.statoInvio() === 'invio') return;
    const seduta = this.seduta();
    if (!seduta) return;
    this.erroriGiro.set([]);
    this.statoInvio.set('invio');
    try {
      await this.svuotaModifiche();
    } catch {
      // the cart change will be retried with the round
    }
    let chiave = this.chiaveInCoda();
    if (!chiave) {
      chiave = crypto.randomUUID();
      archivio.scrivi(this.chiaveArchivio(), chiave);
    }
    await this.provaInvio(chiave);
  }

  /** Called when the connection comes back. */
  async riprovaGiro(): Promise<void> {
    const chiave = this.chiaveInCoda();
    if (chiave && this.statoInvio() !== 'invio') {
      this.statoInvio.set('invio');
      await this.provaInvio(chiave);
    }
  }

  private async provaInvio(chiave: string): Promise<void> {
    try {
      await this.api.inviaGiro(chiave);
      archivio.rimuovi(this.chiaveArchivio());
      clearInterval(this.riprova);
      this.statoInvio.set('inviato');
      await this.caricaSeduta().catch(() => undefined);
      setTimeout(() => this.statoInvio.update((s) => (s === 'inviato' ? 'pronto' : s)), 2_500);
    } catch (error) {
      if (erroreDiRete(error)) {
        this.statoInvio.set('in-coda');
        clearInterval(this.riprova);
        this.riprova = setInterval(() => void this.riprovaGiro(), INTERVALLO_RIPROVA_GIRO_MS);
        return;
      }
      archivio.rimuovi(this.chiaveArchivio());
      clearInterval(this.riprova);
      this.statoInvio.set('pronto');
      const corpo = error instanceof HttpErrorResponse ? (error.error as ErroreGiroDto | null) : null;
      this.erroriGiro.set(corpo?.codice === 'REGOLE_VIOLATE' ? corpo.errori : [{ codice: 'CARRELLO_VUOTO' }]);
      await this.caricaSeduta().catch(() => undefined);
    }
  }

  private chiaveArchivio(): string {
    return `kk_giro:${this.seduta()?.sedutaId ?? ''}`;
  }

  private chiaveInCoda(): string | null {
    return this.seduta() ? archivio.leggi(this.chiaveArchivio()) : null;
  }

  private invia(piattoId: string): Promise<void> {
    const m = this.modifiche.get(piattoId);
    if (!m) return Promise.resolve();
    m.timer = null;
    const quantita = m.quantita;
    const inVolo = this.api.impostaVoce(piattoId, quantita).then(
      (righe) => {
        if (this.modifiche.get(piattoId) === m && m.quantita === quantita && !m.timer) {
          this.modifiche.delete(piattoId);
          this.mieModifiche.update((prev) => {
            const next = new Map(prev);
            next.delete(piattoId);
            return next;
          });
        }
        this.carrelloServer.set(righe);
      },
      () => {
        // Refused or offline: go back to what the server knows.
        if (this.modifiche.get(piattoId) === m && m.quantita === quantita && !m.timer) {
          this.modifiche.delete(piattoId);
          this.mieModifiche.update((prev) => {
            const next = new Map(prev);
            next.delete(piattoId);
            return next;
          });
          this.errore.set('carrello');
        }
      },
    );
    m.inVolo = inVolo;
    return inVolo;
  }

  chiudiNotifica(): void {
    clearTimeout(this.timerNotifica);
    this.notifica.set(null);
  }

  private mostraNotifica(n: NotificaGiro): void {
    clearTimeout(this.timerNotifica);
    this.notifica.set(n);
    this.timerNotifica = setTimeout(() => this.notifica.set(null), DURATA_NOTIFICA_MS);
  }

  private applicaEvento(e: EventoDto): void {
    // Staff receive the events of every table: keep only this session's.
    const seduta = this.seduta();
    if (!seduta || (e.sedutaId !== null && e.sedutaId !== seduta.sedutaId)) return;
    switch (e.tipo) {
      case 'CARRELLO_MODIFICATO': {
        const { piattoId, quantita, dispositivoId } = e.payload as {
          piattoId: string;
          quantita: number;
          dispositivoId: string;
        };
        this.carrelloServer.update((righe) => {
          const altre = righe.filter((r) => !(r.piattoId === piattoId && r.dispositivoId === dispositivoId));
          return quantita > 0 ? [...altre, { piattoId, dispositivoId, quantita }] : altre;
        });
        // A device we do not know yet (e.g. the waiter ordering for the table): reload to get its emoji.
        if (!seduta.dispositivi.some((d) => d.id === dispositivoId)) void this.caricaSeduta().catch(() => undefined);
        break;
      }
      case 'PIATTO_ESAURITO':
      case 'PIATTO_RIPRISTINATO': {
        // Menu-wide: the dish is shown as sold out (or available again) at once, without reloading.
        const piattoId = String(e.payload['piattoId']);
        const disponibile = e.tipo === 'PIATTO_RIPRISTINATO';
        this.menu.update((m) =>
          m ? { ...m, piatti: m.piatti.map((p) => (p.id === piattoId ? { ...p, disponibile } : p)) } : m,
        );
        break;
      }
      case 'GIRO_APPROVATO':
      case 'GIRO_RIFIUTATO':
        this.mostraNotifica({
          tipo: e.tipo === 'GIRO_APPROVATO' ? 'APPROVATO' : 'RIFIUTATO',
          numero: Number(e.payload['numero']),
          motivo: typeof e.payload['motivo'] === 'string' ? e.payload['motivo'] : null,
        });
        void this.caricaSeduta().catch(() => undefined);
        break;
      case 'GIRO_INVIATO':
      case 'TEMPO_SCADUTO':
      case 'TEMPO_ESTESO':
      case 'DISPOSITIVO_UNITO':
      case 'COPERTI_MODIFICATI':
      case 'TAVOLO_SPOSTATO':
      case 'TAVOLI_UNITI':
        void this.caricaSeduta().catch(() => undefined);
        break;
    }
  }
}
