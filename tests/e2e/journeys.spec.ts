import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, collectConsoleErrors, expectNoA11yViolations, finishOnboarding, newDevice, signUp } from './helpers';

const SHOTS = 'test-results/screens';

test('landing page renders, is accessible and has no console errors', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your digital life.');
  await expect(page.getByRole('link', { name: 'Get started' }).first()).toBeVisible();
  await expectNoA11yViolations(page);
  const csp = (await page.request.get('/')).headers()['content-security-policy'];
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toMatch(/script-src 'self' 'nonce-/);
  expect(errors).toEqual([]);
});

test('protected pages redirect to sign-in when signed out', async ({ page }) => {
  for (const path of ['/home', '/devices', '/account', '/cloud', '/space']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/signin/);
  }
});

test('API rejects cross-origin state-changing requests', async ({ request }) => {
  const res = await request.post('/api/pairing/request', { headers: { origin: 'https://evil.example' } });
  expect(res.status()).toBe(403);
  const noOrigin = await request.post('/api/auth/login/options');
  expect(noOrigin.status()).toBe(403);
});

test('sign up with a passkey, sign out, and sign back in', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await addVirtualAuthenticator(page);
  await signUp(page, 'Jordan Lee');
  await expect(page.getByRole('heading', { name: 'You’re in, Jordan.' })).toBeVisible();
  await finishOnboarding(page);
  await expect(page.getByRole('heading', { name: 'Welcome back, Jordan' })).toBeVisible();
  await expect(page.getByText('You have only one passkey')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await expect(page.getByText('Account created')).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: 'Sign out of this device' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto('/home');
  await expect(page).toHaveURL(/\/signin/);

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await page.waitForURL('**/home');
  await expect(page.getByRole('heading', { name: 'Welcome back, Jordan' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('connect a temporary device from a phone, then revoke it', async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const owner = await phone.newPage();
  const ownerErrors = collectConsoleErrors(owner);
  await addVirtualAuthenticator(owner);
  await signUp(owner, 'Sam Rivera');
  await finishOnboarding(owner);

  const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const laptop = await newDevice(laptopCtx);
  const laptopErrors = collectConsoleErrors(laptop.page);
  await laptop.page.screenshot({ path: `${SHOTS}/connect-desktop.png` });

  await owner.goto(laptop.approveUrl);
  await expect(owner.getByRole('heading', { name: 'Connect a new device?' })).toBeVisible();
  await expect(owner.getByText('Same network as this phone')).toBeVisible();
  await expectNoA11yViolations(owner);
  await owner.screenshot({ path: `${SHOTS}/approve-mobile.png`, fullPage: true });

  await owner.getByText(laptop.code, { exact: true }).click();
  await owner.getByRole('radio', { name: /Shared or temporary/ }).click();
  await owner.getByText('1 hour', { exact: true }).click();
  await owner.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(owner.getByRole('heading', { name: 'Approved' })).toBeVisible();

  await laptop.page.waitForURL('**/home', { timeout: 15_000 });
  await expect(laptop.page.getByText('Temporary access on this device.')).toBeVisible();
  await expect(laptop.page.getByRole('heading', { name: 'Welcome back, Sam' })).toBeVisible();
  // A temporary device can't reach account management.
  await laptop.page.goto('/account');
  await expect(laptop.page.getByText('Limited access on this device')).toBeVisible();
  await expect(laptop.page.getByRole('heading', { name: 'Passkeys' })).toHaveCount(0);
  await laptop.page.screenshot({ path: `${SHOTS}/temporary-account-desktop.png`, fullPage: true });
  expect(laptopErrors).toEqual([]);
  // And the server refuses its attempt to approve devices or export data.
  const approveAttempt = await laptop.page.evaluate(async () =>
    (await fetch('/api/pairing/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
  );
  expect(approveAttempt).toBe(403);
  expect((await laptop.page.request.get('/api/account/export')).status()).toBe(403);

  await owner.goto('/devices');
  await expect(owner.getByRole('region', { name: 'Temporary access' }).getByText(/Chrome on/)).toBeVisible();
  await expectNoA11yViolations(owner);
  await owner.screenshot({ path: `${SHOTS}/devices-mobile.png`, fullPage: true });
  await owner.getByRole('region', { name: 'Temporary access' }).getByRole('link').first().click();
  await expect(owner.getByText('What this device can access')).toBeVisible();
  await owner.getByRole('button', { name: 'Disconnect' }).click();
  await owner.getByRole('button', { name: 'Disconnect device' }).click();
  await owner.waitForURL('**/devices');
  await expect(owner.getByRole('region', { name: 'Temporary access' }).getByText('No temporary devices')).toBeVisible();

  // Server-side enforcement: the laptop is signed out on its next request.
  await laptop.page.goto('/home');
  await expect(laptop.page).toHaveURL(/\/signin/);

  expect(ownerErrors).toEqual([]);
  await phone.close();
  await laptopCtx.close();
});

test('picking the wrong code cancels the request on both devices', async ({ browser }) => {
  const phone = await browser.newContext();
  const owner = await phone.newPage();
  await addVirtualAuthenticator(owner);
  await signUp(owner, 'Wrong Code');
  await finishOnboarding(owner);
  const laptopCtx = await browser.newContext();
  const laptop = await newDevice(laptopCtx);

  await owner.goto(laptop.approveUrl);
  const choices = owner.locator('label:has(input[name="code"])');
  await expect(choices).toHaveCount(3);
  const texts = await choices.allTextContents();
  const wrong = texts.find((t) => t.trim() !== laptop.code)!;
  await owner.getByText(wrong.trim(), { exact: true }).click();
  await owner.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(owner.getByRole('heading', { name: 'Request cancelled' })).toBeVisible();
  await expect(laptop.page.getByText('The request was declined')).toBeVisible({ timeout: 10_000 });
  await phone.close();
  await laptopCtx.close();
});

test('approve by typing the code on the phone', async ({ browser }) => {
  const phone = await browser.newContext();
  const owner = await phone.newPage();
  await addVirtualAuthenticator(owner);
  await signUp(owner, 'Typed Code');
  await finishOnboarding(owner);
  const laptopCtx = await browser.newContext();
  const laptop = await newDevice(laptopCtx);

  await owner.goto('/devices/connect');
  await expectNoA11yViolations(owner);
  await owner.getByLabel('Code on the other device').fill(laptop.code.toLowerCase().replace('-', ''));
  await owner.getByRole('button', { name: 'Continue' }).click();
  await expect(owner.getByText(`You entered ${laptop.code}`)).toBeVisible();
  await owner.getByRole('radio', { name: /My own device/ }).click();
  await owner.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(owner.getByRole('heading', { name: 'Approved' })).toBeVisible();
  await laptop.page.waitForURL('**/home', { timeout: 15_000 });
  await expect(laptop.page.getByText('Temporary access on this device.')).toHaveCount(0);
  await expect(laptop.page.getByRole('link', { name: 'Devices' }).first()).toBeVisible();
  await phone.close();
  await laptopCtx.close();
});
