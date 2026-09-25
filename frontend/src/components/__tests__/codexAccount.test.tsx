import type { GameState, Skill } from '@soulbound/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SoulCodexContents from '../SoulCodexContents';
import { HostedAccountContext } from '../hostedAccount';

/**
 * The Soul Codex's hosted Account section (Phase 6 review cycle 1, Q2).
 *
 * `modeGate.test.tsx` covers `<HostedAccountSlot/>` on its own; this pins that
 * `SoulCodexContents` actually renders it. Without this, dropping the slot
 * from the Codex is caught only by e2e, which CI doesn't run. The fixture
 * mirrors `components.test.tsx`'s `baseGameState` (that file is pre-phase
 * and frozen, so it isn't imported from or edited).
 */

afterEach(cleanup);

const UNIQUE_SKILL: Skill = {
  name: 'Memory of Roots',
  tier: 'Unique',
  mastery: 30,
  description: 'Recalls what the soil has forgotten.',
  sub_abilities: [],
  usage_notes: [],
  soul_resonance: 'The world remembers you back.',
};

const GAME_STATE: GameState = {
  character: {
    name: 'Kaelith',
    race: { id: 'vaelwyn', name: 'Vaelwyn', desc: 'x', intrinsic: [{ name: 'a', description: 'a' }, { name: 'b', description: 'b' }] },
    uniqueSkill: {
      skill_name: 'Memory of Roots',
      tier: 'Unique',
      description: 'Recalls what the soil has forgotten.',
      soul_resonance: 'The world remembers you back.',
      etching_text: 'The soul etches itself into the roots below.',
    },
    answers: {},
  },
  skills: [UNIQUE_SKILL],
  location: 'The Hollow Verge',
  currentScene: 'The world begins.',
  actionHistory: [],
  narrativeMemory: { entities: {}, notes: [] },
};

function codex() {
  return (
    <SoulCodexContents
      gameState={GAME_STATE}
      uniqueSkill={UNIQUE_SKILL}
      newSkillIds={new Set()}
      savingStatus=""
      handleManualSave={() => {}}
      setPhase={() => {}}
    />
  );
}

describe('SoulCodexContents: hosted Account slot', () => {
  it('shows the Account section inside HostedAccountContext', () => {
    render(
      <HostedAccountContext.Provider value={{ onSignedOut: vi.fn() }}>{codex()}</HostedAccountContext.Provider>,
    );
    expect(screen.getByRole('region', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument();
  });

  it('shows no Account section without the provider (self-host)', () => {
    render(codex());
    expect(screen.getByText('Kaelith')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
});
