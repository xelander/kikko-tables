import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RealtimeService } from './realtime.service';

/** How long "Ripristinato" stays visible after the connection comes back. */
export const DURATA_RIPRISTINO_MS = 2500;

/**
 * Connection banner (CLAUDE.md §6): "Connessione persa, riprovo…" while reconnecting,
 * then "Ripristinato" for a moment. Also reacts to the browser going offline.
 */
@Component({
  selector: 'app-connessione-banner',
  template: `
    @if (visibile()) {
      <div class="banner" [attr.data-stato]="ripristinato() ? 'ok' : 'perso'" role="status" aria-live="polite">
        <span class="banner__icona" aria-hidden="true">{{ ripristinato() ? '✓' : '⟳' }}</span>
        {{ ripristinato() ? testoRipristinato() : testoPerso() }}
      </div>
    }
  `,
  styles: `
    .banner {
      position: fixed;
      inset: var(--space-2) var(--space-2) auto;
      z-index: 1000;
      margin: 0 auto;
      max-width: 28rem;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-pill);
      box-shadow: var(--shadow-md);
      font-weight: var(--font-weight-semibold);
      animation: entra var(--duration-base) var(--easing-emphasized);
    }
    .banner[data-stato='perso'] {
      background: var(--color-warning-bg);
      color: var(--color-warning);
    }
    .banner[data-stato='ok'] {
      background: var(--color-success-bg);
      color: var(--color-success);
    }
    .banner[data-stato='perso'] .banner__icona {
      display: inline-block;
      animation: gira 1.2s linear infinite;
    }
    @keyframes entra {
      from {
        transform: translateY(-120%);
        opacity: 0;
      }
    }
    @keyframes gira {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnessioneBanner {
  private readonly realtime = inject(RealtimeService);
  readonly testoPerso = input('Connessione persa, riprovo…');
  readonly testoRipristinato = input('Ripristinato');

  private readonly online = signal(globalThis.navigator?.onLine ?? true);
  protected readonly ripristinato = signal(false);
  private readonly perso = computed(() => !this.online() || this.realtime.stato() === 'riconnessione');
  protected readonly visibile = computed(() => this.perso() || this.ripristinato());

  constructor() {
    const aggiorna = () => this.online.set(globalThis.navigator?.onLine ?? true);
    globalThis.addEventListener?.('online', aggiorna);
    globalThis.addEventListener?.('offline', aggiorna);

    let eraPerso = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const perso = this.perso();
      const connesso = this.realtime.stato() === 'connesso';
      if (perso) {
        eraPerso = true;
        clearTimeout(timer);
        this.ripristinato.set(false);
      } else if (eraPerso && connesso) {
        eraPerso = false;
        this.ripristinato.set(true);
        timer = setTimeout(() => this.ripristinato.set(false), DURATA_RIPRISTINO_MS);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      globalThis.removeEventListener?.('online', aggiorna);
      globalThis.removeEventListener?.('offline', aggiorna);
    });
  }
}
