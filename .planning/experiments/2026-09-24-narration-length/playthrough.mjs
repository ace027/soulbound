import pw from '/home/user/soulbound/node_modules/playwright-core/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = pw;
const DIR = process.argv[2];
const SHOTS = `${DIR}/shots`;
const PASS = readFileSync(`${DIR}/pass`, 'utf8').trim();
const BASE = 'http://localhost:3001';
const ANSWERS = [
  "I go still and watch before I move. Most threats tell you what they are if you let them speak first.",
  "I want to build something that keeps standing when I am not there to hold it up.",
  "I decide people are disappointing before they have finished being themselves.",
  "My mother kept every broken thing I ever made, labelled, in a drawer. I have never been able to throw anything away since.",
  "Power is a debt. I use it quickly and put it down, because I don't trust what I become if I carry it.",
];
const ACTIONS = [
  "I kneel and press my palm to the ground, listening for whatever is moving beneath this place.",
  "I call out to whoever is nearby and ask where I am.",
  "I follow the sound carefully, keeping to the shadows.",
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('response', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/') && p !== '/api/health') console.log(`[HTTP] ${p} -> ${r.status()}`); });
const shot = async (n) => { await page.screenshot({ path: `${SHOTS}/${n}.png` }); console.log(`[shot] ${n}`); };
// Screenshot just the newest narration entry, full height, so the whole response is visible.
const lastEntryShot = async (n) => {
  const entry = page.locator('div[style*="line-height: 1.8"][style*="pre-wrap"]').last();
  await entry.scrollIntoViewIfNeeded();
  const box = entry.locator('xpath=../..');
  await box.screenshot({ path: `${SHOTS}/${n}.png` });
  const text = await entry.innerText();
  console.log(`[shot] ${n} — ${text.trim().split(/\s+/).length} words, ${text.split(/\n\s*\n/).filter(s=>s.trim()).length} paragraphs`);
  return text;
};
const out = [];
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByLabel('Passphrase').fill(PASS);
await page.getByLabel('Passphrase').press('Enter');
await page.getByRole('button', { name: /Begin/i }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /Begin/i }).click();
await page.getByPlaceholder('What are you called?').fill('Yulen Marr');
await page.getByText('Shadeveil', { exact: false }).first().click();
await page.getByRole('button', { name: 'Enter the World Voice' }).click();
for (let i = 0; i < ANSWERS.length; i++) {
  await page.getByPlaceholder('Write freely...').fill(ANSWERS[i]);
  await page.getByRole('button', { name: i < ANSWERS.length - 1 ? /Continue/i : /Speak to the World Voice/i }).click();
}
const box = page.getByPlaceholder('What do you do?');
await box.waitFor({ state: 'visible', timeout: 300000 });
await page.waitForTimeout(1500);
await shot('01-intro-screen');
out.push(['INTRO', await lastEntryShot('01-intro-text')]);
for (let t = 0; t < ACTIONS.length; t++) {
  await box.fill(ACTIONS[t]);
  const w = page.waitForResponse((r) => r.url().includes('/api/world-engine'), { timeout: 300000 });
  await page.getByRole('button', { name: /^Act$/i }).click();
  await w; await page.waitForTimeout(2000);
  await shot(`0${t + 2}-turn${t + 1}-screen`);
  out.push([`TURN ${t + 1}: ${ACTIONS[t]}`, await lastEntryShot(`0${t + 2}-turn${t + 1}-text`)]);
}
writeFileSync(`${DIR}/narration.txt`, out.map(([h, t]) => `=== ${h}\n${t.trim()}\n`).join('\n'));
await browser.close();
