#!/usr/bin/env node
/**
 * node scripts/assert-no-skips.mjs <vitest-json-report>
 *
 * The second half of `npm run test:hosted`: Vitest exits 0 when tests are
 * skipped, so a `.skip`, a `.todo`, or an empty suite would otherwise read as
 * green. This fails (exit 1) on any skipped or todo test, on zero tests, or
 * on a missing/unreadable report.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/assert-no-skips.mjs <vitest-json-report>');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`[assert-no-skips] cannot read ${file}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const total = Number(report.numTotalTests ?? 0);
const pending = Number(report.numPendingTests ?? 0);
const todo = Number(report.numTodoTests ?? 0);

if (total === 0) {
  console.error('[assert-no-skips] FAIL: the hosted suite ran 0 tests');
  process.exit(1);
}
if (pending + todo > 0) {
  console.error(`[assert-no-skips] FAIL: ${pending} skipped and ${todo} todo test(s) out of ${total}; the hosted suite may not skip`);
  process.exit(1);
}
console.log(`[assert-no-skips] OK: ${total} tests, 0 skipped, 0 todo`);
