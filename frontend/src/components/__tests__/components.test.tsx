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
