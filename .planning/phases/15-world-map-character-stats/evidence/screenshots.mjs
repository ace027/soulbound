// Plan 15-03 visual check: seeds a v2 save (8 places across 4 kingdoms plus
// 2 uncharted), loads it from the title screen, and screenshots the desktop
// (1280x800) and mobile (375x812) layouts. No backend and no model calls.
//
// Usage (from frontend/, with a dev server running):
//   npx vite --port 5175 --strictPort &
//   node ../.planning/phases/15-world-map-character-stats/evidence/screenshots.mjs [baseUrl]
import { chromium } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const EXE = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const places = {
  'iron-yard-kaldrath': { name: 'Iron Yard', kingdom: 'Kaldrath', firstSeenTurn: 1 },
  'toll-bridge-of-the-unbroken-march-kaldrath': { name: 'Toll Bridge of the Unbroken March', kingdom: 'Kaldrath', firstSeenTurn: 3 },
  'saltmarket-tidemark': { name: 'Saltmarket', kingdom: 'Tidemark', firstSeenTurn: 4 },
  'the-ledger-docks-tidemark': { name: 'The Ledger Docks', kingdom: 'Tidemark', firstSeenTurn: 5 },
  'harbourmaster-s-stair-tidemark': { name: "Harbourmaster's Stair", kingdom: 'Tidemark', firstSeenTurn: 9 },
  'mossden-verdance': { name: 'Mossden', kingdom: 'Verdance', firstSeenTurn: 6 },
  'the-thorn-orchard-verdance': { name: 'The Thorn Orchard', kingdom: 'Verdance', firstSeenTurn: 7 },
  'lantern-archive-aurelis': { name: 'Lantern Archive', kingdom: 'Aurelis', firstSeenTurn: 8 },
  'rotting-cloister-unknown': { name: 'The Rotting Cloister', kingdom: 'unknown', firstSeenTurn: 0 },
  'the-drowned-stair-unknown': { name: 'The Drowned Stair', kingdom: 'unknown', firstSeenTurn: 2 },
};

const gameState = {
  character: {
    name: 'Verrin Ashgrave',
    race: {
      id: 'mycelium', name: 'Mycelium', desc: 'A colony that learned to want.',
      intrinsic: [
        { name: 'Spore Sense', description: 'Reads the air for kin.' },
        { name: 'Rootbound', description: 'Draws on what it stands in.' },
      ],
    },
    uniqueSkill: {
      skill_name: 'The Patient Ledger', tier: 'Unique', description: 'Remembers every debt owed to it.',
      soul_resonance: 'Patience sharpened into accounting.', etching_text: 'The world writes a name it did not choose.',
    },
    answers: { nature: 'patient', drive: 'debt', flaw: 'slow', memory: 'a ledger', bond: 'none' },
  },
  skills: [
    { name: 'Spore Sense', tier: 'Intrinsic', mastery: 6, description: 'Reads the air for kin.' },
    { name: 'Rootbound', tier: 'Intrinsic', mastery: 4, description: 'Draws on what it stands in.' },
    {
      name: 'The Patient Ledger', tier: 'Unique', mastery: 22, description: 'Remembers every debt owed to it.',
      soul_resonance: 'Patience sharpened into accounting.', sub_abilities: [], usage_notes: [],
    },
  ],
  location: 'Saltmarket, Tidemark',
  currentScene: 'Gulls argue over the fish stalls.',
  actionHistory: ['bartered for salt'],
  narrativeMemory: { entities: {}, notes: [] },
  condition: { hp: 64, mp: 18, sp: 71, max_hp: 110, max_mp: 60, max_sp: 90 },
  attributes: { STR: 9, AGI: 11, INT: 13, WIL: 14 },
  places,
  currentPlaceId: 'saltmarket-tidemark',
  growthLog: [],
};

const log = Array.from({ length: 8 }, (_, i) => ({
  type: 'narration',
  text: `Turn ${i + 1}. Salt crusts the planks of the market, and somewhere a bell counts debts no one admits to owing. The colony that is you notes every one.`,
}));

const slot = { gameState, log, savedAt: 1_760_000_000_000, schemaVersion: 2 };
const ID = 'sbc_e2e_map';

async function open(browser, viewport) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(({ id, slot }) => {
    localStorage.setItem('sbc-save:' + id, JSON.stringify(slot));
    localStorage.setItem('sbc-save-index', JSON.stringify([{
      id, name: slot.gameState.character.name, race: slot.gameState.character.race.name,
      location: slot.gameState.location, skillCount: slot.gameState.skills.length,
      savedAt: slot.savedAt, uniqueSkill: 'The Patient Ledger',
    }]));
  }, { id: ID, slot });
  await page.goto(BASE);
  await page.locator('.save-card', { hasText: 'Verrin Ashgrave' }).getByRole('button', { name: 'Continue' }).click();
  await page.locator('textarea[placeholder="What do you do?"]').waitFor();
  await page.waitForTimeout(1200); // let meter width transitions settle
  return page;
}

const browser = await chromium.launch({ executablePath: EXE });
try {
  const d = await open(browser, { width: 1280, height: 800 });
  await d.screenshot({ path: `${OUT}/15-03-desktop-codex.png` });
  await d.getByRole('button', { name: 'Map' }).click();
  await d.getByRole('dialog').waitFor();
  await d.screenshot({ path: `${OUT}/15-03-desktop-map-overlay.png` });

  const m = await open(browser, { width: 375, height: 812 });
  await m.screenshot({ path: `${OUT}/15-03-mobile-world.png` });
  await m.getByText('◈ Map').click();
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${OUT}/15-03-mobile-map.png` });
  await m.getByText('☽ Codex').click();
  await m.waitForTimeout(1200);
  await m.screenshot({ path: `${OUT}/15-03-mobile-codex.png` });
  console.log('screenshots written to', OUT);
} finally {
  await browser.close();
}
