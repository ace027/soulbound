import { useState, type Dispatch, type SetStateAction } from 'react';
import type { QuestionnaireAnswers } from '@soulbound/shared';
import { QUESTIONS } from '../data/questions';
import { sharedBg } from './sharedBg';
import PrologueScreen from './PrologueScreen';
import { isPrologueEnabled } from '../lib/prologueFlag';

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
 * `if (!canAdvance) return;`. Legacy's last question called the completion
 * handler directly; since 2026-10-01 it opens a review step instead (below).
 *
 * One addition not in legacy (2026-09-25): a "Return to title" control above
 * the progress line, on every question, so a player can leave character
 * creation to load a save. "← Back" still only steps between questions.
 *
 * Additions not in legacy (2026-10-01), all screen-only — nothing here changes
 * what is sent to /api/unique-skill, so the validated prompt is untouched:
 *   - a one-line framing note above question 1 (answer as yourself),
 *   - a "A sentence or two is enough." guide under every answer box,
 *   - a REVIEW step after the last answer: the five answers in full, an Edit
 *     control on each, and the button that actually completes. Completing
 *     starts the paid calls and a soul has exactly one Unique Skill, so a
 *     typo in the last answer should not be final. The review state is local
 *     (App.tsx is untouched); Edit returns the player to the review, not to
 *     question 5, after changing an answer.
 * See docs/design-decisions-log.md → "Questionnaire screen fixes (2026-10-01)".
 *
 * Phase 14 (R36): the default export is now a thin wrapper. With `?prologue=1`
 * it renders `PrologueScreen`; otherwise it renders `QuestionnaireForm`, the
 * form below, unchanged. App.tsx is untouched and passes the same props.
 */

export interface QuestionnaireScreenProps {
  qIndex: number;
  setQIndex: (index: number) => void;
  answers: QuestionnaireAnswers;
  /** Legacy calls this with a functional updater, so it must be the setter. */
  setAnswers: Dispatch<SetStateAction<QuestionnaireAnswers>>;
  /** Legacy `handleQuestionnaireComplete(answers)`. */
  onComplete: (answers: QuestionnaireAnswers) => void;
  /**
   * Not in legacy (2026-09-25): back to the title screen, abandoning this new
   * chronicle. App clears the race, name and answers.
   */
  onReturnToTitle: () => void;
}

function QuestionnaireForm({
  qIndex,
  setQIndex,
  answers,
  setAnswers,
  onComplete,
  onReturnToTitle,
}: QuestionnaireScreenProps) {
  const [reviewing, setReviewing] = useState(false);
  // True while the player is changing one answer from the review, so the
  // primary button takes them straight back to it.
  const [returnToReview, setReturnToReview] = useState(false);

  const q = QUESTIONS[qIndex];
  const currentAnswer = answers[q.id] || "";
  const canAdvance = currentAnswer.trim().length > 0;
  const isLast = qIndex === QUESTIONS.length - 1;

  const returnToTitleButton = (
    <button
      type="button"
      onClick={onReturnToTitle}
      style={{
        background: "none", border: "none", color: "#6a5a40", padding: 0, marginBottom: 20,
        fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.12em",
        textTransform: "uppercase", cursor: "pointer",
      }}
    >
      ← Return to title
    </button>
  );

  if (reviewing) {
    return (
      <div style={{ ...sharedBg, padding: "32px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 600, width: "100%" }}>
          {returnToTitleButton}
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#7a1f1f", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>
            The World Voice Listens — Review
          </p>
          <div style={{ height: 2, background: "#2a2218", marginBottom: 32 }}>
            <div style={{ height: "100%", background: "#d4a843", width: "100%" }} />
          </div>
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#c9b48a", fontWeight: 600, marginBottom: 10, lineHeight: 1.4, fontStyle: "italic" }}>
            "This is what the World Voice will read."
          </h2>
          <p style={{ fontSize: 13, color: "#6a5a40", fontStyle: "italic", marginBottom: 24 }}>
            Change anything you like. Once you speak, your soul is set.
          </p>
          {QUESTIONS.map((question, i) => (
            <div key={question.id} style={{ background: "#0f0d09", border: "1px solid #2a2218", padding: "14px 16px", marginBottom: 12 }}>
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#6a5a40", letterSpacing: "0.08em", marginBottom: 8, lineHeight: 1.5 }}>
                {i + 1}. {question.text}
              </p>
              <p style={{ color: "#c9b48a", fontSize: 16, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 10 }}>
                {answers[question.id] || ""}
              </p>
              <button
                type="button"
                aria-label={`Edit answer ${i + 1}`}
                onClick={() => {
                  setQIndex(i);
                  setReturnToReview(true);
                  setReviewing(false);
                }}
                style={{
                  background: "none", border: "none", color: "#8a7a60", padding: 0,
                  fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.12em",
                  textTransform: "uppercase", cursor: "pointer",
                }}
              >
                Edit
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              onClick={() => {
                // After an Edit the index is that question, not the last one.
                setQIndex(QUESTIONS.length - 1);
                setReviewing(false);
              }}
              style={{
                background: "#0f0d09", border: "1px solid #2a2218", color: "#8a7a60",
                fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: "0.1em",
                padding: "12px 20px", cursor: "pointer", textTransform: "uppercase",
              }}
            >
              ← Back
            </button>
            <button
              onClick={() => onComplete(answers)}
              style={{
                flex: 1,
                background: "linear-gradient(135deg, #7a1f1f, #4a1010)",
                border: "1px solid #c0392b",
                color: "#c9b48a",
                fontFamily: "'Cinzel', serif", fontSize: 13, letterSpacing: "0.12em",
                padding: "13px 24px", cursor: "pointer",
                textTransform: "uppercase",
                animation: "glowPulse 2s infinite",
              }}
            >
              Speak to the World Voice
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...sharedBg, padding: "32px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 600, width: "100%" }}>
        {returnToTitleButton}
        {qIndex === 0 && (
          <p style={{ fontSize: 14, color: "#8a7a60", fontStyle: "italic", lineHeight: 1.6, marginBottom: 20 }}>
            You are a soul about to be reborn. Answer as yourself — the World Voice reads who you are, not who you wish to seem.
          </p>
        )}
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
        <div style={{ background: "#0f0d09", border: "1px solid #2a2218", padding: "14px 16px", marginBottom: 8 }}>
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
        <p style={{ fontSize: 12, color: "#6a5a40", fontStyle: "italic", marginBottom: 16 }}>A sentence or two is enough.</p>
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
              if (returnToReview) {
                setReturnToReview(false);
                setReviewing(true);
              } else if (!isLast) {
                setQIndex(qIndex + 1);
              } else {
                setReviewing(true);
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
            {returnToReview ? "Back to review →" : !isLast ? "Continue →" : "Review your answers →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QuestionnaireScreen(props: QuestionnaireScreenProps) {
  return isPrologueEnabled() ? (
    <PrologueScreen onComplete={props.onComplete} onReturnToTitle={props.onReturnToTitle} />
  ) : (
    <QuestionnaireForm {...props} />
  );
}
