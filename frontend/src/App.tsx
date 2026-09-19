/**
 * The state graph and handlers of the legacy `App()` component
 * (souldbound-world.jsx 786-1044), ported statement-for-statement.
 *
 * ── Why this file is a near-verbatim port and not a tidy-up ──
 *
 * 03-CONTEXT.md records that the "Pragmatic" architecture was chosen over a
 * "Clean" proposal that introduced a `useGameSession` hook. The state graph is
 * the most behaviour-load-bearing and least-tested part of this migration, and
 * rewriting it while calling it a move is how behaviour tuned by feel
 * disappears without a diff to point at. So: all 16 `useState` (legacy
 * 787-802) and the one `useRef` (803) stay as they are, both `useEffect`
 * (806-812) stay, and the handlers keep their original shapes.
 *
 * Counts DERIVED from the legacy source rather than restated from the plan
 * (the plan's prose said "17 useState (787-804)", which is wrong — it is 16
 * `useState` plus one `useRef`, and a faithful port that trusted the prose
 * would have had to invent a 17th piece of state to pass its own gate):
 *
 *   legacy 787-802  → 16 useState   ← this file: 16
 *   legacy 803      →  1 useRef     ← this file: 1
 *
 * ── Things here that look like bugs and are not. Do not "fix". ──
 *
 *  1. `autoSave` runs INSIDE a `setLog` updater (legacy 1022-1027), reading
 *     `newState` and `currentSlotId` from closure. It reads as a misplaced
 *     side effect. It is how the save gets the post-turn log in the same tick
 *     the log is produced; hoisting it out saves the PRE-turn log.
 *
 *  2. The 80-entry log cap lives in `autoSave` (legacy 820) and ONLY there.
 *     `lib/saves.ts#writeSave` deliberately does not slice — plan 03-02
 *     confirmed it has zero slices. Capping in both places would double-slice.
 *
 *  3. The two `setNewSkillIds(new Set())` timeouts differ on purpose:
 *     2000 ms after the questionnaire (legacy 905), 2500 ms after an action
 *     (legacy 1012). They are not a copy-paste slip; do not unify them.
 *
 *  4. `setNewSkillIds` receives only newly-GRANTED names (legacy 1011), never
 *     evolved ones. `applyWorldUpdate` returns exactly that set.
 *
 *  5. `newSkillIds` is a `Set<string>`, consumed by `SkillCard` via `.has()`.
 *     Typed explicitly: a `string[]` reaching an untyped `Set` state fails at
 *     runtime, not compile time, and the only symptom is the new-skill glow
 *     silently never appearing again.
 *
 *  6. The `Math.random()` intrinsic roll (legacy 877) lives here, in the
 *     questionnaire flow. `game/applyWorldUpdate.ts` deliberately excludes it —
 *     a pure function that calls `Math.random()` is not one.
 *
 * ── Deviations from a literal port, all of them type-level ──
 *
 *  a. `phase` is a `Phase` union, where legacy has a bare string. No runtime
 *     difference; it makes a typo in the render dispatch a compile error rather
 *     than a silently blank screen. `Phase` is exported and `SimulationScreen`
 *     and `SoulCodexContents` now take `(phase: Phase) => void`, so the seam is
 *     checked end to end. It briefly went through an `as Phase` cast, which
 *     review correctly flagged as leaving the typo hole open one level down.
 *
 *  b. Two early-return guards have no legacy analogue and are inert at runtime:
 *     `|| !gameState` in `handleAction` (legacy 916 has no such check) and
 *     `if (!selectedRace) return;` in `handleQuestionnaireComplete` (legacy
 *     866). Both are forced by `strict: true` — `callWorldEngine` requires a
 *     non-null `GameState` and `Character.race` a non-null `Race`, which
 *     untyped JS never had to satisfy. Neither is reachable: `ActionBar` only
 *     mounts once `gameState` is set, and `RaceScreen`'s own button guard
 *     blocks reaching the questionnaire without a race. Listed here because a
 *     file claiming a statement-for-statement port owes a list of every place
 *     it is not one.
 *
 *  c. `errMessage()` wraps what legacy writes as a bare `e.message`, because a
 *     caught value is `unknown` under TS. The rendered string is identical.
 */

import { useEffect, useRef, useState } from 'react';
import {
  MAX_LOG_SAVED,
  type Character,
  type GameState,
  type LogEntry,
  type QuestionnaireAnswers,
  type Race,
  type SaveIndexEntry,
  type SaveSlot,
  type Skill,
} from '@soulbound/shared';

import { callWorldEngine, determineUniqueSkill, generateIntroScene } from './lib/api';
import { deleteSave, listSaves, loadSave, newSlotId, writeSave } from './lib/saves';
import { applyWorldUpdate } from './game/applyWorldUpdate';
import { mergeNarrativeMemory } from './game/narrativeMemory';

import TitleScreen from './screens/TitleScreen';
import RaceScreen from './screens/RaceScreen';
import QuestionnaireScreen from './screens/QuestionnaireScreen';
import LoadingScreen from './screens/LoadingScreen';
import SimulationScreen from './screens/SimulationScreen';

export type Phase = 'title' | 'race' | 'questionnaire' | 'loading' | 'simulation' | 'saves';

/**
 * Legacy is untyped JS and writes `e.message` directly. Under TS a caught value
 * is `unknown`, so the narrowing has to be explicit. The rendered string is
 * unchanged.
 */
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function App() {
  // ── State: 16 useState (legacy 787-802) ──────────────────────────────────
  const [phase, setPhase] = useState<Phase>('title'); // title | race | questionnaire | loading | simulation | saves
  const [selectedRace, setSelectedRace] = useState<Race | null>(null);
  const [charName, setCharName] = useState('');
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({});
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [newSkillIds, setNewSkillIds] = useState<Set<string>>(new Set()); // note 5
  const [saveIndex, setSaveIndex] = useState<SaveIndexEntry[]>([]);
  const [currentSlotId, setCurrentSlotId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<'' | 'saving' | 'saved'>(''); // "", "saving", "saved"
  const [mobileTab, setMobileTab] = useState<'World' | 'Codex'>('World'); // "World" | "Codex"
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ── 1 useRef (legacy 803) ────────────────────────────────────────────────
  const logEndRef = useRef<HTMLDivElement>(null);

  // Load save index on mount (legacy 806-810)
  useEffect(() => {
    const idx = listSaves();
    setSaveIndex(idx);
    setPhase('title');
  }, []);

  // legacy 812 — jsdom has no scrollIntoView; the test harness stubs it.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // ── AUTO-SAVE (legacy 815-827) ───────────────────────────────────────────
  function autoSave(state: GameState | null, logEntries: LogEntry[], slotId: string | null) {
    if (!slotId || !state) return;
    setSavingStatus('saving');
    const saveData: SaveSlot = {
      gameState: state,
      // Note 2: the 80-entry cap lives here and nowhere else.
      log: logEntries.slice(-MAX_LOG_SAVED),
      savedAt: Date.now(),
    };
    writeSave(slotId, saveData);
    setSaveIndex(listSaves());
    setSavingStatus('saved');
    setTimeout(() => setSavingStatus(''), 2000);
  }

  // ── MANUAL SAVE TO NEW SLOT (legacy 830-835) ─────────────────────────────
  function handleManualSave() {
    if (!gameState) return;
    const newId = newSlotId();
    setCurrentSlotId(newId);
    autoSave(gameState, log, newId);
  }

  // ── LOAD SAVE (legacy 838-856) ───────────────────────────────────────────
  function handleLoadSave(slotId: string) {
    setPhase('loading');
    setLoadingMsg('Restoring your soul from the aether...');
    try {
      const data = loadSave(slotId);
      if (!data) throw new Error('Save not found.');
      // Backward compat: saves created before narrative memory existed won't have this field.
      const restoredState: GameState = {
        ...data.gameState,
        narrativeMemory: data.gameState.narrativeMemory || { entities: {}, notes: [] },
      };
      setGameState(restoredState);
      setLog(data.log || []);
      setCurrentSlotId(slotId);
      setPhase('simulation');
    } catch (e) {
      setLoadingMsg('Failed to load: ' + errMessage(e));
    }
  }

  // ── DELETE SAVE (legacy 859-863) ─────────────────────────────────────────
  function handleDeleteSave(slotId: string) {
    deleteSave(slotId);
    setSaveIndex(listSaves());
    setConfirmDeleteId(null);
  }

  // ── QUESTIONNAIRE SUBMIT (legacy 866-910) ────────────────────────────────
  async function handleQuestionnaireComplete(finalAnswers: QuestionnaireAnswers) {
    setPhase('loading');
    setLoadingMsg('The World Voice reads your soul...');
    // Guarded by RaceScreen, which cannot continue without a race selected.
    if (!selectedRace) return;
    const charData = { name: charName, race: selectedRace, answers: finalAnswers };

    try {
      setLoadingMsg('Your Unique Skill crystallizes...');
      const uniqueSkill = await determineUniqueSkill(charData);

      const skills: Skill[] = [
        // Note 6: the intrinsic roll is 3-8, and it lives here.
        ...selectedRace.intrinsic.map((s) => ({
          name: s.name,
          tier: 'Intrinsic' as const,
          mastery: 3 + Math.floor(Math.random() * 6), // 3-8
          description: s.description,
        })),
        {
          name: uniqueSkill.skill_name,
          tier: 'Unique' as const,
          mastery: 0,
          description: uniqueSkill.description,
          sub_abilities: [],
          usage_notes: [],
          soul_resonance: uniqueSkill.soul_resonance,
        },
      ];

      const character: Character = {
        name: charName,
        race: selectedRace,
        uniqueSkill,
        answers: finalAnswers,
      };

      setLoadingMsg('The world shapes your opening scene...');
      const intro = await generateIntroScene(character);

      const sceneEvent = intro.state_updates?.world_events?.find((e) => e.type === 'scene_set');

      const initialState: GameState = {
        character,
        skills,
        location: sceneEvent?.location || 'The Crossroads of Vaeltharion',
        currentScene: sceneEvent?.scene_summary || 'The world begins.',
        actionHistory: [],
        // Seed the ledger from the intro scene instead of starting it empty.
        // /api/intro-scene returns a full WorldVoiceResponse, and the model is
        // instructed to record any named NPC/place/faction it introduces — so
        // an empty ledger here silently discarded the opening scene's cast.
        // renderWorldEnginePrompt states the ledger as fact ("KNOWN ENTITIES:
        // (none yet)"), so turn 1 was being told the NPC it had just been
        // shown did not exist. See game/narrativeMemory.ts.
        narrativeMemory: mergeNarrativeMemory(undefined, intro.narrative_memory_updates),
      };

      const newId = newSlotId();
      setCurrentSlotId(newId);
      setGameState(initialState);
      const firstLog: LogEntry[] = [
        { type: 'narration', text: intro.narration, etchingSkill: uniqueSkill },
      ];
      setLog(firstLog);
      setNewSkillIds(new Set(skills.map((s) => s.name)));
      // Note 3: 2000 ms here, 2500 ms in handleAction. Different on purpose.
      setTimeout(() => setNewSkillIds(new Set()), 2000);
      // save immediately on world entry
      autoSave(initialState, firstLog, newId);
      setPhase('simulation');
    } catch (e) {
      setLoadingMsg('An error stirred in the aether... ' + errMessage(e));
    }
  }

  // ── PLAYER ACTION (legacy 913-1031) ──────────────────────────────────────
  async function handleAction() {
    if (!input.trim() || isThinking || !gameState) return;
    const action = input.trim();
    setInput('');
    setIsThinking(true);
    setMobileTab('World');
    setLog((l) => [...l, { type: 'action', text: action }]);

    try {
      const result = await callWorldEngine(action, gameState);
      // legacy 925-1021, extracted so R10's balance rules are testable.
      const { state: newState, logEntry, newSkillIds: newNames } = applyWorldUpdate(
        gameState,
        action,
        result,
      );

      setGameState(newState);
      setNewSkillIds(newNames); // note 4: granted only, never evolved
      // Note 3: 2500 ms here, 2000 ms after the questionnaire.
      setTimeout(() => setNewSkillIds(new Set()), 2500);

      setLog((l) => {
        const updated = [...l, logEntry];
        // Note 1: auto-save with latest state and log, from inside the updater.
        // This is the only place the post-turn log exists.
        autoSave(newState, updated, currentSlotId);
        return updated;
      });
    } catch (e) {
      setLog((l) => [...l, { type: 'error', text: 'The World Voice fell silent. ' + errMessage(e) }]);
    }
    setIsThinking(false);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER PHASES (legacy 1036-1440)
  // ══════════════════════════════════════════════════════════════════════════

  if (phase === 'title') {
    return (
      <TitleScreen
        saveIndex={saveIndex}
        confirmDeleteId={confirmDeleteId}
        setConfirmDeleteId={setConfirmDeleteId}
        onLoadSave={handleLoadSave}
        onDeleteSave={handleDeleteSave}
        onNewGame={() => setPhase('race')}
      />
    );
  }

  if (phase === 'race') {
    return (
      <RaceScreen
        charName={charName}
        setCharName={setCharName}
        selectedRace={selectedRace}
        setSelectedRace={setSelectedRace}
        onContinue={() => setPhase('questionnaire')}
      />
    );
  }

  if (phase === 'questionnaire') {
    return (
      <QuestionnaireScreen
        qIndex={qIndex}
        setQIndex={setQIndex}
        answers={answers}
        setAnswers={setAnswers}
        onComplete={handleQuestionnaireComplete}
      />
    );
  }

  if (phase === 'loading') {
    return <LoadingScreen loadingMsg={loadingMsg} />;
  }

  if (phase === 'simulation' && gameState) {
    return (
      <SimulationScreen
        gameState={gameState}
        log={log}
        isThinking={isThinking}
        logEndRef={logEndRef}
        newSkillIds={newSkillIds}
        savingStatus={savingStatus}
        handleManualSave={handleManualSave}
        setPhase={setPhase}
        mobileTab={mobileTab}
        setMobileTab={setMobileTab}
        input={input}
        setInput={setInput}
        handleAction={handleAction}
      />
    );
  }

  // legacy 1440
  return null;
}
