/**
 * Contract tests for the prologue schemas in shared/src/prologue.ts (Phase 14,
 * plan 14-01, R36).
 *
 * Covers: request acceptance/rejection, the real `zodOutputFormat` helper
 * accepting both model-facing schemas, and the profile keys lining up with the
 * unique-skill route's `answers` keys.
 */

import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  PROLOGUE_ENTRY_MAX,
  PROLOGUE_NARRATION_MAX,
  PROLOGUE_OPENING,
  PrologueBeatRequestSchema,
  PrologueNarrationSchema,
  PrologueProfileRequestSchema,
  PrologueProfileSchema,
} from '@soulbound/shared';
import { UniqueSkillRequestSchema } from '../routes/uniqueSkill.js';

type Entry = { role: 'narrator' | 'player'; text: string };

/** Builds an alternating history of `length` entries starting at the opening. */
function history(length: number): Entry[] {
  const out: Entry[] = [{ role: 'narrator', text: PROLOGUE_OPENING }];
  for (let i = 1; i < length; i++) {
    out.push(
      i % 2 === 1
        ? { role: 'player', text: `I act ${i}.` }
        : { role: 'narrator', text: `The dark answers ${i}.` },
    );
  }
  return out;
}

const validProfile = {
  nature: 'a',
  drive: 'b',
  flaw: 'c',
  memory: 'd',
  bond: 'e',
};

const EXPECTED_OPENING =
  'You are dissolving. There is no body yet — only the sense of being a held breath in a vast dark. Beside you, a second soul flickers, smaller than you, fraying at its edges. Ahead there is a seam of ember-light: a doorway that can carry one soul across at a time, and it is narrowing. Behind you, something cold has turned toward the sound of you both. What do you do?';

describe('PROLOGUE_OPENING', () => {
  it('equals the exact literal (em dash U+2014)', () => {
    expect(PROLOGUE_OPENING).toBe(EXPECTED_OPENING);
    expect(PROLOGUE_OPENING).toContain('—');
  });

  it('rejects a beat history whose opening has its first character changed', () => {
    const h = history(2);
    h[0] = { role: 'narrator', text: 'X' + PROLOGUE_OPENING.slice(1) };
    const r = PrologueBeatRequestSchema.safeParse({ history: h });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /opening/.test(i.message))).toBe(true);
    }
  });
});

describe('PrologueBeatRequestSchema', () => {
  it.each([2, 4, 6, 8])('accepts a valid history of %i entries', (n) => {
    // Beat histories end on a player entry, so only even lengths are valid.
    expect(PrologueBeatRequestSchema.safeParse({ history: history(n) }).success).toBe(true);
  });

  it('rejects a forged opening', () => {
    const h = history(2);
    h[0] = { role: 'narrator', text: 'Something else entirely.' };
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(false);
  });

  it('rejects a history that starts with a player entry', () => {
    const h: Entry[] = [
      { role: 'player', text: 'hi' },
      { role: 'narrator', text: PROLOGUE_OPENING },
    ];
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(false);
  });

  it('rejects a repeated role (alternation)', () => {
    const h: Entry[] = [
      { role: 'narrator', text: PROLOGUE_OPENING },
      { role: 'player', text: 'a' },
      { role: 'player', text: 'b' },
    ];
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(false);
  });

  it('rejects a history that ends on a narrator entry', () => {
    expect(PrologueBeatRequestSchema.safeParse({ history: history(3) }).success).toBe(false);
  });

  it('rejects 5 player entries', () => {
    expect(PrologueBeatRequestSchema.safeParse({ history: history(10) }).success).toBe(false);
  });

  it('rejects an empty entry text', () => {
    const h = history(2);
    h[1] = { role: 'player', text: '' };
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(false);
  });

  it('rejects a 2001-character entry text', () => {
    const h = history(2);
    h[1] = { role: 'player', text: 'x'.repeat(PROLOGUE_ENTRY_MAX + 1) };
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(false);
    h[1] = { role: 'player', text: 'x'.repeat(PROLOGUE_ENTRY_MAX) };
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(true);
  });

  it('rejects an unknown key, on the request and on an entry', () => {
    expect(PrologueBeatRequestSchema.safeParse({ history: history(2), extra: 1 }).success).toBe(false);
    const h = history(2) as Array<Record<string, unknown>>;
    h[1] = { ...h[1], extra: 1 };
    expect(PrologueBeatRequestSchema.safeParse({ history: h }).success).toBe(false);
  });

  it('rejects a single-entry history (min 2)', () => {
    expect(PrologueBeatRequestSchema.safeParse({ history: history(1) }).success).toBe(false);
  });
});

describe('PrologueProfileRequestSchema', () => {
  it('accepts a 9-entry history and defaults canon to traits', () => {
    const r = PrologueProfileRequestSchema.safeParse({ history: history(9) });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.canon).toBe('traits');
  });

  it('keeps canon: scene and rejects an unknown canon', () => {
    const ok = PrologueProfileRequestSchema.safeParse({ history: history(9), canon: 'scene' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.canon).toBe('scene');
    expect(PrologueProfileRequestSchema.safeParse({ history: history(9), canon: 'nope' }).success).toBe(false);
  });

  it('rejects a beat-shaped history (ends on player)', () => {
    expect(PrologueProfileRequestSchema.safeParse({ history: history(8) }).success).toBe(false);
  });

  it.each([3, 5, 7, 11])('rejects a %i-entry history (exactly 9 required)', (length) => {
    // Lengths 3, 5, 7 end on a player (odd); 11 is over-long. None may pass, so a
    // loosened `.length(9)` (e.g. `.min(3)`) is caught.
    expect(PrologueProfileRequestSchema.safeParse({ history: history(length) }).success).toBe(false);
  });

  it('rejects a forged opening and a repeated role', () => {
    const forged = history(9);
    forged[0] = { role: 'narrator', text: 'forged' };
    expect(PrologueProfileRequestSchema.safeParse({ history: forged }).success).toBe(false);

    const repeated = history(9);
    repeated[4] = { role: 'player', text: 'again' };
    expect(PrologueProfileRequestSchema.safeParse({ history: repeated }).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(PrologueProfileRequestSchema.safeParse({ history: history(9), extra: 1 }).success).toBe(false);
  });
});

describe('PrologueNarrationSchema', () => {
  it('accepts a valid narration and rejects empty, 2001 chars and extra keys', () => {
    expect(PrologueNarrationSchema.safeParse({ narration: 'x' }).success).toBe(true);
    expect(PrologueNarrationSchema.safeParse({ narration: 'x'.repeat(2000) }).success).toBe(true);
    expect(PrologueNarrationSchema.safeParse({ narration: '' }).success).toBe(false);
    expect(PrologueNarrationSchema.safeParse({ narration: 'x'.repeat(2001) }).success).toBe(false);
    expect(PrologueNarrationSchema.safeParse({ narration: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('PrologueProfileSchema', () => {
  it('accepts a valid profile', () => {
    expect(PrologueProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it('rejects a missing key, an extra key, an empty string and a 1501-character string', () => {
    const { bond: _bond, ...missing } = validProfile;
    expect(PrologueProfileSchema.safeParse(missing).success).toBe(false);
    expect(PrologueProfileSchema.safeParse({ ...validProfile, extra: 'x' }).success).toBe(false);
    expect(PrologueProfileSchema.safeParse({ ...validProfile, nature: '' }).success).toBe(false);
    expect(PrologueProfileSchema.safeParse({ ...validProfile, nature: 'x'.repeat(1501) }).success).toBe(false);
    expect(PrologueProfileSchema.safeParse({ ...validProfile, nature: 'x'.repeat(1500) }).success).toBe(true);
  });
});

describe('zodOutputFormat with the real SDK helper', () => {
  // The SDK's schema transform keeps only `format` on strings and folds
  // minLength/maxLength into the property's description (verified in
  // node_modules/@anthropic-ai/sdk/lib/transform-json-schema.js). So the bound
  // is advisory to the model and enforced only by the Zod parse after
  // generation (a 502 INVALID_RESPONSE_SHAPE if exceeded).
  it('constructs for PrologueNarrationSchema; the bound lives in description, not maxLength', () => {
    const fmt = zodOutputFormat(PrologueNarrationSchema);
    expect(fmt.type).toBe('json_schema');
    const schema = fmt.schema as Record<string, any>;
    expect(schema.additionalProperties).toBe(false);
    const narration = schema.properties.narration;
    expect('maxLength' in narration).toBe(false);
    expect(narration.description).toContain('2000');
  });

  it('constructs for PrologueProfileSchema; the bound lives in description, not maxLength', () => {
    const fmt = zodOutputFormat(PrologueProfileSchema);
    expect(fmt.type).toBe('json_schema');
    const schema = fmt.schema as Record<string, any>;
    expect(schema.additionalProperties).toBe(false);
    const nature = schema.properties.nature;
    expect('maxLength' in nature).toBe(false);
    expect(nature.description).toContain('1500');
  });
});

describe('unique-skill key alignment', () => {
  it('profile keys equal the unique-skill answers keys', () => {
    expect(Object.keys(PrologueProfileSchema.shape).sort()).toEqual(
      Object.keys(UniqueSkillRequestSchema.shape.answers.shape).sort(),
    );
  });

  it('a profile of five 1500-character strings passes UniqueSkillRequestSchema', () => {
    const long = 'x'.repeat(1500);
    const profile = { nature: long, drive: long, flaw: long, memory: long, bond: long };
    expect(PrologueProfileSchema.safeParse(profile).success).toBe(true);
    const r = UniqueSkillRequestSchema.safeParse({ name: 'x', race: { name: 'y' }, answers: profile });
    expect(r.success).toBe(true);
  });
});

describe('narration bound vs history bound (found in 14-03)', () => {
  it('a maximum-length narration can be sent back as a history entry', () => {
    // The client echoes each narration into the next request's history, so the
    // narration cap must not exceed the history entry cap, or a long (but valid)
    // narration would make the NEXT call fail with a 400 the player cannot clear.
    expect(PROLOGUE_NARRATION_MAX).toBeLessThanOrEqual(PROLOGUE_ENTRY_MAX);
    const long = 'n'.repeat(PROLOGUE_NARRATION_MAX);
    expect(PrologueNarrationSchema.safeParse({ narration: long }).success).toBe(true);
    const history = [
      { role: 'narrator', text: PROLOGUE_OPENING },
      { role: 'player', text: 'I wait.' },
      { role: 'narrator', text: long },
      { role: 'player', text: 'I wait.' },
    ];
    expect(PrologueBeatRequestSchema.safeParse({ history }).success).toBe(true);
  });
});
