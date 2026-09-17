import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOBILE_BREAKPOINT, useIsMobile } from '../useIsMobile';

/**
 * Regression cover for R12 bug 1 (legacy souldbound-world.jsx line 1348:
 * `const isMobile = window.innerWidth < 700;` read during render, with no
 * subscription).
 *
 * Each assertion below has been observed failing against a mutated hook —
 * subscription removed, `< 700` widened to `<= 700`, cleanup dropped.
 */

const JSDOM_DEFAULT_WIDTH = 1024;

/** jsdom's `innerWidth` has a real setter, so assignment is enough. */
function setViewportWidth(width: number): void {
  window.innerWidth = width;
}

/** Dispatches the event a browser fires on rotation or a window drag. */
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

describe('useIsMobile', () => {
  it('keeps the legacy breakpoint at 700', () => {
    expect(MOBILE_BREAKPOINT).toBe(700);
  });

  it('is true below the breakpoint on first render', () => {
    setViewportWidth(360);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  // The boundary pair. Legacy compares with `<`, so 699 is mobile and 700 is
  // not; an off-by-one silently hands a 700px-wide device the other layout.
  it('is true at exactly 699px', () => {
    setViewportWidth(699);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it('is false at exactly 700px', () => {
    setViewportWidth(700);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it('is false above the breakpoint on first render', () => {
    setViewportWidth(1200);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  // ── R12: the bug legacy actually had ──────────────────────────────────────
  it('updates when the viewport crosses the breakpoint after mount', () => {
    setViewportWidth(1200);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    resizeTo(360);
    expect(result.current).toBe(true);

    resizeTo(1200);
    expect(result.current).toBe(false);
  });

  it('tracks the boundary across a resize, not only on first render', () => {
    setViewportWidth(1200);

    const { result } = renderHook(() => useIsMobile());

    resizeTo(699);
    expect(result.current).toBe(true);

    resizeTo(700);
    expect(result.current).toBe(false);
  });

  it('removes its resize listener on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useIsMobile());

    const added = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(added).toBeDefined();

    unmount();

    const removed = removeSpy.mock.calls.find(([type]) => type === 'resize');
    expect(removed).toBeDefined();
    // Same handler reference: removeEventListener with a fresh closure removes
    // nothing, which is the leak this test exists to catch.
    expect(removed?.[1]).toBe(added?.[1]);
  });
});
