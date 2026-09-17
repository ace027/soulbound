/**
 * Regression protection for the World Voice contract guard
 * (`assertWorldVoiceContract`, `@soulbound/shared`).
 *
 * CLAUDE.md constraint #4 requires that the response field names in
 * WORLD_SYSTEM_PROMPT's RESPONSE FORMAT block, the derived JSON Schema, and
 * the frontend parser never drift apart. `assertWorldVoiceContract` is the
 * guard that enforces this at backend startup (see server.ts). Phase 1
 * verified it once, by hand, by renaming a field and watching the process
 * exit 1 — then reverted the rename and never encoded the check anywhere.
 * This file is that missing regression net.
 *
 * WHY THE "PROMPT-ONLY RENAME" CASE (below) IS THE ONE THAT MATTERS, AND WHY
 * `tsc` CANNOT SUBSTITUTE FOR IT:
 *
 * `CONTRACT_FIELD_NAMES`, the Zod schemas, and the derived JSON Schema all
 * live in one TypeScript file (shared/src/worldVoice.ts) and move together —
 * renaming a field there is a type error everywhere it's used, so the
 * compiler already guards that arm "for free". WORLD_SYSTEM_PROMPT is a
 * plain template string with no structural tie to any of that. A developer
 * (or an agent) editing the prompt's RESPONSE FORMAT example — fixing a typo,
 * rewording a field, "cleaning up" a name — produces a file that still
 * compiles, still runs, and still returns *some* JSON. Nothing but this
 * runtime check, run against the real prompt text, catches that drift. A
 * future reader who sees this test passing and assumes the schema-vs-
 * CONTRACT_FIELD_NAMES case (case 5, below) already covers it would be wrong:
 * that case only proves shared/src/worldVoice.ts is internally consistent,
 * since both sides of it are authored in the same file. Deleting the
 * prompt-rename case as "redundant" with case 5 would silently remove the
 * only test that reads the actual prompt string at all.
 *
 * Every case below operates on an in-memory copy of WORLD_SYSTEM_PROMPT
 * (`String.prototype.replace` returns a new string; it never mutates the
 * original). `backend/src/data/worldSystemPrompt.ts` is a byte-identical
 * verbatim extraction and is never written to by this file. The final test
 * in this suite asserts the imported constant still contains the exact
 * substrings each case mutates a copy of, as a live check that nothing here
 * touched the original.
 */

import { describe, expect, it } from 'vitest';
import {
  assertWorldVoiceContract,
  CONTRACT_FIELD_NAMES,
  extractContractFieldPaths,
  WORLD_VOICE_JSON_SCHEMA,
} from '@soulbound/shared';
import { WORLD_SYSTEM_PROMPT } from '../data/worldSystemPrompt.js';

describe('assertWorldVoiceContract', () => {
  it('case 1: does not throw on the real, unmodified prompt', () => {
    expect(() => assertWorldVoiceContract(WORLD_SYSTEM_PROMPT)).not.toThrow();
  });

  it('case 2: throws on a prompt-only field rename (gm_note -> gm_notes), naming both the missing and the unexpected field', () => {
    const needle = '"gm_note":';
    expect(WORLD_SYSTEM_PROMPT).toContain(needle);

    const mutated = WORLD_SYSTEM_PROMPT.replace(needle, '"gm_notes":');
    expect(mutated).not.toBe(WORLD_SYSTEM_PROMPT); // sanity: the copy actually differs

    let thrown: unknown;
    try {
      assertWorldVoiceContract(mutated);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('gm_note'); // missing
    expect(message).toContain('gm_notes'); // unexpected
  });

  it('case 3: throws on a missing field (world_events removed from the RESPONSE FORMAT example)', () => {
    const needle = '    "world_events": [],\n';
    expect(WORLD_SYSTEM_PROMPT).toContain(needle);

    const mutated = WORLD_SYSTEM_PROMPT.replace(needle, '');
    expect(mutated).not.toBe(WORLD_SYSTEM_PROMPT);

    // Still valid JSON — this case isolates "field silently missing" from
    // case 4's "block is not parseable at all".
    expect(() => assertWorldVoiceContract(mutated)).toThrow(/world_events/);
  });

  it('case 4: throws a clear parse error when the RESPONSE FORMAT block is unparseable JSON', () => {
    const needle = '"skill_evolutions": [],';
    expect(WORLD_SYSTEM_PROMPT).toContain(needle);

    // Extra comma makes the object syntactically invalid without changing
    // brace balance, so the brace-matcher still finds a candidate block and
    // JSON.parse is the thing that fails.
    const mutated = WORLD_SYSTEM_PROMPT.replace(needle, '"skill_evolutions": [],,');
    expect(mutated).not.toBe(WORLD_SYSTEM_PROMPT);

    expect(() => assertWorldVoiceContract(mutated)).toThrow(/not valid JSON/);
  });

  it('case 5: the derived JSON Schema field paths match CONTRACT_FIELD_NAMES exactly', () => {
    const fromSchema = extractContractFieldPaths(
      WORLD_VOICE_JSON_SCHEMA as Record<string, unknown>,
    ).sort();
    const expected = [...CONTRACT_FIELD_NAMES].sort();
    expect(fromSchema).toEqual(expected);
  });

  it('leaves the imported WORLD_SYSTEM_PROMPT constant untouched by every case above', () => {
    // Belt-and-suspenders: strings are immutable in JS so this can't
    // actually fail unless something above stopped using .replace() on a
    // copy, but it documents the invariant the plan requires explicitly.
    expect(WORLD_SYSTEM_PROMPT).toContain('"gm_note":');
    expect(WORLD_SYSTEM_PROMPT).toContain('    "world_events": [],\n');
    expect(WORLD_SYSTEM_PROMPT).toContain('"skill_evolutions": [],');
  });
});
