import { cleanup, render, screen } from '@testing-library/react';
import { createElement, useEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Proves the wave-0 harness supports what waves 2-4 actually do, rather than
 * that a test file can run at all. Each assertion here has been observed
 * failing with its guard removed (plan 03-01 task 2) — a harness seen only
 * passing is not evidence that it is wired up.
 *
 * Written with createElement rather than JSX only so the file can keep the
 * .ts extension the plan names; vitest.config.ts loads @vitejs/plugin-react,
 * so the .tsx test files waves 2-4 ship transform fine.
 */

afterEach(cleanup);

/** Mirrors the shape of the ported simulation screen's auto-scroll effect. */
function ScrollingLog() {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return createElement(
    'div',
    null,
    createElement('p', null, 'A log entry'),
    createElement('div', { ref: endRef, 'data-testid': 'log-end' }),
  );
}

describe('frontend test harness', () => {
  it('registers jest-dom matchers on expect', () => {
    render(createElement('button', null, 'Speak to the World Voice'));

    // toBeInTheDocument, NOT toBeTruthy: toBeTruthy would pass whether or not
    // setup.ts ever imported @testing-library/jest-dom/vitest, which is
    // exactly how a broken harness ships green.
    expect(screen.getByRole('button', { name: 'Speak to the World Voice' })).toBeInTheDocument();
  });

  it('renders a component whose effect calls scrollIntoView', () => {
    // jsdom does not implement Element.prototype.scrollIntoView; setup.ts
    // stubs it. Without the stub this render throws inside the effect.
    expect(() => render(createElement(ScrollingLog))).not.toThrow();
    expect(screen.getByTestId('log-end')).toBeInTheDocument();
  });

  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
