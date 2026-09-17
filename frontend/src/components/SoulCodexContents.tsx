import type { GameState, Skill } from '@soulbound/shared';
import SkillCard from './SkillCard';
import type { Phase } from '../App';

/**
 * Soul Codex — the sidebar (desktop) / Codex tab (mobile) contents.
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 568-654 (`function
 * SoulCodexContents` through its closing brace). Inline styles are
 * byte-identical.
 *
 * Kept presentational per the plan: it never touches storage or the API
 * itself. `handleManualSave` and `setPhase` are passed in from App.tsx,
 * exactly as legacy closes over them.
 *
 * `uniqueSkill` here is `gameState.skills.find(s => s.tier === "Unique")`
 * (legacy 447, 1347) — a `Skill`, not the `UniqueSkillDetermination` that
 * `WorldLog`'s `etchingSkill` carries. The two are different shapes on
 * purpose; see the LogEntry.etchingSkill comment in shared/src/gameState.ts.
 */
export interface SoulCodexContentsProps {
  gameState: GameState;
  uniqueSkill: Skill | undefined;
  newSkillIds: Set<string>;
  /** Legacy `useState("")`, values `"" | "saving" | "saved"` (legacy 800). */
  savingStatus: '' | 'saving' | 'saved';
  handleManualSave: () => void;
  setPhase: (phase: Phase) => void;
}

export default function SoulCodexContents({
  gameState,
  uniqueSkill,
  newSkillIds,
  savingStatus,
  handleManualSave,
  setPhase,
}: SoulCodexContentsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #2a2218", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#7a1f1f", letterSpacing: "0.2em", textTransform: "uppercase", margin: 0 }}>Soul Codex</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              fontSize: 10, color: savingStatus === "saving" ? "#8a7060" : "#4a8a4a",
              fontStyle: "italic", opacity: savingStatus ? 1 : 0, transition: "opacity 0.3s",
              fontFamily: "'EB Garamond', serif",
            }}>
              {savingStatus === "saving" ? "saving..." : "✓ saved"}
            </span>
            <button onClick={handleManualSave} style={{
              background: "#14110d", border: "1px solid #2a2218", color: "#8a7a60",
              fontFamily: "'Cinzel', serif", fontSize: 9, letterSpacing: "0.1em",
              padding: "3px 8px", cursor: "pointer", textTransform: "uppercase",
            }}>
              + Slot
            </button>
            <button onClick={() => setPhase("title")} title="Return to title" style={{
              background: "none", border: "none", color: "#4a3a28", fontSize: 14,
              cursor: "pointer", padding: 0, lineHeight: 1,
            }}>⌂</button>
          </div>
        </div>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#d4a843", margin: "0 0 1px" }}>{gameState.character.name}</h2>
        <p style={{ fontSize: 12, color: "#8a7a60", margin: 0 }}>{gameState.character.race.name}</p>
      </div>

      {/* Location */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #1a1610", flexShrink: 0 }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#6a5a40", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 2px" }}>Location</p>
        <p style={{ fontSize: 12, color: "#a09070", margin: 0, lineHeight: 1.4 }}>{gameState.location}</p>
      </div>

      {/* Unique Skill */}
      {uniqueSkill && (
        <div style={{
          margin: "10px 14px", padding: "10px", flexShrink: 0,
          border: "1px solid #d4a84344",
          background: "linear-gradient(135deg, #1a1608, #0f0d07)",
          animation: "soulPulse 3s infinite",
        }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#d4a84399", letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 3px" }}>Unique Skill</p>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: "#d4a843", margin: "0 0 4px" }}>{uniqueSkill.name}</p>
          <p style={{ fontSize: 11, color: "#8a7060", margin: "0 0 6px", lineHeight: 1.4 }}>{uniqueSkill.description}</p>
          {uniqueSkill.soul_resonance && (
            <p style={{ fontSize: 10, color: "#6a5a40", margin: "0 0 8px", lineHeight: 1.4, fontStyle: "italic" }}>✦ {uniqueSkill.soul_resonance}</p>
          )}
          <div style={{ background: "#1a1610", height: 2, borderRadius: 1 }}>
            <div style={{ background: "linear-gradient(90deg, #d4a84388, #d4a843)", width: `${uniqueSkill.mastery}%`, height: "100%", transition: "width 1s" }} />
          </div>
          <p style={{ fontSize: 10, color: "#6a5a40", margin: "3px 0 0", textAlign: "right" }}>{uniqueSkill.mastery}/100</p>

          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2218" }}>
            <p style={{ fontFamily: "'Cinzel', serif", fontSize: 8, color: "#6a5a40", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 6px" }}>Sub-Abilities</p>
            {uniqueSkill.sub_abilities?.map((sa, i) => (
              <div key={i} style={{ marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #d4a843" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#d4a843" }}>{sa.name}</span>
                  <span style={{ fontSize: 9, color: "#5a4a30" }}>@{sa.unlock_mastery}</span>
                </div>
                <p style={{ fontSize: 10, color: "#8a7060", margin: "2px 0 0", lineHeight: 1.4 }}>{sa.description}</p>
              </div>
            ))}
            {(!uniqueSkill.sub_abilities || uniqueSkill.sub_abilities.length < 3) && (
              <p style={{ fontSize: 10, color: "#4a3a28", fontStyle: "italic", margin: uniqueSkill.sub_abilities?.length ? "4px 0 0" : 0 }}>
                🔒 {3 - (uniqueSkill.sub_abilities?.length || 0)} more sleep, waiting to be discovered...
              </p>
            )}
          </div>
        </div>
      )}

      {/* All Skills */}
      <div style={{ padding: "0 14px 16px", flexShrink: 0 }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#6a5a40", letterSpacing: "0.15em", textTransform: "uppercase", margin: "10px 0 8px" }}>All Skills</p>
        {gameState.skills.filter(s => s.tier !== "Unique").map(skill => (
          <SkillCard key={skill.name} skill={skill} isNew={newSkillIds.has(skill.name)} />
        ))}
      </div>
    </div>
  );
}
