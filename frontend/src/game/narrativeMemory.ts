/**
 * The entity-ledger + rolling-notes merge, in ONE place.
 *
 * Why this is its own module: the merge used to live inline inside
 * `applyWorldUpdate`, which meant only the per-turn path had it. Character
 * creation built its initial `GameState` with a hardcoded
 * `narrativeMemory: { entities: {}, notes: [] }` and dropped the intro
 * scene's `narrative_memory_updates` on the floor — even though
 * `/api/intro-scene` returns a full `WorldVoiceResponse` and the model is
 * told (WORLD_SYSTEM_PROMPT, NARRATIVE MEMORY section) to record any named
 * NPC, place or faction it introduces.
 *
 * The consequence was not a merely empty ledger. `renderWorldEnginePrompt`
 * interpolates the ledger as a positive assertion:
 *
 *     KNOWN ENTITIES (...): (none yet)
 *
 * So on the first turn the model was told, as ground truth, that the NPC the
 * intro scene had just put in front of the player did not exist. Observed
 * live on 2026-09-19: an intro scene introduced "the Ledger-Warden", and the
 * next turn answered "There is no warden here", with a gm_note blaming the
 * player for fabricating an NPC "not present in the established scene". The
 * turn after that doubled down — "none was ever standing in this yard".
 * Evidence: `.planning/experiments/2026-09-19-cache-ttl-break/`.
 *
 * Keeping one function for both callers is the actual fix. Two copies of a
 * merge is how the creation path drifted from the turn path in the first
 * place.
 */

import {
  MAX_NARRATIVE_NOTES,
  type NarrativeMemory,
  type NarrativeMemoryUpdates,
} from '@soulbound/shared';

/**
 * A frozen empty ledger, for comparison and for callers that need a literal.
 *
 * Frozen deliberately: `mergeNarrativeMemory` returns `base.notes` BY REFERENCE
 * on the common path where `note` is null (that pass-through is the pre-existing
 * per-turn behaviour and is kept), so an unfrozen module-level constant used as
 * the fallback would end up aliased into live game state and grow notes that
 * every later seed then inherited. The fallback below is a fresh literal for
 * that reason; the freeze is the second line of defence.
 */
const frozen = <T,>(value: T): T => Object.freeze(value) as T;

export const EMPTY_NARRATIVE_MEMORY: NarrativeMemory = frozen({
  entities: frozen<NarrativeMemory['entities']>({}),
  notes: frozen<string[]>([]),
});

/**
 * Folds one turn's `narrative_memory_updates` into the standing memory.
 * Never mutates `prev`.
 *
 * Behaviour is the pre-existing inline merge, moved verbatim:
 *
 *  - An entity is keyed by `name`, so a repeat of a known name OVERWRITES the
 *    stored description rather than duplicating the entry. That is deliberate:
 *    the prompt asks the model to re-state an entity it has developed further,
 *    and last-write-wins is what lets a description accrete detail.
 *  - An entity with a falsy `name` is skipped entirely — a nameless ledger key
 *    would render as "- : ..." in the prompt.
 *  - `description` falls back to `''`, not to the name.
 *  - `note` is appended only when truthy, so a null note (most turns) leaves
 *    the array untouched rather than pushing an empty string.
 *  - The cap keeps the LAST `MAX_NARRATIVE_NOTES`, dropping oldest first.
 */
export function mergeNarrativeMemory(
  prev: NarrativeMemory | undefined,
  updates: Partial<NarrativeMemoryUpdates> | undefined,
): NarrativeMemory {
  // Fresh literal, NOT EMPTY_NARRATIVE_MEMORY — see that constant's note.
  const base: NarrativeMemory = prev ?? { entities: {}, notes: [] };
  const nmUpdates = updates ?? {};

  const mergedEntities = { ...base.entities };
  (nmUpdates.new_entities ?? []).forEach((e) => {
    if (e?.name) mergedEntities[e.name] = { name: e.name, description: e.description || '' };
  });

  const mergedNotes = nmUpdates.note
    ? [...base.notes, nmUpdates.note].slice(-MAX_NARRATIVE_NOTES)
    : base.notes;

  return { entities: mergedEntities, notes: mergedNotes };
}
