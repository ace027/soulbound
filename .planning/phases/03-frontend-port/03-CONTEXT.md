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

**Every number below was derived programmatically, not asserted.** A first draft of this document
carried four factual errors that plan critique caught — including a `17 useState` count that would
have made a *correct* port fail its own verify gate. Rule for this phase: **derive the count or the
range, report both the derivation and the value; never restate a number from prose.**

### Exact port ranges (derived by locating each declaration and its closing brace)

| Target | Range | Notes |
|---|---|---|
| `SkillCard` | **534-565** | |
| `SoulCodexContents` | **568-654** | |
| `WorldLog` | **657-741** | |
| `ActionBar` | **744-783** | |
| `App()` | **786-1440** | **16 `useState` (787-802) + 1 `useRef` (803)** — not 17 |
| title screen | from **1046** | |
| race screen | from **1186** | |
| questionnaire screen | from **1257** | |
| loading screen | from **1335** | |
| simulation screen | from **1346** | |
| pure turn logic | **925-1021** | ends *after* `newLogEntry` (1014-1021), not at 1008 |

`setGameState` is at 1010, `newLogEntry` at 1014, the `setLog`+`autoSave` closure at 1022.

### Constants that already exist in `shared/src/gameState.ts` — import, never redeclare
- `SAVE_INDEX_KEY`, `SAVE_PREFIX`, `MAX_LOG_SAVED` (80), `SAVE_SCHEMA_VERSION` (1) — lines 136-141
- **`MAX_NARRATIVE_NOTES` (40)** — line 99
- **`TIER_STYLE`** — line 168, already commented "copied verbatim from legacy lines 525-531"

There is **no** `frontend/src/game/tierStyle.ts` in this phase. Creating one would manufacture the
exact drift this document prevents for the save keys. Phase-level check:
`grep -rn 'TIER_STYLE *[:=]' shared/src frontend/src` must show exactly **one** definition.

### `shared/src/gameState.ts` must be extended — plan 03-06 owns it
`LogEntry` (lines 121-127) has `type`, `text`, `newSkills?: unknown[]`, `soulRewrites?`,
`subAbilityUnlock?`, `gmNote?`. But `WorldLog` renders **`entry.etchingSkill.skill_name`** — the
skill-etching reveal, the game's most distinctive moment — and reads `ns.soul_etching_text`,
`ns.skill_name`, `ns.tier`, `ns.mastery`, `ns.description` off `newSkills`.

Two collisions under `strict: true`: `etchingSkill` does not exist, and `unknown[]` cannot be
dereferenced. Without an owner, an agent reaches for `as any` or silently drops the etching block and
no test notices. **Plan 03-06 lists `shared/src/gameState.ts` in `files_modified`** and must run
`npm run build -w @soulbound/shared` before the frontend typechecks (`@soulbound/shared` resolves
via `dist/`).

### The 25/60/100 thresholds are model-side, not client-side
They live in `WORLD_SYSTEM_PROMPT` (lines 40, 55, 93, 139). The client only *applies*
`unique_sub_ability_unlocked`. **Do not write a frontend test asserting the thresholds, and do not
add a client-side guard rejecting an unlock outside them** — that would duplicate the prompt's source
of truth and silently swallow legitimate unlocks when a mastery jump overshoots.

### Legacy violates CLAUDE.md #3 twice on one scroll chain
1. `WorldLog`'s root (line 658) is `{ flex: 1, overflow: "auto", padding: ... }` — **no `minHeight: 0`**.
2. Line 1386 is `<div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>`
   — also missing `minHeight: 0` — whose child is a **Fragment `<>`** (1388) wrapping `WorldLog` +
   `ActionBar`.

**The replacement div must carry `{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }`.**
Note the `flex: 1` — the parent at 1386 has it, and a replacement that omits it shrink-wraps, leaving
`WorldLog`'s `flex: 1` no height to fill and collapsing the mobile World tab. **jsdom performs no
layout**, so every test in this phase would pass on a visually broken page. This is why plan 03-08
requires screenshots.

The Fragments at 1102 and 1125 are button groups in the confirm-delete row, **not** flex containers.
Leave them.

### All six `<style>` blocks are in screens — none in components
Derived line numbers: **1051, 1189, 1263, 1338, 1354, 1410**. Plans 03-07 and 03-08 own all six.
A `<style>` grep scoped to `components/` cannot fail and is not a check. The phase-level assertion is
`grep -rn '<style' frontend/src/` must be **0**.

### Other verified inputs
- **`frontend/package.json` has no test runner** — hence wave 0.
- **`autoSave` runs inside a `setLog` updater** (1022-1027), reading `newState` and `currentSlotId`
  from closure. A pure-reducer test is blind to a stale-closure or dropped-autosave regression.
- **The 80-entry cap is in `autoSave` (line 820), NOT in `writeSave`** (23-42, which has zero slices).
  `autoSave` is `App.tsx` territory, so the cap belongs to the App wiring plan, not the saves plan.
- **`RACES` has 9 entries and `QUESTIONS` 5** — derived from the ported `frontend/src/data/` files.
- **jsdom does not implement `Element.prototype.scrollIntoView`.** Legacy 812 calls it in an effect
  keyed on `[log]`, with the ref at 738 inside `WorldLog`. Once simulation renders the ref is
  non-null, so the optional chain does not save you — it throws on mount and on every log change.
  Wave 0 must stub it.

### How to diff inline styles — specified, because "programmatically" is not a method
There are **148** `style={{ ... }}` objects: 118 purely static, 21 spanning multiple lines, 18
containing conditionals or template interpolation (`isMobile ? "16px" : "20px"`,
`` `1px solid ${ts.color}44` ``). A regex cannot extract these — `[^}]*` truncates at the first
nested brace, silently. The method is:

1. `sed -n 'START,ENDp' legacy/souldbound-world.jsx > /tmp/before.jsx` using the **derived** range.
2. Strip CRLF and leading whitespace from both sides.
3. `diff` against the ported JSX body stripped the same way.
4. **Enumerate the expected deltas up front** (`.tsx` typing, `minHeight: 0`, dropped `<style>`,
   import changes) and paste the raw diff showing only those.

If the diff is unusably noisy, say so and fall back to "read line by line, deltas enumerated" — but
do not report "verified by diff" without a diff.

## Client bound the backend enforces — knowingly shipped
`actionHistory` grows unbounded client-side (legacy 999) and ships in full on every
`/api/world-engine` call. Phase 2's backend caps it at `max(2000)` entries and a 512kb body. A long
by-feel playthrough will eventually trip this and surface as
`"The World Voice fell silent. INVALID_REQUEST..."` on a save the player cannot recover.

**Decision: Phase 3 ships the legacy behaviour unchanged and records the trip point here.** Capping
it is a deliberate gameplay change (it changes what the World Voice sees) and belongs to a phase that
can weigh it, not to a port. Phase 4 should decide.

## Production `runtime` image — decision recorded, not deferred a third time
Phase 1 found that the `runtime` frontend image answers `/api/*` with 200 + `index.html`, "dormant
only because the frontend makes no API calls yet." **Phase 3 is what ends that dormancy.** A 200
passes `response.ok`, so R12's fix does not catch it; the Zod parse throws and the operator sees a
healthy container.

**Decision: the `runtime` image remains non-deployable for this milestone**, and plan 03-03 adds a
`content-type` check so the failure is diagnosable rather than a schema-shaped mystery. Closing it
properly (reverse proxy or configurable API base URL) is a Phase 4 criterion.

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
