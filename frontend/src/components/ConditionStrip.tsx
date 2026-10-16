import type { Attributes, Condition } from '@soulbound/shared';

/**
 * HP / MP / SP meters, plus (full variant) the STR / AGI / INT / WIL row
 * (Phase 15).
 *
 * - `full` sits at the top of the Soul Codex.
 * - `compact` is pinned above the ActionBar on the mobile World tab.
 *
 * The track reuses SkillCard's mastery-bar look (`#1a1610` track, a gradient
 * fill). Every meter shows its numbers as text ("HP 84/100"), so colour never
 * carries the value alone, and exposes `role="meter"` with min/now/max.
 *
 * The root sets its own background so the text colours below are measured
 * against what they actually sit on. Every text/background pair here is
 * checked for WCAG AA (4.5:1) in components.test.tsx, which walks the
 * rendered DOM rather than a copied list of colours.
 */
export interface ConditionStripProps {
  condition: Condition;
  attributes: Attributes;
  variant: 'full' | 'compact';
}

const CONDITION_BG = '#0a0805';
const TEXT = '#d8c8a0';
const MUTED = '#a89878';
const VALUE = '#d4a843';

const POOLS = [
  { key: 'hp', max: 'max_hp', label: 'HP', name: 'Health', fill: '#c0453a' },
  { key: 'mp', max: 'max_mp', label: 'MP', name: 'Mana', fill: '#4a86c0' },
  { key: 'sp', max: 'max_sp', label: 'SP', name: 'Stamina', fill: '#6aa86a' },
] as const;

const ATTRS: Array<{ key: keyof Attributes; name: string }> = [
  { key: 'STR', name: 'Strength' },
  { key: 'AGI', name: 'Agility' },
  { key: 'INT', name: 'Intellect' },
  { key: 'WIL', name: 'Will' },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export default function ConditionStrip({ condition, attributes, variant }: ConditionStripProps) {
  const compact = variant === 'compact';

  const meters = POOLS.map(p => {
    const max = Math.max(0, Math.round(condition[p.max]));
    const now = clamp(Math.round(condition[p.key]), 0, max);
    const pct = max > 0 ? (now / max) * 100 : 0;
    return (
      <div
        key={p.key}
        role="meter"
        aria-label={`${p.label} (${p.name})`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        aria-valuetext={`${now} of ${max}`}
        style={{ flex: compact ? 1 : undefined, minWidth: 0, marginBottom: compact ? 0 : 7 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: compact ? 10 : 11, color: TEXT, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            {`${p.label} ${now}/${max}`}
          </span>
        </div>
        <div style={{ background: "#1a1610", height: compact ? 4 : 5, borderRadius: 2, overflow: "hidden" }}>
          <div style={{ background: `linear-gradient(90deg, ${p.fill}88, ${p.fill})`, width: `${pct}%`, height: "100%", transition: "width 1s ease" }} />
        </div>
      </div>
    );
  });

  if (compact) {
    return (
      <div
        data-testid="condition-strip-compact"
        style={{
          display: "flex", gap: 12, padding: "6px 12px", flexShrink: 0,
          backgroundColor: CONDITION_BG, borderTop: "1px solid #2a2218",
        }}
      >
        {meters}
      </div>
    );
  }

  return (
    <div
      data-testid="condition-strip-full"
      style={{ padding: "10px 16px", borderBottom: "1px solid #1a1610", flexShrink: 0, backgroundColor: CONDITION_BG }}
    >
      <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: MUTED, letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 6px" }}>Condition</p>
      {meters}
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, margin: "8px 0 0" }}>
        {ATTRS.map(a => (
          <div key={a.key} title={a.name} style={{ textAlign: "center", border: "1px solid #2a2218", padding: "3px 0" }}>
            <dt style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: MUTED, letterSpacing: "0.1em" }}>
              <abbr title={a.name} style={{ textDecoration: "none" }}>{a.key}</abbr>
            </dt>
            <dd style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: VALUE, margin: 0 }}>{attributes[a.key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
