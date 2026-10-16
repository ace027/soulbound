import { memo, useMemo } from 'react';
import type { Kingdom, Place } from '@soulbound/shared';
import {
  KINGDOM_LAYOUT,
  KINGDOM_LAYOUT_NARROW,
  KINGDOM_LINKS,
  KINGDOM_ORDER,
  KINGDOM_REGION,
  MAP_VIEWBOX,
  MAP_VIEWBOX_NARROW,
  type KingdomNode,
  type RealKingdom,
} from '../data/kingdomLayout';
import { useIsMobile } from '../hooks/useIsMobile';

/**
 * Schematic map of Vaeltharion (Phase 15): the six kingdoms from
 * `kingdomLayout.ts`, every discovered place as a pin inside its kingdom (in
 * discovery order), an "Uncharted" tray for places whose kingdom is unknown,
 * and a you-are-here marker.
 *
 * Inline SVG only, no image assets. Legibility with many places: a kingdom
 * labels its pins only while they fit (`LABEL_CAP_*`); past that it draws
 * unlabelled pins, and the full text list under the SVG always names every
 * place. Pin labels are truncated; the full name is on the pin's accessible
 * name, its `<title>`, and in the list.
 *
 * Below 700px it switches to the portrait `KINGDOM_LAYOUT_NARROW` (same
 * graph) with larger type, so labels stay readable on a phone.
 *
 * The root is a scroll region (`flex: 1`, `minHeight: 0`, `overflow: auto`),
 * so it scrolls inside the overlay or the mobile Map tab (CLAUDE.md #3).
 */
export interface WorldMapProps {
  places: Record<string, Place>;
  currentPlaceId: string | null;
  location: string;
}

// ─── Palette (every text/background pair is AA-checked in worldMap.test.tsx) ─
const PANEL_BG = '#0a0805';
const MAP_BG = '#0d0b07';
const REGION_FILL = '#16120c';
const REGION_STROKE = '#3a3020';
const LINK_STROKE = '#2e271b';
const GOLD = '#d4a843';
const HERE = '#f0c060';
const TEXT = '#d8c8a0';
const PIN_TEXT = '#c8b890';
const MUTED = '#a89878';

/** A kingdom labels at most this many pins; beyond it, pins only. */
export const LABEL_CAP_KINGDOM = 12;
/** The Uncharted tray labels at most this many pins. */
export const LABEL_CAP_TRAY = 12;

interface Geometry {
  viewBox: { width: number; height: number };
  layout: Record<RealKingdom, KingdomNode>;
  tray: { x: number; y: number; width: number; height: number };
  trayCols: number;
  pinFont: number;
  rowH: number;
  /** Rough width of one label character at `pinFont`, in user units. */
  charW: number;
}

const WIDE: Geometry = {
  viewBox: MAP_VIEWBOX,
  layout: KINGDOM_LAYOUT,
  tray: { x: 20, y: 548, width: 680, height: 80 },
  trayCols: 4,
  pinFont: 11,
  rowH: 15,
  charW: 7,
};

const NARROW: Geometry = {
  viewBox: MAP_VIEWBOX_NARROW,
  layout: KINGDOM_LAYOUT_NARROW,
  tray: { x: 12, y: 618, width: 376, height: 112 },
  trayCols: 2,
  pinFont: 11,
  rowH: 16,
  charW: 7,
};

interface PinSpec {
  id: string;
  place: Place;
  x: number;
  y: number;
  label: string | null;
}

function truncate(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

function kingdomName(k: Kingdom): string {
  return k === 'unknown' ? 'Uncharted' : KINGDOM_LAYOUT[k].label;
}

/**
 * Lays `entries` out inside a box. While the count fits `cap`, pins sit in
 * `labelCols` columns with a truncated label beside each; past the cap they
 * become an unlabelled dot grid.
 */
function layoutPins(
  entries: Array<[string, Place]>,
  box: { x: number; y: number; width: number; height: number },
  maxCols: number,
  cap: number,
  geo: Geometry,
): PinSpec[] {
  const n = entries.length;
  if (n === 0) return [];
  const rowsFit = Math.max(1, Math.floor(box.height / geo.rowH));
  if (n <= Math.min(cap, rowsFit * maxCols)) {
    const cols = Math.min(maxCols, Math.ceil(n / rowsFit));
    const cellW = box.width / cols;
    const maxChars = Math.max(4, Math.floor((cellW - 16) / geo.charW));
    return entries.map(([id, place], i) => ({
      id,
      place,
      x: box.x + (i % cols) * cellW + 6,
      y: box.y + Math.floor(i / cols) * geo.rowH + 6,
      label: truncate(place.name, maxChars),
    }));
  }
  const cols = Math.max(8, Math.floor(box.width / 16));
  const rows = Math.ceil(n / cols);
  const rowH = Math.min(geo.rowH, box.height / rows);
  return entries.map(([id, place], i) => ({
    id,
    place,
    x: box.x + (i % cols) * 16 + 6,
    y: box.y + Math.floor(i / cols) * rowH + 6,
    label: null,
  }));
}

function Pin({ pin, isCurrent, fontSize }: { pin: PinSpec; isCurrent: boolean; fontSize: number }) {
  const kingdom = kingdomName(pin.place.kingdom);
  const name = `${pin.place.name}, ${kingdom}${isCurrent ? ' (you are here)' : ''}`;
  return (
    <g role="img" aria-label={name} data-place-id={pin.id} data-current={isCurrent ? 'true' : undefined}>
      <title>{name}</title>
      {isCurrent && (
        <circle data-testid="you-are-here" cx={pin.x} cy={pin.y} r={7} fill="none" stroke={HERE} strokeWidth={2} />
      )}
      <circle cx={pin.x} cy={pin.y} r={isCurrent ? 4 : 3.5} fill={isCurrent ? HERE : MUTED} />
      {pin.label && (
        <text
          aria-hidden="true"
          x={pin.x + (isCurrent ? 12 : 9)}
          y={pin.y + fontSize * 0.35}
          fontSize={fontSize}
          fontFamily="'Cinzel', serif"
          fill={isCurrent ? HERE : PIN_TEXT}
          data-bg={REGION_FILL}
        >
          {pin.label}
        </text>
      )}
    </g>
  );
}

function WorldMap({ places, currentPlaceId, location }: WorldMapProps) {
  const { ordered, byKingdom } = useMemo(() => {
    const ordered = Object.entries(places).sort(
      ([, a], [, b]) => a.firstSeenTurn - b.firstSeenTurn || a.name.localeCompare(b.name),
    );
    const map = new Map<Kingdom, Array<[string, Place]>>();
    for (const entry of ordered) {
      const list = map.get(entry[1].kingdom) ?? [];
      list.push(entry);
      map.set(entry[1].kingdom, list);
    }
    return { ordered, byKingdom: map };
  }, [places]);

  const current = currentPlaceId ? places[currentPlaceId] : undefined;
  const hereText = current ? `${current.name}, ${kingdomName(current.kingdom)}` : location;
  const uncharted = byKingdom.get('unknown') ?? [];

  const { width: rw, height: rh } = KINGDOM_REGION;
  const geo = useIsMobile() ? NARROW : WIDE;
  const tray = geo.tray;
  const { width: vw, height: vh } = geo.viewBox;

  return (
    <div
      data-testid="world-map"
      style={{
        display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto",
        backgroundColor: PANEL_BG, padding: "12px 14px 16px",
      }}
    >
      <p style={{ fontSize: 14, color: TEXT, margin: "0 0 10px", lineHeight: 1.4, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Cinzel', serif", color: GOLD }}>You are here:</span> {hereText}
      </p>

      <div style={{ flexShrink: 0, overflowX: "auto" }}>
        <svg
          role="group"
          aria-label="Map of Vaeltharion"
          viewBox={`0 0 ${vw} ${vh}`}
          style={{
            display: "block", width: "100%", height: "auto", margin: "0 auto",
            // Fit the whole map in view where the height allows it.
            maxWidth: `min(900px, calc((100vh - 200px) * ${(vw / vh).toFixed(3)}))`,
            minWidth: 300,
          }}
        >
          <rect x={0} y={0} width={vw} height={vh} fill={MAP_BG} />

          {/* Links between kingdoms */}
          <g aria-hidden="true">
            {KINGDOM_LINKS.map(([a, b]) => {
              if (a === 'unknown' || b === 'unknown') return null;
              const pa = geo.layout[a];
              const pb = geo.layout[b];
              return (
                <line
                  key={`${a}-${b}`}
                  x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  stroke={LINK_STROKE} strokeWidth={2} strokeDasharray="6 5"
                />
              );
            })}
          </g>

          {/* Kingdoms and their pins */}
          {KINGDOM_ORDER.map((k: RealKingdom) => {
            const node = geo.layout[k];
            const left = node.x - rw / 2;
            const top = node.y - rh / 2;
            const entries = byKingdom.get(k) ?? [];
            const pins = layoutPins(
              entries,
              { x: left + 8, y: top + 32, width: rw - 16, height: rh - 40 },
              2,
              LABEL_CAP_KINGDOM,
              geo,
            );
            const isHereKingdom = current?.kingdom === k;
            return (
              <g key={k} role="group" aria-label={`${node.label}, ${entries.length} ${entries.length === 1 ? 'place' : 'places'}`} data-kingdom={k}>
                <rect
                  x={left} y={top} width={rw} height={rh} rx={6}
                  fill={REGION_FILL}
                  stroke={isHereKingdom ? GOLD : REGION_STROKE}
                  strokeWidth={isHereKingdom ? 2 : 1}
                />
                <text
                  aria-hidden="true"
                  x={node.x} y={top + 20} textAnchor="middle"
                  fontSize={14} fontFamily="'Cinzel', serif" letterSpacing="0.12em"
                  fill={isHereKingdom ? GOLD : TEXT}
                  data-bg={REGION_FILL}
                >
                  {node.label.toUpperCase()}
                </text>
                {pins.map(pin => (
                  <Pin key={pin.id} pin={pin} isCurrent={pin.id === currentPlaceId} fontSize={geo.pinFont} />
                ))}
              </g>
            );
          })}

          {/* Uncharted tray */}
          <g role="group" aria-label={`Uncharted, ${uncharted.length} ${uncharted.length === 1 ? 'place' : 'places'}`} data-kingdom="unknown">
            <rect
              x={tray.x} y={tray.y} width={tray.width} height={tray.height} rx={6}
              fill={REGION_FILL}
              stroke={current?.kingdom === 'unknown' ? GOLD : REGION_STROKE}
              strokeWidth={current?.kingdom === 'unknown' ? 2 : 1}
              strokeDasharray="4 4"
            />
            <text
              aria-hidden="true"
              x={tray.x + 12} y={tray.y + 19}
              fontSize={12} fontFamily="'Cinzel', serif" letterSpacing="0.12em"
              fill={MUTED}
              data-bg={REGION_FILL}
            >
              UNCHARTED
            </text>
            {uncharted.length === 0 && (
              <text aria-hidden="true" x={tray.x + 12} y={tray.y + 40} fontSize={11} fill={MUTED} fontStyle="italic" data-bg={REGION_FILL}>
                places of unknown kingdom gather here
              </text>
            )}
            {layoutPins(
              uncharted,
              { x: tray.x + 8, y: tray.y + 30, width: tray.width - 16, height: tray.height - 36 },
              geo.trayCols,
              LABEL_CAP_TRAY,
              geo,
            ).map(pin => (
              <Pin key={pin.id} pin={pin} isCurrent={pin.id === currentPlaceId} fontSize={geo.pinFont} />
            ))}
          </g>
        </svg>
      </div>

      {/* Full text list: every place, untruncated */}
      <section aria-label="Discovered places" style={{ marginTop: 12, flexShrink: 0 }}>
        <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: MUTED, letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 6px", fontWeight: "normal" }}>
          Discovered places ({ordered.length})
        </h3>
        {ordered.length === 0 ? (
          <p style={{ fontSize: 13, color: MUTED, margin: 0, fontStyle: "italic" }}>No places discovered yet.</p>
        ) : (
          [...KINGDOM_ORDER, 'unknown' as const]
            .filter(k => (byKingdom.get(k) ?? []).length > 0)
            .map(k => (
              <div key={k} style={{ marginBottom: 6 }}>
                <h4 style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: GOLD, margin: "0 0 2px", fontWeight: "normal" }}>{kingdomName(k)}</h4>
                <ul style={{ margin: 0, paddingLeft: 18, color: TEXT, fontSize: 13, lineHeight: 1.5 }}>
                  {(byKingdom.get(k) ?? []).map(([id, place]) => (
                    <li key={id} style={{ color: id === currentPlaceId ? HERE : TEXT, overflowWrap: "anywhere" }}>
                      {place.name}{id === currentPlaceId ? ' (you are here)' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))
        )}
      </section>
    </div>
  );
}

export default memo(WorldMap);
