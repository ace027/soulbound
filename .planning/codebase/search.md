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

## Staleness

`CODEBASE.md` carries `source_fingerprint`. Recompute it (git blob hashes of tracked `.ts`/`.tsx`
outside `.planning/`, sorted, SHA-256, first 16 chars) and compare. A mismatch means stale —
recommend `/legion:map --refresh` rather than silently trusting the dataset.

**Known pending invalidation**: Phase 4 plan 04-06 may delete `legacy/souldbound-world.jsx`. That
will change the fingerprint and should trigger a refresh.
