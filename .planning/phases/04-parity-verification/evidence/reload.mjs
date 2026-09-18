import pw from '/home/user/soulbound/node_modules/playwright-core/index.js';
const { chromium } = pw;

const SHOTS = '/tmp/claude-0/-home-user-soulbound/80e3c6e7-1347-5a1e-86e2-0e252d7ce16d/scratchpad/shots';
const BASE = 'http://127.0.0.1:5173';
const PREFIX = 'sbc-save:', INDEX = 'sbc-save-index', SLOT = 'sbc_r14_reload';
const TEXTAREA = 'textarea[placeholder="What do you do?"]';

const slot = {
  gameState: {
    character: {
      name: 'Yulen Marr', 
      race: { id: 'shadeveil', name: 'Shadeveil', desc: 'Born of the second dusk.',
        intrinsic: [{ name: 'Umbral Slip', description: 'Dissolve briefly into shadow.' },
                    { name: 'Dark Sense', description: 'See in total darkness.' }] },
      uniqueSkill: { skill_name: 'Kept Verdict', tier: 'Unique',
        description: 'Perceives the true shape of a thing by observing it in stillness.',
        soul_resonance: 'Judgment that crystallizes into fixed truth.',
        etching_text: 'The world writes a name it did not choose.' },
      answers: { nature: 'watch', drive: 'outlast', flaw: 'verdicts', memory: 'the workshop', bond: 'debt' },
    },
    skills: [
      { name: 'Umbral Slip', tier: 'Intrinsic', mastery: 9, description: 'Dissolve briefly into shadow.' },
      { name: 'Dark Sense', tier: 'Intrinsic', mastery: 16, description: 'See in total darkness.' },
      { name: 'Kept Verdict', tier: 'Unique', mastery: 12,
        description: 'Perceives the true shape of a thing by observing it in stillness.',
        soul_resonance: 'Judgment that crystallizes into fixed truth.', sub_abilities: [], usage_notes: [] },
    ],
    location: 'Greyhollow, sunken plaza — Ashenveil',
    currentScene: 'The bone mask has not spoken. Beneath the grate, a single tap.',
    actionHistory: ['watched the proceeding', 'called out once', 'took stock'],
    narrativeMemory: { entities: {}, notes: ['The listener beneath the flagstones has not moved.'] },
  },
  log: [{ type: 'narration', text: 'The Reciter’s voice has not resumed. Somewhere beneath the grate, a single tap.' }],
  savedAt: Date.now(), schemaVersion: 1,
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('response', (r) => { const p = new URL(r.url()).pathname;
  if (p.startsWith('/api/') && p !== '/api/health') console.log(`[HTTP] ${p} -> ${r.status()}`); });

await page.addInitScript(({ prefix, indexKey, id, s }) => {
  // WRITE-ONCE. addInitScript re-runs on every navigation, reload included.
  // Without this guard the seed clobbers the app's own autosave on reload,
  // and the restore comparison silently measures the fixture, not the app.
  if (localStorage.getItem(prefix + id)) return;
  localStorage.setItem(prefix + id, JSON.stringify(s));
  localStorage.setItem(indexKey, JSON.stringify([{ id, name: s.gameState.character.name,
    race: s.gameState.character.race.name, location: s.gameState.location,
    skillCount: s.gameState.skills.length, savedAt: s.savedAt, uniqueSkill: 'Kept Verdict' }]));
}, { prefix: PREFIX, indexKey: INDEX, id: SLOT, s: slot });

const readStored = () => page.evaluate(({ prefix, id }) => {
  const raw = JSON.parse(localStorage.getItem(prefix + id));
  return { location: raw.gameState.location,
    skills: raw.gameState.skills.map((k) => `${k.name}=${k.mastery}`).sort(),
    logLen: raw.log.length, savedAt: raw.savedAt };
}, { prefix: PREFIX, id: SLOT });

const readScreen = () => page.evaluate(() => {
  const t = document.body.innerText;
  const loc = (t.match(/LOCATION\s*\n([^\n]+)/) || [])[1] || null;
  const masteries = [...document.body.innerText.matchAll(/(\d+)\/100/g)].map((m) => m[1]);
  return { loc, masteries };
});

const openSave = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('.save-card', { hasText: 'Yulen Marr' })
            .getByRole('button', { name: 'Continue' }).click();
  await page.locator(TEXTAREA).waitFor({ state: 'visible', timeout: 30000 });
};

// 1. Load the seeded save.
await openSave();
console.log('BEFORE-ACTION  stored :', JSON.stringify(await readStored()));

// 2. One LIVE turn (call 6 of 6). The app autosaves real model output.
const wait = page.waitForResponse((r) => r.url().includes('/api/world-engine'), { timeout: 240000 });
await page.locator(TEXTAREA).fill('I step out of the spice-stall shadow and speak the third fact aloud, to the bone mask alone.');
await page.getByRole('button', { name: /^Act$/i }).click();
await wait;
await page.waitForTimeout(3000);
const postAction = { stored: await readStored(), screen: await readScreen() };
console.log('POST-ACTION    stored :', JSON.stringify(postAction.stored));
console.log('POST-ACTION    screen :', JSON.stringify(postAction.screen));
await page.screenshot({ path: `${SHOTS}/05-post-action.png` });

// 3. Full page reload — nothing in memory survives this.
await page.reload({ waitUntil: 'networkidle' });
console.log('AFTER RELOAD, phase is title:', await page.locator('.save-card').count(), 'save card(s) visible');

// 4. Load the save again.
await page.locator('.save-card', { hasText: 'Yulen Marr' })
          .getByRole('button', { name: 'Continue' }).click();
await page.locator(TEXTAREA).waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(1500);
const restored = { stored: await readStored(), screen: await readScreen() };
console.log('AFTER-RELOAD   stored :', JSON.stringify(restored.stored));
console.log('AFTER-RELOAD   screen :', JSON.stringify(restored.screen));
await page.screenshot({ path: `${SHOTS}/06-after-reload.png` });

// 5. Field-by-field comparison.
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rows = [
  ['location',  postAction.screen.loc,       restored.screen.loc],
  ['masteries', postAction.screen.masteries, restored.screen.masteries],
  ['log length',postAction.stored.logLen,    restored.stored.logLen],
  ['skills',    postAction.stored.skills,    restored.stored.skills],
];
console.log('\n=== RESTORE COMPARISON ===');
let pass = true;
for (const [f, a, b] of rows) { const ok = eq(a, b); pass &&= ok;
  console.log(`${ok ? 'MATCH' : 'DIFF '}  ${f.padEnd(11)} before=${JSON.stringify(a)} after=${JSON.stringify(b)}`); }

// 6. Liveness of the LOADED session, checked without spending a 7th call:
//    the action bar must accept input and arm its button.
await page.locator(TEXTAREA).fill('I wait.');
const armed = await page.getByRole('button', { name: /^Act$/i }).isEnabled();
console.log(`\nloaded session interactive (Act armed on input): ${armed}`);
console.log(`\nRESTORE: ${pass && armed ? 'PASS' : 'FAIL'}`);
await browser.close();
