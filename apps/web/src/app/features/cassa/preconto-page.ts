import { ChangeDetectionStrategy, Component, ViewEncapsulation, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { PrecontoDto } from '@kikko/shared';
import { messaggioErroreStaff } from '../cameriere/errori';
import { TavoliApi } from '../cameriere/tavoli.api';
import { CassaApi } from './cassa.api';
import { CassaStore } from './cassa.store';

/**
 * Pre-bill of a table, printable on an 80 mm receipt printer (or A4), then table closing.
 * It is not a fiscal receipt (CLAUDE.md §9): the cash register issues that.
 */
@Component({
  selector: 'app-preconto-page',
  imports: [RouterLink],
  templateUrl: './preconto-page.html',
  styleUrl: './preconto-page.scss',
  // Print rules must reach the whole page (hide the header, tabs, buttons).
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrecontoPage {
  private readonly api = inject(CassaApi);
  private readonly tavoliApi = inject(TavoliApi);
  private readonly store = inject(CassaStore);
  private readonly router = inject(Router);

  /** Route parameter. */
  readonly sedutaId = input.required<string>();

  protected readonly preconto = signal<PrecontoDto | null>(null);
  protected readonly errore = signal<string | null>(null);
  protected readonly lavoro = signal(false);

  constructor() {
    effect(() => void this.genera(this.sedutaId()));
  }

  protected euro(cent: number): string {
    const valuta = this.preconto()?.valuta ?? 'EUR';
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: valuta }).format(cent / 100);
  }

  protected data(iso: string): string {
    return new Date(iso).toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected stampa(): void {
    globalThis.print?.();
  }

  protected async chiudi(): Promise<void> {
    const p = this.preconto();
    if (!p) return;
    const attesa =
      p.giriInAttesa > 0
        ? ` Attenzione: ${p.giriInAttesa === 1 ? 'c’è 1 giro' : `ci sono ${p.giriInAttesa} giri`} ancora da approvare.`
        : '';
    const conferma = `Chiudere il tavolo ${p.tavoli.join('+')}? I telefoni del tavolo vengono scollegati.${attesa}`;
    if (globalThis.confirm && !globalThis.confirm(conferma)) return;
    this.lavoro.set(true);
    this.errore.set(null);
    try {
      await this.tavoliApi.chiudi(p.sedutaId);
      await this.store.carica();
      await this.router.navigate(['/staff/cassa/tavoli']);
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
    } finally {
      this.lavoro.set(false);
    }
  }

  private async genera(id: string): Promise<void> {
    this.errore.set(null);
    try {
      this.preconto.set(await this.api.preconto(id));
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
    }
  }
}
