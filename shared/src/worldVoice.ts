/**
 * The World Voice response contract.
 *
 * This module is the SINGLE place any World Voice field name is written.
 *
 * Why it exists: CLAUDE.md constraint #4 requires that the system prompt and the
 * frontend parser never drift apart. In the artifact that was enforced by
 * discipline alone, and the codebase has a history of exactly this failure mode —
 * `generateIntroScene` once concatenated the system prompt into the user message
 * and silently lost prompt caching for months.
 *
 * Mechanism: the Zod schemas below are authoritative. TypeScript types are
 * derived from them via `z.infer`, and the JSON Schema handed to the Anthropic
 * API's `output_config.format` is derived from them via `z.toJSONSchema`.
 * A field therefore cannot exist in the type but not the schema, or vice versa.
 *
 * Zod (rather than build-time type→schema generation) was chosen because it
 * produces both projections at runtime from one declaration, with no build step
 * ordering to get wrong, and gives the backend a runtime validator for free.
 *
 * Field names below are copied from WORLD_SYSTEM_PROMPT's RESPONSE FORMAT block
 * (legacy/souldbound-world.jsx lines 174-216) and cross-checked against
 * CLAUDE.md constraint #4. Do not rename anything here without changing the
 * prompt in the same commit.
 *
 * Nullability note: the prompt instructs the model to emit explicit `null` for
 * absent values (`"unique_sub_ability_unlocked": null`, `"note": null`) and to
 * "always include the full JSON structure". These are therefore modelled as
 * required-and-nullable, not optional. That also matches what strict structured
 * outputs want: every property present in `required`, absence expressed as null.
 */

import { z } from 'zod';

// ─── Skill tiers ────────────────────────────────────────────────────────────
// Must stay in sync with TIER_STYLE's keys (legacy lines 525-531).

export const SkillTierSchema = z.enum([
  'Intrinsic',
  'Common',
  'Extra',
  'Unique',
  'Ultimate',
]);
export type SkillTier = z.infer<typeof SkillTierSchema>;

// ─── state_updates.skill_mastery_changes ────────────────────────────────────

export const SkillMasteryChangeSchema = z.strictObject({
  skill_name: z.string(),
  tier: SkillTierSchema,
  old_mastery: z.number(),
  new_mastery: z.number(),
  /** Optional flavour reason. Appended to a Unique Skill's usage_notes. */
  note: z.string().nullable(),
});
export type SkillMasteryChange = z.infer<typeof SkillMasteryChangeSchema>;

// ─── state_updates.new_skills_granted ───────────────────────────────────────

export const NewSkillGrantedSchema = z.strictObject({
  skill_name: z.string(),
  tier: SkillTierSchema,
  mastery: z.number(),
  description: z.string(),
  /** Rendered as the Soul Etching callout in the world log. */
  soul_etching_text: z.string(),
});
export type NewSkillGranted = z.infer<typeof NewSkillGrantedSchema>;

// ─── state_updates.skill_evolutions ─────────────────────────────────────────
// A Soul Rewrite is the case where old_tier === "Unique" && new_tier === "Unique".
// Gated hard in the prompt: never on request, never as a combat or mastery
// reward, and it always costs something. See docs/design-decisions-log.md.

export const SkillEvolutionSchema = z.strictObject({
  old_name: z.string(),
  new_name: z.string(),
  old_tier: SkillTierSchema,
  new_tier: SkillTierSchema,
  description: z.string(),
  /** Only meaningful on a Soul Rewrite; null on an ordinary evolution. */
  rewrite_narrative: z.string().nullable(),
});
export type SkillEvolution = z.infer<typeof SkillEvolutionSchema>;

// ─── state_updates.unique_sub_ability_unlocked ──────────────────────────────
// Populated ONLY when Unique Skill mastery crosses 25/60/100 for the first
// time. Never pre-generated at character creation — that was a deliberate
// redesign, see docs/design-decisions-log.md "Sub-Ability Emergence".

export const UniqueSubAbilitySchema = z.strictObject({
  name: z.string(),
  unlock_mastery: z.number(),
  description: z.string(),
  emergence_text: z.string(),
});
export type UniqueSubAbility = z.infer<typeof UniqueSubAbilitySchema>;

// ─── state_updates.world_events ─────────────────────────────────────────────
// The only event type the frontend consumes is "scene_set", which carries
// location and scene_summary (legacy lines 1003-1007, 888-894). The shape is
// kept permissive enough that other event types can be emitted with a
// description without failing strict schema validation.

export const WorldEventSchema = z.strictObject({
  type: z.string(),
  location: z.string().nullable(),
  scene_summary: z.string().nullable(),
  description: z.string().nullable(),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;

// ─── state_updates ──────────────────────────────────────────────────────────

export const StateUpdatesSchema = z.strictObject({
  skill_mastery_changes: z.array(SkillMasteryChangeSchema),
  new_skills_granted: z.array(NewSkillGrantedSchema),
  skill_evolutions: z.array(SkillEvolutionSchema),
  unique_sub_ability_unlocked: UniqueSubAbilitySchema.nullable(),
  world_events: z.array(WorldEventSchema),
});
export type StateUpdates = z.infer<typeof StateUpdatesSchema>;

// ─── narrative_memory_updates ───────────────────────────────────────────────
// The entity ledger + rolling notes that keep NPCs and history from drifting
// across the stateless World Engine calls. Notes are capped at 40 by the
// frontend merge, not here.

export const NarrativeEntitySchema = z.strictObject({
  name: z.string(),
  description: z.string(),
});
export type NarrativeEntity = z.infer<typeof NarrativeEntitySchema>;

export const NarrativeMemoryUpdatesSchema = z.strictObject({
  new_entities: z.array(NarrativeEntitySchema),
  /** One short sentence worth remembering long-term, or null on most turns. */
  note: z.string().nullable(),
});
export type NarrativeMemoryUpdates = z.infer<typeof NarrativeMemoryUpdatesSchema>;

// ─── The full World Voice response ──────────────────────────────────────────

export const WorldVoiceResponseSchema = z.strictObject({
  narration: z.string(),
  state_updates: StateUpdatesSchema,
  narrative_memory_updates: NarrativeMemoryUpdatesSchema,
  /** Short out-of-character note when a world or rules point needs flagging. */
  gm_note: z.string().nullable(),
});
export type WorldVoiceResponse = z.infer<typeof WorldVoiceResponseSchema>;

// ─── determineUniqueSkill response ──────────────────────────────────────────
// A separate, smaller contract. This call deliberately sends NO system blocks
// at all — not merely no WORLD_LORE. See CLAUDE.md constraint #8. Its prompt is
// the adversarially stress-tested surface (docs/design-decisions-log.md,
// "Tier 0 stress tests"); leave its shape alone.
//
// sub_abilities are explicitly NOT generated here. They emerge in play.

export const UniqueSkillDeterminationSchema = z.strictObject({
  skill_name: z.string(),
  tier: z.literal('Unique'),
  description: z.string(),
  soul_resonance: z.string(),
  etching_text: z.string(),
});
export type UniqueSkillDetermination = z.infer<
  typeof UniqueSkillDeterminationSchema
>;

// ─── JSON Schemas for output_config.format ──────────────────────────────────
// Derived, never hand-written. Phase 2's routes pass these to the Anthropic
// Messages API as `output_config: { format: { type: 'json_schema', schema } }`.
//
// `io: 'input'` makes z.toJSONSchema emit the pre-parse shape, which is what we
// want: it describes what the model must produce. Zod object schemas are
// an explicit additionalProperties:false;
// `additionalProperties: false` and a complete `required` list — both of which
// strict structured-output validation depends on.

function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
}

export const WORLD_VOICE_JSON_SCHEMA = toStrictJsonSchema(
  WorldVoiceResponseSchema,
);

export const UNIQUE_SKILL_JSON_SCHEMA = toStrictJsonSchema(
  UniqueSkillDeterminationSchema,
);

/**
 * The nine field names CLAUDE.md constraint #4 names, as authored.
 *
 * This is the reference list all three arms of the contract check agree on:
 * the Zod schemas above, the derived JSON Schema, and the RESPONSE FORMAT
 * block inside WORLD_SYSTEM_PROMPT.
 *
 * `assertWorldVoiceContract(promptText)` compares all three and throws on any
 * mismatch. The backend calls it at startup, so drift fails the process
 * immediately rather than surfacing later as a confusing parse failure.
 *
 * The prompt arm is the one that matters. Comparing the schema against this
 * array alone proves only that this file is self-consistent — both are
 * authored here. Renaming a field inside the prompt is the drift CLAUDE.md
 * constraint #4 exists to prevent, and only the prompt arm catches it.
 */
export const CONTRACT_FIELD_NAMES = [
  'narration',
  'state_updates.skill_mastery_changes',
  'state_updates.new_skills_granted',
  'state_updates.skill_evolutions',
  'state_updates.unique_sub_ability_unlocked',
  'state_updates.world_events',
  'narrative_memory_updates.new_entities',
  'narrative_memory_updates.note',
  'gm_note',
] as const;

/**
 * Pulls the example JSON object out of WORLD_SYSTEM_PROMPT's RESPONSE FORMAT
 * section and returns its contract field paths.
 *
 * Takes the prompt as an argument rather than importing it, so this package
 * stays free of any dependency on backend/ and there is no import cycle.
 *
 * Throws if the block cannot be located or parsed — that is itself a contract
 * failure worth failing on, since it means the prompt no longer states the
 * response shape in a form anything can check.
 */
export function extractPromptContractFieldPaths(promptText: string): string[] {
  const marker = '### RESPONSE FORMAT:';
  const markerAt = promptText.indexOf(marker);
  if (markerAt === -1) {
    throw new Error(
      `World Voice contract check: "${marker}" not found in WORLD_SYSTEM_PROMPT. ` +
        'The prompt no longer declares its response shape where the contract check can read it.',
    );
  }

  // Brace-match forward from the first '{' after the marker. The example is a
  // real JSON object, so a depth counter that ignores braces inside strings is
  // enough — no JSON5 or comment handling needed.
  const start = promptText.indexOf('{', markerAt);
  if (start === -1) {
    throw new Error('World Voice contract check: no JSON object follows the RESPONSE FORMAT marker.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < promptText.length; i++) {
    const ch = promptText[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error('World Voice contract check: unbalanced braces in the RESPONSE FORMAT example.');
  }

  const raw = promptText.slice(start, end + 1);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      'World Voice contract check: the RESPONSE FORMAT example is not valid JSON. ' +
        `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const paths: string[] = [];
  for (const key of Object.keys(parsed)) {
    const value = parsed[key];
    if (
      (key === 'state_updates' || key === 'narrative_memory_updates') &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      for (const nested of Object.keys(value as Record<string, unknown>)) {
        paths.push(`${key}.${nested}`);
      }
    } else {
      paths.push(key);
    }
  }
  return paths;
}

/**
 * THE contract check: asserts the live prompt, the derived JSON Schema, and
 * CONTRACT_FIELD_NAMES all name the same nine fields.
 *
 * This is what CLAUDE.md constraint #4 actually requires — that the prompt and
 * the parser cannot drift apart. Comparing the schema against
 * CONTRACT_FIELD_NAMES alone only proves this file is self-consistent; it is
 * the prompt arm that makes the check meaningful.
 *
 * The backend calls this at startup, so a mismatch fails the process
 * immediately rather than surfacing as a confusing parse error mid-game.
 */
export function assertWorldVoiceContract(promptText: string): void {
  const expected: string[] = [...CONTRACT_FIELD_NAMES].sort();
  const fromSchema = extractContractFieldPaths(WORLD_VOICE_JSON_SCHEMA).sort();
  const fromPrompt = extractPromptContractFieldPaths(promptText).sort();

  const problems: string[] = [];

  const diff = (label: string, actual: string[]): void => {
    const missing = expected.filter((f) => !actual.includes(f));
    const extra = actual.filter((f) => !expected.includes(f));
    if (missing.length || extra.length) {
      problems.push(
        `${label}: ` +
          (missing.length ? `missing [${missing.join(', ')}] ` : '') +
          (extra.length ? `unexpected [${extra.join(', ')}]` : ''),
      );
    }
  };

  diff('derived JSON Schema', fromSchema);
  diff('WORLD_SYSTEM_PROMPT RESPONSE FORMAT block', fromPrompt);

  if (problems.length) {
    throw new Error(
      'World Voice JSON contract drift detected (CLAUDE.md constraint #4).\n' +
        `Expected fields: [${expected.join(', ')}]\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\nThe prompt and the parser must be changed in the same commit. ' +
        'Fix shared/src/worldVoice.ts and backend/src/data/worldSystemPrompt.ts together.',
    );
  }
}

/**
 * Walks a derived JSON Schema and returns the dotted paths of the contract
 * fields, for comparison against CONTRACT_FIELD_NAMES. Only descends into the
 * two nested contract objects; array element shapes are not part of the
 * constraint #4 list.
 */
export function extractContractFieldPaths(
  schema: Record<string, unknown>,
): string[] {
  const paths: string[] = [];
  const props = schema.properties as Record<string, unknown> | undefined;
  if (!props) return paths;

  for (const key of Object.keys(props)) {
    const child = props[key] as Record<string, unknown> | undefined;
    const childProps = child?.properties as
      | Record<string, unknown>
      | undefined;
    if (childProps && (key === 'state_updates' || key === 'narrative_memory_updates')) {
      for (const nested of Object.keys(childProps)) {
        paths.push(`${key}.${nested}`);
      }
    } else {
      paths.push(key);
    }
  }
  return paths;
}
