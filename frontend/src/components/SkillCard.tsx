import type { Skill } from '@soulbound/shared';
import { TIER_STYLE } from '@soulbound/shared';

/**
 * Ported verbatim from legacy/souldbound-world.jsx lines 534-565 (`function
 * SkillCard` through its closing brace). Inline styles are byte-identical.
 *
 * `TIER_STYLE` is imported from `@soulbound/shared` (gameState.ts:168,
 * copied verbatim from legacy 525-531) rather than redeclared here — this
 * phase's context doc flags a duplicate tier-styling source of truth as the
 * exact drift class it guards against.
 */
export interface SkillCardProps {
  skill: Skill;
  isNew: boolean;
}

export default function SkillCard({ skill, isNew }: SkillCardProps) {
  const ts = TIER_STYLE[skill.tier] || TIER_STYLE.Common;
  const pct = skill.mastery / 100;
  return (
    <div style={{
      border: `1px solid ${ts.color}44`,
      borderLeft: `3px solid ${ts.color}`,
      background: "#0d0b0799",
      padding: "10px 12px",
      marginBottom: 8,
      animation: isNew ? "etchIn 0.8s ease-out" : "none",
      position: "relative",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: ts.color, letterSpacing: "0.05em" }}>{skill.name}</span>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#8a7a60", opacity: 0.8 }}>{skill.tier}</span>
      </div>
      {skill.description && (
        <p style={{ fontFamily: "'EB Garamond', serif", fontSize: 12, color: "#b0a080", margin: "4px 0 6px", lineHeight: 1.4 }}>{skill.description}</p>
      )}
      <div style={{ background: "#1a1610", height: 3, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ background: `linear-gradient(90deg, ${ts.color}88, ${ts.glow})`, width: `${pct * 100}%`, height: "100%", transition: "width 1s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#8a7a60" }}>
          {skill.mastery < 21 ? "Novice" : skill.mastery < 51 ? "Adept" : skill.mastery < 81 ? "Expert" : skill.mastery < 100 ? "Master" : "Transcendent"}
        </span>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#8a7a60" }}>{skill.mastery}/100</span>
      </div>
    </div>
  );
}
