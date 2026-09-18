# 04-04 — Bring the logged decisions back in sync with the code (R15)

**Status: COMPLETE.** Two documents now match the shipped code. Nothing else changed.

Files modified:
- `CLAUDE.md` — auth section only
- `docs/design-decisions-log.md` — one corrected paragraph, one new section, one parenthetical
- `.planning/phases/04-parity-verification/04-04-SUMMARY.md` (this file)

No source file, prompt file, lore text, balance rule, or MUST NOT entry was touched.

---

## The four facts, re-derived at this HEAD (not trusted from the plan)

| # | Plan's claim | Re-derived? | Evidence used |
|---|---|---|---|
| 1 | `CLAUDE.md:49-54` already records the model split — DONE, do not rewrite | **HOLDS** | Read `CLAUDE.md:48-61`. Records both models, the single `MODELS` definition point, the cache-scoping warning, the 15,132 measurement and the reversal warning. Left byte-identical. |
| 2 | `CLAUDE.md:63` still reads "Auth architecture — OPEN DECISION" | **HELD, now fixed** | Read `CLAUDE.md:63-68` before editing; heading was exactly that. Resolution sourced from `docs/MIGRATION-PLAN.md:8-14` ("Decision: backend-held key via `.env`", **Resolved**) and `.planning/STATE.md:254-255` (Console credits; Max-subscription OAuth proxy raised and declined). `grep -n 'OPEN DECISION' CLAUDE.md` → 0 matches after the edit. |
| 3 | `docs/design-decisions-log.md` contains zero "opus"/"sonnet" | **HELD, now fixed** | `Grep -i 'opus\|sonnet'` on the log before editing → **0 matches, 0 files**. After: `Grep -ci 'opus'` → **5**. |
| 4 | The log says only that `determineUniqueSkill` lacks `WORLD_LORE`; the code sends no `system` param at all | **HOLDS** | The stale sentence was at the log's "Prompt Caching — Implemented" section ("**Deliberately left out of lore access:** … was NOT given access to `WORLD_LORE`"). Corrected against `backend/src/routes/uniqueSkill.ts:169` (`useSystem: false`), `backend/src/anthropic.ts:471` (`...(useSystem ? { system: buildSystemBlocks() } : {})`), and `backend/src/__tests__/anthropic.test.ts:286-293` (`expect('system' in request).toBe(false)`). |

### One plan claim that did NOT hold, and was written from evidence instead

The plan (task 1) asks the auth section to "note BYOK remains the documented alternative for
self-hosting deployers." `docs/MIGRATION-PLAN.md:14` says the opposite: paste-per-session,
session-only in-memory BYOK "was the original plan. **Superseded**" — it is a *rejected*
alternative, not a live one. `01-03-PLAN.md:23` restates the rejection.

Written to match the evidence: the section records BYOK as the documented rejected alternative,
and separately notes the sense in which self-hosting deployers do bring their own key (via `.env`,
not via the UI). A reader is not told BYOK is a supported path, because it isn't.

### One path in the briefing that did not resolve

The briefing cites `backend/src/lib/anthropic.ts:471`. There is no `backend/src/lib/` directory;
the file is `backend/src/anthropic.ts` (`Glob backend/src/**/anthropic*.ts` → `backend/src/anthropic.ts`,
`backend/src/__tests__/anthropic.test.ts`). Line 471 is correct in the real file. The log cites the
real path.

---

## What changed

### `CLAUDE.md` — auth section

Heading `## Auth architecture — OPEN DECISION, resolve before scaffolding a backend` →
`## Auth architecture — RESOLVED, do not re-litigate`. Body replaced: backend proxy holding the
deployer's own key from `.env`; key never reaches the browser bundle; Console credits (Max does not
include API access, the OAuth proxy was declined); single-tenant self-hosting shape; paste-per-session
BYOK named as the rejected alternative; pointer to `docs/MIGRATION-PLAN.md`.

Unchanged and verified unchanged: the eight hard constraints
(`grep -cE '^[0-9]+\. \*\*' CLAUDE.md` → **8**, same as `04-CONTEXT.md:23` reports), the
"Model & API pattern" section, the working-style section, and everything else in the file.

### `docs/design-decisions-log.md`

1. **Corrected** the "Deliberately left out of lore access" paragraph in "Prompt Caching —
   Implemented" to the stronger property the code preserves: the call sends no `system` parameter at
   all. Written as an explicit correction of the old wording, with the three file:line citations
   above, so a reader who remembers the old claim sees it superseded rather than merely supplemented.
2. **Added** a new section, "Model Split — Sonnet 5 for soul-reading, Opus 5 for the world,"
   between "Prompt Caching — Implemented" and "Questionnaire Design". It records: the reversal of
   the all-Sonnet decision and that the developer chose it after the reversal was flagged; that
   intro-scene joined Opus 5 to share the world-engine's cache namespace rather than strand a write
   in the Sonnet namespace; the measured 15,132 `cache_read_input_tokens` on both the second
   world-engine call and the cross-route intro-scene call; that 15,132 is **stale** because two lines
   were later added to `WORLD_SYSTEM_PROMPT` inside the cached prefix, that re-deriving it is free via
   `count_tokens` and re-proving cache engagement is not; and that `determineUniqueSkill` stays on
   Sonnet 5 because it is the adversarially-validated surface and has no cache to share.
3. **One parenthetical** appended to the pre-existing "Verification note" in the caching section, so
   a reader isn't left believing cache behavior is still unconfirmed one paragraph before the section
   that confirms it.

Derivations for the numbers used:
- **15,132** — `.planning/phases/02-backend-world-voice/evidence/README.md:20-22` (raw usage table:
  write on world-engine #1, read on world-engine #2, read on intro-scene), cross-checked free at
  `evidence/README.md:29-33` (`count_tokens`: 13,310 system-only + 1,827 schema = 15,137, less the
  5-token probe message).
- **"two lines added to `WORLD_SYSTEM_PROMPT`"** — `.planning/STATE.md:218` and `:220`; confirmed
  independently by 04-01's audit (`04-01-CONSTRAINT-AUDIT.md:403`: "Three added lines, one of which
  is blank → two substantive additions, zero removals"). One of the two is visible at
  `backend/src/data/worldSystemPrompt.ts:108`. Note `04-01-CONSTRAINT-AUDIT.md:568` (observation O-2):
  the figure is **scope-dependent** — 2 at whole-`WORLD_SYSTEM_PROMPT` scope, 1 at MUST-NOT-list
  scope. The log entry uses it at whole-prompt scope, which is the scope the cached prefix has.

---

## Verification gate

| Check | Result |
|---|---|
| `grep -n 'OPEN DECISION' CLAUDE.md` | 0 matches |
| `grep -ci 'opus' docs/design-decisions-log.md` | **5** (was 0) |
| `determineUniqueSkill` correction cites the route by line | `backend/src/routes/uniqueSkill.ts:169`, present in the log (1 match) |
| Lore / balance / MUST NOT changed | **No.** No file under `backend/src/data/` or any prompt file was opened for write. |
| `04-04-SUMMARY.md` written | This file |
| Eight hard constraints intact | `grep -cE '^[0-9]+\. \*\*' CLAUDE.md` → 8 |

**Not claimed:** `git diff --stat`. This agent had no shell. The orchestrator runs the git
verification.

---

## Found stale — FLAGGED, deliberately NOT fixed

1. **`CLAUDE.md:40` (hard constraint 5) — `max_tokens` prose history is stale.** It says "raised
   from an original 1000" with a floor of ≥ 2000; the code has been at `MAX_TOKENS = 16000` since
   Phase 2 (`backend/src/anthropic.ts:112`, applied at `:460`). The constraint still **PASSES** —
   16000 ≥ 2000, it is a floor — but the history reads as though 2000 were current. **Not edited: the
   text sits inside a hard constraint.** Developer decision. (Same as 04-01 observation O-3.)

2. **`CLAUDE.md:9` calls `docs/MIGRATION-PLAN.md` "the plan and open decisions".** The auth decision
   it referred to is closed, and `MIGRATION-PLAN.md:87` itself strikes it through. Outside the auth
   section, so not edited.

3. **`docs/design-decisions-log.md:3` names `soulbound-world.jsx` as "the source of truth for current
   behavior".** The backend is now the source of truth; the legacy artifact's fate is plan 04-06's
   decision. Not edited — it would pre-empt 04-06.

4. **The log's whole frame is still artifact-era** — "inside a single React artifact, calling the
   Anthropic API directly from the browser" (line 6), "Architecture Constraints Discovered"
   (lines 117-119) describing artifact-injected auth, "Current phase: solo artifact experience"
   (line 122). None of this is wrong as *history*, but it is written in the present tense. Rewriting
   it is a reorganisation, which this plan's scope excludes.

5. **`04-01-CONSTRAINT-AUDIT.md:568` (O-2), carried forward:** "two additions" to
   `WORLD_SYSTEM_PROMPT` is scope-dependent (2 whole-prompt, 1 MUST-NOT-list). Any future doc
   quoting it should state the scope. The new log entry does.
