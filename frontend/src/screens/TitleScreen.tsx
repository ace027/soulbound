import type { SaveIndexEntry } from '@soulbound/shared';
import { sharedBg } from './sharedBg';

/**
 * Title screen with its inline save browser.
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 1046-1183 (the
 * `if (phase === "title")` block through its closing brace). Inline style
 * objects are byte-identical; the only deltas are the ones enumerated in the
 * port report: the inline CSS block at legacy 1051-1058 is dropped (index.css
 * owns the keyframes and the .save-card rule, index.html owns the font link),
 * and the three closed-over handlers become props so the screen stays
 * presentational — the state lives in App.tsx.
 *
 * CLAUDE.md #1: the Delete action is tap-to-arm. Tapping ✕ sets
 * `confirmDeleteId` and swaps the button group for inline Confirm/Cancel;
 * only Confirm calls `onDeleteSave`. Never substitute a native browser dialog
 * (confirm/alert/prompt) — those silently failed to render in the artifact's
 * sandboxed iframe, which is why the project standardised on this pattern.
 */

/** Legacy lines 56-61, verbatim. */
function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

export interface TitleScreenProps {
  saveIndex: SaveIndexEntry[];
  /** Slot id currently armed for deletion, or null. Owned by App.tsx. */
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  onLoadSave: (id: string) => void;
  onDeleteSave: (id: string) => void;
  onNewGame: () => void;
}

export default function TitleScreen({
  saveIndex,
  confirmDeleteId,
  setConfirmDeleteId,
  onLoadSave,
  onDeleteSave,
  onNewGame,
}: TitleScreenProps) {
  const hasSaves = saveIndex.length > 0;
  const sorted = [...saveIndex].sort((a, b) => b.savedAt - a.savedAt);
  return (
    <div style={{ ...sharedBg, minHeight: "100vh", padding: "40px 24px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", animation: "fadeIn 0.7s ease-out" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: hasSaves ? 40 : 56 }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.3em", color: "#7a1f1f", textTransform: "uppercase", margin: "0 0 10px" }}>Vaeltharion</p>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: 28, color: "#d4a843", animation: "breathe 3s infinite", marginBottom: 10 }}>✦</div>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 30, fontWeight: 700, color: "#c9b48a", margin: "0 0 10px", lineHeight: 1.2 }}>The Soulbound Chronicles</h1>
          <p style={{ fontSize: 14, color: "#6a5a40", margin: 0, lineHeight: 1.7, fontStyle: "italic" }}>
            Power is not learned here. It is remembered by the soul.
          </p>
        </div>

        {/* Saved Chronicles */}
        {hasSaves && (
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#6a5a40", letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 12px" }}>
              Saved Chronicles
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sorted.map(save => (
                <div key={save.id} className="save-card" style={{
                  background: "#0f0d09", border: "1px solid #2a2218",
                  padding: "14px 16px", display: "flex", alignItems: "center", gap: 14,
                  transition: "all 0.15s", cursor: "pointer",
                }}>
                  {/* Click the left area to load */}
                  <div style={{ flex: 1 }} onClick={() => onLoadSave(save.id)}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#d4a843" }}>{save.name}</span>
                      <span style={{ fontSize: 12, color: "#6a5a40" }}>{save.race}</span>
                    </div>
                    {save.uniqueSkill && (
                      <p style={{ fontSize: 12, color: "#8a7060", margin: "0 0 4px", fontStyle: "italic" }}>✦ {save.uniqueSkill}</p>
                    )}
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "#5a4a30" }}>{save.location}</span>
                      <span style={{ fontSize: 11, color: "#4a3a28" }}>{save.skillCount} skills</span>
                      <span style={{ fontSize: 11, color: "#4a3a28" }}>{fmtDate(save.savedAt)}</span>
                    </div>
                  </div>
                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {confirmDeleteId === save.id ? (
                      <>
                        <button
                          onClick={() => onDeleteSave(save.id)}
                          style={{
                            background: "#7a1f1f", border: "1px solid #c0392b", color: "#f0d8d8",
                            fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                            padding: "7px 12px", cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          style={{
                            background: "#14110d", border: "1px solid #2a2218", color: "#8a7a60",
                            fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                            padding: "7px 10px", cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => onLoadSave(save.id)}
                          style={{
                            background: "linear-gradient(135deg, #7a1f1f, #4a1010)",
                            border: "1px solid #c0392b", color: "#c9b48a",
                            fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                            padding: "7px 14px", cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          Continue
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(save.id)}
                          style={{
                            background: "#14110d", border: "1px solid #2a2218", color: "#5a4a38",
                            fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                            padding: "7px 10px", cursor: "pointer", textTransform: "uppercase",
                          }}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Divider if saves exist */}
        {hasSaves && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: "#2a2218" }} />
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#4a3a28", letterSpacing: "0.15em", textTransform: "uppercase" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#2a2218" }} />
          </div>
        )}

        {/* New Game */}
        <button
          onClick={() => onNewGame()}
          style={{
            width: "100%",
            background: hasSaves ? "#0f0d09" : "linear-gradient(135deg, #7a1f1f, #4a1010)",
            border: `1px solid ${hasSaves ? "#2a2218" : "#c0392b"}`,
            color: "#c9b48a",
            fontFamily: "'Cinzel', serif", fontSize: 14, letterSpacing: "0.12em",
            padding: "15px 32px", cursor: "pointer", textTransform: "uppercase",
            animation: hasSaves ? "none" : "glowPulse 2.5s infinite",
          }}
        >
          {hasSaves ? "+ Begin New Chronicle" : "✦ Begin Your Chronicle"}
        </button>
      </div>
    </div>
  );
}
