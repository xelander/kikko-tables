import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ErroreJoin, StatoTavoloCliente } from '@kikko/shared';
import { I18nService, LINGUE, type Lingua } from '../../core/i18n/i18n.service';
import { ConnessioneBanner } from '../../core/realtime/connessione-banner';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ClienteApi } from './cliente.api';
import { SalaCliente } from './sala/sala-cliente';
import { TESTI } from './testi';

type Vista =
  | { tipo: 'caricamento' }
  | { tipo: 'inesistente' }
  | { tipo: 'chiuso' }
  | { tipo: 'errore' }
  | { tipo: 'stato'; stato: StatoTavoloCliente };

/** While the table is not active, check again every so often. */
const ATTESA_NON_ATTIVO_MS = 15_000;

/**
 * Customer entry point from the table QR code (`/t/:slug`): "table not active", PIN entry with
 * lockout feedback, then the connected screen (the menu arrives in F2).
 */
@Component({
  selector: 'app-tavolo-page',
  imports: [ConnessioneBanner, SalaCliente],
  templateUrl: './tavolo-page.html',
  styleUrl: './tavolo-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TavoloPage {
  private readonly api = inject(ClienteApi);
  private readonly realtime = inject(RealtimeService);
  protected readonly i18n = inject(I18nService);

  /** Bound from the route parameter `:slug`. */
  readonly slug = input.required<string>();

  protected readonly t = computed(() => TESTI[this.i18n.lingua()]);
  protected readonly lingue = LINGUE;
  protected readonly vista = signal<Vista>({ tipo: 'caricamento' });
  protected readonly pin = signal('');
  protected readonly soprannome = signal('');
  protected readonly invio = signal(false);
  protected readonly errore = signal<string | null>(null);
  protected readonly bloccatoFino = signal(0);
  protected readonly ora = signal(Date.now());

  /** Joined: the ordering screen takes the whole page. */
  protected readonly connesso = computed(() => {
    const v = this.vista();
    return v.tipo === 'stato' && v.stato.stato === 'CONNESSO';
  });
  protected readonly secondiBlocco = computed(() => Math.max(0, Math.ceil((this.bloccatoFino() - this.ora()) / 1000)));
  protected readonly minutiRimasti = computed(() => {
    const v = this.vista();
    return v.tipo === 'stato' && v.stato.stato === 'CONNESSO'
      ? Math.ceil((Date.parse(v.stato.scadeIl) - this.ora()) / 60_000)
      : 0;
  });

  constructor() {
    const timer = setInterval(() => this.ora.set(Date.now()), 1_000);
    let attesa: ReturnType<typeof setTimeout> | undefined;
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(attesa);
      this.realtime.ferma();
    });

    effect(() => void this.carica(this.slug()));

    // Not active yet: try again by itself every 15 seconds.
    effect(() => {
      const v = this.vista();
      clearTimeout(attesa);
      if (v.tipo === 'stato' && v.stato.stato === 'NON_ATTIVO') {
        attesa = setTimeout(() => void this.carica(this.slug()), ATTESA_NON_ATTIVO_MS);
      }
    });

    this.realtime.terminata$.pipe(takeUntilDestroyed()).subscribe((m) => {
      // Merged with another table: the same cookie now belongs to the merged session, reload and follow it.
      if (m.motivo === 'TAVOLI_UNITI') void this.carica(this.slug());
      else this.vista.set({ tipo: 'chiuso' });
    });
    this.realtime.eventi$.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e.tipo === 'TAVOLO_CHIUSO') this.vista.set({ tipo: 'chiuso' });
      if (e.tipo === 'TEMPO_ESTESO') void this.carica(this.slug());
    });
  }

  protected scegliLingua(lingua: Lingua): void {
    this.i18n.imposta(lingua);
  }

  protected scriviPin(valore: string): void {
    this.pin.set(valore.replace(/\D/g, '').slice(0, 4));
    this.errore.set(null);
  }

  protected async entra(): Promise<void> {
    if (this.pin().length !== 4 || this.invio() || this.secondiBlocco() > 0) return;
    this.invio.set(true);
    this.errore.set(null);
    try {
      await this.api.unisciti(this.slug(), { pin: this.pin(), soprannome: this.soprannome() || undefined });
      await this.carica(this.slug());
    } catch (error) {
      this.pin.set('');
      this.gestisciErrore(error);
    } finally {
      this.invio.set(false);
    }
  }

  protected async riprova(): Promise<void> {
    await this.carica(this.slug());
  }

  private blocca(secondi: number): void {
    const ora = Date.now();
    this.ora.set(ora);
    this.bloccatoFino.set(ora + secondi * 1000);
  }

  private gestisciErrore(error: unknown): void {
    const t = this.t();
    if (!(error instanceof HttpErrorResponse) || error.status === 0) {
      this.errore.set(t.erroreRete);
      return;
    }
    const corpo = error.error as ErroreJoin | null;
    if (corpo?.codice === 'BLOCCATO') {
      this.blocca(corpo.riprovaTraSecondi);
    } else if (corpo?.codice === 'PIN_ERRATO') {
      this.errore.set(t.pinErrato(corpo.tentativiRimasti));
    } else if (corpo?.codice === 'NON_ATTIVO') {
      void this.carica(this.slug());
    } else {
      this.errore.set(t.erroreRete);
    }
  }

  private async carica(slug: string): Promise<void> {
    try {
      const stato = await this.api.stato(slug);
      this.vista.set({ tipo: 'stato', stato });
      if (stato.stato === 'PIN_RICHIESTO' && stato.bloccatoPerSecondi > 0) this.blocca(stato.bloccatoPerSecondi);
      if (stato.stato === 'CONNESSO') this.realtime.avvia({ modo: 'cliente', chiave: stato.sedutaId });
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) this.vista.set({ tipo: 'inesistente' });
      else if (this.vista().tipo === 'caricamento') this.vista.set({ tipo: 'errore' });
    }
  }
}
