/**
 * The Phase 14 flag wrapper in QuestionnaireScreen. Flag off must be the
 * questionnaire; `?prologue=1` must be the prologue. vitest has no `globals`,
 * so `afterEach(cleanup)` is explicit, and the URL is reset after every test.
 * `../../lib/api` is mocked so no request can be made.
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROLOGUE_OPENING, type QuestionnaireAnswers } from '@soulbound/shared';
import { QUESTIONS } from '../../data/questions';
import QuestionnaireScreen from '../QuestionnaireScreen';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  prologueBeat: vi.fn(),
  prologueProfile: vi.fn(),
}));

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

function Harness(props: { onComplete: (a: QuestionnaireAnswers) => void; onReturnToTitle?: () => void }) {
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

function expectQuestionnaire() {
  expect(screen.getByText(`"${QUESTIONS[0]!.text}"`)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Write freely...')).toBeInTheDocument();
  expect(screen.queryByText('The World Voice Speaks — The Threshold')).not.toBeInTheDocument();
  expect(screen.queryByText(PROLOGUE_OPENING)).not.toBeInTheDocument();
}

describe('QuestionnaireScreen flag wrapper', () => {
  it('renders the questionnaire with no flag, and never completes from rendering alone', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    expectQuestionnaire();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('renders the prologue with ?prologue=1', () => {
    window.history.pushState({}, '', '/?prologue=1');
    render(<Harness onComplete={vi.fn()} />);
    expect(screen.getByText(PROLOGUE_OPENING)).toBeInTheDocument();
    expect(screen.getByText('The World Voice Speaks — The Threshold')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Write freely...')).not.toBeInTheDocument();
    expect(screen.queryByText(`"${QUESTIONS[0]!.text}"`)).not.toBeInTheDocument();
  });

  it.each(['?prologue=0', '?prologue=true', '?prologue=', '?canon=scene'])(
    'renders the questionnaire for %s',
    (search) => {
      window.history.pushState({}, '', `/${search}`);
      render(<Harness onComplete={vi.fn()} />);
      expectQuestionnaire();
    },
  );

  it('keeps Return to title working with the flag on', () => {
    window.history.pushState({}, '', '/?prologue=1');
    const onReturnToTitle = vi.fn();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} onReturnToTitle={onReturnToTitle} />);
    fireEvent.click(screen.getByRole('button', { name: '← Return to title' }));
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
