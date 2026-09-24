/**
 * Hosted mode's Better Auth client (Phase 6, R24a), plus the sign-in values
 * that arrive in the URL.
 *
 * `better-auth` is pinned to the exact version the backend runs, so the client
 * and server always agree on routes and payloads. It is loaded with a dynamic
 * `import()` the first time a hosted screen needs it, so a self-host page never
 * downloads it: self-host never renders `SignIn` or `AccountPanel`, and
 * `ModeGate` calls `refreshSession` only in hosted mode.
 *
 * Every helper here resolves and never throws. The screens show fixed text,
 * never a message from the server.
 */

import { INVITE_CODE_PATTERN } from '@soulbound/shared';

/** Where every sign-in returns to. Better Auth also sends its errors here, as `/?error=<CODE>`. */
const CALLBACK_URL = '/';

async function createClient() {
  const [{ createAuthClient }, { magicLinkClient }] = await Promise.all([
    import('better-auth/client'),
    import('better-auth/client/plugins'),
  ]);
  // Hosted mode is same-origin: the page and `/api/auth/*` share one host.
  return createAuthClient({ baseURL: window.location.origin, plugins: [magicLinkClient()] });
}

/** The configured Better Auth client. */
export type AuthClient = Awaited<ReturnType<typeof createClient>>;

let clientPromise: Promise<AuthClient> | null = null;

/** The configured client, created once on first use. */
export function getAuthClient(): Promise<AuthClient> {
  clientPromise ??= createClient();
  return clientPromise;
}

/**
 * Asks the server to email a sign-in link. `'sent'` whenever the server
 * answered at all: the answer is the same whether or not the address has an
 * account or an invite, by design. `'error'` only when it couldn't be reached.
 */
export async function signInWithEmail(email: string): Promise<'sent' | 'error'> {
  try {
    const client = await getAuthClient();
    const { error } = await client.signIn.magicLink({ email, callbackURL: CALLBACK_URL });
    return error && !error.status ? 'error' : 'sent';
  } catch {
    return 'error';
  }
}

/** Starts an OAuth sign-in. On success the browser is already navigating away. */
export async function signInWithProvider(provider: 'google' | 'discord'): Promise<'redirecting' | 'error'> {
  try {
    const client = await getAuthClient();
    const { error } = await client.signIn.social({ provider, callbackURL: CALLBACK_URL });
    return error ? 'error' : 'redirecting';
  } catch {
    return 'error';
  }
}

/** Ends this browser's session. */
export async function signOut(): Promise<'ok' | 'error'> {
  try {
    const client = await getAuthClient();
    const { error } = await client.signOut();
    return error ? 'error' : 'ok';
  } catch {
    return 'error';
  }
}

/**
 * `GET /api/auth/get-session`, from the browser. The server's access gate reads
 * the session server-side, so the refreshed cookie Better Auth issues there
 * never reaches the browser (06-04). Only this call renews the cookie, which
 * is what makes the 30-day session actually roll.
 */
export async function refreshSession(): Promise<void> {
  try {
    const client = await getAuthClient();
    await client.getSession();
  } catch {
    // A failed refresh changes nothing: the current cookie is still valid.
  }
}

// ─── Sign-in values carried in the URL ─────────────────────────────────────

/** The two values `main.tsx` takes out of the URL before anything renders. */
export interface SignInParams {
  /** From `#invite=CODE`, only when it is a well-formed code. */
  invite?: string;
  /** True when `#invite=` was present but not a well-formed code (never sent to the server). */
  inviteMalformed?: boolean;
  /** From Better Auth's error redirect, `?error=CODE`. Never rendered as text. */
  error?: string;
}

/**
 * Reads `invite` from the fragment and Better Auth's `error` (and its
 * `error_description`) from the query, then removes them from the address bar
 * and the current history entry with `history.replaceState`. Runs in
 * `main.tsx` before the first render and fetch, for every visitor, signed in or
 * not, so an invite code never lingers where a screenshot, a shared URL or the
 * history could leak it.
 */
export function takeSignInParams(
  loc: Pick<Location, 'hash' | 'search' | 'pathname'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = window.history,
): SignInParams {
  const params: SignInParams = {};

  const hash = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const query = new URLSearchParams(loc.search);
  const hadInvite = hash.has('invite');
  const hadError = query.has('error') || query.has('error_description');
  // Invite links use the fragment (06-03). A code in the query was already sent
  // to the server, so it is not used, but it is still removed from the bar.
  const hadQueryInvite = query.has('invite');
  if (!hadInvite && !hadError && !hadQueryInvite) return params;

  if (hadInvite) {
    const code = hash.get('invite') ?? '';
    if (INVITE_CODE_PATTERN.test(code)) params.invite = code;
    else params.inviteMalformed = true;
    hash.delete('invite');
  }
  if (hadError) {
    const error = query.get('error');
    if (error) params.error = error;
    query.delete('error');
    query.delete('error_description');
  }
  query.delete('invite');

  const search = query.toString();
  const fragment = hash.toString();
  const url = `${loc.pathname}${search ? `?${search}` : ''}${fragment ? `#${fragment}` : ''}`;
  try {
    hist.replaceState(hist.state, '', url);
  } catch {
    // A browser that refuses replaceState keeps the URL; the values are still only used in memory.
  }
  return params;
}
