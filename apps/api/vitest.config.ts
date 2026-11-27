import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://kikko:kikko@localhost:5432/kikko_test';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      THROTTLE_PUBLIC_LIMIT: '10000',
      THROTTLE_DEFAULT_LIMIT: '10000',
      // Tests call the expiry check directly, at the instant they choose.
      CONTROLLO_SCADENZE_SECONDI: '0',
      MEDIA_DIR: join(tmpdir(), 'kikko-test-media'),
    },
    // Integration tests share one database: run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
