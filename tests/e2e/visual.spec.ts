import { test } from '@playwright/test';
import { addVirtualAuthenticator, expectNoHorizontalOverflow, expectTouchTargets, finishOnboarding, signUp } from './helpers';

/** Captures screens at phone, tablet and desktop sizes in both themes for manual review. */
const SIZES = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const scheme of ['light', 'dark'] as const) {
  test(`public pages · ${scheme}`, async ({ browser }) => {
    for (const s of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, colorScheme: scheme });
      const page = await ctx.newPage();
      for (const [path, slug] of [
        ['/', 'landing'],
        ['/how-it-works', 'how'],
        ['/signup', 'signup'],
        ['/signin', 'signin'],
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `test-results/screens/${slug}-${s.name}-${scheme}.png`, fullPage: true });
      }
      await ctx.close();
    }
  });

  test(`app pages · ${scheme}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await addVirtualAuthenticator(page);
    await signUp(page, `Visual ${scheme}`);
    await page.screenshot({ path: `test-results/screens/welcome-desktop-${scheme}.png`, fullPage: true });
    await finishOnboarding(page);
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.width, height: s.height });
      for (const path of ['/home', '/devices', '/space', '/cloud', '/account', '/devices/connect']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `test-results/screens/app${path.replace(/\//g, '-')}-${s.name}-${scheme}.png`, fullPage: true });
        await expectNoHorizontalOverflow(page);
        if (s.name === 'mobile') await expectTouchTargets(page);
      }
    }
    await ctx.close();
  });
}
