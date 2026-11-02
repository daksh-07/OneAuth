import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { addVirtualAuthenticator, clonePasskeys, collectConsoleErrors, expectNoA11yViolations, finishOnboarding, signUp } from './helpers';

const DB = process.env.E2E_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_e2e';
const SHOTS = 'test-results/screens';

async function storedCiphertext(): Promise<Buffer> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    const { rows } = await c.query<{ data: Buffer }>(`select data from cloud_object_parts order by file_id, idx`);
    return Buffer.concat(rows.map((r) => r.data));
  } finally {
    await c.end();
  }
}

async function openActions(page: Page, name: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
}

test('an encrypted file moves between two approved browsers, and access can be removed', async ({ browser }) => {
  test.setTimeout(120_000);
  // Browser A: sign up and create the vault.
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const a = await ctxA.newPage();
  const errorsA = collectConsoleErrors(a);
  const authA = await addVirtualAuthenticator(a);
  await signUp(a, 'Casey Park');
  await finishOnboarding(a);
  await a.goto('/cloud');
  await expect(a.getByText('Developer preview: use test files only')).toBeVisible();
  await a.getByRole('button', { name: 'Create my vault' }).click();
  const recoveryKey = (await a.getByTestId('recovery-key').textContent())!.trim();
  expect(recoveryKey).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
  await expect(a.getByRole('button', { name: 'Create vault' })).toBeDisabled();
  await a.getByLabel('I’ve saved my recovery key somewhere safe.').check();
  await a.getByLabel('To confirm, type group 5 of your key').fill('ZZZZ');
  await expect(a.getByText('That doesn’t match.')).toBeVisible();
  await a.getByLabel('To confirm, type group 5 of your key').fill(recoveryKey.split('-')[4]);
  await expectNoA11yViolations(a);
  await a.getByRole('button', { name: 'Create vault' }).click();
  await expect(a.getByText('No files here yet')).toBeVisible();

  // Upload a multi-part test file and a folder.
  const marker = 'OneAuth E2E test file — not sensitive. ';
  const content = Buffer.from(marker.repeat(40_000)); // ~1.6 MB: two transfer parts
  await a.getByTestId('upload-input').setInputFiles({ name: 'test-notes.txt', mimeType: 'text/plain', buffer: content });
  await expect(a.getByText('test-notes.txt uploaded and encrypted')).toBeVisible();
  await expect(a.getByTestId('cloud-items').getByText('test-notes.txt')).toBeVisible();
  await a.getByRole('button', { name: 'New folder' }).click();
  await a.getByRole('textbox').fill('Projects');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByTestId('cloud-items').getByText('Projects')).toBeVisible();
  await expectNoA11yViolations(a);
  await a.screenshot({ path: `${SHOTS}/cloud-files-desktop.png`, fullPage: true });

  // The server holds ciphertext only: neither the content nor the file name is stored in the clear.
  const stored = await storedCiphertext();
  expect(stored.length).toBeGreaterThan(content.length);
  expect(stored.includes(Buffer.from('OneAuth E2E test file'))).toBe(false);

  // Browser B: the same person signs in on a phone-sized browser and asks for access.
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const b = await ctxB.newPage();
  const errorsB = collectConsoleErrors(b);
  await clonePasskeys(authA, b);
  await b.goto('/signin');
  await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await b.waitForURL('**/home');
  await b.goto('/cloud');
  await expect(b.getByRole('heading', { name: 'Approve this browser from another device' })).toBeVisible();
  const codeB = (await b.getByTestId('device-fingerprint').textContent())!.trim();
  expect(codeB).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  await expectNoA11yViolations(b);
  await b.screenshot({ path: `${SHOTS}/cloud-pending-mobile.png`, fullPage: true });

  // A reviews the request: the code A computes must match the one B shows.
  await a.reload();
  await a.getByRole('button', { name: 'Review' }).click();
  await expect(a.getByTestId('approve-fingerprint')).toHaveText(codeB);
  await a.getByRole('button', { name: 'Codes match: approve' }).click();
  await expect(a.getByText('can now open your files')).toBeVisible();

  // B picks up its approval, decrypts and downloads the file.
  await expect(b.getByTestId('cloud-items').getByText('test-notes.txt')).toBeVisible({ timeout: 15_000 });
  await openActions(b, 'test-notes.txt');
  const downloadPromise = b.waitForEvent('download');
  await b.getByRole('menuitem', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('test-notes.txt');
  const got = Buffer.concat(await (async () => {
    const chunks: Buffer[] = [];
    for await (const c of (await download.createReadStream())!) chunks.push(c as Buffer);
    return chunks;
  })());
  expect(got.equals(content)).toBe(true);
  await b.screenshot({ path: `${SHOTS}/cloud-files-mobile.png`, fullPage: true });

  // Trash and restore on B is reflected on A.
  await openActions(b, 'test-notes.txt');
  await b.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(b.getByText('Moved to trash')).toBeVisible();
  await b.getByRole('button', { name: 'Trash' }).click();
  await openActions(b, 'test-notes.txt');
  await b.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(b.getByText('Restored')).toBeVisible();

  // A removes B's vault access; B can no longer open files.
  await a.reload();
  await a.getByRole('button', { name: 'Remove', exact: true }).click();
  await a.getByRole('button', { name: 'Remove access' }).click();
  await expect(a.getByText('can no longer open your files')).toBeVisible();
  await expect(b.getByText('This browser doesn’t have access to your files')).toBeVisible({ timeout: 20_000 });
  const denied = await b.request.get('/api/cloud/items?view=recent');
  expect(denied.status()).toBe(403);

  expect(errorsA).toEqual([]);
  expect(errorsB.filter((e) => !/403/.test(e))).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('Cloud APIs refuse cross-site reads and unauthenticated access', async ({ request }) => {
  expect((await request.get('/api/cloud/vault')).status()).toBe(401);
  expect((await request.get('/api/cloud/vault', { headers: { 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
  expect((await request.post('/api/cloud/files', { headers: { origin: 'https://evil.example' }, data: {} })).status()).toBe(403);
});

test('spaces: create, switch, pin an encrypted file and restrict to this device', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  await addVirtualAuthenticator(page);
  await signUp(page, 'Robin Shaw');
  await finishOnboarding(page);

  await page.goto('/space');
  await expect(page.getByRole('button', { name: /Current space: Personal/ })).toBeVisible();
  await expect(page.getByText('Nothing pinned yet')).toBeVisible();
  await page.getByRole('button', { name: /Current space/ }).click();
  await page.getByRole('menuitem', { name: 'New space' }).click();
  await page.getByLabel('Name').fill('Work');
  await page.getByRole('button', { name: 'Create space' }).click();
  await expect(page.getByRole('button', { name: /Current space: Work/ })).toBeVisible();
  await expectNoA11yViolations(page);

  // Set up Cloud, upload a test file and pin it to Work.
  await page.goto('/cloud');
  await page.getByRole('button', { name: 'Create my vault' }).click();
  const key = (await page.getByTestId('recovery-key').textContent())!.trim();
  await page.getByLabel('I’ve saved my recovery key somewhere safe.').check();
  await page.getByLabel('To confirm, type group 5 of your key').fill(key.split('-')[4]);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.getByTestId('upload-input').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('test plan') });
  await expect(page.getByTestId('cloud-items').getByText('plan.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for plan.txt' }).click();
  await page.getByRole('menuitem', { name: 'Pin to Work' }).click();
  await expect(page.getByText('Pinned to Work')).toBeVisible();

  await page.goto('/space');
  await expect(page.getByTestId('space-pins').getByText('plan.txt')).toBeVisible();
  // Personal doesn't have it.
  await page.getByRole('button', { name: /Current space/ }).click();
  await page.getByRole('menuitem', { name: 'Personal' }).click();
  await expect(page.getByText('Nothing pinned yet')).toBeVisible();

  // Restrict Personal to this device only.
  await page.getByRole('button', { name: 'Space settings' }).click();
  await page.getByLabel('Only the devices I choose').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Shown only on 1 device.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/space-desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
});
