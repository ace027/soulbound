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

The `frontend-e2e` domain is new and is a trap for keyword search: `frontend/e2e/smoke.spec.ts`
asserts *real geometry* and runs under `test:e2e`, not `npm test`. A consumer looking for "layout
tests" will also match the jsdom screen tests, which assert *declared styles* and cannot see a
collapsed panel. The two are complementary, not duplicates — pick by which question is being asked.

## Staleness

`CODEBASE.md` carries `source_fingerprint`. Recompute it and compare. A mismatch means stale —
recommend `/legion:map --refresh` rather than silently trusting the dataset. The exact command —
blob hashes sorted **by hash, not by path** (sorting whole lines by path gives a different value):

```bash
git ls-tree -r HEAD --format='%(objectname) %(path)' | grep -E '\.(ts|tsx)$' \
  | grep -v ' \.planning/' | awk '{print $1}' | sort | sha256sum | cut -c1-16
```

Current fingerprint is `76035132f82dfdd9` at commit `35ac809` (63 chunks, 150 symbols). Previous:
`9ff2babb3c9f807f` at `1506c3a` (56 / 127), before Phase 5 added the access gate and the
2026-09-24 prompt changes. `legacy/souldbound-world.jsx` is **not** in this index; if a consumer
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
Do not conflate them.
