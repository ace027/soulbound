# Design Exploration — Hosted Soulbound: accounts, server saves and subscriptions

*Explored 2026-09-24. Status: design only; no code written. Next step: add these as roadmap phases.*

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
  - **Cost per turn:** last measured at **$0.063–$0.080, mean $0.072**. Creation costs ≈$0.15, most of it the one-time cache write. Output tokens are ≈80% of turn cost (`.planning/phases/04-parity-verification/evidence/usage-lines.log`). The 2026-09-24 narration cut shortened responses, so the current figure is probably lower, but it hasn't been re-measured.
  - **Usage data already exists:** every call already logs `input_tokens`, `output_tokens` and the two cache counters (`anthropic.ts`). That is exactly the data a usage meter needs.
  - **Phase 5 built pieces hosted mode reuses:** one image that serves the frontend and API from the same origin, a per-client rate limiter, a pre-body-parsing gate slot in `buildApp()`, the `TRUST_PROXY` opt-in, and a GHCR image.
  - **Existing save format:** the save layer (`frontend/src/lib/saves.ts`) is small: 5 functions, synchronous `localStorage`. The JSON is a `SaveSlot` (`gameState`, `log` capped at 80, `savedAt`, `schemaVersion`), shared from `shared/src/gameState.ts`.
  - **`App.tsx` is byte-identical to the artifact port** and calls `writeSave` synchronously from inside a `setLog` updater, which is load-bearing. It has been protected since Phase 3.
  - **Previously noted monetization options:** BYOK, credits, subscription, and a shared world (design log → "Product Direction").
- **Inferences** (verify when planning):
  - **Prompt cache sharing:** caches are scoped to the Anthropic organization, not the end user. So all players would share one warm `WORLD_LORE` + `WORLD_SYSTEM_PROMPT` prefix (~15.6k tokens), and only the first call per TTL window pays the cache write. That makes cost per player *drop* as more people play, which helps the subscription math.
  - **Subscription math:** $10/month, less Stripe's fees (≈2.9% + $0.30), leaves ≈$9.40. At ~$0.06/turn that covers ~150 turns, so the allowance needs to sit around 100–150 turns at that price, or the price rises.
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

## Recommended Approach
**Balanced and phased: one codebase, two modes.**

`SOULBOUND_MODE=selfhost` (the default) behaves exactly as Phase 5 shipped: a passphrase, the operator's own key, and browser saves. `SOULBOUND_MODE=hosted` requires `DATABASE_URL`. It swaps the passphrase gate for session auth, moves saves to Postgres, meters usage per account, and gates paid calls on an active subscription with allowance left.

Everything is built into the existing Express + TypeScript stack, using an in-process auth library and Stripe-hosted billing pages. That means no vendor lock-in, and self-host mode keeps working with nothing new to run.

Why this approach over the alternatives:
- It reuses what Phase 5 built rather than replacing it.
- It keeps the settled key architecture intact in both modes.
- It ships in phases, each independently useful. After Phase 7 you could invite friends on your own key, before billing exists, if you want feedback sooner.

## Alternatives Considered
| Approach | Strengths | Tradeoffs | Decision |
|---|---|---|---|
| **Balanced, phased, two modes** | Reuses Phase 5; no lock-in; self-host survives; each phase ships | The most phases; two modes to test | **Chosen** |
| Minimal first (accounts + caps, no billing) | Fastest to "friends can play"; defers Stripe | You pay all inference until billing lands; billing becomes a separate project | Not chosen, but Phases 6-8 *are* this, so stopping early is always available |
| Buy the platform (Clerk/Supabase + Stripe) | Fastest build; hosted auth UI | Vendor lock-in and monthly cost; self-host would need a second auth path; less control over save semantics | Rejected |
| BYOK per player | Zero inference cost to you | High friction; already rejected in `MIGRATION-PLAN.md`; exposes players' keys to the browser | Rejected (unchanged) |
| Hosted-only (drop self-host) | One path to test | Throws away Phase 5's shipped image and deployer audience | Rejected by developer |

## Feature Scope
### MVP: Phases 6-10
- [ ] **Phase 6, Hosted mode and accounts:**
  - [ ] `SOULBOUND_MODE` flag and Postgres (migrations, `DATABASE_URL`).
  - [ ] Sign-in by email magic link, Google and Discord.
  - [ ] Sessions in httpOnly cookies, with CSRF protection.
  - [ ] Invite codes, since the MVP is invite-only.
  - [ ] Account deletion.
  - [ ] Self-host mode unchanged, proven by the existing suite plus the smoke test.
- [ ] **Phase 7, Server saves:**
  - [ ] `/api/saves` CRUD per account, stored as JSONB `SaveSlot` with `schemaVersion`.
  - [ ] A save adapter so `App.tsx` stays byte-identical.
  - [ ] A one-time "import your browser saves" offer on first sign-in.
  - [ ] Ownership checks on every save route: one player can never read another's save.
- [ ] **Phase 8, Usage metering and allowance:**
  - [ ] A per-call usage ledger (tokens → cost), written from the usage data `anthropic.ts` already logs.
  - [ ] A monthly turn allowance, checked *before* each paid call and debited *after*.
  - [ ] Remaining turns shown in the UI.
  - [ ] A per-user rate limit in hosted mode, alongside the per-IP one.
  - [ ] An operator view of cost per user.
- [ ] **Phase 9, Subscription billing:**
  - [ ] Stripe Checkout for sign-up, and the Customer Portal to cancel or update a card.
  - [ ] Signature-verified webhooks drive the subscription state.
  - [ ] No card data ever touches the server.
  - [ ] What happens when a payment fails or a subscription lapses.
- [ ] **Phase 10, Hosted deployment and launch:**
  - [ ] Deploy to a managed platform (Fly.io, Render or Railway) with managed Postgres, `TRUST_PROXY` set for the platform proxy, and TLS.
  - [ ] Backups and a tested restore.
  - [ ] Error and cost monitoring, with an alert on daily spend.
  - [ ] Terms of Service and a privacy policy (player text goes to Anthropic).
  - [ ] Invite the first friends.

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
  - "Turns" counts world-engine calls only. Whether character creation (unique-skill + intro) counts is an open question below.
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
- **Price point and allowance size**, e.g. $10 for ~120 turns. Resolve with a fresh cost measurement after the narration cut: re-derive the per-turn cost from a live usage log in Phase 8.
- **Does character creation count against the allowance?** It costs ≈2 turns. Decide in Phase 8 planning.
- **Pay from day one for friends?** Friends could get a free allowance until Phase 9 lands. Decide at the Phase 7→8 boundary.
- **Which auth library, and which email provider?** Verify Better Auth's Express + Postgres support and its magic-link and Discord support when planning Phase 6.
- **Anthropic usage-policy requirements for a consumer app** (age minimum, AI disclosure, content handling), and the ToS/privacy wording. Research before Phase 10 and record it in the design log.
- **How long to keep data after cancellation**, for saves and usage rows. Default proposal: saves kept 90 days read-only, then deleted; usage kept for accounting.
- **Anti-framing header / CSP:** make the call in Phase 6, since logged-in sessions raise the stakes of clickjacking.

## Start Input
Existing project, not a new one: add **Phases 6-10** to `.planning/ROADMAP.md` rather than running
`/legion:start`.

- **Goal:** a hosted, invite-only, subscription-funded Soulbound where players sign in (email link, Google or Discord), keep saves on the server, and play within a monthly turn allowance. The unchanged self-host mode stays alongside it.
- **Reversals to record:** CLAUDE.md's auth section (hosted mode added; key architecture unchanged; BYOK still rejected), constraint #2 (server saves in hosted mode), and PROJECT.md's out-of-scope list.
- **Phases:**
  - **6:** hosted mode and accounts.
  - **7:** server saves and import.
  - **8:** usage metering and allowance.
  - **9:** Stripe subscription.
  - **10:** hosted deployment and launch.
- **Stays out of scope:** shared world, local inference, native apps, credits.
- **First command:** `/legion:plan 6`, after this design is accepted and PROJECT.md/ROADMAP.md are updated.
