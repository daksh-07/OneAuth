import { expect, test } from '@playwright/test';
import { addVirtualAuthenticator, clonePasskeys, collectConsoleErrors, finishOnboarding, signUp } from '../e2e/helpers';

/**
 * Hosted check of the Cloud developer preview: a test file is encrypted in one
 * browser and decrypted in a second, approved one, against the real preview
 * database and Vercel functions. Runs only where the preview flag is on.
 * The throwaway account ("Hosted A <run>") is deleted at the end, and the
 * preview build's cleanup removes it if this run fails part-way.
 */
const run = Date.now().toString(36);
const ignorable = (e: string) => /favicon/.test(e) || /Framing 'https:\/\/vercel\.live\/' violates/.test(e) || /403/.test(e);

test('Cloud preview: encrypted transfer between two approved browsers', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const a = await ctxA.newPage();
  const errorsA = collectConsoleErrors(a);
  const authA = await addVirtualAuthenticator(a);
  await signUp(a, `Hosted A ${run}`);
  await finishOnboarding(a);
  try {
    await a.goto('/cloud');
    await a.getByRole('button', { name: 'Create my vault' }).click();
    const key = (await a.getByTestId('recovery-key').textContent())!.trim();
    await a.getByLabel('I’ve saved my recovery key somewhere safe.').check();
    await a.getByLabel('To confirm, type group 5 of your key').fill(key.split('-')[4]);
    await a.getByRole('button', { name: 'Create vault' }).click();
    const content = Buffer.from('OneAuth hosted test file — not sensitive. '.repeat(30_000)); // ~1.3 MB, two parts
    await a.getByTestId('upload-input').setInputFiles({ name: 'hosted-test.txt', mimeType: 'text/plain', buffer: content });
    await expect(a.getByTestId('cloud-items').getByText('hosted-test.txt')).toBeVisible({ timeout: 30_000 });

    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
    const b = await ctxB.newPage();
    const errorsB = collectConsoleErrors(b);
    await clonePasskeys(authA, b);
    await b.goto('/signin');
    await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await b.waitForURL('**/home');
    await b.goto('/cloud');
    const code = (await b.getByTestId('device-fingerprint').textContent())!.trim();

    await a.reload();
    await a.getByRole('button', { name: 'Review' }).click();
    await expect(a.getByTestId('approve-fingerprint')).toHaveText(code);
    await a.getByRole('button', { name: 'Codes match: approve' }).click();

    await expect(b.getByTestId('cloud-items').getByText('hosted-test.txt')).toBeVisible({ timeout: 20_000 });
    await b.getByRole('button', { name: 'Actions for hosted-test.txt' }).click();
    const dl = b.waitForEvent('download');
    await b.getByRole('menuitem', { name: 'Download' }).click();
    const chunks: Buffer[] = [];
    for await (const c of (await (await dl).createReadStream())!) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).equals(content)).toBe(true);

    expect(errorsA.filter((e) => !ignorable(e))).toEqual([]);
    expect(errorsB.filter((e) => !ignorable(e))).toEqual([]);
    await ctxB.close();
  } finally {
    await a.goto('/account');
    await a.getByRole('button', { name: 'Delete account' }).click();
    await a.getByLabel('Type “delete my account” to confirm').fill('delete my account');
    await a.getByRole('button', { name: 'Delete permanently' }).click();
    await a.waitForURL(/\/\?deleted=1/);
    await ctxA.close();
  }
});
