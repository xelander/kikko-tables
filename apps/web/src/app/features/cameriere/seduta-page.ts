import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { MenuDto, SedutaDettaglioDto, TavoloStato } from '@kikko/shared';
import { debounceTime } from 'rxjs';
import { puo } from '../../core/auth/staff.guard';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { StaffShell } from '../staff/staff-shell';
import { messaggioErroreStaff } from './errori';
import { TavoliApi } from './tavoli.api';
import { tempoRimanente } from './tempo';

type Dialogo = 'pin' | 'coperti' | 'sposta' | 'unisci';

const STATI_GIRO: Record<string, string> = { INVIATO: 'In attesa', APPROVATO: 'Approvato', RIFIUTATO: 'Rifiutato' };

/** Waiter: an open table. Order for it, new PIN, covers, move, join or merge tables, close (manager). */
@Component({
  selector: 'app-seduta-page',
  imports: [StaffShell, RouterLink],
  templateUrl: './seduta-page.html',
  styleUrl: './seduta-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SedutaPage {
  private readonly api = inject(TavoliApi);
  private readonly auth = inject(StaffAuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);

  /** Route parameter. */
  readonly sedutaId = input.required<string>();

  protected readonly seduta = signal<SedutaDettaglioDto | null>(null);
  protected readonly menu = signal<MenuDto | null>(null);
  protected readonly tavoli = signal<TavoloStato[]>([]);
  protected readonly errore = signal<string | null>(null);
  protected readonly messaggio = signal<string | null>(null);
  protected readonly lavoro = signal(false);
  protected readonly ora = signal(Date.now());
  protected readonly dialogo = signal<Dialogo | null>(null);
  protected readonly pin = signal<string | null>(null);
  protected readonly adulti = signal(0);
  protected readonly bambini = signal(0);
  protected readonly daTavoloId = signal<string | null>(null);

  protected readonly puoChiudere = computed(() => puo(this.auth.utente()?.ruolo, 'CAPO'));
  protected readonly nomi = computed(() => new Map((this.menu()?.piatti ?? []).map((p) => [p.id, p.nome.it])));
  protected readonly emoji = computed(() => new Map((this.seduta()?.dispositivi ?? []).map((d) => [d.id, d.emoji])));
  protected readonly telefoni = computed(() => (this.seduta()?.dispositivi ?? []).filter((d) => !d.staff));
  protected readonly liberi = computed(() => this.tavoli().filter((t) => !t.seduta));
  /** Other open tables with the same formula, which can be merged into this one. */
  protected readonly unibili = computed(() => {
    const s = this.seduta();
    if (!s) return [];
    const viste = new Set<string>();
    return this.tavoli().filter((t) => {
      const altra = t.seduta;
      if (!altra || altra.id === s.sedutaId || altra.formula.codice !== s.formula.codice || viste.has(altra.id))
        return false;
      viste.add(altra.id);
      return true;
    });
  });
  protected readonly carrello = computed(() => {
    const righe = new Map<string, { nome: string; totale: number; chi: string[] }>();
    for (const r of this.seduta()?.carrello ?? []) {
      const riga = righe.get(r.piattoId) ?? { nome: this.nomi().get(r.piattoId) ?? '…', totale: 0, chi: [] };
      riga.totale += r.quantita;
      riga.chi.push(`${this.emoji().get(r.dispositivoId) ?? '🙂'} ${r.quantita}`);
      righe.set(r.piattoId, riga);
    }
    return [...righe.values()];
  });

  private readonly finestra = viewChild<ElementRef<HTMLDialogElement>>('finestra');
  protected readonly statiGiro = STATI_GIRO;

  constructor() {
    effect(() => void this.carica(this.sedutaId()));
    void this.api.menu().then(
      (m) => this.menu.set(m),
      () => undefined,
    );
    this.realtime.eventi$.pipe(takeUntilDestroyed()).subscribe((e) => {
      const id = this.sedutaId();
      if (e.tipo === 'TAVOLI_UNITI' && e.payload['sedutaAssorbitaId'] === id && e.sedutaId) {
        void this.router.navigate(['/staff/cameriere/sedute', e.sedutaId]);
      } else if (e.tipo === 'TAVOLO_CHIUSO' && e.sedutaId === id) {
        void this.router.navigate(['/staff/cameriere']);
      }
    });
    this.realtime.eventi$.pipe(debounceTime(200), takeUntilDestroyed()).subscribe((e) => {
      if (e.sedutaId === this.sedutaId()) void this.carica(this.sedutaId());
    });
    const timer = setInterval(() => this.ora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected rimanente(scadeIl: string): string {
    return tempoRimanente(Date.parse(scadeIl) - this.ora());
  }

  protected orario(iso: string): string {
    return new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }

  protected nome(piattoId: string): string {
    return this.nomi().get(piattoId) ?? '…';
  }

  protected apriDialogo(d: Dialogo): void {
    const s = this.seduta();
    if (!s) return;
    this.errore.set(null);
    if (d === 'coperti') {
      this.adulti.set(s.copertiAdulti);
      this.bambini.set(s.copertiBambini);
    }
    if (d === 'sposta') this.daTavoloId.set(s.tavoli[0]?.id ?? null);
    if (d === 'sposta' || d === 'unisci')
      void this.api.elenco().then(
        (t) => this.tavoli.set(t),
        () => undefined,
      );
    this.dialogo.set(d);
    this.finestra()?.nativeElement.showModal();
  }

  protected chiudiDialogo(): void {
    this.finestra()?.nativeElement.close();
    this.dialogo.set(null);
    this.pin.set(null);
  }

  protected cambia(quale: 'adulti' | 'bambini', delta: number): void {
    (quale === 'adulti' ? this.adulti : this.bambini).update((v) => Math.max(0, Math.min(50, v + delta)));
  }

  protected async nuovoPin(): Promise<void> {
    await this.esegui(async () => {
      const r = await this.api.rigeneraPin(this.sedutaId());
      this.pin.set(r.pin);
      this.dialogo.set('pin');
      this.finestra()?.nativeElement.showModal();
    }, false);
  }

  protected async salvaCoperti(): Promise<void> {
    await this.esegui(async () => {
      await this.api.coperti(this.sedutaId(), { copertiAdulti: this.adulti(), copertiBambini: this.bambini() });
      this.messaggio.set('Coperti aggiornati.');
    });
  }

  protected async sposta(aTavoloId: string, numero: number): Promise<void> {
    const da = this.daTavoloId();
    if (!da) return;
    await this.esegui(async () => {
      await this.api.sposta(this.sedutaId(), da, aTavoloId);
      this.messaggio.set(`Tavolo spostato al ${numero}.`);
    });
  }

  protected async aggiungi(tavoloId: string, numero: number): Promise<void> {
    await this.esegui(async () => {
      await this.api.aggiungiTavolo(this.sedutaId(), tavoloId);
      this.messaggio.set(`Tavolo ${numero} unito.`);
    });
  }

  protected async unisci(t: TavoloStato): Promise<void> {
    const altra = t.seduta;
    if (!altra) return;
    const conferma = `Unire il tavolo ${altra.tavoli.join('+')} a questo? Telefoni, carrello e giri passano qui e i coperti si sommano.`;
    if (globalThis.confirm && !globalThis.confirm(conferma)) return;
    await this.esegui(async () => {
      await this.api.unisci(this.sedutaId(), altra.id);
      this.messaggio.set(`Tavolo ${altra.tavoli.join('+')} unito.`);
    });
  }

  protected async chiudiTavolo(): Promise<void> {
    const s = this.seduta();
    if (!s) return;
    if (globalThis.confirm && !globalThis.confirm(`Chiudere il tavolo ${s.tavoli.map((t) => t.numero).join('+')}?`))
      return;
    await this.esegui(async () => {
      await this.api.chiudi(s.sedutaId);
      await this.router.navigate(['/staff/cameriere']);
    }, false);
  }

  private async esegui(fn: () => Promise<void>, chiudi = true): Promise<void> {
    this.lavoro.set(true);
    this.errore.set(null);
    this.messaggio.set(null);
    try {
      await fn();
      if (chiudi) this.chiudiDialogo();
      await this.carica(this.sedutaId());
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
    } finally {
      this.lavoro.set(false);
    }
  }

  private async carica(id: string): Promise<void> {
    try {
      this.seduta.set(await this.api.dettaglio(id));
      this.ora.set(Date.now());
    } catch (error) {
      if (!this.seduta()) this.errore.set(messaggioErroreStaff(error));
    }
  }
}
