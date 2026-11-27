import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TavoloStato } from '@kikko/shared';
import { MAX_MINUTI_EXTRA, MINUTI_EXTRA_RAPIDI } from '@kikko/shared/browser';
import { messaggioErroreStaff } from '../cameriere/errori';
import { SOGLIA_QUASI_SCADUTO_MIN, tempoRimanente } from '../cameriere/tempo';
import { CassaApi } from './cassa.api';
import { CassaStore } from './cassa.store';

type StatoTempo = 'ok' | 'quasi-scaduto' | 'scaduto';

/** Open tables at the till: time left, extra minutes (one table or all), pre-bill. */
@Component({
  selector: 'app-tavoli-cassa-page',
  imports: [RouterLink],
  templateUrl: './tavoli-cassa-page.html',
  styleUrl: './tavoli-cassa-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TavoliCassaPage {
  protected readonly store = inject(CassaStore);
  private readonly api = inject(CassaApi);

  protected readonly rapidi = MINUTI_EXTRA_RAPIDI;
  protected readonly max = MAX_MINUTI_EXTRA;
  protected readonly lavoro = signal(false);
  protected readonly errore = signal<string | null>(null);
  protected readonly messaggio = signal<string | null>(null);
  protected readonly minutiTutti = signal(15);
  private readonly finestra = viewChild<ElementRef<HTMLDialogElement>>('finestra');

  /** Expired first, then by deadline. */
  protected readonly ordinati = computed(() =>
    [...this.store.sedute()].sort((a, b) => Date.parse(a.seduta!.scadeIl) - Date.parse(b.seduta!.scadeIl)),
  );

  protected statoTempo(t: TavoloStato): StatoTempo {
    const rimasti = Date.parse(t.seduta!.scadeIl) - this.store.adesso();
    if (rimasti <= 0) return 'scaduto';
    return rimasti <= SOGLIA_QUASI_SCADUTO_MIN * 60_000 ? 'quasi-scaduto' : 'ok';
  }

  protected rimanente(t: TavoloStato): string {
    return tempoRimanente(Date.parse(t.seduta!.scadeIl) - this.store.adesso());
  }

  protected async estendi(t: TavoloStato, minuti: number): Promise<void> {
    await this.esegui(async () => {
      await this.api.estendi(t.seduta!.id, minuti);
      this.messaggio.set(`+${minuti} min al tavolo ${t.seduta!.tavoli.join('+')}.`);
    });
  }

  protected apriTutti(): void {
    this.errore.set(null);
    this.finestra()?.nativeElement.showModal();
  }

  protected chiudiTutti(): void {
    this.finestra()?.nativeElement.close();
  }

  protected impostaMinuti(valore: string): void {
    const n = Number.parseInt(valore, 10);
    this.minutiTutti.set(Number.isFinite(n) ? Math.max(1, Math.min(MAX_MINUTI_EXTRA, n)) : 1);
  }

  protected async estendiTutti(): Promise<void> {
    const minuti = this.minutiTutti();
    this.chiudiTutti();
    await this.esegui(async () => {
      const r = await this.api.estendiTutti(minuti);
      this.messaggio.set(`+${minuti} min a ${r.sedute} ${r.sedute === 1 ? 'tavolo aperto' : 'tavoli aperti'}.`);
    });
  }

  private async esegui(fn: () => Promise<void>): Promise<void> {
    this.lavoro.set(true);
    this.errore.set(null);
    this.messaggio.set(null);
    try {
      await fn();
      await this.store.caricaTavoli();
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
    } finally {
      this.lavoro.set(false);
    }
  }
}
