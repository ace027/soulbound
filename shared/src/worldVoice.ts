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
 * SCOPE — read this before relying on it.
 *
 * Comparing this list against WORLD_VOICE_JSON_SCHEMA catches drift between
 * the Zod schemas above and this array. Both are authored in THIS file, so
 * that is an internal self-consistency check, nothing more.
 *
 * It does NOT catch the drift CLAUDE.md constraint #4 actually cares about.
 * Nothing here reads WORLD_SYSTEM_PROMPT (backend/src/data/worldSystemPrompt.ts).
 * Renaming a field inside the prompt's RESPONSE FORMAT block alone leaves both
 * inputs below unchanged, so the check still reports clean while the live
 * prompt and the parser have silently diverged.
 *
 * It is also inert: nothing imports these exports, and there is no test yet
 * (tests are R16 / Phase 4). Today they run only if someone writes a script.
 *
 * Phase 2 is where the prompt and this schema first meet in a live code path,
 * and is where the real check belongs: parse the RESPONSE FORMAT JSON literal
 * out of WORLD_SYSTEM_PROMPT and assert its key set equals this list.
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
