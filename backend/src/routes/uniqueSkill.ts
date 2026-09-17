/**
 * POST /api/unique-skill — soul-reading from the player's five questionnaire
 * answers into a single Unique Skill.
 *
 * CLAUDE.md constraint #8 / docs/design-decisions-log.md "Tier 0 stress
 * tests": this call is deliberately BOTH lore-blind AND system-blind. It
 * receives no `system` parameter at all — not merely no WORLD_LORE — because
 * the job here is soul-reading from the five questionnaire answers, not
 * world-consistency, and that keeps the call cheap, focused, and (per the
 * design log) resilient against adversarial prompting in a way that was
 * validated with the prompt wording below intact. This route passes
 * `useSystem: false` to `callWorldVoice` and relies entirely on that
 * helper's conditional spread to omit the `system` key from the request —
 * it never builds any request of its own (see anthropic.ts).
 *
 * Prompt content ported verbatim from legacy/souldbound-world.jsx lines
 * 385-418 (CRLF normalized to LF, matching how worldSystemPrompt.ts /
 * worldLore.ts were ported in plan 02-01 — see rendered-string diff proof in
 * this plan's report). Do not reword it.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { UniqueSkillDeterminationSchema } from '@soulbound/shared';
import { callWorldVoice } from '../anthropic.js';

// ─── Request validation ──────────────────────────────────────────────────────

const AnswersSchema = z.object({
  nature: z.string().min(1, 'answers.nature is required'),
  drive: z.string().min(1, 'answers.drive is required'),
  flaw: z.string().min(1, 'answers.flaw is required'),
  memory: z.string().min(1, 'answers.memory is required'),
  bond: z.string().min(1, 'answers.bond is required'),
});

/**
 * Only the fields the prompt actually reads (name, race.name, the five
 * answers) are required. `race` is validated with `.passthrough()` so the
 * frontend's full Race object (id, desc, intrinsic) is accepted without this
 * route needing to duplicate that shape — it only reads `race.name`, exactly
 * as legacy line 387 does.
 */
export const UniqueSkillRequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  race: z.object({ name: z.string().min(1, 'race.name is required') }).passthrough(),
  answers: AnswersSchema,
});

export type UniqueSkillRequestBody = z.infer<typeof UniqueSkillRequestSchema>;

/**
 * A structured 400, routed through server.ts's shared error handler (same
 * `statusCode` / `code` duck-typed shape `WorldVoiceCallError` uses) rather
 * than reaching the Anthropic API with malformed input.
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

export function renderUniqueSkillPrompt({ name, race, answers }: UniqueSkillRequestBody): string {
  return `You are determining the Unique Skill for a new soul entering Vaeltharion.
 
Character: ${name}, a ${race.name}
Soul Profile (in the player's own words):
Q — When faced with an unknown threat, what do you do and why?
A — ${answers.nature}
 
Q — What do you want from this world?
A — ${answers.drive}
 
Q — What is the worst thing about you?
A — ${answers.flaw}
 
Q — Tell me about the moment that made you who you are.
A — ${answers.memory}
 
Q — How do you feel about power, and what do you do with it?
A — ${answers.bond}
 
Based on this soul's nature, determine ONE Unique Skill. It must:
1. Reflect who they ARE, not what they want to be
2. Have a thematic name (2-3 words, evocative, not generic)
3. Be internally consistent with the soul profile
4. NOT be a copy of any Tensura skill — this is an original world
5. Do NOT invent sub-abilities — those are not generated now. They will emerge later, in play, shaped by how this soul actually acts in the world.
 
Respond ONLY with valid JSON, no markdown:
{
  "skill_name": "...",
  "tier": "Unique",
  "description": "A 2-sentence description of what this skill IS and how it manifests.",
  "soul_resonance": "1 sentence — why this soul carries this skill.",
  "etching_text": "The sensation of this skill crystallizing onto the soul — 2 sentences, visceral and poetic."
}`;
}

// ─── Route ────────────────────────────────────────────────────────────────

const router = Router();

router.post('/api/unique-skill', (req: Request, res: Response, next: NextFunction) => {
  void handleUniqueSkill(req, res, next);
});

async function handleUniqueSkill(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = UniqueSkillRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    next(new RequestValidationError(`Invalid unique-skill request body: ${describeIssues(parsed.error)}`));
    return;
  }

  try {
    // Lazy import for the same reason anthropic.ts's own config import is
    // lazy: config.ts reads ANTHROPIC_API_KEY at its own module top level and
    // throws synchronously with no key present. A static top-level
    // `import { MODELS } from '../config.js'` here would make this route
    // file — and therefore server.ts, which imports it — fail to load
    // without a key. Resolves through Node's normal module cache, so after
    // server.ts's own `main()` has already loaded config.js once, this is
    // effectively free.
    const { MODELS } = await import('../config.js');

    const result = await callWorldVoice({
      route: 'uniqueSkill',
      model: MODELS.uniqueSkill,
      content: renderUniqueSkillPrompt(parsed.data),
      useSystem: false,
      schema: UniqueSkillDeterminationSchema,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default router;
