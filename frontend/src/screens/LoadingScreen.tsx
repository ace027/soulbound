import { sharedBg } from './sharedBg';

/**
 * Loading screen — a single centered glyph and a status message.
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 1335-1343 (the
 * `if (phase === "loading")` block through its closing brace). Inline style
 * objects are byte-identical.
 *
 * Delta: the `<style>` block at legacy 1338 (a font `@import` plus the
 * `breathe` keyframes) is dropped. `index.html` owns the font `<link>` and
 * `index.css` owns `@keyframes breathe` (Phase 1's consolidation of all six
 * legacy `<style>` blocks) — see the port report for the full enumeration.
 */
export interface LoadingScreenProps {
  loadingMsg: string;
}

export default function LoadingScreen({ loadingMsg }: LoadingScreenProps) {
  return (
    <div style={{ ...sharedBg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#d4a843", animation: "breathe 2s infinite", letterSpacing: "0.1em" }}>✦</div>
      <p style={{ fontFamily: "'EB Garamond', serif", fontSize: 17, color: "#8a7a60", fontStyle: "italic", textAlign: "center", maxWidth: 320 }}>{loadingMsg}</p>
    </div>
  );
}
