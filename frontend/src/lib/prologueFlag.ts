/**
 * Phase 14 (R36) opt-in readers. The prologue is a prototype: nothing is
 * stored (no localStorage key, CLAUDE.md #2), the URL is the only switch.
 *
 *   ?prologue=1      -> QuestionnaireScreen renders PrologueScreen
 *   ?canon=scene     -> the profile is distilled from the scene, not the traits
 *                       (developer-only comparison; anything else is 'traits')
 */

import type { PrologueCanon } from '@soulbound/shared';

function readSearch(search?: string): string | null {
  if (search !== undefined) return search;
  if (typeof window === 'undefined') return null;
  return window.location.search;
}

/** True only for exactly `?prologue=1`. `0`, `true`, empty and absent are all off. */
export function isPrologueEnabled(search?: string): boolean {
  const s = readSearch(search);
  if (s === null) return false;
  return new URLSearchParams(s).get('prologue') === '1';
}

/** `'scene'` only for exactly `?canon=scene`; everything else is the default `'traits'`. */
export function prologueCanon(search?: string): PrologueCanon {
  const s = readSearch(search);
  if (s === null) return 'traits';
  return new URLSearchParams(s).get('canon') === 'scene' ? 'scene' : 'traits';
}
