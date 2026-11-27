import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormulaDto, SedutaConPin, TavoloStato } from '@kikko/shared';
import { debounceTime, merge } from 'rxjs';
import { puo } from '../../core/auth/staff.guard';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { StaffShell } from '../staff/staff-shell';
import { TavoliApi } from './tavoli.api';
import { SOGLIA_QUASI_SCADUTO_MIN, tempoRimanente } from './tempo';

export type StatoTavolo = 'libero' | 'aperto' | 'quasi-scaduto' | 'scaduto';

export function statoTavolo(t: TavoloStato, ora: number): StatoTavolo {
  if (!t.seduta) return 'libero';
  const rimasti = Date.parse(t.seduta.scadeIl) - ora;
  if (rimasti <= 0) return 'scaduto';
  return rimasti <= SOGLIA_QUASI_SCADUTO_MIN * 60_000 ? 'quasi-scaduto' : 'aperto';
}

/** Events that change what the table map shows. */
const TIPI_RILEVANTI = new Set([
  'TAVOLO_APERTO',
  'TAVOLO_CHIUSO',
  'DISPOSITIVO_UNITO',
  'TEMPO_ESTESO',
  'TAVOLI_UNITI',
  'TAVOLO_SPOSTATO',
]);

/** Waiter: table map, opening with covers and formula, PIN, minimal closing (F1). */
@Component({
  selector: 'app-tavoli-page',
  imports: [StaffShell],
  templateUrl: './tavoli-page.html',
  styleUrl: './tavoli-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TavoliPage {
  private readonly api = inject(TavoliApi);
  private readonly auth = inject(StaffAuthService);
  private readonly realtime = inject(RealtimeService);

  protected readonly tavoli = signal<TavoloStato[] | null>(null);
  protected readonly errore = signal<string | null>(null);
  protected readonly ora = signal(Date.now());
  protected readonly selezionato = signal<TavoloStato | null>(null);
  protected readonly formule = signal<FormulaDto[]>([]);
  protected readonly formulaId = signal<string | null>(null);
  protected readonly adulti = signal(2);
  protected readonly bambini = signal(0);
  protected readonly pinMostrato = signal<SedutaConPin | null>(null);
  protected readonly lavoro = signal(false);
  protected readonly puoChiudere = computed(() => puo(this.auth.utente()?.ruolo, 'CAPO'));

  protected readonly riepilogo = computed(() => {
    const tavoli = this.tavoli() ?? [];
    return { liberi: tavoli.filter((t) => !t.seduta).length, aperti: tavoli.filter((t) => t.seduta).length };
  });

  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');

  protected readonly statoTavolo = statoTavolo;

  protected rimanente(scadeIl: string): string {
    return tempoRimanente(Date.parse(scadeIl) - this.ora());
  }

  protected orario(iso: string): string {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  constructor() {
    void this.carica();
    merge(this.realtime.ricarica$, this.realtime.eventi$)
      .pipe(debounceTime(150), takeUntilDestroyed())
      .subscribe((e) => {
        if (!e || TIPI_RILEVANTI.has(e.tipo)) void this.carica();
      });
    const timer = setInterval(() => this.ora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected async seleziona(tavolo: TavoloStato): Promise<void> {
    this.selezionato.set(tavolo);
    this.pinMostrato.set(null);
    this.errore.set(null);
    if (!tavolo.seduta) {
      this.adulti.set(Math.min(tavolo.posti, 2));
      this.bambini.set(0);
      try {
        const disponibili = await this.api.formule();
        this.formule.set(disponibili.formule);
        this.formulaId.set(disponibili.propostaId ?? disponibili.formule[0]?.id ?? null);
      } catch {
        this.errore.set('Impossibile caricare le formule.');
      }
    }
    this.dialogo()?.nativeElement.showModal();
  }

  protected chiudiDialogo(): void {
    this.dialogo()?.nativeElement.close();
    this.selezionato.set(null);
    this.pinMostrato.set(null);
  }

  protected cambia(quale: 'adulti' | 'bambini', delta: number): void {
    const s = quale === 'adulti' ? this.adulti : this.bambini;
    s.update((v) => Math.max(0, Math.min(50, v + delta)));
  }

  protected async apri(): Promise<void> {
    const tavolo = this.selezionato();
    const formulaId = this.formulaId();
    if (!tavolo || !formulaId || this.adulti() + this.bambini() < 1) return;
    await this.azione(async () => {
      this.pinMostrato.set(
        await this.api.apri(tavolo.id, { formulaId, copertiAdulti: this.adulti(), copertiBambini: this.bambini() }),
      );
    });
  }

  protected async nuovoPin(): Promise<void> {
    const seduta = this.selezionato()?.seduta;
    if (!seduta) return;
    await this.azione(async () => this.pinMostrato.set(await this.api.rigeneraPin(seduta.id)));
  }

  protected async chiudiTavolo(): Promise<void> {
    const tavolo = this.selezionato();
    if (!tavolo?.seduta) return;
    if (globalThis.confirm && !globalThis.confirm(`Chiudere il tavolo ${tavolo.numero}?`)) return;
    await this.azione(async () => {
      await this.api.chiudi(tavolo.seduta!.id);
      this.chiudiDialogo();
    });
  }

  private async azione(fn: () => Promise<void>): Promise<void> {
    this.lavoro.set(true);
    this.errore.set(null);
    try {
      await fn();
      await this.carica();
    } catch (error) {
      const codice = error instanceof HttpErrorResponse ? (error.error as { codice?: string } | null)?.codice : null;
      this.errore.set(
        codice === 'TAVOLO_GIA_APERTO'
          ? 'Il tavolo è già stato aperto da un collega.'
          : codice === 'SEDUTA_CHIUSA'
            ? 'Il tavolo è già stato chiuso.'
            : 'Operazione non riuscita, riprova.',
      );
      await this.carica();
    } finally {
      this.lavoro.set(false);
    }
  }

  private async carica(): Promise<void> {
    try {
      const tavoli = await this.api.elenco();
      this.tavoli.set(tavoli);
      this.ora.set(Date.now());
      const sel = this.selezionato();
      if (sel && !this.pinMostrato()) this.selezionato.set(tavoli.find((t) => t.id === sel.id) ?? null);
    } catch {
      if (!this.tavoli()) this.errore.set('Impossibile caricare i tavoli.');
    }
  }
}
