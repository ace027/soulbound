/**
 * Hosted-mode additions to the API client (Phase 6, 06-06): `getAccessState`,
 * `redeemInvite`, `deleteAccount`, the `SIGN_IN_REQUIRED` branch in the shared
 * error path, and `takeSignInParams`.
 *
 * `fetch` is stubbed for every test, exactly as in `api.test.ts`: an unqueued
 * call throws, so nothing here can reach a network.
 */

import { MODE_HEADER } from '@soulbound/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  callWorldEngine,
  checkAccess,
  deleteAccount,
  getAccessState,
  onSignInRequired,
  redeemInvite,
} from '../api';
import { takeSignInParams } from '../authClient';
import { onPassphraseRequired, setPassphrase } from '../passphrase';

function makeResponse(init: {
  status: number;
  body?: string;
  contentType?: string | null;
  headers?: Record<string, string>;
}): Response {
  const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
  const headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    statusText: '',
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'content-type' ? contentType : (headers[name.toLowerCase()] ?? null),
    },
    json: async (): Promise<unknown> => JSON.parse(init.body ?? '') as unknown,
    text: async (): Promise<string> => init.body ?? '',
  } as unknown as Response;
}

const HOSTED = { [MODE_HEADER]: 'hosted' };

function errorResponse(status: number, code: string, headers: Record<string, string> = {}): Response {
  return makeResponse({
    status,
    body: JSON.stringify({ error: { message: 'm', code } }),
    headers,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function respondWith(response: Response): void {
  fetchMock.mockResolvedValueOnce(response);
}

function init(call = 0): RequestInit {
  return fetchMock.mock.calls[call]?.[1] as RequestInit;
}

beforeEach(() => {
  fetchMock = vi.fn(() => {
    throw new Error('Unqueued fetch call — no test may reach the network.');
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('getAccessState', () => {
  it('maps a hosted 204 to ok, hosted', async () => {
    respondWith(makeResponse({ status: 204, contentType: null, headers: HOSTED }));
    await expect(getAccessState()).resolves.toEqual({ access: 'ok', hosted: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/access');
    expect(init().method).toBe('GET');
  });

  it('maps a self-host 204 (no mode header) to ok, not hosted', async () => {
    respondWith(makeResponse({ status: 204, contentType: null }));
    await expect(getAccessState()).resolves.toEqual({ access: 'ok', hosted: false });
  });

  it('maps 401 PASSPHRASE_REQUIRED to required, not hosted', async () => {
    respondWith(errorResponse(401, 'PASSPHRASE_REQUIRED'));
    await expect(getAccessState()).resolves.toEqual({ access: 'required', hosted: false });
  });

  it('maps a hosted 401 SIGN_IN_REQUIRED to signin, hosted', async () => {
    respondWith(errorResponse(401, 'SIGN_IN_REQUIRED', HOSTED));
    await expect(getAccessState()).resolves.toEqual({ access: 'signin', hosted: true });
  });

  it('maps a 401 with another code to unknown', async () => {
    respondWith(errorResponse(401, 'SOMETHING_ELSE', HOSTED));
    await expect(getAccessState()).resolves.toEqual({ access: 'unknown', hosted: true });
  });

  it('maps a hosted 429 to unknown, still hosted', async () => {
    respondWith(errorResponse(429, 'TOO_MANY_REQUESTS', HOSTED));
    await expect(getAccessState()).resolves.toEqual({ access: 'unknown', hosted: true });
  });

  it('maps a 502 text/plain to unknown', async () => {
    respondWith(makeResponse({ status: 502, body: 'Bad Gateway', contentType: 'text/plain' }));
    await expect(getAccessState()).resolves.toEqual({ access: 'unknown', hosted: false });
  });

  it('maps a network error to unknown, not hosted', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(getAccessState()).resolves.toEqual({ access: 'unknown', hosted: false });
  });

  it('only the exact value "hosted" counts', async () => {
    respondWith(makeResponse({ status: 204, contentType: null, headers: { [MODE_HEADER]: 'selfhost' } }));
    await expect(getAccessState()).resolves.toEqual({ access: 'ok', hosted: false });
  });

  it('leaves checkAccess mapping SIGN_IN_REQUIRED to unknown', async () => {
    respondWith(errorResponse(401, 'SIGN_IN_REQUIRED', HOSTED));
    await expect(checkAccess()).resolves.toBe('unknown');
  });
});

describe('redeemInvite', () => {
  const CODE = 'abcdefghijklmnopqrstuv';

  it('204 → ok, posting the code same-origin with no passphrase header', async () => {
    setPassphrase('correct-horse-battery');
    respondWith(makeResponse({ status: 204, contentType: null }));
    await expect(redeemInvite(CODE)).resolves.toBe('ok');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/invites/redeem');
    expect(init().method).toBe('POST');
    expect(init().credentials).toBe('same-origin');
    expect(JSON.parse(String(init().body))).toEqual({ code: CODE });
    expect(Object.keys(init().headers as Record<string, string>)).not.toContain('Authorization');
  });

  it('400 → invalid', async () => {
    respondWith(errorResponse(400, 'INVITE_INVALID'));
    await expect(redeemInvite(CODE)).resolves.toBe('invalid');
  });

  it('500 → error', async () => {
    respondWith(errorResponse(500, 'INTERNAL_ERROR'));
    await expect(redeemInvite(CODE)).resolves.toBe('error');
  });

  it('429 → error', async () => {
    respondWith(errorResponse(429, 'TOO_MANY_REQUESTS'));
    await expect(redeemInvite(CODE)).resolves.toBe('error');
  });

  it('a network error → error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(redeemInvite(CODE)).resolves.toBe('error');
  });
});

describe('deleteAccount', () => {
  it('204 → ok, a same-origin DELETE with no passphrase header', async () => {
    setPassphrase('correct-horse-battery');
    respondWith(makeResponse({ status: 204, contentType: null }));
    await expect(deleteAccount()).resolves.toBe('ok');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/account');
    expect(init().method).toBe('DELETE');
    expect(init().credentials).toBe('same-origin');
    expect(Object.keys(init().headers as Record<string, string>)).not.toContain('Authorization');
  });

  it('401 SIGN_IN_REQUIRED → error, and tells ModeGate', async () => {
    const listener = vi.fn();
    const unsubscribe = onSignInRequired(listener);
    respondWith(errorResponse(401, 'SIGN_IN_REQUIRED', HOSTED));
    await expect(deleteAccount()).resolves.toBe('error');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('500 → error, without the sign-in event', async () => {
    const listener = vi.fn();
    const unsubscribe = onSignInRequired(listener);
    respondWith(errorResponse(500, 'INTERNAL_ERROR'));
    await expect(deleteAccount()).resolves.toBe('error');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('a network error → error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(deleteAccount()).resolves.toBe('error');
  });
});

describe('the shared error path', () => {
  const STATE = {} as Parameters<typeof callWorldEngine>[1];

  it('a 401 SIGN_IN_REQUIRED mid-game emits sign-in-required, not passphrase-required', async () => {
    const signIn = vi.fn();
    const passphrase = vi.fn();
    const offSignIn = onSignInRequired(signIn);
    const offPassphrase = onPassphraseRequired(passphrase);
    respondWith(errorResponse(401, 'SIGN_IN_REQUIRED'));
    await expect(callWorldEngine('look around', STATE)).rejects.toThrow(/SIGN_IN_REQUIRED/);
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(passphrase).not.toHaveBeenCalled();
    offSignIn();
    offPassphrase();
  });

  it('a 401 PASSPHRASE_REQUIRED does not emit sign-in-required', async () => {
    const signIn = vi.fn();
    const off = onSignInRequired(signIn);
    respondWith(errorResponse(401, 'PASSPHRASE_REQUIRED'));
    await expect(callWorldEngine('look around', STATE)).rejects.toThrow();
    expect(signIn).not.toHaveBeenCalled();
    off();
  });

  it('unsubscribe stops delivery', async () => {
    const signIn = vi.fn();
    const off = onSignInRequired(signIn);
    off();
    respondWith(errorResponse(401, 'SIGN_IN_REQUIRED'));
    await expect(callWorldEngine('look around', STATE)).rejects.toThrow();
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('takeSignInParams', () => {
  const CODE = 'Abc_def-ghijklmnopqrst';

  function run(url: string) {
    const u = new URL(url, 'https://play.example');
    const replaceState = vi.fn();
    const params = takeSignInParams(
      { hash: u.hash, search: u.search, pathname: u.pathname },
      { replaceState, state: null },
    );
    return { params, replaceState };
  }

  it('takes the invite from the fragment and strips it', () => {
    const { params, replaceState } = run(`/#invite=${CODE}`);
    expect(params).toEqual({ invite: CODE });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0]?.[2]).toBe('/');
  });

  it('flags a malformed invite without keeping its value', () => {
    const { params, replaceState } = run('/#invite=short');
    expect(params).toEqual({ inviteMalformed: true });
    expect(replaceState.mock.calls[0]?.[2]).toBe('/');
  });

  it('takes Better Auth error codes from the query and strips both params', () => {
    const { params, replaceState } = run('/?error=INVITE_REQUIRED&error_description=Some%20text');
    expect(params).toEqual({ error: 'INVITE_REQUIRED' });
    expect(replaceState.mock.calls[0]?.[2]).toBe('/');
  });

  it('keeps unrelated query and fragment values', () => {
    const { replaceState } = run(`/?keep=1&error=X#invite=${CODE}&other=2`);
    expect(replaceState.mock.calls[0]?.[2]).toBe('/?keep=1#other=2');
  });

  it('does nothing when neither is present', () => {
    const { params, replaceState } = run('/?keep=1#section');
    expect(params).toEqual({});
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('strips but never uses ?invite= in the query (invites travel only in the fragment)', () => {
    const { params, replaceState } = run(`/?invite=${CODE}`);
    expect(params).toEqual({});
    expect(replaceState.mock.calls[0]?.[2]).toBe('/');
  });
});
