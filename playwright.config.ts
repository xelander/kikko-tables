import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];
// Optional: reuse a Chromium already installed on the machine (e.g. cloud dev containers).
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] || undefined;
const WEB_URL = 'http://localhost:4200';
const API_HEALTH_URL = 'http://localhost:3000/api/health';

/**
 * End-to-end tests. Starts the built API (`npm run build` first) and the Angular dev server
 * with the /api proxy; reuses servers already running locally (e.g. `npm run dev`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'off',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
  ],
  webServer: [
    {
      command: 'npm run start -w @kikko/api',
      // Many logins and PIN attempts from one machine in a few seconds: relax the public rate limit.
      env: { ...(process.env as Record<string, string>), THROTTLE_PUBLIC_LIMIT: '1000' },
      url: API_HEALTH_URL,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run serve:e2e -w @kikko/web',
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
