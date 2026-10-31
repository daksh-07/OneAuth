import { expect, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Attaches a CTAP2 platform authenticator with user verification, like Face ID / Touch ID. */
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Waits for finite CSS animations (entrance fades) so contrast is measured on the settled page. */
export async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const iterations = a.effect?.getComputedTiming().iterations;
      return iterations === Infinity || a.playState !== 'running';
    }),
  );
}

export async function expectNoA11yViolations(page: Page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page: page as never }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

export async function signUp(page: Page, name: string) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Create passkey' }).click();
  await page.waitForURL('**/welcome');
}

export async function finishOnboarding(page: Page) {
  await page.getByRole('radio', { name: /Connect my devices/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Go to my dashboard' }).click();
  await page.waitForURL('**/home');
}

export async function newDevice(context: BrowserContext) {
  const page = await context.newPage();
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/pairing/request') && r.ok());
  await page.goto('/connect');
  const data = (await (await responsePromise).json()) as { id: string; code: string; approveUrl: string };
  await expect(page.getByTestId('pairing-code')).toHaveText(data.code);
  return { page, ...data };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(width);
}

/** Interactive controls should be at least 24×24 CSS px (WCAG 2.2 target size, minimum). */
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main a, main button, main input, main label:has(input), header a, header button, nav a, nav button')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') return false;
        // Inline text links inside sentences are exempt under WCAG 2.5.8.
        if (el.tagName === 'A' && style.display === 'inline') return false;
        if (el.classList.contains('sr-only')) return false;
        // A checkbox or radio inside a label is hit through the whole label, which is measured separately.
        if (el.tagName === 'INPUT' && el.closest('label')) return false;
        return r.width < 24 || r.height < 24;
      })
      .map((el) => `${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
  );
  expect(small).toEqual([]);
}

