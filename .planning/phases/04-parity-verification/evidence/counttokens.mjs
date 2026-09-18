// FREE derivation: count_tokens is not billed. Establishes the expected
// cached-prefix size before any paid call, so we know what to look for.
import Anthropic from '/home/user/soulbound/node_modules/@anthropic-ai/sdk/index.mjs';
import { buildSystemBlocks } from '/home/user/soulbound/backend/dist/anthropic.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const system = buildSystemBlocks();

console.log('system blocks:', system.length);
system.forEach((b, i) =>
  console.log(`  block ${i}: ${b.text.length} chars, cache_control=${JSON.stringify(b.cache_control ?? null)}`)
);

const r = await client.messages.countTokens({
  model: 'claude-opus-5',
  system,
  messages: [{ role: 'user', content: 'probe' }],
});
console.log('count_tokens (system + 1 tiny user msg):', JSON.stringify(r));
