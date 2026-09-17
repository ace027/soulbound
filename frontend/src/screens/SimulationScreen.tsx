import type { RefObject } from 'react';
import type { GameState, LogEntry } from '@soulbound/shared';
import WorldLog from '../components/WorldLog';
import ActionBar from '../components/ActionBar';
import SoulCodexContents from '../components/SoulCodexContents';
import { useIsMobile } from '../hooks/useIsMobile';
import { sharedBg } from './sharedBg';
import type { Phase } from '../App';

/**
 * The live simulation screen — mobile two-tab layout and desktop sidebar
 * layout.
 *
 * Ported from legacy/souldbound-world.jsx lines 1346-1438 (the
 * `if (phase === "simulation" && gameState)` block through its closing
 * brace; NOT through legacy 1440's `return null;`, which is `App()`'s own
 * fallback return, not part of this screen). Inline style objects are
 * byte-identical except for the CLAUDE.md #3 fixes below and the three
 * enumerated deltas.
 *
 * ── Deltas from legacy ──────────────────────────────────────────────────
 *
 * 1. **`isMobile` comes from `useIsMobile()`**, not `window.innerWidth < 700`
 *    read at render time (legacy 1348 — R12 bug 1). The render-time read had
 *    no subscription, so rotating a phone or resizing a window across the
 *    700px line left the layout stale until something unrelated re-rendered.
 *
 * 2. **CLAUDE.md #3, site 1**: the mobile content wrapper (legacy 1386,
 *    `{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }`)
 *    is missing `minHeight: 0`. A flex child defaults to `min-height: auto`,
 *    so without this the World tab's scroll region (WorldLog, `flex: 1`) can
 *    grow the wrapper instead of scrolling inside it. Fixed below.
 *
 * 3. **CLAUDE.md #3, site 2**: legacy 1388 wraps `WorldLog` + `ActionBar` in
 *    a Fragment (`<>...</>`) inside that same wrapper. CLAUDE.md #3 states
 *    outright that a Fragment must never stand in for a flex/scroll
 *    container. Replaced with a real `<div>` carrying `display: flex`,
 *    `flexDirection: "column"`, `minHeight: 0`, **and `flex: 1`** — dropping
 *    `flex: 1` here would silently collapse the row to its content height,
 *    a failure no jsdom test can see (see the test file's mutant report);
 *    it is included deliberately.
 *
 * 4. **CLAUDE.md #3, sites 3 and 4 (desktop, not named in the original
 *    plan)**: the desktop left panel (legacy 1420, the Soul Codex sidebar,
 *    `width: 240, ..., flexDirection: "column", overflow: "hidden"`) and the
 *    desktop right panel (legacy 1432, the world column, `flex: 1,
 *    flexDirection: "column", overflow: "hidden"`) are each missing
 *    `minHeight: 0`. Both are direct ancestors of a scrolling child
 *    (`SoulCodexContents` at 1420, `WorldLog` at 1432) and both are fixed
 *    below. See the ancestor-chain audit in the port report.
 *
 * 5. The `<style>` blocks at legacy 1354 (mobile) and 1410 (desktop) are
 *    dropped — `index.css` owns the keyframes and scrollbar rules,
 *    `index.html` owns the font `<link>`. Legacy 1355/1411 carried the same
 *    `@import` already dropped from every other screen. The 3px-vs-4px
 *    scrollbar-thumb difference between the mobile and desktop copies was
 *    already resolved to 4px by plurality in Phase 1 (`index.css`) — not
 *    "restored" here.
 *
 * `WorldLog`'s own root (legacy 659) and `SoulCodexContents`'s own root
 * (legacy 570) already carry `minHeight: 0` — fixed by plan 03-06 and by
 * legacy itself, respectively. Not touched here.
 */
export interface SimulationScreenProps {
  gameState: GameState;
  log: LogEntry[];
  isThinking: boolean;
  logEndRef: RefObject<HTMLDivElement | null>;
  newSkillIds: Set<string>;
  savingStatus: '' | 'saving' | 'saved';
  handleManualSave: () => void;
  setPhase: (phase: Phase) => void;
  mobileTab: 'World' | 'Codex';
  setMobileTab: (tab: 'World' | 'Codex') => void;
  input: string;
  setInput: (value: string) => void;
  handleAction: () => void;
}

export default function SimulationScreen({
  gameState,
  log,
  isThinking,
  logEndRef,
  newSkillIds,
  savingStatus,
  handleManualSave,
  setPhase,
  mobileTab,
  setMobileTab,
  input,
  setInput,
  handleAction,
}: SimulationScreenProps) {
  const uniqueSkill = gameState.skills.find(s => s.tier === "Unique");
  const isMobile = useIsMobile();

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ ...sharedBg, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        {/* Tab Bar */}
        <div style={{ display: "flex", background: "#0a0805", borderBottom: "1px solid #2a2218", flexShrink: 0 }}>
          {(["World", "Codex"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              style={{
                flex: 1, padding: "12px 8px",
                background: mobileTab === tab ? "#0f0d09" : "transparent",
                border: "none",
                borderBottom: `2px solid ${mobileTab === tab ? "#d4a843" : "transparent"}`,
                color: mobileTab === tab ? "#d4a843" : "#6a5a40",
                fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.15em",
                textTransform: "uppercase", cursor: "pointer",
              }}
            >
              {tab === "World" ? "✦ World" : "☽ Codex"}
            </button>
          ))}
        </div>

        {/* Content area — CLAUDE.md #3 fix: minHeight: 0 added (legacy 1386). */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {mobileTab === "World" ? (
            // CLAUDE.md #3 fix: legacy 1388's Fragment replaced with a real
            // div carrying flex: 1 + minHeight: 0, per CLAUDE.md #3's rule
            // against a Fragment standing in for a flex/scroll container.
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <WorldLog isMobile={isMobile} log={log} gameState={gameState} isThinking={isThinking} logEndRef={logEndRef} />
              <ActionBar isMobile={isMobile} input={input} setInput={setInput} handleAction={handleAction} isThinking={isThinking} />
            </div>
          ) : (
            <SoulCodexContents
              gameState={gameState}
              uniqueSkill={uniqueSkill}
              newSkillIds={newSkillIds}
              savingStatus={savingStatus}
              handleManualSave={handleManualSave}
              setPhase={setPhase}
            />
          )}
        </div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ───────────────────────────────────────────────────
  return (
    <div style={{ ...sharedBg, display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* LEFT PANEL — CLAUDE.md #3 fix: minHeight: 0 added (legacy 1420). */}
      <div style={{ width: 240, background: "#0a0805", borderRight: "1px solid #2a2218", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <SoulCodexContents
          gameState={gameState}
          uniqueSkill={uniqueSkill}
          newSkillIds={newSkillIds}
          savingStatus={savingStatus}
          handleManualSave={handleManualSave}
          setPhase={setPhase}
        />
      </div>

      {/* RIGHT PANEL — CLAUDE.md #3 fix: minHeight: 0 added (legacy 1432). */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <WorldLog isMobile={isMobile} log={log} gameState={gameState} isThinking={isThinking} logEndRef={logEndRef} />
        <ActionBar isMobile={isMobile} input={input} setInput={setInput} handleAction={handleAction} isThinking={isThinking} />
      </div>
    </div>
  );
}
