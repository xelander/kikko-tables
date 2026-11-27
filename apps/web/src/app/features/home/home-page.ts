import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type ApiStatus, HealthService } from '../../core/health.service';

const STATUS_LABELS: Record<ApiStatus, string> = {
  loading: 'Verifica in corso…',
  ok: 'API online · database connesso',
  degraded: 'API online · database non raggiungibile',
  offline: 'API non raggiungibile',
};

/** Development landing page: API status and links to each area. */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly healthService = inject(HealthService);

  protected readonly status = this.healthService.status;
  protected readonly version = this.healthService.version;
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);

  protected readonly areas = [
    { link: '/t/tavolo-01', label: 'Cliente (tavolo 1)', hint: 'QR → PIN → menù' },
    { link: '/staff/cameriere', label: 'Cameriere', hint: 'Mappa tavoli e aperture' },
    { link: '/staff/cassa', label: 'Cassa', hint: 'Coda giri e conto' },
    { link: '/admin', label: 'Amministratore', hint: 'Formule, menù, report' },
    { link: '/monitor', label: 'Monitor', hint: 'Eventi e allarmi live' },
  ];

  protected reload(): void {
    this.healthService.reload();
  }
}
