import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StaffShell } from '../staff/staff-shell';
import { CassaStore } from './cassa.store';

/** Till area: tabs (rounds, tables, sold out), alarms and sounds, around the current page. */
@Component({
  selector: 'app-cassa-layout',
  imports: [StaffShell, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <app-staff-shell titolo="Cassa">
      <div class="cassa" (pointerdown)="tocco()">
        <nav class="schede" aria-label="Sezioni della cassa">
          <a
            class="scheda"
            routerLink="/staff/cassa"
            routerLinkActive="attiva"
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: true }"
          >
            Giri
            @if (store.inAttesa().length; as n) {
              <span class="badge" data-testid="badge-giri">{{ n }}</span>
            }
          </a>
          <a class="scheda" routerLink="/staff/cassa/tavoli" routerLinkActive="attiva" ariaCurrentWhenActive="page">
            Tavoli
            @if (store.scaduti().length; as n) {
              <span class="badge badge--allarme">{{ n }}</span>
            }
          </a>
          <a class="scheda" routerLink="/staff/cassa/esauriti" routerLinkActive="attiva" ariaCurrentWhenActive="page">
            Esauriti
          </a>
          <button
            type="button"
            class="suoni"
            data-testid="suoni"
            [attr.aria-pressed]="store.suoni()"
            (click)="store.attivaSuoni(!store.suoni())"
          >
            {{ store.suoni() ? '🔔 Suoni attivi' : '🔕 Attiva suoni' }}
          </button>
        </nav>

        @if (store.suoni() && !store.audioPronto()) {
          <p class="nota" role="status">Tocca lo schermo per riattivare i suoni.</p>
        }
        @if (store.scaduti().length) {
          <p class="allarme" role="alert" data-testid="allarme-scaduti">
            <span>⏰ Tempo scaduto: {{ scaduti() }}</span>
            <a routerLink="/staff/cassa/tavoli">Gestisci</a>
          </p>
        }
        <router-outlet />
      </div>
    </app-staff-shell>
  `,
  styles: `
    .schede {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
      overflow-x: auto;
    }
    .scheda {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--touch-target);
      padding: 0 var(--space-4);
      border-radius: var(--radius-pill);
      color: var(--color-text);
      font-weight: var(--font-weight-semibold);
      text-decoration: none;
      white-space: nowrap;
    }
    .scheda.attiva {
      background: var(--color-text);
      color: var(--color-bg);
    }
    .badge {
      min-width: 1.5rem;
      padding: 0 var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-primary);
      color: var(--color-on-primary);
      font-size: var(--font-size-sm);
      text-align: center;
    }
    .badge--allarme {
      background: var(--color-danger);
      color: #fff;
    }
    .suoni {
      margin-left: auto;
      min-height: var(--touch-target);
      padding: 0 var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      font: inherit;
      white-space: nowrap;
      cursor: pointer;
    }
    .suoni[aria-pressed='false'] {
      border-color: var(--color-warning);
      background: var(--color-warning-bg);
    }
    .nota,
    .allarme {
      margin: var(--space-3) var(--space-4) 0;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
    }
    .nota {
      background: var(--color-warning-bg);
      color: var(--color-warning);
    }
    .allarme {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: var(--space-2);
      background: var(--color-danger);
      color: #fff;
      font-weight: var(--font-weight-semibold);
      animation: lampeggia 1.2s ease-in-out 3;

      a {
        color: inherit;
      }
    }
    @keyframes lampeggia {
      50% {
        opacity: 0.6;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .allarme {
        animation: none;
      }
    }
    @media print {
      .schede,
      .nota,
      .allarme {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CassaLayout {
  protected readonly store = inject(CassaStore);
  protected readonly scaduti = computed(() =>
    this.store
      .scaduti()
      .map((t) => `Tavolo ${t.seduta!.tavoli.join('+')}`)
      .join(', '),
  );

  /** The first tap after a reload unlocks audio again (browsers require a gesture). */
  protected tocco(): void {
    if (this.store.suoni() && !this.store.audioPronto()) this.store.sbloccaAudio();
  }
}
