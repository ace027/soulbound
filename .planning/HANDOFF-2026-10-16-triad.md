# Handoff: clean up Legion, move to Triad (2026-10-16)

Start the new session on **Opus** (Triad's orchestrator is the main loop). Paste this as the opening message, or point the new session at this file.

## Goal

Replace the Legion tooling with the Triad plugin. The developer chose **tooling only**:
- Uninstall Legion's commands, skills and agents.
- **Keep `.planning/` as is.** CLAUDE.md and `docs/` cite evidence files inside it, and Triad reads Legion's `.planning/` layout without migration.

## What Triad is

Triad is the developer's own plugin (`ace027/Multi-model-orchestrator`, plugin `triad`, v1.0.0). It ports the Legion workflow onto three model tiers: Opus orchestrates, Sonnet codes and Haiku does menial work. It provides 21 `/triad:*` commands that mirror Legion's (`plan`, `build`, `review`, `ship`, `quick`, `status`, `validate`, and the rest), plus `/triad` for the cost tree.

Per its README, Triad reads and writes `.planning/` unchanged: PROJECT/ROADMAP/STATE, `phases/NN-slug/` CONTEXT/PLAN/SUMMARY/REVIEW/CRITIQUE, `memory/`, `config/directory-mappings.yaml` and `explorations/`. Existing projects keep their `commit_prefix`. Its `PARITY.md` maps every Legion feature to its Triad equivalent.

## Done so far (old session, container is ephemeral; none of this carries over)

- `claude plugin marketplace add ace027/Multi-model-orchestrator` succeeded.
- `claude plugin install triad@multi-model-orchestrator` succeeded (user scope). It reported 18 userConfig options unset; the defaults are fine.
- Nothing was uninstalled, and no repo files were changed apart from this one.

## Steps for the new session

1. **Make Triad persist across cloud sessions.** A user-scope install is lost when the container is reclaimed. Choose one of the following (ask the developer which):
   - Add the marketplace and plugin to the project's `.claude/settings.json` (`extraKnownMarketplaces` plus `enabledPlugins: {"triad@multi-model-orchestrator": true}`), or
   - Add the two `claude plugin` commands to the environment's setup script.
2. **Find where Legion comes from.** It was installed globally on 2026-09-26 from the npm package `@9thlevelsoftware/legion` 8.0.6 (manifest at `~/.claude/legion/manifest.json`). If the environment setup script installs it, remove it there. Otherwise every new container brings it back.
3. **Remove the Legion tooling** in the container. Read `~/.claude/legion/manifest.json` first and remove only what it lists:
   - `~/.claude/commands/legion/`
   - `~/.claude/legion/` (skills, adapters, manifest)
   - the 49 agent files in `~/.claude/agents/` that the manifest names. Check for any not in the manifest before deleting.
   - Leave `~/.claude/legion/portfolio.md` if it exists; Triad reuses it.
4. **Project settings.** `.claude/settings.json` currently pins `"model": "claude-sonnet-5-5"` and `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5-5`. Triad wants the main session on Opus and sets the subagent models itself through its hooks. Propose removing both keys to the developer (or setting the model to Opus); don't change them silently.
5. **Verify:** run `/triad status` and `/triad validate` on this repo. Both are model-free and should read Phase 14 state from `.planning/` as is. Fix or report any schema complaints.
6. **References (optional, ask first).** Live `/legion:` command mentions remain in `.planning/STATE.md`, `ROADMAP.md` and `PROJECT.md` (the "next action" lines). Updating those to `/triad:` is fine. Leave historical phase files, explorations, specs and memory untouched; they are a record.
7. Add a short entry to `docs/design-decisions-log.md` covering the tooling move (Legion → Triad, `.planning/` kept, why). Add one line to `.planning/memory/OUTCOMES.md` if Triad's `learn` doesn't do it.
8. Commit and push.

## Project state carried over (unchanged by this move)

- **Phase 14 (Prologue Prototype)** is built and passed review in 2 cycles (`e817431`), but it is **not closed**. These items are the developer's:
  - read `.planning/phases/14-prologue-prototype/14-05-SAFETY-GATE.md` and record verdicts (the skills in it predate the "limit as scope, not penalty" wording, so they are stale on that point);
  - run 3 playtests (`.planning/experiments/prologue-playtest/README.md`);
  - decide the canon and whether the prologue replaces the questionnaire.
- The next workflow step is planning **Phase 7** (`/triad:plan 7`). The carried login-CSRF item must be closed first.
- Known stale notes: the old Progress block in STATE.md; `deanitservices` references in old `.planning` docs; the Phase 6 hosted runbook is untested; key rotation is deferred to Phase 9.
- Git: work has been pushed to `dev`; the working tree was clean at `e817431`.
