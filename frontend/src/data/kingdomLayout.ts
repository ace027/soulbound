import type { Kingdom } from '@soulbound/shared';

/**
 * Schematic layout of the six kingdoms for the world map (Phase 15).
 *
 * Presentation only. `WORLD_LORE` names the kingdoms and their relationships
 * but no geography, so these positions are not canon and are deliberately not
 * in the lore block (CLAUDE.md #7). See
 * .planning/explorations/2026-10-16-world-map-and-stats-design.md.
 *
 * Shape: Tidemark, "a crossing point", sits at the centre and links to all
 * five others. The other five form a ring, Kaldrath -> Verdance -> Ashenveil
 * -> Aurelis -> Sundrach -> Kaldrath, laid out as a pentagon around Tidemark.
 *
 * Coordinates are the centre of each kingdom's region in the map's SVG
 * viewBox (`MAP_VIEWBOX`).
 */
export type RealKingdom = Exclude<Kingdom, 'unknown'>;

export interface KingdomNode {
  x: number;
  y: number;
  label: string;
}

/** SVG user-space size the coordinates below are laid out in. */
export const MAP_VIEWBOX = { width: 720, height: 640 } as const;

/** Size of each kingdom's rectangular region, centred on its node. */
export const KINGDOM_REGION = { width: 176, height: 132 } as const;

export const KINGDOM_LAYOUT: Record<RealKingdom, KingdomNode> = {
  Tidemark: { x: 360, y: 285, label: 'Tidemark' },
  Kaldrath: { x: 360, y: 85, label: 'Kaldrath' },
  Verdance: { x: 594, y: 225, label: 'Verdance' },
  Ashenveil: { x: 494, y: 455, label: 'Ashenveil' },
  Aurelis: { x: 226, y: 455, label: 'Aurelis' },
  Sundrach: { x: 126, y: 225, label: 'Sundrach' },
};

/**
 * Portrait arrangement of the same graph for narrow (mobile) screens, in
 * `MAP_VIEWBOX_NARROW`. The wide pentagon would scale its labels below
 * legibility on a 375px phone; this keeps the same neighbours (Tidemark in
 * the middle, the ring around it) in a column two regions wide.
 */
export const MAP_VIEWBOX_NARROW = { width: 400, height: 740 } as const;

export const KINGDOM_LAYOUT_NARROW: Record<RealKingdom, KingdomNode> = {
  Kaldrath: { x: 200, y: 85, label: 'Kaldrath' },
  Sundrach: { x: 100, y: 235, label: 'Sundrach' },
  Verdance: { x: 300, y: 235, label: 'Verdance' },
  Tidemark: { x: 200, y: 385, label: 'Tidemark' },
  Aurelis: { x: 100, y: 535, label: 'Aurelis' },
  Ashenveil: { x: 300, y: 535, label: 'Ashenveil' },
};

export const KINGDOM_LINKS: Array<[Kingdom, Kingdom]> = [
  // Tidemark, the crossing point, touches every kingdom.
  ['Tidemark', 'Kaldrath'],
  ['Tidemark', 'Verdance'],
  ['Tidemark', 'Ashenveil'],
  ['Tidemark', 'Aurelis'],
  ['Tidemark', 'Sundrach'],
  // The outer ring.
  ['Kaldrath', 'Verdance'],
  ['Verdance', 'Ashenveil'],
  ['Ashenveil', 'Aurelis'],
  ['Aurelis', 'Sundrach'],
  ['Sundrach', 'Kaldrath'],
];

/** Draw order and text-list order for the kingdoms. */
export const KINGDOM_ORDER: RealKingdom[] = [
  'Kaldrath',
  'Verdance',
  'Ashenveil',
  'Aurelis',
  'Sundrach',
  'Tidemark',
];
