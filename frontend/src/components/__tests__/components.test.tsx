import { useState } from 'react';
import type {
  GameState,
  LogEntry,
  Skill,
} from '@soulbound/shared';
import { TIER_STYLE } from '@soulbound/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionBar from '../ActionBar';
import ConditionStrip from '../ConditionStrip';
import SkillCard from '../SkillCard';
import SoulCodexContents from '../SoulCodexContents';
import WorldLog from '../WorldLog';

/**
 * Presentational component tests (plan 03-06).
 *
 * Behavioural, not a style snapshot — pinning every inline style object would
 * make the verbatim port un-editable and would not test anything real. Only
 * the one CLAUDE.md #3 fix (WorldLog's `minHeight: 0`) is asserted at the
 * style level, because that is the actual regression this plan guards
 * against.
 *
 * RTL's auto-cleanup only installs itself when a global afterEach exists;
 * vitest.config.ts does not set `globals: true`, so cleanup is explicit here.
 */
afterEach(cleanup);

// ─── Fixtures ───────────────────────────────────────────────────────────────

const COMMON_SKILL: Skill = {
  name: 'Sturdy Grip',
  tier: 'Common',
  mastery: 42,
  description: 'A steady hand in a chaotic world.',
};

const UNIQUE_SKILL: Skill = {
  name: 'Memory of Roots',
  tier: 'Unique',
  mastery: 30,
  description: 'Recalls what the soil has forgotten.',
  sub_abilities: [
    { name: 'Deep Anchor', unlock_mastery: 25, description: 'Roots that do not move.' },
  ],
  usage_notes: [],
  soul_resonance: 'The world remembers you back.',
};

function baseGameState(skills: Skill[]): GameState {
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
    skills,
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

// ─── SkillCard ──────────────────────────────────────────────────────────────

describe('SkillCard', () => {
  it('renders the name, tier and mastery', () => {
    render(<SkillCard skill={COMMON_SKILL} isNew={false} />);
    expect(screen.getByText('Sturdy Grip')).toBeInTheDocument();
    expect(screen.getByText('Common')).toBeInTheDocument();
    expect(screen.getByText('42/100')).toBeInTheDocument();
  });

  it("applies the tier's colour from TIER_STYLE", () => {
    render(<SkillCard skill={{ ...COMMON_SKILL, tier: 'Extra' }} isNew={false} />);
    expect(screen.getByText('Sturdy Grip')).toHaveStyle({ color: TIER_STYLE.Extra.color });
  });

  /**
   * SkillCard has no sub-ability markup at all (legacy 534-565) — that block
   * lives in SoulCodexContents (legacy 625-641), covered further down. This
   * test instead covers SkillCard's own analogous optional block: the
   * description paragraph, present only when `skill.description` is set
   * (legacy 551-553).
   */
  it('renders the description block when present and omits it when absent', () => {
    render(<SkillCard skill={COMMON_SKILL} isNew={false} />);
    expect(screen.getByText(COMMON_SKILL.description)).toBeInTheDocument();

    cleanup();
    render(<SkillCard skill={{ ...COMMON_SKILL, description: '' }} isNew={false} />);
    expect(screen.queryByText(COMMON_SKILL.description)).not.toBeInTheDocument();
  });

  it('renders the isNew glow treatment when isNew is true', () => {
    render(<SkillCard skill={COMMON_SKILL} isNew={true} />);
    const card = screen.getByText('Sturdy Grip').closest('div[style]')?.parentElement;
    expect(card).toHaveStyle({ animation: 'etchIn 0.8s ease-out' });
  });

  it('omits the glow treatment when isNew is false', () => {
    render(<SkillCard skill={COMMON_SKILL} isNew={false} />);
    const card = screen.getByText('Sturdy Grip').closest('div[style]')?.parentElement;
    expect(card).toHaveStyle({ animation: 'none' });
  });
});

// ─── SoulCodexContents ──────────────────────────────────────────────────────

describe('SoulCodexContents', () => {
  it('renders the character, location and non-Unique skills', () => {
    const gameState = baseGameState([COMMON_SKILL, UNIQUE_SKILL]);
    render(
      <SoulCodexContents
        gameState={gameState}
        uniqueSkill={UNIQUE_SKILL}
        newSkillIds={new Set()}
        savingStatus=""
        handleManualSave={vi.fn()}
        setPhase={vi.fn()}
      />,
    );
    expect(screen.getByText('Kaelith')).toBeInTheDocument();
    expect(screen.getByText('Vaelwyn')).toBeInTheDocument();
    expect(screen.getByText('The Hollow Verge')).toBeInTheDocument();
    // COMMON_SKILL is rendered via SkillCard (filtered to non-Unique).
    expect(screen.getByText('Sturdy Grip')).toBeInTheDocument();
  });

  it('renders unlocked sub-abilities and the locked placeholder for the rest', () => {
    const gameState = baseGameState([UNIQUE_SKILL]);
    render(
      <SoulCodexContents
        gameState={gameState}
        uniqueSkill={UNIQUE_SKILL}
        newSkillIds={new Set()}
        savingStatus=""
        handleManualSave={vi.fn()}
        setPhase={vi.fn()}
      />,
    );
    expect(screen.getByText('Deep Anchor')).toBeInTheDocument();
    // 1 of 3 unlocked -> 2 more sleep.
    expect(screen.getByText(/2 more sleep, waiting to be discovered/)).toBeInTheDocument();
  });

  it('invokes handleManualSave when the Slot button is clicked', () => {
    const handleManualSave = vi.fn();
    const gameState = baseGameState([UNIQUE_SKILL]);
    render(
      <SoulCodexContents
        gameState={gameState}
        uniqueSkill={UNIQUE_SKILL}
        newSkillIds={new Set()}
        savingStatus=""
        handleManualSave={handleManualSave}
        setPhase={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('+ Slot'));
    expect(handleManualSave).toHaveBeenCalledTimes(1);
  });
});

// ─── ConditionStrip (Phase 15) ──────────────────────────────────────────────

/** WCAG 2.x relative luminance of `#rrggbb` or `rgb(r, g, b)`. */
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
 * Every element that renders its own text, paired with the colour it is
 * drawn in and the nearest declared background behind it. Walking the
 * rendered DOM, rather than a hand-copied colour list, means a new text
 * element or a changed colour is measured automatically.
 */
function textPairs(root: Element): Array<{ text: string; fg: string; bg: string }> {
  const nearest = (el: Element | null, read: (e: HTMLElement) => string): string => {
    for (let n = el; n; n = n.parentElement) {
      const v = read(n as HTMLElement);
      if (v) return v;
    }
    return '';
  };
  const pairs: Array<{ text: string; fg: string; bg: string }> = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const own = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent ?? '')
      .join('')
      .trim();
    if (!own) continue;
    pairs.push({
      text: own,
      fg: nearest(el, e => e.style?.color ?? ''),
      bg: nearest(el, e => e.style?.backgroundColor ?? ''),
    });
  }
  return pairs;
}

describe('ConditionStrip', () => {
  const CONDITION = { hp: 84, mp: 20, sp: 61, max_hp: 100, max_mp: 50, max_sp: 90 };
  const ATTRIBUTES = { STR: 11, AGI: 9, INT: 14, WIL: 12 };

  it('renders HP/MP/SP as visible text and the four attributes (full)', () => {
    render(<ConditionStrip condition={CONDITION} attributes={ATTRIBUTES} variant="full" />);
    expect(screen.getByText('HP 84/100')).toBeInTheDocument();
    expect(screen.getByText('MP 20/50')).toBeInTheDocument();
    expect(screen.getByText('SP 61/90')).toBeInTheDocument();
    for (const [k, v] of Object.entries(ATTRIBUTES)) {
      expect(screen.getByText(k)).toBeInTheDocument();
      expect(screen.getByText(String(v))).toBeInTheDocument();
    }
  });

  it('exposes each pool as role="meter" with correct aria values', () => {
    render(<ConditionStrip condition={CONDITION} attributes={ATTRIBUTES} variant="full" />);
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(3);
    const hp = screen.getByRole('meter', { name: /HP/ });
    expect(hp).toHaveAttribute('aria-valuemin', '0');
    expect(hp).toHaveAttribute('aria-valuenow', '84');
    expect(hp).toHaveAttribute('aria-valuemax', '100');
    const mp = screen.getByRole('meter', { name: /MP/ });
    expect(mp).toHaveAttribute('aria-valuenow', '20');
    expect(mp).toHaveAttribute('aria-valuemax', '50');
    const sp = screen.getByRole('meter', { name: /SP/ });
    expect(sp).toHaveAttribute('aria-valuenow', '61');
    expect(sp).toHaveAttribute('aria-valuemax', '90');
  });

  it('renders a 0 HP state', () => {
    render(<ConditionStrip condition={{ ...CONDITION, hp: 0 }} attributes={ATTRIBUTES} variant="full" />);
    expect(screen.getByText('HP 0/100')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: /HP/ })).toHaveAttribute('aria-valuenow', '0');
  });

  it('compact variant shows the three meters and no attribute row', () => {
    render(<ConditionStrip condition={CONDITION} attributes={ATTRIBUTES} variant="compact" />);
    expect(screen.getAllByRole('meter')).toHaveLength(3);
    expect(screen.getByText('HP 84/100')).toBeInTheDocument();
    expect(screen.queryByText('STR')).not.toBeInTheDocument();
  });

  it.each(['full', 'compact'] as const)('every text/background pair meets WCAG AA 4.5:1 (%s)', variant => {
    const { container } = render(
      <ConditionStrip condition={CONDITION} attributes={ATTRIBUTES} variant={variant} />,
    );
    const pairs = textPairs(container);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.fg, `no colour declared for "${p.text}"`).not.toBe('');
      expect(p.bg, `no background declared behind "${p.text}"`).not.toBe('');
      expect(contrastRatio(p.fg, p.bg), `"${p.text}" ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sits at the top of the Soul Codex', () => {
    render(
      <SoulCodexContents
        gameState={baseGameState([UNIQUE_SKILL])}
        uniqueSkill={UNIQUE_SKILL}
        newSkillIds={new Set()}
        savingStatus=""
        handleManualSave={vi.fn()}
        setPhase={vi.fn()}
      />,
    );
    expect(screen.getByText('HP 100/100')).toBeInTheDocument();
    expect(screen.getByTestId('condition-strip-full')).toBeInTheDocument();
    // No Map button unless the desktop layout asks for one.
    expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();
  });
});

// ─── WorldLog ───────────────────────────────────────────────────────────────

describe('WorldLog', () => {
  it('renders the etching block for a narration entry carrying etchingSkill', () => {
    const log: LogEntry[] = [
      {
        type: 'narration',
        text: 'The world stirs to greet you.',
        etchingSkill: {
          skill_name: 'Memory of Roots',
          tier: 'Unique',
          description: 'Recalls what the soil has forgotten.',
          soul_resonance: 'The world remembers you back.',
          etching_text: 'The soul etches itself into the roots below.',
        },
      },
    ];
    render(
      <WorldLog
        isMobile={false}
        log={log}
        gameState={baseGameState([UNIQUE_SKILL])}
        isThinking={false}
        logEndRef={{ current: null }}
      />,
    );
    expect(screen.getByText(/Soul Etching — Unique Skill Recognized/)).toBeInTheDocument();
    expect(screen.getByText('Memory of Roots')).toBeInTheDocument();
    expect(screen.getByText('The soul etches itself into the roots below.')).toBeInTheDocument();
    expect(screen.getByText('The world remembers you back.')).toBeInTheDocument();
  });

  it('renders entries in order and distinguishes entry types', () => {
    const log: LogEntry[] = [
      { type: 'action', text: 'strike the bell' },
      { type: 'narration', text: 'The bell answers with a low, ancient tone.' },
      { type: 'error', text: 'The World Voice fell silent.' },
    ];
    const { container } = render(
      <WorldLog
        isMobile={false}
        log={log}
        gameState={baseGameState([])}
        isThinking={false}
        logEndRef={{ current: null }}
      />,
    );

    const text = container.textContent ?? '';
    const actionAt = text.indexOf('strike the bell');
    const narrationAt = text.indexOf('The bell answers with a low, ancient tone.');
    const errorAt = text.indexOf('The World Voice fell silent.');
    expect(actionAt).toBeGreaterThanOrEqual(0);
    expect(narrationAt).toBeGreaterThan(actionAt);
    expect(errorAt).toBeGreaterThan(narrationAt);

    // Action entries carry the character's name alongside the text.
    expect(screen.getByText('Kaelith')).toBeInTheDocument();
    // Error entries render in the error colour.
    expect(screen.getByText('The World Voice fell silent.')).toHaveStyle({ color: '#c0392b' });
  });

  /**
   * CLAUDE.md #3 regression test. jsdom performs no layout, so a collapsed
   * flex-scroll region cannot be detected through any layout consequence
   * (getBoundingClientRect is always zeros). This asserts the style property
   * directly instead.
   */
  it("carries minHeight: 0 on its scroll root", () => {
    const { container } = render(
      <WorldLog
        isMobile={false}
        log={[]}
        gameState={baseGameState([])}
        isThinking={false}
        logEndRef={{ current: null }}
      />,
    );
    expect(container.firstElementChild).toHaveStyle({ minHeight: '0px' });
  });
});

// ─── ActionBar ──────────────────────────────────────────────────────────────

function ActionBarHarness({
  isThinking = false,
  onAct,
}: {
  isThinking?: boolean;
  onAct: (input: string) => void;
}) {
  const [input, setInput] = useState('');
  return (
    <ActionBar
      isMobile={false}
      input={input}
      setInput={setInput}
      handleAction={() => onAct(input)}
      isThinking={isThinking}
    />
  );
}

describe('ActionBar', () => {
  it('disables the Act button while isThinking', () => {
    render(<ActionBarHarness isThinking onAct={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('What do you do?'), {
      target: { value: 'Attack the goblin' },
    });
    expect(screen.getByRole('button', { name: 'Act' })).toBeDisabled();
  });

  it('submits the typed value on click, and not while empty', () => {
    const onAct = vi.fn();
    render(<ActionBarHarness onAct={onAct} />);
    const button = screen.getByRole('button', { name: 'Act' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('What do you do?'), {
      target: { value: 'Attack the goblin' },
    });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onAct).toHaveBeenCalledWith('Attack the goblin');
  });

  it('submits on Enter but not on Shift+Enter', () => {
    const onAct = vi.fn();
    render(<ActionBarHarness onAct={onAct} />);
    const textarea = screen.getByPlaceholderText('What do you do?');
    fireEvent.change(textarea, { target: { value: 'Speak to the stranger' } });

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onAct).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onAct).toHaveBeenCalledWith('Speak to the stranger');
  });
});
