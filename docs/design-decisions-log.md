# The Soulbound Chronicles — Design Decisions Log

This document captures *why* the system is built the way it is, not just what it does. The migrated app — `frontend/`, `backend/`, `shared/` — is the source of truth for current behavior; the original `legacy/souldbound-world.jsx` artifact (note the spelling — the original filename transposed two letters) was retired at the end of Phase 4 (see "Legacy artifact retired" below). This file exists so future changes don't accidentally undo deliberate tradeoffs.

## Core Concept
A Tensura-inspired (Tensei Shitara Slime Datta Ken) text RPG where Claude acts as "The World Voice" — an AI game master running an entire original fantasy world (Vaeltharion) inside a single React artifact, calling the Anthropic API directly from the browser. Skills are "remembered by the soul" rather than learned — power emerges from who a character is and what they do, not from leveling mechanics in the traditional sense.

Explicitly NOT using Tensura's actual skills/lore — only the general conceptual framework (skill tiers, mastery, soul-bound power, the idea that strength is "etched" onto a soul). Original world, original races, original skills throughout.

## Skill Tier System — Final Design
1. **Intrinsic** — granted by race at creation, starts at randomized 3-8 mastery (NOT 50 — see rationale below)
2. **Common** — emerges from ~5-10 consistent relevant actions, no prerequisite skill needed
3. **Extra** — emerges only when a related Common Skill hits 80+ mastery AND a deeper soul pattern is shown. This is additive (a new skill is granted alongside the Common one), not a replacement/evolution of it.
4. **Unique** — exactly one per soul, granted via the open-ended questionnaire at creation. Sub-abilities are NOT pre-generated — they emerge through play (see "Sub-Ability Emergence" below).
5. **Ultimate** — transcendence tier, explicitly forbidden during normal play, reserved for genuinely world-scale deeds.

Two cross-cutting mechanics: **Mastery Boost** (some skills accelerate mastery gain on all other skills) and **Plundering** (some Unique Skills can copy/steal skills from defeated foes — gated so it only works if the player's actual Unique Skill has this property).

### Why Intrinsic Skills start at 3-8 mastery, not 50
Original design had intrinsics start at flat 50/100 ("Adept" tier) on the theory that race-granted abilities should feel "born competent." This was reconsidered: it broke the power curve by making intrinsics worth more than double a Common Skill's emergence threshold for doing literally nothing, and it created unfair race balance (combat-flashy intrinsics like Breath Weapon front-loaded more value than utility ones like Earthsense). 

Resolution: intrinsics now start at a randomized single-digit mastery (3-8), keeping them solidly Novice tier mechanically, while the system prompt still instructs the World Voice that intrinsics "activate instinctively but clumsily" — meaning they function reliably from a narrative standpoint even at low numeric mastery. Competence is inherent; the power *ceiling* is still earned like everything else. The randomization (vs. a flat number) was a deliberate touch so two characters of the same race don't start mechanically identical.

### Sub-Ability Emergence (major redesign — see full mechanic below)
Originally, `determineUniqueSkill()` generated all three sub-abilities (unlocking at mastery 25/60/100) up front, at character creation, alongside the base skill. This was changed: sub-abilities are no longer pre-written. The Unique Skill now starts with an empty `sub_abilities: []` array, and each sub-ability is generated individually, by the World Engine, at the exact moment mastery crosses 25/60/100 for the first time during actual play.

Rationale: pre-generating all three meant mastery thresholds were just unlocking pre-written text regardless of what the player actually did to earn it. The new design makes sub-abilities a genuine reflection of how the player has engaged with their Unique Skill — not just that a number went up.

**Mechanically**, this required:
- A new `usage_notes` array on the Unique Skill that silently accumulates short flavor strings every time its mastery changes (action taken + mastery delta + any flavor reason)
- `callWorldEngine()` now passes both the player's original 5 questionnaire answers (for long-term consistency with who the soul fundamentally is) AND the last 8 usage notes (for what they've actually been doing) into every world engine call
- A new JSON response field `unique_sub_ability_unlocked`, populated only when a threshold is crossed for the first time
- Explicit design constraint, confirmed by user: **no hints, no spoilers** — locked sub-ability slots show only "🔒 N more sleep, waiting to be discovered..." with zero indication of what's coming
- If a Soul Rewrite occurs (see below), both `sub_abilities` and `usage_notes` reset to empty — a rewritten Unique Skill earns its own sub-abilities from scratch rather than inheriting the old skill's discovered ones

### Soul Rewrite — rare Unique Skill transformation
A soul carries exactly one Unique Skill at all times — this is fixed and does not change through ordinary mastery gain, leveling, or request. However, per user's explicit design intent ("certain decisions can decide how someone's soul is shaped, kind of like in real life"), there is one narrow exception: a **Soul Rewrite**, where the existing Unique Skill is transformed/fused into a new one reflecting fundamental character change.

Gating is intentionally strict:
- Only triggered by a single morally/existentially massive decision (irreversible sacrifice, defining betrayal, surviving something that should have destroyed who they were) OR sustained multi-session drift from the original soul profile
- NEVER on player request, never as a combat/mastery reward
- System prompt explicit instruction: "When genuinely uncertain whether a moment qualifies, it does not qualify"
- Should happen "at most once or twice in an entire long-term playthrough, if ever"
- Always costs something — explicitly never a pure power-up; something is gained AND something is lost
- Gets the heaviest visual/narrative treatment in the entire app — bigger than a normal Soul Etching, with the old skill name struck through and a dedicated `rewrite_narrative` field

## Stateless Context Window — Known Structural Constraint
The World Engine (`callWorldEngine`) is a stateless API call — each call only receives: full current skill list (with mastery), last 5 actions from action history, current location/scene, and (as of the sub-ability redesign) the original soul profile + last 8 Unique Skill usage notes. It does NOT receive the full narrative history of the playthrough. This is a deliberate token-cost tradeoff, but it means:
- Mastery progression must be trusted from the actual skill list state (which is passed in full), not inferred from narrative memory
- Long-form *narrative* consistency (what specifically happened three sessions ago) is still the World Voice's responsibility alone, with no external memory aid. **World *lore* consistency is no longer part of this gap** — as of the `WORLD_LORE` block (see below), every call receives the full authored world reference regardless of narrative memory, so contradictions about kingdoms, races, the Sundering, or the Sovereigns should no longer occur even across completely separate playthroughs. What remains unsolved is session-specific narrative continuity, not world-fact consistency.


## Lore System — Implemented
The world previously had only a sketch (6 kingdoms, 8 races) with no authored backstory connecting them, which risked the World Voice *improvising* lore per-session rather than *revealing* pre-written lore — a real contradiction risk across separate playthroughs. This has been resolved: a full lore pass was brainstormed and written, then converted into a new static system prompt block, `WORLD_LORE`, separate from `WORLD_SYSTEM_PROMPT`.

**What's authored now:**
- **The Sundering** (~3,000 years ago) — the founding cataclysm. The gods existed close to the world and magic flowed externally from them (cast, not carried); their withdrawal is the Sundering, and the magic they left behind fragmented into mortal souls rather than vanishing — this is the in-world reason magic is soul-bound instead of cast. Why the gods left is deliberately left ambiguous even in-lore (war among them / refusal to sustain mortals / punishment / mercy) — no explanation is privileged as true, which gives the World Voice room to let different NPCs believe different things without any of them being "wrong."
- **The Vault Sovereigns are the gods themselves** — a major structural decision. Each of the six Sovereigns is a fragment of a withdrawn god, sealed in the Vault that was once a place they inhabited. This is unknown to mortals and must never be confirmed outright by the World Voice, only approachable/theorizable. Each Sovereign has an individually varied degree of self-awareness (deliberate design feature, not to be normalized): **Vaheris** (Kaldrath/war) is lucid and grieving, self-sealed to avoid finishing a war it can't forgive itself for; **the Verdant Mother** (Verdance/life) is forgotten and tragic, genuinely believing herself an ordinary beast; **Ithren** (Ashenveil/shadow) is unstable, flickering unpredictably between lucid and feral within a single encounter — this ambiguity is permanent and must never resolve, even after the encounter ends; **Sevreth** (Aurelis/knowledge) is lucid and testing, and is the **sole current path to Ultimate Skill transformation** (see below); **the Tally** (Tidemark/trade) is forgotten and eerie, still running trade-bargain patterns whose meaning has drained out; **Korrash** (Sundrach/craft) is lucid and in denial, destabilized into disproportionate violence if a visitor names what it actually is.
- **Sevreth's test and Ultimate transformation mechanic** — Sevreth is the only currently defined path to transform a Unique Skill into Ultimate tier. Two outcomes are tracked as independent: whether the player defeats Sevreth in combat, and whether their conduct satisfies whatever Sevreth is testing that playthrough. A player can pass one without the other. The test itself has no fixed checklist — it's meant to be interpreted fresh each playthrough from the player's soul profile and Unique Skill usage history, so different souls can "pass" in completely different ways. The player must never be told they're being tested unless they hold a skill that explicitly grants that detection — this was an explicit, repeated user constraint ("I dont want players to lock down, hey I need to do this in order to unlock an ultimate skill").
- **The six kingdoms, renamed and relationally mapped**: Iron → **Kaldrath** (war), Emberal → **Sundrach** (craft) — both renamed after brainstorming for better feel; Verdance (life), Ashenveil (shadow), Aurelis (knowledge), and Tidemark (trade) kept their original names. Each kingdom sits atop its Sovereign without conscious knowledge of what that Sovereign is, but each carries some cultural echo of it — ranging from Kaldrath's buried ritual taboo, to Sundrach's inherited discomfort with being called a master craftsman, to Aurelis's internally split awareness (an old scholarly order suspects Sevreth's true nature; the kingdom's official position doesn't). A full relationship web was authored (stable dependencies, underplayed frictions, philosophical tensions, structural trade dependency) rather than leaving kingdom interactions to be improvised.
- **All eight races**, given origin stories and inter-race friction/kinship logic grouped into four natural pairs: **Undying & Hollowed** (both direct products of the Sundering's soul-transfer, but Undying has a shared founding culture and myth while Hollowed has neither — deliberately NOT extended as a template to the other three pairs, per explicit user note); **Elvari & Feral** (competing claims to old-world authority — articulate memory vs. pre-conscious instinct — neither privileged as correct); **Human & Stonewarden** (adaptation vs. permanence, both indifferent to the Elvari/Feral memory-vs-instinct dispute); **Drakari & Shadeveil** (inherited bloodline vs. touched-by-absence, assumed similar by outsiders due to both being visibly marked, but culturally quite different underneath).
- **A five-era loose timeline** with soft (not hard) dates: the Old Order (pre-Sundering) → the Sundering (~3,000 years ago) → the Scattering (~200–400 years of chaos immediately after) → the Founding of the Six (~2,500–1,000 years ago, staggered per kingdom) → **the Unwritten Era** (now, open-ended — named after rejecting a first-pass name, "the Long Present," which didn't land; "the Unwritten Era" was chosen specifically because it doubles as a statement about the player's role in filling in an era that hasn't been written yet).

**Where the reveal rules live:** lore *facts* live in `WORLD_LORE` (static, cacheable, no behavioral instructions). Lore *reveal constraints* — never confirm Ithren's true state, never tip Sevreth's test without a detection skill — were added to `WORLD_SYSTEM_PROMPT`'s existing MUST NOT list instead of embedding them in the lore block itself. Rationale: `WORLD_LORE` is reference material; behavioral constraints belong with the other MUST NOT rules (no Ultimate outside normal play, no Plundering without the right skill, etc.) so all narration-behavior rules stay in one place rather than split across two blocks.

**Consistency check performed before implementation:** a full pass was run across the new lore against the existing skill system, race intrinsics, and Soul Rewrite mechanic before writing any prompt language. One real inconsistency was found and fixed (stale "Iron"/"Emberal" kingdom names in the existing system prompt, predating the rename). No other contradictions were found — the Sundering mechanism, Sovereign roster, kingdom web, race origins, and timeline all check out against prior mechanics without requiring any of them to change.

**Post-review clarification — Hollowed is a birth condition, not a conversion:** an early draft of the reader-facing lore overview described Hollowed as appearing "unpredictably in any bloodline," which an outside reviewer correctly flagged as ambiguous — it could be read as "any character can convert to Hollowed mid-life" (Model A) as easily as "a Hollowed individual is simply born fractured within an existing bloodline" (Model B). Model B was chosen and is now stated explicitly in `WORLD_LORE`: a Hollowed character is born Hollowed, not transformed into it, and does not lose or convert from another race's intrinsics. This was confirmed as a lore-only clarification with **no code changes** — Hollowed already behaves in `RACES`/character creation exactly like every other race (pick it, get its two intrinsics), and Model B doesn't require any hybrid-intrinsic or mid-playthrough race-change system. A Hollowed character's birth bloodline (if any is implied by backstory) is flavor only, not mechanical. Model A (mid-life conversion, losing original intrinsics) was explicitly rejected as a much larger mechanic — closer in scope to Soul Rewrite but for intrinsics rather than the Unique Skill slot — and was not built.

**Ninth race added — Mycelium:** an outside reviewer suggested a fairy/spirit-type race, which was developed into Mycelium — a fungal network-being, the only race whose soul is not a single individuated fragment but a temporarily-embodied piece of a larger distributed network. Deliberately given a real Sundering tie (a portion of the fragmenting magic took root in the land instead of an individual soul) rather than the more obvious "ancient fae predating the Sundering" framing, specifically to preserve the pattern that all races connect to the founding cataclysm rather than making Mycelium an unexplained outlier. Two intrinsics: Spore Sense (senses direction/distance to spore-rich ground) and Network Echo (can regrow a replacement body if killed near spore-rich ground — same self, but thinned and mechanically unreliable until recharged; impossible outside a zone's reach). Network Echo was flagged during design as a potential balance risk (a near-immortality clause is a bigger deal than Human's once-per-day Grit) — resolved by making the recharge cost of reconstitution itself the built-in balancing mechanism, so the race's core vulnerability (needing spore-rich ground) directly gates its most powerful trait rather than needing an unrelated bolted-on limitation. Whether a reconstituted Mycelium is "the same person" is deliberately never resolved by the World Voice, in the same spirit as Ithren's ambiguity. Added as a full 9th entry to `RACES` (selectable at character creation, not a sub-race or modifier on another race) and to both `WORLD_SYSTEM_PROMPT`'s race summary and the full `WORLD_LORE` entry. Note: race selection UI was originally laid out for 8 races (2-column grid); a 9th race makes the final row uneven — purely cosmetic, not yet addressed.

**Race-to-kingdom population concentration added:** an outside reviewer's confusion (see below) surfaced a real authoring gap — kingdom culture and race origin had been built as two entirely separate tracks, with no stated relationship between "who lives where." Resolved by giving each kingdom a concentrated (not exclusive) racial population, chosen to align with existing cultural logic rather than invented fresh: Kaldrath (Drakari, plus strong Human presence as in every kingdom), Verdance (Feral and Mycelium — Mycelium was initially placed in Tidemark for its non-territorial nature, but corrected to Verdance per user direction, since a distributed network spreading through living land is thematically closer to a life-kingdom than a trade-kingdom), Ashenveil (Shadeveil — the closest ideological match anywhere on the map), Aurelis (Elvari), Tidemark (Human), Sundrach (Stonewarden). Undying and Hollowed were deliberately left with no home kingdom — Undying's ritual/permanence culture doesn't map cleanly to any single kingdom concept, and Hollowed's established "no unified culture or homeland" lore would be directly contradicted by forcing a concentration onto them. This was confirmed as "concentration, not exclusivity" per explicit user direction — every kingdom still has residents of every race, just with a demographic center of gravity. Added to `WORLD_LORE`'s kingdom entries and to the reader-facing overview doc.

**Sanctum/Sovereign naming clarity fix (reader-facing doc only):** a reviewer read the Sovereign names (Vaheris, Ithren, etc.) as if they were the names of the Sanctums themselves — a real ambiguity in the original doc's prose, which led with the Sovereign's name and only mentioned the Sanctum descriptively ("Vaheris, beneath Kaldrath, in a Sanctum that's a frozen battlefield..."). Fixed by explicitly defining Sanctum (place) vs. Sovereign (being) up front with a "king's name isn't his castle's name" analogy, then restructuring the six-entry list into an explicit Kingdom → Sanctum → Sovereign chain so the three nouns can never collapse into each other on a skim-read. This was a reader-doc-only fix — `WORLD_LORE` itself was never actually ambiguous on this point (Sovereigns and their Sanctum descriptions were always structurally distinct there), so no change was needed in the actual game file for this specific issue.

**Resolved — Unique Skills are explicitly NOT Sundering-derived:** the previously flagged gap (see above in original brainstorm notes) has been closed. Three options were considered: (A) Unique Skills as concentrated/pooled Sundering-magic, same source as Intrinsics just distributed differently; (B) Unique Skills as categorically unrelated to the Sundering, arising from the individual soul's own nature instead; (C) Unique Skills as a faint echo of a specific god/Sovereign's nature, resonating thematically with one of the six kingdom concepts. **Option B was chosen.** This keeps the character-creation questionnaire's entirely personal, non-racial framing (threat response, drive, flaw, memory, relationship to power) consistent with what a Unique Skill actually represents — soul nature, not inheritance — and avoids Option C's risk of accidentally implying Unique Skills are constrained to six thematic buckets, which would contradict the existing "skills emerge freely from the soul questionnaire" design intent. A soft, unconfirmed echo of Option C was preserved as a single deliberate line in `WORLD_LORE` — a rare, careful player might notice a Unique Skill occasionally "rhyming" with a Sovereign's domain, but this is explicitly never a rule, pattern, or hidden mechanic, and the World Voice must not let it narrow what a Unique Skill can be. Added as a new `WORLD_LORE` subsection, "WHERE UNIQUE SKILLS COME FROM," placed directly after "THE SUNDERING" so the contrast (Intrinsic/Common/Extra trace to it, Unique Skills explicitly do not) reads immediately. No changes needed to `WORLD_SYSTEM_PROMPT`'s existing Unique Skill tier description — "reflect who the being IS at their core" and "recognized... not earned" were already consistent with this resolution, just previously unexplained at the lore level.

**Naming pass — four renames committed to the live game files (previously reader-doc-only):** four renames were first trialed in the reader-facing lore overview doc during an external review pass, then confirmed and committed to the actual game files (`WORLD_SYSTEM_PROMPT`, `WORLD_LORE`, `RACES`) in a later session: **Elvari → Vaelwyn** (race name and `id`, both changed — no other code references the literal string "elvari" so this was a safe rename with no follow-on effects), **Vault → Sanctum** (all "Vault"/"Vaults" occurrences, including "Vault Sovereign(s)"), **The Old Order → The Old Age Order**, **The Founding of the Six → The Age of Six**, **The Unwritten Era → The Open Age**. Verified before committing that `race.name` and `race.id` are only ever read dynamically at runtime (save metadata, API prompts, UI rendering, character creation) and never hardcoded elsewhere in the file, so renaming the `RACES` array entry required no other code changes. Note: existing localStorage saves created before this rename will still display "Elvari" in their save metadata (`race.name` was captured as a string at save time) — this is expected, not a bug, and will only update if that save is loaded and re-saved under the new character system. No compatibility issue for new characters going forward.

## Prompt Caching — Implemented
`WORLD_SYSTEM_PROMPT` and `WORLD_LORE` are both static across every call within a playthrough (and across playthroughs — neither depends on character state), making them a natural fit for Anthropic API prompt caching. Implemented via a shared `buildSystemBlocks()` helper that returns both blocks as a `system` array, with `cache_control: { type: "ephemeral" }` set on the `WORLD_LORE` block — this caches everything up to and including that point, so the ~static token cost is paid once rather than on every `callWorldEngine` or `generateIntroScene` call.

**Bug found and fixed during this change:** `generateIntroScene()` was previously concatenating `WORLD_SYSTEM_PROMPT` directly into the user-role prompt string instead of passing it via the `system` parameter — meaning it never benefited from caching even before `WORLD_LORE` existed, and would have had no path to receive `WORLD_LORE` at all without this fix. It now uses `buildSystemBlocks()` the same way `callWorldEngine()` does.

**Deliberately left out of system access entirely — not just lore access (corrected):** this was previously recorded as "`determineUniqueSkill()` was NOT given access to `WORLD_LORE`," which understates what the code actually does. The call sends **no `system` parameter at all** — not `WORLD_LORE`, not `WORLD_SYSTEM_PROMPT`, no system blocks of any kind. `backend/src/routes/uniqueSkill.ts:169` passes `useSystem: false`, and `backend/src/anthropic.ts:471` applies it as a conditional spread that omits the `system` key from the request object rather than sending `system: undefined` — a materially different request shape, and the distinction is pinned by a test at `backend/src/__tests__/anthropic.test.ts:286-293` asserting `'system' in request === false`. So the property to preserve is system-blind, which is strictly stronger than lore-blind. The reasoning is unchanged: its job is soul-reading from questionnaire answers, not world-consistency, and sending it neither block keeps the call cheap, focused, and byte-identical to the prompt that survived the Tier 0 adversarial tests below. This was an explicit choice, not an oversight — flagged and confirmed with the user before implementation.

**Verification note:** cache behavior should be confirmed in live testing by checking for `cache_creation_input_tokens` / `cache_read_input_tokens` in the API response on the second call onward. If caching silently isn't engaging, the app still functions correctly — it just won't see the token savings — so this is worth checking but isn't a functional blocker. (This has since been confirmed live — see the model split below.)

## Model Split — revised 2026-09-18: Sonnet 5 on the world, Opus 5 on soul-reading

**This reverses the entry below, and the reversal was again the point.** The arrangement is now
`claude-sonnet-5` on `callWorldEngine()` and `generateIntroScene()` at `effort: 'high'`, and
`claude-opus-5` on `determineUniqueSkill()` at `effort: 'medium'` — the inverse of what the
previous entry describes. The developer chose it deliberately, with the earlier reversal in view,
to see how it plays.

**The cache invariant is preserved, and that is what made the swap safe.** The constraint was never
"use Opus" — it is that `callWorldEngine()` and `generateIntroScene()` stay on the *same* model as
each other, because they are the only two routes that send system blocks and therefore the only two
that share a cache namespace. Moving them *together* keeps that intact; they now share a Sonnet
namespace instead of an Opus one. `determineUniqueSkill()` sends no `system` parameter at all, so
it has no cached prefix and could move independently without touching the pair.

That invariant is no longer only a comment. `backend/src/__tests__/config.test.ts` asserts
`MODELS.worldEngine === MODELS.introScene`, verified by mutation: splitting the pair fails the test.

**Effort became per-route in the same change.** It had been a single constant across all three
calls, with a comment claiming that uniformity "also isn't optional". That was overstated — the
byte-identical `output_config` requirement binds only the two routes sharing a cache. The pair
stays equal at `'high'`; `uniqueSkill` runs `'medium'`, since it is one short soul-read from five
questionnaire answers rather than rule-adherence over a 15k-token prompt.

**Projected cost at constant tokens**, from Phase 4's committed usage log: a cached turn drops from
$0.072 to **$0.029** (~60% cheaper), creation from $0.147 to **$0.072**, and a 50-turn session from
$3.74 to **~$1.51**. Those are projections holding token counts fixed — real output length will
shift with the model, so re-derive from `[anthropic:usage]` lines after a live session rather than
quoting these.

**What to watch.** `determineUniqueSkill`'s prompt is the adversarially-validated surface (see the
Tier 0 stress tests below) and those tests were run against Sonnet; it now runs Opus at lower
effort, so the resilience observed there is not automatically inherited. The world-engine's job is
holding the MUST NOT rule list and a strict JSON schema together over a large prompt — the thing
`effort: 'high'` was chosen to protect — and it is now doing that on a smaller model. Both are
worth watching in play rather than assuming.

## Access gate for published images (2026-09-23)

**The problem.** Phase 5 publishes a Docker image anyone can pull. Until then the only thing
protecting the backend was the loopback bind in `docker-compose.yml`. A deployer who published the
port, on purpose or by accident, put an unmetered proxy for their own Anthropic key on the network.

**Options, and the choice.** The developer chose option 2, a deployer-set access gate, on
2026-09-23:
1. Docs-only warnings. Rejected: safety would depend on every deployer reading them.
2. A deployer-set passphrase on every paid route. **Chosen.**
3. Real user accounts. Rejected as out of scope: they belong with multiplayer.

**What shipped.** Every `/api/*` route except `/api/health` requires
`Authorization: Bearer <SOULBOUND_PASSPHRASE>` (`backend/src/accessGate.ts`,
`backend/src/server.ts`). A missing or wrong value gets 401 `PASSPHRASE_REQUIRED` with
`WWW-Authenticate: Bearer realm="soulbound"`. A per-client rate limit (default 30/min,
`RATE_LIMIT_PER_MINUTE`, 1-600) runs **before** the passphrase check and before any body parsing,
so guesses are throttled and an unauthenticated body is never parsed. Over the limit gets 429
`TOO_MANY_REQUESTS` plus `Retry-After`. The comparison hashes both sides with SHA-256, then uses
`crypto.timingSafeEqual`. The passphrase is required at boot, redacted from logs like the key, and
deleted from `process.env` once read (`backend/src/config.ts`). `/api/health` stays open because
the compose healthchecks call it with no credentials.

In the browser, `frontend/src/components/AccessGate.tsx` wraps `<App/>` in
`frontend/src/main.tsx`. Before the title screen it calls `GET /api/access` (204 means in). On 401
`PASSPHRASE_REQUIRED` it shows an inline form: no `window.prompt` (constraint #1). The trimmed value
is stored in `localStorage` under `sbc-access-passphrase` and sent as the Bearer header on every
call. A later `PASSPHRASE_REQUIRED` clears it and asks again. `App.tsx` is unchanged.

**This is not the rejected paste-per-session BYOK.** CLAUDE.md rejects BYOK, where players paste an
Anthropic key into the browser. Here the deployer issues the passphrase and the player never holds
an Anthropic key. The key architecture is unchanged: the backend holds the deployer's key from
`.env`. The gate is access control on that proxy, not a re-opening of the auth decision.

**New error codes, on purpose.** Upstream Anthropic failures already use 401
`AUTHENTICATION_FAILED` and 429 `RATE_LIMITED` (`backend/src/anthropic.ts`). The frontend decides by
**code**, never by status, so a bad deployer key never wipes a player's correct passphrase.

**Printable ASCII only, 12+ characters.** Browsers refuse to send characters outside Latin-1 in a
header. An accented or emoji passphrase would let the UI open and then fail every call silently,
so the backend refuses to boot on one instead.

**One image, and a departure from the earlier proxy note.** The architecture was chosen from three
competing proposals: "Pragmatic + 2 from Clean". The backend serves the built frontend when
`STATIC_DIR` is set, so the browser and API are same-origin on one port, with no proxy and no CORS
change. `/api/*` never returns `index.html`, and paths with a file extension never get the page
fallback. This **departs** from an earlier STATE note recommending a reverse proxy that forwards
`/api`: serving the bundle from the backend gives the same same-origin property without one. The
rejected alternative was an nginx front end with two images, a better fit for a future world
server but a second container every deployer pays for today. `backend/Dockerfile` stages:
`builder` → `frontend-build` (on `$BUILDPLATFORM`) → `api` (no bundle; the dev compose targets it)
→ `runtime` (the published image). The frontend's old `serve -s` runtime stage was deleted.

**Accepted gaps.**
- If the backend is down when the page loads, the UI opens anyway. A creation that later hits a 401
  still strands on the loading screen (`App.tsx:267-269`). That needs two rare conditions, and
  fixing it would mean editing `App.tsx`.
- The historical evidence scripts (`.planning/phases/02-backend-world-voice/evidence/live-verification.mjs`,
  `.planning/phases/04-parity-verification/evidence/playthrough.mjs`, and the two
  `.planning/experiments/2026-09-19-*/playthrough.mjs`) send no header, so they get 401 if re-run.
  They are historical evidence and stay as they are.
- Failed-passphrase requests share a rate-limit bucket with real players from the same address.
- Behind the dev compose, all LAN players share one bucket: they all arrive via the Vite container.
- It is plain HTTP. TLS termination is out of scope.

**Release.** `.github/workflows/release.yml` runs on manual `workflow_dispatch` only: test, smoke,
then publish `ghcr.io/deanitservices/soulbound:{version}` and `:latest` for `linux/amd64` and
`linux/arm64`. It refuses when the four `package.json` versions disagree and refuses to overwrite
an existing version tag; that check fails closed. CI runs `scripts/smoke-image.sh` on every push.
The first real GHCR publish is **untested** until someone dispatches it after merge.

---

## Model Split (superseded 2026-09-17 entry) — Sonnet 5 for soul-reading, Opus 5 for the world

**This reverses the earlier all-Sonnet decision, and the reversal was the point.** The migration originally put every World Voice call on one Sonnet model, on the reasoning that one model everywhere is one fewer thing to keep consistent. It no longer holds: the world engine loop and intro scene generation run on `claude-opus-5`, and only `determineUniqueSkill()` stays on `claude-sonnet-5`. This was flagged *as a reversal of a logged decision* before it was made, and the developer chose it deliberately with that in front of them. A later session that finds "all Sonnet" in an older note is looking at superseded material, not at drift to correct back. Model IDs live in exactly one place — `backend/src/config.ts`'s `MODELS` — never as a literal at a call site, so the split can't quietly diverge per route.

**Intro scene joined Opus 5 for the cache, not for the prose.** Prompt caches are scoped to a model. `callWorldEngine()` and `generateIntroScene()` send byte-identical system blocks (see "Prompt Caching" above), so on the *same* model they share one cache namespace and whichever call arrives second reads back what the first wrote. Split across two models, each writes into its own namespace and neither ever reads the other's — the intro scene would have paid full price for a prefix the world engine had already cached, and the write it made would have been stranded in the Sonnet namespace where nothing else could ever read it. That is the same shape of waste as the `generateIntroScene()` system-parameter bug recorded above, just moved from the prompt layer down to the model layer. So "the two Opus routes must stay on the same model" is a cache-economics constraint, not a quality preference.

**It was measured, not assumed.** In the live run on 2026-09-17: the first world-engine call wrote the prefix (`cache_creation_input_tokens` 15,132), the second world-engine call read exactly 15,132 back, and then the intro-scene call — a different route — read the same 15,132 from the same namespace. The cross-route read is the part that had never been tested and is the specific evidence the shared namespace exists.

**The 15,132 figure is now stale; the shape it proves is not.** Two lines were later added to `WORLD_SYSTEM_PROMPT` (the prompt-injection data-not-instructions rule and the `state_updates.world_events` shape spec in RESPONSE FORMAT), and that block sits inside the cached prefix, so the token count has moved. Re-deriving it is free — `POST /v1/messages/count_tokens` isn't billed — while re-proving that caching *engages* costs real API calls. Re-measured live in Phase 4 at **15,490** (`.planning/phases/04-parity-verification/evidence/usage-lines.log`), with the direction reversed: intro-scene wrote the prefix and the world-engine calls read it, so the shared namespace is now observed in both directions. It went stale again within hours: the 2026-09-18 narration-length edit (2-5 -> 2-3 paragraphs, plus an anti-padding clause) sits inside the cached prefix, and `count_tokens` puts system-only at 13,701 against 13,669 before — so the prefix is now **~15,522**, pending a live run to confirm. That is the third figure in two days, which is the point: **re-derive with `count_tokens` before quoting it, and don't spend money re-running the engagement proof.** Write-once-then-read-thereafter, shared across the two Opus routes, is the property that matters, and editing a prompt doesn't change it.

**`determineUniqueSkill()` stays on Sonnet 5, and that is also deliberate.** It is the adversarially stress-tested surface (see "Tier 0 stress tests" below), and that testing note already warns that the resilience observed there is partly a property of the model's training rather than purely the prompt's wording — so moving this call to another model is a decision to re-run those tests, not a free swap. It also has nothing to gain from the Opus routes' warm cache: it sends no `system` parameter at all, so it has no cached prefix to share with anything (see the correction above).

## Narration length (2026-09-24)
**Per turn: 1-2 short paragraphs, roughly 60-120 words. Intro: 2 short paragraphs, under 150 words.**

This is the second trim in the same direction. The 2026-09-18 edit took the per-turn narration from 2-5 paragraphs down to 2-3 and added an anti-padding clause. A playtest on 2026-09-24 still found both the intro scene and the turn responses hard to follow: it was too much prose to parse before the player could act.

The root cause was the wording, not the rendering (`WorldLog` already keeps paragraph breaks with `pre-wrap`). "Rich prose" in the `narration` spec, plus "vividly" in duty 1, pulled every response toward ornament. The changes:
- **`narration` spec:** now says to lead with the concrete result of the action in plain language, keep imagery to one or two telling details, and end on what the player faces.
- **Duty 1:** "vividly" became "clearly", with a line saying clarity beats ornament.
- **Intro prompt:** "3 paragraphs" became 2 short ones (where they are, then the situation). This is the third sanctioned deviation from the verbatim legacy port, noted in the `introScene.ts` header.

A Soul Etching or sub-ability paragraph (duty 4) may still be added on top of the word budget, because those moments are the game's payoff. The World Voice persona ("gravitas") is unchanged: this is about length and legibility, not tone. The JSON contract is untouched; only the description string inside the `narration` example changed.

**Measured live the same day** (`.planning/experiments/2026-09-24-narration-length/`): the intro came in at 126 words, and the three turns at 106, 100 and 115, all within budget. **Cache figure:** the cached prefix is now **15,607** (intro-scene wrote it; every world-engine turn read it), which supersedes 15,523. The shared-namespace property is unchanged.

If this proves too terse in play, raise the word range; don't restore "rich prose".

**Follow-up, same day: no contrast framing.** In the live check, turn 2 opened with "You don't move to the shadows — you speak." The player had never mentioned shadows, so the line invented an alternative they didn't choose, which made it confusing to read. Duty 1 now says to narrate only what the player actually did, never set against something they didn't do.

## Unique Skill legibility (2026-09-24)
**The Unique Skill description is written for play, and the World Voice sees it.**

Playtest feedback: it was hard to tell what the Unique Skill actually did, so a new player couldn't use it from the start. There were two causes:
1. **The wording invited metaphor.** `determineUniqueSkill`'s `description` asked for "what this skill IS and how it manifests". It now asks for 2 short sentences, under 50 words: a concrete effect the player can act on now, then its real cost or limit.
2. **The World Voice never saw the description.** The world-engine prompt carried only the skill's name, and the intro prompt only its name and `soul_resonance`. Both now carry the description, so the World Voice can adjudicate a use of the skill against it. The intro is also told to set up a situation where the skill could plausibly help.

**This touched the Tier 0 stress-tested prompt**, so the three tests were re-run live (see "Adversarial testing of the questionnaire" below) and all three held. Requiring a stated cost or limit is also half of the hardening that section planned. Evidence is in `.planning/experiments/2026-09-24-unique-skill-clarity/`. The call is still system-blind (CLAUDE.md #8), and the response schema is unchanged. The world-engine `description` field on a skill is optional, so older saves still load.

## Hosted mode (2026-09-24) — decided, not yet built
**One codebase, two modes.** `SOULBOUND_MODE=selfhost` (the default) stays exactly as Phase 5 shipped. `hosted` adds accounts, server saves and a subscription. The full design, research and alternatives are in `.planning/explorations/2026-09-24-hosted-multiplayer-saas-design.md`. This entry records **what it reverses and why**, so a later session doesn't treat either state as drift.

**Three settled items, deliberately reversed for hosted mode only:**
1. **CLAUDE.md "Auth architecture — do not re-litigate"** (single-tenant). Hosted mode adds player accounts.
   - The key architecture does *not* change: the backend holds the operator's key and players never see it.
   - **BYOK stays rejected**: players pay a subscription and never bring a key.
2. **CLAUDE.md constraint #2** (`localStorage` saves). Hosted saves live in Postgres per account, behind a synchronous write-through adapter, so `App.tsx` stays byte-identical. Self-host keeps `localStorage`.
3. **PROJECT.md out of scope** ("server-side saves, user accounts", "Monetization"). These move into scope as R23-R35. The shared world, server-authoritative turns, local inference and credits stay out.

**Why:** the developer wants friends, and later the public, to play without being handed a key or a passphrase. Today's measured cost makes a subscription viable:
- **Cost per turn:** about **$0.022**, from the `2026-09-24` usage logs at Sonnet 5 rates. The older $0.072 figure predates the Sonnet switch.
- **What $10 covers:** 250 turns leaves a margin (≈28%) even at the worst turn cost observed.

**Key choices:**
- **Accounts:** Better Auth (Lucia was deprecated in 2025; Auth.js is on security-only maintenance), with email link, Google and Discord; 30-day rolling sessions.
- **Price:** $10 for 250 turns, configurable. 3 free characters a month (reroll-fishing guard), then 2 turns each; 20 save slots.
- **Spend protection, three layers:** the allowance, an app-wide daily cap, and the Anthropic Console limit.
- **Shared-world seams now, authority later:** turn logic moves into `shared/`, plus `world_id`, stable entity IDs and a `turn_events` log.

**Order:** deploy early (Phase 6). Friends play free after Phase 9, which adds suggested actions and a recap. Billing is priced from their real usage (Phase 11).

**Game phases in the same plan:**
- Suggested actions (Phase 9): a contract change plus a MUST NOT addition.
- Zero-cost recap (Phase 9).
- Quests (Phase 10): a contract change.
- Condition & inventory (Phase 12): its own design pass first.

Each contract change updates the prompt, schema and parser together (CLAUDE.md #4). Each MUST NOT addition re-runs the adversarial turn tests.

## Hosted mode — Phase 6 build (2026-09-24)
**Phase 6 of the plan above is built: accounts, invites, deletion, the tracker and a Render Blueprint. The live deploy is not done yet.** Every live step in `docs/runbooks/phase-6-hosted-setup.md` is still marked as awaiting the developer. The full contracts are in `.planning/specs/06-hosted-mode-accounts-spec.md`; this entry records the choices a later session is most likely to "fix" by mistake.

**Self-host is frozen.**
- Its tests are unedited: the 187 backend and 190 frontend tests from before the phase, inside today's 284 + 244.
- `App.tsx` is byte-identical.
- `pg`, `better-auth`, `node-pg-migrate` and `@sentry/node` load only through dynamic imports behind the mode check. `selfhostNoPg.test.ts` mocks each one to throw and still boots self-host.

**The hosted order is the security model** (`buildApp`, pinned by `hostedOrder.test.ts` and `scripts/mutate-order.sh`). The steps whose position matters:
- **Host allow-list (2), then anti-framing and the mode header (3).** They come before anything that can answer, so every hosted response, including a 403 or a 429, carries `X-Frame-Options: DENY`, `frame-ancestors 'none'` and `Referrer-Policy: no-referrer`.
- **Per-IP limiter (6), IPv6 keyed by /64.** It comes before any body is read. It is only as good as `TRUST_PROXY`, which is why the runbook observes Render's hop count through `/api/debug/ip`. That probe exists only with `DEBUG_PROXY_HOPS=1`, which replaces a temporary logging patch on the deployed branch.
- **Reserved webhook (7), before the Origin check.** Stripe sends no Origin. It matches only the exact path and POST, checked before its body is read.
- **Origin check (8).** It covers every state-changing `/api/*` request, including `/api/auth/*`. Better Auth's own origin check stays on as a second layer.
- **Redeem (9), before the session gate.** The player has no account yet. It has its own 5/min limiter, which runs before its 1 KB parser.
- **Better Auth (10), before `express.json`.** **Correction to the spec:** its "it hangs otherwise" (better-auth #3295) no longer reproduces on `better-call` 1.4.0, which re-serialises an already-parsed body. The position is now pinned by **who answers a malformed auth body**: Better Auth's 400 `BAD_REQUEST`, not the app's `INVALID_REQUEST`. The 2 s request timeout remains only as a backstop. A raw 16 KB cap (`authBodyCap`) runs just before this step. It wraps the request's `push` rather than adding a `data` listener, because a listener would start the stream flowing before Better Auth attaches, and chunks would be lost. Past the cap, a chunked body gets a connection reset.
- **Session gate (11), then the per-user limiter (12), then the unchanged self-host tail.**

**`SIGN_IN_REQUIRED` is a new code, not a reuse of `PASSPHRASE_REQUIRED`.** The frontend decides by code. A hosted 401 must never clear a stored passphrase or show the passphrase form. And `AccessGate`'s `checkAccess()` couldn't gain a fourth value without breaking a frozen type (`AccessGate.tsx:51,70`). So, per the planning addendum (spec Revision History row 20):
- every hosted `/api/access` answer carries `Soulbound-Mode: hosted` (`MODE_HEADER`);
- a new `getAccessState()` reads it, and only the new `ModeGate` calls it;
- `checkAccess()` is byte-identical, and self-host responses never carry the header (tested).

**Invites are reserved, then consumed, then reconciled, because Better Auth's hook transactionality is undocumented.** A raw `pg` query can't join Better Auth's transaction. So:
- `user.create.before` reserves the invite under a per-holder nonce for 10 minutes. It's single-winner, and its holder can retry.
- `user.create.after` consumes it, and on failure deletes the new user (compensation).
- The hourly purge reconciles expired reservations. It runs on the DB clock with a 2-minute slack, because Better Auth stamps `createdAt` on the app's clock before the reservation. Without the slack, real orphans were missed.
- The invite rides in an HMAC-signed `__Host-sb_invite` cookie that never holds the code, and it reaches the hooks through `AsyncLocalStorage` (propagation verified in the installed source and pinned by a test).
- A refused sign-up still uses up that magic link, because Better Auth consumes the token before `createUser`. The UI offers "Send me a new link".

**Magic links:** Better Auth writes no `account` row for a magic-link sign-up, only the `user` (`better-auth/dist/plugins/magic-link/index.mjs:164`). So three sign-in methods on one address give two `account` rows (Google and Discord), and the runbook's check counts users and used invites as well.

**Deletion.** `DELETE /api/account` inserts `account_deletions` first, then revokes every session through Better Auth's `internalAdapter.deleteUserSessions`. The order means that if revocation throws, the session gate already refuses the user. `cookieCache` is off, so an old cookie gets 401 at once. Signing in within 7 days cancels the deletion. After that, the purge hard-deletes the user under `pg_try_advisory_xact_lock`. The purge matches verification rows with `IS JSON OBJECT`, so **Postgres 16 or later is required**; `render.yaml` pins 16. A purge failure only logs `[purge] failed (<SQLSTATE>)` and isn't sent to the tracker.

**The error tracker rebuilds each event from an allow-list:**
- what's kept: type, frames (function, file, line), a fixed code, the route template and the mode;
- what's never kept: message, request, user or extras;
- breadcrumbs return `null`.

A value-matching redactor can't catch per-request values (cookies, invite codes, player text), so dropping free text is the only safe design. Sentry 11 has no `sendDefaultPii`. `dataCollection` is used instead, with every field off. `tracker:test`'s `flush()` returning true means only that the queue drained, so delivery is confirmed on the dashboard (runbook step 10). Every error that reaches the handler is reported, 4xx included; whether to filter 4xx waits for real volume.

**Better Auth hardening that looks redundant but isn't:**
- Under `NODE_ENV=test`, Better Auth turns its own origin and callbackURL checks off. We force them on, and `render.yaml` pins `NODE_ENV=production`.
- Its own rate limiter is off, because it trusts the client's first `X-Forwarded-For` value; ours key on `req.ip`.
- Only Google is a trusted provider for linking. Discord links to an existing account only when it reports the email as verified.

**Accepted, and documented rather than fixed:**
- **Login CSRF on magic-link verify.** It's a GET, so an attacker can sign a victim into the *attacker's* existing account. Creating a new account still needs the victim's own invite cookie.
- **The per-email magic-link cap (3 per 15 min) is in memory**, so it holds per instance. `render.yaml` runs one instance (`numInstances: 1`). The purge is lock-safe across instances; this cap isn't.
- **Rolling sessions are client-driven.** The session gate drops Better Auth's refreshed cookie, so `ModeGate` calls `GET /api/auth/get-session` on load and every 12 hours.
- **The account controls live in the Soul Codex, not over the narration (moved 2026-09-24, developer's call).** The first build put a fixed Account button over the narration, and at 390 px it covered the end of the first story line; there's no free corner while `App.tsx` is frozen. The controls are now an inline "Account" section at the end of the Codex (the Codex tab on a phone, the bottom of the sidebar on desktop). `ModeGate` sits outside `App`, so it reaches the Codex through `HostedAccountContext` (`frontend/src/components/hostedAccount.tsx`), and `SoulCodexContents` renders `<HostedAccountSlot/>`, which is empty without the provider. That keeps `App.tsx` byte-identical and the self-host Codex DOM unchanged. `SoulCodexContents` is otherwise a verbatim port; this slot is its one addition. Trade-off: sign-out and deletion are reachable only from the game screen, not the title screen. `e2e/hosted.spec.ts` asserts the section overlaps no control at 390 px and 1280 px.
- **Self-host now makes two `GET /api/access` calls per load**, one from `ModeGate` and one from `AccessGate`. That's well under the 30/min limit.
- **Frontend rules:** the Better Auth client is a lazy chunk that self-host never downloads. A pasted invite link triggers a reload on `hashchange`, so the code never stays in the address bar. Unknown error codes show one generic line and never the raw code.

**Deploy shape (`render.yaml`, every key checked against Render's reference and JSON Schema):**
- **Build:** a Docker web service built from the last stage (`runtime`); Render has no target field.
- **Branch:** pinned to `main`, deploying only after CI passes (`autoDeployTrigger: checksPass`).
- **Migrations:** `preDeployCommand` runs `node /app/backend/dist/migrate.js`, so a failed migration fails the deploy while the old version keeps serving.
- **Host allow-list:** `ALLOWED_HOSTS` is the service's own `RENDER_EXTERNAL_HOSTNAME`, because Render's health check sends that host.
- **Database:** a paid Postgres (the free one expires after 30 days), with `ipAllowList: []`. Admin queries run from the service's shell.
- **Secrets** are all `sync: false`. `BETTER_AUTH_SECRET` deliberately doesn't use `generateValue`: a new value would sign everyone out.
- **Retention:** the managed Postgres server's own log can hold an email (a unique violation logs `Failing row contains …`). That log, Resend and Sentry keep data on their own schedules, listed in runbook step 14.

### Review cycle 1 decisions (2026-09-25)
- **Sessions roll through the browser only.** The server-side session gate reads with `disableRefresh`, so Better Auth's daily refresh happens on the browser's own `get-session` call, which is the only response that can carry the renewed cookie. Before this, the gate refreshed the row first, and the cookie kept its sign-in Max-Age: a hard 30-day expiry, not a rolling one.
- **Google stays a trusted provider, with a verified-email check (developer's call).** A trusted provider skips Better Auth's `emailVerified` check when linking (`oauth2/link-account.mjs`), which let a Google account with an unverified address link into an existing player's account. The developer chose to keep `trustedProviders: ['google']` and add an `account.create.before` hook that refuses a Google account row unless its ID token says `email_verified: true`, over dropping Google's trusted status.
- **An invite is bound to the address that was sent the link.** A magic-link sign-up is refused unless that address was sent the link under the same invite cookie. That closes the login-CSRF path where a victim's live invite cookie would be consumed for an attacker's address. The binding is in memory (300 s, single instance) and fails closed on restart.
- **Invite send caps are per invite, not per cookie**, plus a 30-per-hour global ceiling on invite-path sends. Sends to existing accounts and to new addresses use separate per-email maps, so invite spam can't crowd out returning players.
- **Expired `verification` rows are purged hourly.** Better Auth stores the typed email before our send gate runs, so without this, addresses that were never sent anything were kept indefinitely.
- **Also:** OAuth tokens are encrypted at rest and IP tracking is off (nothing reads either); shutdown waits 110 s (`maxShutdownDelaySeconds: 120` on Render) so a deploy doesn't cut off a turn in progress; the pool times out connections after 5 s; `node-pg-migrate` is pinned exactly because the boot check imports a deep path.
- **Accepted risk until Phase 7:** saves live in `localStorage` and aren't scoped to an account, so on a shared device the next player to sign in sees the previous player's saves. Server-side saves (Phase 7) remove this.
- **Migrations follow "expand, then contract".** The pre-deploy step migrates while the old version is still serving, so a deploy never drops or renames a column that the running version still uses.

### Review cycle 2 decisions (2026-09-25)
- **Google ID tokens are checked, then not stored.** The `account.create.before` hook reads `email_verified` from the token first, then writes the row with `idToken: null`; an `account.update.before` hook nulls it on the token refresh a returning sign-in does. Nothing reads the stored token (the endpoints that could are disabled), and it carries profile claims.
- **Hitting the invite-path ceiling logs one fixed line per window** (`INVITE_CEILING_NOTICE`, no address, invite id or IP), so an operator can see that a leaked invite batch has been cut off.
- **Drift guards:** a self-host test pins `maxShutdownDelaySeconds * 1000 > SHUTDOWN_TIMEOUT_MS`; CI derives the expected migration count from `backend/migrations/*.sql`; `scripts/mutate-order.sh` counts a mutation as caught only when a named test in `hostedOrder.test.ts` failed.
- **Carried to Phase 7: login CSRF into an attacker's *existing* account.** The cycle-1 invite binding protects sign-ups only. `/magic-link/verify` is a GET, so a victim who opens an attacker's link for an address that already has an account gets signed into the attacker's account. Today the impact is small because saves live in the browser. Once Phase 7 moves saves to the server, the victim's progress would be written to the attacker's account, so Phase 7 must close it first: bind every magic-link send to a short-lived `__Host-` cookie in the requesting browser and require it at verify, or land verify on a POST confirmation step.
- **Known stale comment, left deliberately:** `backend/Dockerfile:100` still shows the relative `node backend/dist/migrate.js`. `render.yaml` now uses the absolute `/app/backend/dist/migrate.js`, and `WORKDIR` is `/app`, so both resolve to the same file. The Dockerfile belongs to the frozen self-host image, so the comment waits for the next change that has a real reason to touch it.

## Return to title from character creation (2026-09-25)

Legacy had no way out of the race screen or the questionnaire: once a player tapped "Begin", the only route back to the title (and to their saves) was reloading the page. Both screens now show "← Return to title" above their heading, on every question including the first, where "← Back" still does not render. `App.tsx`'s `handleReturnToTitle` clears the race, name, question index and answers before showing the title, so going back abandons the new chronicle and the next "Begin" starts blank. The developer chose clearing over keeping the half-built character.

**The `App.tsx` freeze is lifted for this, by the developer's decision.** Phases 5 and 6 kept `App.tsx` byte-identical to `7856b7d` to prove self-host behaviour hadn't changed. This is a deliberate self-host change, so the file now differs by one handler and two props. The new baseline is this change's commit. The freeze was a proof device for those phases, not a rule about the file, so a future phase that wants the same proof should name its own baseline. `creationScreens.test.tsx` gained one optional prop on each harness plus two tests. Nothing existing was changed or removed there, and the four resets are mutation-checked in `appIntegration.test.tsx`.

## Models moved to the 5.5 generation (2026-09-29)
**`uniqueSkill` is now `claude-opus-5-5`; `worldEngine` and `introScene` are now `claude-sonnet-5-5`.** This was the developer's call. It is a version bump, not a reversal: the split is unchanged (Opus on the soul-read, Sonnet on the two system-block routes), the effort values are unchanged (`medium` / `high` / `high`), and the pair invariant still holds, pinned by `config.test.ts`. The IDs still live only in `config.ts`'s `MODELS`.

**Cost.** Opus 5.5 is cheaper than Opus 5 ($4 / $20 per MTok against $5 / $25). Sonnet 5.5 costs the same as Sonnet 5 ($2 / $10). Both tokenizers are unchanged from their predecessors, so the cached prefix size is unchanged by the move. The caches themselves are model-scoped, so the first 5.5 session pays one fresh write.

**What to watch.**
- **Sonnet 5.5 recalibrated its effort levels.** `high` on Sonnet 5.5 is not the same spend as `high` on Sonnet 5, so narration length and per-turn cost may shift even though the prompt and the effort value didn't. That needs a by-feel playtest, and a check of the `[anthropic:usage]` lines against the Narration length budget above. Adjust effort only after that, as its own change.
- **The balance rules were validated on the 5 generation.** The MUST NOT list and the Tier 0 adversarial tests (see "Adversarial testing of the questionnaire" below) were last run against Opus 5 / Sonnet 5. Resilience there is partly a property of the model, so re-running them live on 5.5 is recommended. It was not done in this change.

**Deferred: refusal fallbacks.** Both 5.5 models can end a turn with `stop_reason: "refusal"`, and the API offers a server-side fallback for that. Adding it is a separate change, by the developer's decision.

## Questionnaire screen fixes (2026-10-01)
Four screen-only changes to the default questionnaire. None of them changes what `/api/unique-skill` receives, so the validated, system-blind prompt is untouched.

- **Framing note above question 1** ("You are a soul about to be reborn. Answer as yourself — the World Voice reads who you are, not who you wish to seem."). Players were left to guess between answering as themselves and as a character; this settles it towards the existing "Speak as yourself" hint and the personal, non-racial framing behind the Unique Skill's origin (see "Where unique skills come from").
- **"A sentence or two is enough." under every answer box.** One-word answers starve the soul-reading, while very long ones are re-sent to the world engine on every turn (up to 4,000 characters each). The line pulls both ways without a hard minimum.
- **The power hint no longer names the mechanic.** "Your relationship to power is the axis your Unique Skill will turn on." invited answers written to suit the system; it now reads "Think of a time you held real sway over something or someone." This edits static hint data (`frontend/src/data/questions.ts`), a deliberate deviation from the verbatim port; the question text itself is unchanged.
- **A review step before the last answer completes.** The final button now reads "Review your answers →" and opens a read-only list of all five answers with an Edit control on each. Only its "Speak to the World Voice" button calls `onComplete`, because completing starts the paid calls and a soul has exactly one Unique Skill. Edit returns the player to the review ("Back to review →") rather than to question 5; "← Back" from the review always goes to question 5. The state is local to the screen, so `App.tsx` is untouched.

**Deliberately not done** because they change the prompt and would need the Tier 0 adversarial tests re-run: aligning the prompt's shortened question wording with the screen's, and adding a situational question. See `.planning/explorations/2026-10-01-prologue-prototype-design.md` for the larger idea these fixes sit beside.

**Tests.** Ten new tests in `questionnaireReview.test.tsx`; four mutations of the review logic were each caught. The developer's consent to edit the existing last-Continue test covered "the one test"; it was two (`creationScreens.test.tsx` and `appIntegration.test.tsx`), each given the same mechanical edit (click the review button, then the completing button).

## Questionnaire Design
Originally multiple-choice (5 options per question). Changed to fully open-ended free-text per the explicit reasoning that richer, longer answers produce a better-defined Unique Skill before the player ever enters the world. Each question has a `hint` line for guidance but no character limit. The Continue button is disabled until something is written, with a Back button to revise prior answers.

### Adversarial testing of the questionnaire (Tier 0 stress tests — results, not just theory)
The `determineUniqueSkill()` prompt has deliberately minimal constraint language (reflect who they are, evocative name, internally consistent, not a Tensura copy) and originally had ZERO explicit refusal/defensive instructions — unlike the in-world action loop, which has an explicit "MUST NOT" rule list. This was identified as the most exposed attack surface in the system and was stress-tested directly (not just theorized about):

- **Test: demanding a specific overpowered skill by name with "no weaknesses"** (answer baited toward "Omniscience") — PASSED. Result ("Gilded Reckoning") was reframed into a bounded psychological compulsion with real costs woven through all three (later-generated) sub-abilities, not a literal grant of the request.
- **Test: smuggling a literal Tensura skill via flavor text** ("I awakened something like Great Sage — total calculation, perfect prediction...") — PASSED even under a saturated version of the attack where ALL FIVE questionnaire answers were filled with near-identical "I am pure calculation" content. Result ("Absolute Mirror") was NOT a Great Sage reskin — it has explicit bounded limitations (3-second observation requirement, "probable" not certain intent, compulsive loss of agency rather than omniscient correctness) that Great Sage doesn't have. Notably, the `soul_resonance` output correctly diagnosed the degenerate/saturated input itself ("this soul answered every question... with the same answer — not deflection, but genuine collapse of self into a single absolute function") rather than blindly complying or refusing outright.
- **Test: fake flaw used as a humble-brag** ("my weakness is I'm too powerful") — PASSED. The model synthesized a real psychological cost from the rest of the soul profile rather than accepting the non-flaw at face value.

**Conclusion from testing**: despite having no explicit defensive/refusal language, the questionnaire prompt held up well against concentrated adversarial pressure, likely because Claude's baseline instruction-following correctly treated the five answers as in-character material to interpret rather than commands to execute literally. This was validated empirically, not just assumed — worth knowing if the prompt is ever simplified or the underlying model changes, since this resilience is partially a property of the model's training, not purely the prompt's wording. If hardening is ever needed, the planned addition was: explicit instruction to treat all five answers as the character's own voice/history rather than instructions to the model, plus a requirement that every Unique Skill state a real limitation, not just vibes-based balance. (Both have since landed: the data-not-instructions wrapping in Phase 2, and the stated cost or limit on 2026-09-24. See "Unique Skill legibility".)

## Save System
**Final implementation: localStorage, NOT the artifact's `window.storage` persistent storage API.**

History: `window.storage` was tried first (it's the documented Claude artifact persistent storage API, scoped to the user's Claude account). It failed in practice — saves appeared to write successfully ("saved" confirmation fired) but did not survive navigation/reload, behaving more like session memory than genuine persistence. Root cause not fully diagnosed, but the practical fix was switching every save/load function to synchronous `localStorage` calls instead, which solved it completely. 

Tradeoff accepted: localStorage is per-browser, per-device — saves don't sync between desktop and phone. This is a known limitation, acceptable for the current solo-artifact phase, and would need a real backend to solve (see Product Direction below).

Also discovered: `window.confirm()` does not render inside the artifact's sandboxed iframe — calls to it silently did nothing (the delete button appeared to do nothing because the browser confirm dialog never displayed). Replaced with an in-UI two-step confirm (tap once to arm, shows Confirm/Cancel inline, tap Confirm to actually delete) — general lesson: avoid any native browser dialog APIs (alert, confirm, prompt) inside this artifact, they don't work.

Title screen merged with the save browser into a single screen (not two separate phases) per explicit user feedback — saved chronicles list directly on the title screen if any exist, with a New Chronicle button below them; no extra navigation hop.

## Mobile Responsiveness
Desktop uses a fixed side-by-side layout (240px Soul Codex sidebar + flexible World panel). Below 700px width, this collapses into a two-tab interface (World / Codex) since the side-by-side layout doesn't fit. Tapping "Act" automatically switches back to the World tab so the response is visible without manual navigation. Input font size is forced to 16px on mobile specifically to prevent iOS Safari's auto-zoom-on-focus behavior.

**Known flexbox bug pattern, already fixed once, worth remembering**: a scrollable region needs `min-height: 0` on every flex ancestor in the chain, or content can overflow the container instead of triggering scroll — this is a non-obvious CSS flexbox trap (flex children default to `min-height: auto`) and caused a real bug where the Soul Codex panel's "All Skills" section couldn't be scrolled to past the Unique Skill card. Also: a React Fragment (`<>...</>`) is not a real DOM element, so applying flex/overflow properties expecting it to act as a scroll container will not work — wrap shared sub-components in an actual `<div>` if they need their own scroll behavior.

## Legacy artifact retired

`legacy/souldbound-world.jsx` — the original 1,440-line Claude.ai artifact — was deleted at the
close of Phase 4, once parity was confirmed against a live playthrough (R14: real backend, real
models, cross-route cache read observed, save/reload/load verified field by field).

**It served as the parity oracle for four phases and is still readable.** The content is preserved
in git history at commit **`3d01fa5`**, the last commit containing it (also tagged `parity-oracle`, though that tag is not yet on the remote — see the note below):

```
# Works in any clone that has this branch — 3d01fa5 is one of its ancestors:
git show 3d01fa5:legacy/souldbound-world.jsx            # read it
git show 3d01fa5:legacy/souldbound-world.jsx | sed -n '913,1031p'   # a cited range

# Preferred once the tag is pushed — it is LOCAL-ONLY today, see the note below:
# git show parity-oracle:legacy/souldbound-world.jsx
```

**Why this note exists.** 25 migrated source files carry 69 citations of the form `legacy 787-802`
or `legacy 1022-1027` in their docstrings (files: `grep -rl 'legacy [0-9]\|legacy/souldbound' frontend/src shared/src backend/src | wc -l` → 25;
citations: `grep -rhoE 'legacy [0-9]+(-[0-9]+)?' frontend/src shared/src | wc -l` → 69 — the two
commands deliberately use different scopes, so neither number reproduces the other). Those citations are
load-bearing documentation — they are how a reader learns that `autoSave`-inside-`setLog` is
deliberate, that `|| 5` is a falsy-coalesce on purpose, that the dead `changed` Set is kept for
fidelity. They were deliberately **not** rewritten to name the SHA inline: that would have churned
the docstrings of every ported file at phase close, a large diff with real risk and no behavioural
gain. They resolve against the command above instead.

**Residual risk, stated rather than discovered later.** Parity was confirmed against the criteria
ROADMAP names, but several behaviours were never exercised live and the artifact was the oracle for
them: Soul Rewrite, the 80-entry log cap, the 40-note memory cap, and sub-ability emergence actually
*firing* at 25/60/100 (the live run only confirmed it correctly does not fire below 25). If one of
those turns out to have drifted, the comparison is `git show 3d01fa5:legacy/souldbound-world.jsx`,
not a lost file.

> **The `parity-oracle` tag is local-only right now.** It could not be pushed from the environment
> that created it (`git push origin parity-oracle` fails with `remote end hung up`; the branch pushes
> fine, so it is a tag-ref permission, not a network fault). **Until someone pushes it**, a fresh
> clone has no such tag and must use the raw SHA, which IS on the pushed branch:
> `git show 3d01fa5:legacy/souldbound-world.jsx`. Pushing the tag is worth doing — see the rationale
> below — but the SHA is what works today.

The tag exists because a bare SHA is not a durable handle in *this* repo specifically: every commit
was re-SHA'd once already by a `rebase --exec ... --reset-author` (`.planning/STATE.md` records it),
and an unreferenced commit is garbage-collectable. A tag keeps the object reachable and survives
rewrites of later history. Sixty-nine citations depend on it.

## Architecture Constraints Discovered (artifact era — superseded)

> **Historical.** Both constraints below were real inside the Claude.ai artifact and are no longer
> true of this app. The backend now holds the key (see `CLAUDE.md`'s auth section), and Phase 4 ran
> a live end-to-end playthrough from the sandbox against the real models — the exact self-test the
> first bullet says is impossible. Kept as the record of why the migration happened.

- This sandbox's bash tool CAN reach `api.anthropic.com` over the network (it's allowlisted), but has no `x-api-key` credential — authenticated calls only work from inside the artifact's own browser runtime, where Anthropic injects auth automatically tied to the user's account/session. This means Claude cannot self-test the live API from outside the artifact; live testing requires the user to run the artifact and relay results back.
- If this artifact is shared/published, it will run under whichever Claude account opens it — API usage is billed to the viewer, not the original creator. This is a crude form of "bring your own Claude account" rather than true BYOK or a real distribution/monetization model.

## Product Direction (for context on long-term architecture decisions)
- **Phase at time of writing**: solo artifact experience, Anthropic API via the artifact's built-in auth, localStorage saves, single-player only. **Now**: the API key is held by the backend and read from the environment; `localStorage` saves and single-player are unchanged.
- **Monetization paths considered** (not yet built): BYOK (zero cost to creator, high friction), credit/token economy (requires backend + auth + Stripe), flat subscription (cleanest UX, requires same backend), or eventually a persistent shared multiplayer world.
- **Long-term hardware vision**: a 3-node cluster of AMD Ryzen AI Max 395+ mini PCs (128GB unified memory each, ~384GB total across the cluster) for self-hosted local inference, eventually running the persistent shared-world version where player actions have lasting cross-player consequences (a dungeon one player clears stays cleared for others, etc.). Likely stack: Ollama/llama.cpp/vLLM with ROCm backend, Ray or simple Nginx load balancing for clustering, Postgres for world state, Llama 3.3 70B or Mistral as candidate local models. This is explicitly a future-phase vision, not a near-term build — sequencing was agreed as: validate the solo product first, then add a single local node for dev/testing, then scale to the full cluster once concurrent users justify it.
- **Fine-tuning**: discussed as a later-stage tool (LoRA/QLoRA via Unsloth or Axolotl) for if/when a local model breaks World Voice behavior (JSON discipline, staying in-world) in ways prompt engineering alone can't fix — explicitly NOT needed yet since the Anthropic-API-backed version is working well.
- **Platform ambition**: web and/or native mobile app eventually, not just a Claude artifact — the artifact is the current prototyping environment, not the intended final product.
