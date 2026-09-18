/**
 * The one test in Phase 3 that exercises the WIRING rather than a module.
 *
 * `game/applyWorldUpdate.ts` is pure and mutation-tested to eleven mutants. It
 * can be completely correct while `App.tsx` is wrong, because the turn's real
 * risk is not the rules — it is the closure around them:
 *
 *   - `handleAction` reads `gameState` and `currentSlotId` from closure.
 *   - `autoSave` is called from INSIDE a `setLog` updater (legacy 1022-1027),
 *     which is the only place the post-turn log exists.
 *
 * A stale-closure or dropped-autosave regression there is invisible to every
 * other test in this phase: the pure function still returns the right answer,
 * the components still render what they are handed, and the suite stays green
 * over a game that silently stops saving. Phase 2's retro records the parent
 * shape of this failure — "the build shipped a suite that could not detect its
 * own routes being unregistered."
 *
 * So these tests drive the real `<App />`: seed a save, load it (which is what
 * sets `currentSlotId`, without which `autoSave` early-returns), submit an
 * action against a mocked `fetch`, and then read `localStorage` back — the
 * same bytes a returning player would.
 *
 * `fetch` is mocked for every test here. Nothing in this file can reach a real
 * network, and no paid model call is made.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  MAX_LOG_SAVED,
  SAVE_INDEX_KEY,
  SAVE_PREFIX,
  WorldVoiceResponseSchema,
  type GameState,
  type LogEntry,
  type SaveSlot,
  type WorldVoiceResponse,
} from '@soulbound/shared';

import App from '../App';

const SLOT_ID = 'sbc_integration_1';

function makeGameState(): GameState {
  return {
    character: {
      name: 'Ryn',
      race: {
        id: 'drakari',
        name: 'Drakari',
        desc: 'Descendants of dragons.',
        intrinsic: [
          { name: 'Scale Armor', description: 'Hide that turns aside blows.' },
          { name: 'Breath Weapon', description: 'An elemental breath.' },
        ],
      },
      uniqueSkill: {
        skill_name: 'Ashen Covenant',
        tier: 'Unique',
        description: 'A pact written in cinders.',
        soul_resonance: 'Endurance through burning.',
        etching_text: 'The soul remembers fire.',
      },
      answers: {},
    },
    skills: [
      { name: 'Scale Armor', tier: 'Intrinsic', mastery: 6, description: 'Hide that turns aside blows.' },
      { name: 'Breath Weapon', tier: 'Intrinsic', mastery: 4, description: 'An elemental breath.' },
      {
        name: 'Ashen Covenant',
        tier: 'Unique',
        mastery: 20,
        description: 'A pact written in cinders.',
        sub_abilities: [],
        usage_notes: [],
        soul_resonance: 'Endurance through burning.',
      },
    ],
    location: 'The Ashen Verge',
    currentScene: 'Smoke drifts over the ridge.',
    actionHistory: ['look around'],
    narrativeMemory: { entities: {}, notes: [] },
  };
}

/**
 * A turn that raises mastery, grants a skill, and sets no scene.
 *
 * Parsed through the shared schema rather than cast with `as`, for the reason
 * this file exists. The first draft used `as WorldVoiceResponse` and omitted
 * the required `soul_etching_text` on the granted skill; the client's Zod guard
 * correctly rejected it, `handleAction` took its catch branch, and the run
 * became a test of the error path wearing a happy-path test's assertions. A cast
 * silences exactly the check that would have said so. `.parse` here means a
 * change to the World Voice contract breaks this fixture loudly instead.
 */
function makeTurnResponse(): WorldVoiceResponse {
  return WorldVoiceResponseSchema.parse({
    narration: 'The ember takes hold, and something new wakes in you.',
    state_updates: {
      skill_mastery_changes: [
        { skill_name: 'Ashen Covenant', tier: 'Unique', old_mastery: 20, new_mastery: 27, note: 'pressed further' },
      ],
      new_skills_granted: [
        {
          skill_name: 'Emberwalk',
          tier: 'Common',
          mastery: 5,
          description: 'Step where fire has been.',
          soul_etching_text: 'Ash holds the shape of a step.',
        },
      ],
      skill_evolutions: [],
      unique_sub_ability_unlocked: null,
      world_events: [],
    },
    narrative_memory_updates: { new_entities: [], note: 'The ridge remembers.' },
    gm_note: null,
  });
}

function seedSave(log: LogEntry[]) {
  const slot: SaveSlot = {
    gameState: makeGameState(),
    log,
    savedAt: Date.now(),
    schemaVersion: 1,
  };
  localStorage.setItem(
    SAVE_INDEX_KEY,
    JSON.stringify([
      {
        id: SLOT_ID,
        name: 'Ryn',
        race: 'Drakari',
        location: 'The Ashen Verge',
        skillCount: 3,
        savedAt: slot.savedAt,
        uniqueSkill: 'Ashen Covenant',
      },
    ]),
  );
  localStorage.setItem(SAVE_PREFIX + SLOT_ID, JSON.stringify(slot));
}

function readPersisted(): SaveSlot {
  const raw = localStorage.getItem(SAVE_PREFIX + SLOT_ID);
  if (!raw) throw new Error('nothing persisted at ' + SAVE_PREFIX + SLOT_ID);
  return JSON.parse(raw) as SaveSlot;
}

function mockFetchOnce(response: WorldVoiceResponse) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

/**
 * Seed → load → simulation. The Load click is what sets `currentSlotId`;
 * without it `autoSave` early-returns on `if (!slotId)` and every assertion
 * below would pass vacuously against a save nobody wrote.
 */
async function loadIntoSimulation() {
  render(<App />);
  fireEvent.click(await screen.findByText(/Ryn/));
  await screen.findByText(/Soul Codex/);
}

function submitAction(action: string) {
  const box = screen.getByPlaceholderText('What do you do?');
  fireEvent.change(box, { target: { value: action } });
  fireEvent.click(screen.getByRole('button', { name: /act/i }));
}

/**
 * Submits without going through the Act button's `disabled` attribute — used to
 * prove `handleAction`'s own `isThinking` guard refuses the call, which is a
 * different claim from "the button is disabled".
 */
function submitActionIgnoringDisabled(action: string) {
  const box = screen.getByPlaceholderText('What do you do?');
  fireEvent.change(box, { target: { value: action } });
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('App — a full turn, end to end', () => {
  it('carries the turn into state, the log, and the save on disk', async () => {
    seedSave([{ type: 'narration', text: 'You arrive at the verge.' }]);
    mockFetchOnce(makeTurnResponse());

    await loadIntoSimulation();
    submitAction('press into the embers');

    // (1) the mastery change reached the rendered skill state
    await waitFor(() => expect(screen.getByText('27/100')).toBeInTheDocument());

    // (2) log entries appended, in order: seeded, the action, then the narration
    await waitFor(() =>
      expect(screen.getByText(/The ember takes hold/)).toBeInTheDocument(),
    );
    const persisted = await waitFor(() => {
      const p = readPersisted();
      expect(p.log.at(-1)?.type).toBe('narration');
      return p;
    });
    expect(persisted.log.map((e) => e.type)).toEqual(['narration', 'action', 'narration']);
    expect(persisted.log[1].text).toBe('press into the embers');

    // (3) localStorage was written at all — the autosave fired
    expect(persisted.savedAt).toEqual(expect.any(Number));

    // (4) the save holds the POST-turn state, not the pre-turn state.
    //     Both halves matter: `gameState` proves autoSave got `newState`, and
    //     the narration entry proves it ran INSIDE the setLog updater, where
    //     the post-turn log is the only log that exists.
    const unique = persisted.gameState.skills.find((s) => s.tier === 'Unique');
    expect(unique?.mastery).toBe(27);
    expect(persisted.gameState.skills.map((s) => s.name)).toContain('Emberwalk');
    expect(persisted.gameState.actionHistory).toEqual(['look around', 'press into the embers']);
    expect(persisted.gameState.narrativeMemory.notes).toEqual(['The ridge remembers.']);
    expect(persisted.log.at(-1)?.text).toMatch(/The ember takes hold/);

    // (5) the granted skill renders with the isNew treatment — which only
    //     happens if the Set<string> survived applyWorldUpdate → App state →
    //     SoulCodexContents → SkillCard's `newSkillIds.has(name)`. An array
    //     reaching that state has no `.has` and the glow silently dies.
    //     Scoped to the Codex's "All Skills" list: the granted skill's name
    //     also appears in WorldLog's new-skill announcement, and an unscoped
    //     query matches both.
    const allSkills = within(screen.getByText('All Skills').parentElement!);
    //     `closest('div[style]')?.parentElement` is SkillCard's card root: the
    //     name is a <span> inside the flex header row, so `closest('div')` alone
    //     stops one level short. Same idiom as components.test.tsx.
    const cardRoot = (name: string) =>
      allSkills.getByText(name).closest('div[style]')?.parentElement;
    expect(cardRoot('Emberwalk')).toHaveStyle({ animation: 'etchIn 0.8s ease-out' });
    // The pre-existing skill is NOT treated as new — proves the assertion
    // above is reading isNew and not something every card has.
    expect(cardRoot('Scale Armor')).toHaveStyle({ animation: 'none' });
  });
});

describe('App — the error path of a live turn', () => {
  /**
   * Added in phase review. An independent mutation sweep replaced this catch
   * body with `void e;` — deleting the player-visible "The World Voice fell
   * silent" entry entirely — and the whole suite stayed green with tsc clean.
   * R12 exists to make failures diagnosable; the one path that renders that
   * diagnosis to the player had no coverage at any layer.
   */
  it('renders an error entry, clears isThinking, and does NOT autosave', async () => {
    seedSave([{ type: 'narration', text: 'You arrive at the verge.' }]);
    const before = readPersisted();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await loadIntoSimulation();
    submitAction('press into the embers');

    // The catch branch's user-facing string, with the real cause appended —
    // never `undefined`, and never a raw error object.
    const entry = await screen.findByText(/The World Voice fell silent\./);
    expect(entry.textContent).toMatch(/Failed to fetch/);
    expect(entry.textContent).not.toMatch(/undefined/);

    // isThinking resets, so the player can act again rather than being wedged.
    // Type first: handleAction also clears `input`, and ActionBar disables on
    // `isThinking || !input.trim()` — asserting on the bare button would pass
    // for the wrong reason (empty box), not because isThinking went false.
    fireEvent.change(screen.getByPlaceholderText('What do you do?'), {
      target: { value: 'try again' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /act/i })).not.toBeDisabled(),
    );

    // No partial write: a failed turn must not overwrite the save with a
    // half-applied state. autoSave lives inside the setLog updater of the TRY
    // branch only, so the catch branch reaches no save at all.
    const after = readPersisted();
    expect(after.log).toEqual(before.log);
    expect(after.gameState).toEqual(before.gameState);
  });

  it('a non-2xx backend response takes the same path', async () => {
    seedSave([{ type: 'narration', text: 'You arrive at the verge.' }]);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'the aether is quiet' } }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await loadIntoSimulation();
    submitAction('press into the embers');

    const entry = await screen.findByText(/The World Voice fell silent\./);
    // api.ts surfaces the backend's structured envelope rather than a parse error.
    expect(entry.textContent).toMatch(/UPSTREAM_ERROR/);
    expect(entry.textContent).toMatch(/502/);
  });
});

describe('App — the two newSkillIds clear timeouts', () => {
  /**
   * 2500ms after an action (legacy 1012), 2000ms after the questionnaire
   * (legacy 905). Three separate docstrings say "do not unify them", yet no
   * test observed either duration — a review sweep widened 2500 to 9999 and the
   * whole suite stayed green.
   *
   * This spies on the scheduled delay rather than driving fake timers. Fake
   * timers fight `waitFor` and the pending fetch promise, and `shouldAdvanceTime`
   * would auto-advance past a 2500ms boundary non-deterministically. The
   * constant is what is load-bearing, so the constant is what is asserted.
   */
  it('schedules the action-path glow clear at exactly 2500ms', async () => {
    seedSave([{ type: 'narration', text: 'You arrive at the verge.' }]);
    mockFetchOnce(makeTurnResponse());
    const spy = vi.spyOn(globalThis, 'setTimeout');

    await loadIntoSimulation();
    submitAction('press into the embers');
    await waitFor(() => expect(screen.getByText('27/100')).toBeInTheDocument());

    const delays = spy.mock.calls.map((c) => c[1]);
    // The action path schedules 2500. Widening or shortening it fails here.
    expect(delays).toContain(2500);
    // And it is NOT the questionnaire path's 2000 — unifying the two on either
    // value fails one of these two assertions. (autoSave's own savingStatus
    // reset is also 2000ms, so 2000 does legitimately appear; what must not
    // happen is the glow clear moving onto it, which the 2500 assertion pins.)
    expect(delays.filter((d) => d === 2500)).toHaveLength(1);
  });
});

describe('App — guards on the turn itself', () => {
  /**
   * Also from the review sweep: removing `isThinking` from handleAction's
   * early-return left the suite green. components.test.tsx asserts the Act
   * button carries `disabled`, which is a presentational prop — it does not
   * prove the handler itself refuses a second call.
   */
  it('a second submit while a turn is in flight is ignored', async () => {
    seedSave([{ type: 'narration', text: 'You arrive at the verge.' }]);
    let release!: (v: Response) => void;
    const pending = new Promise<Response>((res) => { release = res; });
    const f = vi.fn(async () => pending);
    vi.stubGlobal('fetch', f);

    await loadIntoSimulation();
    submitAction('press into the embers');
    // The turn is now in flight. Call the handler again directly, bypassing the
    // button's `disabled` attribute — that attribute is not the guard under test.
    submitActionIgnoringDisabled('press again');

    expect(f).toHaveBeenCalledTimes(1);

    release(new Response(JSON.stringify(makeTurnResponse()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await waitFor(() => expect(screen.getByText('27/100')).toBeInTheDocument());
    const persisted = readPersisted();
    expect(persisted.log.filter((e) => e.type === 'action')).toHaveLength(1);
  });
});

describe('App — the 80-entry log cap', () => {
  it('persists exactly MAX_LOG_SAVED entries, newest last', async () => {
    // 84 seeded + this turn's action + its narration = 86 driven through.
    const seeded: LogEntry[] = Array.from({ length: 84 }, (_, i) => ({
      type: 'narration' as const,
      text: `Seeded ${i + 1}`,
    }));
    seedSave(seeded);
    mockFetchOnce(makeTurnResponse());

    await loadIntoSimulation();
    submitAction('press into the embers');

    const persisted = await waitFor(() => {
      const p = readPersisted();
      expect(p.log.at(-1)?.type).toBe('narration');
      expect(p.log.at(-1)?.text).toMatch(/The ember takes hold/);
      return p;
    });

    // The cap lives in App.tsx's autoSave (legacy 820) and ONLY there —
    // lib/saves.ts#writeSave deliberately does not slice.
    expect(MAX_LOG_SAVED).toBe(80);
    expect(persisted.log).toHaveLength(80);

    // Newest last, oldest dropped. slice(0, 80) instead of slice(-80) keeps
    // the OLDEST 80 and fails all three of these.
    expect(persisted.log.at(-1)?.text).toMatch(/The ember takes hold/);
    expect(persisted.log.at(-2)?.text).toBe('press into the embers');
    expect(persisted.log[0].text).toBe('Seeded 7');
    expect(persisted.log.map((e) => e.text)).not.toContain('Seeded 6');
  });
});
