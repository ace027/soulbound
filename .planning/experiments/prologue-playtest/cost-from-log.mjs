#!/usr/bin/env node
// Sums Anthropic cost per route from `[anthropic:usage]` lines in a backend log.
//
//   node cost-from-log.mjs <logfile> [--from-line N] [--to-line M]
//
// Lines are counted over the RAW log (1-based, inclusive), so note the log's
// line count before and after creating each character and pass those numbers.
// Usage lines carry no session id: cost one character at a time, or the calls
// of two characters cannot be told apart.
//
// Rates are USD per million tokens (input/output). Cache read costs 0.1x the
// input rate. Cache write is priced at 2x the input rate, because the
// system-block routes use a 1-hour cache TTL. The log cannot split TTLs, so
// this is an upper bound for any 5-minute write (1.25x). The prologue routes
// send no system blocks and show 0 cache tokens.
// Node built-ins only. Tolerates non-matching lines and Windows line endings.

import { readFileSync } from 'node:fs';

const RATES = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};
const CACHE_WRITE_X = 2;
const CACHE_READ_X = 0.1;
const CHARACTER_ROUTES = ['prologueBeat', 'prologueProfile', 'uniqueSkill', 'introScene'];
const USAGE_RE = /\[anthropic:usage(?::truncated)?\]\s*(\{.*\})\s*$/;

const USAGE_MSG =
  'Usage: node cost-from-log.mjs <logfile> [--from-line N] [--to-line M]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { file: undefined, from: 1, to: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from-line' || arg === '--to-line') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) fail(`${arg} needs a positive integer.\n${USAGE_MSG}`);
      if (arg === '--from-line') out.from = value;
      else out.to = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      fail(`Unknown option ${arg}.\n${USAGE_MSG}`);
    } else if (out.file === undefined) {
      out.file = arg;
    } else {
      fail(`Unexpected argument ${arg}.\n${USAGE_MSG}`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) fail(USAGE_MSG);

let text;
try {
  text = readFileSync(args.file, 'utf8');
} catch (err) {
  fail(`Cannot read ${args.file}: ${err.code ?? err.message}\n${USAGE_MSG}`);
}

const byRoute = new Map();
let warnedModel = false;
text.split('\n').forEach((raw, index) => {
  const lineNo = index + 1;
  if (lineNo < args.from || lineNo > args.to) return;
  const match = USAGE_RE.exec(raw.replace(/\r$/, ''));
  if (!match) return;
  let rec;
  try {
    rec = JSON.parse(match[1]);
  } catch {
    return;
  }
  let rate = RATES[rec.model];
  if (!rate) {
    if (!warnedModel) {
      console.error(`Unknown model "${rec.model}": priced at claude-sonnet-5-5 rates.`);
      warnedModel = true;
    }
    rate = RATES['claude-sonnet-5-5'];
  }
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const usd =
    (n(rec.input_tokens) * rate.input +
      n(rec.output_tokens) * rate.output +
      n(rec.cache_creation_input_tokens) * rate.input * CACHE_WRITE_X +
      n(rec.cache_read_input_tokens) * rate.input * CACHE_READ_X) /
    1e6;
  const key = String(rec.route ?? 'unknown');
  const row = byRoute.get(key) ?? { calls: 0, usd: 0 };
  row.calls += 1;
  row.usd += usd;
  byRoute.set(key, row);
});

if (byRoute.size === 0) {
  fail(`No [anthropic:usage] lines in the selected range of ${args.file}.\n${USAGE_MSG}`);
}

const pad = (s, w) => String(s).padEnd(w);
console.log(`${pad('route', 18)}${pad('calls', 7)}USD`);
let total = 0;
for (const [route, row] of byRoute) {
  total += row.usd;
  console.log(`${pad(route, 18)}${pad(row.calls, 7)}${row.usd.toFixed(4)}`);
}
console.log(`selected lines total  ${total.toFixed(4)}`);

const present = CHARACTER_ROUTES.filter((r) => byRoute.has(r));
const perCharacter = present.reduce((sum, r) => sum + byRoute.get(r).usd, 0);
console.log(`per-character (routes present: ${present.join(', ') || 'none'})  ${perCharacter.toFixed(4)}`);
