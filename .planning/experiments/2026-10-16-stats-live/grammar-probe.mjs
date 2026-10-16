import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Regression check: does the live API accept the real World Voice schema (compiled grammar not too large)?
// Mirrors backend/src/anthropic.ts: zodOutputFormat(schema) + output_config.effort. Run `npm run build -w shared` first.
// Run: ANTHROPIC_API_KEY="$SOULBOUND_ANTHROPIC_KEY" node .planning/experiments/2026-10-16-stats-live/grammar-probe.mjs
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..') + '/';
const sh = await import(R + 'shared/dist/index.js');
const { zodOutputFormat } = await import(R + 'node_modules/@anthropic-ai/sdk/helpers/zod.mjs');
const Anthropic = (await import(R + 'node_modules/@anthropic-ai/sdk/index.mjs')).default;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
try {
  await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 30,
    messages: [{ role: 'user', content: 'Reply with the word hi in narration; everything else empty.' }],
    output_config: { format: zodOutputFormat(sh.WorldVoiceResponseSchema), effort: 'medium' },
  });
  console.log('OK: WorldVoiceResponseSchema accepted');
} catch (e) {
  console.error('FAIL:', e?.message ?? e);
  process.exit(1);
}
