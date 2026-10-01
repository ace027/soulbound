import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QuestionnaireAnswers } from '@soulbound/shared';
import { QUESTIONS } from '../../data/questions';
import QuestionnaireScreen from '../QuestionnaireScreen';

/**
 * The questionnaire screen additions of 2026-10-01 (screen-only; nothing here
 * changes what is sent to /api/unique-skill): the framing note on question 1,
 * the "A sentence or two is enough." guide, the reworded power hint, and the
 * review step before the last answer completes.
 */

// RTL's auto-cleanup needs a global afterEach; vitest.config.ts has no `globals`.
afterEach(cleanup);

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

const typeAnswer = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('Write freely...'), { target: { value } });

/** Answers every question as `answer-<id>` and stops on the review. */
function reachReview() {
  QUESTIONS.forEach((q, i) => {
    typeAnswer(`answer-${q.id}`);
    fireEvent.click(
      screen.getByRole('button', { name: i === QUESTIONS.length - 1 ? /Review your answers/ : /Continue/ }),
    );
  });
}

describe('questionnaire guidance', () => {
  it('shows the framing note on question 1 only', () => {
    render(<Harness onComplete={vi.fn()} />);
    expect(screen.getByText(/Answer as yourself/)).toBeInTheDocument();
    typeAnswer('x');
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.queryByText(/Answer as yourself/)).not.toBeInTheDocument();
  });

  it('shows the "a sentence or two is enough" guide on every question', () => {
    render(<Harness onComplete={vi.fn()} />);
    QUESTIONS.forEach((_q, i) => {
      expect(screen.getByText('A sentence or two is enough.')).toBeInTheDocument();
      if (i < QUESTIONS.length - 1) {
        typeAnswer('x');
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
      }
    });
  });

  it('no longer names the Unique Skill mechanic in the power hint', () => {
    const bond = QUESTIONS.find((q) => q.id === 'bond')!;
    expect(bond.hint).not.toMatch(/Unique Skill/i);
    expect(bond.hint).not.toMatch(/axis/i);
    render(<Harness onComplete={vi.fn()} />);
    QUESTIONS.forEach((_q, i) => {
      if (i < QUESTIONS.length - 1) {
        typeAnswer('x');
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
      }
    });
    expect(screen.getByText(bond.hint)).toBeInTheDocument();
  });
});

describe('questionnaire review step', () => {
  it('opens a review after the last answer and does not complete yet', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    reachReview();

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText(/This is what the World Voice will read/)).toBeInTheDocument();
    QUESTIONS.forEach((q) => {
      expect(screen.getByText(`answer-${q.id}`)).toBeInTheDocument();
    });
  });

  it('will not open the review on an empty last answer', () => {
    render(<Harness onComplete={vi.fn()} />);
    QUESTIONS.slice(0, -1).forEach((q) => {
      typeAnswer(`answer-${q.id}`);
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    });
    const review = screen.getByRole('button', { name: /Review your answers/ });
    expect(review).toBeDisabled();
    fireEvent.click(review);
    expect(screen.queryByText(/This is what the World Voice will read/)).not.toBeInTheDocument();
  });

  it('completes with exactly the written answers, once, from the review button', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Speak to the World Voice/ }));

    const expected: QuestionnaireAnswers = {};
    QUESTIONS.forEach((q) => (expected[q.id] = `answer-${q.id}`));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expected);
  });

  it('Edit returns to that question, and "Back to review" returns with the change', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    reachReview();

    fireEvent.click(screen.getByRole('button', { name: 'Edit answer 2' }));
    expect(screen.getByText(`The World Voice Speaks — 2 / ${QUESTIONS.length}`)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write freely...')).toHaveValue(`answer-${QUESTIONS[1].id}`);

    typeAnswer('a changed answer');
    fireEvent.click(screen.getByRole('button', { name: /Back to review/ }));

    expect(screen.getByText(/This is what the World Voice will read/)).toBeInTheDocument();
    expect(screen.getByText('a changed answer')).toBeInTheDocument();
    expect(screen.queryByText(`answer-${QUESTIONS[1].id}`)).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Speak to the World Voice/ }));
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ [QUESTIONS[1].id]: 'a changed answer', [QUESTIONS[4].id]: `answer-${QUESTIONS[4].id}` }),
    );
  });

  it('cannot return to the review with the edited answer emptied', () => {
    render(<Harness onComplete={vi.fn()} />);
    reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Edit answer 3' }));
    typeAnswer('   ');
    expect(screen.getByRole('button', { name: /Back to review/ })).toBeDisabled();
  });

  it('Back from the review goes to the LAST question with its answer kept, even after an Edit', () => {
    render(<Harness onComplete={vi.fn()} />);
    reachReview();

    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText(`The World Voice Speaks — 5 / ${QUESTIONS.length}`)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write freely...')).toHaveValue(`answer-${QUESTIONS[4].id}`);

    // Review again, edit an earlier answer, return, then Back: still question 5.
    fireEvent.click(screen.getByRole('button', { name: /Review your answers/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit answer 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Back to review/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(screen.getByText(`The World Voice Speaks — 5 / ${QUESTIONS.length}`)).toBeInTheDocument();
  });

  it('keeps the way back to the title available on the review', () => {
    const onReturnToTitle = vi.fn();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} onReturnToTitle={onReturnToTitle} />);
    reachReview();
    fireEvent.click(screen.getByRole('button', { name: /Return to title/ }));
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
