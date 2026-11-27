import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { GiroCassaDto } from '@kikko/shared';
import { MOTIVI_RIFIUTO } from '@kikko/shared/browser';
import { CassaStore } from './cassa.store';

/**
 * Rounds waiting for approval (CLAUDE.md §3 step 5).
 * The manager types each round into the restaurant's own cash register by hand, so the round opens in a detail
 * view by itself when it arrives: each dish can be ticked as "loaded" while typing it, then approved or rejected.
 * After that the next round waiting opens; "All rounds" goes back to the queue.
 */
@Component({
  selector: 'app-giri-page',
  templateUrl: './giri-page.html',
  styleUrl: './giri-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GiriPage {
  protected readonly store = inject(CassaStore);
  protected readonly motivi = MOTIVI_RIFIUTO;

  /** Round shown in the detail view (null: the queue). */
  protected readonly apertoId = signal<string | null>(null);
  protected readonly aperto = computed(() => this.store.inAttesa().find((g) => g.id === this.apertoId()) ?? null);
  /** The other rounds waiting, to switch from the detail view. */
  protected readonly altri = computed(() => this.store.inAttesa().filter((g) => g.id !== this.apertoId()));

  /** Round being rejected (dialog open). */
  protected readonly daRifiutare = signal<GiroCassaDto | null>(null);
  protected readonly motivo = signal('');
  protected readonly invio = signal(false);
  private readonly finestra = viewChild<ElementRef<HTMLDialogElement>>('finestra');

  protected readonly motivoValido = computed(() => this.motivo().trim().length > 0);

  /** Rounds already seen by this page: a new id means a round just arrived. */
  private readonly visti = new Set<string>();
  private primoCaricamento = true;

  constructor() {
    effect(() => {
      if (!this.store.coda()) return;
      const attesa = this.store.inAttesa();
      const arrivati = attesa.some((g) => !this.visti.has(g.id));
      attesa.forEach((g) => this.visti.add(g.id));
      untracked(() => {
        const corrente = this.apertoId();
        if (corrente !== null && attesa.some((g) => g.id === corrente)) return;
        // The open round was handled → the next one; nothing open → open when a round arrives (or on startup).
        if (corrente !== null || arrivati || this.primoCaricamento) this.apertoId.set(attesa[0]?.id ?? null);
        this.primoCaricamento = false;
      });
    });
  }

  protected apri(g: GiroCassaDto): void {
    this.apertoId.set(g.id);
  }

  protected tornaAllaCoda(): void {
    this.apertoId.set(null);
  }

  protected pezzi(g: GiroCassaDto): number {
    return g.voci.filter((v) => v.inFormula).reduce((t, v) => t + v.quantita, 0);
  }

  protected extra(g: GiroCassaDto): number {
    return g.voci.filter((v) => !v.inFormula).reduce((t, v) => t + v.quantita, 0);
  }

  protected attesa(g: GiroCassaDto): string {
    const minuti = this.store.minutiAttesa(g);
    return minuti < 1 ? 'adesso' : `da ${minuti} min`;
  }

  protected orario(iso: string | null): string {
    return iso ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  protected approva(g: GiroCassaDto): void {
    void this.store.approva(g);
  }

  protected apriRifiuto(g: GiroCassaDto): void {
    this.daRifiutare.set(g);
    this.motivo.set('');
    this.finestra()?.nativeElement.showModal();
  }

  protected chiudiRifiuto(): void {
    this.finestra()?.nativeElement.close();
    this.daRifiutare.set(null);
  }

  protected async rifiuta(): Promise<void> {
    const g = this.daRifiutare();
    const motivo = this.motivo().trim();
    if (!g || !motivo) return;
    this.invio.set(true);
    this.chiudiRifiuto();
    await this.store.rifiuta(g, motivo);
    this.invio.set(false);
  }
}
