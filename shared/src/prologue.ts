/**
 * The prologue contract (Phase 14, requirement R36).
 *
 * A fixed four-beat threshold scene, narrated reactively, distilled into the
 * five `answers` keys that the existing unique-skill route already takes.
 * This module is the SINGLE place the prologue's opening text, bounds and
 * request/response schemas are written.
 *
 * These schemas are NOT part of `WORLD_VOICE_JSON_SCHEMA`, and CLAUDE.md
 * constraint #4's nine-field list (`CONTRACT_FIELD_NAMES`) is unchanged. The
 * prologue routes carry their own, separate contract; no World Voice field
 * name is added, renamed or removed here.
 *
 * The routes are stateless: the client holds the history. The fixed opening
 * lives here so the server can reject a history whose first entry differs from
 * it. Narrator entries are client-held and therefore untrusted server-side.
 *
 * Bounds note: the Anthropic SDK's structured-output schema transform folds
 * `minLength`/`maxLength` into a property's description, so the bounds on the
 * model-facing schemas are advisory to the model and enforced only by the Zod
 * parse after generation. They are set generously for that reason.
 *
 * `PrologueProfileSchema`'s five keys must stay equal to the keys of the
 * unique-skill route's `answers` object (each bounded far below its 4000-char
 * limit). A test pins that alignment.
 */

import { z } from 'zod';

// ─── Constants ──────────────────────────────────────────────────────────────

export const PROLOGUE_OPENING =
  'You are dissolving. There is no body yet — only the sense of being a held breath in a vast dark. ' +
  'Beside you, a second soul flickers, smaller than you, fraying at its edges. Ahead there is a seam of ' +
  'ember-light: a doorway that can carry one soul across at a time, and it is narrowing. Behind you, something ' +
  'cold has turned toward the sound of you both. What do you do?';

export const PROLOGUE_BEAT_COUNT = 4;
export const PROLOGUE_ENTRY_MAX = 2000;
export const PROLOGUE_NARRATION_MAX = 2000;
export const PROLOGUE_PROFILE_FIELD_MAX = 1500;

export const PROLOGUE_CANONS = ['traits', 'scene'] as const;
export const PrologueCanonSchema = z.enum(PROLOGUE_CANONS);
export type PrologueCanon = z.infer<typeof PrologueCanonSchema>;

// ─── History ────────────────────────────────────────────────────────────────

export const PrologueHistoryEntrySchema = z.strictObject({
  role: z.enum(['narrator', 'player']),
  text: z.string().min(1).max(PROLOGUE_ENTRY_MAX),
});
export type PrologueHistoryEntry = z.infer<typeof PrologueHistoryEntrySchema>;

type History = PrologueHistoryEntry[];

/** Opening and strict narrator/player alternation, shared by both requests. */
function checkOpeningAndAlternation(history: History, ctx: z.RefinementCtx): void {
  const first = history[0];
  if (first !== undefined) {
    if (first.role !== 'narrator') {
      ctx.addIssue({
        code: 'custom',
        path: ['history', 0, 'role'],
        message: 'history must start with the narrator opening entry',
      });
    } else if (first.text !== PROLOGUE_OPENING) {
      ctx.addIssue({
        code: 'custom',
        path: ['history', 0, 'text'],
        message: 'history[0] must be exactly the fixed prologue opening text',
      });
    }
  }
  for (let i = 1; i < history.length; i++) {
    if (history[i]!.role === history[i - 1]!.role) {
      ctx.addIssue({
        code: 'custom',
        path: ['history', i, 'role'],
        message: 'history roles must strictly alternate narrator, player, narrator, player',
      });
      break;
    }
  }
}

// ─── Requests ───────────────────────────────────────────────────────────────

export const PrologueBeatRequestSchema = z
  .strictObject({
    history: z.array(PrologueHistoryEntrySchema).min(2).max(8),
  })
  .superRefine((value, ctx) => {
    checkOpeningAndAlternation(value.history, ctx);
    const last = value.history[value.history.length - 1];
    if (last !== undefined && last.role !== 'player') {
      ctx.addIssue({
        code: 'custom',
        path: ['history', value.history.length - 1, 'role'],
        message: 'the last history entry must be a player entry for a beat request',
      });
    }
    const players = value.history.filter((e) => e.role === 'player').length;
    if (players < 1 || players > PROLOGUE_BEAT_COUNT) {
      ctx.addIssue({
        code: 'custom',
        path: ['history'],
        message: `a beat request must carry 1 to ${PROLOGUE_BEAT_COUNT} player entries`,
      });
    }
  });

export const PrologueProfileRequestSchema = z
  .strictObject({
    history: z.array(PrologueHistoryEntrySchema).length(9),
    canon: PrologueCanonSchema.default('traits'),
  })
  .superRefine((value, ctx) => {
    checkOpeningAndAlternation(value.history, ctx);
    const last = value.history[value.history.length - 1];
    if (last !== undefined && last.role !== 'narrator') {
      ctx.addIssue({
        code: 'custom',
        path: ['history', value.history.length - 1, 'role'],
        message: 'the last history entry must be a narrator entry for a profile request',
      });
    }
  });

// ─── Responses and model output ─────────────────────────────────────────────

/** What the model returns for a beat. */
export const PrologueNarrationSchema = z.strictObject({
  narration: z.string().min(1).max(PROLOGUE_NARRATION_MAX),
});

/** What the beat route returns. */
export const PrologueBeatResponseSchema = z.strictObject({
  narration: z.string().min(1),
  beat: z.number().int().min(1).max(4),
  final: z.boolean(),
});
export type PrologueBeatResponse = z.infer<typeof PrologueBeatResponseSchema>;

/** Both the model's output schema and the profile route's response. */
export const PrologueProfileSchema = z.strictObject({
  nature: z.string().min(1).max(PROLOGUE_PROFILE_FIELD_MAX),
  drive: z.string().min(1).max(PROLOGUE_PROFILE_FIELD_MAX),
  flaw: z.string().min(1).max(PROLOGUE_PROFILE_FIELD_MAX),
  memory: z.string().min(1).max(PROLOGUE_PROFILE_FIELD_MAX),
  bond: z.string().min(1).max(PROLOGUE_PROFILE_FIELD_MAX),
});
export type PrologueProfile = z.infer<typeof PrologueProfileSchema>;
