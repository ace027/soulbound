# Phase 14: Prologue Prototype -- Context

**Runs before Phase 7** (developer decision 2026-10-01); numbered 14 so Phases 7-13 keep their numbers.
**Spec source:** `.planning/explorations/2026-10-01-prologue-prototype-design.md` (the design doc is the spec; no separate spec file). **Evidence:** `.planning/experiments/2026-10-01-prologue-test/` (`run-v2-1.mjs` holds the tested narrator and profile prompts; results in its README).
**Base commit for byte-identity checks:** `216f550` (HEAD of `dev` when this phase was planned).

## Phase Goal
An opt-in, behaviour-based way to create a character: a fixed four-beat threshold scene, narrated reactively, is distilled into the five `answers` keys and fed to the existing, unchanged unique-skill pipeline. The questionnaire stays the default.

## Requirements Covered
- **R36** -- Prologue prototype: opt-in (`?prologue=1`) behaviour-based character creation; a fixed four-beat scene narrated reactively by a new system-free route, distilled into the five `answers` keys; existing unique-skill, intro-scene and world-engine paths unchanged; safety gate of seven live cases before any tester sees it; runs before Phase 7.

## What Already Exists (verified 2026-10-01 against the tree)
- `backend/src/anthropic.ts`: `callWorldVoice({route, model, content, useSystem, schema})`; `WorldVoiceRoute = 'uniqueSkill' | 'worldEngine' | 'introScene'`; `EFFORT: Record<WorldVoiceRoute, ...>`; refusals are named (commit `ad25b50`); world engine and intro scene run `medium` (`216f550`).
- `backend/src/config.ts` `MODELS` has three keys (`uniqueSkill`, `worldEngine`, `introScene`); `backend/src/__tests__/config.test.ts:362-369` pins it with `toEqual`.
- `backend/src/routes/uniqueSkill.ts`: `UniqueSkillRequestSchema` (five answer keys, each `.max(4000)`), `renderUniqueSkillPrompt`; system-blind (`useSystem: false`). `backend/src/routes/{worldEngine,introScene}.ts` are the other two routes; all mount in `server.ts:512-514` after the `/api` JSON parser (`server.ts:488`), behind both modes' gates.
- `backend/src/untrustedText.ts`: `UNTRUSTED_TAGS = ['player_name','player_answer','player_action']`, `stripDelimiters`, `wrapUntrusted`.
- `shared/src/{worldVoice,gameState,accessGate,index}.ts`; `index.ts` re-exports with `.js` suffixes. **Backend and frontend consume `shared` through `dist/`**, so `npm run build -w shared` must run after any change there before backend/frontend tests.
- `frontend/src/lib/api.ts`: private `postJson(path, body, schema)` with the five-gate error handling and `ApiClientError`; `determineUniqueSkill` etc. `frontend/src/screens/QuestionnaireScreen.tsx` (review step added 2026-10-01). `App.tsx:209` `handleQuestionnaireComplete(finalAnswers)` uses only its argument; `App.tsx:353` mounts `QuestionnaireScreen` with `qIndex, setQIndex, answers, setAnswers, onComplete, onReturnToTitle` -- **no name or race**.
- Tests: backend `vitest run` (`npm test -w backend`, 306 at planning); frontend vitest with **no `globals`** (explicit `afterEach(cleanup)`), 263 at planning; Playwright e2e in `frontend/e2e/` (`/api/access` answered with 204, every other `/api/*` request must be mocked or fail).

## Key Design Decisions
1. **Approach B** (chosen by the developer in the design doc): reactive scene + distil into answers + existing pipeline. Architecture proposals and the spec pipeline were skipped: the design doc is the spec and the approach is already chosen.
2. **No name or race in the prologue routes** (deviation from the design doc's "takes name, race name", confirmed at the plan gate). The tested narrator says the soul "has no powers, name or body"; `QuestionnaireScreen` is not handed name/race, so passing them would force an `App.tsx` change needing the developer's consent. The existing unique-skill call still receives the name and race from `App.tsx`.
3. **`traits` is the default canon** (design doc: evidence supports it for session 1; the doc's own default was `scene`). Selectable with `?canon=scene` for comparison. The developer's final canon decision happens after the playtest.
4. **Prompts are the tested v2.1 prompts, ported verbatim.** The doc's open risk (a narrator-invented personal cost becoming a permanent skill limit) is **not** addressed by editing the prompt, because an untested prompt change would invalidate the paper-test evidence; the safety gate (14-05) reads the costs for severity instead, and any steering sentence is a follow-up change after that reading.
5. **Stateless routes; the client holds the history.** The fixed opening text lives in `shared` and the server rejects a history whose first entry differs from it; narrator entries are client-held, so the server treats them as untrusted (`stripDelimiters`, length-capped).
6. **Trivial-action detection runs in code**, in the beat route (design doc: "production should detect trivial actions in code"), using the regex from `run-v2-1.mjs`.
7. **Flag helper only; no stored state, no UI.** `QuestionnaireScreen` becomes a thin wrapper: flag on renders `PrologueScreen`, flag off renders the existing form component unchanged. `App.tsx` stays byte-identical to `216f550`.
8. **Serial waves** (retro: serial tree-mutating agents with independent per-wave verification). 14-02 and 14-03 are file-disjoint and could run in parallel if the developer wants speed.
9. **The three playtest sessions and the canon decision are developer-run** and are not tasks. 14-06 produces the kit; ROADMAP criteria 5 and 6 close after the sessions.

10. **Wave commit and baseline policy (critique fix).** The orchestrator commits to `dev` after each wave passes its verification. "Unchanged" checks therefore name the exact files a plan must not touch and diff them against `HEAD` (or against `216f550` only for files NO Phase 14 plan edits). No plan uses a directory-wide `git diff 216f550`, because earlier waves legitimately change those directories.
11. **Evidence caveats (critique).** The paper-test evidence covers the prompt TEXT. The production request shape differs from the experiment (JSON wrapper via `output_config.format`, `max_tokens` 16000, effort set per route), and that shape is first exercised by 14-05. `?canon=scene` is developer-only and is not part of the safety gate; if the developer wants `scene` compared, 14-05's runner takes `--canon scene` and the developer approves that extra spend separately.
12. **Structured-output bounds are advisory.** The SDK's schema transform folds `minLength`/`maxLength` into the schema `description`; the bound is enforced only by the Zod parse after generation (a 502 `INVALID_RESPONSE_SHAPE` if exceeded). So the caps are set generously (narration 2000, equal to the history entry cap because the client echoes narration back, profile fields 1500) and the tests assert the transformed shape rather than assuming server-side enforcement.
13. **Known App limitation, not fixed here.** If `/api/unique-skill` fails after a successful profile, `App.tsx` leaves the player on the loading screen with the error and the prologue transcript is gone (the same as a questionnaire failure today). `App.tsx` is frozen for this phase; 14-04 records the behaviour in a test and the summary.

## Consent recorded / constraints in force
- Developer consented (2026-10-01) to adding `prologueBeat` and `prologueProfile` to `MODELS` and `EFFORT` and to editing the one `config.test.ts` expectation (`config.test.ts:362-369`) -- add the two keys only, never loosen.
- Pre-Phase-6 tests are otherwise **not edited**. New behaviour gets new test files (`prologue*.test.ts[x]`); `routes.test.ts`, `anthropic.test.ts`, `api.test.ts`, `creationScreens.test.tsx` and `questionnaireReview.test.tsx` stay byte-identical.
- `server.ts` changes by exactly one import and one `app.use(prologueRouter)` line (shared by both modes; no step of the 15-step hosted order moves).
- CLAUDE.md #1-#8 all hold: no native dialogs (`constraints.test.ts` scans); scroll regions follow #3; World Voice field names and `CONTRACT_FIELD_NAMES` untouched (#4); `max_tokens` stays 16000 via `callWorldVoice` (#5); the MUST NOT list untouched (#6); `WORLD_LORE`/`WORLD_SYSTEM_PROMPT` untouched (#7); `/api/unique-skill` untouched and still system-blind (#8).
- The prologue routes send **no `system` key**, so "only world-engine and intro-scene send system blocks" stays true and the shared cache namespace is unaffected.
- Real API spend happens only in 14-05 (cap $0.50), and only after an explicit developer go-ahead recorded in that plan's first step (the design doc requires approval before live runs; running the plan is not approval).

## Retro action items applied
- AI-1 (a handoff gets a spanning test): 14-04 holds the profile -> unique-skill handoff test and the flag-on App integration test.
- AI-2 (report visual defects, including pre-existing ones): 14-03 and 14-04 must list any visual defect seen, even if not caused by this phase.
- AI-3 (library claims stay unverified until checked in installed source): 14-01 reads the SDK's schema transform and asserts the transformed shape; the `.max()` bounds are advisory to the model (decision 12), not server-enforced.
- AI-5 (mutation harness with an unmutated baseline): 14-02 and 14-03 run mutation checks with `cp` + hash restore and a green baseline first.
- AI-6 (new UI ships with a placement e2e): 14-04.

## Plan Structure
- **Plan 14-01 (Wave 1)**: Prologue contract and config keys -- shared schemas + opening text, `MODELS`/`EFFORT`/route union keys, pin edit.
- **Plan 14-02 (Wave 2)**: Prologue routes -- `routes/prologue.ts` (beat + profile), mount, route tests, mutations.
- **Plan 14-03 (Wave 3)**: Flag, API client, PrologueScreen -- `prologueFlag.ts`, two `api.ts` functions, `PrologueScreen.tsx`, flagged wrapper in `QuestionnaireScreen.tsx`.
- **Plan 14-04 (Wave 4)**: Spanning tests and placement e2e -- backend handoff test, frontend integration test, Playwright layout spec.
- **Plan 14-05 (Wave 5)**: Live safety gate and cost measurement -- seven cases against the real server, cost log, evidence for the developer to read.
- **Plan 14-06 (Wave 6)**: Records and playtest kit -- design-log entry, CLAUDE.md additions, playtest kit, PROJECT/ROADMAP/STATE.
