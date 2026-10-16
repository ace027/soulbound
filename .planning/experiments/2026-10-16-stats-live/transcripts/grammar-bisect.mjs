import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Grammar-size bisect for the Phase 15 World Voice contract. Each variant is sent with a 30-token prompt, so a 400
// 'compiled grammar is too large' appears before any real generation (cost is about zero).
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..') + '/';
const { z } = await import(R + 'node_modules/zod/index.js');
const sh = await import(R + 'shared/dist/index.js');
const { zodOutputFormat } = await import(R + 'node_modules/@anthropic-ai/sdk/helpers/zod.mjs');
const Anthropic = (await import(R + 'node_modules/@anthropic-ai/sdk/index.mjs')).default;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SU = sh.StateUpdatesSchema.shape, WE = sh.WorldEventSchema.shape;
const oldWE = z.strictObject({ type: WE.type, location: WE.location, scene_summary: WE.scene_summary, description: WE.description });
const build = (we, extra) => z.strictObject({ narration: z.string(), state_updates: z.strictObject({ skill_mastery_changes: SU.skill_mastery_changes, new_skills_granted: SU.new_skills_granted, skill_evolutions: SU.skill_evolutions, unique_sub_ability_unlocked: SU.unique_sub_ability_unlocked, world_events: z.array(we), ...extra }), narrative_memory_updates: sh.NarrativeMemoryUpdatesSchema, gm_note: z.string().nullable() });
const CC=SU.condition_changes, SG=SU.stat_growth, SB=SU.setback, WEF=sh.WorldEventSchema;
const SGstr=z.array(z.strictObject({stat:z.string(),amount:z.number().int(),milestone:z.string()}));
const SBstr=z.strictObject({kind:z.string(),summary:z.string()}).nullable();
const CCnum=z.strictObject({hp_delta:z.number().nullable(),mp_delta:z.number().nullable(),sp_delta:z.number().nullable(),reason:z.string().nullable()}).nullable();
const WEstr=z.strictObject({...WE,kingdom:z.string().nullable()});
const variants = {
  full: build(WEF,{condition_changes:CC,stat_growth:SG,setback:SB}),
  'pre-phase (none of the 5 new fields)': build(oldWE,{}),
  '+condition_changes only': build(oldWE,{condition_changes:CC}),
  '+stat_growth only': build(oldWE,{stat_growth:SG}),
  '+setback only': build(oldWE,{setback:SB}),
  '+kingdom,place_id only': build(WEF,{}),
  'cc+sg': build(oldWE,{condition_changes:CC,stat_growth:SG}),
  'cc+sb': build(oldWE,{condition_changes:CC,setback:SB}),
  'sg+sb': build(oldWE,{stat_growth:SG,setback:SB}),
  'cc+sg+sb (no we fields)': build(oldWE,{condition_changes:CC,stat_growth:SG,setback:SB}),
  'we fields + cc + sg (setback dropped)': build(WEF,{condition_changes:CC,stat_growth:SG}),
  'we fields + cc + sb (stat_growth dropped)': build(WEF,{condition_changes:CC,setback:SB}),
  'we fields + sg + sb (condition_changes dropped)': build(WEF,{stat_growth:SG,setback:SB}),
  'we fields + cc': build(WEF,{condition_changes:CC}),
  'we fields + sg': build(WEF,{stat_growth:SG}),
  'we fields + sb': build(WEF,{setback:SB}),
  'full, stat/kind enums -> string': build(WEF,{condition_changes:CC,stat_growth:SGstr,setback:SBstr}),
  'full, + kingdom string': build(WEstr,{condition_changes:CC,stat_growth:SGstr,setback:SBstr}),
  'full, kingdom string, deltas z.number': build(WEstr,{condition_changes:CCnum,stat_growth:SGstr,setback:SBstr}),
  'full, kingdom string, no sb kind': build(WEstr,{condition_changes:CC,stat_growth:SG,setback:z.strictObject({summary:z.string()}).nullable()}),
};
for (const [name, schema] of Object.entries(variants)) {
  try {
    await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 30, messages: [{ role: 'user', content: 'Reply with the word hi in narration; everything else empty/null.' }], output_config: { format: zodOutputFormat(schema), effort: 'low' } });
    console.log('OK     ', name);
  } catch (e) { console.log('FAIL   ', name, '-', String(e.message).slice(0, 140)); }
}
