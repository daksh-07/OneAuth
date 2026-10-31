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
    // Full suite, including real passkey ceremonies via Chrome's virtual authenticator.
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /cross-browser/ },
    // Engines without a virtual authenticator: everything except the passkey ceremony.
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] }, testMatch: /cross-browser/ },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] }, testMatch: /cross-browser/ },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /cross-browser/ },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] }, testMatch: /cross-browser/ },
  ],
  webServer: {
    command: 'npx next start -p 3000',
    // A public page: /api/health reports 503 until globalSetup (which runs after the server starts) has migrated the database.
    url: 'http://localhost:3000/how-it-works',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DATABASE_URL: E2E_DATABASE_URL, ONEAUTH_ORIGINS: 'http://localhost:3000' },
  },
});
