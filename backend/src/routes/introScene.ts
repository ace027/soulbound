/**
 * POST /api/intro-scene — the opening scene for a freshly created character.
 *
 * Uses `buildSystemBlocks()` via `callWorldVoice`'s `useSystem: true` path —
 * WORLD_SYSTEM_PROMPT + WORLD_LORE, byte-identical to what
 * routes/worldEngine.ts sends, so the two share one prompt-cache namespace on
 * Opus 5 (see anthropic.ts's cache-namespace note). This route runs once per
 * playthrough and is what warms that cache for the World Engine loop that
 * follows — the exact bug this plan exists to prevent
 * (`generateIntroScene` once concatenated the system prompt into the user
 * message here and silently lost caching for months). Neither route builds a
 * request of its own; both go through `callWorldVoice`.
 *
 * Prompt ported verbatim from legacy/souldbound-world.jsx lines 502-507
 * (CRLF normalized to LF). Do not reword it.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { WorldVoiceResponseSchema } from '@soulbound/shared';
import { callWorldVoice } from '../anthropic.js';

// ─── Request validation ──────────────────────────────────────────────────────
// Only the fields the prompt actually reads (name, race.name, the Unique
// Skill's name and soul_resonance) are required. `.passthrough()` throughout
// so the frontend's full Character object is accepted without this route
// duplicating every field.

const IntroCharacterRequestSchema = z
  .object({
    name: z.string().min(1, 'character.name is required'),
    race: z.object({ name: z.string().min(1, 'character.race.name is required') }).passthrough(),
    uniqueSkill: z
      .object({
        skill_name: z.string().min(1, 'character.uniqueSkill.skill_name is required'),
        soul_resonance: z.string().min(1, 'character.uniqueSkill.soul_resonance is required'),
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
  return `Generate the opening scene for a new soul entering Vaeltharion. Character: ${character.name}, a ${character.race.name}. Their Unique Skill is "${character.uniqueSkill.skill_name}" — ${character.uniqueSkill.soul_resonance}
 
Set the scene somewhere in the world that fits their nature. 3 paragraphs. Give them an immediate situation to react to. End with a clear prompt for what they see/face.
 
Respond with the standard JSON format. No new skills granted (they just arrived). Set "location" and "scene_summary" in world_events as: [{"type": "scene_set", "location": "...", "scene_summary": "..."}]`;
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
