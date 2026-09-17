import type { Dispatch, SetStateAction } from 'react';
import type { QuestionnaireAnswers } from '@soulbound/shared';
import { QUESTIONS } from '../data/questions';
import { sharedBg } from './sharedBg';

/**
 * Soul questionnaire — five open-ended free-text questions.
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 1257-1332 (the
 * `if (phase === "questionnaire")` block through its closing brace). Inline
 * style objects are byte-identical. Deltas: the inline CSS block at legacy
 * 1263-1267 is dropped (index.css owns glowPulse and textarea:focus,
 * index.html owns the font link), `QUESTIONS` is imported from src/data, and
 * the four closed-over bindings become props — the state lives in App.tsx.
 *
 * Navigation semantics are legacy's, unimproved: `canAdvance` is the trimmed
 * length of the current answer, the Back button only renders past the first
 * question, and the primary button is both disabled and guarded by an early
 * `if (!canAdvance) return;`. On the last question it calls the completion
 * handler with the accumulated answers rather than advancing.
 */

export interface QuestionnaireScreenProps {
  qIndex: number;
  setQIndex: (index: number) => void;
  answers: QuestionnaireAnswers;
  /** Legacy calls this with a functional updater, so it must be the setter. */
  setAnswers: Dispatch<SetStateAction<QuestionnaireAnswers>>;
  /** Legacy `handleQuestionnaireComplete(answers)`. */
  onComplete: (answers: QuestionnaireAnswers) => void;
}

export default function QuestionnaireScreen({
  qIndex,
  setQIndex,
  answers,
  setAnswers,
  onComplete,
}: QuestionnaireScreenProps) {
  const q = QUESTIONS[qIndex];
  const currentAnswer = answers[q.id] || "";
  const canAdvance = currentAnswer.trim().length > 0;
  return (
    <div style={{ ...sharedBg, padding: "32px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 600, width: "100%" }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#7a1f1f", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>
          The World Voice Speaks — {qIndex + 1} / {QUESTIONS.length}
        </p>
        <div style={{ height: 2, background: "#2a2218", marginBottom: 32 }}>
          <div style={{ height: "100%", background: "#d4a843", width: `${(qIndex / QUESTIONS.length) * 100}%`, transition: "width 0.4s" }} />
        </div>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#c9b48a", fontWeight: 600, marginBottom: 10, lineHeight: 1.4, fontStyle: "italic" }}>
          "{q.text}"
        </h2>
        <p style={{ fontSize: 13, color: "#6a5a40", fontStyle: "italic", marginBottom: 24 }}>{q.hint}</p>
        <div style={{ background: "#0f0d09", border: "1px solid #2a2218", padding: "14px 16px", marginBottom: 16 }}>
          <textarea
            value={currentAnswer}
            onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
            placeholder="Write freely..."
            rows={6}
            style={{
              background: "transparent", border: "none", color: "#c9b48a",
              fontFamily: "'EB Garamond', serif", fontSize: 16, width: "100%",
              resize: "vertical", lineHeight: 1.7,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {qIndex > 0 && (
            <button
              onClick={() => setQIndex(qIndex - 1)}
              style={{
                background: "#0f0d09", border: "1px solid #2a2218", color: "#8a7a60",
                fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: "0.1em",
                padding: "12px 20px", cursor: "pointer", textTransform: "uppercase",
              }}
            >
              ← Back
            </button>
          )}
          <button
            onClick={() => {
              if (!canAdvance) return;
              if (qIndex < QUESTIONS.length - 1) {
                setQIndex(qIndex + 1);
              } else {
                onComplete(answers);
              }
            }}
            disabled={!canAdvance}
            style={{
              flex: 1,
              background: canAdvance ? "linear-gradient(135deg, #7a1f1f, #4a1010)" : "#1a1610",
              border: `1px solid ${canAdvance ? "#c0392b" : "#2a2218"}`,
              color: canAdvance ? "#c9b48a" : "#4a3a28",
              fontFamily: "'Cinzel', serif", fontSize: 13, letterSpacing: "0.12em",
              padding: "13px 24px", cursor: canAdvance ? "pointer" : "not-allowed",
              textTransform: "uppercase",
              animation: canAdvance ? "glowPulse 2s infinite" : "none",
            }}
          >
            {qIndex < QUESTIONS.length - 1 ? "Continue →" : "Speak to the World Voice"}
          </button>
        </div>
      </div>
    </div>
  );
}
