import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { PiattoMenuDto } from '@kikko/shared';
import type { Lingua } from '../../../core/i18n/i18n.service';
import { Stepper } from './stepper';
import { type TestiSala, prezzo } from './testi-sala';

/** One dish in the menu list: photo, number, name, badges, who has it in the cart, stepper. */
@Component({
  selector: 'app-scheda-piatto',
  imports: [Stepper],
  template: `
    @let p = piatto();
    @let t = testi();
    <article
      class="scheda"
      [class.scheda--esaurito]="!p.disponibile"
      [attr.data-testid]="'piatto-' + (p.numero ?? p.id)"
    >
      <button type="button" class="scheda__apri" tabindex="-1" aria-hidden="true" (click)="apri.emit()">
        @if (p.immagine; as img) {
          <img
            class="scheda__foto"
            [src]="img.src240"
            [attr.srcset]="img.src240 + ' 240w, ' + img.src480 + ' 480w'"
            sizes="104px"
            [width]="img.larghezza"
            [height]="img.altezza"
            loading="lazy"
            decoding="async"
            alt=""
            [style.background-image]="'url(' + img.anteprima + ')'"
          />
        } @else {
          <span class="scheda__foto scheda__foto--vuota" aria-hidden="true">🍶</span>
        }
      </button>
      <div class="scheda__testo">
        <h3 class="scheda__nome">
          <button type="button" class="scheda__titolo" (click)="apri.emit()">
            @if (p.numero) {
              <span class="scheda__numero">{{ p.numero }}</span>
            }
            {{ nome() }}
          </button>
        </h3>
        <p class="scheda__meta">
          @if (p.pezzi) {
            <span>{{ t.pezzi(p.pezzi) }}</span>
          }
          @if (p.vegetariano) {
            <span class="badge badge--veg" [title]="t.vegetariano">🌿</span>
          }
          @if (p.piccante) {
            <span class="badge" [title]="t.piccante">🌶️</span>
          }
          @if (p.senzaGlutine) {
            <span class="badge badge--sg">{{ lingua() === 'it' ? 'SG' : 'GF' }}</span>
          }
          @if (p.prezzoExtraCent !== null) {
            <strong class="scheda__prezzo">{{ prezzoExtra() }}</strong>
          }
        </p>
        @if (p.maxPerPersona) {
          <p class="scheda__limite">{{ t.massimoPersona(p.maxPerPersona) }}</p>
        }
        @if (altri()) {
          <p class="scheda__tavolo">{{ altri() }} {{ t.alTavolo }}</p>
        }
      </div>
      <div class="scheda__azioni">
        @if (p.disponibile) {
          <app-stepper
            [valore]="quantita()"
            [puoAggiungere]="disponibili() !== 0"
            [etichettaAggiungi]="t.aggiungi(nome())"
            [etichettaTogli]="t.togli(nome())"
            (cambia)="cambia.emit($event)"
          />
        } @else {
          <span class="scheda__esaurito">{{ t.esaurito }}</span>
        }
      </div>
    </article>
  `,
  styles: `
    .scheda {
      display: grid;
      grid-template-columns: 104px 1fr auto;
      gap: var(--space-3);
      align-items: center;
      padding: var(--space-2);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--shadow-sm);
    }
    .scheda--esaurito {
      opacity: 0.55;
    }
    .scheda__apri {
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    .scheda__foto {
      display: block;
      width: 104px;
      height: 84px;
      object-fit: cover;
      border-radius: var(--radius-sm);
      background-size: cover;
      background-color: var(--color-surface-muted);
    }
    .scheda__foto--vuota {
      display: grid;
      place-items: center;
      font-size: 2rem;
    }
    .scheda__testo {
      min-width: 0;
    }
    .scheda__titolo {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .scheda__nome {
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-semibold);
      line-height: 1.25;
    }
    .scheda__numero {
      margin-right: var(--space-1);
      color: var(--color-accent);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-regular);
    }
    .scheda__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
      margin: var(--space-1) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }
    .badge--sg {
      padding: 0 6px;
      border-radius: var(--radius-pill);
      border: 1px solid currentColor;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
    }
    .scheda__prezzo {
      color: var(--color-primary);
    }
    .scheda__limite,
    .scheda__tavolo {
      margin: 2px 0 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-muted);
    }
    .scheda__limite {
      color: var(--color-primary);
      font-style: italic;
    }
    .scheda__esaurito {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-danger);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchedaPiatto {
  readonly piatto = input.required<PiattoMenuDto>();
  readonly lingua = input.required<Lingua>();
  readonly testi = input.required<TestiSala>();
  readonly quantita = input(0);
  readonly disponibili = input<number | null>(null);
  /** Emojis and quantities of the other phones, e.g. "🦊 2 · 🐼 1". */
  readonly altri = input('');
  readonly cambia = output<number>();
  readonly apri = output<void>();

  protected readonly nome = computed(() => this.piatto().nome[this.lingua()]);
  protected readonly prezzoExtra = computed(() => prezzo(this.piatto().prezzoExtraCent ?? 0, this.lingua()));
}
