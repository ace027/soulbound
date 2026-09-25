/**
 * The game fills the whole viewport, with no browser-default frame around it.
 *
 * Browsers give `body` an 8px margin by default. The Claude.ai artifact hid it
 * (its host iframe reset it); the standalone app showed it as a white border
 * around every screen until `index.css` reset it. jsdom does no layout, so
 * this can only be pinned in a real browser.
 *
 * `/api/access` is answered here (self-host 204), and every other `/api/*`
 * request fails the test, so nothing reaches a backend or Anthropic.
 */

import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`no page frame around the title screen at ${viewport.width}px`, async ({ page }) => {
    const stray: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/\/api\/access(\?|$)/.test(url)) return;
      if (/\/api\//.test(url) || /anthropic\.com/.test(url)) stray.push(`${req.method()} ${url}`);
    });
    await page.route('**/api/access', (route) => route.fulfill({ status: 204 }));
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'The Soulbound Chronicles' })).toBeVisible();

    const frame = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const html = getComputedStyle(document.documentElement);
      const root = document.getElementById('root')!.firstElementChild!.getBoundingClientRect();
      return {
        bodyMargin: body.margin,
        htmlBackground: html.backgroundColor,
        rootLeft: root.left,
        rootTop: root.top,
        rootWidth: root.width,
        innerWidth: window.innerWidth,
      };
    });
    expect(frame.bodyMargin).toBe('0px');
    // The page background is dark too, so overscroll never flashes white.
    expect(frame.htmlBackground).toBe('rgb(10, 8, 5)');
    // The first screen element starts at the corner and spans the viewport.
    expect(frame.rootLeft).toBe(0);
    expect(frame.rootTop).toBe(0);
    expect(frame.rootWidth).toBe(frame.innerWidth);
    expect(stray, 'this test made an API call').toEqual([]);
  });
}
