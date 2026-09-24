/**
 * The deployment-mode gate (Phase 6, R24a). It sits OUTSIDE `AccessGate` in
 * `main.tsx`: `<ModeGate><AccessGate><App/></AccessGate></ModeGate>`.
 *
 * Why outside, and why a second gate at all: `AccessGate` fails OPEN on
 * `'unknown'` (AccessGate.tsx docstring; 06-CONTEXT fact 4), and `checkAccess`
 * maps a hosted 401 `SIGN_IN_REQUIRED` to exactly that, so on its own it would
 * render the game to a signed-out hosted player. `checkAccess` and
 * `AccessGate` are frozen (their contract is pinned by existing tests), so the
 * sign-in case is caught here, before `AccessGate` ever mounts. The server
 * enforces access either way; this is about what the player sees.
 *
 * On mount it calls `getAccessState()` once:
 *   - pending: the same empty background `AccessGate` shows, so nothing flashes;
 *   - `'signin'`: `<SignIn/>` and not the children;
 *   - anything else: the children, plus `<AccountPanel/>` only when the
 *     response carried `Soulbound-Mode: hosted`.
 * In self-host that last case returns `children` as they are: no wrapper, no
 * extra DOM, and `AccessGate` then runs exactly as it did in Phase 5.
 *
 * Hosted only, once signed in: it calls `refreshSession()` once, then at most
 * every 12 hours while the tab stays open. The access gate reads the session
 * server-side, so only a browser-side `get-session` renews the cookie
 * (06-04), which is what keeps the 30-day session rolling.
 *
 * It also subscribes to `onSignInRequired`, which `lib/api.ts` fires on a 401
 * `SIGN_IN_REQUIRED` mid-game. Like `AccessGate`'s passphrase overlay, sign-in
 * then shows as a fixed overlay on top of the still-mounted game, so its state
 * survives if the player signs in again in another tab and continues here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAccessState, onSignInRequired } from '../lib/api';
import { refreshSession, type SignInParams } from '../lib/authClient';
import { sharedBg } from '../screens/sharedBg';
import AccountPanel from './AccountPanel';
import SignIn from './SignIn';

/** How often a long-open tab renews its session cookie. */
export const SESSION_REFRESH_MS = 12 * 60 * 60 * 1000;

type GateState =
  | { kind: 'pending' }
  | { kind: 'signin'; overlay: boolean }
  | { kind: 'ready'; hosted: boolean };

export interface ModeGateProps {
  children: React.ReactNode;
  /** Values `main.tsx` took out of the URL before the first render. Used by the first sign-in screen only. */
  signInParams?: SignInParams;
}

export default function ModeGate({ children, signInParams }: ModeGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'pending' });
  const [params, setParams] = useState<SignInParams>(signInParams ?? {});
  const mounted = useRef(true);

  const check = useCallback(async () => {
    const result = await getAccessState();
    if (!mounted.current) return;
    setState(
      result.access === 'signin'
        ? { kind: 'signin', overlay: false }
        : { kind: 'ready', hosted: result.hosted },
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();
    const unsubscribe = onSignInRequired(() => {
      if (!mounted.current) return;
      setState((s) => (s.kind === 'ready' ? { kind: 'signin', overlay: true } : s));
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [check]);

  const signedIn = state.kind === 'ready' && state.hosted;

  // Rolling session: hosted and signed in only. Self-host never loads the auth client.
  useEffect(() => {
    if (!signedIn) return;
    void refreshSession();
    const timer = setInterval(() => void refreshSession(), SESSION_REFRESH_MS);
    return () => clearInterval(timer);
  }, [signedIn]);

  const signedOut = useCallback(() => {
    // The URL values belonged to the first visit; a later sign-in screen starts clean.
    setParams({});
    setState({ kind: 'signin', overlay: false });
  }, []);

  if (state.kind === 'pending') {
    // Keyed so React never reuses this node for the first element of `children`
    // (same type, same position), which would leave a stray `style=""` behind.
    return <div key="mode-gate-pending" style={{ ...sharedBg, minHeight: '100vh' }} />;
  }

  if (state.kind === 'signin') {
    const signIn = (
      <SignIn
        invite={params.invite}
        inviteMalformed={params.inviteMalformed}
        error={params.error}
        overlay={state.overlay}
        onSignedIn={() => void check()}
      />
    );
    if (!state.overlay) return signIn;
    return (
      <>
        {children}
        {signIn}
      </>
    );
  }

  if (!state.hosted) return children;

  return (
    <>
      {children}
      <AccountPanel onSignedOut={signedOut} />
    </>
  );
}
