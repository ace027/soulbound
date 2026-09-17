# Plan 01-04 Summary — Frontend service skeleton

**Status**: Complete
**Wave**: 2
**Agent**: Frontend Developer (claude-sonnet-5)
**Requirements**: R1, R12 (fonts portion)

## Files Created
`frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/Dockerfile`, `frontend/.dockerignore`

## Verification (re-run independently by the orchestrator)
| Check | Result |
|---|---|
| `npm run build -w @soulbound/frontend` | PASS — exit 0, `✓ 16 modules transformed` |
| Keyframe diff legacy vs `index.css` | PASS — **identical, 7 keyframes** |
| `@import` count in `index.html` / `index.css` | PASS — 0 and 0 |
| Font family string matches legacy exactly | PASS — byte-identical query string |
| `grep -r 'api.anthropic.com' frontend/src/` | PASS — empty (exit 1) |
| `/api/health` through the Vite proxy | PASS — agent showed `x-powered-by: Express` + CORS header, proving a real backend round-trip rather than a stub |
| Docker build + run non-root | PASS — serves on 5173, `whoami` → `node` |
| No cert/key in image history or bundle | PASS |

## The seventh keyframe
My pre-dispatch check found the plan's prose enumerated six keyframes when the legacy file has **seven** — `cardHover` was missed. The plan's verify step diffs the extracted lists rather than trusting the enumeration, which is exactly why it caught this. All seven are present and the diff is empty. `cardHover` is an empty `{}` block in legacy and was relocated as-is rather than filled in.

## Legacy style drift — a judgment call worth recording
The six duplicated `<style>` blocks were **not** actually identical. Three animations and the scrollbar rule had drifted between copies, presumably from copy-paste iteration:

| Rule | Variants found | Chosen |
|---|---|---|
| `breathe` | 0.4/0.9 (×2), 0.5/1, 0.6/1 | 0.4/0.9 |
| `glowPulse` | 18px (×2), 22px | 18px |
| `etchIn` | 6px/6px (×2), 8px/3px | 6px/6px |
| scrollbar thumb | 4px (×2), 3px | 4px |

The agent resolved each by plurality among values that already existed in the legacy file, and documented the choice in a header comment in `index.css`. **No value was invented** — I verified `breathe` directly against the legacy occurrences. That respects the "do not restyle" constraint: this is relocation of drifted duplicates, not new styling.

I corrected one inaccuracy in that comment: `breathe` has 4 legacy occurrences, not 3, so the chosen variant is 2-of-4 rather than 2-of-3.

This drift is worth knowing during the Phase 3 UI port — if a screen looks subtly off against the artifact, one of these four rules is the first place to look.

## Agent decisions flagged, accepted
- **`serve@14`** in the Docker runtime stage rather than nginx, keeping the image in the same Node toolchain as the backend and avoiding an nginx non-root config the plan didn't ask for. Installed only inside the runtime layer, not added to `package.json`.
- **Proxy target configurable** via `BACKEND_ORIGIN` (default `http://localhost:3001`), so compose can point it at the service name instead of `localhost`.
- The agent caught its own false positive: an explanatory HTML comment containing the literal string `@import` tripped the grep check. Reworded and re-verified at 0.

## Correctly deferred
`window.innerWidth` computed during render with no resize listener (legacy line 1348) was **not** touched — that belongs to Phase 3, where the responsive layout is actually ported.
