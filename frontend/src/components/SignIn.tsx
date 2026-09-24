/**
 * Hosted mode's sign-in screen (Phase 6, R24a/R24c). Rendered only by
 * `ModeGate`, and only on a 401 `SIGN_IN_REQUIRED`, so self-host never sees it.
 *
 * Its URL inputs arrive as props: `main.tsx` has already taken `#invite=CODE`
 * and Better Auth's `?error=CODE` out of the address bar before anything
 * rendered (lib/authClient.ts `takeSignInParams`).
 *
 * The flow, as an invited player sees it:
 *   1. With an invite, it redeems the code once (this sets the short-lived
 *      invite cookie that sign-up needs) and says whether it worked.
 *   2. Email ("Send me a sign-in link"), or Google, or Discord.
 *   3. After a send: "Check your email — open the link in this browser",
 *      whatever the server did (its answer is identical by design).
 * A returning player just does step 2: the server decides who may sign in.
 *
 * Error text is fixed per KNOWN code (`ERROR_MESSAGES`). The raw `error`
 * value from the URL is never rendered. A refused sign-up still uses up the
 * emailed link (Better Auth consumes it before the invite check runs, 06-03),
 * so those errors offer "Send me a new link".
 *
 * Styling mirrors `AccessGate` (same palette, top-aligned so a mobile keyboard
 * can't cover the input). No flex scroll region here: the full-screen version
 * is a normal block that grows with the page, and the overlay version is its
 * own `overflow-y: auto` block, so there is no flex ancestor for CLAUDE.md #3
 * to catch. Never a native dialog (CLAUDE.md #1).
 */

import { INVITE_INVALID, INVITE_REQUIRED } from '@soulbound/shared';
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';

import { redeemInvite } from '../lib/api';
import { signInWithEmail, signInWithProvider } from '../lib/authClient';
import { sharedBg } from '../screens/sharedBg';

export const INVITE_INVALID_TEXT =
  "That invite link isn't valid or has expired. Ask whoever invited you for a new one.";
export const CROSS_DEVICE_TEXT =
  'An invite is needed to create an account, and this browser has none. Open the sign-in link in the same browser where you opened your invite link. If the invite has since expired, ask for a new one.';
export const LINK_USED_TEXT = 'That sign-in link has expired or was already used.';
export const GENERIC_ERROR_TEXT = "Sign-in didn't complete. Please try again.";

/** Only these codes get their own text. Every other code gets `GENERIC_ERROR_TEXT`. */
const ERROR_MESSAGES: Record<string, { text: string; newLink: boolean }> = {
  [INVITE_REQUIRED]: { text: CROSS_DEVICE_TEXT, newLink: true },
  [INVITE_INVALID]: { text: INVITE_INVALID_TEXT, newLink: false },
  INVALID_TOKEN: { text: LINK_USED_TEXT, newLink: true },
  EMAIL_REQUIRED: {
    text: "Your sign-in provider didn't share an email address. Try another way to sign in.",
    newLink: false,
  },
  EMAIL_NOT_VERIFIED: {
    text: "Your sign-in provider hasn't verified this email address. Verify it there, or use an email link.",
    newLink: false,
  },
};

/** The message for a URL error code. Never returns the code itself. */
export function messageForError(code: string): { text: string; newLink: boolean } {
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code]! : { text: GENERIC_ERROR_TEXT, newLink: false };
}

type InviteStatus = 'none' | 'checking' | 'ok' | 'invalid' | 'error';
type Step = 'email' | 'error' | 'sent';

export interface SignInProps {
  invite?: string;
  inviteMalformed?: boolean;
  error?: string;
  /** True when shown over a still-mounted game (session expired mid-game). */
  overlay?: boolean;
  /** Ask `ModeGate` to check access again (e.g. after signing in from another tab). */
  onSignedIn: () => void;
}

const palette = {
  label: { fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: '0.1em', color: '#8a7a60', textTransform: 'uppercase' },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#0f0d09',
    border: '1px solid #2a2218',
    color: '#c9b48a',
    fontFamily: "'EB Garamond', serif",
    fontSize: 15,
    padding: '12px 14px',
  },
  primary: {
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
  },
  secondary: {
    width: '100%',
    background: '#14110d',
    border: '1px solid #2a2218',
    color: '#c9b48a',
    fontFamily: "'Cinzel', serif",
    fontSize: 12,
    letterSpacing: '0.08em',
    padding: '13px 20px',
    cursor: 'pointer',
    textTransform: 'uppercase',
  },
  body: { fontSize: 14, color: '#8a7a60', margin: '0 0 20px', lineHeight: 1.6 },
  error: { fontSize: 13, color: '#c0392b', margin: '0 0 20px', lineHeight: 1.6 },
} satisfies Record<string, CSSProperties>;

export default function SignIn({ invite, inviteMalformed, error, overlay, onSignedIn }: SignInProps) {
  const initialError = error ? messageForError(error) : null;
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>(
    inviteMalformed ? 'invalid' : invite ? 'checking' : 'none',
  );
  const [step, setStep] = useState<Step>(initialError?.newLink ? 'error' : 'email');
  const [errorText, setErrorText] = useState<string | null>(initialError?.text ?? null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [providerFailed, setProviderFailed] = useState(false);
  const redeemStarted = useRef(false);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const emailId = useId();

  const redeem = async (code: string) => {
    setInviteStatus('checking');
    const result = await redeemInvite(code);
    if (mounted.current) setInviteStatus(result);
  };

  useEffect(() => {
    mounted.current = true;
    // Exactly once per screen, even under StrictMode's doubled mount effect.
    if (invite && !inviteMalformed && !redeemStarted.current) {
      redeemStarted.current = true;
      void redeem(invite);
    }
    return () => {
      mounted.current = false;
    };
    // Deliberately no dependencies: run once, for the invite this screen was given.
  }, []);

  // Move focus with the step, so a keyboard or screen-reader user lands on what changed.
  // Keyed on the previous step rather than a first-run flag, so StrictMode's
  // doubled effect doesn't focus the field on mount (and pop a phone keyboard).
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    if (step === 'email') emailRef.current?.focus();
    else headingRef.current?.focus();
  }, [step]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (busy || trimmed === '') return;
    setBusy(true);
    setUnreachable(false);
    const result = await signInWithEmail(trimmed);
    if (!mounted.current) return;
    setBusy(false);
    if (result === 'error') {
      setUnreachable(true);
      return;
    }
    setErrorText(null);
    setStep('sent');
  }

  async function handleProvider(provider: 'google' | 'discord') {
    if (busy) return;
    setBusy(true);
    setProviderFailed(false);
    const result = await signInWithProvider(provider);
    if (!mounted.current) return;
    // On success the browser is already leaving; stay busy so nothing is clicked twice.
    if (result === 'error') {
      setBusy(false);
      setProviderFailed(true);
    }
  }

  const inviteChecking = inviteStatus === 'checking';
  const heading =
    step === 'sent' ? 'Check your email' : step === 'error' ? 'That link didn’t work' : 'Enter the chronicle';

  return (
    <div
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-labelledby={overlay ? `${emailId}-heading` : undefined}
      style={{
        ...sharedBg,
        ...(overlay
          ? { position: 'fixed', inset: 0, zIndex: 1000, overflowY: 'auto' }
          : { minHeight: '100vh' }),
        padding: '48px 24px',
        boxSizing: 'border-box',
      }}
    >
      <main style={{ width: '100%', maxWidth: 420, margin: '0 auto', animation: 'fadeIn 0.7s ease-out' }}>
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
            id={`${emailId}-heading`}
            ref={headingRef}
            tabIndex={-1}
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: 22,
              fontWeight: 700,
              color: '#c9b48a',
              margin: '0 0 10px',
              lineHeight: 1.2,
              outline: 'none',
            }}
          >
            {heading}
          </h1>
          {step === 'email' && (
            <p style={{ fontSize: 13, color: '#6a5a40', margin: 0, lineHeight: 1.6 }}>
              {overlay ? 'Your session has ended. Sign in again to carry on.' : 'Sign in to continue your chronicle.'}
            </p>
          )}
        </div>

        <div role="status" aria-live="polite">
          {inviteChecking && <p style={palette.body}>Checking your invite&hellip;</p>}
          {inviteStatus === 'ok' && step === 'email' && (
            <p style={palette.body}>Your invite is ready. Sign in below to create your account.</p>
          )}
        </div>
        {inviteStatus === 'invalid' && (
          <p role="alert" style={palette.error}>
            {INVITE_INVALID_TEXT}
          </p>
        )}
        {inviteStatus === 'error' && invite && (
          <div style={{ marginBottom: 20 }}>
            <p role="alert" style={{ ...palette.error, margin: '0 0 10px' }}>
              Couldn&apos;t reach the server to check your invite.
            </p>
            <button type="button" onClick={() => void redeem(invite)} style={palette.secondary}>
              Check my invite again
            </button>
          </div>
        )}

        {step === 'error' && (
          <>
            <p role="alert" style={palette.error}>
              {errorText}
            </p>
            <button
              type="button"
              onClick={() => {
                setErrorText(null);
                setStep('email');
              }}
              style={palette.primary}
            >
              Send me a new link
            </button>
          </>
        )}

        {step === 'sent' && (
          <>
            <p style={palette.body}>
              Check your email &mdash; open the link in this browser. It works once, for a short time.
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              <button type="button" onClick={onSignedIn} style={palette.secondary}>
                I&apos;ve signed in &mdash; continue
              </button>
              <button type="button" onClick={() => setStep('email')} style={palette.secondary}>
                Use a different email
              </button>
            </div>
          </>
        )}

        {step === 'email' && (
          <>
            {errorText && (
              <p role="alert" style={palette.error}>
                {errorText}
              </p>
            )}
            <form onSubmit={(e) => void handleSend(e)} style={{ marginBottom: 24 }}>
              <label htmlFor={emailId} style={{ ...palette.label, display: 'block', marginBottom: 8 }}>
                Email address
              </label>
              <input
                id={emailId}
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setUnreachable(false);
                }}
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                required
                style={{ ...palette.input, marginBottom: unreachable ? 8 : 16 }}
              />
              {unreachable && (
                <p role="alert" style={{ ...palette.error, margin: '0 0 16px' }}>
                  Couldn&apos;t reach the server &mdash; try again.
                </p>
              )}
              <button
                type="submit"
                disabled={busy || inviteChecking || email.trim() === ''}
                style={{ ...palette.primary, opacity: busy || inviteChecking || email.trim() === '' ? 0.6 : 1 }}
              >
                Send me a sign-in link
              </button>
            </form>

            <p
              aria-hidden="true"
              style={{ textAlign: 'center', fontSize: 12, color: '#6a5a40', margin: '0 0 16px', letterSpacing: '0.2em' }}
            >
              &mdash; or &mdash;
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                disabled={busy || inviteChecking}
                onClick={() => void handleProvider('google')}
                style={{ ...palette.secondary, opacity: busy || inviteChecking ? 0.6 : 1 }}
              >
                Continue with Google
              </button>
              <button
                type="button"
                disabled={busy || inviteChecking}
                onClick={() => void handleProvider('discord')}
                style={{ ...palette.secondary, opacity: busy || inviteChecking ? 0.6 : 1 }}
              >
                Continue with Discord
              </button>
            </div>
            {providerFailed && (
              <p role="alert" style={{ ...palette.error, margin: '12px 0 0' }}>
                That sign-in option isn&apos;t available right now. Try another.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
