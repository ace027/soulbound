import { act } from 'react';
import type { GameState, LogEntry, Skill } from '@soulbound/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SimulationScreen, { type MobileTab } from '../SimulationScreen';

/**
 * Simulation screen tests (plan 03-08).
 *
 * This is the CLAUDE.md #3 plan. Alongside the ordinary behavioural checks
 * (tab switching, resize response), the "scroll container is a real element"
 * tests are a direct regression guard for the two fixes 03-CONTEXT and the
 * plan call out by legacy line number: the missing `minHeight: 0` at legacy
 * 1386, and the Fragment standing in for a flex container at legacy 1388.
 *
 * jsdom performs no layout — `getBoundingClientRect` is always zero here, so
 * every assertion below reads the *declared* style property
 * (`element.style.minHeight`, etc.), never a computed box. That is sufficient
 * to catch the wrapper losing `minHeight: 0` or the Fragment coming back, but
 * it cannot see a panel that is actually collapsed on screen — that is what
 * the screenshots in the port report are for, not this file.
 *
 * RTL's auto-cleanup only installs itself when a global afterEach exists;
 * vitest.config.ts does not set `globals: true`, so cleanup is explicit here.
 */
afterEach(cleanup);

const JSDOM_DEFAULT_WIDTH = 1024;

function setViewportWidth(width: number): void {
  window.innerWidth = width;
}

function resizeTo(width: number): void {
  act(() => {
    setViewportWidth(width);
    window.dispatchEvent(new Event('resize'));
  });
}

afterEach(() => {
  setViewportWidth(JSDOM_DEFAULT_WIDTH);
  vi.restoreAllMocks();
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

const UNIQUE_SKILL: Skill = {
  name: 'Memory of Roots',
  tier: 'Unique',
  mastery: 30,
  description: 'Recalls what the soil has forgotten.',
  sub_abilities: [],
  usage_notes: [],
  soul_resonance: 'The world remembers you back.',
};

function baseGameState(): GameState {
  return {
    character: {
      name: 'Kaelith',
      race: { id: 'vaelwyn', name: 'Vaelwyn', desc: 'x', intrinsic: [{ name: 'a', description: 'a' }, { name: 'b', description: 'b' }] },
      uniqueSkill: {
        skill_name: 'Memory of Roots',
        tier: 'Unique',
        description: 'Recalls what the soil has forgotten.',
        soul_resonance: 'The world remembers you back.',
        etching_text: 'The soul etches itself into the roots below.',
      },
      answers: {},
    },
    skills: [UNIQUE_SKILL],
    location: 'The Hollow Verge',
    currentScene: 'The world begins.',
    actionHistory: [],
    narrativeMemory: { entities: {}, notes: [] },
    condition: { hp: 100, mp: 50, sp: 100, max_hp: 100, max_mp: 50, max_sp: 100 },
    attributes: { STR: 10, AGI: 10, INT: 10, WIL: 12 },
    places: {},
    currentPlaceId: null,
    growthLog: [],
  };
}

const LOG: LogEntry[] = [
  { type: 'narration', text: 'The world begins.' },
];

/**
 * Walks up from `el` (exclusive) until `pred` matches, or throws. Used
 * instead of a fixed `parentElement` chain depth so the assertions below
 * survive an incidental extra wrapper — they key off the actual style
 * signature legacy gave each ancestor, not a guessed distance.
 */
function ancestorWhere(el: HTMLElement, pred: (e: HTMLElement) => boolean): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (pred(node)) return node;
    node = node.parentElement;
  }
  throw new Error('no matching ancestor found');
}

function renderScreen(props?: Partial<Parameters<typeof SimulationScreen>[0]>) {
  const logEndRef = { current: null };
  return render(
    <SimulationScreen
      gameState={baseGameState()}
      log={LOG}
      isThinking={false}
      logEndRef={logEndRef}
      newSkillIds={new Set()}
      savingStatus=""
      handleManualSave={() => {}}
      setPhase={() => {}}
      mobileTab="World"
      setMobileTab={() => {}}
      input=""
      setInput={() => {}}
      handleAction={() => {}}
      {...props}
    />,
  );
}

// ─── Mobile two-tab layout ──────────────────────────────────────────────────

describe('SimulationScreen — mobile layout', () => {
  it('renders the three-tab layout below 700px', () => {
    setViewportWidth(360);
    renderScreen();

    expect(screen.getByText('✦ World')).toBeInTheDocument();
    expect(screen.getByText('☽ Codex')).toBeInTheDocument();
    expect(screen.getByText('◈ Map')).toBeInTheDocument();
    // World tab active: WorldLog content visible, Codex content is not.
    expect(screen.getByText('The world begins.')).toBeInTheDocument();
    expect(screen.queryByText('Soul Codex')).not.toBeInTheDocument();
  });

  it('swaps World ↔ Codex when the tab switcher is used', () => {
    setViewportWidth(360);
    let tab: MobileTab = 'World';
    const setMobileTab = vi.fn((next: MobileTab) => {
      tab = next;
    });
    const { rerender } = renderScreen({ mobileTab: tab, setMobileTab });

    fireEvent.click(screen.getByText('☽ Codex'));
    expect(setMobileTab).toHaveBeenCalledWith('Codex');

    rerender(
      <SimulationScreen
        gameState={baseGameState()}
        log={LOG}
        isThinking={false}
        logEndRef={{ current: null }}
        newSkillIds={new Set()}
        savingStatus=""
        handleManualSave={() => {}}
        setPhase={() => {}}
        mobileTab="Codex"
        setMobileTab={setMobileTab}
        input=""
        setInput={() => {}}
        handleAction={() => {}}
      />,
    );

    expect(screen.getByText('Soul Codex')).toBeInTheDocument();
    expect(screen.queryByText('The world begins.')).not.toBeInTheDocument();
  });

  it('Map tab shows the world map full height and asks for the Map tab on click', () => {
    setViewportWidth(360);
    const setMobileTab = vi.fn();
    renderScreen({ setMobileTab });
    fireEvent.click(screen.getByText('◈ Map'));
    expect(setMobileTab).toHaveBeenCalledWith('Map');

    cleanup();
    renderScreen({ mobileTab: 'Map' });
    const map = screen.getByTestId('world-map');
    expect(screen.getByRole('group', { name: 'Map of Vaeltharion' })).toBeInTheDocument();
    expect(screen.getByText('You are here:').parentElement).toHaveTextContent('You are here: The Hollow Verge');
    expect(screen.queryByText('The world begins.')).not.toBeInTheDocument();
    expect(screen.queryByText('Soul Codex')).not.toBeInTheDocument();
    // No desktop overlay or Map button on mobile.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();

    // CLAUDE.md #3: real div wrapper with flex: 1 + minHeight: 0, inside the
    // minHeight: 0 content wrapper.
    const wrapper = map.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe('DIV');
    expect(wrapper.style.flex).toBe('1 1 0%');
    expect(wrapper.style.minHeight).toBe('0px');
    const contentWrapper = wrapper.parentElement as HTMLElement;
    expect(contentWrapper.style.minHeight).toBe('0px');
    expect(contentWrapper.style.overflow).toBe('hidden');
  });

  it('pins the compact meters directly above the ActionBar on the World tab', () => {
    setViewportWidth(360);
    renderScreen();
    const strip = screen.getByTestId('condition-strip-compact');
    expect(screen.getByText('HP 100/100')).toBeInTheDocument();
    expect(screen.getAllByRole('meter')).toHaveLength(3);
    const textarea = screen.getByPlaceholderText('What do you do?');
    const actionBarRoot = ancestorWhere(textarea, e => e.previousElementSibling === strip);
    expect(actionBarRoot.parentElement).toBe(strip.parentElement);
  });

  it('shows no compact meters on the Codex tab (the full strip is there instead)', () => {
    setViewportWidth(360);
    renderScreen({ mobileTab: 'Codex' });
    expect(screen.queryByTestId('condition-strip-compact')).not.toBeInTheDocument();
    expect(screen.getByTestId('condition-strip-full')).toBeInTheDocument();
  });

  // ── CLAUDE.md #3 regression: the scroll container is a real element ─────
  it('replaces the legacy Fragment (1388) with a real div carrying flex + minHeight:0', () => {
    setViewportWidth(360);
    renderScreen();

    // The World tab's content lives in WorldLog, whose text node is the
    // anchor for walking back up to the wrapper legacy rendered as `<>`.
    // WorldLog's own root (fixed by plan 03-06) is identified by its exact
    // style signature (flex:1, overflow:auto, minHeight:0, padding).
    const logText = screen.getByText('The world begins.');
    const worldLogRoot = ancestorWhere(
      logText,
      e => e.style.overflow === 'auto' && e.style.flex === '1 1 0%',
    );
    // The content-area wrapper (legacy 1386) has a DIFFERENT style
    // signature (overflow: hidden, not auto) and is identified independently
    // of the Fragment question — it exists whether or not legacy 1388 is a
    // Fragment or a real div.
    const contentWrapper = ancestorWhere(
      logText,
      e => e.style.overflow === 'hidden' && e.style.flex === '1 1 0%' && e.style.display === 'flex',
    );
    const fragmentReplacement = worldLogRoot.parentElement as HTMLElement;

    // The load-bearing assertion: a Fragment adds no DOM node, so if legacy
    // 1388 were still `<>...</>`, WorldLog's root would be a DIRECT child of
    // contentWrapper and `fragmentReplacement` (worldLogRoot.parentElement)
    // would BE contentWrapper itself. A real wrapping div sits strictly
    // between them.
    expect(fragmentReplacement).not.toBe(contentWrapper);
    expect(fragmentReplacement.parentElement).toBe(contentWrapper);

    expect(fragmentReplacement.tagName).toBe('DIV');
    expect(fragmentReplacement.style.display).toBe('flex');
    expect(fragmentReplacement.style.flexDirection).toBe('column');
    expect(fragmentReplacement.style.minHeight).toBe('0px');
    expect(fragmentReplacement.style.flex).toBe('1 1 0%');
  });

  it('applies minHeight:0 to the mobile content wrapper (legacy 1386)', () => {
    setViewportWidth(360);
    renderScreen();

    const logText = screen.getByText('The world begins.');
    // Identified directly by its own signature (legacy 1386), independent of
    // whether the Fragment above it has been replaced by a real div — this
    // wrapper exists either way.
    const contentWrapper = ancestorWhere(
      logText,
      e => e.style.overflow === 'hidden' && e.style.flex === '1 1 0%' && e.style.display === 'flex',
    );

    expect(contentWrapper.style.minHeight).toBe('0px');
    expect(contentWrapper.style.flex).toBe('1 1 0%');
    expect(contentWrapper.style.overflow).toBe('hidden');
  });
});

// ─── Desktop sidebar layout ─────────────────────────────────────────────────

describe('SimulationScreen — desktop layout', () => {
  it('renders the desktop layout with the sidebar at/above 700px', () => {
    setViewportWidth(700);
    renderScreen();

    expect(screen.queryByText('✦ World')).not.toBeInTheDocument();
    // Sidebar (SoulCodexContents) and world column (WorldLog) both present.
    expect(screen.getByText('Soul Codex')).toBeInTheDocument();
    expect(screen.getByText('The world begins.')).toBeInTheDocument();
  });

  it('gives the sidebar and world column minHeight:0 (legacy 1420, 1432)', () => {
    setViewportWidth(1280);
    renderScreen();

    const sidebarHeading = screen.getByText('Soul Codex');
    // Sidebar panel (legacy 1420) is identified by its fixed 240px width —
    // unique to that element, so no ancestor-count guess is needed.
    const sidebarPanel = ancestorWhere(sidebarHeading, e => e.style.width === '240px');
    expect(sidebarPanel.style.minHeight).toBe('0px');

    const logText = screen.getByText('The world begins.');
    // World column (legacy 1432) is the ancestor with overflow:hidden — the
    // desktop layout wraps WorldLog + ActionBar directly with no Fragment,
    // so this is one level up from where the mobile Fragment replacement
    // would sit.
    const worldColumn = ancestorWhere(
      logText,
      e => e.style.overflow === 'hidden' && e.style.flexDirection === 'column',
    );
    expect(worldColumn.style.flex).toBe('1 1 0%');
    expect(worldColumn.style.minHeight).toBe('0px');
  });
});

// ─── Resize response (R12, paired with 03-05) ───────────────────────────────

describe('SimulationScreen — responds to resize', () => {
  it('switches from desktop to mobile layout on a resize, not only at first render', () => {
    setViewportWidth(1200);
    renderScreen();
    expect(screen.getByText('Soul Codex')).toBeInTheDocument();
    expect(screen.queryByText('✦ World')).not.toBeInTheDocument();

    resizeTo(360);

    expect(screen.getByText('✦ World')).toBeInTheDocument();
  });

  it('switches from mobile to desktop layout on a resize', () => {
    setViewportWidth(360);
    renderScreen();
    expect(screen.getByText('✦ World')).toBeInTheDocument();

    resizeTo(1200);

    expect(screen.queryByText('✦ World')).not.toBeInTheDocument();
    expect(screen.getByText('Soul Codex')).toBeInTheDocument();
  });
});
