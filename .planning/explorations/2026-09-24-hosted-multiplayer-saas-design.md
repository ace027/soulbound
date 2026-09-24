# Design Exploration — Hosted Soulbound: accounts, server saves and subscriptions

*Explored 2026-09-24; pricing refined the same day from live usage logs. Status: design only; no code written. Next step: add these as roadmap phases.*

## Initial Ask
> "Let's explore adding more phases and how this can be adapted to be deployed to multiple people, sort
> of like a SaaS platform."

## ⚠️ Decisions this reverses (deliberately)
Going hosted reopens three things the project had marked as settled. The developer chose this in this
exploration, with each reversal named. It is not drift.

| Settled item | Where it is recorded | What changes |
|---|---|---|
| "Auth architecture — RESOLVED, do not re-litigate": single-tenant self-hosting, one deployer, one key | `CLAUDE.md`, `docs/MIGRATION-PLAN.md` | **Stays true for self-host mode.** A second, **hosted** mode adds player accounts. The key architecture is unchanged in both modes: the backend holds the operator's Anthropic key and players never see it. Players pay a subscription; they do **not** bring their own key (BYOK stays rejected). |
| Hard constraint #2: saves use `localStorage` | `CLAUDE.md` #2, design log "Save System" | Still true in self-host mode. In hosted mode saves live in Postgres, per account. CLAUDE.md already calls this "a deliberate architecture change to plan for", and this is that plan. |
| Out of scope: "server-side saves, user accounts", "Monetization" | `.planning/PROJECT.md` | Move into scope for Phases 6-10. Multiplayer, Postgres world state and local inference stay out of scope. |

When implemented, each reversal gets a design-log entry and a CLAUDE.md edit **in the same change**,
matching how the model-split reversals were handled.

## Research Summary
- **Facts** (from this repo):
  - **Cost per turn: $0.016–$0.027, mean $0.022** (see "Pricing" below). Re-measured from the 2026-09-24 usage logs at current rates. The older $0.072 figure dates from when the world engine ran on Opus 5, before PR #4 moved it to Sonnet 5, and is superseded.
  - **Usage data already exists:** every call already logs `input_tokens`, `output_tokens` and the two cache counters (`anthropic.ts`). That is exactly the data a usage meter needs.
  - **Phase 5 built pieces hosted mode reuses:** one image that serves the frontend and API from the same origin, a per-client rate limiter, a pre-body-parsing gate slot in `buildApp()`, the `TRUST_PROXY` opt-in, and a GHCR image.
  - **Existing save format:** the save layer (`frontend/src/lib/saves.ts`) is small: 5 functions, synchronous `localStorage`. The JSON is a `SaveSlot` (`gameState`, `log` capped at 80, `savedAt`, `schemaVersion`), shared from `shared/src/gameState.ts`.
  - **`App.tsx` is byte-identical to the artifact port** and calls `writeSave` synchronously from inside a `setLog` updater, which is load-bearing. It has been protected since Phase 3.
  - **Previously noted monetization options:** BYOK, credits, subscription, and a shared world (design log → "Product Direction").
- **Inferences** (verify when planning):
  - **Prompt cache sharing:** caches are scoped to the Anthropic organization, not the end user. So all players would share one warm `WORLD_LORE` + `WORLD_SYSTEM_PROMPT` prefix (~15.6k tokens), and only the first call per TTL window pays the cache write. That makes cost per player *drop* as more people play, which helps the subscription math.
  - **Subscription math:** see "Pricing" below. At the real cost of ~$0.022/turn, $10 covers ~430 average turns, so a 250-turn allowance leaves a margin even for the heaviest players.
  - **Auth library:** an in-process library (candidate: Better Auth, which is open-source and TypeScript) keeps self-host mode free of third-party services. A hosted auth vendor would force a second auth path.
- **Assumptions:**
  - Friends-scale traffic at launch (tens of players), so a single small instance plus managed Postgres is enough.
  - Players accept a monthly turn allowance if the UI shows the remaining count.
  - Anthropic's Commercial Terms allow a paid consumer product built on the API. Verify the usage policy's consumer-facing requirements (age, disclosure) before launch.

## Product Definition
- **Target users:** invited friends first (tens of players), then a waitlisted public beta. Self-hosting deployers stay supported.
- **Primary outcome:** someone the developer invites can sign up, pay, and play on any device, with their saves following them, without the developer handing out a passphrase or an API key.
- **Value proposition:** the Soulbound experience with no setup, and with sustainable economics. The subscription covers inference plus a margin, and a turn allowance bounds the worst case.
- **Non-goals (this design):**
  - a shared persistent world or multiplayer interaction;
  - local inference or the cluster;
  - native mobile apps;
  - credits or top-ups (possible later);
  - organizations or teams;
  - moderation tooling beyond the World Voice's existing MUST NOT rules.

## Pricing (refined 2026-09-24)
**Chosen: $10/month for 250 world-engine turns.** Both numbers are configurable, not fixed in code, and get re-checked against real usage in Phase 8.

**Where the numbers come from.** These come from the live usage logs committed under `.planning/experiments/2026-09-24-*/usage-lines.log` (6 world-engine turns, 2 intro scenes, 10 unique-skill calls), priced at current API rates:
- **Rates:** Sonnet 5 at $2 in / $10 out per million tokens; Opus 5 at $5 / $25.
- **Cache:** 1-hour cache writes are billed at 2× input, cache reads at 0.1×.

| Item | Cost | Notes |
|---|---|---|
| World-engine turn (Sonnet 5, `high`) | **$0.016–$0.027, mean $0.022** | 70–80% is output. Only ~400 output tokens are narration + JSON; the rest (1,100–2,200 total) is adaptive thinking |
| Intro scene, cold cache | ~$0.07 | Includes the ~15.6k-token 1h cache write |
| Intro scene, warm cache | ~$0.02 | The cache is shared across all players on the operator's key |
| Unique-skill (Opus 5, `medium`) | ~$0.013 | No system blocks, so no cache (CLAUDE.md #8) |
| New character | ~$0.035 warm / ~$0.08 cold | |

**What the subscription covers.** $10 less Stripe's fees (2.9% + $0.30) leaves **$9.41**:

| | Cost | Margin |
|---|---|---|
| Player who uses all 250 turns, at the worst observed turn cost ($0.027) | $6.73 | ~28% |
| Same player, at the mean turn cost | $5.50 | ~42% |

Players who use less leave more. 250 turns is roughly 5–8 play sessions a month.

**Fixed costs.** Hosting at ~$20–30/month is covered once there are about 5 subscribers.

**Character creation (decided 2026-09-24).**
- **3 free new characters per account per month** (configurable). After that, each costs **2 turns**.
- Counting happens at the `/api/unique-skill` call, not when the intro completes. That call is where skill-fishing happens, and it is the Opus call.
- **Why:** free and unlimited rerolls would let players fish for a stronger Unique Skill, which works against "etched by nature" (design log → Skill Tier System) and the deliberate rarity of Soul Rewrite.
- **Worst-case cost:** 3 free cold-cache creations ≈ $0.24/month, well inside the margin.

**Save slots (decided 2026-09-24).** Up to **20 saved slots per account** (configurable). Branches made with "+ Slot" count toward the cap. A save is tens of KB, so the cap only bounds abuse.
- Hitting the cap shows an in-UI message, never a native dialog (CLAUDE.md #1).
- Autosave to an **existing** slot never fails because of the cap.

**Caveats.**
- The sample is small: n=6 turns, from one character.
- Turn cost grows with the size of the entity ledger and notes. Both are capped, but long playthroughs cost more per turn than a fresh one.
- Re-derive the numbers from the Phase 8 usage table after real play, before the public beta.

**Cost levers, not taken.** Each of these trades quality for cost; test it before using it.
- **Lower `effort` on world-engine.** Thinking is most of the output, so this is the biggest lever. It must change on intro-scene too, because the shared cache namespace also covers `output_config`, which is pinned by `config.test.ts`.
- **A cheaper model for "exhausted allowance" play.**
- **The 5-minute cache TTL** instead of 1 hour, once traffic is steady.

## Recommended Approach
**Balanced and phased: one codebase, two modes.**

`SOULBOUND_MODE=selfhost` (the default) behaves exactly as Phase 5 shipped: a passphrase, the operator's own key, and browser saves. `SOULBOUND_MODE=hosted` requires `DATABASE_URL`. It swaps the passphrase gate for session auth, moves saves to Postgres, meters usage per account, and gates paid calls on an active subscription with allowance left.

Everything is built into the existing Express + TypeScript stack, using an in-process auth library and Stripe-hosted billing pages. That means no vendor lock-in, and self-host mode keeps working with nothing new to run.

Why this approach over the alternatives:
- It reuses what Phase 5 built rather than replacing it.
- It keeps the settled key architecture intact in both modes.
- It ships in phases, each independently useful. It deploys in Phase 6 and invites friends free after Phase 8, so real usage data sets the price in Phase 9.

## Alternatives Considered
| Approach | Strengths | Tradeoffs | Decision |
|---|---|---|---|
| **Balanced, phased, two modes** | Reuses Phase 5; no lock-in; self-host survives; each phase ships | The most phases; two modes to test | **Chosen** |
| Minimal first (accounts + caps, no billing) | Fastest to "friends can play"; defers Stripe | You pay all inference until billing lands; billing becomes a separate project | Not chosen, but Phases 6-8 *are* this, so stopping early is always available |
| Buy the platform (Clerk/Supabase + Stripe) | Fastest build; hosted auth UI | Vendor lock-in and monthly cost; self-host would need a second auth path; less control over save semantics | Rejected |
| BYOK per player | Zero inference cost to you | High friction; already rejected in `MIGRATION-PLAN.md`; exposes players' keys to the browser | Rejected (unchanged) |
| Hosted-only (drop self-host) | One path to test | Throws away Phase 5's shipped image and deployer audience | Rejected by developer |

## Feature Scope
### MVP: Phases 6-10 (order decided 2026-09-24: deploy early, friends free first)
Every phase ships to the real hosted environment, so deployment risk isn't saved for last. Friends play free on the full 250-turn allowance before billing exists, so Phase 9 can price from their real usage rather than from 6 measured turns.

- [ ] **Phase 6, Hosted mode, accounts and a live skeleton:**
  - [ ] `SOULBOUND_MODE` flag and Postgres (migrations, `DATABASE_URL`).
  - [ ] Sign-in by email magic link, Google and Discord.
  - [ ] Sessions in httpOnly cookies, with CSRF protection.
  - [ ] Invite codes; account deletion.
  - [ ] Anti-framing header (now that there are logged-in sessions).
  - [ ] **Deployed** to the managed platform (Fly.io, Render or Railway) with managed Postgres, TLS, `TRUST_PROXY` set, and platform secrets. Only the developer is invited.
  - [ ] Self-host mode unchanged, proven by the existing suite plus the smoke test.
- [ ] **Phase 7, Server saves:**
  - [ ] `/api/saves` CRUD per account, stored as JSONB `SaveSlot` with `schemaVersion`.
  - [ ] A save adapter so `App.tsx` stays byte-identical.
  - [ ] A one-time "import your browser saves" offer.
  - [ ] Ownership checks on every save route.
  - [ ] The 20-slot cap.
  - [ ] **Daily Postgres backups plus a tested restore**, landing in the same phase, before anyone else's saves exist.
- [ ] **Phase 8, Metering and allowance, then invite friends free:**
  - [ ] A per-call usage ledger; the monthly turn allowance (250); the creation counter (3 free, then 2 turns).
  - [ ] Remaining turns shown in the UI; a per-user rate limit.
  - [ ] An operator cost view and a **daily-spend alert**.
  - [ ] Before inviting anyone: check Anthropic's usage-policy requirements for consumer apps, and show a short privacy notice at sign-up ("your in-game text is processed by Anthropic's API").
  - [ ] **Then invite friends, free**: the developer funds it, and all caps are enforced. Worst case is ~$7 per friend per month.
- [ ] **Phase 9, Subscription billing, priced from friends' usage:**
  - [ ] Re-derive cost per turn from the Phase 8 ledger, and confirm or adjust $10 / 250.
  - [ ] Stripe Checkout, the Customer Portal and signature-verified webhooks.
  - [ ] What happens when a payment fails or a subscription lapses.
  - [ ] No card data ever touches the server.
- [ ] **Phase 10, Launch hardening and conversion:**
  - [ ] Full Terms of Service and a privacy policy, replacing Phase 8's short notice.
  - [ ] Error monitoring; a restore drill re-run; CSP.
  - [ ] Move friends to paid, with notice.
  - [ ] Open a waitlist for the public beta.

### Later
- [ ] Top-up turn packs; annual plans; a free trial allowance.
- [ ] Public beta with a waitlist; abuse controls at larger scale.
- [ ] Shared persistent world. The per-account Postgres model is designed so world state can sit beside it.
- [ ] Local inference node or cluster (existing long-term vision).
- [ ] An anti-framing header and CSP. More pressing once strangers log in; already listed under "Not taken" in `05-REVIEW.md`.

## Experience / Workflow
1. A friend opens the invite link and signs in with an email link, Google or Discord. The invite code is consumed.
2. They go to Stripe Checkout, subscribe, and return to the game. The webhook activates the account and sets the monthly allowance.
3. If the browser holds saves from self-host play, a one-time prompt offers to import them.
4. The title screen lists server saves. Play works exactly as today; every turn autosaves to the server; remaining turns show in the Soul Codex.
5. When the allowance runs out, the next action shows an in-UI message (no native dialogs, per CLAUDE.md #1) saying when it resets. Their saves stay intact and loadable.
6. They manage or cancel through the Stripe Customer Portal. Deleting the account removes their saves and usage rows.

**Self-host deployers:** nothing changes. `SOULBOUND_MODE` defaults to `selfhost`.

## Technical Direction
- **Mode switch:** read once in `config.ts`, alongside the other env readers, and fail fast when an input is invalid. For example, `hosted` without `DATABASE_URL`, or with no Stripe secrets once Phase 9 lands. `buildApp()` picks which middleware to mount by mode. The middleware order stays load-bearing and tested (CODEBASE.md risk: "Middleware order is the security model").
- **Auth:**
  - An in-process library on Postgres; the candidate is Better Auth, to be verified at planning.
  - An email provider for magic links (e.g. Resend or Postmark), plus Google and Discord OAuth apps.
  - Cookies are `HttpOnly; Secure; SameSite=Lax`. This brings a **CSRF surface the Bearer-header design never had**: every state-changing route needs an origin check or a CSRF token.
  - The existing Host allow-list and CORS stay.
- **Data model (Postgres):**
  - `users`, `sessions` and `oauth_accounts` (owned by the auth library), plus `invites`.
  - `saves (id, user_id, slot jsonb, schema_version, updated_at)`.
  - `usage (id, user_id, route, model, input/output/cache_* tokens, cost_micros, created_at)`.
  - `subscriptions (user_id, stripe_customer_id, status, current_period_end, allowance_turns)`.
- **Saves without touching `App.tsx`:**
  - `lib/saves.ts` keeps its synchronous signature and becomes a thin router over two adapters.
  - The **local** adapter is today's code, with byte-identical keys.
  - The **server** adapter writes through to an in-memory/`localStorage` cache synchronously (so `writeSave` still returns at once, inside the `setLog` updater), then syncs to `/api/saves` in the background with a retry.
  - Conflicts: last write wins per slot, keyed on `savedAt`, which is acceptable for single-player.
- **Metering:**
  - Wrap `callWorldVoice`: before each call, check the allowance; after it, insert a usage row built from the response's `usage` fields.
  - Cost comes from a per-model price table kept in `config.ts`, like `MODELS`.
  - "Turns" counts world-engine calls. Character creation is metered separately (see Pricing → Character creation), and intro-scene calls are never charged on their own.
- **Billing:** Stripe Checkout + Customer Portal + webhooks (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`). The webhook route needs the **raw** body for signature checks, so it mounts before `express.json`, the same care Phase 5 took.
- **Unchanged guarantees:**
  - The World Voice JSON contract (#4), `max_tokens` (#5), the MUST NOT list (#6), and the lore/behaviour split (#7).
  - `determineUniqueSkill` stays system-blind (#8).
  - The model split and the shared cache namespace.
  - Player text stays wrapped as untrusted data.
- **Hosting:**
  - The existing `runtime` image on Fly.io, Render or Railway, with managed Postgres and platform TLS.
  - `TRUST_PROXY` is set to the platform's hop count, so the per-IP limiter sees real clients.
  - Secrets live in the platform's secret store.
  - Backups are daily, with a restore drill before the first paying user.
- **Testing:** the existing suite must stay green in self-host mode throughout. Hosted-mode tests run against a throwaway Postgres in CI (a service container), plus Stripe webhooks in test mode.

## Open Questions
- ~~**Price point and allowance size**~~ Settled 2026-09-24: **$10 / 250 turns**, configurable (see Pricing). Still to do: re-check against the Phase 8 usage table before the public beta.
- ~~**Does character creation count against the allowance?**~~ Settled 2026-09-24: 3 free per month, then 2 turns each; save slots capped at 20 (see Pricing).
- ~~**Pay from day one for friends?**~~ Settled 2026-09-24: friends play free after Phase 8, on the same 250-turn allowance, and move to paid in Phase 10 with notice.
- **Which auth library, and which email provider?** Verify Better Auth's Express + Postgres support and its magic-link and Discord support when planning Phase 6.
- **Anthropic usage-policy requirements for a consumer app** (age minimum, AI disclosure, content handling), and the ToS/privacy wording. Research at the end of Phase 8, **before inviting friends**, and record it in the design log. The full ToS comes in Phase 10.
- **How long to keep data after cancellation**, for saves and usage rows. Default proposal: saves kept 90 days read-only, then deleted; usage kept for accounting.
- **Anti-framing header / CSP:** make the call in Phase 6, since logged-in sessions raise the stakes of clickjacking.

## Start Input
Existing project, not a new one: add **Phases 6-10** to `.planning/ROADMAP.md` rather than running
`/legion:start`.

- **Goal:** a hosted, invite-only, subscription-funded Soulbound where players sign in (email link, Google or Discord), keep saves on the server, and play within a monthly turn allowance ($10/month for 250 turns, configurable; ~$0.022 per turn measured). The unchanged self-host mode stays alongside it.
- **Reversals to record:** CLAUDE.md's auth section (hosted mode added; key architecture unchanged; BYOK still rejected), constraint #2 (server saves in hosted mode), and PROJECT.md's out-of-scope list.
- **Phases** (deploy early, friends free first):
  - **6:** hosted mode, accounts and a live skeleton.
  - **7:** server saves, import and backups.
  - **8:** metering and allowance, then invite friends free.
  - **9:** Stripe billing, priced from friends' usage.
  - **10:** launch hardening and conversion to paid.
- **Stays out of scope:** shared world, local inference, native apps, credits.
- **First command:** `/legion:plan 6`, after this design is accepted and PROJECT.md/ROADMAP.md are updated.
