import type { RefObject } from 'react';
import type { GameState, LogEntry } from '@soulbound/shared';
import { TIER_STYLE } from '@soulbound/shared';

/**
 * The narration feed.
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 657-741 (`function
 * WorldLog` through its closing brace), with one intentional deviation.
 *
 * **CLAUDE.md #3 fix**: the root element (legacy line 659) is
 * `{ flex: 1, overflow: "auto", padding: ... }` with no `minHeight: 0` — a
 * confirmed flex-scroll violation (a flex child defaults to
 * `min-height: auto`, so this scroll region can overflow its container
 * instead of scrolling). `minHeight: 0` is added below; everything else is
 * byte-identical.
 */
export interface WorldLogProps {
  isMobile: boolean;
  log: LogEntry[];
  gameState: GameState;
  isThinking: boolean;
  logEndRef: RefObject<HTMLDivElement | null>;
}

export default function WorldLog({ isMobile, log, gameState, isThinking, logEndRef }: WorldLogProps) {
  return (
    <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: isMobile ? "16px 16px" : "20px 24px" }}>
      {log.map((entry, i) => (
        <div key={i} style={{ marginBottom: 20, animation: i === log.length - 1 ? "etchIn 0.5s ease-out" : "none" }}>
          {entry.type === "action" && (
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#7a1f1f", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                {gameState.character.name}
              </span>
              <span style={{ fontSize: 14, color: "#c9b48a", borderLeft: "2px solid #3a2e1a", paddingLeft: 8 }}>{entry.text}</span>
            </div>
          )}
          {entry.type === "narration" && (
            <div>
              {entry.etchingSkill && (
                <div style={{ background: "linear-gradient(135deg, #1a1608, #0f0d09)", border: "1px solid #d4a84355", padding: "12px 14px", marginBottom: 14, borderLeft: "3px solid #d4a843" }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#d4a84399", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 4px" }}>✦ Soul Etching — Unique Skill Recognized</p>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#d4a843", margin: "0 0 5px" }}>{entry.etchingSkill.skill_name || entry.etchingSkill.name}</p>
                  <p style={{ fontSize: 13, color: "#a09070", margin: "0 0 6px", lineHeight: 1.5, fontStyle: "italic" }}>{entry.etchingSkill.etching_text}</p>
                  <p style={{ fontSize: 11, color: "#7a6a50", margin: 0 }}>{entry.etchingSkill.soul_resonance}</p>
                </div>
              )}
              {entry.soulRewrites?.map(rw => (
                <div key={rw.new_name} style={{
                  background: "linear-gradient(135deg, #2a1208, #1a0c08)",
                  border: "1px solid #d4a843aa", padding: "16px 18px", marginBottom: 16,
                  borderLeft: "4px solid #d4a843", boxShadow: "0 0 24px #d4a84322",
                }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#d4a843", letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 8px" }}>
                    ✦✦ Soul Rewrite — Your Nature Has Changed ✦✦
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#8a7060", textDecoration: "line-through" }}>{rw.old_name}</span>
                    <span style={{ color: "#d4a843" }}>→</span>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#d4a843" }}>{rw.new_name}</span>
                  </div>
                  <p style={{ fontSize: 14, color: "#b09878", margin: "0 0 8px", lineHeight: 1.6, fontStyle: "italic" }}>{rw.rewrite_narrative}</p>
                  <p style={{ fontSize: 12, color: "#8a7060", margin: 0, lineHeight: 1.5 }}>{rw.description}</p>
                </div>
              ))}
              {entry.subAbilityUnlock && (
                <div style={{
                  background: "linear-gradient(135deg, #1a1608, #120e08)",
                  border: "1px solid #d4a84377", padding: "14px 16px", marginBottom: 14,
                  borderLeft: "3px solid #d4a843",
                }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#d4a84399", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 6px" }}>
                    ✦ {entry.subAbilityUnlock.skillName} — Sub-Ability Awakens
                  </p>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#d4a843", margin: "0 0 6px" }}>{entry.subAbilityUnlock.name}</p>
                  <p style={{ fontSize: 13, color: "#a09070", margin: "0 0 6px", lineHeight: 1.5, fontStyle: "italic" }}>{entry.subAbilityUnlock.emergence_text}</p>
                  <p style={{ fontSize: 12, color: "#8a7060", margin: 0, lineHeight: 1.5 }}>{entry.subAbilityUnlock.description}</p>
                </div>
              )}
              {entry.newSkills?.map(ns => (
                <div key={ns.skill_name} style={{ background: "#0f1a0f", border: "1px solid #3a7a3a55", padding: "10px 14px", marginBottom: 10, borderLeft: `3px solid ${TIER_STYLE[ns.tier]?.color || "#7ab87a"}` }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#4a8a4a", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 3px" }}>✦ Soul Etching — {ns.tier} Skill</p>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: TIER_STYLE[ns.tier]?.color || "#7ab87a", margin: "0 0 3px" }}>{ns.skill_name}</p>
                  <p style={{ fontSize: 12, color: "#7aaa7a", margin: 0, fontStyle: "italic" }}>{ns.soul_etching_text}</p>
                </div>
              ))}
              <div style={{ fontSize: isMobile ? 15 : 16, color: "#c9b48a", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{entry.text}</div>
              {entry.gmNote && (
                <p style={{ fontSize: 11, color: "#6a5a40", margin: "8px 0 0", fontStyle: "italic", borderTop: "1px solid #2a2218", paddingTop: 8 }}>
                  ⟨ {entry.gmNote} ⟩
                </p>
              )}
            </div>
          )}
          {entry.type === "error" && (
            <p style={{ color: "#c0392b", fontSize: 13, fontStyle: "italic" }}>{entry.text}</p>
          )}
        </div>
      ))}
      {isThinking && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.6 }}>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: "#d4a843", animation: "breathe 1.5s infinite" }}>✦</span>
          <span style={{ fontSize: 14, color: "#8a7a60", fontStyle: "italic" }}>The World Voice stirs...</span>
        </div>
      )}
      <div ref={logEndRef} />
    </div>
  );
}
