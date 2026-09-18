/**
 * The pure body of legacy `handleAction` (souldbound-world.jsx 925-1021),
 * lifted out as a function of `(gameState, action, result)` with every `set*`
 * call removed.
 *
 * This is the ONE deviation from a verbatim port in Phase 3, and it exists for
 * exactly one reason: R10's rules (mastery, Soul Rewrite, sub-ability
 * attachment, the note cap) are the game's balance surface, and inside a React
 * handler they are unreachable by a unit test. As a pure function they are
 * mutation-testable. Everything else in the turn — `setGameState`,
 * `setNewSkillIds`, the 2500ms timeout, the `setLog`/`autoSave` closure — stays
 * in App.tsx, ported statement-for-statement.
 *
 * ── Behaviour tuned by feel. Port exactly; do not tidy. ──
 *
 * The ordering here is load-bearing and was arrived at by iteration, not
 * design. Each of the following looks like a cleanup and is not:
 *
 *  1. Evolutions run AFTER new skills are pushed onto the same `updatedSkills`
 *     array (legacy 943-949 then 952-968), so a skill granted this turn can be
 *     evolved this turn. Reordering silently changes what the player sees.
 *
 *  2. The sub-ability lookup `findIndex(s => s.tier === 'Unique')` (legacy 974)
 *     runs AFTER evolutions, so if a Soul Rewrite renamed the Unique Skill this
 *     turn, the unlock attaches to the NEW name. Hoisting it above the
 *     evolution pass would attach it to a skill that no longer exists.
 *
 *  3. Soul Rewrite fires only when BOTH tiers are Unique (legacy 956). Dropping
 *     the `old_tier` half makes an ordinary Unique→Ultimate evolution wrongly
 *     wipe mastery, sub-abilities and usage notes.
 *
 *  4. `usage_notes` accumulate on the Unique skill ONLY (legacy 933-937). The
 *     non-Unique branch passes the existing value through — which for a
 *     non-Unique skill is `undefined`. Writing `?? []` there changes the saved
 *     shape of every Intrinsic and Common skill.
 *
 *  5. `mastery: ns.mastery || 5` (legacy 946) is a FALSY-coalesce, not a
 *     nullish one: a skill granted at mastery 0 is stored as 5. `?? 5` is the
 *     natural thing to write in TypeScript and it is a balance change.
 *     Same shape at `sceneEvent.location || ...` (legacy 1006-1007).
 *
 *  6. `changed` (legacy 929) is assigned at 938 and never read. It is dead in
 *     the original. It is kept here so this function stays a faithful port —
 *     do not "fix" it into something that has an effect.
 *
 * ── What deliberately is NOT here ──
 *
 *  - The 25/60/100 thresholds. Those are enforced model-side by
 *    WORLD_SYSTEM_PROMPT (lines 40, 55, 93, 139). The client's job is to
 *    dedupe, attach to the Unique skill, and render. A client-side guard
 *    rejecting an unlock outside those values would duplicate the prompt's
 *    source of truth and silently swallow legitimate unlocks whenever a mastery
 *    jump overshoots a threshold.
 *  - `Math.random()`. Legacy's intrinsic roll (line 877) belongs to the
 *    questionnaire flow in App.tsx. A pure function that calls it is neither.
 *  - The 80-entry log cap. That lives in `autoSave` (legacy 820), not here.
 */

import {
  MAX_NARRATIVE_NOTES,
  type GameState,
  type LogEntry,
  type Skill,
  type SoulRewriteEntry,
  type UniqueSubAbility,
  type WorldVoiceResponse,
} from '@soulbound/shared';

export interface ApplyWorldUpdateResult {
  /** The next game state. Never mutates the input. */
  state: GameState;
  /** The narration entry to append to the log. */
  logEntry: LogEntry;
  /**
   * Names granted this turn, as a Set — SkillCard reads it via `.has()`, and
   * App.tsx holds it in `useState<Set<string>>`. Deliberately a Set, not an
   * array: a `string[]` reaching a Set-typed state fails at runtime, not
   * compile time, and the only symptom is the new-skill glow quietly never
   * appearing again.
   */
  newSkillIds: Set<string>;
}

export function applyWorldUpdate(
  gameState: GameState,
  action: string,
  result: WorldVoiceResponse,
): ApplyWorldUpdateResult {
  const updates = result.state_updates ?? {};

  // ── Apply mastery changes ────────────────────────────────────────────────
  const updatedSkills: Skill[] = [...gameState.skills];
  // Dead in the original (assigned, never read) — kept for port fidelity. See note 6.
  const changed = new Set<string>();
  (updates.skill_mastery_changes ?? []).forEach((change) => {
    const idx = updatedSkills.findIndex((s) => s.name === change.skill_name);
    if (idx !== -1) {
      const isUnique = updatedSkills[idx].tier === 'Unique';
      // Note 4: the non-Unique branch passes through, which is usually undefined.
      const newNotes = isUnique
        ? [
            ...(updatedSkills[idx].usage_notes ?? []),
            `(mastery ${change.old_mastery}→${change.new_mastery}) Action: "${action}"${change.note ? ' — ' + change.note : ''}`,
          ]
        : updatedSkills[idx].usage_notes;
      updatedSkills[idx] = { ...updatedSkills[idx], mastery: change.new_mastery, usage_notes: newNotes };
      changed.add(change.skill_name);
    }
  });

  // ── Add new skills ───────────────────────────────────────────────────────
  const newNames = new Set<string>();
  (updates.new_skills_granted ?? []).forEach((ns) => {
    if (!updatedSkills.find((s) => s.name === ns.skill_name)) {
      // Note 5: `|| 5` is a falsy-coalesce — mastery 0 becomes 5. Not `?? 5`.
      updatedSkills.push({
        name: ns.skill_name,
        tier: ns.tier,
        mastery: ns.mastery || 5,
        description: ns.description,
      });
      newNames.add(ns.skill_name);
    }
  });

  // ── Evolutions (incl. the rare Soul Rewrite) ─────────────────────────────
  // Note 1: this runs AFTER the new-skill merge, on the same array.
  const rewrites: SoulRewriteEntry[] = [];
  (updates.skill_evolutions ?? []).forEach((ev) => {
    const idx = updatedSkills.findIndex((s) => s.name === ev.old_name);
    if (idx !== -1) {
      // Note 3: BOTH tiers must be Unique.
      const isSoulRewrite = ev.old_tier === 'Unique' && ev.new_tier === 'Unique';
      updatedSkills[idx] = {
        ...updatedSkills[idx],
        name: ev.new_name,
        tier: ev.new_tier,
        description: ev.description,
        mastery: isSoulRewrite ? 0 : updatedSkills[idx].mastery,
        sub_abilities: isSoulRewrite ? [] : updatedSkills[idx].sub_abilities,
        usage_notes: isSoulRewrite ? [] : updatedSkills[idx].usage_notes,
      };
      if (isSoulRewrite) {
        rewrites.push({
          old_name: ev.old_name,
          new_name: ev.new_name,
          description: ev.description,
          rewrite_narrative: ev.rewrite_narrative,
        });
      }
    }
  });

  // ── Unique Skill sub-ability emergence ───────────────────────────────────
  // Note 2: the lookup runs AFTER evolutions, so a rewrite's new name wins.
  // Typed against the World Voice's UniqueSubAbility, NOT Skill's SubAbility:
  // legacy spreads the whole `sa` into the log entry, so the entry carries
  // `emergence_text` (the unlock's narration) while the skill stores only
  // name/unlock_mastery/description. Keep both shapes — they differ on purpose.
  let subAbilityUnlock: (UniqueSubAbility & { skillName: string }) | null = null;
  if (updates.unique_sub_ability_unlocked) {
    const sa = updates.unique_sub_ability_unlocked;
    const idx = updatedSkills.findIndex((s) => s.tier === 'Unique');
    if (idx !== -1 && !updatedSkills[idx].sub_abilities?.find((existing) => existing.name === sa.name)) {
      updatedSkills[idx] = {
        ...updatedSkills[idx],
        sub_abilities: [
          ...(updatedSkills[idx].sub_abilities ?? []),
          { name: sa.name, unlock_mastery: sa.unlock_mastery, description: sa.description },
        ],
      };
      subAbilityUnlock = { skillName: updatedSkills[idx].name, ...sa };
    }
  }

  // ── Merge narrative memory ───────────────────────────────────────────────
  const nmUpdates = result.narrative_memory_updates ?? {};
  const prevMemory = gameState.narrativeMemory ?? { entities: {}, notes: [] };
  const mergedEntities = { ...prevMemory.entities };
  (nmUpdates.new_entities ?? []).forEach((e) => {
    if (e?.name) mergedEntities[e.name] = { name: e.name, description: e.description || '' };
  });
  const mergedNotes = nmUpdates.note
    ? [...prevMemory.notes, nmUpdates.note].slice(-MAX_NARRATIVE_NOTES)
    : prevMemory.notes;

  const newState: GameState = {
    ...gameState,
    skills: updatedSkills,
    // Uncapped, as legacy has it. The backend caps actionHistory at 2000 and
    // the body at 512kb; 03-CONTEXT.md records that trip point as knowingly shipped.
    actionHistory: [...gameState.actionHistory, action],
    narrativeMemory: { entities: mergedEntities, notes: mergedNotes },
  };

  const sceneEvent = (updates.world_events ?? []).find((e) => e.type === 'scene_set');
  if (sceneEvent) {
    // Note 5 again: `||`, so an empty-string location falls back.
    newState.location = sceneEvent.location || newState.location;
    newState.currentScene = sceneEvent.scene_summary || newState.currentScene;
  }

  const logEntry: LogEntry = {
    type: 'narration',
    text: result.narration,
    newSkills: updates.new_skills_granted ?? [],
    soulRewrites: rewrites,
    subAbilityUnlock,
    gmNote: result.gm_note,
  };

  return { state: newState, logEntry, newSkillIds: newNames };
}
