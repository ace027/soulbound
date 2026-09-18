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

`CODEBASE.md` carries `source_fingerprint`. Recompute it (git blob hashes of tracked `.ts`/`.tsx`
outside `.planning/`, sorted, SHA-256, first 16 chars) and compare. A mismatch means stale —
recommend `/legion:map --refresh` rather than silently trusting the dataset.

Current fingerprint is `29353e65f863b7d1` at commit `3288223` (54 chunks, 125 symbols). The
previous dataset (`55cdb963eeca5ba7`) indexed `legacy/souldbound-world.jsx`, which Phase 4 deleted;
that invalidation is resolved and the oracle is **not** in this index. If a consumer needs it, it
lives in git — see "The retired oracle" in `CODEBASE.md`.
