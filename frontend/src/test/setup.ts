import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * Global test setup, registered via `setupFiles` in vitest.config.ts.
 *
 * 1. The import above registers jest-dom's matchers (toBeInTheDocument,
 *    toHaveTextContent, ...) on Vitest's `expect`. Having the package in
 *    devDependencies does nothing on its own — without this import every
 *    jest-dom matcher throws as unknown.
 *
 * 2. jsdom does not implement Element.prototype.scrollIntoView. The ported
 *    simulation screen calls it from an effect keyed on the log (legacy
 *    souldbound-world.jsx line 812, against the ref declared at 738 inside
 *    WorldLog). Once that screen renders the ref is non-null, so the optional
 *    chain is no protection: it would throw on mount and again on every log
 *    change. Stub it once here rather than in each test.
 */
Element.prototype.scrollIntoView = vi.fn();
