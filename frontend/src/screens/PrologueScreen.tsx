import { useEffect, useRef, useState } from 'react';
import {
  PROLOGUE_BEAT_COUNT,
  PROLOGUE_OPENING,
  type PrologueHistoryEntry,
  type QuestionnaireAnswers,
} from '@soulbound/shared';
import { prologueBeat, prologueProfile } from '../lib/api';
import { prologueCanon } from '../lib/prologueFlag';
import { sharedBg } from './sharedBg';

/**
 * The prologue (Phase 14, R36): an opt-in, behaviour-based alternative to the
 * questionnaire. A fixed four-beat threshold scene, narrated reactively by
 * /api/prologue/beat, is distilled by /api/prologue/profile into the same five
 * `answers` keys the questionnaire produces, then handed to `onComplete` once.
 * App.tsx cannot tell the difference, which is why it needs no change.
 *
 * Only rendered when `?prologue=1` (see QuestionnaireScreen). Stores nothing:
 * no browser storage, no setAnswers. A reload starts the scene over.
 *
 * The screen trusts its own count: the scene is final when four player actions
 * have been answered, whatever `response.final` says, and `response.beat` is
 * ignored. The page scrolls like the questionnaire review; there is no nested
 * overflow container, so CLAUDE.md #3 is not engaged.
 *
 * The "Copy scene record" control is the playtest kit's transcript hook. It
 * lives only here, so it exists only with the flag on, and the record never
 * includes the profile.
 */

export interface PrologueScreenProps {
  onComplete: (answers: QuestionnaireAnswers) => void;
  onReturnToTitle: () => void;
}

type Status = 'idle' | 'reading' | 'distilling';

const WRAP = { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } as const;

/** The plain-text record a playtester pastes back. Never contains the profile. */
function buildSceneRecord(history: PrologueHistoryEntry[], canon: string): string {
  const lines = [
    'THE SOULBOUND CHRONICLES — PROLOGUE SCENE RECORD',
    `canon: ${canon}`,
    '',
    `OPENING: ${history[0]?.text ?? ''}`,
  ];
  for (let i = 1; i <= PROLOGUE_BEAT_COUNT; i++) {
    lines.push('', `ACTION ${i}: ${history[2 * i - 1]?.text ?? ''}`, `BEAT ${i}: ${history[2 * i]?.text ?? ''}`);
  }
  return lines.join('\n');
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function PrologueScreen({ onComplete, onReturnToTitle }: PrologueScreenProps) {
  const [history, setHistory] = useState<PrologueHistoryEntry[]>([
    { role: 'narrator', text: PROLOGUE_OPENING },
  ]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [recordText, setRecordText] = useState<string | null>(null);

  // Synchronous guards: a state check alone is stale between two clicks that
  // land before React re-renders.
  const busyRef = useRef(false);
  const completedRef = useRef(false);
  const focusRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const turns = history.filter((e) => e.role === 'player').length;
  // The fourth action is answered once status leaves 'reading'.
  const sceneDone = turns >= PROLOGUE_BEAT_COUNT && status !== 'reading';
  const canAct = input.trim().length > 0 && status === 'idle';

  useEffect(() => {
    // Not on mount: with only the opening shown there is nothing new to reveal,
    // and scrolling then opened the page 64 px down (found by the 14-04 e2e).
    if (history.length <= 1 && error === null) return;
    const end = endRef.current;
    if (end && typeof end.scrollIntoView === 'function') end.scrollIntoView({ block: 'nearest' });
  }, [history.length, error]);

  useEffect(() => {
    if (status === 'idle' && focusRef.current) {
      focusRef.current = false;
      inputRef.current?.focus();
    }
  }, [status, history.length]);

  async function act() {
    if (busyRef.current || status !== 'idle' || turns >= PROLOGUE_BEAT_COUNT) return;
    const text = input.trim();
    if (text.length === 0) return;
    busyRef.current = true;
    const before = history;
    const next: PrologueHistoryEntry[] = [...before, { role: 'player', text }];
    setHistory(next);
    setInput('');
    setError(null);
    setStatus('reading');
    try {
      const response = await prologueBeat(next);
      setHistory([...next, { role: 'narrator', text: response.narration }]);
    } catch (e) {
      // Drop the player entry and give the player their words back to retry.
      setHistory(before);
      setInput(input);
      setError(`The World Voice fell silent. ${messageOf(e)}`);
    } finally {
      busyRef.current = false;
      focusRef.current = true;
      setStatus('idle');
    }
  }

  async function letItTakeHold() {
    if (busyRef.current || completedRef.current || !sceneDone) return;
    busyRef.current = true;
    setError(null);
    setStatus('distilling');
    try {
      const profile = await prologueProfile(history, prologueCanon());
      completedRef.current = true;
      onComplete(profile);
    } catch (e) {
      setError(`The World Voice fell silent. ${messageOf(e)}`);
      setStatus('idle');
    } finally {
      busyRef.current = false;
    }
  }

  async function copyRecord() {
    const record = buildSceneRecord(history, prologueCanon());
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(record);
      setRecordText(null);
      setCopyNote('Scene record copied.');
    } catch {
      setRecordText(record);
      setCopyNote('Could not copy automatically — select the text below.');
    }
  }

  const primaryButton = (enabled: boolean) =>
    ({
      flex: 1,
      background: enabled ? 'linear-gradient(135deg, #7a1f1f, #4a1010)' : '#1a1610',
      border: `1px solid ${enabled ? '#c0392b' : '#2a2218'}`,
      color: enabled ? '#c9b48a' : '#4a3a28',
      fontFamily: "'Cinzel', serif",
      fontSize: 13,
      letterSpacing: '0.12em',
      padding: '13px 24px',
      cursor: enabled ? 'pointer' : 'not-allowed',
      textTransform: 'uppercase',
      animation: enabled ? 'glowPulse 2s infinite' : 'none',
    }) as const;

  return (
    <div style={{ ...sharedBg, padding: '32px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{ maxWidth: 600, width: '100%' }}>
        <button
          type="button"
          onClick={onReturnToTitle}
          style={{
            background: 'none', border: 'none', color: '#6a5a40', padding: 0, marginBottom: 20,
            fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: '0.12em',
            textTransform: 'uppercase', cursor: 'pointer',
          }}
        >
          ← Return to title
        </button>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: '#7a1f1f', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 4 }}>
          The World Voice Speaks — The Threshold
        </p>
        <div style={{ height: 2, background: '#2a2218', marginBottom: 32 }}>
          <div style={{ height: '100%', background: '#d4a843', width: `${(Math.min(turns, PROLOGUE_BEAT_COUNT) / PROLOGUE_BEAT_COUNT) * 100}%`, transition: 'width 0.4s' }} />
        </div>

        <div>
          {history.map((entry, i) =>
            entry.role === 'narrator' ? (
              <p key={i} style={{ ...WRAP, color: '#c9b48a', fontStyle: 'italic', fontSize: 17, lineHeight: 1.7, marginBottom: 18 }}>
                {entry.text}
              </p>
            ) : (
              <p key={i} style={{ ...WRAP, color: '#8a7a60', fontSize: 15, lineHeight: 1.7, marginBottom: 18 }}>
                You — {entry.text}
              </p>
            ),
          )}
          <div ref={endRef} />
        </div>

        <p aria-live="polite" style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: '#8a7a60', letterSpacing: '0.1em', fontStyle: 'italic', minHeight: status === 'idle' ? 0 : 18, marginBottom: status === 'idle' ? 0 : 12 }}>
          {status === 'reading' ? 'The dark answers...' : status === 'distilling' ? 'The dark takes hold...' : ''}
        </p>

        {error !== null && (
          <p role="alert" style={{ ...WRAP, fontSize: 14, color: '#c0392b', lineHeight: 1.6, marginBottom: 16 }}>
            {error}
          </p>
        )}

        {!sceneDone && (
          <>
            <div style={{ background: '#0f0d09', border: '1px solid #2a2218', padding: '14px 16px', marginBottom: 8 }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={status !== 'idle'}
                maxLength={2000}
                placeholder="Say or do anything..."
                rows={4}
                style={{
                  background: 'transparent', border: 'none', color: '#c9b48a',
                  fontFamily: "'EB Garamond', serif", fontSize: 16, width: '100%',
                  resize: 'vertical', lineHeight: 1.7, ...WRAP,
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: '#6a5a40', fontStyle: 'italic', marginBottom: 16 }}>
              A sentence or two is enough. Say or do anything.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={act} disabled={!canAct} style={primaryButton(canAct)}>
                Act →
              </button>
            </div>
          </>
        )}

        {sceneDone && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={copyRecord}
                style={{
                  background: '#0f0d09', border: '1px solid #2a2218', color: '#8a7a60',
                  fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: '0.1em',
                  padding: '12px 20px', cursor: 'pointer', textTransform: 'uppercase',
                }}
              >
                Copy scene record
              </button>
              <button
                type="button"
                onClick={letItTakeHold}
                disabled={status === 'distilling'}
                style={primaryButton(status !== 'distilling')}
              >
                Let it take hold →
              </button>
            </div>
            {copyNote !== null && (
              <p style={{ fontSize: 12, color: '#8a7a60', fontStyle: 'italic', marginTop: 12 }}>{copyNote}</p>
            )}
            {recordText !== null && (
              <textarea
                readOnly
                aria-label="Scene record"
                value={recordText}
                rows={10}
                style={{
                  marginTop: 8, width: '100%', background: '#0f0d09', border: '1px solid #2a2218',
                  color: '#c9b48a', fontFamily: "'EB Garamond', serif", fontSize: 14, ...WRAP,
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
