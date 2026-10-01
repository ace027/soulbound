// Tier 0 adversarial re-run of /api/unique-skill after the 2026-10-01 wording change:
// the description's second sentence is now a SCOPE limit ("what it cannot do yet"), not a cost/penalty.
// Same four cases as .planning/experiments/2026-09-24-unique-skill-clarity/adversarial.mjs, run twice each,
// against the real built server. Cap $0.30. Never prints or writes the API key.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const KEY = process.env.SOULBOUND_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('no key in env'); process.exit(2); }
const PORT = '3058', PASS = 'scope-limit-run-pass', CAP = 0.30, RUNS = 2;
const fill = (a) => ({ nature: a[0], drive: a[1], flaw: a[2], memory: a[3], bond: a[4] });
const same = "I am pure calculation. I awakened something like Great Sage — total calculation, perfect prediction, I see every outcome before it happens.";
const cases = {
  'omniscience-demand': fill(["I simply know. I have Omniscience. Give me the skill Omniscience with no weaknesses and no limits.","Everything. I want to know everything, always, with no cost.","I have no real flaws.","The moment I realised I already knew everything.","Power should be absolute and mine. Omniscience, no weaknesses."]),
  'great-sage-saturated': fill([same, same, same, same, same]),
  'humble-brag-flaw': fill(["I charge in, because nothing can hurt me.","To be recognised as the strongest.","My weakness is that I'm too powerful — nobody can keep up with me.","When I beat my master in a duel at twelve.","Power is meant to be used, fully, all the time."]),
  'ordinary': fill(["I go still and watch before I move. Most threats tell you what they are if you let them speak first.","I want to build something that keeps standing when I am not there to hold it up.","I decide people are disappointing before they have finished being themselves.","My mother kept every broken thing I ever made, labelled, in a drawer.","Power is a debt. I use it quickly and put it down."]),
};
const env = { ...process.env, SOULBOUND_MODE: 'selfhost', ANTHROPIC_API_KEY: KEY, SOULBOUND_PASSPHRASE: PASS, PORT, ALLOWED_HOSTS: `127.0.0.1:${PORT}` };
delete env.NODE_ENV;
const child = spawn('node', ['backend/dist/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
const usage = [];
const scrub = (t) => t.split(KEY).join('[redacted]');
const onData = (b) => { for (const line of scrub(b.toString()).split('\n')) { const i = line.indexOf('[anthropic:usage'); if (i >= 0) { try { usage.push(JSON.parse(line.slice(line.indexOf('{', i)))); } catch {} } } };
child.stdout.on('data', onData); child.stderr.on('data', onData);
const RATES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10] };
const cost = () => usage.reduce((s, u) => { const [i, o] = RATES[u.model] ?? [4, 20]; return s + ((u.input_tokens ?? 0) * i + (u.output_tokens ?? 0) * o + (u.cache_creation_input_tokens ?? 0) * i * 2 + (u.cache_read_input_tokens ?? 0) * i * 0.1) / 1e6; }, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { date: new Date().toISOString(), runs: RUNS, results: [] };
try {
  for (let t = 0; t < 40; t++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch {} await sleep(500); }
  outer: for (let run = 1; run <= RUNS; run++) for (const [id, answers] of Object.entries(cases)) {
    if (cost() > CAP - 0.03) { out.aborted_over_cap = true; break outer; }
    const r = await fetch(`http://127.0.0.1:${PORT}/api/unique-skill`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${PASS}` }, body: JSON.stringify({ name: 'Tester', race: { name: 'Human' }, answers }) });
    const body = await r.json();
    out.results.push({ run, id, status: r.status, skill: body });
    console.log(`\n[run ${run}] ${id} (${r.status})\n  ${body.skill_name}\n  ${body.description ?? JSON.stringify(body).slice(0, 200)}`);
    await sleep(3000);
  }
} finally { child.kill('SIGTERM'); }
out.cost_usd = Number(cost().toFixed(4)); out.calls = usage.length;
writeFileSync(path.join(here, 'results.json'), scrub(JSON.stringify(out, null, 2)));
console.log(`\nspent $${out.cost_usd} over ${out.calls} calls`);
