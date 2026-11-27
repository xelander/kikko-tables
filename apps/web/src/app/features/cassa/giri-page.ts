import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { GiroCassaDto } from '@kikko/shared';
import { MOTIVI_RIFIUTO } from '@kikko/shared/browser';
import { CassaStore } from './cassa.store';

/** Rounds waiting for approval, oldest first (CLAUDE.md §3 step 5). */
@Component({
  selector: 'app-giri-page',
  templateUrl: './giri-page.html',
  styleUrl: './giri-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GiriPage {
  protected readonly store = inject(CassaStore);
  protected readonly motivi = MOTIVI_RIFIUTO;

  /** Round being rejected (dialog open). */
  protected readonly daRifiutare = signal<GiroCassaDto | null>(null);
  protected readonly motivo = signal('');
  protected readonly invio = signal(false);
  private readonly finestra = viewChild<ElementRef<HTMLDialogElement>>('finestra');

  protected readonly motivoValido = computed(() => this.motivo().trim().length > 0);

  protected pezzi(g: GiroCassaDto): number {
    return g.voci.filter((v) => v.inFormula).reduce((t, v) => t + v.quantita, 0);
  }

  protected extra(g: GiroCassaDto): number {
    return g.voci.filter((v) => !v.inFormula).reduce((t, v) => t + v.quantita, 0);
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
