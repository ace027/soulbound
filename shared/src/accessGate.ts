// ─── Access gate contract ───────────────────────────────────────────────────
// The deployer-set passphrase gate (Phase 5, R17/R18/R19) needs the backend
// and frontend to agree, byte for byte, on a header name, an auth scheme, two
// error codes, a storage key, a check path and a minimum length. Splitting
// these across two files invites drift (one side renames a code, the other
// doesn't); a shared constants module is the same precedent as the save-key
// constants in `gameState.ts` (`SAVE_INDEX_KEY` / `SAVE_PREFIX`), just for the
// access gate instead of saves.
//
// This is NOT the rejected paste-per-session BYOK: the passphrase here is
// issued by the deployer to their own players, never an Anthropic key, and it
// never reaches Anthropic (CLAUDE.md, Auth architecture).

/** The HTTP header the passphrase travels in. */
export const ACCESS_HEADER = 'Authorization';

/** The auth scheme prefix inside `ACCESS_HEADER`, e.g. `Bearer <passphrase>`. */
export const ACCESS_SCHEME = 'Bearer';

/** The `localStorage` key the frontend stores the passphrase under. */
export const ACCESS_STORAGE_KEY = 'sbc-access-passphrase';

/** Error code for a missing or wrong passphrase (401). */
export const PASSPHRASE_REQUIRED = 'PASSPHRASE_REQUIRED';

/** Error code for exceeding the rate limit (429). */
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS';

/** The path the frontend probes on mount to learn whether a passphrase is needed. */
export const ACCESS_CHECK_PATH = '/api/access';

/** The shortest passphrase the backend will accept at boot. */
export const MIN_PASSPHRASE_LENGTH = 12;

// ─── Hosted mode (Phase 6) ──────────────────────────────────────────────────
// Appended for the second deployment mode: player accounts instead of the
// deployer passphrase. Everything above this line is the self-host contract
// and is unchanged.

/** The two deployment modes `SOULBOUND_MODE` selects between. */
export type SoulboundMode = 'selfhost' | 'hosted';

/** Error code for a hosted request with no valid session (401). */
export const SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED';

/** Error code for a hosted state-changing request from a foreign or missing Origin (403). */
export const ORIGIN_REJECTED = 'ORIGIN_REJECTED';

/** Error code for a hosted sign-up attempted without a redeemed invite. */
export const INVITE_REQUIRED = 'INVITE_REQUIRED';

/** Error code for an unknown, used or expired invite code (400; one response for all three). */
export const INVITE_INVALID = 'INVITE_INVALID';

/** The path a player posts their invite code to before signing up. */
export const INVITE_REDEEM_PATH = '/api/invites/redeem';

/** The path for the signed-in player's own account (`DELETE` requests deletion). */
export const ACCOUNT_PATH = '/api/account';

/** The only shape an invite code may take: 128 bits as base64url, 22 characters. */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Response header on hosted `GET /api/access` (value `hosted`); self-host never sends it. */
export const MODE_HEADER = 'Soulbound-Mode';
