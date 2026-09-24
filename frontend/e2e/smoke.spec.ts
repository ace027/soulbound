import { expect, test, type Page } from '@playwright/test';

/**
 * Layout smoke test — the only place in this repo with a real layout engine.
 *
 * Phase 3 fixed four CLAUDE.md #3 `min-height: 0` violations and proved the
 * result by hand, once, with screenshots into a scratch directory that no
 * longer exists. This file is retro action item 5: the same evidence, on
 * demand, from a committed test.
 *
 * ── What this asserts that the 129-test jsdom suite cannot ───────────────
 * jsdom runs no layout. Every box is 0x0 and `scrollHeight` always equals
 * `clientHeight`, so the Vitest suite can only check *declared* style
 * properties — which does catch a deleted `flex: 1` or `minHeight: 0`, but is
 * blind to whether the result actually renders. Everything below reads real
 * post-layout geometry (`getBoundingClientRect`, `scrollHeight`,
 * `clientHeight`, `scrollTop`). A declared-style assertion in this file would
 * duplicate the jsdom suite and prove nothing new, so there are none.
 *
 * ── Zero API calls, by construction ──────────────────────────────────────
 * Two save slots are seeded into `localStorage` by `addInitScript` before the
 * app boots (App.tsx's mount effect reads the index on the first render), then
 * loaded via the title screen's Continue button. `handleLoadSave` goes
 * title → simulation with no network call at all, so this suite runs green
 * with no ANTHROPIC_API_KEY present. The character-creation flow is
 * deliberately NOT exercised here: it needs three model calls or a stub swap,
 * and neither belongs in a committed smoke test.
 *
 * ── Key strings ──────────────────────────────────────────────────────────
 * `sbc-save:` and `sbc-save-index` are written out by hand, exactly as
 * frontend/src/lib/__tests__/saves.test.ts:16-17 does and for the same
 * reason: they are the byte-for-byte contract with the artifact's
 * localStorage, and a copy that follows the constant wherever it drifts would
 * report green while every existing playthrough became unreachable.
 */
const SAVE_PREFIX = 'sbc-save:';
const SAVE_INDEX_KEY = 'sbc-save-index';

/** Legacy's mobile breakpoint, `window.innerWidth < 700` (useIsMobile.ts). */
const MOBILE = { width: 375, height: 800 };
const DESKTOP = { width: 1280, height: 800 };

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeGameState(name: string) {
  return {
    character: {
      name,
      race: {
        id: 'mycelium',
        name: 'Mycelium',
        desc: 'A colony that learned to want.',
        intrinsic: [
          { name: 'Spore Sense', description: 'Reads the air for kin.' },
          { name: 'Rootbound', description: 'Draws on what it stands in.' },
        ],
      },
      uniqueSkill: {
        skill_name: 'The Patient Ledger',
        tier: 'Unique',
        description: 'Remembers every debt owed to it.',
        soul_resonance: 'Patience sharpened into accounting.',
        etching_text: 'The world writes a name it did not choose.',
      },
      answers: { nature: 'patient', drive: 'debt', flaw: 'slow', memory: 'a ledger', bond: 'none' },
    },
    skills: [
      { name: 'Spore Sense', tier: 'Intrinsic', mastery: 6, description: 'Reads the air for kin.' },
      { name: 'Rootbound', tier: 'Intrinsic', mastery: 4, description: 'Draws on what it stands in.' },
      {
        name: 'The Patient Ledger',
        tier: 'Unique',
        mastery: 22,
        description: 'Remembers every debt owed to it.',
        soul_resonance: 'Patience sharpened into accounting.',
        sub_abilities: [],
        usage_notes: [],
      },
    ],
    location: 'The Rotting Cloister, Vaeltharion',
    currentScene: 'Spore-light drifts between the pillars.',
    actionHistory: ['listened to the walls'],
    narrativeMemory: { entities: {}, notes: ['The cloister remembers.'] },
  };
}

/**
 * `count` narration entries of real prose. The long-log slot needs enough text
 * to overflow 800px of viewport with room to spare, or the "genuinely
 * overflows" assertion would be measuring the fixture rather than the layout.
 */
function makeLog(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'narration' as const,
    text:
      `Turn ${i + 1}. The spore-light shifts along the cloister wall, and something ` +
      'beneath the flagstones adjusts its weight. A debt is noted. A name is not ' +
      'spoken. The air tastes of old rain and older arithmetic, and the colony ' +
      'that is you counts what it is owed without once being asked to.',
  }));
}

function makeSlot(name: string, logLength: number) {
  return {
    gameState: makeGameState(name),
    log: makeLog(logLength),
    savedAt: 1_750_000_000_000,
    schemaVersion: 1,
  };
}

/** Distinct names so each test can pick its own card off the title screen. */
const LONG = { id: 'sbc_e2e_long', name: 'Verrin Ashgrave', entries: 30 };
const SHORT = { id: 'sbc_e2e_short', name: 'Ilma Quiet', entries: 1 };

/**
 * Seed both slots before any app script runs. `addInitScript` is required
 * rather than a post-load `evaluate`: App.tsx reads the save index in a mount
 * effect, so a save written after boot would never appear on the title screen.
 */
async function seedSaves(page: Page) {
  const slots = [
    { id: LONG.id, slot: makeSlot(LONG.name, LONG.entries) },
    { id: SHORT.id, slot: makeSlot(SHORT.name, SHORT.entries) },
  ];
  await page.addInitScript(
    ({ prefix, indexKey, payload }) => {
      const index = payload.map(({ id, slot }) => ({
        id,
        name: slot.gameState.character.name,
        race: slot.gameState.character.race.name,
        location: slot.gameState.location,
        skillCount: slot.gameState.skills.length,
        savedAt: slot.savedAt,
        uniqueSkill: 'The Patient Ledger',
      }));
      for (const { id, slot } of payload) {
        localStorage.setItem(prefix + id, JSON.stringify(slot));
      }
      localStorage.setItem(indexKey, JSON.stringify(index));
    },
    { prefix: SAVE_PREFIX, indexKey: SAVE_INDEX_KEY, payload: slots },
  );
}

/** Title screen → simulation, via the Continue button on the named save card. */
async function loadSave(page: Page, characterName: string) {
  await page.goto('/');
  const card = page.locator('.save-card', { hasText: characterName });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Continue' }).click();
  // The simulation screen is the only phase that renders the action bar.
  await expect(page.locator(ACTION_TEXTAREA)).toBeVisible();
}

// ─── Geometry probe ─────────────────────────────────────────────────────────

const ACTION_TEXTAREA = 'textarea[placeholder="What do you do?"]';

interface BoxInfo {
  tag: string;
  id: string;
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}

interface Probe {
  /** WorldLog's root — the scroll container. */
  scroll: BoxInfo;
  /** ActionBar's root. */
  actionBar: BoxInfo;
  /**
   * Every ancestor of the scroll container from itself up to and including
   * `#root`, innermost first. In the mobile layout that is the WorldLog root,
   * the ex-Fragment div, the content wrapper, the screen root and `#root`; in
   * the desktop layout, the WorldLog root, the right panel, the screen root
   * and `#root`.
   */
  chain: BoxInfo[];
  viewport: { width: number; height: number };
}

/**
 * Located structurally rather than by a test id, because the ported components
 * carry no test ids and CLAUDE.md forbids restyling or re-marking them during
 * the migration. The chain textarea → input box → flex row → ActionBar root is
 * ActionBar.tsx's markup exactly; WorldLog's root is ActionBar's previous
 * sibling in both the mobile and the desktop layout.
 */
async function probeLayout(page: Page): Promise<Probe> {
  return page.evaluate((textareaSelector) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: (el as HTMLElement).id || '',
        width: r.width,
        height: r.height,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        clientHeight: (el as HTMLElement).clientHeight,
        scrollHeight: (el as HTMLElement).scrollHeight,
        scrollTop: (el as HTMLElement).scrollTop,
      };
    };

    const textarea = document.querySelector(textareaSelector);
    if (!textarea) throw new Error('action bar textarea not found');
    const actionBar = textarea.parentElement?.parentElement?.parentElement;
    if (!actionBar) throw new Error('action bar root not found');
    const scroll = actionBar.previousElementSibling;
    if (!scroll) throw new Error('world log scroll container not found');

    const chain = [];
    for (let el: Element | null = scroll; el && el !== document.body; el = el.parentElement) {
      chain.push(box(el));
    }

    return {
      scroll: box(scroll),
      actionBar: box(actionBar),
      chain,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, ACTION_TEXTAREA);
}

/**
 * The regression guard, and the reason this file exists.
 *
 * `chain` runs from the scroll container up to `#root`. Two properties must
 * hold of every link, and neither is visible to jsdom:
 *
 *  1. **Nothing collapsed.** A non-zero width AND height. A panel that has
 *     lost its height renders as nothing at all while every declared style in
 *     the jsdom suite still reads correct.
 *  2. **Nothing overflowed.** Each element fits inside its parent's box. This
 *     is the actual failure signature CLAUDE.md #3 describes: a flex child
 *     whose automatic minimum size grows the container instead of scrolling
 *     inside it. The container is measured, not its declared `min-height`.
 */
function expectChainIntact(probe: Probe) {
  for (const [i, node] of probe.chain.entries()) {
    const label = `chain[${i}] <${node.tag}${node.id ? `#${node.id}` : ''}>`;
    expect(node.width, `${label} collapsed horizontally`).toBeGreaterThan(0);
    expect(node.height, `${label} collapsed vertically`).toBeGreaterThan(0);

    const parent = probe.chain[i + 1];
    if (parent) {
      // 1px of slack for sub-pixel layout rounding, nothing more.
      expect(node.height, `${label} overflows its parent's height`).toBeLessThanOrEqual(
        parent.height + 1,
      );
      expect(node.width, `${label} overflows its parent's width`).toBeLessThanOrEqual(
        parent.width + 1,
      );
    }
  }

  // A chain can be internally consistent and still be a collapsed layout — every
  // link 40px tall, or 190px wide inside a 375px screen — so the two outermost
  // links are also measured against what contains them.
  const mountNode = probe.chain[probe.chain.length - 1]; // #root
  const screenRoot = probe.chain[probe.chain.length - 2]; // SimulationScreen's root
  expect(probe.chain.length, 'flex chain is shorter than the known layout').toBeGreaterThanOrEqual(
    2,
  );

  expect(mountNode.height, '#root does not fill the viewport height').toBeGreaterThanOrEqual(
    probe.viewport.height - 1,
  );

  // The screen root must span the full width of the mount node — a horizontal
  // collapse leaves every link non-zero and every declared style correct while
  // the app renders in a column down the left of the screen.
  //
  // Checked as "fills its parent" rather than "equals the viewport" because on
  // desktop the inner links legitimately do not: the world column shares the
  // row with a 240px sidebar.
  //
  // Measured, not assumed: giving `#root` a `display: flex` (04-01's recorded
  // precondition — it makes both screen roots flex items) does NOT trip this
  // assertion on the World tab, because the narration prose has a wide
  // max-content size and the flex item is clamped back to the full width
  // anyway. It trips on narrow content: the mutant is caught by the mobile
  // Soul Codex width assertion at the end of the resize test, which measures
  // 194px inside a 375px screen. See 04-03-SUMMARY.md, mutant 4.
  expect(
    screenRoot.width,
    'the screen root does not fill its mount node — the layout has collapsed horizontally',
  ).toBeGreaterThanOrEqual(mountNode.width - 1);
}

/**
 * The action bar is pinned to the bottom of its layout, and on screen.
 *
 * "Pinned, not pushed off" is a claim about the bottom EDGE, not merely about
 * visibility: an action bar that has drifted to the middle of the screen is
 * still inside the viewport. The primary assertion is therefore that the
 * action bar's bottom coincides with the bottom of the outermost element in
 * the flex chain — the screen root, the `height: 100vh` div SimulationScreen
 * returns. See the short-log test for why that edge is the assertion with
 * teeth.
 *
 * ── The 8px allowance is a recorded finding, not slack for convenience ────
 * Neither frontend/src/index.css nor legacy/souldbound-world.jsx declares a
 * `body` rule (`grep -cE '^\s*(body|#root)\s*\{' frontend/src/index.css` → 0),
 * so `body` keeps the UA default `margin: 8px`. A `height: 100vh` screen inside
 * an 8px-margined body is 8px taller than the document's visible area, and the
 * whole page acquires a scrollbar: measured here, body.top = 6 and
 * body.bottom = 806 in an 800px viewport. The artifact never showed this
 * because it rendered inside a Claude.ai iframe whose host page reset margins.
 * It is inherited, it is faithful to the port, and fixing it is a one-line CSS
 * change outside this plan's declared files — so it is allowed for by an
 * explicitly named constant and written up in 04-03-SUMMARY.md rather than
 * hidden inside a fuzzy tolerance. Drop this to 0 the moment a reset lands.
 */
const BODY_MARGIN_OVERHANG_PX = 8;

function expectActionBarPinned(probe: Probe) {
  const { actionBar, viewport } = probe;
  // length - 2, matching expectChainIntact: the LAST chain entry is #root (the
  // mount node), and the screen root is the `height: 100vh` div SimulationScreen
  // returns. They coincide today only because index.css declares no #root rule,
  // so #root is a plain block box sized by its child. The moment #root acquires
  // layout of its own the two diverge — and this assertion would silently start
  // measuring something other than what its name says.
  const screenRoot = probe.chain[probe.chain.length - 2];

  expect(actionBar.height, 'action bar has no height').toBeGreaterThan(0);
  expect(actionBar.width, 'action bar has no width').toBeGreaterThan(0);

  // The real pinning claim, independent of the body-margin overhang above.
  expect(
    Math.abs(screenRoot.bottom - actionBar.bottom),
    'action bar is not flush with the bottom of the layout',
  ).toBeLessThanOrEqual(1);

  // And it is on screen.
  expect(actionBar.top, 'action bar starts above the viewport').toBeGreaterThanOrEqual(0);
  expect(actionBar.left, 'action bar starts left of the viewport').toBeGreaterThanOrEqual(0);
  expect(actionBar.right, 'action bar is pushed right of the viewport').toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(actionBar.bottom, 'action bar is pushed below the viewport').toBeLessThanOrEqual(
    viewport.height + BODY_MARGIN_OVERHANG_PX,
  );
}

/**
 * App.tsx scrolls the log to the bottom on every log change with
 * `scrollIntoView({ behavior: 'smooth' })`. Reading `scrollTop` mid-animation
 * would make the scroll assertion a race, so wait for it to settle first.
 */
async function waitForScrollToSettle(page: Page) {
  await expect
    .poll(
      async () => {
        const a = await scrollTopOf(page);
        await page.waitForTimeout(100);
        const b = await scrollTopOf(page);
        return a === b;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

function scrollTopOf(page: Page): Promise<number> {
  return page.evaluate((sel) => {
    const textarea = document.querySelector(sel);
    const actionBar = textarea?.parentElement?.parentElement?.parentElement;
    return (actionBar?.previousElementSibling as HTMLElement).scrollTop;
  }, ACTION_TEXTAREA);
}

// ─── Zero-cost guard ────────────────────────────────────────────────────────

/**
 * "No API calls" is a must-have of this plan, so it is enforced rather than
 * asserted in prose. Every request the page makes is recorded, and any request
 * to the backend proxy or straight to Anthropic fails the test that made it.
 *
 * This is what keeps the suite free forever: if someone later reaches the
 * simulation screen through the creation flow instead of a seeded save, or
 * adds a turn that calls the world engine, this trips instead of quietly
 * spending money on every run.
 */
const offenders = new WeakMap<object, string[]>();

test.beforeEach(async ({ page }) => {
  // Phase 5's AccessGate (R19) calls GET /api/access on mount, before the
  // title screen — every test in this file now makes that one call. It never
  // reaches Anthropic (it is answered here, not by a backend), so it is the
  // ONE path exempted from the no-paid-call guard below. Registered before
  // any `page.goto` (loadSave() below is the first one), since a route
  // registered after navigation starts would miss the gate's mount-effect
  // request.
  await page.route('**/api/access', (route) => route.fulfill({ status: 204 }));

  const seen: string[] = [];
  offenders.set(page, seen);
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/access(\?|$)/.test(url)) return;
    if (/\/api\//.test(url) || /anthropic\.com/.test(url)) seen.push(`${req.method()} ${url}`);
  });
});

test.afterEach(({ page }) => {
  expect(offenders.get(page) ?? [], 'this test made a paid API call').toEqual([]);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

for (const [label, viewport] of [
  ['mobile 375x800', MOBILE],
  ['desktop 1280x800', DESKTOP],
] as const) {
  test(`world log overflows, scrolls and keeps its chain intact — ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seedSaves(page);
    await loadSave(page, LONG.name);
    await waitForScrollToSettle(page);

    const probe = await probeLayout(page);

    // 1. The scroll container genuinely overflows — the content is taller than
    //    the box. jsdom reports scrollHeight === clientHeight here, always.
    expect(
      probe.scroll.scrollHeight,
      'world log does not overflow: the fixture is too short to prove anything',
    ).toBeGreaterThan(probe.scroll.clientHeight);

    // 2. It genuinely scrolls, through a real wheel event rather than an
    //    assignment to scrollTop, so a container that is not actually a scroll
    //    container cannot pass.
    const before = probe.scroll.scrollTop;
    expect(before, 'log did not auto-scroll to the bottom on load').toBeGreaterThan(0);
    await page.mouse.move(
      probe.scroll.left + probe.scroll.width / 2,
      probe.scroll.top + probe.scroll.height / 2,
    );
    await page.mouse.wheel(0, -400);
    await expect.poll(() => scrollTopOf(page), { timeout: 5_000 }).toBeLessThan(before);

    // 3. The action bar is on screen and flush with the bottom.
    expectActionBarPinned(probe);

    // 4. Nothing in the flex ancestor chain collapsed or overflowed.
    expectChainIntact(probe);
  });
}

/**
 * The `flex: 1` guard.
 *
 * With a nearly empty log there is nothing to push the action bar anywhere:
 * every ancestor is still non-zero, nothing overflows, and the action bar is
 * still comfortably inside the viewport. The single thing that changes when
 * the ex-Fragment div (SimulationScreen.tsx, the CLAUDE.md #3 site-2 fix)
 * loses its `flex: 1` is that the div stops filling its parent and collapses
 * to content height — so the action bar rides up under the one log entry
 * instead of sitting at the bottom of the screen.
 *
 * That is invisible to every other assertion in this file and to all 129
 * jsdom tests once they stop reading the declared style. It needs a short log:
 * with a long one the div's flex-shrink pulls it back to exactly the parent's
 * height and the two cases are geometrically identical.
 */
for (const [label, viewport] of [
  ['mobile 375x800', MOBILE],
  ['desktop 1280x800', DESKTOP],
] as const) {
  test(`action bar stays pinned to the bottom with a nearly empty log — ${label}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await seedSaves(page);
    await loadSave(page, SHORT.name);

    const probe = await probeLayout(page);

    expect(
      probe.scroll.scrollHeight,
      'the short fixture is not short: it overflows, so this test proves nothing',
    ).toBeLessThanOrEqual(probe.scroll.clientHeight + 1);

    expectActionBarPinned(probe);
    expectChainIntact(probe);
  });
}

/**
 * R12's first bug, as a test.
 *
 * Legacy read `window.innerWidth < 700` during render with no subscription, so
 * crossing the breakpoint left the layout stale until something unrelated
 * re-rendered. `useIsMobile` replaced that with a `resize` listener. Phase 3
 * could only demonstrate the fix by dragging a window by hand; this resizes
 * the viewport **without reloading**, which is the whole point — a reload
 * would pass even with the legacy render-time read.
 *
 * The two layouts are told apart by what is on screen, not by a class name:
 * desktop renders the Soul Codex as a permanent 240px sidebar beside the world
 * log; mobile renders a World/Codex tab bar and only one of the two at a time.
 */
test('resizing across the 700px breakpoint switches layout without a reload', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seedSaves(page);
  await loadSave(page, LONG.name);

  const worldTab = page.getByRole('button', { name: /World/ });
  const codexHeading = page.getByText('Soul Codex', { exact: true });

  // Desktop: no tab bar, and the codex sits to the LEFT of the world log.
  await expect(worldTab).toHaveCount(0);
  await expect(codexHeading).toBeVisible();

  const desktopProbe = await probeLayout(page);
  const sidebar = await codexHeading.evaluate((el) => {
    // The Soul Codex header's scrolling root is SoulCodexContents; its parent
    // is the desktop left panel.
    const panel = el.parentElement?.parentElement?.parentElement?.parentElement;
    const r = (panel as HTMLElement).getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, height: r.height };
  });
  expect(sidebar.width, 'desktop sidebar has no width').toBeGreaterThan(0);
  expect(sidebar.height, 'desktop sidebar has no height').toBeGreaterThan(0);
  expect(
    sidebar.right,
    'desktop sidebar is not beside the world log — this is not the two-panel layout',
  ).toBeLessThanOrEqual(desktopProbe.scroll.left + 1);

  // Resize only. No reload, no navigation.
  await page.setViewportSize(MOBILE);

  // Mobile: the tab bar appears, and the codex is gone while World is active.
  await expect(worldTab).toHaveCount(1);
  await expect(codexHeading).toHaveCount(0);

  // And the mobile layout is a real, intact single column.
  const mobileProbe = await probeLayout(page);
  expect(mobileProbe.viewport.width).toBe(MOBILE.width);
  expectActionBarPinned(mobileProbe);
  expectChainIntact(mobileProbe);

  // Switching to the Codex tab shows it full-width, not as a sidebar.
  await page.getByRole('button', { name: /Codex/ }).click();
  await expect(codexHeading).toBeVisible();
  const codexBox = await codexHeading.evaluate((el) => {
    const r = (el.parentElement as HTMLElement).getBoundingClientRect();
    return { width: r.width };
  });
  expect(codexBox.width, 'mobile codex is rendered at sidebar width').toBeGreaterThan(240);
});

/**
 * The AccessGate form itself (Phase 5, R19), the one new e2e test this plan
 * adds. `/api/access` is overridden here to 401 `PASSPHRASE_REQUIRED` (the
 * `beforeEach` route above always applies first; a route registered later
 * takes priority for the same pattern), so the gate never resolves 'ok' and
 * the form must render instead of the title screen. Nothing in `seedSaves`
 * or `loadSave` is used — there is no game to reach behind a sealed gate.
 *
 * One test, both viewports (no reload between them — `setViewportSize` on the
 * already-loaded page, same technique as the breakpoint-resize test above),
 * so this file still gains exactly one new test and the suite's total goes
 * 5 → 6, not 5 → 7.
 */
test('the passphrase form is visible, usable and on screen', async ({ page }) => {
  await page.route('**/api/access', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' },
      }),
    }),
  );

  async function assertFormOnScreen(atMobileWidth: boolean) {
    const input = page.getByLabel('Passphrase');
    const button = page.getByRole('button', { name: 'Enter' });

    await expect(input).toBeVisible();
    await expect(button).toBeVisible();

    const vp = page.viewportSize()!;
    const inputBox = await input.boundingBox();
    const buttonBox = await button.boundingBox();
    expect(inputBox, 'passphrase input has no layout box').not.toBeNull();
    expect(buttonBox, 'submit button has no layout box').not.toBeNull();

    for (const box of [inputBox!, buttonBox!]) {
      expect(box.x, 'element starts left of the viewport').toBeGreaterThanOrEqual(0);
      expect(box.y, 'element starts above the viewport').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'element extends right of the viewport').toBeLessThanOrEqual(
        vp.width + 1,
      );
      expect(box.y + box.height, 'element extends below the viewport').toBeLessThanOrEqual(
        vp.height + 1,
      );
    }

    await input.focus();
    await expect(input).toBeFocused();

    if (atMobileWidth) {
      // The keyboard margin: a mobile on-screen keyboard is roughly 300px
      // tall, so the input must sit in the upper half of the viewport or a
      // keyboard would cover it while the player types.
      expect(
        inputBox!.y,
        'passphrase input is not in the upper half of the viewport',
      ).toBeLessThan(vp.height / 2);
    }
  }

  await page.setViewportSize(MOBILE);
  await page.goto('/');
  await assertFormOnScreen(true);

  await page.setViewportSize(DESKTOP);
  await assertFormOnScreen(false);

  // A real submit. `/api/access` is the one path the no-paid-call guard
  // exempts (see beforeEach above), so re-routing it here costs nothing.
  // A route registered later takes priority for the same pattern, so this
  // supersedes both the `beforeEach`'s 204 and the 401 registered above it
  // for the rest of this test.
  const submittedAuth: (string | undefined)[] = [];
  await page.route('**/api/access', (route) => {
    const auth = route.request().headers()['authorization'];
    submittedAuth.push(auth);
    if (auth === 'Bearer the-right-passphrase') {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' },
      }),
    });
  });

  const input = page.getByLabel('Passphrase');
  await input.fill('the-right-passphrase');
  await input.press('Enter');

  await expect(page.getByText('The Soulbound Chronicles')).toBeVisible();
  expect(submittedAuth).toContain('Bearer the-right-passphrase');
});
