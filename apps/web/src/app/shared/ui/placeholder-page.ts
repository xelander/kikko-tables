import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Temporary page for areas that will be built in later phases. */
@Component({
  selector: 'app-placeholder-page',
  imports: [RouterLink],
  template: `
    <main class="placeholder">
      <p class="placeholder__phase">{{ phase() }}</p>
      <h1>{{ heading() }}</h1>
      <p class="placeholder__text">{{ description() }}</p>
      <ng-content />
      <a routerLink="/" class="placeholder__back">Torna alla home</a>
    </main>
  `,
  styles: `
    .placeholder {
      max-width: 32rem;
      margin: 0 auto;
      padding: var(--space-8) var(--space-4);
      display: grid;
      gap: var(--space-3);
      text-align: center;
    }
    .placeholder__phase {
      margin: 0;
      justify-self: center;
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-pill);
      background: var(--color-surface-muted);
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }
    .placeholder__text {
      margin: 0;
      color: var(--color-text-muted);
    }
    .placeholder__back {
      justify-self: center;
      margin-top: var(--space-4);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderPage {
  readonly heading = input.required<string>();
  readonly description = input('');
  readonly phase = input('In arrivo');
}
