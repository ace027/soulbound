/**
 * Hosted mode's account controls (Phase 6, R24a sign-out, R24d deletion).
 *
 * Placement: an "Account" section at the end of the Soul Codex, after All
 * Skills, reached through `HostedAccountSlot` (see `hostedAccount.tsx`). That
 * puts it in the Codex tab on a phone and at the bottom of the sidebar on
 * desktop. It used to be a fixed button over the narration, which on a phone
 * covered the first line of story text (06-06 evidence, `game-390.png`). It
 * is inline, with no floating panel, so nothing can be clipped by the Codex's
 * own scroll region.
 *
 * "Sign out" and "Delete account" are always visible. Deletion uses the
 * project's inline arm -> Confirm/Cancel pattern (CLAUDE.md #1), never a
 * native dialog: the first tap only arms it and shows what will happen;
 * `DELETE /api/account` runs only from Confirm. After a 204 every session is
 * already revoked (06-05), so it goes straight back to sign-in without
 * retrying anything.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { deleteAccount } from '../lib/api';
import { signOut } from '../lib/authClient';

export const DELETE_WARNING_TEXT =
  'This deletes your account after 7 days. Signing in again before then cancels it.';

export interface AccountPanelProps {
  /** Called after a sign-out or a deletion: `ModeGate` shows sign-in. */
  onSignedOut: () => void;
}

const button = {
  width: '100%',
  background: '#14110d',
  border: '1px solid #2a2218',
  color: '#8a7a60',
  fontFamily: "'Cinzel', serif",
  fontSize: 10,
  letterSpacing: '0.1em',
  padding: '9px 12px',
  cursor: 'pointer',
  textTransform: 'uppercase',
  textAlign: 'center',
} satisfies CSSProperties;

const danger = { ...button, border: '1px solid #7a1f1f', color: '#e07a6a' } satisfies CSSProperties;

export default function AccountPanel({ onSignedOut }: AccountPanelProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<null | 'signout' | 'delete'>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasArmed = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
    else if (wasArmed.current) deleteRef.current?.focus();
    wasArmed.current = armed;
  }, [armed]);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const result = await signOut();
    if (!mounted.current) return;
    setBusy(false);
    if (result === 'ok') onSignedOut();
    else setFailed('signout');
  }

  async function handleConfirmDelete() {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    const result = await deleteAccount();
    if (!mounted.current) return;
    setBusy(false);
    if (result === 'ok') onSignedOut();
    else setFailed('delete');
  }

  return (
    <section
      aria-label="Account"
      style={{ padding: '0 14px 16px', flexShrink: 0, borderTop: '1px solid #1a1610', fontFamily: "'EB Garamond', serif" }}
    >
      <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: '#6a5a40', letterSpacing: '0.15em', textTransform: 'uppercase', margin: '10px 0 8px' }}>
        Account
      </p>
      {!armed ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => void handleSignOut()} style={button}>
            Sign out
          </button>
          <button
            ref={deleteRef}
            type="button"
            disabled={busy}
            onClick={() => {
              setFailed(null);
              setArmed(true);
            }}
            style={danger}
          >
            Delete account
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <p role="alert" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#c9b48a' }}>
            {DELETE_WARNING_TEXT}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              ref={confirmRef}
              type="button"
              disabled={busy}
              onClick={() => void handleConfirmDelete()}
              style={{ ...danger, flex: 1 }}
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setArmed(false);
                setFailed(null);
              }}
              style={{ ...button, flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {failed && (
        <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: '#c0392b' }}>
          {failed === 'signout'
            ? 'Couldn’t sign out — try again.'
            : 'Couldn’t delete your account — try again.'}
        </p>
      )}
    </section>
  );
}
