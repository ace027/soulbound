import type { GameState, Place } from '@soulbound/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import WorldMap, { LABEL_CAP_KINGDOM } from '../WorldMap';
import SimulationScreen from '../../screens/SimulationScreen';
import { KINGDOM_LAYOUT, KINGDOM_LINKS } from '../../data/kingdomLayout';

/**
 * World map tests (plan 15-03, Phase 15). Explicit cleanup: vitest.config.ts
 * does not set `globals: true`.
 */
afterEach(cleanup);
afterEach(() => {
  window.innerWidth = 1024;
});

const PLACES: Record<string, Place> = {
  'toll-bridge-kaldrath': { name: 'Toll Bridge', kingdom: 'Kaldrath', firstSeenTurn: 2 },
  'iron-yard-kaldrath': { name: 'Iron Yard', kingdom: 'Kaldrath', firstSeenTurn: 1 },
  'saltmarket-tidemark': { name: 'Saltmarket', kingdom: 'Tidemark', firstSeenTurn: 3 },
  'mossden-verdance': { name: 'Mossden', kingdom: 'Verdance', firstSeenTurn: 4 },
  'the-drowned-stair-unknown': { name: 'The Drowned Stair', kingdom: 'unknown', firstSeenTurn: 5 },
};

function kingdomGroup(container: HTMLElement, kingdom: string): HTMLElement {
  const g = container.querySelector(`[data-kingdom="${kingdom}"]`);
  if (!g) throw new Error(`no group for ${kingdom}`);
  return g as HTMLElement;
}

// ─── Contrast helper (WCAG 2.x relative luminance) ──────────────────────────

function relativeLuminance(color: string): number {
  let rgb: number[];
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    rgb = [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  } else {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color.trim());
    if (!m) throw new Error(`unparseable colour: ${color}`);
    rgb = [m[1], m[2], m[3]].map(Number);
  }
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every rendered text element with its colour and the background it is drawn
 * on. HTML reads inline `color` / `backgroundColor` up the tree; SVG `<text>`
 * reads `fill` and the `data-bg` the map declares for the region it sits in.
 * `<title>` is skipped: it is never painted.
 */
function textPairs(root: Element): Array<{ text: string; fg: string; bg: string }> {
  const pairs: Array<{ text: string; fg: string; bg: string }> = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.tagName.toLowerCase() === 'title') continue;
    const own = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent ?? '')
      .join('')
      .trim();
    if (!own) continue;
    if (el instanceof SVGElement) {
      pairs.push({ text: own, fg: el.getAttribute('fill') ?? '', bg: el.getAttribute('data-bg') ?? '' });
      continue;
    }
    let fg = '';
    let bg = '';
    for (let n: Element | null = el; n; n = n.parentElement) {
      const style = (n as HTMLElement).style;
      if (!fg && style?.color) fg = style.color;
      if (!bg && style?.backgroundColor) bg = style.backgroundColor;
    }
    pairs.push({ text: own, fg, bg });
  }
  return pairs;
}

// ─── Layout data ────────────────────────────────────────────────────────────

describe('kingdomLayout', () => {
  it('links Tidemark to all five kingdoms and closes the outer ring', () => {
    const key = (a: string, b: string) => [a, b].sort().join('|');
    const links = new Set(KINGDOM_LINKS.map(([a, b]) => key(a, b)));
    for (const k of ['Kaldrath', 'Verdance', 'Ashenveil', 'Aurelis', 'Sundrach']) {
      expect(links.has(key('Tidemark', k))).toBe(true);
    }
    const ring = ['Kaldrath', 'Verdance', 'Ashenveil', 'Aurelis', 'Sundrach', 'Kaldrath'];
    for (let i = 0; i < 5; i++) expect(links.has(key(ring[i], ring[i + 1]))).toBe(true);
    expect(links.size).toBe(10);
    expect(Object.keys(KINGDOM_LAYOUT)).toHaveLength(6);
  });
});

// ─── WorldMap ───────────────────────────────────────────────────────────────

describe('WorldMap', () => {
  it('pins each place inside its own kingdom', () => {
    const { container } = render(
      <WorldMap places={PLACES} currentPlaceId="saltmarket-tidemark" location="Saltmarket" />,
    );
    const kaldrath = kingdomGroup(container, 'Kaldrath');
    expect(within(kaldrath).getByRole('img', { name: /^Toll Bridge, Kaldrath/ })).toBeInTheDocument();
    expect(within(kaldrath).getByRole('img', { name: /^Iron Yard, Kaldrath/ })).toBeInTheDocument();
    expect(within(kaldrath).queryByRole('img', { name: /Mossden/ })).not.toBeInTheDocument();
    expect(within(kingdomGroup(container, 'Verdance')).getByRole('img', { name: /^Mossden/ })).toBeInTheDocument();
    expect(within(kingdomGroup(container, 'Tidemark')).getByRole('img', { name: /^Saltmarket/ })).toBeInTheDocument();
  });

  it('orders pins within a kingdom by firstSeenTurn', () => {
    const { container } = render(<WorldMap places={PLACES} currentPlaceId={null} location="x" />);
    const names = within(kingdomGroup(container, 'Kaldrath'))
      .getAllByRole('img')
      .map(el => el.getAttribute('aria-label'));
    expect(names).toEqual(['Iron Yard, Kaldrath', 'Toll Bridge, Kaldrath']);
  });

  it('marks the current place and states it as text', () => {
    const { container } = render(
      <WorldMap places={PLACES} currentPlaceId="toll-bridge-kaldrath" location="Toll Bridge" />,
    );
    const here = screen.getByRole('img', { name: 'Toll Bridge, Kaldrath (you are here)' });
    expect(here).toHaveAttribute('data-current', 'true');
    expect(within(here as unknown as HTMLElement).getByTestId('you-are-here')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="you-are-here"]')).toHaveLength(1);
    expect(screen.getByText('You are here:').parentElement).toHaveTextContent('You are here: Toll Bridge, Kaldrath');
  });

  it('puts unknown-kingdom places in the labelled Uncharted tray', () => {
    const { container } = render(<WorldMap places={PLACES} currentPlaceId={null} location="x" />);
    const tray = kingdomGroup(container, 'unknown');
    expect(tray).toHaveAttribute('aria-label', 'Uncharted, 1 place');
    expect(within(tray).getByText('UNCHARTED')).toBeInTheDocument();
    expect(within(tray).getByRole('img', { name: 'The Drowned Stair, Uncharted' })).toBeInTheDocument();
  });

  it('with no places, shows the kingdoms and the free-text location', () => {
    const { container } = render(<WorldMap places={{}} currentPlaceId={null} location="A cold hillside" />);
    for (const k of ['Kaldrath', 'Verdance', 'Ashenveil', 'Aurelis', 'Tidemark', 'Sundrach']) {
      expect(kingdomGroup(container, k)).toBeInTheDocument();
    }
    expect(screen.getByText('You are here:').parentElement).toHaveTextContent('You are here: A cold hillside');
    expect(screen.getByText('No places discovered yet.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="you-are-here"]')).toHaveLength(0);
  });

  it('truncates long names on the map but keeps the full name accessible and listed', () => {
    const long = 'The Cathedral of Unfinished Hammers Beneath the Ninth Forge';
    const { container } = render(
      <WorldMap
        places={{ 'long-sundrach': { name: long, kingdom: 'Sundrach', firstSeenTurn: 1 } }}
        currentPlaceId={null}
        location="x"
      />,
    );
    const pin = within(kingdomGroup(container, 'Sundrach')).getByRole('img', { name: `${long}, Sundrach` });
    const label = pin.querySelector('text');
    expect(label?.textContent?.endsWith('…')).toBe(true);
    expect((label?.textContent ?? '').length).toBeLessThan(long.length);
    expect(screen.getByRole('listitem')).toHaveTextContent(long);
  });

  it('stays legible past 40 places: labels capped, every place pinned and listed', () => {
    const places: Record<string, Place> = {};
    for (let i = 0; i < 45; i++) {
      places[`p${i}-aurelis`] = { name: `Archive ${i}`, kingdom: 'Aurelis', firstSeenTurn: i };
    }
    const { container } = render(<WorldMap places={places} currentPlaceId="p44-aurelis" location="x" />);
    const aurelis = kingdomGroup(container, 'Aurelis');
    expect(within(aurelis).getAllByRole('img')).toHaveLength(45);
    expect(aurelis.querySelectorAll('g[role="img"] text').length).toBeLessThanOrEqual(LABEL_CAP_KINGDOM);
    expect(screen.getAllByRole('listitem')).toHaveLength(45);
    expect(screen.getByRole('img', { name: 'Archive 44, Aurelis (you are here)' })).toBeInTheDocument();
  });

  it('every text/background pair meets WCAG AA 4.5:1', () => {
    const { container } = render(
      <WorldMap places={PLACES} currentPlaceId="toll-bridge-kaldrath" location="Toll Bridge" />,
    );
    const pairs = textPairs(container);
    expect(pairs.length).toBeGreaterThan(10);
    for (const p of pairs) {
      expect(p.fg, `no colour declared for "${p.text}"`).not.toBe('');
      expect(p.bg, `no background declared behind "${p.text}"`).not.toBe('');
      expect(contrastRatio(p.fg, p.bg), `"${p.text}" ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps its scroll root a flex child with minHeight: 0 (CLAUDE.md #3)', () => {
    render(<WorldMap places={{}} currentPlaceId={null} location="x" />);
    const root = screen.getByTestId('world-map');
    expect(root.style.minHeight).toBe('0px');
    expect(root.style.overflow).toBe('auto');
    expect(root.style.flex).toBe('1 1 0%');
  });
});

// ─── Desktop overlay ────────────────────────────────────────────────────────

function gameState(): GameState {
  return {
    character: {
      name: 'Kaelith',
      race: { id: 'vaelwyn', name: 'Vaelwyn', desc: 'x', intrinsic: [{ name: 'a', description: 'a' }, { name: 'b', description: 'b' }] },
      uniqueSkill: {
        skill_name: 'Memory of Roots',
        tier: 'Unique',
        description: 'd',
        soul_resonance: 'r',
        etching_text: 'e',
      },
      answers: {},
    },
    skills: [],
    location: 'Toll Bridge',
    currentScene: 'The world begins.',
    actionHistory: [],
    narrativeMemory: { entities: {}, notes: [] },
    condition: { hp: 80, mp: 50, sp: 100, max_hp: 100, max_mp: 50, max_sp: 100 },
    attributes: { STR: 10, AGI: 10, INT: 10, WIL: 12 },
    places: PLACES,
    currentPlaceId: 'toll-bridge-kaldrath',
    growthLog: [],
  };
}

function renderDesktop() {
  window.innerWidth = 1280;
  return render(
    <SimulationScreen
      gameState={gameState()}
      log={[{ type: 'narration', text: 'The world begins.' }]}
      isThinking={false}
      logEndRef={{ current: null }}
      newSkillIds={new Set()}
      savingStatus=""
      handleManualSave={() => {}}
      setPhase={() => {}}
      mobileTab="World"
      setMobileTab={() => {}}
      input=""
      setInput={() => {}}
      handleAction={() => {}}
    />,
  );
}

describe('Desktop map overlay', () => {
  it('opens from the Map button, moves focus in, and closes on Escape returning focus', () => {
    renderDesktop();
    const mapButton = screen.getByRole('button', { name: 'Map' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(mapButton);
    const dialog = screen.getByRole('dialog', { name: 'Map of Vaeltharion' });
    expect(within(dialog).getByRole('img', { name: 'Toll Bridge, Kaldrath (you are here)' })).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(mapButton);
  });

  it('closes from the Close button and returns focus to Map', () => {
    renderDesktop();
    const mapButton = screen.getByRole('button', { name: 'Map' });
    fireEvent.click(mapButton);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(mapButton);
  });

  it('overlays the WorldLog only: the log stays mounted and the ActionBar stays usable', () => {
    renderDesktop();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    const dialog = screen.getByRole('dialog');
    expect(screen.getByText('The world begins.')).toBeInTheDocument();
    expect(dialog).not.toContainElement(screen.getByPlaceholderText('What do you do?'));
    const host = dialog.parentElement as HTMLElement;
    expect(host.style.position).toBe('relative');
    expect(host.style.minHeight).toBe('0px');
    expect(host.style.flex).toBe('1 1 0%');
  });
});
