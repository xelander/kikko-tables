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
import { Router } from '@angular/router';
import type { FormulaDto, SedutaConPin, TavoloStato } from '@kikko/shared';
import { debounceTime, merge } from 'rxjs';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { StaffShell } from '../staff/staff-shell';
import { messaggioErroreStaff } from './errori';
import { TavoliApi } from './tavoli.api';
import { SOGLIA_QUASI_SCADUTO_MIN, tempoRimanente } from './tempo';

export type StatoTavolo = 'libero' | 'aperto' | 'quasi-scaduto' | 'scaduto';
export type Filtro = 'tutti' | 'aperti' | 'liberi' | 'attesa';

export function statoTavolo(t: TavoloStato, ora: number): StatoTavolo {
  if (!t.seduta) return 'libero';
  const rimasti = Date.parse(t.seduta.scadeIl) - ora;
  if (rimasti <= 0) return 'scaduto';
  return rimasti <= SOGLIA_QUASI_SCADUTO_MIN * 60_000 ? 'quasi-scaduto' : 'aperto';
}

export function filtraTavoli(tavoli: readonly TavoloStato[], filtro: Filtro, cerca: string): TavoloStato[] {
  const numero = cerca.trim();
  return tavoli.filter((t) => {
    if (numero && !String(t.numero).startsWith(numero)) return false;
    switch (filtro) {
      case 'aperti':
        return t.seduta !== null;
      case 'liberi':
        return t.seduta === null;
      case 'attesa':
        return (t.seduta?.giriInAttesa ?? 0) > 0;
      default:
        return true;
    }
  });
}

/** Events that change what the table list shows. */
const TIPI_RILEVANTI = new Set([
  'TAVOLO_APERTO',
  'TAVOLO_CHIUSO',
  'DISPOSITIVO_UNITO',
  'TEMPO_ESTESO',
  'TAVOLI_UNITI',
  'TAVOLO_SPOSTATO',
  'COPERTI_MODIFICATI',
  'GIRO_INVIATO',
  'GIRO_APPROVATO',
  'GIRO_RIFIUTATO',
  'CARRELLO_MODIFICATO',
]);

/** Waiter: list of tables (designed for phones), opening a table with covers and formula and showing the PIN. */
@Component({
  selector: 'app-tavoli-page',
  imports: [StaffShell],
  templateUrl: './tavoli-page.html',
  styleUrl: './tavoli-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TavoliPage {
  private readonly api = inject(TavoliApi);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);

  protected readonly tavoli = signal<TavoloStato[] | null>(null);
  protected readonly errore = signal<string | null>(null);
  protected readonly ora = signal(Date.now());
  protected readonly filtro = signal<Filtro>('tutti');
  protected readonly cerca = signal('');
  protected readonly selezionato = signal<TavoloStato | null>(null);
  protected readonly formule = signal<FormulaDto[]>([]);
  protected readonly formulaId = signal<string | null>(null);
  protected readonly adulti = signal(2);
  protected readonly bambini = signal(0);
  protected readonly pinMostrato = signal<SedutaConPin | null>(null);
  protected readonly lavoro = signal(false);

  protected readonly conteggi = computed(() => {
    const t = this.tavoli() ?? [];
    return {
      tutti: t.length,
      aperti: t.filter((x) => x.seduta).length,
      liberi: t.filter((x) => !x.seduta).length,
      attesa: t.filter((x) => (x.seduta?.giriInAttesa ?? 0) > 0).length,
    };
  });
  protected readonly visibili = computed(() => filtraTavoli(this.tavoli() ?? [], this.filtro(), this.cerca()));
  protected readonly filtri: { valore: Filtro; etichetta: string }[] = [
    { valore: 'tutti', etichetta: 'Tutti' },
    { valore: 'aperti', etichetta: 'Aperti' },
    { valore: 'liberi', etichetta: 'Liberi' },
    { valore: 'attesa', etichetta: 'Giro in attesa' },
  ];

  private readonly dialogo = viewChild<ElementRef<HTMLDialogElement>>('dialogo');
  protected readonly statoTavolo = statoTavolo;

  constructor() {
    void this.carica();
    merge(this.realtime.ricarica$, this.realtime.eventi$)
      .pipe(debounceTime(200), takeUntilDestroyed())
      .subscribe((e) => {
        if (!e || TIPI_RILEVANTI.has(e.tipo)) void this.carica();
      });
    const timer = setInterval(() => this.ora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected rimanente(scadeIl: string): string {
    return tempoRimanente(Date.parse(scadeIl) - this.ora());
  }

  protected async tocca(tavolo: TavoloStato): Promise<void> {
    if (tavolo.seduta) {
      await this.router.navigate(['/staff/cameriere/sedute', tavolo.seduta.id]);
      return;
    }
    this.selezionato.set(tavolo);
    this.pinMostrato.set(null);
    this.errore.set(null);
    this.adulti.set(Math.min(tavolo.posti, 2));
    this.bambini.set(0);
    this.dialogo()?.nativeElement.showModal();
    try {
      const disponibili = await this.api.formule();
      this.formule.set(disponibili.formule);
      this.formulaId.set(disponibili.propostaId ?? disponibili.formule[0]?.id ?? null);
    } catch {
      this.errore.set('Impossibile caricare le formule.');
    }
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
    this.lavoro.set(true);
    this.errore.set(null);
    try {
      this.pinMostrato.set(
        await this.api.apri(tavolo.id, { formulaId, copertiAdulti: this.adulti(), copertiBambini: this.bambini() }),
      );
      await this.carica();
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
      await this.carica();
    } finally {
      this.lavoro.set(false);
    }
  }

  protected async vaiAlTavolo(): Promise<void> {
    const pin = this.pinMostrato();
    this.chiudiDialogo();
    if (pin) await this.router.navigate(['/staff/cameriere/sedute', pin.seduta.id]);
  }

  private async carica(): Promise<void> {
    try {
      this.tavoli.set(await this.api.elenco());
      this.ora.set(Date.now());
    } catch {
      if (!this.tavoli()) this.errore.set('Impossibile caricare i tavoli.');
    }
  }
}
