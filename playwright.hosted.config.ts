import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the hosted verification suite against a deployed preview.
 *
 *   ONEAUTH_HOSTED_URL=https://<canonical preview origin> \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<from Vercel → Deployment Protection> \
 *   npx playwright test -c playwright.hosted.config.ts
 *
 * Never resets data: the suite creates throwaway accounts and deletes them at the end.
 */
const baseURL = process.env.ONEAUTH_HOSTED_URL;
if (!baseURL) throw new Error('Set ONEAUTH_HOSTED_URL to the canonical preview origin.');
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: 'tests/hosted',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    extraHTTPHeaders: bypass ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'samesitenone' } : {},
    ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
  },
});
