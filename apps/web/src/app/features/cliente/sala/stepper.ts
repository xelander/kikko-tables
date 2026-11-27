import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** − quantity + with large touch targets and a small bump animation when the value changes. */
@Component({
  selector: 'app-stepper',
  template: `
    <div class="stepper" [class.stepper--vuoto]="valore() === 0">
      @if (valore() > 0) {
        <button
          type="button"
          class="stepper__btn"
          [attr.aria-label]="etichettaTogli()"
          (click)="cambia.emit(valore() - 1); $event.stopPropagation()"
        >
          −
        </button>
        @for (v of [valore()]; track v) {
          <span class="stepper__valore" aria-live="polite">{{ v }}</span>
        }
      }
      <button
        type="button"
        class="stepper__btn stepper__btn--piu"
        [disabled]="!puoAggiungere()"
        [attr.aria-label]="etichettaAggiungi()"
        (click)="cambia.emit(valore() + 1); $event.stopPropagation()"
      >
        +
      </button>
    </div>
  `,
  styles: `
    .stepper {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: 3px;
      border-radius: var(--radius-pill);
      background: var(--color-primary);
      color: var(--color-on-primary);
      transition: background-color var(--duration-base) var(--easing-standard);
    }
    .stepper--vuoto {
      background: transparent;
    }
    .stepper__btn {
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: var(--radius-pill);
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 1.35rem;
      line-height: 1;
      cursor: pointer;
    }
    .stepper__btn--piu {
      background: var(--color-primary);
      color: var(--color-on-primary);
      box-shadow: var(--shadow-sm);
    }
    .stepper__btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .stepper__btn:active:not(:disabled) {
      transform: scale(0.9);
    }
    .stepper__valore {
      min-width: 1.5ch;
      text-align: center;
      font-weight: var(--font-weight-bold);
      animation: bump var(--duration-base) var(--easing-emphasized);
    }
    @keyframes bump {
      from {
        transform: scale(1.6);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Stepper {
  readonly valore = input.required<number>();
  readonly puoAggiungere = input(true);
  readonly etichettaAggiungi = input('+');
  readonly etichettaTogli = input('−');
  readonly cambia = output<number>();
}
