# 04-03 — Committed Playwright smoke test

**Plan**: `.planning/phases/04-parity-verification/04-03-PLAN.md` (Phase 4, wave 1)
**Retro action item**: AI-5 — Phase 3's visual evidence was captured once, by hand, into a
scratch directory that no longer exists, against a harness that was deleted.
**Status**: done. Four mutants run, three killed, one proven unkillable by geometry with the
proof included below.

---

## What landed

| File | Change |
|---|---|
| `frontend/e2e/smoke.spec.ts` | New. 5 tests, all real post-layout geometry. |
| `frontend/playwright.config.ts` | New. Chromium only, resolved `executablePath`, Vite `webServer` on 5174, `retries: 0`. |
| `frontend/package.json` | `@playwright/test@1.56.1` devDependency (exact) + `test:e2e` script. |
| `frontend/vitest.config.ts` | **Not in the plan's file list.** One line, forced — see "Unplanned file" below. |
| `package-lock.json` | Install footprint. |

Counts in this document carry the command that derives them.

---

## What the spec covers

Five tests (`cd frontend && npx playwright test --list` → `Total: 5 tests in 1 file`):

1. **`world log overflows, scrolls and keeps its chain intact`** — at 375x800 and 1280x800.
   - the scroll container genuinely overflows: `scrollHeight > clientHeight`
   - it genuinely scrolls: a real `mouse.wheel` event moves `scrollTop`
   - the action bar is flush with the bottom of the layout and on screen
   - every flex ancestor from the scroll container up to `#root` has non-zero width AND height,
     and none overflows its parent's box
2. **`action bar stays pinned to the bottom with a nearly empty log`** — at both viewports.
   Added during execution; it is the only thing that kills mutant 2 (see below).
3. **`resizing across the 700px breakpoint switches layout without a reload`** — loads at 1280,
   asserts the two-panel desktop form (Soul Codex sidebar measured to the *left* of the world
   log), then resizes to 375 **with no reload** and asserts the tabbed mobile form. This is
   R12's first bug, which Phase 3 could only demonstrate by hand.

Every assertion reads real geometry — `getBoundingClientRect`, `scrollHeight`, `clientHeight`,
`scrollTop`. There is not one declared-style assertion in the file, deliberately: the 129-test
jsdom suite already covers those, and duplicating them here would prove nothing new.

**Zero API calls are enforced, not claimed.** A `beforeEach`/`afterEach` pair records every
request the page makes and fails any test that hits `/api/` or `anthropic.com`. Verified live by
temporarily widening the filter to `/src/`, which turned the suite red. Two save slots are seeded
into `localStorage` by `addInitScript` before the app boots (App.tsx reads the index in a mount
effect), then loaded via the title screen's Continue button; `handleLoadSave` goes
title → simulation with no network call. The suite is green with `ANTHROPIC_API_KEY` unset.

## What the spec deliberately does not cover

- **The character-creation flow.** Race select → questionnaire → unique-skill determination →
  intro scene needs three model calls or a stub swap. Neither belongs in a committed smoke test.
  `frontend/src/lib/apiStub.ts` remains the sanctioned zero-cost fixture if that changes.
- **Any turn of play.** `handleAction` calls the world engine. Out of bounds for the same reason.
- **Visual/pixel diffing.** No screenshots are compared. The claim is structural, not cosmetic.
- **Browsers other than Chromium.** One browser, matching `vitest.config.ts`'s "harness, not a
  testing strategy" posture.

## How to run it

```
cd frontend && npm run test:e2e        # or: npx playwright test
```

No API key needed. Playwright starts and stops Vite itself on port 5174 (`strictPort`, so a
collision fails loudly rather than drifting to a port the tests are not pointed at).

`executablePath` is **resolved, not hardcoded**, so this runs for anyone:
`$PW_CHROMIUM_PATH` → the agent sandbox's `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
if present → Playwright's own managed browser. In the sandbox, do **not** run
`npx playwright install`; it tries to download and fails.

---

## Mutant results

Protocol per retro P2-3: each mutation's application was proven by an occurrence count before
and after plus a SHA change, and each restore proven with `git diff --exit-code <path>`
(exit 0) plus the SHA returning to its baseline.

### Mutant 1 — remove `minHeight: 0` from `SimulationScreen`'s mobile content wrapper: **SURVIVED**

Applied-proof: `orig=1 mutated=0 sha=0fc1c9fe7f259146` → `orig=0 mutated=1 sha=d294ca3cd58729c4`.
Result: **5 passed**. The e2e suite did not notice.

This is not a weak test. It is unkillable by *any* geometry assertion, and that was proven rather
than argued: full chain geometry (box, `clientHeight`, `scrollHeight`, `scrollTop` for the action
bar, every chain link and `body`, at both viewports and both fixtures) was dumped with the mutant
applied and again on restored code. `diff` of the two dumps is **empty** — the rendered layout is
byte-identical.

The cause: that wrapper already carries `overflow: "hidden"`. Per CSS Flexbox §4.5, a flex item's
automatic minimum size is content-based only when the item is **not** a scroll container, and
`overflow: hidden` makes it one. The `minHeight: 0` is therefore redundant *today* and
load-bearing the *moment* `overflow` changes. Confirmed by a follow-up diagnostic that removed
both (`overflow: "visible"` and no `minHeight: 0`): the mobile chain broke exactly as
CLAUDE.md #3 describes — the wrapper grew to content height, the action bar landed **4827px**
below the bottom of the layout, and the world log stopped overflowing
(`scrollHeight === clientHeight === 5492`). The suite went red immediately.

**Mutant 1 is still killed — by the jsdom suite, which is the correct guard for it.** Verified:
with the mutation applied, `cd frontend && npm test` → `Tests 1 failed | 128 passed (129)`, failing
`src/screens/__tests__/simulationScreen.test.tsx > applies minHeight:0 to the mobile content
wrapper (legacy 1386)` at `expect(contentWrapper.style.minHeight).toBe('0px')`.

The two suites are complementary, and this is the cleanest evidence in the phase for why both
exist: jsdom guards the *declaration*, Playwright guards the *consequence*. Neither subsumes the
other.

### Mutant 2 — remove `flex: 1` from the ex-Fragment div: **KILLED**

Applied-proof: `orig=1 mutated=0 sha=0fc1c9fe7f259146` → `orig=0 mutated=1 sha=6e96ccf422e40b3b`.
Result: **1 failed, 4 passed** —
`action bar stays pinned to the bottom with a nearly empty log — mobile 375x800`:

```
Error: action bar is not flush with the bottom of the layout
Expected: <= 1
Received:    451
```

Worth recording, because it changed the spec: **the long-log tests do not catch this.** Without
`flex: 1` the div falls back to `flex: 0 1 auto`; with a long log its content-sized flex base
exceeds the container, flex-shrink pulls it back to exactly the parent's height, and the two
cases are geometrically identical. The collapse only becomes visible when there is nothing to
push against. Hence the dedicated short-log test — it exists solely to kill this mutant, and the
plan's original four assertions would have let it through.

### Mutant 3 — pin `isMobile` to a constant (`useIsMobile.ts`): **KILLED**

Applied-proof: `orig=1 mutated=0 sha=eeb53e682cb729af` → `orig=0 mutated=1 sha=b1d4ece15cee69dc`.
Result: **2 failed, 3 passed** — `resizing across the 700px breakpoint switches layout without a
reload` fails on `expect(locator).toHaveCount(1)`, received `0`, `9 × locator resolved to 0
elements`: after the resize to 375 the World/Codex tab bar never appears. That is R12 bug 1's
exact signature.

### Mutant 4 (optional, from 04-01's recorded precondition) — add `#root { display: flex }`: **KILLED**

Applied-proof: `'#root' rules=0 sha=d3623e6f721bb7ca lines=103` →
`'#root' rules=1 sha=c542ee835adc27d6 lines=107`.
Result: **1 failed, 4 passed** — the resize test's mobile Soul Codex assertion:

```
Error: mobile codex is rendered at sidebar width
Expected: > 240
Received:   194.046875
```

04-01 predicted both chains would break at depth 1 on **height**. Measured, they break on
**width**: the screen roots become flex items and shrink to content width. On the World tab that
is invisible, because narration prose has a wide max-content size and the item is clamped back to
full width anyway; on the narrow Codex tab the app collapses to a 194px column inside a 375px
screen. A `screenRoot.width >= mountNode.width` assertion was added to the chain guard during
execution and the code comment records honestly that it is the *codex* assertion, not the chain
one, that fires for this mutant.

---

## Unplanned file: `frontend/vitest.config.ts`

One line, and it was forced. That config sets `exclude`, which **replaces** Vitest's defaults
rather than extending them, and Vitest's default `include` matches any `*.spec.ts`. The moment
`e2e/smoke.spec.ts` existed, `npm test` picked it up, tried to run Playwright's runner inside
jsdom, and reported `Test Files 3 failed | 8 passed (11)`. `'e2e/**'` was added to the exclude
list. Without it the plan's own gate — "`npm test` unchanged and still jsdom-only" — could not
hold. Flagged here rather than absorbed silently.

`npm test`, before and after, is unchanged:

| Suite | Before | After |
|---|---|---|
| `cd frontend && npm test` | `Test Files 9 passed (9)` / `Tests 129 passed (129)` | identical |
| root `npm test` (backend + frontend) | `7 passed (7)` / `108 passed (108)` + `9 passed (9)` / `129 passed (129)` | identical |

`npm run build` (which CI runs) is green.

---

## Does anything run this automatically? **No.**

Stated plainly, because a guard nobody runs is a guard in name only.

`grep -nE '^\s+run:' .github/workflows/ci.yml` returns exactly three commands: `npm ci`,
`npm run build`, `npm test`. Root `npm test` is `npm run test --workspaces --if-present`, which
invokes each workspace's `test` script — not `test:e2e`.
`grep -rn 'test:e2e' . --exclude-dir=node_modules --exclude-dir=.git` finds it **declared** in
`frontend/package.json:11` and **invoked nowhere**.

That separation is deliberate per the plan: CI must not silently acquire a browser dependency,
and `npm test` must stay fast and jsdom-only. But the consequence is real and the next phase
should inherit it as a known gap, not as coverage:

**Today this spec only runs when a human runs it.** Wiring it into CI needs a decision this plan
did not have scope to make — a separate job with `npx playwright install --with-deps chromium`,
its runtime cost, and whether it gates merges or only reports.

## Other known gaps

- **`frontend/e2e/` is not typechecked.** `frontend/tsconfig.json`'s `include` is
  `["src", "vite.config.ts", "vitest.config.ts"]`, so `npm run build`'s `tsc --noEmit` never sees
  the spec or the Playwright config. Playwright transpiles without typechecking, so a type error
  in the spec would surface as a runtime failure at best. Adding `"e2e"` and
  `"playwright.config.ts"` to that `include` is the fix; `tsconfig.json` was outside this plan's
  declared files and modifying a second unplanned file to close a non-blocking gap was not worth
  it. Cheap follow-up.

## Finding for the developer: an 8px full-page overhang, inherited from the artifact

Found by this spec on its first run, and the reason a named constant
(`BODY_MARGIN_OVERHANG_PX = 8`) appears in it.

Neither `frontend/src/index.css` nor `legacy/souldbound-world.jsx` declares a `body` rule
(`grep -cE '^\s*(body|#root)\s*\{' frontend/src/index.css` → `0`), so `body` keeps the UA default
`margin: 8px`. Every screen is `height: 100vh` / `minHeight: 100vh` inside that margined body, so
the layout is 8px taller than the document's visible area and **the whole page acquires a
scrollbar**: measured at 1280x800, `body.top = 6`, `body.bottom = 806`, `html.height = 816`. The
action bar's bottom edge sits below the fold.

This is **not a port defect** — legacy has no reset either. The artifact never showed it because
it rendered inside a Claude.ai iframe whose host page reset margins. It is a real, inherited,
one-line fix (`body { margin: 0 }`), but `index.css` is outside this plan's declared files and it
is a visual change to ported output, which this project's constraints reserve for the developer.

The spec therefore asserts pinning against the **layout root's** bottom edge — the honest
geometric claim, and the one with teeth against mutant 2 — and allows the 8px overhang against
the viewport via the named constant, with the reasoning inline. It is not hidden inside a fuzzy
tolerance, and it should drop to `0` the moment a reset lands.

---

## Success criteria

| Criterion | Status |
|---|---|
| Anyone can reproduce Phase 3's visual evidence with one command | Yes — `cd frontend && npm run test:e2e` |
| A future collapsed panel fails a test | Yes — mutants 2, 3 and 4 killed; the CLAUDE.md #3 failure mode caught in the mutant-1 diagnostic |
| Zero API calls | Yes — enforced by a request guard, itself verified by self-test |
| `npm test` unchanged and still jsdom-only | Yes — 129 tests, 9 files, before and after |
