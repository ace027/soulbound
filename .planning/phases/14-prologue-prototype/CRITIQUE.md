# Plan Critique -- Phase 14: Prologue Prototype

**Date:** 2026-10-01 · **Reviewers:** QA Verification Specialist (pre-mortem, decision-completeness), Sprint Prioritizer (assumptions, completeness) · both read-only
**Verdict: REWORK.** Rule chain: no schema or wave-overlap BLOCKER (checked by the orchestrator); decision-completeness reviewer found a High gap (undefined wave commit/baseline policy) and verification commands that fail by construction in 14-04 and 14-05; two assumption items rated Critical.

| Metric | Count |
|---|---|
| Pre-mortem failure scenarios | 6 (+1 unscored `.max()` risk) |
| Critical risks (score >= 6) | 4 (scores 9, 6, 6, 6) |
| Assumptions extracted | 12 |
| Critical / Warning / Accepted assumptions | 2 / 5 / 5 |
| Completeness score | 83% (15/18 tasks adequately covered) |
| Decision-completeness gaps | 11 (1 High, 4 Medium, 6 Low or Low-Medium) |

## Required revisions (ordered by priority)

1. **Verification baselines (score 9, assumption A9, High gap).** `git diff --quiet 216f550` over paths earlier waves legitimately edit fails by construction: 14-04 T2/T3 (`frontend/src/screens`), 14-05 frontmatter, checklist and result text (`backend frontend shared docs CLAUDE.md`). Diff only the specific files each plan must not touch (14-02's style); for 14-05 use `backend/src/routes/uniqueSkill.ts backend/src/anthropic.ts docs CLAUDE.md`. Add to CONTEXT and each plan: the orchestrator commits after each wave and "unchanged" checks name exact files. 14-04's `git status --short` check depends on that policy.
2. **Tag-count assertions (score 6).** The prompts already contain literal opening tags (`<player_action>` in NARRATOR_RULES and the profile prompt, `<player_answer>` in the unique-skill prompt). Rewrite 14-02 T3 case 3 and 14-04 T1 cases 1-2 as relative counts: opens = static-preamble count + player entries; closes = player entries; unique-skill opens 6, closes 5.
3. **Gate verifier and cost (score 6, 6).** 14-05: verifier checks `cases.length === 8` and `cost_usd`, reports `ok_cases`, requires `ok_cases >= 7` and accepts recorded `error` entries. Cost: price cache writes at 2x for the 1h-TTL system routes; drop the hard-coded intro-scene $0.141 (measured before effort moved to medium) and unique-skill $0.006 (measured on Sonnet, now Opus) or re-derive them; inherit `process.env` in the spawned server (this sandbox's proxy, CA and base-URL variables are needed), set `ALLOWED_HOSTS=127.0.0.1:3057`, leave `NODE_ENV` unset, state the pacing mechanism (3 s spacing); parse `[anthropic:usage:truncated]` (stderr) too; treat null cache fields as 0; give the case-to-fragment map for `profile_mentions_hostile`; tighten `states_limit` (drop `but`, `only`, `cannot`); add a ninth case (`i wait` / `idk` / `ok` / `i wait`, the trivial path) or state the gap.
4. **Explicit live-spend go-ahead (assumption A11, Critical).** The design doc says get approval before live runs. 14-05 gets a first step: stop and ask the developer for an explicit go-ahead naming the cap ($0.50), BLOCKED without it. Same for a cap-extension rule when a gate fix needs a re-run of the whole set (design doc), with the developer's approval each time.
5. **Per-character cost attribution (score 6, High-Medium gap).** 14-06 `cost-from-log.mjs`: takes `--from-line/--to-line` (or one log per character); README tells the developer to note the log line count before and after each character; the sample log gains an `introScene` line.
6. **Scroll and late failure (score 4).** 14-03: a ref at the end of the transcript with `scrollIntoView` after each appended entry; `overflow-wrap: anywhere` for long unbroken text; Enter does not submit (textarea newline) and focus returns to the textarea after each beat. 14-04: assert the new narration's rect is inside the viewport without a manual scroll; an unbroken 2000-character action causes no horizontal overflow at 390 px; layout checks for the error, reading and copy-fallback states; an integration case where `/api/unique-skill` fails after a successful profile, recorded as a pre-existing App limitation (App.tsx is frozen).
7. **Hosted gating test (score 3).** 14-02: a hosted-mode test using `backend/src/__tests__/helpers/hostedApp.ts` (no session returns 401 `SIGN_IN_REQUIRED` on both paths) and one `npm run test:hosted -w backend` run, or an explicit statement if the database is unavailable. Add one refusal case and one 429 case for the new routes.
8. **Hollow claims in 14-01.** `zodOutputFormat` folds `minLength/maxLength` into the schema `description` (`transform-json-schema.js`), so the bound is advisory to the model and enforced only by the Zod parse after generation: correct the AI-3 claim, assert the transformed shape explicitly, and raise the caps to about 1500 (profile fields) and 3000 (narration) so a 502 is rarer. Add a literal-equality test for `PROLOGUE_OPENING` and name it as the catcher for mutation (a) (the first-word mutation currently stays green).
9. **Smaller fixes.** 14-06: replace the vacuous `grep -q 'Phase 14' STATE.md` with a check for a string 14-06 itself adds. 14-04: remove the "if the App is wrapped" hedge on `/api/access` (AccessGate lives in `main.tsx`); fix the prose "title -> race -> name" to "title -> race+name screen" (race and name share one screen; title button is "✦ Begin Your Chronicle"; the title heading text repeats on the race screen, so locate by role and name carefully); make 14-04's `files_forbidden` and mutation exception consistent. CONTEXT: state that the prompt text is tested but the request shape (JSON wrapper, `max_tokens` 16000, effort) is not until 14-05, and that `?canon=scene` is never gated (label it developer-only, or gate one `scene` run).

## Pre-mortem table (reviewer 1)

| Headline | Plan/Task | L | I | Score |
|---|---|---|---|---|
| Verification commands falsified by the plans' own edits | 14-04 T2/T3; 14-05 | 3 | 3 | 9 |
| Tag-count assertions red on first run | 14-02 T3; 14-04 T1 | 3 | 2 | 6 |
| Paid gate run cannot pass its own check | 14-05 | 2 | 3 | 6 |
| Measured cost per character is wrong | 14-05; 14-06 | 3 | 2 | 6 |
| Unusable on a phone; late failure loses the run | 14-03; 14-04 | 2 | 2 | 4 |
| New routes untested in hosted mode | 14-02 T3 | 1 | 3 | 3 |

## Assumption inventory (reviewer 2)

Critical: A9 (verification commands fail by construction), A11 (live spend approval implied, design doc requires explicit). Warning: A1 (prompt text tested, request shape untested), A3 (`scene` canon never gated), A4 (runner env inheritance), A8 (hosted order unaffected, hosted suite never run), A12 (gate failure has no in-phase remediation). Accepted: A2 (narrator never got name/race: confirmed), A5 (usage-line parsing, with fixes above), A6 (wrapper keeps flag-off unchanged: confirmed), A7 (e2e route mocking: confirmed), A10 (cost about $0.27 per run, 1.8x margin).

## Confirmed correct (no change needed)
`config.test.ts:362-369`, `server.ts:488` and `:512-514`, `App.tsx:209` and `:353`, `shared` consumed via `dist`, vitest without globals, the routes.test harness patterns, `EFFORT`/`WorldVoiceRoute`/`MODELS` shapes, no other test enumerates `MODELS` or `EFFORT`, no test scans the routes directory, hostedOrder tests do not pin `server.ts` text, constraints.test.ts will not trip on the new files, the prompt-fidelity greps match, `xargs test` pipelines exit 0 as written.
