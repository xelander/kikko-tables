import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api';

/** Shared app setup, used by main.ts and by the integration tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX);
  const http: unknown = app.getHttpAdapter().getInstance();
  if (http && typeof (http as { disable?: unknown }).disable === 'function') {
    (http as { disable(setting: string): void }).disable('x-powered-by');
  }
  app.enableShutdownHooks();
  return app;
}
