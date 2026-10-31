import { defineConfig, devices } from '@playwright/test';

const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_e2e';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx next start -p 3000',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: E2E_DATABASE_URL, ONEAUTH_ORIGINS: 'http://localhost:3000' },
  },
});
