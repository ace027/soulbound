# Project Background — The Soulbound Chronicles

This doc captures the fuller context behind the project: vision, current state, roadmap, and the working principles that have guided development so far. `CLAUDE.md` has the hard operational rules; this is the "why we're building this and where it's going" reference.

## Purpose & Vision
The Soulbound Chronicles is a passion-driven product development effort with a long-term vision of evolving into a 3D multiplayer experience. Inspiration comes from *Tensei Shitara Slime Datta Ken* (Tensura) — specifically its general conceptual framework (skill tiers, mastery, soul-bound power, strength "etched" onto a soul) — but the world, races, and skills are entirely original. It is **explicitly not** using any of Tensura's actual skills or lore.

Long-term vision, roughly in sequence:
1. Public release as a web/app (validation phase)
2. Persistent shared-world multiplayer
3. A 2D/3D game layer on top of the existing text engine
4. A local inference cluster for AI compute at scale, to support persistent multiplayer economically

## Current State (at time of migration)
The core game was functional as a single-file Claude.ai React artifact (`soulbound-world.jsx`), with the following systems built and iterated:

- Multi-phase character creation: race selection → open-ended questionnaire → Unique Skill generation → intro scene
- A live simulation loop with the World Voice (Claude, via the Anthropic API) narrating as structured JSON, parsed by the frontend
- Full skill tier system: **Intrinsic, Common, Extra, Unique, Ultimate** — with mastery tracking (0–100) and sub-ability emergence for Unique Skills at mastery 25/60/100
- **Soul Rewrite** — a rare mechanic allowing a Unique Skill to transform, gated deliberately strictly (see `design-decisions-log.md`)
- `localStorage`-based save system with title-screen integration (saved chronicles listed directly on the title screen)
- Mobile-responsive two-tab layout (World / Codex) below 700px width
- A "Soul Codex" sidebar: skills, mastery bars, soul resonance, sub-abilities
- A persistent `narrativeMemory` system (a known-entity ledger + rolling story notes) to fix NPC name drift and history loss outside the model's small action window
- A static `WORLD_LORE` block (full authored world reference: cosmology, kingdoms, races, timeline, the six Sanctum Sovereigns) injected fresh per call alongside `WORLD_SYSTEM_PROMPT`, with prompt caching via `cache_control: ephemeral`, through a shared `buildSystemBlocks()` helper
- API model `claude-sonnet-5` used uniformly across all three call functions: `determineUniqueSkill`, `callWorldEngine`, `generateIntroScene`

A friend has served as a playtester and provided UI/UX feedback throughout.

### Security posture (validation phase)
Session-only, in-memory API key storage was chosen for the validation phase, with a hardening plan covering CSP headers, LLM output sanitization before DOM rendering, input hygiene, and dependency auditing. Anthropic OAuth is not available for third-party apps, so BYOK (bring your own key) is the only currently viable auth path for a public release without the developer footing all inference costs.

## On the Horizon
- Public release as a website/app (validation planning underway — this migration is part of that)
- **Multiplayer architecture**: an authoritative world-state server (Postgres) owning skills, mastery, entities, and quest flags; per-encounter LLM calls for narration; cheaper/non-LLM logic for routine NPCs that don't need a full model call
- **Fine-tuning** (LoRA/QLoRA), scoped specifically to *behavioral discipline and format adherence* — not lore storage — as a later-phase tool, likely only needed once/if a local (non-Anthropic-API) model starts breaking JSON discipline or in-world staying-power in ways prompt engineering can't fix
- **Local inference cluster**: a 3-node cluster of AMD Ryzen AI Max 395+ mini PCs (128GB unified memory each, ~384GB total) for persistent shared-world compute. Candidate stack: Ollama/llama.cpp/vLLM with ROCm backend, Ray or simple Nginx load balancing, Postgres for world state, Llama 3.3 70B or Mistral as candidate local models. Explicitly sequenced as a future phase: validate the solo product first → add a single local node for dev/testing → scale to the full cluster once concurrent users justify it.
- Resolving open consistency issues flagged in the design log (stale ALL-CAPS term references, mastery table ambiguity edge cases, etc.)
- Lore enrichment threads still open: the Tally's dead currencies implying failed pre-Six kingdoms; Mycelium/Verdant Mother resonance; whether certain lore questions should remain deliberately unresolved forever or get a payoff eventually

## Key Learnings & Principles
These are the hard-won conclusions driving architecture decisions — see `design-decisions-log.md` for the full reasoning behind each:

- **Facts in retrieval, behavior in weights.** Fine-tuning is poor at preserving exact lore — facts drift and can't be updated without retraining. The correct architecture keeps canonical facts injected fresh (via `WORLD_LORE` today, or RAG at larger scale), with the model responsible for synthesis and voice, not fact storage. This is the same pattern used in customer support bots, coding assistants, legal/medical AI tools, and enterprise document chat — not something unique to this project.
- **World-state server as source of truth (multiplayer).** In a multiplayer context, an authoritative database — not the LLM — owns all game state. LLM calls should receive only the relevant slice of context needed for that specific call.
- **Lore rules are locked and must be respected**, e.g.: Sovereigns are secretly gods, but the World Voice must never confirm this outright; Ithren's dual-nature ambiguity must never resolve, even after an encounter ends; Sevreth's test is invisible and has no fixed checklist; Unique Skills arise from individual soul nature, not the Sundering; Hollowed is a birth condition (not a mid-life conversion).
- **Sub-ability generation is emergent, not pre-written.** Sub-abilities crystallize through play at mastery thresholds (25/60/100), shaped by a private `usage_notes` accumulator — never pre-generated at character creation.
- **One Unique Skill per soul.** Soul Rewrite is the only narrow, heavily-gated exception.

## Approach & Working Patterns
- **Iterative, feel-driven workflow**: test in the actual running app, describe what feels wrong in plain language, have Claude diagnose and fix — rather than extended upfront design discussion for every change.
- **Concise change summaries preferred** over verbose walkthroughs.
- **Design log maintenance**: `design-decisions-log.md` is updated throughout development to document decisions and rationale as they're made, not retroactively.
- **Adversarial testing matters here.** The character-creation questionnaire prompt was deliberately stress-tested against injection-style attacks (see the log's "Tier 0 stress tests" section) rather than just assumed safe — worth continuing this practice for any prompt surface that takes raw user text.

## Tools & Resources

**Current (artifact phase):**
- Frontend: React/JSX, single file (`soulbound-world.jsx`)
- AI: Anthropic Messages API (`claude-sonnet-5`), prompt caching on the lore block
- Storage: `localStorage` for saves; session-only in-memory storage for the API key

**Planned (post-migration / multiplayer phase):**
- Database: Postgres for authoritative world-state
- Compute: local AMD Ryzen AI Max 395+ inference cluster
- Project knowledge / docs: this repo replaces the old Claude Project's knowledge files (`soulbound-world.jsx`, `design-decisions-log.md`, `suggested-custom-instructions.txt`)
