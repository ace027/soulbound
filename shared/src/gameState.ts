/**
 * Game-state types, mirroring the shapes the artifact actually constructs.
 *
 * Sourced from legacy/souldbound-world.jsx:
 *   - initial skills array      lines 875-881
 *   - character object          line  883
 *   - initialState / GameState  lines 888-897
 *   - save-slot payload         lines 815-827
 *   - save index metadata       lines 28-36
 *
 * These are plain TypeScript types rather than Zod schemas: unlike the World
 * Voice contract, nothing crosses the model boundary here, so there is no
 * prompt to drift against and no schema to derive. They exist so the frontend
 * and the save layer agree.
 */

import type {
  NewSkillGranted,
  SkillTier,
  UniqueSkillDetermination,
  UniqueSubAbility,
} from './worldVoice.js';

// ─── Races ──────────────────────────────────────────────────────────────────
// Nine races, each with exactly two intrinsics. Mycelium was added as a full
// ninth entry, not a sub-race — see docs/design-decisions-log.md.

export interface RaceIntrinsic {
  name: string;
  description: string;
}

export interface Race {
  id: string;
  name: string;
  desc: string;
  intrinsic: [RaceIntrinsic, RaceIntrinsic];
}

// ─── Questionnaire ──────────────────────────────────────────────────────────
// Five open-ended free-text questions. Deliberately not multiple choice —
// richer answers produce a better-defined Unique Skill.

export interface Question {
  id: string;
  text: string;
  hint: string;
}

/** Keyed by Question['id']: nature, drive, flaw, memory, bond. */
export type QuestionnaireAnswers = Record<string, string>;

// ─── Skills ─────────────────────────────────────────────────────────────────
// One flat skill list holds every tier. Intrinsics start at a randomised 3-8
// mastery (NOT 50 — that broke the power curve and race balance; see the
// design log). sub_abilities / usage_notes / soul_resonance are populated only
// on the single Unique Skill.

export interface SubAbility {
  name: string;
  unlock_mastery: number;
  description: string;
}

export interface Skill {
  name: string;
  tier: SkillTier;
  mastery: number;
  description: string;
  /** Unique Skill only. Empty at creation — these emerge at 25/60/100. */
  sub_abilities?: SubAbility[];
  /** Unique Skill only. Silent accumulator feeding sub-ability emergence. */
  usage_notes?: string[];
  /** Unique Skill only. */
  soul_resonance?: string;
}

// ─── Character ──────────────────────────────────────────────────────────────

export interface UniqueSkillOrigin {
  skill_name: string;
  tier: 'Unique';
  description: string;
  soul_resonance: string;
  etching_text: string;
}

export interface Character {
  name: string;
  race: Race;
  uniqueSkill: UniqueSkillOrigin;
  answers: QuestionnaireAnswers;
}

// ─── Narrative memory ───────────────────────────────────────────────────────
// Entity ledger + rolling notes, added to stop NPC name drift and history loss
// outside the model's small action window. Notes are capped at 40 on merge.

export interface NarrativeMemory {
  entities: Record<string, { name: string; description: string }>;
  notes: string[];
}

export const MAX_NARRATIVE_NOTES = 40;

// ─── Game state ─────────────────────────────────────────────────────────────

export interface GameState {
  character: Character;
  skills: Skill[];
  location: string;
  currentScene: string;
  actionHistory: string[];
  narrativeMemory: NarrativeMemory;
}

// ─── Log ────────────────────────────────────────────────────────────────────

export interface SoulRewriteEntry {
  old_name: string;
  new_name: string;
  description: string;
  rewrite_narrative: string | null;
}

export interface LogEntry {
  type: 'action' | 'narration' | 'error';
  text: string;
  /**
   * `state_updates.new_skills_granted` for this turn, verbatim. WorldLog
   * reads `ns.soul_etching_text`, `ns.skill_name`, `ns.tier`, `ns.mastery`
   * and `ns.description` straight off these (legacy 712-718) — the same
   * field names the World Voice contract defines in shared/src/worldVoice.ts,
   * so no separate shape is declared here.
   */
  newSkills?: NewSkillGranted[];
  soulRewrites?: SoulRewriteEntry[];
  subAbilityUnlock?: (UniqueSubAbility & { skillName: string }) | null;
  gmNote?: string | null;
  /**
   * Set only on the log's first entry, right after character creation
   * (legacy 902: `{ type: "narration", text: intro.narration, etchingSkill:
   * uniqueSkill }`, where `uniqueSkill` is `determineUniqueSkill()`'s raw
   * result). WorldLog renders it as the "Soul Etching — Unique Skill
   * Recognized" callout, reading `.skill_name`, `.etching_text` and
   * `.soul_resonance` (legacy 675-677).
   *
   * `name` is kept optional to match legacy's defensive
   * `etchingSkill.skill_name || etchingSkill.name` (legacy 675) — a fallback
   * for a field `UniqueSkillDetermination` never actually carries. It is
   * dead in practice but preserved rather than dropped, since dropping it
   * would be a silent behavioural change disguised as a type fix.
   */
  etchingSkill?: (UniqueSkillDetermination & { name?: string }) | null;
}

// ─── Saves ──────────────────────────────────────────────────────────────────
// localStorage, not the artifact's window.storage API — that was tried first
// and abandoned because it did not survive reload (CLAUDE.md constraint #2).
//
// Key names are byte-identical to the artifact's so existing saves still load.

export const SAVE_INDEX_KEY = 'sbc-save-index';
export const SAVE_PREFIX = 'sbc-save:';
export const MAX_LOG_SAVED = 80;

/** Current save schema version. Absent on saves written by the artifact. */
export const SAVE_SCHEMA_VERSION = 1;

export interface SaveSlot {
  gameState: GameState;
  log: LogEntry[];
  savedAt: number;
  /**
   * Optional by design: saves written by the artifact predate this field and
   * must still load. Treat a missing value as version 0.
   */
  schemaVersion?: number;
}

export interface SaveIndexEntry {
  id: string;
  name: string;
  race: string;
  location: string;
  skillCount: number;
  savedAt: number;
  uniqueSkill: string;
}

// ─── Tier styling ───────────────────────────────────────────────────────────
// Kept here because SkillTier lives in the contract and these keys must stay
// exhaustive over it. Values are copied verbatim from legacy lines 525-531.

export const TIER_STYLE: Record<SkillTier, { color: string; glow: string }> = {
  Intrinsic: { color: '#8a7a60', glow: '#8a7a60' },
  Common: { color: '#7ab87a', glow: '#7ab87a' },
  Extra: { color: '#3a6b9e', glow: '#5a9fd4' },
  Unique: { color: '#d4a843', glow: '#f0c060' },
  Ultimate: { color: '#c0392b', glow: '#e74c3c' },
};
