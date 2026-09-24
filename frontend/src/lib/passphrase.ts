/**
 * The deployer-issued access passphrase — Phase 5, R19.
 *
 * This is NOT the rejected paste-per-session BYOK. The passphrase here is set
 * by whoever runs this server (via `SOULBOUND_PASSPHRASE`, see CLAUDE.md →
 * Auth architecture) and handed to their own players; it never reaches
 * Anthropic and it is not an Anthropic API key. BYOK was rejected because it
 * assumed an untrusted host; this deployment shape assumes a trusted
 * self-hoster gating who may spend their own API budget.
 *
 * Storage key comes from `@soulbound/shared` (`ACCESS_STORAGE_KEY`), never
 * redeclared here — same precedent as the save keys (`lib/saves.ts`).
 *
 * Every `localStorage` access is wrapped in try/catch, matching `saves.ts`:
 * a blocked store (private mode, disabled storage) must degrade to "always
 * ask again", never throw and break the app.
 */

import { ACCESS_STORAGE_KEY } from '@soulbound/shared';

/**
 * The only characters a passphrase may contain. Mirrors the backend's boot
 * check (`backend/src/config.ts`, `/^[\x20-\x7E]+$/`): `fetch` throws a
 * `TypeError` on a non-Latin-1 header value, which the client cannot tell
 * apart from a network failure, so a value outside this set could never be
 * sent. One definition, used by the form (before storing) and by
 * `getPassphrase` (before sending).
 */
export const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/**
 * Read the stored passphrase, or `null` if unset, storage is unavailable, or
 * the stored value could never be sent. A value outside `PRINTABLE_ASCII`
 * (e.g. one stored before the form validated input) is cleared rather than
 * returned, so the next check asks again instead of failing every call.
 */
export function getPassphrase(): string | null {
  try {
    const stored = localStorage.getItem(ACCESS_STORAGE_KEY);
    if (stored !== null && !PRINTABLE_ASCII.test(stored)) {
      localStorage.removeItem(ACCESS_STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

/** Store the passphrase. Silently does nothing if storage is unavailable. */
export function setPassphrase(passphrase: string): void {
  try {
    localStorage.setItem(ACCESS_STORAGE_KEY, passphrase);
  } catch {
    // Blocked storage: the form will simply reappear on the next check.
  }
}

/** Clear the stored passphrase. Silently does nothing if storage is unavailable. */
export function clearPassphrase(): void {
  try {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
  } catch {
    // Nothing to clear if we couldn't read/write it in the first place.
  }
}

// ─── "the passphrase stopped working" event ────────────────────────────────
// A plain in-module Set of listeners — no new dependency. `api.ts` calls
// `emitPassphraseRequired()` after a 401 `PASSPHRASE_REQUIRED`; `AccessGate`
// subscribes so it can re-show the form over a still-mounted `<App/>`.

const listeners = new Set<() => void>();

/** Subscribe to "the server just said the stored passphrase is wrong". Returns an unsubscribe function. */
export function onPassphraseRequired(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Internal: notify every subscriber. Called by `lib/api.ts` only. */
export function emitPassphraseRequired(): void {
  for (const fn of listeners) fn();
}
