/**
 * Legacy lines 1038-1043, the `sharedBg` const inside App(). Hoisted here so
 * every screen imports one copy instead of each re-declaring it verbatim.
 *
 * This is a de-duplication, not a design-system change: 03-07 landed three
 * byte-identical copies (TitleScreen, RaceScreen, QuestionnaireScreen) with a
 * comment noting a single module would be "the place to hoist it once plans
 * 03-08/03-09 land and all five screens exist." This plan adds the fourth and
 * fifth screens that need it, so it hoists it now rather than adding a fourth
 * copy. The object itself is untouched — same keys, same values, same order.
 */
export const sharedBg = {
  minHeight: '100vh',
  background: 'linear-gradient(160deg, #0d0b07 0%, #120e08 60%, #0a0f14 100%)',
  color: '#c9b48a',
  fontFamily: "'EB Garamond', serif",
} as const;
