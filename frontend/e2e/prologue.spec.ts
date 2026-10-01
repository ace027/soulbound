/**
 * Placement checks for the prologue (Phase 14, plan 14-04; retro AI-6: new UI
 * ships with a real-layout check).
 *
 * ── What jsdom cannot see ────────────────────────────────────────────────
 * `prologueScreen.test.tsx` runs in jsdom, where every box is 0x0 and
 * `scrollWidth` always equals `clientWidth`. It can prove which elements exist
 * and what they say; it cannot prove the Act button clears the textarea, that
 * a 2000-character unbroken action wraps instead of widening the page, that the
 * new narration is actually on screen after a turn, or that nothing overlaps at
 * a phone width. Everything below reads post-layout geometry
 * (`getBoundingClientRect`, `scrollWidth`, `clientWidth`, `innerHeight`).
 *
 * ── No backend, no Anthropic ─────────────────────────────────────────────
 * `/api/access` answers 204 (self-host), `/api/prologue/beat` and
 * `/api/prologue/profile` are fulfilled here, and ANY other `/api/*` request,
 * or one to anthropic.com, is collected into `stray` and fails the test. The
 * spec never clicks "Let it take hold" (that would call /api/unique-skill; the
 * App-level integration test covers it), so the profile route is mocked but
 * never reached.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

const PROFILE = {
  nature: 'It held its ground when the cold came.',
  drive: 'It put the other soul first.',
  flaw: 'It did not weigh its own cost.',
  memory: 'It let go at the doorway and gave up its name.',
  bond: 'It treated power as something to spend for others.',
};

/** Realistic-length prose, so four of these push a 390px page past one screen. */
const FILLER =
  ' The cold presses against the threshold and the small soul beside you flickers, ' +
  'unsure whether to follow. Something patient waits in the dark beyond the doorway, ' +
  'and it is listening for what you do next, not for what you say.';

const narrationFor = (n: number) => `Beat ${n} narration.${FILLER}`;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface Harness {
  stray: string[];
  /** Beat requests seen so far. */
  beatCalls: () => number;
}

interface HarnessOptions {
  /** 1-based beat request numbers answered with a 502 instead of a narration. */
  failBeats?: number[];
  /** Resolve this to let a held beat request through; requests wait on it when set. */
  gate?: Promise<void>;
  /** Only the first request is gated (so a later turn is not held forever). */
  gateFirstOnly?: boolean;
}

async function setUp(page: Page, viewport: { width: number; height: number }, opts: HarnessOptions = {}): Promise<Harness> {
  const stray: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/(access|prologue\/beat|prologue\/profile)(\?|$)/.test(url)) return;
    if (/\/api\//.test(url) || /anthropic\.com/.test(url)) stray.push(`${req.method()} ${url}`);
  });
  await page.route('**/api/access', (route) => route.fulfill({ status: 204 }));
  let beats = 0;
  await page.route('**/api/prologue/beat', async (route) => {
    beats += 1;
    const n = beats;
    if (opts.gate && (!opts.gateFirstOnly || n === 1)) await opts.gate;
    if (opts.failBeats?.includes(n)) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'the aether is quiet' } }),
      });
    }
    // The turn number the SCREEN is on is the count of successful beats + 1;
    // a failed request does not advance it, so number by successes.
    const succeeded = beats - (opts.failBeats?.filter((f) => f < n).length ?? 0);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ narration: narrationFor(succeeded), beat: succeeded, final: succeeded === 4 }),
    });
  });
  await page.route('**/api/prologue/profile', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROFILE) }),
  );
  await page.setViewportSize(viewport);
  return { stray, beatCalls: () => beats };
}

/** Title -> combined race-and-name screen -> the prologue, by role and accessible name. */
async function walkToPrologue(page: Page) {
  await page.goto('/?prologue=1');
  await page.getByRole('button', { name: '✦ Begin Your Chronicle' }).click();
  await page.getByPlaceholder('What are you called?').fill('Yulen Marr');
  await page.getByText('Shadeveil', { exact: true }).click();
  await page.getByRole('button', { name: 'Enter the World Voice' }).click();
  await expect(page.getByText('The World Voice Speaks — The Threshold')).toBeVisible();
}

const box = (page: Page) => page.getByPlaceholder('Say or do anything...');
const actButton = (page: Page) => page.getByRole('button', { name: /^Act/ });

async function rect(locator: Locator): Promise<Rect> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });
}

const intersects = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollHeight: document.body.scrollHeight,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));
}

async function takeTurn(page: Page, n: number, action = `action ${n}`) {
  await box(page).fill(action);
  await actButton(page).click();
  await expect(page.getByText(`Beat ${n} narration.`)).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`prologue placement at ${viewport.width}px`, () => {
    test('opening: no page frame, no overflow, Act clears the textarea, Return to title is above the label', async ({ page }) => {
      const h = await setUp(page, viewport);
      await walkToPrologue(page);

      // No page frame: the screen container starts at x = 0 and spans the viewport.
      // Only x is asserted. The container's TOP is not 0 here: PrologueScreen
      // scrolls its end marker into view on mount, and sharedBg's
      // `minHeight: 100vh` plus 32px of vertical padding makes the page 64px
      // taller than the viewport, so the page opens already scrolled by 64px.
      // That is reported as a visual defect in the 14-04 summary, not pinned.
      const frame = await page.evaluate(() => {
        const r = document.getElementById('root')!.firstElementChild!.getBoundingClientRect();
        return { left: r.left, width: r.width, innerWidth: window.innerWidth };
      });
      expect(frame.left).toBe(0);
      expect(frame.width).toBe(frame.innerWidth);

      const o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);

      const ta = await rect(box(page));
      const act = await rect(actButton(page));
      expect(act.top).toBeGreaterThanOrEqual(ta.bottom);
      expect(intersects(ta, act)).toBe(false);
      for (const r of [ta, act]) {
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(o.innerWidth);
      }

      // Return to title sits at the top-left, above the scene label, not over it.
      const ret = await rect(page.getByRole('button', { name: /Return to title/ }));
      const label = await rect(page.getByText('The World Voice Speaks — The Threshold'));
      expect(ret.bottom).toBeLessThanOrEqual(label.top);
      expect(ret.left).toBe(label.left);
      expect(intersects(ret, label)).toBe(false);

      // The input sits BELOW the opening text, not on top of it or the header.
      // (Act-below-textarea alone passes if the whole input block is displaced
      // upward, which a mutation check showed.)
      const opening = await rect(page.getByText(/^You are dissolving\./));
      expect(label.bottom).toBeLessThanOrEqual(opening.top);
      expect(ta.top).toBeGreaterThanOrEqual(opening.bottom);
      for (const upper of [ret, label, opening]) {
        expect(intersects(ta, upper)).toBe(false);
        expect(intersects(act, upper)).toBe(false);
      }

      expect(h.stray, 'this test made an unmocked API call').toEqual([]);
    });

    test('four turns: each narration lands in the viewport unscrolled; the end of the scene is reachable with no horizontal overflow', async ({ page }) => {
      const h = await setUp(page, viewport);
      await walkToPrologue(page);

      for (let n = 1; n <= 4; n++) {
        await takeTurn(page, n);
        // No manual scroll: the screen scrolls the new narration into view itself.
        const narration = page.getByText(`Beat ${n} narration.`);
        await expect
          .poll(async () => {
            const r = await rect(narration);
            const ih = await page.evaluate(() => window.innerHeight);
            return r.top >= 0 && r.bottom <= ih;
          }, { message: `beat ${n} narration should be inside the viewport without a manual scroll` })
          .toBe(true);
        const o = await overflow(page);
        expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);
      }

      // The scene is over: the controls changed.
      await expect(page.getByRole('button', { name: /Let it take hold/ })).toBeVisible();
      await expect(box(page)).toHaveCount(0);

      if (viewport.width === 390) {
        const o = await overflow(page);
        expect(o.bodyScrollHeight, 'four turns must push the 390px page past one screen').toBeGreaterThan(o.innerHeight);
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const hold = page.getByRole('button', { name: /Let it take hold/ });
      const copy = page.getByRole('button', { name: 'Copy scene record' });
      const holdR = await rect(hold);
      const copyR = await rect(copy);
      const o = await overflow(page);
      expect(holdR.top).toBeGreaterThanOrEqual(0);
      expect(holdR.bottom).toBeLessThanOrEqual(o.innerHeight);
      expect(holdR.left).toBeGreaterThanOrEqual(0);
      expect(holdR.right).toBeLessThanOrEqual(o.innerWidth);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);
      // The two final buttons do not overlap each other.
      expect(intersects(holdR, copyR)).toBe(false);

      // Back at the top, Return to title is still top-left, above the label.
      await page.evaluate(() => window.scrollTo(0, 0));
      const ret = await rect(page.getByRole('button', { name: /Return to title/ }));
      const label = await rect(page.getByText('The World Voice Speaks — The Threshold'));
      expect(ret.bottom).toBeLessThanOrEqual(label.top);
      expect(ret.left).toBe(label.left);
      expect(intersects(ret, label)).toBe(false);
      if (viewport.width === 390) expect(ret.top).toBeLessThanOrEqual(40);

      expect(h.beatCalls()).toBe(4);
      expect(h.stray, 'this test made an unmocked API call').toEqual([]);
    });

    test('an unbroken 2000-character action causes no horizontal overflow', async ({ page }) => {
      const h = await setUp(page, viewport);
      await walkToPrologue(page);

      await box(page).fill('x'.repeat(2000));
      await actButton(page).click();
      await expect(page.getByText('Beat 1 narration.')).toBeVisible();

      const o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);
      // The echoed action itself stays inside the viewport width.
      const echoed = await rect(page.getByText(/^You — x{100}/));
      expect(echoed.left).toBeGreaterThanOrEqual(0);
      expect(echoed.right).toBeLessThanOrEqual(o.innerWidth);

      expect(h.stray, 'this test made an unmocked API call').toEqual([]);
    });

    test('a beat failure shows the alert without overlapping the textarea or Act', async ({ page }) => {
      const h = await setUp(page, viewport, { failBeats: [1] });
      await walkToPrologue(page);

      await box(page).fill('I reach out');
      await actButton(page).click();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('The World Voice fell silent.');

      const a = await rect(alert);
      const ta = await rect(box(page));
      const act = await rect(actButton(page));
      expect(intersects(a, ta)).toBe(false);
      expect(intersects(a, act)).toBe(false);
      expect(intersects(ta, act)).toBe(false);
      const o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(o.innerWidth);
      // The player's words came back for a retry.
      await expect(box(page)).toHaveValue('I reach out');

      expect(h.stray, 'this test made an unmocked API call').toEqual([]);
    });

    test('while a beat is pending, the waiting line does not overlap the textarea', async ({ page }) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const h = await setUp(page, viewport, { gate, gateFirstOnly: true });
      await walkToPrologue(page);

      await box(page).fill('I wait at the door');
      await actButton(page).click();
      const waiting = page.getByText('The dark answers...');
      await expect(waiting).toBeVisible();
      await expect(box(page)).toBeDisabled();

      const w = await rect(waiting);
      const ta = await rect(box(page));
      const act = await rect(actButton(page));
      expect(intersects(w, ta)).toBe(false);
      expect(intersects(w, act)).toBe(false);
      const o = await overflow(page);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);

      release();
      await expect(page.getByText('Beat 1 narration.')).toBeVisible();
      await expect(waiting).toBeHidden();
      expect(h.stray, 'this test made an unmocked API call').toEqual([]);
    });

    test('copy scene record without a clipboard shows the fallback note and a textarea that fits', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined });
      });
      const h = await setUp(page, viewport);
      await walkToPrologue(page);
      for (let n = 1; n <= 4; n++) await takeTurn(page, n);

      await page.getByRole('button', { name: 'Copy scene record' }).click();
      await expect(page.getByText(/Could not copy automatically/)).toBeVisible();
      const record = page.getByRole('textbox', { name: 'Scene record' });
      await expect(record).toBeVisible();

      const r = await rect(record);
      const o = await overflow(page);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(o.innerWidth);
      expect(o.scrollWidth).toBeLessThanOrEqual(o.clientWidth);
      const inner = await record.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(inner.sw).toBeLessThanOrEqual(inner.cw);

      // Nothing in the fallback state overlaps the final buttons.
      const hold = await rect(page.getByRole('button', { name: /Let it take hold/ }));
      const copy = await rect(page.getByRole('button', { name: 'Copy scene record' }));
      expect(intersects(r, hold)).toBe(false);
      expect(intersects(r, copy)).toBe(false);
      expect(h.stray, 'this test made an unmocked API call').toEqual([]);
    });
  });
}
