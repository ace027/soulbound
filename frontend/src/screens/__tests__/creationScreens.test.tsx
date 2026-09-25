import { useState } from 'react';
import type { QuestionnaireAnswers, Race, SaveIndexEntry } from '@soulbound/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUESTIONS } from '../../data/questions';
import { RACES } from '../../data/races';
import QuestionnaireScreen from '../QuestionnaireScreen';
import RaceScreen from '../RaceScreen';
import TitleScreen from '../TitleScreen';

/**
 * Character-creation screens (plan 03-07).
 *
 * Counts are derived from src/data/, never restated: every list assertion
 * reads RACES.length / QUESTIONS.length rather than a literal, and the two
 * `toBe` checks below pin the derived values so a data change is a visible
 * test failure rather than a silently weaker suite.
 *
 * RTL's auto-cleanup only installs itself when a global afterEach exists.
 * vitest.config.ts does not set `globals: true`, so cleanup is explicit here —
 * without it the second render of a screen would find two copies in the DOM.
 */
afterEach(cleanup);

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SAVE_A: SaveIndexEntry = {
  id: 'sbc_1000_aaaaa',
  name: 'Kaelith',
  race: 'Vaelwyn',
  location: 'The Hollow Verge',
  skillCount: 4,
  savedAt: 1_700_000_000_000,
  uniqueSkill: 'Memory of Roots',
};

const SAVE_B: SaveIndexEntry = {
  id: 'sbc_2000_bbbbb',
  name: 'Vorn',
  race: 'Stonewarden',
  location: 'Sundrach Deeps',
  skillCount: 7,
  savedAt: 1_700_000_500_000,
  uniqueSkill: 'Anvil of the Unbroken',
};

/**
 * Title screen with `confirmDeleteId` held locally, the way App.tsx will hold
 * it. The tap-to-arm assertion is meaningless against a hard-coded prop: the
 * arm step only exists if setting the id actually re-renders the row.
 */
function TitleHarness(props: {
  saveIndex: SaveIndexEntry[];
  onLoadSave?: (id: string) => void;
  onDeleteSave?: (id: string) => void;
  onNewGame?: () => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  return (
    <TitleScreen
      saveIndex={props.saveIndex}
      confirmDeleteId={confirmDeleteId}
      setConfirmDeleteId={setConfirmDeleteId}
      onLoadSave={props.onLoadSave ?? (() => {})}
      onDeleteSave={props.onDeleteSave ?? (() => {})}
      onNewGame={props.onNewGame ?? (() => {})}
    />
  );
}

function RaceHarness(props: {
  onSelect?: (race: Race) => void;
  onContinue?: () => void;
  onReturnToTitle?: () => void;
}) {
  const [charName, setCharName] = useState('');
  const [selectedRace, setSelectedRace] = useState<Race | null>(null);
  return (
    <RaceScreen
      charName={charName}
      setCharName={setCharName}
      selectedRace={selectedRace}
      setSelectedRace={race => {
        setSelectedRace(race);
        props.onSelect?.(race);
      }}
      onContinue={props.onContinue ?? (() => {})}
      onReturnToTitle={props.onReturnToTitle ?? (() => {})}
    />
  );
}

function QuestionnaireHarness(props: {
  onComplete: (answers: QuestionnaireAnswers) => void;
  onReturnToTitle?: () => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({});
  return (
    <QuestionnaireScreen
      qIndex={qIndex}
      setQIndex={setQIndex}
      answers={answers}
      setAnswers={setAnswers}
      onComplete={props.onComplete}
      onReturnToTitle={props.onReturnToTitle ?? (() => {})}
    />
  );
}

// ─── Title screen ───────────────────────────────────────────────────────────

describe('TitleScreen', () => {
  it('lists every save in the index', () => {
    render(<TitleHarness saveIndex={[SAVE_A, SAVE_B]} />);
    expect(screen.getByText('Kaelith')).toBeInTheDocument();
    expect(screen.getByText('Vorn')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(2);
  });

  it('calls the load handler with the slot id of the row that was clicked', () => {
    const onLoadSave = vi.fn();
    render(<TitleHarness saveIndex={[SAVE_A, SAVE_B]} onLoadSave={onLoadSave} />);
    // Saves sort newest-first, so SAVE_B is row 0 and SAVE_A is row 1.
    const continueButtons = screen.getAllByRole('button', { name: 'Continue' });
    fireEvent.click(continueButtons[1]!);
    expect(onLoadSave).toHaveBeenCalledTimes(1);
    expect(onLoadSave).toHaveBeenCalledWith(SAVE_A.id);
  });

  it('offers a new chronicle and never reaches for a native dialog', () => {
    const onNewGame = vi.fn();
    render(<TitleHarness saveIndex={[]} onNewGame={onNewGame} />);
    fireEvent.click(screen.getByRole('button', { name: /Begin Your Chronicle/ }));
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });

  /**
   * CLAUDE.md #1 regression test. The native browser dialog silently failed
   * to render in
   * the artifact's sandboxed iframe; the project standardised on tap-to-arm
   * with an inline Confirm/Cancel instead. Wiring ✕ straight to the delete
   * handler must fail here.
   */
  describe('tap-to-arm delete (CLAUDE.md #1)', () => {
    it('arms rather than deletes on the first tap', () => {
      const onDeleteSave = vi.fn();
      render(<TitleHarness saveIndex={[SAVE_A]} onDeleteSave={onDeleteSave} />);

      expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '✕' }));

      expect(onDeleteSave).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      // The armed row swaps out the whole group, not just the ✕.
      expect(screen.queryByRole('button', { name: '✕' })).not.toBeInTheDocument();
    });

    it('deletes the armed slot only once Confirm is tapped', () => {
      const onDeleteSave = vi.fn();
      render(<TitleHarness saveIndex={[SAVE_A, SAVE_B]} onDeleteSave={onDeleteSave} />);

      // Row 1 is SAVE_A (newest-first sort puts SAVE_B first).
      fireEvent.click(screen.getAllByRole('button', { name: '✕' })[1]!);
      expect(onDeleteSave).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(onDeleteSave).toHaveBeenCalledTimes(1);
      expect(onDeleteSave).toHaveBeenCalledWith(SAVE_A.id);
    });

    it('disarms on Cancel without deleting', () => {
      const onDeleteSave = vi.fn();
      render(<TitleHarness saveIndex={[SAVE_A]} onDeleteSave={onDeleteSave} />);

      fireEvent.click(screen.getByRole('button', { name: '✕' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onDeleteSave).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '✕' })).toBeInTheDocument();
    });
  });
});

// ─── Race screen ────────────────────────────────────────────────────────────

describe('RaceScreen', () => {
  it('has nine races in src/data to render', () => {
    expect(RACES).toHaveLength(9);
  });

  it('renders every race in RACES', () => {
    const { container } = render(<RaceHarness />);
    for (const race of RACES) {
      expect(screen.getByText(race.name)).toBeInTheDocument();
      expect(screen.getByText(race.desc)).toBeInTheDocument();
    }
    const grid = container.querySelector<HTMLDivElement>('div[style*="grid-template-columns"]');
    expect(grid).not.toBeNull();
    expect(grid!.children).toHaveLength(RACES.length);
  });

  it('reports the chosen race', () => {
    const onSelect = vi.fn();
    render(<RaceHarness onSelect={onSelect} />);
    const last = RACES[RACES.length - 1]!;
    fireEvent.click(screen.getByText(last.name));
    expect(onSelect).toHaveBeenCalledWith(last);
  });

  it('gates the continue button on a name and a race, as legacy does', () => {
    const onContinue = vi.fn();
    render(<RaceHarness onContinue={onContinue} />);
    const submit = screen.getByRole('button', { name: /Enter the World Voice/ });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByText(RACES[0]!.name));
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('What are you called?'), {
      target: { value: 'Kaelith' },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  // Not in legacy (2026-09-25): the way out of character creation.
  it('offers a return to the title screen, ungated', () => {
    const onReturnToTitle = vi.fn();
    const onContinue = vi.fn();
    render(<RaceHarness onReturnToTitle={onReturnToTitle} onContinue={onContinue} />);
    const back = screen.getByRole('button', { name: /Return to title/ });
    expect(back).toBeEnabled();
    fireEvent.click(back);
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });
});

// ─── Questionnaire ──────────────────────────────────────────────────────────

describe('QuestionnaireScreen', () => {
  it('has five questions in src/data to ask', () => {
    expect(QUESTIONS).toHaveLength(5);
  });

  it('asks every question in sequence and accumulates the answers', () => {
    const onComplete = vi.fn();
    render(<QuestionnaireHarness onComplete={onComplete} />);

    const expected: QuestionnaireAnswers = {};
    QUESTIONS.forEach((q, i) => {
      // The question actually on screen is the i-th one, in order.
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(q.text);
      expect(
        screen.getByText(`The World Voice Speaks — ${i + 1} / ${QUESTIONS.length}`),
      ).toBeInTheDocument();

      const answer = `answer-${q.id}`;
      expected[q.id] = answer;
      fireEvent.change(screen.getByPlaceholderText('Write freely...'), {
        target: { value: answer },
      });

      const isLast = i === QUESTIONS.length - 1;
      fireEvent.click(
        screen.getByRole('button', { name: isLast ? /Speak to the World Voice/ : /Continue/ }),
      );
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expected);
  });

  it('will not advance on an empty answer', () => {
    const onComplete = vi.fn();
    render(<QuestionnaireHarness onComplete={onComplete} />);
    const submit = screen.getByRole('button', { name: /Continue/ });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(screen.getByText(`The World Voice Speaks — 1 / ${QUESTIONS.length}`)).toBeInTheDocument();
  });

  it('offers Back only past the first question, and it goes back', () => {
    render(<QuestionnaireHarness onComplete={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Back/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Write freely...'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText(`The World Voice Speaks — 2 / ${QUESTIONS.length}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText(`The World Voice Speaks — 1 / ${QUESTIONS.length}`)).toBeInTheDocument();
    // The answer typed before going back survives.
    expect(screen.getByPlaceholderText('Write freely...')).toHaveValue('x');
  });

  // Not in legacy (2026-09-25): the way out, on the first question too, where
  // "← Back" is absent.
  it('offers a return to the title screen on every question', () => {
    const onReturnToTitle = vi.fn();
    const onComplete = vi.fn();
    render(<QuestionnaireHarness onComplete={onComplete} onReturnToTitle={onReturnToTitle} />);
    QUESTIONS.forEach((_q, i) => {
      expect(screen.getByRole('button', { name: /Return to title/ })).toBeEnabled();
      if (i < QUESTIONS.length - 1) {
        fireEvent.change(screen.getByPlaceholderText('Write freely...'), { target: { value: 'x' } });
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
      }
    });
    fireEvent.click(screen.getByRole('button', { name: /Return to title/ }));
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
