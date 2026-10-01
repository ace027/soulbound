/**
 * Phase 14, plan 14-04: the whole-App test for the prologue handoff (retro AI-1).
 *
 * `prologueScreen.test.tsx` renders PrologueScreen with a stubbed `onComplete`,
 * and `appIntegration.test.tsx` drives the questionnaire path. Neither proves
 * that with `?prologue=1` the REAL App turns the scene's profile into the call
 * to `/api/unique-skill` with the name and race the player chose, then reaches
 * the simulation. That seam (QuestionnaireScreen wrapper -> PrologueScreen ->
 * App.handleQuestionnaireComplete) is exactly what this file drives.
 *
 * Nothing here can reach a network: `fetch` is stubbed per URL and any URL not
 * listed throws. The fixtures are copied from appIntegration.test.tsx's
 * creation flow, not imported from it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorldVoiceResponseSchema, type WorldVoiceResponse } from '@soulbound/shared';

import App from '../App';

const PROFILE = {
  nature: 'It held its ground when the cold came.',
  drive: 'It put the other soul first.',
  flaw: 'It did not weigh its own cost.',
  memory: 'It let go at the doorway and gave up its name.',
  bond: 'It treated power as something to spend for others.',
};

const DETERMINATION = {
  skill_name: 'The Held Door',
  tier: 'Unique',
  description: 'Keeps a threshold open for another.',
  soul_resonance: 'It yields first.',
  etching_text: 'Something swings wide and stays.',
};

// Parsed through the shared schema, not cast (see appIntegration.test.tsx).
const INTRO: WorldVoiceResponse = WorldVoiceResponseSchema.parse({
  narration: 'You come to yourself on a cold road.',
  state_updates: {
    skill_mastery_changes: [],
    new_skills_granted: [],
    skill_evolutions: [],
    unique_sub_ability_unlocked: null,
    world_events: [
      { type: 'scene_set', location: 'The Cold Road', scene_summary: 'A road under frost.', description: null },
    ],
  },
  narrative_memory_updates: { new_entities: [], note: 'The road is cold.' },
  gm_note: null,
});

interface Call {
  url: string;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A per-URL fetch stub that records every call. `overrides` replaces the
 * default handler for a URL (it receives the 1-based call number for that URL).
 */
function stubFetch(overrides: Partial<Record<string, (n: number) => Response | Promise<Response>>> = {}) {
  const calls: Call[] = [];
  const perUrl = new Map<string, number>();
  const defaults: Record<string, (n: number) => Response> = {
    '/api/prologue/beat': (n) => json({ narration: `Beat ${n} narration.`, beat: n, final: n === 4 }),
    '/api/prologue/profile': () => json(PROFILE),
    '/api/unique-skill': () => json(DETERMINATION),
    '/api/intro-scene': () => json(INTRO),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const n = (perUrl.get(url) ?? 0) + 1;
      perUrl.set(url, n);
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const handler = overrides[url] ?? defaults[url];
      if (!handler) throw new Error(`unexpected request to ${url}`);
      return handler(n);
    }),
  );
  return {
    calls,
    count: (url: string) => calls.filter((c) => c.url === url).length,
    of: (url: string) => calls.filter((c) => c.url === url),
  };
}

async function chooseRaceAndName(name = 'Yulen Marr') {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: /Begin Your Chronicle/ }));
  fireEvent.change(await screen.findByPlaceholderText('What are you called?'), { target: { value: name } });
  fireEvent.click(screen.getByText('Shadeveil'));
  fireEvent.click(screen.getByRole('button', { name: /Enter the World Voice/i }));
}

async function playFourTurns() {
  for (let i = 1; i <= 4; i++) {
    const box = await screen.findByPlaceholderText('Say or do anything...');
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.change(box, { target: { value: `action ${i}` } });
    fireEvent.click(screen.getByRole('button', { name: /^Act/ }));
    await screen.findByText(`Beat ${i} narration.`);
  }
}

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/?prologue=1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('App with ?prologue=1', () => {
  it('title -> race+name -> four beats -> profile -> unique-skill with the five keys -> intro -> simulation', async () => {
    const f = stubFetch();
    await chooseRaceAndName('Yulen Marr');

    // The prologue opening is shown in place of the questionnaire.
    expect(await screen.findByText(/The World Voice Speaks — The Threshold/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Write freely...')).not.toBeInTheDocument();

    await playFourTurns();
    fireEvent.click(await screen.findByRole('button', { name: /Let it take hold/ }));
    await screen.findByPlaceholderText('What do you do?');

    expect(f.count('/api/prologue/beat')).toBe(4);
    expect(f.count('/api/prologue/profile')).toBe(1);
    expect(f.count('/api/unique-skill')).toBe(1);
    expect(f.count('/api/intro-scene')).toBe(1);

    const skillBody = f.of('/api/unique-skill')[0]!.body as {
      name: string;
      race: { name: string };
      answers: unknown;
    };
    expect(skillBody.answers).toEqual(PROFILE);
    expect(Object.keys(skillBody.answers as object).sort()).toEqual(['bond', 'drive', 'flaw', 'memory', 'nature']);
    expect(skillBody.name).toBe('Yulen Marr');
    expect(skillBody.race.name).toBe('Shadeveil');

    // Request order: beats, then profile, then unique-skill, then intro scene.
    expect(f.calls.map((c) => c.url)).toEqual([
      '/api/prologue/beat',
      '/api/prologue/beat',
      '/api/prologue/beat',
      '/api/prologue/beat',
      '/api/prologue/profile',
      '/api/unique-skill',
      '/api/intro-scene',
    ]);
    expect(screen.getByText(/Soul Codex/)).toBeInTheDocument();
  });

  it('a failed profile call shows an alert, makes no unique-skill call, and a retry completes the flow', async () => {
    const f = stubFetch({
      '/api/prologue/profile': (n) =>
        n === 1 ? json({ error: { code: 'UPSTREAM_ERROR', message: 'the aether is quiet' } }, 502) : json(PROFILE),
    });
    await chooseRaceAndName();
    await playFourTurns();

    fireEvent.click(await screen.findByRole('button', { name: /Let it take hold/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/The World Voice fell silent\./);
    expect(f.count('/api/prologue/profile')).toBe(1);
    expect(f.count('/api/unique-skill')).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /Let it take hold/ }));
    await screen.findByPlaceholderText('What do you do?');
    expect(f.count('/api/prologue/profile')).toBe(2);
    expect(f.count('/api/unique-skill')).toBe(1);
    expect(f.count('/api/intro-scene')).toBe(1);
    expect(f.count('/api/prologue/beat')).toBe(4);
  });

  it('PRE-EXISTING App limitation: a unique-skill failure after a good profile strands the player on the loading screen', async () => {
    // App.tsx is frozen for Phase 14. handleQuestionnaireComplete sets the
    // phase to 'loading' BEFORE its try block and its catch only rewrites the
    // loading message, so the screen the player sees is a dead end with the
    // error text. A questionnaire failure behaves identically today, and the
    // prologue transcript is gone (PrologueScreen has already unmounted).
    // This test records that behaviour; it is not an endorsement. If App.tsx
    // later offers a way back, update this test deliberately.
    const f = stubFetch({
      '/api/unique-skill': () => json({ error: { code: 'UPSTREAM_ERROR', message: 'soul reading failed' } }, 502),
    });
    await chooseRaceAndName();
    await playFourTurns();
    fireEvent.click(await screen.findByRole('button', { name: /Let it take hold/ }));

    expect(await screen.findByText(/An error stirred in the aether\.\.\./)).toBeInTheDocument();
    expect(screen.getByText(/soul reading failed/)).toBeInTheDocument();
    expect(f.count('/api/unique-skill')).toBe(1);

    // Dead end: no prologue screen, no control to retry or return, and nothing
    // more is requested while the player sits there.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/The Threshold/)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(f.count('/api/unique-skill')).toBe(1);
    expect(f.count('/api/prologue/beat')).toBe(4);
    expect(f.count('/api/prologue/profile')).toBe(1);
    expect(f.count('/api/intro-scene')).toBe(0);
  });
});

describe('App with the flag off', () => {
  it('shows the questionnaire and never requests /api/prologue/', async () => {
    window.history.pushState({}, '', '/');
    const f = stubFetch();
    await chooseRaceAndName();

    expect(await screen.findByPlaceholderText('Write freely...')).toBeInTheDocument();
    expect(screen.queryByText(/The Threshold/)).not.toBeInTheDocument();
    expect(f.calls.filter((c) => /\/api\/prologue\//.test(c.url))).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});
