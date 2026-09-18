/**
 * The player's input row (textarea + Act button).
 *
 * Ported verbatim from legacy/souldbound-world.jsx lines 744-783 (`function
 * ActionBar` through its closing brace). Inline styles are byte-identical.
 */
export interface ActionBarProps {
  isMobile: boolean;
  input: string;
  setInput: (value: string) => void;
  handleAction: () => void;
  isThinking: boolean;
}

export default function ActionBar({ isMobile, input, setInput, handleAction, isThinking }: ActionBarProps) {
  return (
    <div style={{ borderTop: "1px solid #2a2218", padding: isMobile ? "10px 12px" : "14px 20px", background: "#0a0805" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1, background: "#0f0d09", border: "1px solid #2a2218", padding: "8px 12px" }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAction(); } }}
            placeholder="What do you do?"
            rows={isMobile ? 2 : 2}
            style={{
              background: "transparent", border: "none", color: "#c9b48a",
              fontFamily: "'EB Garamond', serif", fontSize: isMobile ? 16 : 15, width: "100%",
              resize: "none", lineHeight: 1.5,
            }}
          />
        </div>
        <button
          onClick={handleAction}
          disabled={isThinking || !input.trim()}
          style={{
            background: isThinking || !input.trim() ? "#1a1610" : "linear-gradient(135deg, #7a1f1f, #4a1010)",
            border: `1px solid ${isThinking || !input.trim() ? "#2a2218" : "#c0392b"}`,
            color: isThinking || !input.trim() ? "#4a3a28" : "#c9b48a",
            fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: "0.1em",
            padding: isMobile ? "14px 16px" : "12px 18px",
            cursor: isThinking || !input.trim() ? "not-allowed" : "pointer",
            textTransform: "uppercase", whiteSpace: "nowrap", alignSelf: "stretch",
          }}
        >
          Act
        </button>
      </div>
      {!isMobile && (
        <p style={{ fontSize: 11, color: "#4a3a28", margin: "6px 0 0", textAlign: "right" }}>Enter to act · Shift+Enter for new line</p>
      )}
    </div>
  );
}
