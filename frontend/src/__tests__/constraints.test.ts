/**
 * Static source guards for CLAUDE.md hard constraints 1 and 2.
 *
 * Added in the Phase 4 review fix cycle. The 04-01 audit passed both constraints
 * on ad-hoc greps run at one commit, which prove absence *then* and nothing about
 * the next commit. A reviewer confirmed the gap by mutation: a behaviour-preserving
 *
 *     window.confirm("Delete this save?"); window.alert("deleted"); onDeleteSave(id);
 *
 * in TitleScreen's delete branch left all 242 tests green — 108 backend + 129 frontend
 * + 5 e2e, the totals at that commit, before this file existed.
 *
 * ── Why a source scan rather than a behavioural test ─────────────────────────
 * Constraints 1 and 2 are absence properties: "this API appears nowhere". No
 * behavioural test can express that — it can only assert the paths it happens to
 * exercise. Note also that the naive behavioural check gives a FALSE POSITIVE:
 * gating a delete on `window.confirm` does fail an existing test, but only because
 * jsdom's `confirm()` returns `undefined` and the gate swallows the call. That
 * failure is about behaviour, not about the banned API, and reading it as coverage
 * is the trap this file exists to remove.
 *
 * An ESLint rule (`no-restricted-globals`) would serve too, but the repo has no
 * ESLint config at all, and adding a lint toolchain is a larger change than the
 * constraint needs. This runs inside the suite CI already executes.
 *
 * Comments are stripped before matching: the codebase discusses these APIs by name
 * in several docstrings that explain why they are banned, and those must not trip
 * the guard. That stripping is itself tested below, so the scan cannot go vacuous
 * by silently blanking the whole file.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Vitest runs with the frontend workspace as its root, so `src` resolves from
 * cwd. `import.meta.url` is not used here: under this config it resolves to a
 * root-relative URL whose `.pathname` is `/src/...`, which scandir rejects.
 */
const SRC = resolve(process.cwd(), 'src');

/** Every .ts/.tsx under frontend/src, excluding test files themselves. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** Block and line comments removed, so prose about a banned API is not a hit. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = sourceFiles(SRC);

describe('CLAUDE.md constraint 1 — no window.confirm / alert / prompt', () => {
  it('scans a non-trivial number of source files', () => {
    // Guards the guard: a broken walker or a bad root silently passes every
    // assertion below, since "no offenders found" and "nothing searched" look
    // identical from the outside.
    expect(existsSync(SRC)).toBe(true);
    expect(FILES.length).toBeGreaterThan(10);
  });

  it.each(['confirm', 'alert', 'prompt'])('no window.%s( call in any source file', (api) => {
    const pattern = new RegExp(`window\\s*\\.\\s*${api}\\s*\\(`);
    const offenders = FILES.filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  /**
   * The bare globals are the SAME native API and the more idiomatic spelling, so a
   * guard anchored on the `window.` prefix is under-inclusive: review cycle 2 showed
   * `confirm("...")` / `alert("...")` in the delete branch passing all 136 tests while
   * jsdom itself printed "Not implemented: Window's confirm() method" — proof the
   * native call was reached.
   *
   * All three banned APIs are listed. An earlier version excluded `prompt` on the
   * reasoning that it is a common identifier here (the World Voice prompts) and would
   * false-positive. That was asserted, not measured, and it was wrong: review cycle 3
   * ran the rule and found **zero** matches for any of the three across the scanned
   * files, because every `prompt` mention in this codebase sits in a comment and
   * `stripComments` removes it before matching. The exclusion had left a real hole —
   * a bare `prompt("...")` in the delete branch passed all 138 tests while jsdom
   * printed "Not implemented: Window's prompt() method".
   *
   * Derivation, re-runnable:
   *   grep -rnE '(^|[^.\w$])(confirm|alert|prompt)\s*\(' --include=*.ts --include=*.tsx \
   *     frontend/src | grep -v __tests__     # -> no matches
   */
  it.each(['confirm', 'alert', 'prompt'])('no bare %s( call in any source file', (api) => {
    const pattern = new RegExp(`(^|[^.\\w$])${api}\\s*\\(`, 'm');
    const offenders = FILES.filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('would catch a real call — the stripper does not blank everything', () => {
    const stripped = stripComments('/* window.confirm() in prose */\nwindow.confirm("x");\n');
    expect(stripped).not.toMatch(/in prose/);
    expect(/window\s*\.\s*confirm\s*\(/.test(stripped)).toBe(true);
  });
});

describe('CLAUDE.md constraint 2 — localStorage only, never window.storage', () => {
  it('no window.storage reference in any source file', () => {
    const offenders = FILES.filter((f) =>
      /window\s*\.\s*storage\b/.test(stripComments(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('the save layer still uses localStorage, so the ban is not vacuous', () => {
    const saves = readFileSync(join(SRC, 'lib', 'saves.ts'), 'utf8');
    expect(saves).toMatch(/localStorage\./);
  });
});
