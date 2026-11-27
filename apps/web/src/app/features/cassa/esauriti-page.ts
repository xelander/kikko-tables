import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { PiattoCassaDto } from '@kikko/shared';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { messaggioErroreStaff } from '../cameriere/errori';
import { CassaApi } from './cassa.api';

/** Sold-out dishes: switching one off hides it from every open menu at once (CLAUDE.md §4). */
@Component({
  selector: 'app-esauriti-page',
  template: `
    <main class="pagina">
      <h1>Piatti esauriti</h1>
      <div class="strumenti">
        <label class="visually-hidden" for="cerca-piatto">Cerca piatto</label>
        <input
          id="cerca-piatto"
          class="cerca"
          placeholder="Cerca per numero o nome"
          [value]="cerca()"
          (input)="cerca.set($any($event.target).value)"
        />
        <button
          type="button"
          class="bottone"
          [attr.aria-pressed]="soloEsauriti()"
          (click)="soloEsauriti.update((v) => !v)"
        >
          Solo esauriti <span class="n">{{ esauriti() }}</span>
        </button>
      </div>
      @if (errore(); as e) {
        <p class="errore" role="alert">{{ e }}</p>
      }

      @if (piatti()) {
        @for (g of gruppi(); track g.categoria) {
          <section>
            <h2>{{ g.categoria }}</h2>
            <ul class="lista">
              @for (p of g.piatti; track p.id) {
                <li class="piatto" [class.piatto--esaurito]="!p.disponibile">
                  <span class="piatto__nome">
                    @if (p.numero) {
                      <span class="piatto__numero">{{ p.numero }}</span>
                    }
                    {{ p.nome }}
                    @if (!p.inFormula) {
                      <span class="etichetta">extra</span>
                    }
                  </span>
                  <button
                    type="button"
                    role="switch"
                    class="interruttore"
                    [attr.aria-checked]="p.disponibile"
                    [attr.aria-label]="p.nome + ': disponibile'"
                    [attr.data-testid]="'disponibile-' + (p.numero ?? p.id)"
                    (click)="cambia(p)"
                  >
                    <span class="interruttore__testo">{{ p.disponibile ? 'Disponibile' : 'Esaurito' }}</span>
                  </button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <p class="vuoto">Nessun piatto trovato.</p>
        }
      } @else if (!errore()) {
        <p class="vuoto">Caricamento piatti…</p>
      }
    </main>
  `,
  styleUrl: './esauriti-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EsauritiPage {
  private readonly api = inject(CassaApi);

  protected readonly piatti = signal<PiattoCassaDto[] | null>(null);
  protected readonly cerca = signal('');
  protected readonly soloEsauriti = signal(false);
  protected readonly errore = signal<string | null>(null);

  protected readonly esauriti = computed(() => (this.piatti() ?? []).filter((p) => !p.disponibile).length);
  protected readonly gruppi = computed(() => {
    const testo = this.cerca().trim().toLowerCase();
    const gruppi: { categoria: string; piatti: PiattoCassaDto[] }[] = [];
    for (const p of this.piatti() ?? []) {
      if (this.soloEsauriti() && p.disponibile) continue;
      if (testo && !p.nome.toLowerCase().includes(testo) && !(p.numero ?? '').toLowerCase().startsWith(testo)) continue;
      const ultimo = gruppi.at(-1);
      if (ultimo?.categoria === p.categoria) ultimo.piatti.push(p);
      else gruppi.push({ categoria: p.categoria, piatti: [p] });
    }
    return gruppi;
  });

  constructor() {
    void this.carica();
    // Another tablet changed a dish: follow it.
    inject(RealtimeService)
      .eventi$.pipe(takeUntilDestroyed())
      .subscribe((e) => {
        if (e.tipo !== 'PIATTO_ESAURITO' && e.tipo !== 'PIATTO_RIPRISTINATO') return;
        const id = e.payload['piattoId'];
        this.imposta(String(id), e.tipo === 'PIATTO_RIPRISTINATO');
      });
  }

  /** Optimistic: the switch moves at once and goes back if the server refuses. */
  protected async cambia(p: PiattoCassaDto): Promise<void> {
    const disponibile = !p.disponibile;
    this.errore.set(null);
    this.imposta(p.id, disponibile);
    try {
      await this.api.disponibilita(p.id, disponibile);
    } catch (error) {
      this.imposta(p.id, !disponibile);
      this.errore.set(messaggioErroreStaff(error));
    }
  }

  private imposta(id: string, disponibile: boolean): void {
    this.piatti.update((lista) => lista?.map((p) => (p.id === id ? { ...p, disponibile } : p)) ?? null);
  }

  private async carica(): Promise<void> {
    try {
      this.piatti.set(await this.api.piatti());
    } catch (error) {
      this.errore.set(messaggioErroreStaff(error));
    }
  }
}
