import { expect, test, type Browser, type Page } from '@playwright/test';
import { addVirtualAuthenticator, collectConsoleErrors, finishOnboarding, signUp } from '../e2e/helpers';

/**
 * End-to-end verification of the hosted preview with real WebAuthn ceremonies
 * (Chrome virtual authenticator), the real database and Vercel's edge.
 * One serial scenario so accounts can be cleaned up at the end.
 */
test.describe.configure({ mode: 'serial' });

const run = Date.now().toString(36);
let phone: Page;
let intruder: Page;

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await addVirtualAuthenticator(page);
  return page;
}

test('health: database migrated and origin configured', async ({ request }) => {
  const res = await request.get('/api/health');
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok', database: 'ok', origins: 'configured' });
  expect(body.migrations).toBeGreaterThanOrEqual(2);
});

test('registration with a passkey, secure cookies', async ({ browser }) => {
  phone = await newPhone(browser);
  const errors = collectConsoleErrors(phone);
  await signUp(phone, `Hosted A ${run}`);
  await finishOnboarding(phone);
  await expect(phone.getByRole('heading', { name: 'Welcome back, Hosted' })).toBeVisible();
  const cookies = await phone.context().cookies();
  const session = cookies.find((c) => c.name === '__Host-oa_session');
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  expect(cookies.find((c) => c.name === '__Host-oa_device')).toMatchObject({ httpOnly: true, secure: true });
  // Vercel injects its preview toolbar, which tries to frame vercel.live; our CSP
  // correctly blocks it. Any other console error fails the test.
  expect(errors.filter((e) => !/favicon/.test(e) && !/Framing 'https:\/\/vercel\.live\/' violates/.test(e))).toEqual([]);
});

test('sign-out and passkey sign-in', async () => {
  await phone.goto('/account');
  await phone.getByRole('button', { name: 'Sign out of this device' }).click();
  await phone.waitForURL((u) => u.pathname === '/');
  await phone.goto('/home');
  await expect(phone).toHaveURL(/\/signin/);
  const verifyReq = phone.waitForRequest((r) => r.url().endsWith('/api/auth/login/verify') && r.method() === 'POST');
  await phone.getByRole('button', { name: 'Sign in with a passkey' }).click();
  const captured = (await verifyReq).postData()!;
  await phone.waitForURL('**/home');
  const origin = new URL(phone.url()).origin;

  // Replaying the exact same signed assertion is refused (challenge already consumed).
  const replay = await phone.request.post('/api/auth/login/verify', { data: JSON.parse(captured), headers: { origin } });
  expect(replay.status()).toBe(400);
  expect((await replay.json()).error).toBe('challenge_invalid');

  // A malformed assertion against a fresh challenge is a clean 4xx, never a 500.
  const opts = await (await phone.request.post('/api/auth/login/options', { data: {}, headers: { origin } })).json();
  const malformed = await phone.request.post('/api/auth/login/verify', {
    data: { challengeId: opts.challengeId, response: { id: 'AAAA', rawId: 'AAAA', type: 'public-key', response: {} } },
    headers: { origin },
  });
  expect(malformed.status()).toBe(401);

  // State-changing requests from another origin are refused before any work happens.
  const foreign = await phone.request.post('/api/auth/login/options', { data: {}, headers: { origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  // Sign-in on a known browser reuses its device record.
  await phone.goto('/devices');
  await expect(phone.getByRole('region', { name: 'Your devices' }).getByRole('listitem')).toHaveCount(1);
});

let laptopDeviceUrl = '';
let usedRequestId = '';

test('QR pairing with code confirmation, scoped temporary access, then revocation', async ({ browser }) => {
  const laptopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const laptop = await laptopCtx.newPage();
  const req = laptop.waitForResponse((r) => r.url().endsWith('/api/pairing/request') && r.ok());
  await laptop.goto('/connect');
  const { approveUrl, code, id: requestId } = await (await req).json();
  usedRequestId = requestId;
  expect(new URL(approveUrl).origin).toBe(new URL(phone.url()).origin);

  await phone.goto(approveUrl);
  await expect(phone.getByRole('heading', { name: 'Connect a new device?' })).toBeVisible();
  await phone.getByText(code, { exact: true }).click();
  await phone.getByRole('radio', { name: /Shared or temporary/ }).click();
  await phone.getByText('15 minutes', { exact: true }).click();
  const presence = phone.getByRole('checkbox', { name: /in front of me/ });
  if (await presence.count()) await presence.check();
  await phone.getByRole('button', { name: 'Approve with passkey' }).click();
  await expect(phone.getByRole('heading', { name: 'Approved' })).toBeVisible();

  await expect(laptop.getByText(`Connected to Hosted A ${run}’s OneAuth`)).toBeVisible({ timeout: 20_000 });
  await laptop.getByRole('button', { name: 'Continue' }).click();
  await laptop.waitForURL('**/home');
  await expect(laptop.getByText('Temporary access on this device.')).toBeVisible();

  // Scope enforcement on the server, not just the UI.
  expect((await laptop.request.get('/api/account/export')).status()).toBe(403);
  const approveStatus = await laptop.evaluate(async () =>
    (await fetch('/api/pairing/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
  );
  expect(approveStatus).toBe(403);
  // Replaying the claim fails.
  const replay = await laptop.evaluate(async () => (await fetch('/api/pairing/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
  expect(replay).toBe(409);

  await phone.goto('/devices');
  const temp = phone.getByRole('region', { name: 'Temporary access' });
  await expect(temp.getByRole('listitem')).toHaveCount(1);
  await temp.getByRole('link').first().click();
  await phone.waitForURL(/\/devices\/[0-9a-f-]{36}$/);
  laptopDeviceUrl = new URL(phone.url()).pathname;
  await expect(phone.getByText('Your name and account basics')).toBeVisible();

  await phone.getByRole('button', { name: 'Disconnect' }).click();
  await phone.getByRole('button', { name: 'Disconnect device' }).click();
  await phone.waitForURL('**/devices');
  await laptop.goto('/home');
  await expect(laptop).toHaveURL(/\/signin/);

  // The used approval link can't be reused.
  await phone.goto(approveUrl);
  await expect(phone.getByRole('heading', { name: /already handled|expired/ })).toBeVisible();
  await laptopCtx.close();
});

test('cross-user isolation', async ({ browser }) => {
  intruder = await newPhone(browser);
  await signUp(intruder, `Hosted B ${run}`);
  await finishOnboarding(intruder);
  // Another user's device ID is simply not found. (Status is 200 because the
  // app shell streams a loading skeleton first; the body carries no data.)
  const res = await intruder.goto(laptopDeviceUrl);
  await expect(intruder.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  const html = (await res?.text()) ?? '';
  expect(html).not.toContain('Hosted A');
  expect(html).not.toContain('Your name and account basics');
  await intruder.goto('/devices');
  await expect(intruder.getByRole('region', { name: 'Your devices' }).getByRole('listitem')).toHaveCount(1);
  await expect(intruder.getByRole('region', { name: 'Temporary access' }).getByRole('listitem')).toHaveCount(0);
});

test('cross-account tampering over HTTP is refused and leaves the victim unchanged', async () => {
  const origin = new URL(phone.url()).origin;
  // Victim (A): find their device ID and baseline state from their own export.
  const before = await (await phone.request.get('/api/account/export')).json();
  const victimDevice = before.devices[0];
  expect(victimDevice).toBeTruthy();

  // Attacker (B): open their own device page and rewrite their server-action
  // arguments in flight so the requests target A's device ID instead.
  await intruder.goto('/devices');
  await intruder.getByRole('region', { name: 'Your devices' }).getByRole('link').first().click();
  await intruder.waitForURL(/\/devices\/[0-9a-f-]{36}$/);
  const ownId = new URL(intruder.url()).pathname.split('/').pop()!;
  let tampered = 0;
  await intruder.route('**/devices/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.headers()['next-action'] && req.postData()?.includes(ownId)) {
      tampered++;
      return route.continue({ postData: req.postData()!.replaceAll(ownId, victimDevice.id) });
    }
    return route.continue();
  });
  await intruder.getByLabel('Device name').fill('Pwned by B');
  await intruder.getByRole('button', { name: 'Save' }).click();
  await expect(intruder.getByText('That device was not found.')).toBeVisible();
  await intruder.getByRole('button', { name: 'Disconnect' }).click();
  await intruder.getByRole('button', { name: 'Disconnect device' }).click();
  await expect(intruder.getByText('That device was not found or is already disconnected.')).toBeVisible();
  expect(tampered).toBe(2);
  await intruder.unroute('**/devices/**');

  // B can't re-approve A's (already used) pairing request.
  const reapprove = await intruder.request.post('/api/pairing/approve', {
    data: { requestId: usedRequestId, confirmedCode: 'AAAA-AAAA', kind: 'shared', scopes: [], ttlSeconds: 3600 },
    headers: { origin },
  });
  expect([403, 409]).toContain(reapprove.status());

  // B's export contains nothing of A's.
  const bExport = JSON.stringify(await (await intruder.request.get('/api/account/export')).json());
  expect(bExport).not.toContain(victimDevice.id);
  expect(bExport).not.toContain(`Hosted A ${run}`);

  // A is untouched: same device, same name, still signed in.
  const after = await (await phone.request.get('/api/account/export')).json();
  const same = after.devices.find((d: { id: string }) => d.id === victimDevice.id);
  expect(same).toMatchObject({ id: victimDevice.id, name: victimDevice.name });
  expect(after.securityEvents.some((e: { type: string }) => e.type === 'device.revoked' && JSON.stringify(e).includes(victimDevice.id))).toBe(false);
  await phone.goto('/home');
  await expect(phone.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
});

test('cleanup: delete both test accounts', async () => {
  for (const page of [intruder, phone]) {
    if (!page) continue;
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await page.getByLabel('Type “delete my account” to confirm').fill('delete my account');
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await page.waitForURL(/\/\?deleted=1/);
    await expect(page.getByText('Your account was deleted')).toBeVisible();
  }
});
