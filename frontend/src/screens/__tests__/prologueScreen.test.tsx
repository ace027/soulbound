/**
 * PrologueScreen (Phase 14, R36). vitest has no `globals`, so RTL's automatic
 * cleanup never registers: `afterEach(cleanup)` is explicit.
 *
 * `../../lib/api` is mocked so no request is made; ApiClientError stays real.
 * jsdom does no layout, so geometry (no horizontal overflow, scroll position)
 * is proved by the 14-04 e2e, not here.
 */
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROLOGUE_OPENING, type PrologueHistoryEntry } from '@soulbound/shared';
import { ApiClientError, prologueBeat, prologueProfile } from '../../lib/api';
import PrologueScreen from '../PrologueScreen';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  prologueBeat: vi.fn(),
  prologueProfile: vi.fn(),
}));

const beatMock = vi.mocked(prologueBeat);
const profileMock = vi.mocked(prologueProfile);

const PROFILE = {
  nature: 'PROFILE-NATURE-VALUE',
  drive: 'PROFILE-DRIVE-VALUE',
  flaw: 'PROFILE-FLAW-VALUE',
  memory: 'PROFILE-MEMORY-VALUE',
  bond: 'PROFILE-BOND-VALUE',
};

const players = (h: PrologueHistoryEntry[]) => h.filter((e) => e.role === 'player').length;

function scriptedBeat(overrides: Record<number, Partial<{ final: boolean }>> = {}) {
  beatMock.mockImplementation(async (h) => {
    const n = players(h);
    return { narration: `Beat ${n} narration`, beat: n, final: overrides[n]?.final ?? n === 4 };
  });
}

const originalScroll = window.HTMLElement.prototype.scrollIntoView;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  beatMock.mockReset();
  profileMock.mockReset();
  scriptedBeat();
  profileMock.mockResolvedValue(PROFILE);
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: originalScroll,
    configurable: true,
    writable: true,
  });
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

const box = () => screen.getByRole('textbox', { name: 'Your action' }) as HTMLTextAreaElement;
const actButton = () => screen.getByRole('button', { name: 'Act →' });

function renderScreen() {
  const onComplete = vi.fn();
  const onReturnToTitle = vi.fn();
  render(<PrologueScreen onComplete={onComplete} onReturnToTitle={onReturnToTitle} />);
  return { onComplete, onReturnToTitle };
}

async function takeTurn(n: number, text = `action ${n}`) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(actButton());
  await screen.findByText(`Beat ${n} narration`);
}

async function playToEnd() {
  for (let n = 1; n <= 4; n++) await takeTurn(n);
}

const letButton = () => screen.getByRole('button', { name: 'Let it take hold →' });

describe('opening', () => {
  it('shows the opening, the guide line, a disabled Act and no Let it take hold', () => {
    renderScreen();
    expect(screen.getByText(PROLOGUE_OPENING)).toBeInTheDocument();
    expect(screen.getByText('A sentence or two is enough. Say or do anything.')).toBeInTheDocument();
    expect(screen.getByText('The World Voice Speaks — The Threshold')).toBeInTheDocument();
    expect(actButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Let it take hold →' })).not.toBeInTheDocument();
  });

  it.each(['', '   ', '\n\t '])('keeps Act disabled for %j', (value) => {
    renderScreen();
    fireEvent.change(box(), { target: { value } });
    expect(actButton()).toBeDisabled();
  });
});

describe('the four turns', () => {
  it('posts the right history each turn and ends with the take-hold controls', async () => {
    renderScreen();
    await playToEnd();

    expect(beatMock).toHaveBeenCalledTimes(4);
    const first = beatMock.mock.calls[0]![0];
    expect(first).toEqual([
      { role: 'narrator', text: PROLOGUE_OPENING },
      { role: 'player', text: 'action 1' },
    ]);
    const fourth = beatMock.mock.calls[3]![0];
    expect(fourth.map((e) => e.role)).toEqual([
      'narrator', 'player', 'narrator', 'player', 'narrator', 'player', 'narrator', 'player',
    ]);
    expect(fourth.map((e) => e.text)).toEqual([
      PROLOGUE_OPENING, 'action 1', 'Beat 1 narration', 'action 2',
      'Beat 2 narration', 'action 3', 'Beat 3 narration', 'action 4',
    ]);

    expect(screen.queryByPlaceholderText('Say or do anything...')).not.toBeInTheDocument();
    expect(letButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy scene record' })).toBeInTheDocument();
    expect(screen.getByText('You — action 3')).toBeInTheDocument();
  });

  it('does not show the take-hold controls while the fourth beat is still being read', async () => {
    renderScreen();
    for (let n = 1; n <= 3; n++) await takeTurn(n);
    let resolve!: (v: { narration: string; beat: number; final: boolean }) => void;
    beatMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    fireEvent.change(box(), { target: { value: 'action 4' } });
    fireEvent.click(actButton());
    expect(screen.getByText('The dark answers...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Let it take hold →' })).not.toBeInTheDocument();
    await act(async () => resolve({ narration: 'Beat 4 narration', beat: 4, final: true }));
    expect(letButton()).toBeInTheDocument();
  });

  it('shows a reading state and disables the input while a beat is pending', async () => {
    renderScreen();
    let resolve!: (v: { narration: string; beat: number; final: boolean }) => void;
    beatMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    fireEvent.change(box(), { target: { value: 'I wait' } });
    fireEvent.click(actButton());

    expect(screen.getByText('The dark answers...')).toBeInTheDocument();
    expect(screen.getByText('The dark answers...')).toHaveAttribute('aria-live', 'polite');
    expect(box()).toBeDisabled();
    expect(actButton()).toBeDisabled();

    await act(async () => resolve({ narration: 'Beat 1 narration', beat: 1, final: false }));
    expect(screen.queryByText('The dark answers...')).not.toBeInTheDocument();
    expect(box()).toBeEnabled();
  });

  it('sends one request when Act is clicked twice before a re-render', async () => {
    renderScreen();
    fireEvent.change(box(), { target: { value: 'twice' } });
    const btn = actButton();
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(beatMock).toHaveBeenCalledTimes(1);
  });

  it('trusts its own count, not response.final', async () => {
    scriptedBeat({ 4: { final: false } });
    renderScreen();
    await playToEnd();
    expect(letButton()).toBeInTheDocument();
  });

  it('does not end early when the server says final on beat 2', async () => {
    scriptedBeat({ 2: { final: true } });
    renderScreen();
    await takeTurn(1);
    await takeTurn(2);
    expect(screen.queryByRole('button', { name: 'Let it take hold →' })).not.toBeInTheDocument();
    expect(box()).toBeEnabled();
  });
});

describe('trimming', () => {
  it('sends the trimmed action text to prologueBeat', async () => {
    renderScreen();
    fireEvent.change(box(), { target: { value: '  hello  ' } });
    fireEvent.click(actButton());
    await screen.findByText('Beat 1 narration');
    expect(beatMock.mock.calls[0]![0].at(-1)).toEqual({ role: 'player', text: 'hello' });
  });
});

describe('accessibility', () => {
  it('names the action textbox and describes it with the hint', () => {
    renderScreen();
    const tb = screen.getByRole('textbox', { name: 'Your action' });
    expect(tb).toHaveAccessibleDescription('A sentence or two is enough. Say or do anything.');
  });

  it('exposes scene progress and a polite transcript log', async () => {
    renderScreen();
    const bar = screen.getByRole('progressbar', { name: 'Scene progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    await takeTurn(1);
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveTextContent('Beat 1 narration');
  });
});

describe('beat errors', () => {
  it('shows an alert, restores the text, drops the player entry, and a retry works', async () => {
    renderScreen();
    await takeTurn(1);
    beatMock.mockRejectedValueOnce(
      new ApiClientError('boom', { code: 'UPSTREAM_ERROR', path: '/api/prologue/beat' }),
    );
    fireEvent.change(box(), { target: { value: 'my second action' } });
    fireEvent.click(actButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The World Voice fell silent. boom');
    expect(box().value).toBe('my second action');
    expect(screen.queryByText('You — my second action')).not.toBeInTheDocument();
    expect(screen.getByText('You — action 1')).toBeInTheDocument();
    expect(screen.getByText('Beat 1 narration')).toBeInTheDocument();

    fireEvent.click(actButton());
    await screen.findByText('Beat 2 narration');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(beatMock.mock.calls[2]![0].at(-1)).toEqual({ role: 'player', text: 'my second action' });
  });

  it('on a beat 3 failure keeps beats 1 and 2 and restores beat 3', async () => {
    renderScreen();
    await takeTurn(1);
    await takeTurn(2);
    beatMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.change(box(), { target: { value: 'third' } });
    fireEvent.click(actButton());
    await screen.findByRole('alert');
    expect(box().value).toBe('third');
    expect(screen.getByText('Beat 2 narration')).toBeInTheDocument();
    expect(screen.queryByText('You — third')).not.toBeInTheDocument();
  });
});

describe('distilling', () => {
  it('calls prologueProfile with the nine-entry history and traits, completing once', async () => {
    const { onComplete } = renderScreen();
    await playToEnd();
    fireEvent.click(letButton());
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    expect(profileMock).toHaveBeenCalledTimes(1);
    const [history, canon] = profileMock.mock.calls[0]!;
    expect(history).toHaveLength(9);
    expect(canon).toBe('traits');
    const arg = onComplete.mock.calls[0]![0];
    expect(Object.keys(arg).sort()).toEqual(['bond', 'drive', 'flaw', 'memory', 'nature']);
    expect(arg).toEqual(PROFILE);
  });

  it('shows the distilling line and calls prologueProfile once for a double click', async () => {
    const { onComplete } = renderScreen();
    await playToEnd();
    let resolve!: (v: typeof PROFILE) => void;
    profileMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const btn = letButton();
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(screen.getByText('The dark takes hold...')).toBeInTheDocument();
    await act(async () => resolve(PROFILE));
    expect(profileMock).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // completedRef is a belt-and-braces guard: after success the screen stays in
  // 'distilling', so the button is disabled and a click never reaches the handler.
  it('leaves the button disabled after success, so a further click calls nothing', async () => {
    const { onComplete } = renderScreen();
    await playToEnd();
    fireEvent.click(letButton());
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(letButton()).toBeDisabled();
    fireEvent.click(letButton());
    await Promise.resolve();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(profileMock).toHaveBeenCalledTimes(1);
  });

  it('does not call onComplete when unmounted while the profile is pending', async () => {
    const onComplete = vi.fn();
    const { unmount } = render(<PrologueScreen onComplete={onComplete} onReturnToTitle={vi.fn()} />);
    await playToEnd();
    let resolve!: (v: typeof PROFILE) => void;
    profileMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    fireEvent.click(letButton());
    expect(profileMock).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => resolve(PROFILE));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('still completes normally under StrictMode double-mounting', async () => {
    const onComplete = vi.fn();
    render(
      <StrictMode>
        <PrologueScreen onComplete={onComplete} onReturnToTitle={vi.fn()} />
      </StrictMode>,
    );
    await playToEnd();
    fireEvent.click(letButton());
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith(PROFILE);
  });

  it('passes scene when the URL says ?canon=scene', async () => {
    window.history.pushState({}, '', '/?canon=scene');
    renderScreen();
    await playToEnd();
    fireEvent.click(letButton());
    await waitFor(() => expect(profileMock).toHaveBeenCalled());
    expect(profileMock.mock.calls[0]![1]).toBe('scene');
  });

  it('shows an alert on a profile failure, re-enables the button, and a retry completes once', async () => {
    const { onComplete } = renderScreen();
    await playToEnd();
    profileMock.mockRejectedValueOnce(new Error('nope'));
    fireEvent.click(letButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('The World Voice fell silent. nope');
    expect(letButton()).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(letButton());
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(profileMock).toHaveBeenCalledTimes(2);
  });
});

describe('copy scene record', () => {
  it('writes the record to the clipboard and never includes the profile', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderScreen();
    await playToEnd();
    fireEvent.click(screen.getByRole('button', { name: 'Copy scene record' }));
    expect(await screen.findByText('Scene record copied.')).toBeInTheDocument();

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text.startsWith('THE SOULBOUND CHRONICLES — PROLOGUE SCENE RECORD')).toBe(true);
    expect(text).toContain('canon: traits');
    expect(text).toContain(`OPENING: ${PROLOGUE_OPENING}`);
    for (let i = 1; i <= 4; i++) {
      expect(text).toContain(`ACTION ${i}: action ${i}`);
      expect(text).toContain(`BEAT ${i}: Beat ${i} narration`);
    }
    for (const value of Object.values(PROFILE)) expect(text).not.toContain(value);
    expect(text).not.toContain('PROFILE-');
  });

  it('includes the profile-free record even after distilling was attempted', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderScreen();
    await playToEnd();
    profileMock.mockRejectedValueOnce(new Error('x'));
    fireEvent.click(letButton());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Copy scene record' }));
    await screen.findByText('Scene record copied.');
    expect(writeText.mock.calls[0]![0]).not.toContain('PROFILE-');
  });

  it('falls back to a read-only textarea when navigator.clipboard is undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderScreen();
    await playToEnd();
    fireEvent.click(screen.getByRole('button', { name: 'Copy scene record' }));
    expect(
      await screen.findByText('Could not copy automatically — select the text below.'),
    ).toBeInTheDocument();
    const record = screen.getByLabelText('Scene record') as HTMLTextAreaElement;
    expect(record.readOnly).toBe(true);
    expect(record.value.startsWith('THE SOULBOUND CHRONICLES — PROLOGUE SCENE RECORD')).toBe(true);
    expect(record.value).toContain('BEAT 4: Beat 4 narration');
  });

  it('falls back when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderScreen();
    await playToEnd();
    fireEvent.click(screen.getByRole('button', { name: 'Copy scene record' }));
    expect(await screen.findByLabelText('Scene record')).toBeInTheDocument();
  });

  it('has no copy control before the scene is done', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: 'Copy scene record' })).not.toBeInTheDocument();
  });
});

describe('return to title', () => {
  it('fires onReturnToTitle at the opening, never onComplete', () => {
    const { onComplete, onReturnToTitle } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: '← Return to title' }));
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('fires onReturnToTitle mid-scene', async () => {
    const { onComplete, onReturnToTitle } = renderScreen();
    await takeTurn(1);
    await takeTurn(2);
    fireEvent.click(screen.getByRole('button', { name: '← Return to title' }));
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('scrolling and focus', () => {
  it('scrolls after each appended entry and refocuses the textarea after a beat', async () => {
    const scroll = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      value: scroll,
      configurable: true,
      writable: true,
    });
    renderScreen();
    // Not on mount: scrolling there opened the page 64 px down (14-04 e2e finding).
    expect(scroll).not.toHaveBeenCalled();
    const afterMount = scroll.mock.calls.length;

    fireEvent.change(box(), { target: { value: 'first' } });
    fireEvent.click(actButton());
    await screen.findByText('Beat 1 narration');
    // player entry, then narrator entry
    await waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(afterMount + 2));
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    await waitFor(() => expect(document.activeElement).toBe(box()));

    const beforeError = scroll.mock.calls.length;
    beatMock.mockRejectedValueOnce(new Error('x'));
    fireEvent.change(box(), { target: { value: 'second' } });
    fireEvent.click(actButton());
    await screen.findByRole('alert');
    expect(scroll.mock.calls.length).toBeGreaterThan(beforeError);
  });

  it('moves focus to Let it take hold after the fourth beat', async () => {
    renderScreen();
    await playToEnd();
    await waitFor(() => expect(document.activeElement).toBe(letButton()));
  });

  it('does not submit on Enter', () => {
    renderScreen();
    fireEvent.change(box(), { target: { value: 'hello' } });
    fireEvent.keyDown(box(), { key: 'Enter', code: 'Enter' });
    fireEvent.keyPress(box(), { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.keyUp(box(), { key: 'Enter', code: 'Enter' });
    expect(beatMock).not.toHaveBeenCalled();
  });
});

describe('long unbroken text', () => {
  it('renders a 2000-character action in a container that wraps anywhere', async () => {
    renderScreen();
    const long = 'x'.repeat(2000);
    fireEvent.change(box(), { target: { value: long } });
    fireEvent.click(actButton());
    const entry = await screen.findByText(`You — ${long}`);
    expect(entry.getAttribute('style')).toContain('overflow-wrap: anywhere');
    expect(entry.getAttribute('style')).toContain('white-space: pre-wrap');
  });
});
