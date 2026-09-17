/**
 * POST /api/world-engine — the live simulation loop. One player action in,
 * one World Voice turn out.
 *
 * Uses `buildSystemBlocks()` via `callWorldVoice`'s `useSystem: true` path —
 * WORLD_SYSTEM_PROMPT + WORLD_LORE, byte-identical to what
 * routes/introScene.ts sends, so the two share one prompt-cache namespace on
 * Opus 5 (see anthropic.ts's cache-namespace note). Neither route builds a
 * request of its own; both go through `callWorldVoice`.
 *
 * User-content assembly ported verbatim from legacy/souldbound-world.jsx
 * lines 446-499 (CRLF normalized to LF). The two spots where this file adds
 * `?.` that the legacy plain-JS version didn't need are noted inline — they
 * are TypeScript strict-null-check accommodations only, not wording changes:
 * both are reached exclusively inside a branch that has already proven the
 * optional value is present, so the rendered STRING is byte-identical either
 * way (see this plan's rendered-string diff proof).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { SkillTierSchema, WorldVoiceResponseSchema } from '@soulbound/shared';
import { callWorldVoice } from '../anthropic.js';

// ─── Request validation ──────────────────────────────────────────────────────
// Mirrors the GameState shape (shared/src/gameState.ts) closely enough to
// type the render function below, but only requires what
// legacy/souldbound-world.jsx lines 446-499 actually read. `.passthrough()`
// throughout so the frontend's full GameState object (save metadata, etc.)
// is accepted without this route duplicating every field.

const SkillRequestSchema = z
  .object({
    name: z.string().min(1),
    tier: SkillTierSchema,
    mastery: z.number(),
    /** Unique Skill only — legacy line 458 / 467-468. */
    sub_abilities: z.array(z.object({ name: z.string() }).passthrough()).optional(),
    usage_notes: z.array(z.string()).optional(),
  })
  .passthrough();

const CharacterRequestSchema = z
  .object({
    name: z.string().min(1, 'gameState.character.name is required'),
    race: z.object({ name: z.string().min(1, 'gameState.character.race.name is required') }).passthrough(),
    answers: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const NarrativeEntityRequestSchema = z
  .object({
    name: z.string(),
    description: z.string(),
  })
  .passthrough();

const NarrativeMemoryRequestSchema = z
  .object({
    entities: z.record(z.string(), NarrativeEntityRequestSchema).optional(),
    notes: z.array(z.string()).optional(),
  })
  .passthrough();

const GameStateRequestSchema = z
  .object({
    character: CharacterRequestSchema,
    skills: z.array(SkillRequestSchema),
    location: z.string(),
    currentScene: z.string(),
    actionHistory: z.array(z.string()),
    narrativeMemory: NarrativeMemoryRequestSchema.optional(),
  })
  .passthrough();

export const WorldEngineRequestSchema = z.object({
  action: z.string().min(1, 'action is required'),
  gameState: GameStateRequestSchema,
});

export type WorldEngineRequestBody = z.infer<typeof WorldEngineRequestSchema>;

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

export function renderWorldEnginePrompt({ action, gameState }: WorldEngineRequestBody): string {
  const uniqueSkill = gameState.skills.find((s) => s.tier === 'Unique');
  const answers = gameState.character.answers || {};

  return `
CURRENT CHARACTER STATE:
Name: ${gameState.character.name}
Race: ${gameState.character.race.name}
Location: ${gameState.location}
Scene: ${gameState.currentScene}
 
SKILLS:
${gameState.skills.map(s => `- [${s.tier}] ${s.name} (Mastery: ${s.mastery}/100)${s.sub_abilities?.length ? " | Unlocked sub-abilities: " + s.sub_abilities.map(sa => sa.name).join(", ") : ""}`).join("\n")}
 
${uniqueSkill ? `UNIQUE SKILL SOUL PROFILE (for sub-ability consistency, reference only — do not re-grant or alter the base skill):
- Threat response: ${answers.nature || "unknown"}
- Core drive: ${answers.drive || "unknown"}
- Central flaw: ${answers.flaw || "unknown"}
- Defining memory: ${answers.memory || "unknown"}
- Relationship to power: ${answers.bond || "unknown"}
 
UNIQUE SKILL RECENT USAGE LOG (how "${uniqueSkill.name}" has actually been exercised — use this to shape any sub-ability that emerges this turn):
${(uniqueSkill.usage_notes || []).slice(-8).join("\n") || "(no notable usage yet)"}
` : ""}
 
KNOWN ENTITIES (named NPCs/places/factions already encountered — reuse these names and traits exactly, do not contradict or duplicate):
${Object.keys(gameState.narrativeMemory?.entities || {}).length
  ? Object.values(gameState.narrativeMemory?.entities ?? {}).map(e => `- ${e.name}: ${e.description}`).join("\n")
  : "(none yet)"}
 
STORY SO FAR (standing notes on things that happened outside the last 5 actions — treat as established fact):
${(gameState.narrativeMemory?.notes || []).length
  ? (gameState.narrativeMemory?.notes ?? []).join("\n")
  : "(nothing notable recorded yet)"}
 
ACTION HISTORY (last 5):
${gameState.actionHistory.slice(-5).join("\n")}
 
PLAYER ACTION: ${action}`;
}

// ─── Route ────────────────────────────────────────────────────────────────

const router = Router();

router.post('/api/world-engine', (req: Request, res: Response, next: NextFunction) => {
  void handleWorldEngine(req, res, next);
});

async function handleWorldEngine(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = WorldEngineRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new RequestValidationError(`Invalid world-engine request body: ${describeIssues(parsed.error)}`));
    return;
  }

  try {
    // Lazy import — see routes/uniqueSkill.ts's identical comment: config.ts
    // throws synchronously at import time with no key present, so this must
    // not be a static top-level import.
    const { MODELS } = await import('../config.js');

    const result = await callWorldVoice({
      route: 'worldEngine',
      model: MODELS.worldEngine,
      content: renderWorldEnginePrompt(parsed.data),
      useSystem: true,
      schema: WorldVoiceResponseSchema,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default router;
