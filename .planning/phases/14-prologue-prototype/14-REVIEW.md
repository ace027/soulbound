# Phase 14: Prologue Prototype — Review Summary

## Result: ESCALATED

> **Resolved after the review (2026-10-16):** F-003, the only open finding, was the unread safety gate. The developer has read all nine cases and passed each one, accepting as is the cases where the narrator's beat-4 cost becomes a standing skill limit. The verdicts are recorded in `14-05-SAFETY-GATE.md`. No blockers remain; Phase 14 waits only on the playtest and the canon decision.

**Cycles Used**: 3
**Reviewers**: testing-qa-verification-specialist, engineering-senior-developer, design-ui-designer, design-ux-architect
**Evaluators**: code-quality, ui-ux, integration, business-logic
**Completed**: 2026-10-16

## Findings Summary
- Must-fix (blocker, critical, major) found: 4; fixed: 3; unresolved: 1
- Suggestions (minor, advisory): 0
- Deferred (confidence 50-79%): 23
- Hot spots (flagged by 2+ reviewers): `backend/src/routes/prologue.ts`, `frontend/src/screens/PrologueScreen.tsx`, `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md`, `.planning/experiments/prologue-playtest/sample-usage.log`

## Findings Detail
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `frontend/src/screens/PrologueScreen.tsx:194` | Several text colours fail WCAG 1.4.3 (4.5:1 for normal text) against the near-black page and panel backgrounds. I estimated the ratios by hand and did not measure them with a tool. - The "Return to title" button uses `#6a5a40` at 11px, roughly 3:1. - The hint text uses `#6a5a40` at 12px, roughly 3:1. - The eyebrow heading text uses `#7a1f1f` at 11px, roughly 1.9:1. | design-ux-architect | 80% | fixed |
| F-002 | major | `.planning/experiments/prologue-playtest/sample-usage.log:1` | The file does not exist on disk, yet it is in the evaluated file list. 14-06-SUMMARY.md says it was delivered. The README (line 69) refers to it. The 14-06 plan's verify commands (`cost-from-log.mjs .../sample-usage.log / grep -q prologueBeat`) cannot succeed. | evaluator:code-quality | 90% | fixed |
| F-003 | major | `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md:6` | F-003 is not resolved. The sheet is still UNREAD, and all 9 cases show "Reader verdict: PENDING (developer)". Line 6 says "No tester may see the prototype until the developer records a verdict for each case." Per the finding, five cases (101, 311, 387, 457, 527) record states_limit=true. The risk that a narrator-invented personal cost becomes a permanent skill limit is deliberately unpatched in backend/src/routes/prologue.ts lines 8-13. I did not re-run the live cases or check prologue.ts. | evaluator:integration, evaluator:business-logic | 95% | open |
| F-004 | major | `frontend/src/screens/PrologueScreen.tsx:235` | The error alert text uses `#c0392b` at 14px on the near-black page background. I computed about 3.5:1 by hand, not with a tool. That is below the 4.5:1 WCAG 1.4.3 minimum for normal text. F-001 fixed the other three colours. The "Return to title" button (`#9a8a6c`), the hint text (`#9a8a6c`) and the eyebrow (`#d9534f`, about 4.8:1) now pass. The error colour was left unchanged. | testing-qa-verification-specialist, design-ux-architect | 80% | fixed |

## Unresolved Findings
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-003 | major | `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md:6` | F-003 is not resolved. The sheet is still UNREAD, and all 9 cases show "Reader verdict: PENDING (developer)". Line 6 says "No tester may see the prototype until the developer records a verdict for each case." Per the finding, five cases (101, 311, 387, 457, 527) record states_limit=true. The risk that a narrator-invented personal cost becomes a permanent skill limit is deliberately unpatched in backend/src/routes/prologue.ts lines 8-13. I did not re-run the live cases or check prologue.ts. | evaluator:integration, evaluator:business-logic | 95% | open |

## Resolved Findings
| ID | Severity | Location | Issue | Reviewers | Confidence | Status |
|----|----------|----------|-------|-----------|------------|--------|
| F-001 | major | `frontend/src/screens/PrologueScreen.tsx:194` | Several text colours fail WCAG 1.4.3 (4.5:1 for normal text) against the near-black page and panel backgrounds. I estimated the ratios by hand and did not measure them with a tool. - The "Return to title" button uses `#6a5a40` at 11px, roughly 3:1. - The hint text uses `#6a5a40` at 12px, roughly 3:1. - The eyebrow heading text uses `#7a1f1f` at 11px, roughly 1.9:1. | design-ux-architect | 80% | fixed |
| F-002 | major | `.planning/experiments/prologue-playtest/sample-usage.log:1` | The file does not exist on disk, yet it is in the evaluated file list. 14-06-SUMMARY.md says it was delivered. The README (line 69) refers to it. The 14-06 plan's verify commands (`cost-from-log.mjs .../sample-usage.log / grep -q prologueBeat`) cannot succeed. | evaluator:code-quality | 90% | fixed |
| F-004 | major | `frontend/src/screens/PrologueScreen.tsx:235` | The error alert text uses `#c0392b` at 14px on the near-black page background. I computed about 3.5:1 by hand, not with a tool. That is below the 4.5:1 WCAG 1.4.3 minimum for normal text. F-001 fixed the other three colours. The "Return to title" button (`#9a8a6c`), the hint text (`#9a8a6c`) and the eyebrow (`#d9534f`, about 4.8:1) now pass. The error colour was left unchanged. | testing-qa-verification-specialist, design-ux-architect | 80% | fixed |

## Recommendation
Fix the unresolved findings by hand, accept the phase as is, or investigate further.

## Reviewer Verdicts
- Cycle 1, testing-qa-verification-specialist: **PASS**
- Cycle 1, engineering-senior-developer: **PASS**
- Cycle 1, design-ui-designer: **NEEDS WORK**
- Cycle 1, design-ux-architect: **NEEDS WORK**
- Cycle 1, evaluator:code-quality: **NEEDS WORK**
- Cycle 1, evaluator:ui-ux: **PASS**
- Cycle 1, evaluator:integration: **NEEDS WORK**
- Cycle 1, evaluator:business-logic: **NEEDS WORK**
- Cycle 2, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 2, engineering-senior-developer: **NEEDS WORK**
- Cycle 2, design-ui-designer: **NEEDS WORK**
- Cycle 2, design-ux-architect: **NEEDS WORK**
- Cycle 2, evaluator:code-quality: **NEEDS WORK**
- Cycle 2, evaluator:integration: **NEEDS WORK**
- Cycle 3, testing-qa-verification-specialist: **NEEDS WORK**
- Cycle 3, engineering-senior-developer: **PASS**
- Cycle 3, design-ui-designer: **NEEDS WORK**
- Cycle 3, design-ux-architect: **NEEDS WORK**
- Cycle 3, evaluator:integration: **NEEDS WORK**

## Suggestions (Not Required)
(none)

## Deferred (Medium Confidence)
- `shared/src/prologue.ts` [minor, 70%]: `PROLOGUE_BEAT_COUNT = 4` is defined, but the same fact is hard-coded in three other places. `.max(8)` and `.length(9)` encode 2n and 2n+1 history entries. `.max(4)` is the beat bound. /home/user/soulbound/backend/src/routes/prologue.ts line 171 also hard-codes `beat === 4`.
- `backend/src/routes/prologue.ts` [advisory, 55%]: The `RequestValidationError` class and `describeIssues` are duplicated from `uniqueSkill.ts` (the file's own comment says "same duck-typed shape"). The lazy-import and try/catch boilerplate is repeated in both handlers.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 70%]: When `prologueProfile` fails, the code sets status back to `idle`. It does not move focus. The "Let it take hold" button is disabled while status is `distilling`, so a keyboard user's focus is lost to `body`. The `act()` path restores focus through `focusRef`, but this path does not.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 75%]: The `copyNote` paragraph ("Scene record copied." / "Could not copy automatically…") is not in a live region. The paragraph is added to the DOM only after the click.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 65%]: The screen has no heading and no landmark. The title "The World Voice Speaks — The Threshold" is a `<p>`, and the outer wrapper is a plain `<div>` rather than `<main>`. I did not check whether App.tsx supplies a `<main>`.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 60%]: Disabling the focused control drops keyboard focus to `<body>`. - The textarea is `disabled` while status is 'reading'. The textarea is the focused element when the player presses Act, or Enter in the field if a key handler is added. - "Let it take hold" is `disabled` while status is 'distilling'.
- `.planning/experiments/prologue-playtest/cost-from-log.mjs` [advisory, 55%]: The script has no test. Its behaviour (the line-range filter, the cache pricing multipliers and the exit codes) is covered only by the plan's manual checks, and the sample log those checks use is missing (Finding 1).
- `backend/src/routes/prologue.ts` [minor, 70%]: `final: beat === 4` and the schema's `.max(4)` are literals. `PROLOGUE_BEAT_COUNT` exists in shared and is used by the request schema and the screen. The `BEATS` tuple type is also fixed at 4.
- `backend/src/routes/prologue.ts, shared/src/prologue.ts` [minor, 60%]: The beat route rejects whitespace-only narration, but the profile route does not. `PrologueProfileSchema` accepts `"   "` for any of the five keys. The profile is returned and passed to `onComplete` untrimmed.
- `.planning/phases/14-prologue-prototype/evidence/safety-gate-results.json, .planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md` [major, 65%]: The safety-gate indicators are known to under-report. `profile_mentions_hostile` reads false in all 9 cases, while the sheet itself says four profiles visibly paraphrase the hostile text. The `states_limit` regex missed 4 cases. Also, 9 cases were run, but the success criterion names seven safety cases from the design doc, and the sheet does not map the nine to those seven.
- `frontend/src/screens/PrologueScreen.tsx` [advisory, 50%]: `buildSceneRecord` is not exported or tested directly. The clipboard-failure fallback depends on `navigator.clipboard` being absent. I could not confirm whether prologueScreen.test.tsx covers a rejected `writeText`.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 55%]: The `role="log" aria-live="polite"` region holds the whole transcript, and a second `aria-live="polite"` paragraph holds the status text. Narration is announced as it is appended, but the status paragraph is conditionally empty and its `minHeight` and margin change with status. Neither region is tied to the textarea that gets disabled while reading.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 65%]: "Copy scene record" is a tester-only control. It sits at the same visual level as "Let it take hold →" in the final player-facing step, with no label saying it is for playtesting. The copy-result note `<p>` has no `role="status"` or `aria-live` attribute.
- `frontend/src/screens/PrologueScreen.tsx` [advisory, 50%]: Inline styles and colour literals are duplicated from QuestionnaireScreen (`#0f0d09`, `#2a2218`, `#c9b48a`, and others). They appear in a third file with no shared tokens. The textarea outline relies on the global `textarea:focus` rule in index.css. The `#6a5a40` hint text on `#0f0d09` and the `#4a3a28` disabled text are low-contrast, likely under 4.5:1.
- `backend/src/routes/prologue.ts` [minor, 55%]: The profile route checks only the opening entry and role alternation of the 9-entry history. Narrator entries 2, 4, 6 and 8 are client-supplied, so any text up to 2000 characters each can be sent. They are passed through `stripDelimiters`, but a forged narrator entry can still inject prose, for example text that tells the profile writer what to say about the soul. The profile output is then fed to the unique-skill pipeline as `answers`.
- `backend/src/routes/prologue.ts` [minor, 55%]: `isTrivialAction` returns true for any trimmed text of 2 characters or fewer. Real actions such as "no", "go" or "up" count as trivial. Two such actions in a row trigger the idle SCENE NOTE, so the narrator is told the player "has not acted for two beats" and the world moves on without them.
- `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md` [minor, 60%]: The per-character cost excludes the intro scene (the sheet says "Intro scene: not measured in this plan"), so the recorded figure of $0.0381 average and $0.0443 for Benign Watcher covers only prologue plus unique-skill. The questionnaire path pays for unique-skill plus intro scene, so the two creation paths cannot be compared like for like.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 60%]: The screen has no heading element. The eyebrow "The World Voice Speaks — The Threshold" is a `<p>`. The root is a plain `<div>` with no `<main>` landmark. Two separate `aria-live="polite"` regions exist: the `role="log"` region, which is implicitly live, and the status `<p>`.
- `.planning/experiments/prologue-playtest/sample-usage.log` [minor, 55%]: The file is fabricated sample data, marked only by the header "# sample, not real usage". It sits in the experiment directory next to real playtest records. It has round numbers and a 15523 cache write on `introScene`, which matches the CLAUDE.md figure, so it is easy to mistake for a measurement.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 50%]: In the `act` error path, `setInput(input)` restores the text from the render-time closure. That is correct unless the user typed more before the failure. The textarea is disabled while `reading`, so this is mostly safe. On failure, `before` is restored with no check that `response.narration` is non-empty. On success, an empty or malformed narration would be appended and counted as a turn.
- `frontend/src/screens/PrologueScreen.tsx` [major, 70%]: The global rule `textarea:focus { outline: none; }` removes the focus ring from the "Your action" textarea. The wrapper div (line 242) has a static `1px solid #2a2218` border and no `:focus-within` style, and I found no other focus indicator. A keyboard user cannot see where focus is when typing the action.
- `frontend/src/screens/PrologueScreen.tsx` [minor, 60%]: The screen has no heading and no `<main>` landmark. A grep for `<h1-6` and `<main` found none. The eyebrow at line 201 is a styled `<p>`. The log is a bare `role="log"` div.
- `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md` [advisory, 55%]: The per-character cost excludes the intro scene (line 730, "not measured in this plan"). Per-character cost in the playtest criterion is therefore recorded only as the creation cost, with no intro-scene figure.

## Fixes Applied
- cycle 1: engineering-frontend-developer on F-001 (partial); engineering-senior-developer on F-002, F-003 (partial); checks 63/91 passed
- cycle 2: engineering-senior-developer on F-003 (blocked); engineering-frontend-developer on F-004 (done); checks 63/91 passed

## Cycle Delta
- cycle 1: 3 out-of-domain finding(s) filtered (design-ui-designer on accessibility, owner design-ux-architect; design-ui-designer on accessibility, owner design-ux-architect; design-ui-designer on accessibility, owner design-ux-architect); see .planning/logs/authority-decisions-2026-10-16.log
- cycle 1: 3 must-fix, 0 suggestions, 17 deferred, 0 dropped (low confidence)
- cycle 2: 1 out-of-domain finding(s) filtered (design-ui-designer on accessibility, owner design-ux-architect); see .planning/logs/authority-decisions-2026-10-16.log
- cycle 2: 2 must-fix (resolved 2, new 1, unchanged 1), 0 suggestions, 3 deferred, 0 dropped (low confidence)
- cycle 3: 1 must-fix (resolved 1, new 0, unchanged 1), 0 suggestions, 3 deferred, 0 dropped (low confidence)

## Coverage
No coverage data found (looked for coverage/coverage-summary.json, coverage-summary.json, coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml, coverage/coverage.xml, coverage.txt, coverage/coverage.txt). Advisory only: run the test suite with coverage to check review.coverage_thresholds.
