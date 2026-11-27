import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { puo } from '../../core/auth/staff.guard';
import { StaffAuthService } from '../../core/auth/staff-auth.service';
import { ConnessioneBanner } from '../../core/realtime/connessione-banner';
import { RealtimeService } from '../../core/realtime/realtime.service';

/**
 * Header shared by staff pages: who is logged in, links between areas (manager: hall ↔ till),
 * device registration, logout and connection banner.
 */
@Component({
  selector: 'app-staff-shell',
  imports: [ConnessioneBanner, RouterLink, RouterLinkActive],
  template: `
    <app-connessione-banner />
    <header class="barra">
      <strong class="barra__titolo">{{ titolo() }}</strong>
      @if (aree()) {
        <nav class="barra__aree" aria-label="Aree">
          <a routerLink="/staff/cameriere" routerLinkActive="attiva" ariaCurrentWhenActive="page">Sala</a>
          <a routerLink="/staff/cassa" routerLinkActive="attiva" ariaCurrentWhenActive="page">Cassa</a>
        </nav>
      }
      <span class="barra__utente">
        {{ auth.utente()?.nome }}
        @if (auth.sessione()?.dispositivo; as d) {
          <span class="barra__device">· {{ d.nome }}</span>
        }
      </span>
      @if (puoRegistrare()) {
        <button type="button" class="barra__azione" (click)="registra()">Rendi condiviso</button>
      }
      <button type="button" class="barra__azione" (click)="esci()">Esci</button>
    </header>
    @if (messaggio(); as m) {
      <p class="messaggio" role="status">{{ m }}</p>
    }
    <ng-content />
  `,
  styles: `
    .barra {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      padding: var(--space-2) var(--space-4);
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    }
    .barra__titolo {
      font-size: var(--font-size-lg);
    }
    .barra__aree {
      display: flex;
      gap: var(--space-1);

      a {
        display: inline-flex;
        align-items: center;
        min-height: 2.5rem;
        padding: 0 var(--space-3);
        border-radius: var(--radius-pill);
        color: var(--color-text);
        font-weight: var(--font-weight-semibold);
        text-decoration: none;
      }

      a.attiva {
        background: var(--color-text);
        color: var(--color-bg);
      }
    }
    .barra__utente {
      flex: 1;
      color: var(--color-text-muted);
    }
    .barra__azione {
      min-height: var(--touch-target);
      padding: 0 var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-pill);
      background: var(--color-surface);
      font: inherit;
      cursor: pointer;
    }
    .messaggio {
      margin: var(--space-2) var(--space-4) 0;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      background: var(--color-success-bg);
      color: var(--color-success);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffShell {
  protected readonly auth = inject(StaffAuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly router = inject(Router);

  readonly titolo = input('Sala');
  protected readonly messaggio = signal<string | null>(null);
  private readonly registrato = signal(false);
  /** Managers work both in the hall and at the till. */
  protected readonly aree = computed(() => puo(this.auth.utente()?.ruolo, 'CAPO'));
  protected readonly puoRegistrare = computed(
    () => puo(this.auth.utente()?.ruolo, 'CAPO') && !this.auth.sessione()?.dispositivo && !this.registrato(),
  );

  constructor() {
    const utente = this.auth.utente();
    if (utente) this.realtime.avvia({ modo: 'staff', chiave: utente.id });
  }

  protected async registra(): Promise<void> {
    const nome = globalThis.prompt?.('Nome di questo dispositivo (es. Tablet cassa)', 'Tablet sala')?.trim();
    if (!nome) return;
    try {
      await this.auth.registraDispositivo(nome);
      this.registrato.set(true);
      this.messaggio.set(`"${nome}" è ora un dispositivo condiviso: lo staff potrà entrare con il PIN personale.`);
    } catch {
      this.messaggio.set('Registrazione non riuscita.');
    }
  }

  protected async esci(): Promise<void> {
    this.realtime.ferma();
    await this.auth.logout();
    await this.router.navigateByUrl('/staff/login');
  }
}
