import { devices, expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { addVirtualAuthenticator, clonePasskeys, collectConsoleErrors, expectNoA11yViolations, finishOnboarding, signUp } from './helpers';

const DB = process.env.E2E_DATABASE_URL ?? 'postgres://oneauth:oneauth@localhost:5432/oneauth_e2e';
const SHOTS = 'test-results/screens';

async function sql<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

async function readDownload(page: Page, trigger: () => Promise<void>) {
  const dl = page.waitForEvent('download');
  await trigger();
  const d = await dl;
  const chunks: Buffer[] = [];
  for await (const c of (await d.createReadStream())!) chunks.push(c as Buffer);
  return { name: d.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

async function confirmRecoveryKey(page: Page, button: string) {
  const key = (await page.getByTestId('recovery-key').textContent())!.trim();
  expect(key).toMatch(/^([A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
  await expect(page.getByRole('button', { name: button })).toBeDisabled();
  await page.getByLabel('I’ve saved my recovery key somewhere safe.').check();
  await page.getByLabel('To confirm, type group 5 of your key').fill('ZZZZ');
  await expect(page.getByText('That doesn’t match.')).toBeVisible();
  await page.getByLabel('To confirm, type group 5 of your key').fill(key.split('-')[4]);
  await page.getByRole('button', { name: button }).click();
  return key;
}

/**
 * The flagship journey, with two independent browser contexts, plus the
 * adversarial checks that belong at each step.
 */
test('flagship: encrypted document and workspace move to an approved second browser, then access is withdrawn', async ({ browser }) => {
  test.setTimeout(240_000);
  const name = `Morgan Flagship ${Date.now().toString(36)}`;

  // 1. Register and sign in (laptop).
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const a = await ctxA.newPage();
  const errorsA = collectConsoleErrors(a);
  const authA = await addVirtualAuthenticator(a);
  await signUp(a, name);
  await finishOnboarding(a);
  await expect(a.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

  // 2. Set up the test vault and recovery key.
  await a.goto('/cloud');
  await expect(a.getByText('Developer preview: use test files only')).toBeVisible();
  await a.getByText('How your files are protected').click();
  await expect(a.getByText('It sees sizes, dates and how many items you have', { exact: false })).toBeVisible();
  await a.getByRole('button', { name: 'Create my vault' }).click();
  await expectNoA11yViolations(a);
  await confirmRecoveryKey(a, 'Create vault');
  await expect(a.getByText('No files here yet')).toBeVisible();

  // 3. Upload an encrypted test document (two transfer parts) and a second file to tamper with later.
  const doc = Buffer.from('OneAuth flagship test document — not sensitive. '.repeat(30_000));
  await a.getByTestId('upload-input').setInputFiles([
    { name: 'flagship-test.txt', mimeType: 'text/plain', buffer: doc },
    { name: 'tamper-target.txt', mimeType: 'text/plain', buffer: Buffer.from('this one will be corrupted in storage') },
  ]);
  await expect(a.getByTestId('cloud-items').getByText('flagship-test.txt')).toBeVisible({ timeout: 30_000 });
  await expect(a.getByTestId('cloud-items').getByText('tamper-target.txt')).toBeVisible();
  const stored = Buffer.concat((await sql<{ data: Buffer }>(`select data from cloud_object_parts order by file_id, idx`)).map((r) => r.data));
  expect(stored.includes(Buffer.from('OneAuth flagship test document'))).toBe(false);

  // Search and sort work on decrypted names, in the browser.
  await a.getByLabel('Search all files by name').fill('flagship');
  await expect(a.getByTestId('cloud-items').getByText('tamper-target.txt')).toHaveCount(0);
  await expect(a.getByTestId('cloud-items').getByText('flagship-test.txt')).toBeVisible();
  await a.getByLabel('Search all files by name').fill('');

  // Prepare the personal workspace: a shortcut, a bookmark and the pinned document; plus a laptop-only space.
  await a.getByRole('button', { name: 'Actions for flagship-test.txt' }).click();
  await a.getByRole('menuitem', { name: 'Pin to Personal' }).click();
  await expect(a.getByText('Pinned to Personal')).toBeVisible();
  await a.goto('/space');
  await a.getByRole('button', { name: 'Add shortcut' }).click();
  await a.getByLabel('Label').fill('Team chat');
  await a.getByLabel('Web address').fill('chat.example.com');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByTestId('space-shortcuts').getByText('Team chat')).toBeVisible();
  await a.getByRole('button', { name: 'Add bookmark' }).click();
  await a.getByLabel('Title').fill('Handbook');
  // Adversarial: anything other than a web address is refused before it's saved.
  await a.getByLabel('Web address').fill('javascript:alert(1)');
  await expect(a.getByText('Only web addresses (http or https) can be saved.')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Save' })).toBeDisabled();
  await a.getByLabel('Web address').fill('https://handbook.example.com/start');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByTestId('space-bookmarks').getByRole('link', { name: /Handbook/ })).toHaveAttribute('href', 'https://handbook.example.com/start');
  await expect(a.getByTestId('space-pins').getByText('flagship-test.txt')).toBeVisible();
  const bodies = (await sql<{ encrypted_body: string }>(`select encrypted_body from space_items`)).map((r) => r.encrypted_body).join();
  expect(bodies).not.toContain('handbook');
  // A second space shown only on this laptop.
  await a.getByRole('button', { name: /Current space/ }).click();
  await a.getByRole('menuitem', { name: 'New space' }).click();
  await a.getByLabel('Name').fill('Laptop only');
  await a.getByRole('button', { name: 'Create space' }).click();
  await a.getByRole('button', { name: 'Space settings' }).click();
  await a.getByLabel('Only the devices I choose').check();
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a.getByText('Shown only on 1 device.')).toBeVisible();
  await a.getByRole('button', { name: /Current space/ }).click();
  await a.getByRole('menuitem', { name: 'Personal' }).click();
  await expectNoA11yViolations(a);
  await a.screenshot({ path: `${SHOTS}/space-unlocked-desktop.png`, fullPage: true });

  // 4. Connect the second browser (a phone, signing in with the same synced passkey).
  const ctxB = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const b = await ctxB.newPage();
  const errorsB = collectConsoleErrors(b);
  await clonePasskeys(authA, b);
  await b.goto('/signin');
  await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await b.waitForURL('**/home');

  // Adversarial: before approval the phone gets no encrypted material at all.
  await b.goto('/space');
  await expect(b.getByText('2 encrypted items in this space')).toBeVisible();
  await expect(b.getByText('1 pinned item is encrypted')).toBeVisible();
  await b.goto('/cloud');
  await expect(b.getByRole('heading', { name: 'Approve this browser from another device' })).toBeVisible();
  expect((await b.request.get('/api/cloud/items?view=recent')).status()).toBe(403);
  const self = await sql<{ id: string }>(
    `select vd.id from vault_devices vd join users u on u.id = vd.user_id where u.display_name = $1 and vd.status = 'pending'`,
    [name],
  );
  const selfApprove = await b.request.post(`/api/cloud/vault/devices/${self[0].id}`, {
    headers: { origin: new URL(b.url()).origin },
    data: { envelope: 'a.b.c.d.e', fingerprint: 'AAAA-AAAA-AAAA', keyVersion: 1 },
  });
  expect(selfApprove.status()).toBeGreaterThanOrEqual(400);

  // 5. Verify its security code.
  const codeB = (await b.getByTestId('device-fingerprint').textContent())!.trim();
  expect(codeB).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  await b.screenshot({ path: `${SHOTS}/cloud-pending-mobile.png`, fullPage: true });
  await a.goto('/cloud');
  await a.getByRole('button', { name: 'Review' }).click();
  await expect(a.getByTestId('approve-fingerprint')).toHaveText(codeB);
  await expectNoA11yViolations(a);

  // 6. Approve vault access.
  await a.getByRole('button', { name: 'Codes match: approve' }).click();
  await expect(a.getByText('can now open your files')).toBeVisible();

  // 7. Download and decrypt the document on the phone.
  await expect(b.getByTestId('cloud-items').getByText('flagship-test.txt')).toBeVisible({ timeout: 20_000 });
  const got = await readDownload(b, async () => {
    await b.getByRole('button', { name: 'Actions for flagship-test.txt' }).click();
    await b.getByRole('menuitem', { name: 'Download' }).click();
  });
  expect(got.name).toBe('flagship-test.txt');
  expect(got.bytes.equals(doc)).toBe(true);
  await b.screenshot({ path: `${SHOTS}/cloud-files-mobile.png`, fullPage: true });

  // Adversarial: ciphertext altered in storage fails authentication and says so, with a retry.
  await sql(
    `update cloud_object_parts p set data = overlay(p.data placing '\\xff'::bytea from 40 for 1)
       from cloud_files f where f.id = p.file_id and f.size_bytes < 1000 and p.idx = 0`,
  );
  await b.getByRole('button', { name: 'Actions for tamper-target.txt' }).click();
  await b.getByRole('menuitem', { name: 'Download' }).click();
  await expect(b.getByText('This item couldn’t be decrypted. It may have been damaged or changed.')).toBeVisible();
  await expect(b.getByRole('button', { name: 'Retry' })).toBeVisible();

  // 8. Open the personal workspace on the phone. 9. Permitted resources are visible; the laptop-only space isn't.
  await b.goto('/space');
  await expect(b.getByTestId('space-shortcuts').getByText('Team chat')).toBeVisible();
  await expect(b.getByTestId('space-bookmarks').getByRole('link', { name: /Handbook/ })).toBeVisible();
  await expect(b.getByTestId('space-pins').getByText('flagship-test.txt')).toBeVisible();
  await b.getByRole('button', { name: /Current space/ }).click();
  await expect(b.getByRole('menuitem', { name: 'Personal' })).toBeVisible();
  await expect(b.getByRole('menuitem', { name: 'Laptop only' })).toHaveCount(0);
  await b.keyboard.press('Escape');
  await expectNoA11yViolations(b);
  await b.screenshot({ path: `${SHOTS}/space-mobile.png`, fullPage: true });

  // 10. Revoke the phone: first its vault access, then replace the vault key, then disconnect the device.
  await a.goto('/cloud');
  const phoneRow = a.getByRole('listitem').filter({ hasText: codeB });
  await phoneRow.getByRole('button', { name: 'Remove' }).click();
  await a.getByRole('button', { name: 'Remove access' }).click();
  await expect(a.getByText('can no longer open your files').first()).toBeVisible();
  await a.getByRole('button', { name: 'Replace vault key' }).click();
  await expect(a.getByText('Doesn’t undo:')).toBeVisible();
  await a.getByRole('button', { name: 'Continue' }).click();
  await confirmRecoveryKey(a, 'Replace vault key');
  await expect(a.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
  const versions = await sql<{ key_version: number }>(`select key_version from vaults v join users u on u.id = v.user_id where u.display_name = $1`, [name]);
  expect(versions[0].key_version).toBe(2);
  // The laptop still opens the document under the new key.
  const again = await readDownload(a, async () => {
    await a.getByRole('button', { name: 'Actions for flagship-test.txt' }).click();
    await a.getByRole('menuitem', { name: 'Download' }).click();
  });
  expect(again.bytes.equals(doc)).toBe(true);
  // The phone's Cloud page loses access on its next refresh.
  await b.goto('/cloud');
  await expect(b.getByRole('heading', { name: 'Approve this browser from another device' })).toBeVisible();
  expect((await b.request.get('/api/cloud/items?view=recent')).status()).toBe(403);

  const [phoneDevice] = await sql<{ id: string }>(
    `select d.id from devices d join users u on u.id = d.user_id where u.display_name = $1 order by d.created_at desc limit 1`,
    [name],
  );
  await a.goto(`/devices/${phoneDevice.id}`);
  await a.getByRole('button', { name: 'Disconnect' }).click();
  await a.getByRole('button', { name: 'Disconnect device' }).click();
  await a.waitForURL('**/devices');

  // 11. The server refuses every further protected request from the phone.
  for (const path of ['/api/cloud/vault', '/api/cloud/items?view=recent', '/api/space']) {
    expect((await b.request.get(path)).status(), path).toBe(401);
  }
  await b.goto('/space');
  await expect(b).toHaveURL(/\/signin/);

  expect(errorsA.filter((e) => !/40[13]/.test(e))).toEqual([]);
  expect(errorsB.filter((e) => !/40[13]/.test(e))).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('Cloud and Space APIs refuse cross-site reads and unauthenticated access', async ({ request }) => {
  expect((await request.get('/api/cloud/vault')).status()).toBe(401);
  expect((await request.get('/api/space')).status()).toBe(401);
  expect((await request.get('/api/cloud/vault', { headers: { 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
  expect((await request.post('/api/cloud/files', { headers: { origin: 'https://evil.example' }, data: {} })).status()).toBe(403);
  expect((await request.post('/api/cloud/vault/rotation', { headers: { origin: 'https://evil.example' }, data: {} })).status()).toBe(403);
});

test('spaces without Cloud set up: create, switch and restrict, with encrypted items explained', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  await addVirtualAuthenticator(page);
  await signUp(page, 'Robin Shaw');
  await finishOnboarding(page);
  await page.goto('/space');
  await expect(page.getByRole('button', { name: /Current space: Personal/ })).toBeVisible();
  await expect(page.getByText('Encrypted shortcuts and bookmarks')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Unlock in Cloud' })).toBeVisible();
  await page.getByRole('button', { name: /Current space/ }).click();
  await page.getByRole('menuitem', { name: 'New space' }).click();
  await page.getByLabel('Name').fill('Work');
  await page.getByRole('button', { name: 'Create space' }).click();
  await expect(page.getByRole('button', { name: /Current space: Work/ })).toBeVisible();
  await page.getByRole('button', { name: 'Space settings' }).click();
  await page.getByLabel('Sort Cloud files by').selectOption('updated');
  await page.getByLabel('Only the devices I choose').check();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Shown only on 1 device.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/space-desktop.png`, fullPage: true });
  expect(errors).toEqual([]);
});
