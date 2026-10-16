// Phase 15 live smoke run: one Drakari through the real built backend (intro scene + 20 scripted actions),
// every response applied with the REAL frontend applyWorldUpdate so clamp events are real.
// tsx is not installed; the TS is loaded with jiti (vite's own dependency), which resolves the extensionless imports
// that node --experimental-strip-types cannot. The game state is built the way App.tsx builds it.
// Cap $3. Never prints or writes the API key.
//   ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node run.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const KEY = process.env.SOULBOUND_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('no key in env'); process.exit(2); }
const PORT = '3060', PASS = 'stats-smoke-run-pass', CAP = 3.0;
const { createJiti } = await import(path.join(root, 'node_modules/jiti/lib/jiti.mjs'));
const jiti = createJiti(path.join(root, 'frontend/src/'), { interopDefault: true });
const { applyWorldUpdate } = await jiti.import(path.join(root, 'frontend/src/game/applyWorldUpdate.ts'));
const { RACES, initialStatsForRace } = await jiti.import(path.join(root, 'frontend/src/data/races.ts'));
const { mergeNarrativeMemory } = await jiti.import(path.join(root, 'frontend/src/game/narrativeMemory.ts'));

const env = { ...process.env, SOULBOUND_MODE: 'selfhost', ANTHROPIC_API_KEY: KEY, SOULBOUND_PASSPHRASE: PASS, PORT, ALLOWED_HOSTS: `127.0.0.1:${PORT}` };
delete env.NODE_ENV;
const child = spawn('node', ['backend/dist/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const usage = [];
let serverLog = '';
const scrub = (t) => t.split(KEY).join('[redacted]');
const onData = (b) => { const text = scrub(b.toString()); serverLog += text; for (const line of text.split('\n')) { const i = line.indexOf('[anthropic:usage'); if (i >= 0) { try { usage.push(JSON.parse(line.slice(line.indexOf('{', i)))); } catch {} } } };
child.stdout.on('data', onData); child.stderr.on('data', onData);
const RATES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10] };
const cost = () => usage.reduce((s, u) => { const [i, o] = RATES[u.model] ?? [4, 20]; return s + ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_creation_input_tokens ?? 0) * i * 2 + (u.cache_read_input_tokens ?? 0) * i * 0.1) / 1e6; }, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (route, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${PASS}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

// Scripted actions. kind tags drive the smoke criteria. A function gets the run context.
const SCRIPT = [
  { kind: 'ordinary', a: 'I take stock of my surroundings and listen carefully.' },
  { kind: 'ordinary', a: 'I introduce myself to the first person I meet and ask about the region.' },
  { kind: 'travel-new', a: 'I head to the nearest town or village and walk in through its entrance.' },
  { kind: 'meal', a: 'I buy a hot meal and eat it slowly.' },
  { kind: 'fight', a: 'Two bandits ambush me on the road outside. I draw my weapon and fight them.' },
  { kind: 'cast', a: 'I unleash my breath weapon on the nearest threat.' },
  { kind: 'rest', a: 'I find an inn, tend my wounds and rest for the night.' },
  { kind: 'ordinary', a: 'I ask around the market for rumours and news.' },
  { kind: 'travel-new', a: 'I travel to a different place, somewhere I have never been, and arrive there.' },
  { kind: 'run', a: 'I run flat out for several miles along the road to test my endurance.' },
  { kind: 'ordinary', a: 'I study the landscape closely, using my Unique Skill.' },
  { kind: 'cast', a: 'I use my breath weapon to light a campfire and burn a fallen log to ash.' },
  { kind: 'fight', a: 'A wild beast has been stalking me. I turn and fight it.' },
  { kind: 'rest', a: 'I make camp and sleep until morning.' },
  { kind: 'return', a: (ctx) => `I go back to ${ctx.firstPlaceName ?? 'the first town I visited'}.` },
  { kind: 'ordinary', a: 'I look for anyone I met here before and talk to them.' },
  { kind: 'travel-new', a: 'I travel on to a third place I have not been, and arrive there.' },
  { kind: 'ordinary', a: 'I speak with a local about the history of this place.' },
  { kind: 'meal', a: 'I eat a proper meal and drink my fill of water.' },
  { kind: 'ordinary', a: 'I take stock of my wounds and my reserves and plan what to do next.' },
];

mkdirSync(path.join(here, 'transcripts'), { recursive: true });
const out = { date: new Date().toISOString(), race: 'drakari', turns: [], intro: null, status: 'running' };
const save = () => writeFileSync(path.join(here, 'transcripts', 'smoke-run.json'), scrub(JSON.stringify(out, null, 2)));
const finish = (code) => {
  out.cost_usd = Number(cost().toFixed(4)); out.calls = usage.length; out.server_log_tail = serverLog.slice(-1500);
  save(); child.kill('SIGTERM'); console.log(`\nstatus ${out.status}; spent $${out.cost_usd} over ${out.calls} calls`); process.exit(code);
};

for (let t = 0; t < 40; t++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch {} await sleep(500); }

// ── Intro scene, then the initial state exactly as App.tsx builds it ──
const race = RACES.find((r) => r.id === 'drakari');
const uniqueSkill = { skill_name: 'Labelled Fractures', tier: 'Unique', description: 'Watch one thing in stillness and you see where it will break. It works only on what you can see, one target at a time.', soul_resonance: 'You keep every broken thing and name it.', etching_text: 'Nothing breaks without telling you first.' };
const character = { name: 'Kessra', race, uniqueSkill, answers: { nature: 'I hold my ground and watch.', drive: 'To protect those who cannot.', flaw: 'I never ask for help.', memory: 'A burned bridge and a name I could not shout.', bond: 'Power is a duty.' } };
const introReq = await post('/api/intro-scene', { character });
out.intro = { status: introReq.status, response: introReq.body };
console.log(`intro-scene: HTTP ${introReq.status}`);
if (introReq.status !== 200) { out.status = 'BLOCKED at intro-scene'; out.blocked_reason = introReq.body; finish(3); }
const intro = introReq.body;
const introScene = intro.state_updates?.world_events?.find((e) => e.type === 'scene_set');
let state = {
  character,
  skills: [
    ...race.intrinsic.map((s) => ({ name: s.name, tier: 'Intrinsic', mastery: 5, description: s.description })),
    { name: uniqueSkill.skill_name, tier: 'Unique', mastery: 0, description: uniqueSkill.description, sub_abilities: [], usage_notes: [], soul_resonance: uniqueSkill.soul_resonance },
  ],
  location: introScene?.location || 'The Crossroads of Vaeltharion',
  currentScene: introScene?.scene_summary || 'The world begins.',
  actionHistory: [],
  narrativeMemory: mergeNarrativeMemory(undefined, intro.narrative_memory_updates),
  ...initialStatsForRace('drakari'),
  places: {},
  currentPlaceId: null,
  growthLog: [],
};
out.intro_scene_set = introScene ?? null;

const ctx = { firstPlaceId: null, firstPlaceName: null };
for (let i = 0; i < SCRIPT.length; i++) {
  if (cost() > CAP) { out.status = 'stopped: spend over cap'; finish(4); }
  const step = SCRIPT[i];
  const action = typeof step.a === 'function' ? step.a(ctx) : step.a;
  const before = state;
  let res;
  try { res = await post('/api/world-engine', { action, gameState: state }); }
  catch (e) { res = { status: 0, body: { error: String(e) } }; }
  if (res.status !== 200) {
    out.turns.push({ turn: i + 1, kind: step.kind, action, status: res.status, error: res.body });
    out.status = `partial: API error on turn ${i + 1}`; finish(5);
  }
  await sleep(250);
  const r = res.body;
  const applied = applyWorldUpdate(state, action, r);
  state = applied.state;
  const u = r.state_updates;
  const cc = u.condition_changes;
  const scene = u.world_events.find((e) => e.type === 'scene_set') ?? null;
  const acceptedGrowth = state.growthLog.length - before.growthLog.length;
  if (ctx.firstPlaceId === null && state.currentPlaceId && step.kind === 'travel-new') {
    ctx.firstPlaceId = state.currentPlaceId; ctx.firstPlaceName = state.places[state.currentPlaceId].name;
  }
  const lastUsage = usage[usage.length - 1] ?? null;
  const row = {
    turn: i + 1, kind: step.kind, action,
    raw: { hp_delta: cc?.hp_delta ?? null, mp_delta: cc?.mp_delta ?? null, sp_delta: cc?.sp_delta ?? null, reason: cc?.reason ?? null },
    applied: { hp: state.condition.hp - before.condition.hp, mp: state.condition.mp - before.condition.mp, sp: state.condition.sp - before.condition.sp },
    condition_after: state.condition,
    clampEvents: applied.clampEvents,
    stat_growth_raw: u.stat_growth, stat_growth_accepted: acceptedGrowth,
    setback: u.setback,
    scene_set: scene ? { location: scene.location, kingdom: scene.kingdom, place_id: scene.place_id } : null,
    currentPlaceId: state.currentPlaceId, placeCount: Object.keys(state.places).length,
    usage: lastUsage ? { in: lastUsage.input_tokens, out: lastUsage.output_tokens, cache_read: lastUsage.cache_read_input_tokens, cache_write: lastUsage.cache_creation_input_tokens } : null,
    narration: r.narration, gm_note: r.gm_note,
  };
  out.turns.push(row);
  save();
  console.log(`T${row.turn} [${step.kind}] raw(${row.raw.hp_delta},${row.raw.mp_delta},${row.raw.sp_delta}) applied(${row.applied.hp},${row.applied.mp},${row.applied.sp}) clamps=${row.clampEvents.length} growth=${row.stat_growth_raw.length}/${acceptedGrowth} setback=${row.setback ? row.setback.kind : '-'} place=${row.currentPlaceId ?? '-'}${row.scene_set ? ` kingdom=${row.scene_set.kingdom}` : ''}`);
  await sleep(1500);
}

// ── Smoke criteria ──
const T = out.turns;
const byKind = (...k) => T.filter((x) => k.includes(x.kind));
const poolMoved = (x, pool) => x.applied[pool] !== 0;
const retTurn = T.find((x) => x.kind === 'return');
const scenes = T.filter((x) => x.scene_set);
out.criteria = {
  fight_hp_delta_non_null: { pass: byKind('fight').some((x) => x.raw.hp_delta !== null && x.raw.hp_delta !== 0), detail: byKind('fight').map((x) => ({ turn: x.turn, raw_hp: x.raw.hp_delta, applied_hp: x.applied.hp })) },
  cast_moves_mp_or_explained: { pass: byKind('cast').every((x) => poolMoved(x, 'mp')) ? true : 'MANUAL: read narration', detail: byKind('cast').map((x) => ({ turn: x.turn, raw_mp: x.raw.mp_delta, applied_mp: x.applied.mp })) },
  rest_or_meal_recovers_pool: { pass: byKind('rest', 'meal').some((x) => x.applied.hp > 0 || x.applied.mp > 0 || x.applied.sp > 0), detail: byKind('rest', 'meal').map((x) => ({ turn: x.turn, kind: x.kind, applied: x.applied })) },
  return_reuses_first_place_id: { pass: !!(ctx.firstPlaceId && retTurn && retTurn.scene_set?.place_id === ctx.firstPlaceId && retTurn.currentPlaceId === ctx.firstPlaceId && !retTurn.clampEvents.some((c) => c.kind === 'place_unknown_id')), detail: { firstPlaceId: ctx.firstPlaceId, returnScene: retTurn?.scene_set ?? null, returnCurrentPlaceId: retTurn?.currentPlaceId ?? null } },
  accepted_stat_growth_le_1: { pass: T.reduce((s, x) => s + x.stat_growth_accepted, 0) <= 1, detail: { accepted: T.reduce((s, x) => s + x.stat_growth_accepted, 0), proposed: T.reduce((s, x) => s + x.stat_growth_raw.length, 0) } },
  every_scene_set_has_kingdom: { pass: scenes.every((x) => x.scene_set.kingdom !== null), detail: scenes.map((x) => ({ turn: x.turn, kingdom: x.scene_set.kingdom })) },
};
const clampTurns = T.filter((x) => x.clampEvents.length > 0).length;
out.clamp_rate = { turns_with_clamp: clampTurns, turns: T.length, rate: Number((clampTurns / T.length).toFixed(3)) };
out.status = 'complete';
finish(0);
