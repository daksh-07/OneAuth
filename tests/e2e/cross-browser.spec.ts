import { expect, test } from '@playwright/test';
import { collectConsoleErrors, expectNoA11yViolations, expectNoHorizontalOverflow, expectTouchTargets } from './helpers';

/** Ignore the expected 503 from /api/health probes and favicon noise; everything else is a failure. */
function realErrors(errors: string[]) {
  return errors.filter((e) => !/favicon/.test(e));
}

for (const path of ['/', '/how-it-works', '/signin', '/signup']) {
  test(`${path} renders cleanly`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await expectNoA11yViolations(page);
    expect(realErrors(errors)).toEqual([]);
  });
}

test('passkey sign-in is offered, or a clear fallback when the browser lacks WebAuthn', async ({ page }) => {
  await page.goto('/');
  const supported = await page.evaluate(() => typeof window.PublicKeyCredential === 'function');
  if (!supported) {
    // Playwright's Linux WebKit build ships without WebAuthn (real Safari has it).
    // That's still a useful case: the user must get an honest notice and the phone-pairing path.
    await page.goto('/signin');
    await expect(page.getByText('This browser doesn’t support passkeys')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeDisabled();
    await page.getByRole('link', { name: 'Use your phone to connect this device' }).click();
    await expect(page.getByTestId('pairing-code')).toBeVisible();
    return;
  }
  await page.goto('/signin');
  await expect(page.getByText('This browser doesn’t support passkeys')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeEnabled();
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Cross Browser');
  await expect(page.getByRole('button', { name: 'Create passkey' })).toBeEnabled();
});

test('a new device can start pairing: QR, code and countdown render', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/connect');
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByTestId('pairing-code')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByRole('timer')).toHaveText(/^[45]:\d\d$/);
  const svg = await page.getByRole('img', { name: /QR code/ }).locator('svg').boundingBox();
  // Large enough for a phone camera at arm's length.
  expect(svg!.width).toBeGreaterThanOrEqual(150);
  await expectNoHorizontalOverflow(page);
  await expectNoA11yViolations(page);
  expect(realErrors(errors)).toEqual([]);
});

test('signed-out visitors are sent to sign-in with a safe return path', async ({ page }) => {
  await page.goto('/pair/00000000-0000-4000-8000-000000000000');
  await expect(page).toHaveURL(/\/signin\?next=%2Fpair%2F00000000-0000-4000-8000-000000000000$/);
});
