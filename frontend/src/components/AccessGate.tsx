/**
 * The deployer-issued access gate — Phase 5, R19.
 *
 * Wraps `<App/>` in `main.tsx` rather than adding a 17th `useState` to
 * `App.tsx` (03-CONTEXT/05-CONTEXT: `App.tsx` is a statement-for-statement
 * port and the most behaviour-sensitive file in the repo — this plan does not
 * open it for writing). On mount it calls `checkAccess()`:
 *
 *   - `'pending'` (the check hasn't resolved yet): render only the shared
 *     background, so the form never flashes on screen for an instant before
 *     a fast `'ok'`.
 *   - `'ok'` or `'unknown'`: render `children`. `'unknown'` (a network error,
 *     a 502 from Vite's dev proxy with no backend, a stray HTML body) fails
 *     OPEN in the UI — the backend enforces the gate regardless, and failing
 *     closed here would lock out any dev run started before the backend is
 *     up (05-CONTEXT.md derived fact 3; spec "UI when the check isn't a 401").
 *   - `'required'`: an inline form (never `window.prompt` — CLAUDE.md #1)
 *     collects the passphrase, top-aligned so a mobile keyboard (roughly
 *     300px) can't cover the input.
 *
 * It also subscribes to `onPassphraseRequired`, which `lib/api.ts` fires
 * after any 401 `PASSPHRASE_REQUIRED` mid-session (the deployer rotated the
 * passphrase). That re-shows the form as a fixed overlay ON TOP of `children`
 * rather than unmounting them, so in-progress game state survives — the
 * player re-enters the passphrase and their turn or creation retries.
 *
 * This component reaches neither browser storage nor the network directly —
 * only through `lib/passphrase.ts` and `lib/api.ts`'s `checkAccess`/
 * `setPassphrase`, per the directory mapping's rule for
 * `frontend/src/components/*`.
 *
 * Under `StrictMode` (`main.tsx`), React runs the mount effect twice in dev,
 * so a dev page load makes two `/api/access` calls. Both count against the
 * rate limit (default 30/min); harmless, and production builds make one.
 *
 * This passphrase is deployer-issued, not an Anthropic key, and it is NOT the
 * rejected paste-per-session BYOK (CLAUDE.md → Auth architecture).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { checkAccess } from '../lib/api';
import { clearPassphrase, onPassphraseRequired, setPassphrase } from '../lib/passphrase';
import { sharedBg } from '../screens/sharedBg';

type AccessState = 'pending' | 'ok' | 'required' | 'unknown';

/**
 * Mirrors the backend's own check (`backend/src/config.ts`,
 * `/^[\x20-\x7E]+$/`) so a non-ASCII value is rejected in the form, before
 * `setPassphrase` ever stores it. `fetch` throws a `TypeError` on a non-Latin-1
 * header value, which `checkAccess` has no way to distinguish from a network
 * failure — it comes back `'unknown'`, and without this guard the form would
 * dismiss itself into a state that can never recover (finding A).
 */
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

export interface AccessGateProps {
  children: React.ReactNode;
}

export default function AccessGate({ children }: AccessGateProps) {
  const [state, setState] = useState<AccessState>('pending');
  const [overlay, setOverlay] = useState(false);
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [checking, setChecking] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    checkAccess().then((result) => {
      if (mounted.current) setState(result);
    });
    const unsubscribe = onPassphraseRequired(() => {
      if (mounted.current) {
        setOverlay(true);
        setWrong(false);
        setInvalid(false);
        setUnreachable(false);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (checking) return;
    const trimmed = value.trim();
    setWrong(false);
    setUnreachable(false);
    if (!PRINTABLE_ASCII.test(trimmed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setChecking(true);
    setPassphrase(trimmed);
    const result = await checkAccess();
    if (!mounted.current) return;
    setChecking(false);
    if (result === 'required') {
      setWrong(true);
      return;
    }
    if (result === 'unknown') {
      clearPassphrase();
      setUnreachable(true);
      return;
    }
    setState(result);
    setOverlay(false);
    setWrong(false);
    setValue('');
  }

  if (state === 'pending') {
    return <div style={{ ...sharedBg, minHeight: '100vh' }} />;
  }

  const showForm = state === 'required' || overlay;

  return (
    <>
      {(state === 'ok' || state === 'unknown' || overlay) && children}
      {showForm && (
        <div
          style={{
            ...sharedBg,
            position: overlay ? 'fixed' : 'static',
            inset: overlay ? 0 : undefined,
            zIndex: overlay ? 1000 : undefined,
            minHeight: '100vh',
            display: 'flex',
            justifyContent: 'center',
            // Top-aligned, not vertically centred: a mobile on-screen
            // keyboard (roughly 300px) covers the bottom half of the
            // viewport, and the form must stay above it.
            alignItems: 'flex-start',
            padding: '48px 24px',
          }}
        >
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            style={{ width: '100%', maxWidth: 420, animation: 'fadeIn 0.7s ease-out' }}
          >
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <p
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: 11,
                  letterSpacing: '0.3em',
                  color: '#7a1f1f',
                  textTransform: 'uppercase',
                  margin: '0 0 10px',
                }}
              >
                Vaeltharion
              </p>
              <h1
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#c9b48a',
                  margin: '0 0 10px',
                  lineHeight: 1.2,
                }}
              >
                This chronicle is sealed
              </h1>
              <p style={{ fontSize: 13, color: '#6a5a40', margin: 0, lineHeight: 1.6 }}>
                Enter the passphrase given to you by whoever runs this server.
              </p>
            </div>

            {/* Filed sensibly by password managers, never shown or submitted for real. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="soulbound"
              readOnly
              hidden
              aria-hidden="true"
              tabIndex={-1}
            />

            <div
              style={{ display: 'flex', gap: 8, marginBottom: wrong || invalid || unreachable ? 8 : 20 }}
            >
              <input
                type={showValue ? 'text' : 'password'}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setInvalid(false);
                  setUnreachable(false);
                }}
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="Passphrase"
                aria-label="Passphrase"
                style={{
                  flex: 1,
                  background: '#0f0d09',
                  border: '1px solid #2a2218',
                  color: '#c9b48a',
                  fontFamily: "'EB Garamond', serif",
                  fontSize: 15,
                  padding: '12px 14px',
                }}
              />
              <button
                type="button"
                onClick={() => setShowValue((s) => !s)}
                style={{
                  background: '#14110d',
                  border: '1px solid #2a2218',
                  color: '#8a7a60',
                  fontFamily: "'Cinzel', serif",
                  fontSize: 10,
                  letterSpacing: '0.05em',
                  padding: '0 14px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {showValue ? 'Hide' : 'Show'}
              </button>
            </div>

            {invalid && (
              <p style={{ fontSize: 12, color: '#c0392b', margin: '0 0 20px' }}>
                Use only standard keyboard characters (A&ndash;Z, 0&ndash;9, punctuation).
              </p>
            )}

            {unreachable && (
              <p style={{ fontSize: 12, color: '#c0392b', margin: '0 0 20px' }}>
                Couldn&apos;t reach the server &mdash; try again.
              </p>
            )}

            {wrong && (
              <p style={{ fontSize: 12, color: '#c0392b', margin: '0 0 20px' }}>
                That passphrase didn&apos;t work.
              </p>
            )}

            <button
              type="submit"
              disabled={checking || value.trim() === ''}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #7a1f1f, #4a1010)',
                border: '1px solid #c0392b',
                color: '#c9b48a',
                fontFamily: "'Cinzel', serif",
                fontSize: 14,
                letterSpacing: '0.12em',
                padding: '15px 32px',
                cursor: 'pointer',
                textTransform: 'uppercase',
                opacity: checking || value.trim() === '' ? 0.6 : 1,
              }}
            >
              Enter
            </button>
          </form>
        </div>
      )}
    </>
  );
}
