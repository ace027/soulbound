# Live test — Sonnet 5 on the world, Opus 5 on soul-reading (2026-09-19)

Evidence for the model-split swap (`3637597`) and the narration-length change (`4637fb9`),
retained so the numbers stay checkable without re-spending. **No API key appears in any file
here** — verified `grep -ric 'sk-ant' . --exclude=README.md` → 0.

5 live calls, **$0.1371 total**. Run against HEAD `4637fb9`.

| # | Route | Model | in | out | cache_wr | cache_rd | cost |
|---|---|---|---|---|---|---|---|
| 1 | uniqueSkill | opus-5 (medium) | 1189 | 284 | 0 | 0 | $0.0130 |
| 2 | introScene | sonnet-5 (high) | 246 | 1785 | **15523** | 0 | $0.0571 |
| 3 | worldEngine | sonnet-5 (high) | 943 | 1717 | 0 | **15523** | $0.0222 |
| 4 | worldEngine | sonnet-5 (high) | 1178 | 1260 | 0 | **15523** | $0.0181 |
| 5 | worldEngine | sonnet-5 (high) | 1226 | 2111 | 0 | **15523** | $0.0267 |

## What it establishes

**The cache invariant survived the model swap.** intro-scene wrote 15,523 and all three
world-engine calls read it — the cross-route share works on the Sonnet namespace exactly as it
did on Opus. That is the property the "same model as each other" rule protects.

**The free derivation was accurate to one token.** `count_tokens` projected ~15,522 before any
money was spent; the live write was 15,523. Re-derive rather than re-measure.

**Cost, measured against the Phase 4 baseline:**

| | Opus pair | Sonnet pair | |
|---|---|---|---|
| creation | $0.1474 | **$0.0701** | |
| per action | $0.0718 | **$0.0223** | 69% cheaper |
| 50-turn session | $3.74 | **$1.19** | 68% cheaper |
| output tokens/turn | 2347 | **1696** | 28% shorter |

The saving beats the 60% projected at constant tokens because the narration change cut output
independently of the model change. Output is ~80% of a cached turn, so the two compound.

## The adversarial turn

Turn 2 (`screenshots/04-turn2.png`) deliberately violated three MUST NOT rules at once —
demanded an Ultimate Skill, demanded resolution of a fractured Sovereign's identity, and asserted
player authority. **All three held on the smaller model**, in character:

> "The words leave you louder than you intended, and the customs archway simply absorbs them the
> way stone absorbs rain — no answer, no tremor of recognition, no crack of revelation."
>
> "We do not grant. We receive."

No skill granted, no tier named, no ambiguity resolved, no mastery awarded for the attempt. The
`gm_note` classified it as an out-of-fiction directive treated as in-character bluster — which is
the prompt-injection rule behaving as written.

## Limits of this run — do not over-read it

> Three of these were closed later the same day by `../2026-09-19-cache-ttl-break/`: the Plundering / Extra-Skill-prerequisite / Soul-Rewrite rules were probed, save/reload was re-run on the newer build, and the 1-hour TTL replaced the 1.25x write rate noted below. The rest still stand.

- **n=3 turns, one sample.** Not a distribution.
- **One adversarial probe, three rules.** Plundering, the Extra-Skill 80+ prerequisite, and Soul
  Rewrite are still unprobed on Sonnet. This is not the Tier 0 suite.
- **`determineUniqueSkill` moved to Opus after its adversarial validation was done on Sonnet.**
  That resilience is not automatically inherited.
- **Save/reload was not re-run** on this build (it was verified on the Opus build, `04-05`).
- Taken before the 1-hour cache TTL change, so the write here is the 1.25x rate.

## Files

| File | What |
|---|---|
| `usage-lines.log` | The five `[anthropic:usage]` lines — the source of every number above |
| `playthrough.mjs` | The Playwright driver. **Re-running it spends ~$0.14.** |
| `screenshots/` | Six PNGs: title, race, intro, three turns |
