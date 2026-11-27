import { httpResource } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed } from '@angular/core';
import type { HealthResponse } from '@kikko/shared';

export type ApiStatus = 'loading' | 'ok' | 'degraded' | 'offline';

/** Reads `GET /api/health` and exposes a simple status for the UI. */
@Injectable({ providedIn: 'root' })
export class HealthService {
  readonly health = httpResource<HealthResponse>(() => '/api/health');

  readonly status = computed<ApiStatus>(() => {
    if (this.health.isLoading()) return 'loading';
    const error = this.health.error();
    if (error) {
      // 503 means the API answered but the database is down.
      return error instanceof HttpErrorResponse && error.status === 503 ? 'degraded' : 'offline';
    }
    return this.health.value()?.status === 'ok' ? 'ok' : 'degraded';
  });

  readonly version = computed(() => (this.health.hasValue() ? this.health.value().version : null));

  reload(): void {
    this.health.reload();
  }
}
