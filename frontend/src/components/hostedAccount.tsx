/**
 * How the hosted account controls reach the Soul Codex without touching
 * `App.tsx` (frozen since Phase 5).
 *
 * `ModeGate` sits outside `App`, so it can't pass props into the Codex. It
 * provides this context instead, and only in hosted mode. The Codex renders
 * `<HostedAccountSlot/>`, which shows `<AccountPanel/>` when the context is
 * set and renders nothing otherwise. With no provider (self-host, and every
 * pre-Phase-6 test) the Codex DOM is exactly what it was.
 */

import { createContext, useContext } from 'react';

import AccountPanel from './AccountPanel';

export interface HostedAccount {
  /** Called after a sign-out or a deletion: `ModeGate` shows sign-in. */
  onSignedOut: () => void;
}

export const HostedAccountContext = createContext<HostedAccount | null>(null);

export function HostedAccountSlot() {
  const account = useContext(HostedAccountContext);
  return account ? <AccountPanel onSignedOut={account.onSignedOut} /> : null;
}
