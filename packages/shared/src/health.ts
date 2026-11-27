/** Response of `GET /api/health`. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  version: string;
  uptimeSeconds: number;
  time: string;
}
