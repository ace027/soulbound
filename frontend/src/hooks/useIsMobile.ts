import { useEffect, useState } from 'react';

/**
 * The legacy mobile breakpoint, kept at `< 700` exactly.
 *
 * Legacy souldbound-world.jsx line 1348 reads `window.innerWidth < 700` during
 * render, inside the simulation branch. Strictly less-than: a 700px-wide
 * viewport gets the desktop layout. Do not relax this to `<=` — it silently
 * moves which layout a 700px device receives.
 */
export const MOBILE_BREAKPOINT = 700;

/** Matches what legacy computed on first render, minus the SSR/node crash. */
function readIsMobile(): boolean {
  // The module is imported by node-environment tests and would be evaluated by
  // any future SSR pass; neither has a `window`. Legacy's desktop-first default
  // is the safe answer there, since it is what a 1024px jsdom/browser gives.
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * Resize-aware replacement for legacy's render-time `window.innerWidth` read
 * (R12, bug 1). The legacy expression had no subscription at all, so rotating a
 * phone or dragging a window across 700px left the layout stale until something
 * unrelated re-rendered.
 *
 * `resize` + `innerWidth` rather than `matchMedia('(max-width: 699px)')`: the
 * two are equivalent in a browser, but jsdom implements no `matchMedia` and the
 * wave-0 test setup that would stub it is frozen. This is also the more literal
 * port — one breakpoint constant, compared the same way legacy compared it,
 * with no 699/700 translation step to get wrong.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(readIsMobile);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onResize = () => setIsMobile(readIsMobile());

    // The viewport can change between the first render and this effect (a
    // rotation mid-mount, or a hydration whose initial value was the default).
    onResize();
    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}
