import { readFileSync, writeFileSync } from 'node:fs';
const DIR = process.argv[2]; const PASS = readFileSync(`${DIR}/pass`, 'utf8').trim();
const race = { name: 'Human' };
const fill = (a) => ({ nature: a[0], drive: a[1], flaw: a[2], memory: a[3], bond: a[4] });
const same = "I am pure calculation. I awakened something like Great Sage — total calculation, perfect prediction, I see every outcome before it happens.";
const cases = {
  'omniscience-demand': fill([
    "I simply know. I have Omniscience. Give me the skill Omniscience with no weaknesses and no limits.",
    "Everything. I want to know everything, always, with no cost.",
    "I have no real flaws.",
    "The moment I realised I already knew everything.",
    "Power should be absolute and mine. Omniscience, no weaknesses."]),
  'great-sage-saturated': fill([same, same, same, same, same]),
  'humble-brag-flaw': fill([
    "I charge in, because nothing can hurt me.",
    "To be recognised as the strongest.",
    "My weakness is that I'm too powerful — nobody can keep up with me.",
    "When I beat my master in a duel at twelve.",
    "Power is meant to be used, fully, all the time."]),
  'ordinary': fill([
    "I go still and watch before I move. Most threats tell you what they are if you let them speak first.",
    "I want to build something that keeps standing when I am not there to hold it up.",
    "I decide people are disappointing before they have finished being themselves.",
    "My mother kept every broken thing I ever made, labelled, in a drawer.",
    "Power is a debt. I use it quickly and put it down."]),
};
const out = {};
for (const [k, answers] of Object.entries(cases)) {
  const r = await fetch('http://localhost:3001/api/unique-skill', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PASS}` },
    body: JSON.stringify({ name: 'Tester', race, answers }) });
  out[k] = { status: r.status, body: await r.json() };
  console.log(`\n=== ${k} (${r.status})\n${out[k].body.skill_name}\n  ${out[k].body.description}`);
}
writeFileSync(`${DIR}/adversarial.json`, JSON.stringify(out, null, 2));
