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

/**
 * Title-screen switch: sets or removes `prologue=1` via replaceState (no
 * reload, nothing stored). Every other param, the path and the hash are kept.
 * No-op without a window.
 */
export function setPrologueFlag(on: boolean): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('prologue', '1');
  else url.searchParams.delete('prologue');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** `'scene'` only for exactly `?canon=scene`; everything else is the default `'traits'`. */
export function prologueCanon(search?: string): PrologueCanon {
  const s = readSearch(search);
  if (s === null) return 'traits';
  return new URLSearchParams(s).get('canon') === 'scene' ? 'scene' : 'traits';
}
