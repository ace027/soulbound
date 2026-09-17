import type { Race } from '@soulbound/shared';
import { RACES } from '../data/races';

/**
 * Race-selection screen.
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 1186-1254 (the
 * `if (phase === "race")` block through its closing brace). Inline style
 * objects are byte-identical. Deltas: the inline CSS block at legacy 1189-1195
 * is dropped (index.css owns etchIn/glowPulse and the scrollbar and
 * textarea:focus rules, index.html owns the font link), `RACES` is imported
 * from src/data rather than read from module scope, and the four closed-over
 * bindings become props — the state lives in App.tsx.
 *
 * The 9-race grid leaves an uneven final row in this 2-column layout. That is
 * a known cosmetic issue and explicitly out of scope for the port.
 */

/** Legacy lines 1038-1043, the `sharedBg` const inside App(). See TitleScreen. */
const sharedBg = {
  minHeight: '100vh',
  background: 'linear-gradient(160deg, #0d0b07 0%, #120e08 60%, #0a0f14 100%)',
  color: '#c9b48a',
  fontFamily: "'EB Garamond', serif",
} as const;

export interface RaceScreenProps {
  charName: string;
  setCharName: (name: string) => void;
  selectedRace: Race | null;
  setSelectedRace: (race: Race) => void;
  /** Legacy `setPhase("questionnaire")`, behind the same inline guard. */
  onContinue: () => void;
}

export default function RaceScreen({
  charName,
  setCharName,
  selectedRace,
  setSelectedRace,
  onContinue,
}: RaceScreenProps) {
  return (
    <div style={{ ...sharedBg, padding: "32px 24px" }}>
      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.2em", color: "#7a1f1f", textTransform: "uppercase", marginBottom: 8 }}>Vaeltharion</p>
        <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 28, fontWeight: 700, color: "#d4a843", margin: "0 0 8px", lineHeight: 1.2 }}>The Soulbound Chronicles</h1>
        <p style={{ fontSize: 15, color: "#8a7a60", marginBottom: 32, lineHeight: 1.6, fontStyle: "italic" }}>In this world, power is not learned — it is remembered by the soul. Choose your blood, and the World Voice will read what lies beneath.</p>

        <div style={{ marginBottom: 24 }}>
          <label style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#8a7a60", letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>YOUR NAME</label>
          <input
            value={charName}
            onChange={e => setCharName(e.target.value)}
            placeholder="What are you called?"
            style={{ background: "#14110d", border: "1px solid #3a2e1a", color: "#c9b48a", fontFamily: "'EB Garamond', serif", fontSize: 16, padding: "10px 14px", width: "100%", boxSizing: "border-box", borderRadius: 2 }}
          />
        </div>

        <label style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#8a7a60", letterSpacing: "0.1em", display: "block", marginBottom: 12 }}>YOUR RACE</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
          {RACES.map(race => (
            <div
              key={race.id}
              onClick={() => setSelectedRace(race)}
              style={{
                background: selectedRace?.id === race.id ? "#1e1608" : "#0f0d09",
                border: `1px solid ${selectedRace?.id === race.id ? "#d4a843" : "#2a2218"}`,
                padding: "14px 16px",
                cursor: "pointer",
                transition: "all 0.2s",
                animation: selectedRace?.id === race.id ? "glowPulse 2s infinite" : "none",
              }}
            >
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: selectedRace?.id === race.id ? "#d4a843" : "#c9b48a", marginBottom: 4 }}>{race.name}</div>
              <div style={{ fontSize: 12, color: "#6a5a40", lineHeight: 1.4, marginBottom: 8 }}>{race.desc}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {race.intrinsic.map(s => (
                  <span key={s.name} style={{ fontSize: 10, color: "#8a7a60", border: "1px solid #3a2e1a", padding: "2px 6px", letterSpacing: "0.04em" }}>{s.name}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => { if (selectedRace && charName.trim()) onContinue(); }}
          disabled={!selectedRace || !charName.trim()}
          style={{
            background: selectedRace && charName.trim() ? "linear-gradient(135deg, #7a1f1f, #4a1010)" : "#1a1610",
            border: `1px solid ${selectedRace && charName.trim() ? "#c0392b" : "#2a2218"}`,
            color: selectedRace && charName.trim() ? "#c9b48a" : "#4a3a28",
            fontFamily: "'Cinzel', serif", fontSize: 14, letterSpacing: "0.12em",
            padding: "14px 32px", cursor: selectedRace && charName.trim() ? "pointer" : "not-allowed",
            width: "100%", textTransform: "uppercase",
          }}
        >
          Enter the World Voice
        </button>
      </div>
    </div>
  );
}
