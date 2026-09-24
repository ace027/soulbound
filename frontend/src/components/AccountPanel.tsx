/**
 * Hosted mode's account menu (Phase 6, R24a sign-out, R24d deletion). Rendered
 * by `ModeGate` only when `/api/access` said `Soulbound-Mode: hosted`, so a
 * self-host page never contains it.
 *
 * A small fixed button opens a panel with "Sign out" and "Delete account".
 * Deletion uses the project's inline arm -> Confirm/Cancel pattern (CLAUDE.md
 * #1), never a native dialog: the first tap only arms it and shows what will
 * happen; `DELETE /api/account` runs only from Confirm. After a 204 every
 * session is already revoked (06-05), so it goes straight back to sign-in
 * without retrying anything.
 *
 * Placement: the bottom-left corner, above the page. Both game layouts keep
 * their controls elsewhere at that height (the mobile tab bar is at the top,
 * the desktop Codex column's save/menu controls and the action bar's send
 * button sit above or to the right of it); checked at 390 px and 1280 px in
 * e2e/hosted.spec.ts screenshots. The panel is small and has no scroll region.
 */

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

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
  color: '#c9b48a',
  fontFamily: "'Cinzel', serif",
  fontSize: 11,
  letterSpacing: '0.08em',
  padding: '11px 14px',
  cursor: 'pointer',
  textTransform: 'uppercase',
  textAlign: 'left',
} satisfies CSSProperties;

const danger = { ...button, border: '1px solid #7a1f1f', color: '#e07a6a' } satisfies CSSProperties;

export default function AccountPanel({ onSignedOut }: AccountPanelProps) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<null | 'signout' | 'delete'>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const panelId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (open && !armed) firstItemRef.current?.focus();
  }, [open, armed]);

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  function close() {
    setOpen(false);
    setArmed(false);
    setFailed(null);
    toggleRef.current?.focus();
  }

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
    <div
      style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 900, fontFamily: "'EB Garamond', serif" }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) close();
      }}
    >
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Account"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 44,
            width: 260,
            maxWidth: 'calc(100vw - 24px)',
            boxSizing: 'border-box',
            background: '#0a0805',
            border: '1px solid #2a2218',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            padding: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          {!armed ? (
            <>
              <button
                ref={firstItemRef}
                type="button"
                disabled={busy}
                onClick={() => void handleSignOut()}
                style={button}
              >
                Sign out
              </button>
              <button
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
            </>
          ) : (
            <>
              <p role="alert" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#c9b48a' }}>
                {DELETE_WARNING_TEXT}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  ref={confirmRef}
                  type="button"
                  disabled={busy}
                  onClick={() => void handleConfirmDelete()}
                  style={{ ...danger, flex: 1, textAlign: 'center' }}
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
                  style={{ ...button, flex: 1, textAlign: 'center' }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {failed && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: '#c0392b' }}>
              {failed === 'signout'
                ? 'Couldn’t sign out — try again.'
                : 'Couldn’t delete your account — try again.'}
            </p>
          )}
        </div>
      )}
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        style={{
          background: '#0a0805',
          border: '1px solid #2a2218',
          color: '#8a7a60',
          fontFamily: "'Cinzel', serif",
          fontSize: 10,
          letterSpacing: '0.12em',
          padding: '9px 12px',
          cursor: 'pointer',
          textTransform: 'uppercase',
          opacity: 0.85,
        }}
      >
        Account
      </button>
    </div>
  );
}
