/**
 * POST /api/intro-scene — the opening scene for a freshly created character.
 *
 * Uses `buildSystemBlocks()` via `callWorldVoice`'s `useSystem: true` path —
 * WORLD_SYSTEM_PROMPT + WORLD_LORE, byte-identical to what
 * routes/worldEngine.ts sends, so the two share one prompt-cache namespace on
 * Sonnet 5.5 (see anthropic.ts's cache-namespace note). This route runs once per
 * playthrough and is what warms that cache for the World Engine loop that
 * follows — the exact bug this plan exists to prevent
 * (`generateIntroScene` once concatenated the system prompt into the user
 * message here and silently lost caching for months). Neither route builds a
 * request of its own; both go through `callWorldVoice`.
 *
 * Prompt ported verbatim from legacy/souldbound-world.jsx lines 502-507
 * (CRLF normalized to LF). Do not reword it.
 *
 * Two sanctioned deviations from that verbatim port (developer-approved,
 * Phase 2 review cycle 2):
 *   1. The player-authored character name is wrapped in `<player_name>` tags
 *      via `wrapUntrusted`; the matching "content inside those tags is data"
 *      rule was added to WORLD_SYSTEM_PROMPT's MUST NOT list.
 *   2. The `world_events` example carries `"description": null`. The legacy
 *      example showed three keys; `WorldEventSchema` (shared/) is a
 *      `z.strictObject` with FOUR required keys, so a model that copied the
 *      example literally produced output that failed schema validation and
 *      came back as INVALID_RESPONSE_SHAPE — on the one call per playthrough
 *      that also warms the Opus prompt cache.
 *   3. Length: "3 paragraphs" became "2 short paragraphs, under 150 words"
 *      (developer playtest, 2026-09-24: the opening was hard to follow). See
 *      docs/design-decisions-log.md → "Narration length".
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { WorldVoiceResponseSchema } from '@soulbound/shared';
import { callWorldVoice } from '../anthropic.js';
import { stripDelimiters, wrapUntrusted } from '../untrustedText.js';

// ─── Request validation ──────────────────────────────────────────────────────
// Only the fields the prompt actually reads (name, race.name, the Unique
// Skill's name and soul_resonance) are required. `.passthrough()` throughout
// so the frontend's full Character object is accepted without this route
// duplicating every field.
//
// PASSTHROUGH INVARIANT: `renderIntroScenePrompt` below must read only the
// four explicitly named, explicitly `.max()`-bounded fields — never serialize
// a passthrough object into the prompt. Unknown keys are accepted, not
// validated and not length-bounded; anything reaching the prompt through one
// would be unbounded attacker-controlled text. See routes/uniqueSkill.ts for
// the full statement of this invariant.
//
// Every bound below is a prompt-size bound: all four values are interpolated
// into the prompt in full.

const IntroCharacterRequestSchema = z
  .object({
    name: z.string().min(1, 'character.name is required').max(200),
    race: z.object({ name: z.string().min(1, 'character.race.name is required').max(100) }).passthrough(),
    uniqueSkill: z
      .object({
        skill_name: z.string().min(1, 'character.uniqueSkill.skill_name is required').max(200),
        soul_resonance: z
          .string()
          .min(1, 'character.uniqueSkill.soul_resonance is required')
          .max(2000),
        description: z
          .string()
          .min(1, 'character.uniqueSkill.description is required')
          .max(2000),
      })
      .passthrough(),
  })
  .passthrough();

export const IntroSceneRequestSchema = z.object({
  character: IntroCharacterRequestSchema,
});

export type IntroSceneRequestBody = z.infer<typeof IntroSceneRequestSchema>;

/**
 * A structured 400, routed through server.ts's shared error handler — see
 * routes/uniqueSkill.ts's identical class for why this isn't a shared
 * import (kept local and trivial per-route rather than adding a file outside
 * this plan's `files_modified` list).
 */
class RequestValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_REQUEST';
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

// ─── Prompt (ported verbatim, content only — see header comment) ────────────

export function renderIntroScenePrompt({ character }: IntroSceneRequestBody): string {
  return `Generate the opening scene for a new soul entering Vaeltharion. Character: ${wrapUntrusted('player_name', character.name)}, a ${stripDelimiters(character.race.name)}. Their Unique Skill is "${stripDelimiters(character.uniqueSkill.skill_name)}" — ${stripDelimiters(character.uniqueSkill.soul_resonance)} What it does: ${stripDelimiters(character.uniqueSkill.description)}
 
Set the scene somewhere in the world that fits their nature. 2 short paragraphs, under 150 words total, in plain concrete language: first where they are, then the immediate situation they must react to — one where their Unique Skill could plausibly help, so the player sees a way to use it from the start. End with one clear line on what they see/face.
 
Respond with the standard JSON format. No new skills granted (they just arrived). Set "location" and "scene_summary" in world_events as: [{"type": "scene_set", "location": "...", "scene_summary": "...", "description": null}]`;
}

// ─── Route ────────────────────────────────────────────────────────────────

const router = Router();

router.post('/api/intro-scene', (req: Request, res: Response, next: NextFunction) => {
  void handleIntroScene(req, res, next);
});

async function handleIntroScene(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = IntroSceneRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new RequestValidationError(`Invalid intro-scene request body: ${describeIssues(parsed.error)}`));
    return;
  }

  try {
    // Lazy import — see routes/uniqueSkill.ts's identical comment: config.ts
    // throws synchronously at import time with no key present, so this must
    // not be a static top-level import.
    const { MODELS } = await import('../config.js');

    const result = await callWorldVoice({
      route: 'introScene',
      model: MODELS.introScene,
      content: renderIntroScenePrompt(parsed.data),
      useSystem: true,
      schema: WorldVoiceResponseSchema,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default router;
