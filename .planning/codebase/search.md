# Codebase search protocol

How Legion commands should query this dataset. Written for consumers
(`/legion:plan`, `/legion:build`, `/legion:map --query`), not for humans browsing.

## Artifacts

| File | Shape | Use |
|---|---|---|
| `index.jsonl` | one JSON object per module | path, line range, kind, domain, exports, imports, summary |
| `symbols.json` | `{ symbol: [paths] }` | find the file that defines or re-exports a name |
| `../CODEBASE.md` | prose | architecture, risks, conventions, runbook |
| `../config/directory-mappings.yaml` | YAML | directory → domain → preferred agent |

## Protocol

1. **Normalize the query** into keywords, path hints, symbol hints, domain hints.
2. **Symbol hint present** (`applyWorldUpdate`, `WORLD_LORE`, `SAVE_PREFIX`) → look it up in
   `symbols.json` first. It is exact and cheap.
3. **Domain or path hint** (`backend`, `saves`, `screens`) → filter `index.jsonl` on `domain` or
   `path`, then rank by keyword overlap against `summary` and `exports`.
4. **Neither** → grep `index.jsonl` for the keywords across `summary` and `exports`.
5. Return at most 5 chunks: `id`, `path`, `lines`, `kind`, `summary`, and why it matched.

## The rule that matters

**Never answer from the index alone when source evidence is required.** The index carries
summaries and export lists, not behaviour. Every chunk you return must be accompanied by a
"read next" instruction naming the source path, and a consumer acting on the result must read
that file before editing it.

This repo has a specific reason for the rule: several modules are deliberate verbatim ports whose
docstrings explain why something that looks like a bug is intentional. An agent that acts on a
summary instead of the source will "fix" those. The index cannot carry that nuance; the file can.

The `frontend-e2e` domain is a trap for keyword search: its three specs assert *real geometry*
and run under `test:e2e`, not `npm test` (CI runs them in the `e2e` job). A consumer looking for
"layout tests" will also match the jsdom screen tests, which assert *declared styles* and cannot see
a collapsed panel. The two are complementary, not duplicates — pick by which question is being asked.

## Staleness

`CODEBASE.md` carries `source_fingerprint`. Recompute it and compare. A mismatch means stale —
recommend `/legion:map --refresh` rather than silently trusting the dataset. The exact command —
blob hashes sorted **by hash, not by path** (sorting whole lines by path gives a different value):

```bash
git ls-tree -r HEAD --format='%(objectname) %(path)' | grep -E '\.(ts|tsx)$' \
  | grep -v ' \.planning/' | awk '{print $1}' | sort | sha256sum | cut -c1-16
```

Current fingerprint is `b8114726c56afe93` at commit `7e98d58` (106 chunks, 294 symbols; code
identical to `main` @ `89219af`). Previous: `76035132f82dfdd9` at `35ac809` (63 / 150), before
Phase 6 added hosted mode. `legacy/souldbound-world.jsx` is **not** in this index; if a consumer
needs it, it lives in git — see "The retired oracle" in `CODEBASE.md`.

## Domain note for the entity ledger

A query about "narrative memory", "entity ledger" or "KNOWN ENTITIES" should return
`frontend/src/game/narrativeMemory.ts` first — it is the only merge. `applyWorldUpdate.ts` and
`App.tsx` both call it; neither holds the rules any more. The prompt side that renders the ledger
is `renderWorldEnginePrompt` in `backend/src/routes/worldEngine.ts`.

## Domain note for the access gate

"Access gate", "passphrase", "rate limit" or "401/429" spans three layers — return all three:
`shared/src/accessGate.ts` (the constants both sides use), `backend/src/accessGate.ts` (limiter and
gate, wired in `buildApp()` in `server.ts`), and `frontend/src/components/AccessGate.tsx` with
`frontend/src/lib/passphrase.ts`. Two 401s and two 429s exist: `PASSPHRASE_REQUIRED` /
`TOO_MANY_REQUESTS` are this app's gate; `AUTHENTICATION_FAILED` / `RATE_LIMITED` are Anthropic's.
Do not conflate them. In hosted mode the passphrase gate is not mounted at all; see the next note.

## Domain note for hosted mode (`backend-hosted`)

"Sign in", "account", "session", "invite", "magic link", "OAuth", "Better Auth", "Postgres",
"migration", "deletion" or "purge" belong to the `backend-hosted` domain plus three frontend files.
Route by sub-topic:

| Query about | Return first | Then |
|---|---|---|
| middleware order, Origin, CSRF, session gate, per-user limit | `backend/src/hostedGate.ts`, `buildApp()` in `server.ts` | `__tests__/hosted/hostedOrder.test.ts` |
| providers, magic link, Google linking, disabled paths | `backend/src/auth.ts` | `googleEmailVerified.test.ts`, `hosted/auth.test.ts` |
| invite codes, invite cookie, send caps | `backend/src/invites.ts` | `inviteCookie.test.ts`, `hosted/invites.test.ts` |
| account deletion, purge | `backend/src/account.ts` | `hosted/account.test.ts`, `hosted/purge.test.ts` |
| database, pool, migrations | `backend/src/db.ts`, `migrate.ts`, `backend/migrations/` | `hosted/db.test.ts` |
| error tracking, Sentry | `backend/src/errorTracker.ts` | `errorTracker.test.ts` |
| sign-in UI, mode detection, account panel | `frontend/src/components/ModeGate.tsx`, `SignIn.tsx`, `AccountPanel.tsx` + `hostedAccount.tsx` | `frontend/src/lib/authClient.ts`, `lib/api.ts` (`getAccessState`) |

Hosted 401 is `SIGN_IN_REQUIRED`; `ORIGIN_REJECTED` is a 403 from the Origin check; `INVITE_*` codes
come from redeem and sign-up. All live in `shared/src/accessGate.ts`. Hosted tests run under
`vitest.hosted.config.ts` against real Postgres and are **not** part of `npm test` — a consumer
searching for "tests for X" in hosted code must look under `backend/src/__tests__/hosted/` as well.
