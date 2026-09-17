# Phase 3: Frontend Port — Context

**Goal**: The game is playable. UI ported from `legacy/souldbound-world.jsx` with behavior intact,
wired to the backend rather than to Anthropic directly.

**Requirements**: R9 (components + five screens), R10 (game logic intact), R11 (localStorage saves),
R12 (three research bugs)

## Architecture: Pragmatic (selected 2026-09-17 from three competing proposals)

Three read-only proposals were generated (Minimal / Clean / Pragmatic). All three agreed on the
core; they differed only on how far to decompose `App.tsx`.

**Selected: Pragmatic.** Split the five screens into `screens/*.tsx` — they are self-contained JSX
and the split is free. **Do NOT restructure the state graph.** `App.tsx` keeps all 17 `useState`,
both effects, and the `autoSave`-inside-`setLog` closure exactly as legacy has them.

Rejected and why:
- **Minimal** (one ~700-line `App.tsx`) — its own author called the result "unreviewable by diff,
  every line reads as added, and the tests cover none of it."
- **Clean** (`useGameSession` hook owning the 17 states) — rewrites the state graph, which is the
  single most behavior-load-bearing and least-tested part of the port.

**The one deviation from verbatim** is extracting the pure turn-application logic to
`game/applyWorldUpdate.ts`. Everything else ports statement-for-statement, inline styles included.

## Verified facts this phase is planned against

Each was confirmed by reading the code, not assumed:

- **`shared/src/gameState.ts` already exports** `SAVE_INDEX_KEY`, `SAVE_PREFIX`, `MAX_LOG_SAVED = 80`
  and `SAVE_SCHEMA_VERSION = 1` (lines 136-141). `lib/saves.ts` **imports** these. Redeclaring them
  creates a second source of truth for the save keys — the exact drift class this project keeps
  getting bitten by.
- **The 25/60/100 sub-ability thresholds are model-side, not client-side.** They live in
  `WORLD_SYSTEM_PROMPT` (lines 40, 55, 93, 139). The client only *applies*
  `unique_sub_ability_unlocked` when the API returns it. **Do not write a frontend test asserting
  the thresholds, and do not add a client-side guard that rejects an unlock outside them** — that
  would duplicate the prompt's source of truth and silently swallow legitimate unlocks when a
  mastery jump overshoots.
- **Legacy violates CLAUDE.md #3 in two places on the same scroll chain**, and a literal verbatim
  port would carry both forward:
  1. `WorldLog` root (line 659) is `{ flex: 1, overflow: "auto" }` with **no `minHeight: 0`**.
  2. Line 1388: a `<div style={{flex:1, overflow:"hidden", display:"flex", flexDirection:"column"}}>`
     — also missing `minHeight: 0` — whose child is a **Fragment `<>`** wrapping `WorldLog` +
     `ActionBar`. CLAUDE.md #3 forbids a Fragment as a flex/scroll container.
  Both are fixed during the port. The Fragments at lines 1102 and 1125 are button groups in the
  confirm-delete row, **not** flex containers — leave those alone.
- **`frontend/package.json` has no test script and no vitest.** Wave 0 exists because of this.
- **`autoSave` runs inside a `setLog` updater** (lines 1022-1027), reading `newState` and
  `currentSlotId` from closure. A pure-reducer test is blind to a stale-closure or dropped-autosave
  regression. That is why the Wave 4 integration test is not optional.
- **The Google Fonts bug (R12) is already closed** — Phase 1 put the `<link>` in `frontend/index.html`
  and extracted all 7 keyframes to `index.css`. The Phase 3 job is a *don't*: do not re-introduce the
  six `<style>` blocks (lines 1051, 1338, 1354, 1410, …) when porting screens.

## Behavior tuned by feel — port exactly, do not tidy

- Evolutions are applied **after** new skills are pushed onto the same array, so a skill granted
  this turn can be evolved this turn.
- The sub-ability lookup `find(s => s.tier === "Unique")` runs **after** a Soul Rewrite may have
  renamed that skill.
- `setNewSkillIds` receives only newly-granted names — **not** changed/evolved ones.
- The two `newSkillIds` clear timeouts genuinely differ: **2000 ms** after the questionnaire
  (line 905), **2500 ms** after an action (line 1012). Do not unify them.
- Soul Rewrite fires only when `old_tier === "Unique" && new_tier === "Unique"` (line 956).
- `usage_notes` accumulate on the **Unique skill only** (lines 934-936).
- Narrative notes cap is an inline `.slice(-40)` (line 994) — a magic number, not a named constant.

## Retro action items applied
- **AI-4 (write tests alongside build)** — every plan that ships code ships its own tests. There is
  no separate test plan and nothing is deferred to review. Phase 2's 2:1 test:source ratio arrived
  almost entirely during review cycles; this phase front-loads it.
- **AI-3 (mutation testing as acceptance)** — a test is only accepted once it has been shown to fail
  against the code it protects. Phase 2 shipped a suite that passed with its HTTP routes unregistered.
- **AI-1/AI-2 (fix-induced defects)** — the review for this phase should budget a cycle for probing
  the fixes, not only the original port.
- **AI-5 (plan critique before Phase 3)** — outstanding from Phase 1, run after plan generation.

## Plan structure

| Plan | Wave | Deliverable | Agent | Model |
|---|---|---|---|---|
| 03-01 | 0 | Frontend test harness (vitest + jsdom + RTL) | Frontend Developer | Sonnet 5 |
| 03-02 | 1 | `lib/saves.ts` + tests (R11) | Frontend Developer | Sonnet 5 |
| 03-03 | 1 | `lib/api.ts` + tests (R9, R12) | Frontend Developer | Sonnet 5 |
| 03-04 | 1 | `game/applyWorldUpdate.ts` + mutation-verified tests (R10) | orchestrator | Opus 5 |
| 03-05 | 1 | `game/tierStyle.ts` + `hooks/useIsMobile.ts` + tests (R12) | Frontend Developer | Sonnet 5 |
| 03-06 | 2 | Four presentational components (R9) | Frontend Developer | Sonnet 5 |
| 03-07 | 3 | Title / Race / Questionnaire screens (R9) | Frontend Developer | Sonnet 5 |
| 03-08 | 3 | Loading / Simulation screens + layout fixes (R9, CLAUDE.md #3) | UX Architect | Sonnet 5 |
| 03-09 | 4 | `App.tsx` wiring + integration test | orchestrator | Opus 5 |

Waves 1 and 3 are file-disjoint and run in parallel. Wave 0 blocks everything: without a test
runner, "tests alongside build" is not possible.

Model assignment follows PROJECT.md's cost profile: Opus 5 for the game-logic port and the
`App.tsx` wiring (where a silent regression is costlier than the token spend), Sonnet 5 for UI
extraction.

## Planning gates
- Architecture proposals: **run** (3 proposals, Pragmatic selected) — a change from Phases 1-2,
  which skipped them.
- Spec pipeline: skipped — the committed exploration doc serves as the spec.
- Plan critique: **to run** after generation (Phase 1 retro AI-2/AI-5, outstanding twice).
- Codebase map: still absent; `/legion:map` remains queued for after the migration lands.
