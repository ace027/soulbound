# Narration length check (2026-09-24)

A live check of `fc5b2cd` (shorter, plainer narration), authorized by the developer. It ran the full flow once: passphrase → questionnaire → unique skill → intro → 3 turns.

| Response | Words | Paragraphs | Before (the old spec) |
|---|---|---|---|
| Intro | 126 | 2 + closing line | "3 paragraphs" |
| Turn 1 | 106 | 2 | "2-3 paragraphs, rich prose" |
| Turn 2 | 100 | 1 | |
| Turn 3 | 115 | 2 | |

All four responses are inside the new budget (intro under 150 words, turns 60-120). Every call returned 200.

**Cache:** the measured prefix is **15,607** (intro-scene wrote it; all three world-engine turns read it). This supersedes 15,523.

**Files:** the full text is in `narration.txt`, the screenshots in `screenshots/`, and the per-call usage in `usage-lines.log`. `playthrough.mjs` takes a scratch directory holding a throwaway `pass` file.
