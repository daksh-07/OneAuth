import { devices, expect, test, type Page } from '@playwright/test';
import { addVirtualAuthenticator, clonePasskeys, finishOnboarding, signUp } from '../e2e/helpers';

/**
 * Hosted adversarial checks for the Cloud preview, using only public flows:
 * the UI and the same HTTP API the app calls, with IDs taken from the app's
 * own responses. No database access. Throwaway accounts ("Hosted A/B <run>")
 * are deleted at the end; the preview build's cleanup removes leftovers.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const run = Date.now().toString(36);
const placeholder = { sha256: '0'.repeat(64), encryptedMeta: 'A'.repeat(40), wrappedKey: 'A'.repeat(54) + '==' };

async function createVault(page: Page) {
  await page.goto('/cloud');
  await page.getByRole('button', { name: 'Create my vault' }).click();
  const key = (await page.getByTestId('recovery-key').textContent())!.trim();
  await page.getByLabel('I’ve saved my recovery key somewhere safe.').check();
  await page.getByLabel('To confirm, type group 5 of your key').fill(key.split('-')[4]);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByText('No files here yet')).toBeVisible();
  return key;
}

async function deleteAccount(page: Page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByLabel('Type “delete my account” to confirm').fill('delete my account');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await page.waitForURL(/\/\?deleted=1/);
}

test('Cloud preview resists misuse through its public interface', async ({ browser }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const write = { headers: { origin } };

  // Owner (laptop): vault and one test file. The file ID comes from the app's own upload request.
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const authA = await addVirtualAuthenticator(a);
  await signUp(a, `Hosted A ${run}`);
  await finishOnboarding(a);
  await createVault(a);
  const uploadStart = a.waitForResponse((r) => r.url().endsWith('/api/cloud/files') && r.request().method() === 'POST' && r.ok());
  await a.getByTestId('upload-input').setInputFiles({ name: 'hosted-adversarial.txt', mimeType: 'text/plain', buffer: Buffer.from('hosted adversarial test file') });
  const { fileId } = (await (await uploadStart).json()) as { fileId: string };
  await expect(a.getByTestId('cloud-items').getByText('hosted-adversarial.txt')).toBeVisible({ timeout: 30_000 });

  try {
    // 1. Upload integrity is enforced by the server, not trusted from the client.
    const declaredTooBig = await a.request.post('/api/cloud/files', { ...write, data: { ...placeholder, fileId: crypto.randomUUID(), folderId: null, size: 30 * 1024 * 1024, keyVersion: 1 } });
    expect(declaredTooBig.status()).toBe(413);
    const liar = crypto.randomUUID();
    expect((await a.request.post('/api/cloud/files', { ...write, data: { ...placeholder, fileId: liar, folderId: null, size: 100, keyVersion: 1 } })).ok()).toBe(true);
    expect((await a.request.put(`/api/cloud/files/${liar}/parts/0`, { ...write, data: Buffer.alloc(99) })).status()).toBe(400); // wrong part size
    expect((await a.request.put(`/api/cloud/files/${liar}/parts/0`, { ...write, data: Buffer.alloc(100, 7) })).ok()).toBe(true);
    const completion = await a.request.post(`/api/cloud/files/${liar}/complete`, write);
    expect(completion.status()).toBe(409);
    expect((await completion.json()).error).toBe('integrity_mismatch');
    expect((await a.request.delete(`/api/cloud/files/${liar}`, write)).ok()).toBe(true);
    // A write under a vault-key version the vault doesn't have is refused.
    const stale = await a.request.post('/api/cloud/folders', { ...write, data: { id: crypto.randomUUID(), parentId: null, encryptedName: 'A'.repeat(40), keyVersion: 99 } });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).error).toBe('stale_key');

    // 2. Cross-site requests are refused.
    expect((await a.request.get('/api/cloud/items?view=recent', { headers: { 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
    expect((await a.request.post('/api/cloud/folders', { headers: { origin: 'https://evil.example' }, data: {} })).status()).toBe(403);
    expect((await a.request.post('/api/cloud/vault/rotation', { headers: { origin: 'https://evil.example' }, data: {} })).status()).toBe(403);

    // 3. A second browser of the same person, signed in but not approved, gets nothing encrypted and can't approve itself.
    const ctxB = await browser.newContext({ ...devices['Pixel 7'] });
    const b = await ctxB.newPage();
    await clonePasskeys(authA, b);
    await b.goto('/signin');
    await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await b.waitForURL('**/home');
    await b.goto('/cloud');
    await expect(b.getByRole('heading', { name: 'Approve this browser from another device' })).toBeVisible();
    expect((await b.request.get('/api/cloud/items?view=recent')).status()).toBe(403);
    expect((await b.request.get(`/api/cloud/files/${fileId}/parts/0`)).status()).toBe(403);
    expect((await b.request.get('/api/cloud/vault/rotation')).status()).toBe(403);
    const stateB = (await (await b.request.get('/api/cloud/vault')).json()) as { device: { id: string; envelope: string | null }; devices: { id: string }[] };
    expect(stateB.device.envelope).toBeNull();
    expect(stateB.devices.map((d) => d.id)).toEqual([stateB.device.id]); // can't see other browsers either
    const selfApprove = await b.request.post(`/api/cloud/vault/devices/${stateB.device.id}`, {
      headers: { origin },
      data: { envelope: 'eyJhbGciOiJFQ0RILUVTK0EyNTZLVyIsImVuYyI6IkEyNTZHQ00ifQ.a.b.c.d', fingerprint: 'AAAA-AAAA-AAAA', keyVersion: 1 },
    });
    expect(selfApprove.status()).toBeGreaterThanOrEqual(400);
    const spaces = (await (await b.request.get('/api/space')).json()) as { spaces: { id: string }[] };
    const pins = await (await b.request.get(`/api/space/${spaces.spaces[0].id}/pins`)).json();
    expect(pins).toMatchObject({ files: [], folders: [], locked: true });
    // A pending browser can't remove the approved one.
    const stateA = (await (await a.request.get('/api/cloud/vault')).json()) as { device: { id: string } };
    expect((await b.request.delete(`/api/cloud/vault/devices/${stateA.device.id}`, { headers: { origin } })).status()).toBe(403);

    // 4. Approval with both checks: the security code, then the confirmation code from the key actually received.
    const codeB = (await b.getByTestId('device-fingerprint').textContent())!.trim();
    await a.goto('/cloud');
    await a.getByRole('button', { name: 'Review' }).click();
    await expect(a.getByTestId('approve-fingerprint')).toHaveText(codeB);
    await a.getByRole('button', { name: 'Codes match: approve' }).click();
    const approverCode = (await a.getByTestId('approver-confirmation-code').textContent())!.trim();
    await a.getByRole('button', { name: 'Done' }).click();
    await expect(b.getByTestId('confirmation-code')).toHaveText(approverCode, { timeout: 20_000 });
    await b.getByRole('button', { name: 'Codes match' }).click();
    await expect(b.getByTestId('cloud-items').getByText('hosted-adversarial.txt')).toBeVisible();

    // 5. Another account can't read the file even with its ID and an approved vault of its own.
    const ctxC = await browser.newContext();
    const c = await ctxC.newPage();
    await addVirtualAuthenticator(c);
    await signUp(c, `Hosted B ${run}`);
    await finishOnboarding(c);
    await createVault(c);
    expect((await c.request.get(`/api/cloud/files/${fileId}/parts/0`)).status()).toBe(404);
    expect((await c.request.delete(`/api/cloud/files/${fileId}`, { headers: { origin } })).status()).toBe(404);
    await deleteAccount(c);
    await ctxC.close();

    // 6. Removing vault access, then disconnecting the device: refused at each step.
    const phoneRow = a.getByRole('listitem').filter({ hasText: codeB });
    await phoneRow.getByRole('button', { name: 'Remove' }).click();
    await a.getByRole('button', { name: 'Remove access' }).click();
    await expect(a.getByText('can no longer open your files').first()).toBeVisible();
    expect((await b.request.get('/api/cloud/items?view=recent')).status()).toBe(403);
    expect((await b.request.get(`/api/cloud/files/${fileId}/parts/0`)).status()).toBe(403);
    await a.goto('/devices');
    await a.getByRole('link', { name: /Android/ }).first().click();
    await a.waitForURL(/\/devices\/[0-9a-f-]{36}$/);
    await a.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await a.getByRole('button', { name: 'Disconnect device' }).click();
    await a.waitForURL('**/devices');
    for (const path of ['/api/cloud/vault', '/api/cloud/items?view=recent', '/api/space']) expect((await b.request.get(path)).status(), path).toBe(401);
    await ctxB.close();
  } finally {
    await deleteAccount(a);
    await ctxA.close();
  }
});
