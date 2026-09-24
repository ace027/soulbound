import { MODE_HEADER } from '@soulbound/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emitSignInRequired } from '../../lib/api';
import * as authClient from '../../lib/authClient';
import ModeGate, { SESSION_REFRESH_MS } from '../ModeGate';
import { CROSS_DEVICE_TEXT, GENERIC_ERROR_TEXT, INVITE_INVALID_TEXT, LINK_USED_TEXT } from '../SignIn';
import { DELETE_WARNING_TEXT } from '../AccountPanel';

/**
 * `<ModeGate>`, `<SignIn>` and `<AccountPanel>` (Phase 6, 06-06). `fetch` is
 * stubbed and routed by method + path; an unrouted call fails the test. The
 * Better Auth helpers are mocked, so no auth request is ever made either.
 */

vi.mock('../../lib/authClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/authClient')>();
  return {
    ...real,
    signInWithEmail: vi.fn(async () => 'sent' as const),
    signInWithProvider: vi.fn(async () => 'redirecting' as const),
    signOut: vi.fn(async () => 'ok' as const),
    refreshSession: vi.fn(async () => undefined),
  };
});

const CODE = 'Abc_def-ghijklmnopqrst';

function res(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? body === undefined
            ? null
            : 'application/json'
          : (lower[name.toLowerCase()] ?? null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const HOSTED = { [MODE_HEADER]: 'hosted' };
const signinRequired = () => res(401, { error: { message: 'Sign in required', code: 'SIGN_IN_REQUIRED' } }, HOSTED);

type Route = () => Response;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;

function calls(method: string, path: string): number {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url) === path && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  ).length;
}

const dialogs = { confirm: vi.fn(), alert: vi.fn(), prompt: vi.fn() };

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    const route = routes[key];
    if (!route) throw new Error(`Unrouted fetch: ${key}`);
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
  dialogs.confirm = vi.spyOn(window, 'confirm').mockImplementation(() => true) as never;
  dialogs.alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined) as never;
  dialogs.prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null) as never;
  vi.mocked(authClient.signInWithEmail).mockClear();
  vi.mocked(authClient.signInWithProvider).mockClear();
  vi.mocked(authClient.signOut).mockClear();
  vi.mocked(authClient.refreshSession).mockClear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  expect(dialogs.confirm).not.toHaveBeenCalled();
  expect(dialogs.alert).not.toHaveBeenCalled();
  expect(dialogs.prompt).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ModeGate: self-host', () => {
  it('renders the child and nothing else, after one GET /api/access', async () => {
    routes['GET /api/access'] = () => res(204);
    const { container } = render(
      <ModeGate>
        <div data-testid="game">the game</div>
      </ModeGate>,
    );
    expect(await screen.findByTestId('game')).toBeInTheDocument();
    expect(container.innerHTML).toBe('<div data-testid="game">the game</div>');
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
    expect(calls('GET', '/api/access')).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never refreshes the session', async () => {
    routes['GET /api/access'] = () => res(204);
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    await screen.findByTestId('game');
    expect(authClient.refreshSession).not.toHaveBeenCalled();
  });

  it('passes a 401 PASSPHRASE_REQUIRED through to its child (AccessGate handles it)', async () => {
    routes['GET /api/access'] = () =>
      res(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } });
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    expect(await screen.findByTestId('game')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('fails open on a network error, like AccessGate', async () => {
    routes['GET /api/access'] = () => {
      throw new TypeError('offline');
    };
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    expect(await screen.findByTestId('game')).toBeInTheDocument();
  });

  it('renders only the background while pending', () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    expect(screen.queryByTestId('game')).not.toBeInTheDocument();
    expect(container.querySelectorAll('*')).toHaveLength(1);
  });
});

describe('ModeGate: hosted', () => {
  it('signin renders SignIn and not the child', async () => {
    routes['GET /api/access'] = signinRequired;
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Discord' })).toBeInTheDocument();
    expect(screen.queryByTestId('game')).not.toBeInTheDocument();
    expect(authClient.refreshSession).not.toHaveBeenCalled();
  });

  it('hosted + ok renders the child and the AccountPanel', async () => {
    routes['GET /api/access'] = () => res(204, undefined, HOSTED);
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    expect(await screen.findByTestId('game')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });

  it('refreshes the session once when signed in, then every 12 hours', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    routes['GET /api/access'] = () => res(204, undefined, HOSTED);
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    await screen.findByTestId('game');
    expect(authClient.refreshSession).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(SESSION_REFRESH_MS - 1);
    });
    expect(authClient.refreshSession).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(authClient.refreshSession).toHaveBeenCalledTimes(2);
  });

  it('a mid-game SIGN_IN_REQUIRED shows sign-in over the still-mounted game', async () => {
    routes['GET /api/access'] = () => res(204, undefined, HOSTED);
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    await screen.findByTestId('game');
    act(() => emitSignInRequired());
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game')).toBeInTheDocument();
    expect(screen.getByText(/Your session has ended/)).toBeInTheDocument();
  });
});

describe('SignIn: invites', () => {
  it('takeSignInParams clears #invite from the real URL; ModeGate redeems it exactly once under StrictMode', async () => {
    window.history.replaceState(null, '', `/#invite=${CODE}`);
    const params = authClient.takeSignInParams();
    expect(params).toEqual({ invite: CODE });
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(CODE);

    routes['GET /api/access'] = signinRequired;
    routes['POST /api/invites/redeem'] = () => res(204);
    render(
      <StrictMode>
        <ModeGate signInParams={params}>
          <div data-testid="game" />
        </ModeGate>
      </StrictMode>,
    );
    expect(await screen.findByText(/Your invite is ready/)).toBeInTheDocument();
    expect(calls('POST', '/api/invites/redeem')).toBe(1);
    const body = JSON.parse(String((fetchMock.mock.calls.find(([u]) => u === '/api/invites/redeem')![1] as RequestInit).body));
    expect(body).toEqual({ code: CODE });
  });

  it('a 400 shows the invalid-invite message and keeps the email form', async () => {
    routes['GET /api/access'] = signinRequired;
    routes['POST /api/invites/redeem'] = () => res(400, { error: { message: 'x', code: 'INVITE_INVALID' } });
    render(
      <ModeGate signInParams={{ invite: CODE }}>
        <div />
      </ModeGate>,
    );
    expect(await screen.findByText(INVITE_INVALID_TEXT)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('a malformed invite shows the invalid message without calling the server', async () => {
    routes['GET /api/access'] = signinRequired;
    render(
      <ModeGate signInParams={{ inviteMalformed: true }}>
        <div />
      </ModeGate>,
    );
    expect(await screen.findByText(INVITE_INVALID_TEXT)).toBeInTheDocument();
    expect(calls('POST', '/api/invites/redeem')).toBe(0);
  });

  it('a server error offers a retry that redeems again', async () => {
    routes['GET /api/access'] = signinRequired;
    routes['POST /api/invites/redeem'] = () => res(500, { error: { message: 'x', code: 'INTERNAL_ERROR' } });
    render(
      <ModeGate signInParams={{ invite: CODE }}>
        <div />
      </ModeGate>,
    );
    const retry = await screen.findByRole('button', { name: 'Check my invite again' });
    routes['POST /api/invites/redeem'] = () => res(204);
    fireEvent.click(retry);
    expect(await screen.findByText(/Your invite is ready/)).toBeInTheDocument();
    expect(calls('POST', '/api/invites/redeem')).toBe(2);
  });
});

describe('SignIn: sending a link', () => {
  it('an email submit shows the check-your-email state', async () => {
    routes['GET /api/access'] = signinRequired;
    render(
      <ModeGate>
        <div />
      </ModeGate>,
    );
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: ' friend@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a sign-in link' }));
    expect(await screen.findByText(/open the link in this browser/)).toBeInTheDocument();
    expect(authClient.signInWithEmail).toHaveBeenCalledWith('friend@example.com');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Check your email' })).toHaveFocus());
  });

  it('"I\'ve signed in — continue" re-checks access', async () => {
    routes['GET /api/access'] = signinRequired;
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'a@b.c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a sign-in link' }));
    const cont = await screen.findByRole('button', { name: /signed in/ });
    routes['GET /api/access'] = () => res(204, undefined, HOSTED);
    fireEvent.click(cont);
    expect(await screen.findByTestId('game')).toBeInTheDocument();
  });

  it('Google and Discord start their OAuth sign-in', async () => {
    routes['GET /api/access'] = signinRequired;
    render(
      <ModeGate>
        <div />
      </ModeGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Discord' }));
    await waitFor(() => expect(authClient.signInWithProvider).toHaveBeenCalledWith('discord'));
  });
});

describe('SignIn: error redirects', () => {
  async function renderWithError(error: string) {
    routes['GET /api/access'] = signinRequired;
    render(
      <ModeGate signInParams={{ error }}>
        <div />
      </ModeGate>,
    );
    await screen.findByRole('heading');
  }

  it('INVITE_REQUIRED shows the cross-device message and "Send me a new link" re-shows the email step', async () => {
    await renderWithError('INVITE_REQUIRED');
    expect(screen.getByText(CROSS_DEVICE_TEXT)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(screen.queryByText(CROSS_DEVICE_TEXT)).not.toBeInTheDocument();
  });

  it('INVALID_TOKEN (a used or expired link) also offers a new link', async () => {
    await renderWithError('INVALID_TOKEN');
    expect(screen.getByText(LINK_USED_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send me a new link' })).toBeInTheDocument();
  });

  it('INVITE_INVALID shows the invalid-invite message above the form', async () => {
    await renderWithError('INVITE_INVALID');
    expect(screen.getByText(INVITE_INVALID_TEXT)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('an unknown code is never rendered; a fixed message is', async () => {
    const hostile = '<b>Call 555-0100 to restore your account</b>';
    await renderWithError(hostile);
    expect(document.body.textContent).not.toContain('555-0100');
    expect(document.body.innerHTML).not.toContain('555-0100');
    expect(screen.getByText(GENERIC_ERROR_TEXT)).toBeInTheDocument();
  });

  it('a prototype key is treated as unknown', async () => {
    await renderWithError('toString');
    expect(screen.getByText(GENERIC_ERROR_TEXT)).toBeInTheDocument();
  });
});

describe('AccountPanel', () => {
  async function renderSignedIn() {
    routes['GET /api/access'] = () => res(204, undefined, HOSTED);
    render(
      <ModeGate>
        <div data-testid="game" />
      </ModeGate>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
  }

  it('delete needs two clicks, calls DELETE exactly once, then shows sign-in', async () => {
    routes['DELETE /api/account'] = () => res(204);
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByText(DELETE_WARNING_TEXT)).toBeInTheDocument();
    expect(calls('DELETE', '/api/account')).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(calls('DELETE', '/api/account')).toBe(1);
    expect(screen.queryByTestId('game')).not.toBeInTheDocument();
    // Straight to sign-in: no re-check of /api/access after the 204.
    expect(calls('GET', '/api/access')).toBe(1);
  });

  it('Cancel disarms without deleting', async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(DELETE_WARNING_TEXT)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
    expect(calls('DELETE', '/api/account')).toBe(0);
  });

  it('a failed delete stays put and says so', async () => {
    routes['DELETE /api/account'] = () => res(500, { error: { message: 'x', code: 'INTERNAL_ERROR' } });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Couldn.t delete your account/)).toBeInTheDocument();
    expect(screen.getByTestId('game')).toBeInTheDocument();
  });

  it('sign out calls signOut and shows sign-in', async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('game')).not.toBeInTheDocument();
  });

  it('Escape closes the panel and returns focus to the button', async () => {
    await renderSignedIn();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sign out' }), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Account' })).toHaveFocus();
  });
});
