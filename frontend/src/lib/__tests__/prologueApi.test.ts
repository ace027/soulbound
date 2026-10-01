/**
 * Prologue client functions. `fetch` is stubbed (no network), restored after
 * each test. Mirrors the response stand-in in api.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROLOGUE_OPENING, type PrologueHistoryEntry } from '@soulbound/shared';
import { ApiClientError, prologueBeat, prologueProfile } from '../api';

function makeResponse(status: number, body: string, contentType = 'application/json'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'content-type' ? contentType : null,
    },
    json: async (): Promise<unknown> => JSON.parse(body) as unknown,
    text: async (): Promise<string> => body,
  } as unknown as Response;
}

const json = (status: number, body: unknown) => makeResponse(status, JSON.stringify(body));

const HISTORY: PrologueHistoryEntry[] = [
  { role: 'narrator', text: PROLOGUE_OPENING },
  { role: 'player', text: 'I reach for the smaller soul.' },
];

const PROFILE = { nature: 'a', drive: 'b', flaw: 'c', memory: 'd', bond: 'e' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => {
    throw new Error('Unqueued fetch call');
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const body = () => JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
const path = () => String(fetchMock.mock.calls[0]?.[0]);

describe('prologueBeat', () => {
  it('posts { history } to /api/prologue/beat and returns the parsed reply', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { narration: 'The seam narrows.', beat: 1, final: false }));
    const res = await prologueBeat(HISTORY);
    expect(path()).toBe('/api/prologue/beat');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect(body()).toEqual({ history: HISTORY });
    expect(res).toEqual({ narration: 'The seam narrows.', beat: 1, final: false });
  });

  it('turns a 400 INVALID_REQUEST envelope into an ApiClientError with that code', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { error: { message: 'bad history', code: 'INVALID_REQUEST' } }),
    );
    const err = (await prologueBeat(HISTORY).catch((e: unknown) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.status).toBe(400);
  });

  it('maps a 200 body missing a key to INVALID_RESPONSE_SHAPE', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { narration: 'x', beat: 1 }));
    const err = (await prologueBeat(HISTORY).catch((e: unknown) => e)) as ApiClientError;
    expect(err.code).toBe('INVALID_RESPONSE_SHAPE');
  });

  it('maps a 200 HTML body to NON_JSON_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, '<html></html>', 'text/html'));
    const err = (await prologueBeat(HISTORY).catch((e: unknown) => e)) as ApiClientError;
    expect(err.code).toBe('NON_JSON_RESPONSE');
  });
});

describe('prologueProfile', () => {
  it('posts { history, canon } to /api/prologue/profile and returns the profile', async () => {
    fetchMock.mockResolvedValueOnce(json(200, PROFILE));
    const res = await prologueProfile(HISTORY, 'scene');
    expect(path()).toBe('/api/prologue/profile');
    expect(body()).toEqual({ history: HISTORY, canon: 'scene' });
    expect(res).toEqual(PROFILE);
  });

  it('turns a 400 INVALID_REQUEST envelope into an ApiClientError', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, { error: { message: 'bad', code: 'INVALID_REQUEST' } }),
    );
    const err = (await prologueProfile(HISTORY, 'traits').catch((e: unknown) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe('INVALID_REQUEST');
  });

  it('maps a profile missing a key to INVALID_RESPONSE_SHAPE', async () => {
    const { bond: _bond, ...partial } = PROFILE;
    fetchMock.mockResolvedValueOnce(json(200, partial));
    const err = (await prologueProfile(HISTORY, 'traits').catch((e: unknown) => e)) as ApiClientError;
    expect(err.code).toBe('INVALID_RESPONSE_SHAPE');
  });

  it('maps a 200 HTML body to NON_JSON_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, '<html></html>', 'text/html'));
    const err = (await prologueProfile(HISTORY, 'traits').catch((e: unknown) => e)) as ApiClientError;
    expect(err.code).toBe('NON_JSON_RESPONSE');
  });
});
