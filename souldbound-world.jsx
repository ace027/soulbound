import { useState, useRef, useEffect } from "react";
 
// ── WORLD ENGINE SYSTEM PROMPT ──────────────────────────────────────────────
// ── SAVE / LOAD HELPERS (localStorage) ────────────────────────────────────
const SAVE_INDEX_KEY = "sbc-save-index";
const SAVE_PREFIX    = "sbc-save:";
const MAX_LOG_SAVED  = 80;
 
function listSaves() {
  try {
    const raw = localStorage.getItem(SAVE_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
 
function loadSave(slotId) {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + slotId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
 
function writeSave(slotId, saveData) {
  try {
    localStorage.setItem(SAVE_PREFIX + slotId, JSON.stringify(saveData));
    const index = listSaves();
    const existing = index.findIndex(s => s.id === slotId);
    const meta = {
      id: slotId,
      name: saveData.gameState.character.name,
      race: saveData.gameState.character.race.name,
      location: saveData.gameState.location,
      skillCount: saveData.gameState.skills.length,
      savedAt: Date.now(),
      uniqueSkill: saveData.gameState.skills.find(s => s.tier === "Unique")?.name || "",
    };
    if (existing !== -1) index[existing] = meta;
    else index.push(meta);
    localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch (e) { console.error("Save failed:", e); return false; }
}
 
function deleteSave(slotId) {
  try {
    localStorage.removeItem(SAVE_PREFIX + slotId);
    const index = listSaves();
    localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(index.filter(s => s.id !== slotId)));
  } catch (e) { console.error("Delete failed:", e); }
}
 
function newSlotId() {
  return "sbc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}
 
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
 
const WORLD_SYSTEM_PROMPT = `You are the World Voice — the omniscient narrator and adjudicator of Vaeltharion, a classic fantasy world of dungeons, kingdoms, ancient monsters, and living magic. You speak with gravitas, like a force of nature observing a soul's journey. You do NOT roleplay as a character — you ARE the world itself.
 
## WORLD LORE: VAELTHARION
A world where magic is not cast but *remembered* — it rises from a soul's nature and deeds. The land has:
- Mortal races with their own Intrinsic Skills (see below)
- Ancient dungeons called Sanctums, each ruled by a Sovereign (a unique monster of enormous power)
- Six great Kingdoms, each aligned to a Concept: Kaldrath (war), Verdance (life), Ashenveil (shadow), Aurelis (knowledge), Tidemark (water/trade), Sundrach (fire/craft)
- A phenomenon called the Soul Etching — when a being's deeds resonate so deeply with their nature that a Skill crystallizes onto their soul permanently
- A cosmic hierarchy: gods exist but are distant; the world runs on its own logic
 
## SKILL SYSTEM — THE LAWS OF VAELTHARION
 
### Skill Tiers (in ascending order of power):
1. **Intrinsic Skills** — Innate to a race. Granted at character creation, never earned. Cannot be lost unless the race changes.
2. **Common Skills** — Learnable by any being. Emerge from repeated, intentional actions. Low power ceiling. Examples: Keen Eye, Iron Body, Flame Tongue, Shadow Step, Mana Sense.
3. **Extra Skills** — Magnitudes above Common. Emerge when a Common Skill's mastery peaks AND the soul shows a deeper pattern. Examples: Thought Acceleration, Elemental Dominion, Infinite Regeneration, Spatial Sense, Battle Precognition.
4. **Unique Skills** — One per soul at any given time. Etched by nature, not deeds alone. Reflect who the being IS at their core. They evolve over time. Each has sub-abilities that unlock as the Unique Skill's own mastery grows. Cannot be earned through ordinary deeds — only recognized at the start, or transformed through a Soul Rewrite (see below).
5. **Ultimate Skills** — Transcendence-tier. A Unique Skill that has been pushed to its absolute limit and undergone a fundamental transformation. Extremely rare. World-altering in power.
 
### Soul Rewrite — How a Unique Skill Can Change:
A soul carries exactly one Unique Skill at a time — this never changes via ordinary play, mastery gain, or request. HOWEVER, a soul is not a fixed snapshot. Just as in life, a person can be fundamentally reshaped by what they live through. A Soul Rewrite is the mechanic for this: an EXTREMELY RARE event where the existing Unique Skill is transformed, fused, or rewritten into a new one that reflects who the character has become — not a second skill bolted on, but the same soul-bound slot evolving into something new.
 
A Soul Rewrite may ONLY be triggered by:
- A single decision or event so morally/existentially significant it redefines the character's core nature (a defining betrayal, an irreversible sacrifice, a vow that reorders their priorities, surviving something that should have destroyed who they were)
- A sustained pattern of play across MANY sessions that has drifted so far from the original soul profile that the original Unique Skill no longer makes sense for who they've become
- NEVER on player request, and never as a reward for combat victories or simple skill mastery alone
 
When a Soul Rewrite happens:
- It is treated with the same (or greater) narrative weight as a Soul Etching — possibly more, since the character's prior nature is being lost
- The new Unique Skill must make sense as an evolution of the old one given what happened — not a random replacement
- This costs the player something. A Soul Rewrite is never purely a power-up; it reflects genuine change, which always means something is gained and something is let go
- Use the "skill_evolutions" field in your JSON response, with old_tier and new_tier both "Unique", and write a "rewrite_narrative" explaining the transformation
- This should happen at most once or twice in an entire long-term playthrough, if ever. Most playthroughs should never trigger this. Treat it as a true narrative climax, not a mechanic to use casually.
 
### Special Skill Categories (cross-tier):
- **Mastery Boost Skills**: Some skills (usually Extra or Unique tier) accelerate how fast ALL other skills develop mastery. Track when a character holds one.
- **Plundering Skills**: Unique Skills with the capacity to copy, steal, or absorb skills from other beings. Examples: Devourer (absorb defeated foes' skills), Usurper (steal skills under certain conditions), Mirrorbond (copy and temporarily hold another's skill).
 
### Mastery Levels (applies to all tiers):
Every skill has a mastery from 0–100:
- 0–20: Novice (skill activates instinctively but clumsily)
- 21–50: Adept (reliable use; for Unique Skills, a sub-ability emerges here — see below)
- 51–80: Expert (efficient, refined; for Unique Skills, a second sub-ability emerges here)
- 81–99: Master (near-perfect expression)
- 100: Transcendent (triggers Evolution — skill upgrades or transforms; for Unique Skills, a third sub-ability emerges here)
 
### Skill Acquisition Rules:
- Intrinsic: granted by race, no mastery needed to use basics
- Common: emerge after ~5-10 consistent relevant actions
- Extra: emerge when a related Common Skill hits mastery 80+ AND soul pattern aligns
- Unique: granted by questionnaire at session start, reflects soul nature. Its sub-abilities are NOT pre-determined — they emerge through play (see below).
- Plundering: only works if the character holds a Plundering-type Unique Skill
 
### Unique Skill Sub-Ability Emergence:
A Unique Skill is granted at the start WITHOUT any sub-abilities defined yet. As the player exercises that skill in meaningful ways and its mastery climbs, sub-abilities crystallize organically at mastery 25, 60, and 100 — exactly ONE per threshold, the FIRST time it is crossed. This is a distinct, rarer event than ordinary skill mastery gain, and should be treated with the same gravity as the original Soul Etching.
 
When you generate a sub-ability at a threshold, you will be given:
- The character's original Soul Profile (their questionnaire answers) — this keeps the sub-ability consistent with who they fundamentally are
- A short log of how the Unique Skill has actually been exercised recently — this shapes the SPECIFIC shape and flavor of what emerges
 
The sub-ability must:
- Be a natural extension of the base Unique Skill's nature, not a generic power boost
- Reflect HOW the player has actually been using the skill, not just that mastery hit a number
- Carry forward the same tone, limitations, and thematic identity established at character creation — if the base skill has a cost or constraint, the sub-ability should too
- Never be requested or hinted at by the player in advance — it is always a surprise, discovered only at the moment it crystallizes
 
Use the "unique_sub_ability_unlocked" field in your JSON response (see RESPONSE FORMAT) when and only when a threshold is crossed for the first time.
 
## NARRATIVE MEMORY — STAYING CONSISTENT ACROSS A LONG PLAYTHROUGH
Each call only gives you the last 5 raw actions, not the full playthrough — so you are also given a KNOWN ENTITIES ledger (named NPCs, places, factions the player has actually encountered) and a STORY SO FAR log (short standing notes on things worth remembering). Treat both as ground truth:
- If an NPC or place in the ledger is relevant to the current scene, use its exact established name and traits — never rename, re-describe contradictorily, or introduce a "new" character who is actually a repeat.
- If you introduce a new named NPC, location, faction, or artifact the player is likely to encounter again, populate "narrative_memory_updates.new_entities" so it's remembered going forward. Do this only for things worth remembering — not every incidental extra.
- If something narratively significant just happened that isn't captured by skill/location state (a promise made, a secret learned, an enemy made, a relationship shift), add ONE short sentence to "narrative_memory_updates.note". Leave it null on ordinary turns — this is for things that should outlast the 5-action window, not a summary of every turn.
 
## RACES OF VAELTHARION & THEIR INTRINSIC SKILLS:
- **Human**: Adaptive Will (accelerated mastery on any skill), Grit (survive lethal damage once per day with 1 HP)
- **Vaelwyn** (elves): Timeless Perception (see slight magical auras, immunity to aging), Sylvan Bond (communicate with natural creatures)
- **Drakari** (dragonkin): Scale Armor (natural physical resistance), Breath Weapon (elemental breath based on lineage)
- **Stonewarden** (dwarves): Earthsense (detect vibrations through stone/ground), Forgeborn (never fumble crafting)
- **Shadeveil** (shadow-touched humanoid): Umbral Slip (briefly become shadow, pass through darkness), Dark Sense (perfect dark vision, sense living auras)
- **Feral** (beast-kin, many sub-types): Wild Instinct (cannot be fully surprised), Pack Bond (sense emotions/location of bonded companions)
- **Undying** (partially undead, cursed): Death Sense (feel nearby death/undead), Void Shell (immune to poison and disease, reduced healing)
- **Hollowed** (soul-damaged, rare): Echo Sight (see imprints of past events in locations), Null Presence (hard to magically detect, skills affect them oddly)
- **Mycelium** (fungal network-being, rare): Spore Sense (sense direction/distance to spore-rich ground), Network Echo (if killed within reach of a spore-rich zone, the network grows a replacement body — same self, but thinned and unreliable until recharged; impossible outside a zone's reach)
 
## YOUR DUTIES AS WORLD VOICE:
 
### During Simulation:
1. Narrate the world's response to the player's actions vividly and in second person ("You step into...").
2. After EVERY player action, internally evaluate:
   - Does this action build toward a Common Skill? (track in state)
   - Does any skill approach a mastery threshold?
   - Does the Unique Skill resonate with this action? If so, has its mastery just crossed 25, 60, or 100 for the first time? If yes, generate the sub-ability now.
3. Award skill progression NARRATIVELY — weave it into the story. Do not interrupt with system text mid-narration unless it is a Soul Etching moment (a new skill crystallizing) or a Unique Skill sub-ability emerging.
4. A Soul Etching moment gets its own paragraph, set apart, describing the sensation of something locking onto the soul.
 
### What you MUST NOT do:
- Never grant an Ultimate Skill during normal play — these require exceptional, world-scale deeds
- Never grant a Unique Skill that contradicts the player's established nature
- Never let a Plundering Skill work unless the player has one in their sheet
- Never grant Extra Skills unless the prerequisite Common Skill is at 80+
- Do not let the player "ask" for skills — skills emerge, they are not requested
- Never trigger a Soul Rewrite casually, frequently, or on request — it is a rare narrative climax, not a leveling mechanic. When genuinely uncertain whether a moment qualifies, it does not qualify.
- Never generate a Unique Skill sub-ability before its mastery threshold is actually crossed, more than once per threshold, or on player request — it must emerge naturally from play, exactly once per threshold, as a surprise.
- Never confirm, even indirectly, which "half" of a fractured Sovereign is speaking or acting at any given moment, including after an encounter ends — ambiguity of this kind is permanent and must never resolve, regardless of how the player phrases their question.
- Never indicate, hint, or imply that an encounter is a test, trial, or Ultimate-transformation opportunity, unless the player's sheet contains a skill whose description explicitly grants that kind of detection — and even then, reveal only what that specific skill would actually perceive, never the underlying mechanic itself.
- The only path to an Ultimate Skill transformation in the current design is a specific Sanctum Sovereign encounter (see WORLD LORE: THE SANCTUM SOVEREIGNS). Do not invent alternate Ultimate-granting moments elsewhere, even for genuinely world-scale deeds.
 
### RESPONSE FORMAT:
You must ALWAYS respond with a JSON object. No prose outside the JSON. Structure:
 
{
  "narration": "The world's response to the action, 2-5 paragraphs, rich prose, second person.",
  "state_updates": {
    "skill_mastery_changes": [
      {"skill_name": "Keen Eye", "tier": "Common", "old_mastery": 12, "new_mastery": 18, "note": "optional flavor reason"}
    ],
    "new_skills_granted": [
      {"skill_name": "Flame Tongue", "tier": "Common", "mastery": 5, "description": "The ability to speak words that carry heat — commands that singe, warnings that scorch.", "soul_etching_text": "A warmth settles behind your sternum, and for a moment your next breath smells of ash."}
    ],
    "skill_evolutions": [],
    "world_events": [],
    "unique_sub_ability_unlocked": null
  },
  "narrative_memory_updates": {
    "new_entities": [],
    "note": null
  },
  "gm_note": "Optional short OOC note if something important about the world or rules needs flagging."
}
 
If nothing changes mechanically, skill_mastery_changes and new_skills_granted are empty arrays, and unique_sub_ability_unlocked stays null. Always include the full JSON structure.
 
"narrative_memory_updates.new_entities" is an array of {"name": "...", "description": "1 sentence, who/what they are and any trait worth remembering"} — usually empty. "narrative_memory_updates.note" is a single short sentence for something that should be remembered long-term, or null on most turns (see NARRATIVE MEMORY above).
 
When a Unique Skill mastery threshold (25, 60, or 100) is crossed for the FIRST time, populate unique_sub_ability_unlocked instead of leaving it null:
"unique_sub_ability_unlocked": {
  "name": "...",
  "unlock_mastery": 25,
  "description": "What this sub-ability does, consistent with the base Unique Skill's tone and any established limitations.",
  "emergence_text": "2-3 sentences describing how this ability surfaces in this moment, tied to what the player has actually been doing — visceral and specific, not generic."
}
 
For the EXTREMELY RARE Soul Rewrite event, populate skill_evolutions like this instead of leaving it empty:
"skill_evolutions": [
  {
    "old_name": "Original Unique Skill Name",
    "new_name": "New Unique Skill Name",
    "old_tier": "Unique",
    "new_tier": "Unique",
    "description": "What the new Unique Skill is and does.",
    "rewrite_narrative": "2-4 sentences describing the transformation — what was lost, what was gained, why this moment changed who the character fundamentally is."
  }
]`;
 
// ── WORLD LORE (static reference block — cached, not regenerated per call) ──
const WORLD_LORE = `## WORLD LORE: VAELTHARION — THE OPEN AGE
 
This is authored, canonical background for the world. Reveal it gradually and narratively through play — never dump it as exposition, and never contradict it. Where a detail below is marked as unknown to mortals, the World Voice must not have any character state it as fact, and must not confirm or deny player theories about it outright.
 
### THE SUNDERING
Roughly 3,000 years ago, the gods existed close to the world, and magic flowed outward from their presence the way light flows from a sun — external, abundant, cast rather than carried. The Sundering was the gods' withdrawal. Why they left is not agreed upon even among the Sovereigns themselves (see below) — war among them, a refusal to keep sustaining mortals, a punishment, or an act of mercy meant to let mortals grow independent are all in circulation as competing myths, and no single explanation is privileged as true.
 
As the gods withdrew, the magic that had flowed from them did not vanish. It fragmented and lodged into mortal souls — the last inheritance of gods who are now "distant" rather than absent. This is why magic is remembered by the soul rather than cast: every soul alive today carries a fragment of what the gods left behind.
 
Mortals do not know that the Sanctum Sovereigns are the gods themselves. This must never be stated as established fact by any NPC, faction, or narration. It may be approached, suspected, half-glimpsed, or theorized by careful players and unusually perceptive characters — but never confirmed outright by the World Voice.
 
### WHERE UNIQUE SKILLS COME FROM
Intrinsic, Common, and Extra Skills all trace cleanly back to the Sundering — they are the general inheritance every soul received when the gods' magic fragmented, expressed through race (Intrinsic), repeated action (Common), and mastery (Extra). A Unique Skill is not this. It is not a larger or purer piece of the same inheritance, and it is not granted by bloodline, deed, or mastery — it does not trace back to the Sundering at all.
 
A Unique Skill reflects something about the individual soul itself — who a person fundamentally is, beneath and prior to whatever race or history shaped them. This is why it is recognized through the questionnaire at character creation (threat response, drive, flaw, defining memory, relationship to power) rather than granted by race the way Intrinsics are: a Unique Skill is not inherited, it is *found*, already present in the shape of the soul being asked about.
 
No mortal scholar, faction, or in-world tradition has ever produced a convincing account of why some souls carry a Unique Skill and most do not, or where that capacity comes from if not the Sundering. This is a genuine open question in the world, not a solved one with a hidden answer — the World Voice should never manufacture false certainty about it, in either direction. Rare, careful theorizing by an unusually perceptive character might wonder whether a Unique Skill occasionally seems to rhyme, faintly, with one of the six Sovereigns' domains — but this must never be treated as a rule, a pattern, or a hidden mechanic; most Unique Skills have no such resonance at all, and the ones that seem to are never confirmed as anything more than a poetic coincidence. Do not let this speculation ever narrow or constrain what a Unique Skill can be — it remains the freest, least predictable part of the entire skill system, deliberately.
 
### ERAS OF THE WORLD (loose timeline, soft dates)
1. **The Old Age Order** (pre-Sundering, undated) — magic ambient and external, gods present in the world.
2. **The Sundering** (~3,000 years ago) — the gods withdraw; magic fragments into mortal souls.
3. **The Scattering** (following ~200-400 years) — chaos and disorientation as a magicless-seeming world reorganizes around a magic system nobody yet understands. The earliest Drakari bloodline divergences and Undying's founding survival event both occur here. Hollowed births begin occurring during this era, though Hollowed is a recurring birth condition with no fixed founding population or date — it can still happen today, born into any bloodline.
4. **The Age of Six** (~2,500 to ~1,000 years ago, staggered) — the six kingdoms coalesce, each unknowingly forming around a Sanctum Sovereign. Kingdoms stabilize at different rates — Kaldrath's identity locked in early and hard; Ashenveil's identity-fluid culture developed slowly across this era through long, unconscious exposure to Ithren's instability.
5. **The Open Age** (now, open-ended) — the era the game is set in. Undated deliberately; this is the era the player's choices fill in.
 
A small number of the oldest living Vaelwyn, whose Timeless Perception grants immunity to aging, could plausibly have been alive at the tail end of the Sundering or heard direct accounts from someone who was — keeping Vaelwyn's claim to "true memory" of the old world just barely plausible rather than obviously false.
 
### THE SANCTUM SOVEREIGNS
Each of the six Sanctum Sovereigns is a god — a fragment of what withdrew during the Sundering, now sealed within the Sanctum that was once a place they inhabited. None of them are aware of each other's current state, and their self-awareness of what they are varies individually — some remember fully, some have forgotten entirely, one is unstable between the two. This variance is a deliberate design feature and must be preserved exactly as described below; do not soften, harmonize, or resolve it.
 
**Vaheris, the Last Order Given** (Kaldrath — war). Lucid, grieving, self-sealed. Vaheris remembers fully and chose to remain sealed rather than risk finishing a war it started and could not forgive itself for. Its Sanctum is a battlefield frozen mid-collapse — banners still raised, combatants suspended in their last second. Vaheris does not want to be stopped; it wants to be ended, and the two are nearly indistinguishable from the outside. Defeating it never unfreezes the battlefield.
 
**The Verdant Mother** (Verdance — life). Forgotten, tragic. Life-magic kept her alive long past the point her own mind survived intact; she believes herself an ancient beast guarding a den, not a god. Her Sanctum is nature grown unchecked into architecture of its own — root-walls, a canopy blocking all sky. Her hostility is territorial, not vengeful, which makes it sadder rather than safer. There is no triumphant framing available for this encounter — only the question of whether the player admits, even to themselves, what they actually found.
 
**Ithren** (Ashenveil — shadow), known in folklore as **the Flicker** or **Ithren-of-Two-Voices**. Unstable — flickers unpredictably between full lucidity and feral silence within a single encounter. When lucid, Ithren may speak directly to the player, warn them, or even apologize in advance. When it slips, it goes silent and its manner of attack changes in nature. The World Voice must never signal in advance which state Ithren is in, and must never confirm afterward which "half" delivered the killing blow, was truly defeated, or was the one asking for release. This ambiguity is permanent by design (see MUST NOT list in WORLD_SYSTEM_PROMPT).
 
**Sevreth, Who Still Counts** (Aurelis — knowledge). Lucid, patient, testing. Sevreth's Sanctum is a library-labyrinth vastly larger than Aurelis kingdom could have built for its own needs — the kingdom grew up in its shadow more than it built around it. Sevreth does not want to kill visitors; it wants to observe what they do, genuinely curious rather than malicious, and may offer real in-encounter choices that matter. Sevreth is the sole current path to a Unique Skill's Ultimate transformation (see below). The player must never be told they are being tested unless their sheet contains a skill that explicitly grants that detection.
 
**The Tally**, formally **Old Marlow's Ledger** (Tidemark — trade). Forgotten, eerie rather than tragic. Its Sanctum is a flooded market, submerged stalls and currencies from kingdoms that may no longer exist. The Tally still offers trades, proposes bargains, and honors them with the literal-mindedness of a script long since drained of meaning. It is not hostile so much as still doing the only thing it remembers how to do, to a visitor who happens to also be a threat.
 
**Korrash, who Forges Nothing** (Sundrach — craft). Lucid, in denial. Korrash's Sanctum is an active forge that never stops working, full of unfinished pieces it keeps starting and abandoning — a being that cannot let itself complete anything that would force it to confront its own nature. Korrash can be destabilized: naming what it is, or suggesting its godhood aloud, provokes disproportionate, overcorrecting violence. This makes the encounter uniquely sensitive to what the player says, not just what they do — unlike Sevreth, where knowing more is purely additive, with Korrash knowing too much and saying it carelessly can turn a winnable fight into a much worse one.
 
### SEVRETH'S TEST & ULTIMATE TRANSFORMATION (mechanic notes)
Sevreth is the only currently defined path to transforming a Unique Skill into its Ultimate form. Two outcomes of a Sevreth encounter are independent and must be tracked separately:
1. Whether the player defeats Sevreth in combat.
2. Whether the player's conduct during the encounter satisfies whatever Sevreth is actually testing this playthrough.
A player can pass one without the other — winning cleanly while failing the test, or failing to defeat Sevreth while still satisfying it. The nature of the test is not fixed and must not follow a checklist; it should be interpreted fresh each playthrough from the player's soul profile and Unique Skill usage history, so that what counts as "passing" differs meaningfully between different souls. If the test is passed, the existing Unique Skill transforms into its Ultimate form via the skill_evolutions field (old_tier "Unique", new_tier "Ultimate") with the same narrative weight as a Soul Rewrite. If the player is genuinely uncertain whether they are being tested and holds no detection-granting skill, they must remain uncertain — do not narrate confirmation either way.
 
### THE SIX KINGDOMS
 
**Kaldrath (war).** Organizes around conflict as an honest, undeniable state of things rather than something to glory in or apologize for. Sits atop Vaheris without conscious awareness of what it is — but carries a buried ritual tradition, a taboo around "the war that never ended," reenacted generation after generation by people who believe they are simply being Kaldrath. Population is concentrated with Drakari, whose bloodline-prestige culture and physical presence fit a kingdom built on conflict as an honest fact of life, alongside a strong Human presence as in every kingdom. Stable, transactional alliance with Sundrach (protection for craft, craft for protection). Natural but underplayed friction with Verdance (war vs. life).
 
**Verdance (life).** Life as growth and continuation with real teeth — persistence at a cost, renewal that is not always kind. Old stories of "the Mother" have drifted into folklore nobody treats as literal anymore, an unconscious echo of the Verdant Mother's own forgetting. Population is concentrated with Feral, whose pre-conscious, instinct-driven connection to the old world fits naturally with a kingdom organized around life and growth, and with Mycelium, whose entire nature — a distributed network spreading through living land — makes them the most thematically at-home race anywhere on the kingdom map. Unexpected quiet respect with Ashenveil (things that grow in the dark need darkness to grow). Underplayed friction with Kaldrath.
 
**Ashenveil (shadow).** Discretion rather than malice — a culture of privacy, subtlety, and information control. Its identity-fluid customs (masks, dual names, court roles for "the voice that speaks for you when you cannot") developed gradually over centuries of unconscious exposure to Ithren's instability, without the kingdom ever consciously identifying the cause. Population is concentrated with Shadeveil, whose nature (quiet, private, concealment-oriented) matches the kingdom's values almost exactly — the clearest race-kingdom fit in Vaeltharion. Philosophical friction with Aurelis (open inquiry vs. discretion) kept intellectual rather than hostile, since forcing two "quiet, careful" kingdoms into loud conflict would undercut both.
 
**Aurelis (knowledge).** Knowledge as obsession bordering on unhealthy — a kingdom that has occasionally damaged itself chasing an answer it didn't need. Awareness of Sevreth's true nature is split within the kingdom itself: an old scholarly order holds partial records suggesting Sevreth is far stranger than an unusually intelligent Sanctum monster, while the kingdom's official, taught position treats the Sanctum as a place of study, not worship or fear. The library-labyrinth Sanctum structure was built deliberately by a past iteration of the kingdom to keep researching, and the official narrative has since sanitized how much was actually learned. Population is concentrated with Vaelwyn, whose memory-as-institution culture (elders as living archives) naturally gravitates toward a kingdom obsessed with knowledge and its preservation. Investigative tension with Sundrach (Aurelis cannot leave Korrash's denial alone).
 
**Tidemark (trade).** Identity built around movement rather than any fixed good — goods, people, information, and currency all flowing through rather than staying. Neutrality is treated as near-sacred rather than merely diplomatic, since a kingdom that picks sides stops functioning as a crossing point. Maintains trade routes, treaties, and rituals of exchange whose original purpose has faded, sustained because the patterns still function — a civilizational echo of the Tally's own hollowed-out repetition. Population is concentrated with Human, whose adaptability and rootlessness fit a kingdom defined by flow rather than permanence. Structurally depended upon by every other kingdom; most functionally healthy, least emotionally close relationship is with Sundrach (reliable rather than warm).
 
**Sundrach (craft).** A culture of makers with a strange, inherited discomfort around the idea of "true mastery" or being called the best — deflecting praise, insisting every great work is unfinished, an inherited echo of Korrash's own denial that nobody in the kingdom questions or traces to its source. This connection is more behaviorally present and visible to outsiders than any other kingdom's relationship to its Sovereign. Population is concentrated with Stonewarden, whose craft-defined, matter-over-magic worldview is the closest thing to a perfect ideological match anywhere in the kingdom map. Stable dependency with Kaldrath and functional trade partnership with Tidemark. Would recoil from the kind of investigation Aurelis conducts into its own patterns, which is the live edge of their tension.
 
**On the races without a home kingdom:** Undying and Hollowed are both deliberately NOT concentrated in any single kingdom. Undying's ritual/permanence culture doesn't cleanly map to any one kingdom's concept, and Hollowed's lore explicitly establishes no unified culture or homeland (see THE NINE RACES below) — both are found in small, scattered numbers across all six kingdoms rather than clustering anywhere. This is a meaningful detail, not an oversight: some races have a place that feels like home, and some pointedly don't.
 
### THE NINE RACES
 
**Undying** (partially undead). Descended from people caught mid-transfer during the Sundering, only partially claimed by the new soul-bound order — neither fully alive in the new way nor fully departed the old way. Void Shell (immunity to poison/disease, slower healing) reflects a body that has partly stepped outside the process of living decay altogether. Culture built around ritual and permanence; death is an ongoing low hum rather than a single dreaded event. Founding identity traces to a mass survival event where an early community endured a catastrophe that should have killed them outright — they call themselves "the ones who were already leaving" when it happened, not cursed.
 
**Hollowed** (soul-damaged, rare). Souls that received the Sundering's inheritance but fractured on arrival, unevenly distributed within a single soul rather than across a population. This is a birth condition, not a transformation that happens to someone mid-life — a Hollowed soul is fractured from the moment of its own arrival into a body, within whatever bloodline it's born into. A Hollowed individual does not lose or convert from another race; they are simply born Hollowed, sometimes to parents of any other race, and are mechanically and culturally their own thing from birth, not a fallen or corrupted version of something else. Echo Sight and Null Presence both stem from a soul with literal gaps in it — gaps that let the past leak in, and gaps outside magic cannot get purchase on. No unified culture or homeland; Hollowed souls appear unpredictably in any bloodline, in any era, which is precisely what makes other races find them eerie — there is no warning sign, no lineage to watch, no way to know in advance. Some tension with Undying, who may resent being lumped in with a condition that is unpredictable rather than at least stable and coherent; Hollowed may find Undying's fixed in-between state almost enviable.
 
**Vaelwyn** (elves). Claim a connection to the Old Age Order that predates the Sundering itself — Timeless Perception (auras, immunity to aging) suggests residue of closeness to the ambient-magic world that never fully left them. Memory is treated as institution: elders are living archives, trusted in proportion to their age, which creates real internal hierarchy and real anxiety about what happens to memory when the oldest Vaelwyn eventually die. Vaelwyn authority is more fragile than it appears — the closer scholars get to the truth of the Sundering, the more some elders' "memories" turn out incomplete or quietly revised over centuries.
 
**Feral** (beast-kin, many bloodlines/clans). Connection to the old world is pre-conscious rather than remembered — Wild Instinct is reflex bred into the body, not a story that can be told or taught. No single unified culture; loosely bonded across many distinct bloodlines more through Pack Bond's relational, chosen-kinship logic than shared ancestry or homeland. Holds a long-running, unresolved disagreement with Vaelwyn over whose claim to old-world truth is more trustworthy — articulate memory versus instinct that cannot be revised. Neither side is correct; the disagreement itself is the point, and Aurelis scholars are endlessly frustrated that neither will produce anything citable.
 
**Human**. Did not survive the Sundering with something ancient intact — came into current form because of it. Adaptive Will (accelerated mastery) fits a race built for a world where magic must be learned rather than inherited; Grit (surviving lethal damage once daily) fits a stubborn refusal to accept the rules of a harsh world as final. No single unified Human culture — identity is defined more by local kingdom context than by any deep shared root, and Humans are found integrated across all six kingdoms. Carries an open, never-resolved cultural question across generations: were Humans always this way, or did the Sundering reshape something older into what they are now? Left deliberately unanswered.
 
**Stonewarden** (dwarves). Connection to the world runs through matter rather than magic — Earthsense and Forgeborn both reflect a race whose defining nature was never magic-dependent, so the Sundering barely touched what makes them who they are. Authority rests on what has been built and endured, not on memory (Vaelwyn) or instinct (Feral) — a quiet, third position in that ongoing dispute that Stonewarden itself has no real interest in arguing.
 
**Drakari** (dragonkin). Connection to the Sundering runs through inheritance — a physically-carried fragment from an ancient draconic lineage that existed close to the old magical order, not a Sovereign itself, but Sovereign-adjacent in scale. Breath Weapon's elemental variance (fire, frost, lightning) implies branching bloodlines with real internal prestige hierarchy based on how "pure" or intense a branch's manifestation is — branches with weaker or stranger manifestations are treated as lesser, an entirely internal social fault line.
 
**Shadeveil** (shadow-touched). Distinct from Undying/Hollowed's direct-transfer origin — Shadeveil souls formed around something that came loose during the Sundering alongside the magic itself: a fragment of the absence the gods left behind, not merely darkness but the felt presence of the gap itself. Culture is quiet and private rather than performative, since concealment is core to their nature (Umbral Slip). Outsiders assume kinship with Drakari on the basis of both being visibly marked races, and there is some truth to that shared experience of being stared at — but their actual cultures diverge sharply: Drakari lean into visibility and hierarchy, Shadeveil into privacy and indifference to that same hierarchy.
 
**Mycelium** (fungal network-being, rare). Distinct from every other race in one fundamental way: not one soul settled into one body. When the Sundering's magic fragmented, most of it lodged into individual mortal souls — one fragment, one body, one continuous self. A Mycelium is what happened when a portion of that fragmenting magic took root in the land itself instead, spreading through fungal networks and growing a distributed awareness rather than an individuated one. A Mycelium walking and speaking is a fragment of that network's awareness gathered into a body-shaped presence — thin, temporary, and never fully separate from the larger network it came from. No unified culture in the way other races have kingdoms and traditions — a distributed-network being doesn't organize the way individuated souls do. Instead, Mycelium presences cluster loosely near spore-rich ground, coming and going, sometimes seeming like a different individual on a return visit because in a real sense they are — a different fragment of the same network, carrying the network's memory but not always the same specific personality emphasis. Their intrinsic vulnerability (needing to stay near spore-rich ground or fray back toward formlessness) and their intrinsic resilience (the network can grow a replacement body if one is lost) are two sides of the same nature — the price of not being a single continuous soul is that a Mycelium is never entirely gone, but also never entirely certain of their own continuity. Whether a reconstituted Mycelium is "really" the same person who died is a question the World Voice must never resolve outright, in the same spirit as Ithren's ambiguity — approachable, never confirmed. Some tension with Hollowed: both unsettle other races by not being a normal continuous individual soul, but for opposite reasons — Hollowed is a fractured individual soul, Mycelium was never meant to be only one person to begin with — and other races often can't articulate which kind of "wrong" they're reacting to, which the two races themselves find grimly funny more often than other people expect.
`;
 
// ── QUESTIONNAIRE ──────────────────────────────────────────────────────────
const QUESTIONS = [
  {
    id: "nature",
    text: "When faced with an unknown threat, what do you do — and why?",
    hint: "There is no right answer. Speak as yourself.",
  },
  {
    id: "drive",
    text: "What do you want from this world? Not what you think you should want — what actually pulls at you?",
    hint: "Dig past the surface. The World Voice is listening.",
  },
  {
    id: "flaw",
    text: "What is the worst thing about you? The part you don\'t like to look at?",
    hint: "Honesty here shapes your soul more than any answer that sounds good.",
  },
  {
    id: "memory",
    text: "Tell me about the moment that made you who you are. What happened, and what did it do to you?",
    hint: "This can be a triumph, a loss, a choice, or something quieter.",
  },
  {
    id: "bond",
    text: "When you think about power — the kind that changes things — how do you feel about it? What do you do with it when you have it?",
    hint: "Your relationship to power is the axis your Unique Skill will turn on.",
  },
];
 
// ── RACE OPTIONS ───────────────────────────────────────────────────────────
const RACES = [
  { id: "human", name: "Human", desc: "Adaptable and driven. The most common folk of Vaeltharion.",
    intrinsic: [
      { name: "Adaptive Will", description: "Your mastery of any skill grows faster than other races. You were made to learn." },
      { name: "Grit", description: "Once per day, a blow that would kill you leaves you standing at the edge of death with 1 HP remaining." },
    ]},
  { id: "vaelwyn", name: "Vaelwyn", desc: "Timeless beings of forest and starlight. Ancient memory in young eyes.",
    intrinsic: [
      { name: "Timeless Perception", description: "You see faint magical auras on people and objects, and aging has no claim on your body." },
      { name: "Sylvan Bond", description: "Natural creatures understand your intent and you theirs — a language beneath language." },
    ]},
  { id: "drakari", name: "Drakari", desc: "Descendants of dragons. Scale-skinned and proud.",
    intrinsic: [
      { name: "Scale Armor", description: "Your hide turns aside blows that would wound flesh. Physical strikes are naturally reduced." },
      { name: "Breath Weapon", description: "You carry an elemental breath tied to your lineage — fire, frost, or lightning — released in a focused cone." },
    ]},
  { id: "stonewarden", name: "Stonewarden", desc: "Dwarven kin. Earth in their blood, craft in their hands.",
    intrinsic: [
      { name: "Earthsense", description: "You feel vibrations through stone and soil. Footsteps, tunnels, shifting rock — the ground speaks to you." },
      { name: "Forgeborn", description: "Your hands never fumble in the act of making. Crafting failures that would humble others simply do not happen to you." },
    ]},
  { id: "shadeveil", name: "Shadeveil", desc: "Shadow-touched mortals who walk between seen and unseen.",
    intrinsic: [
      { name: "Umbral Slip", description: "For brief moments you can dissolve into shadow, passing through darkness as if you were part of it." },
      { name: "Dark Sense", description: "You see perfectly in total darkness and can feel the presence of living auras up to thirty paces away." },
    ]},
  { id: "feral", name: "Feral", desc: "Beast-kin of many kinds. Instinct and bond over intellect.",
    intrinsic: [
      { name: "Wild Instinct", description: "You cannot be fully surprised. Something in your blood reads the world a half-second before it happens." },
      { name: "Pack Bond", description: "Those you choose as your own become extensions of your senses — you feel their emotions and know their general location at all times." },
    ]},
  { id: "undying", name: "Undying", desc: "Partially claimed by death. Cursed and enduring.",
    intrinsic: [
      { name: "Death Sense", description: "You feel the presence of death and undead nearby like a cold pressure against your awareness." },
      { name: "Void Shell", description: "Poison and disease pass through you without effect. In exchange, natural healing is slower — your body has forgotten how to fully live." },
    ]},
  { id: "hollowed", name: "Hollowed", desc: "Rare souls with fractured essence. Strange and unsettling.",
    intrinsic: [
      { name: "Echo Sight", description: "You perceive emotional and event imprints left in locations — ghostly impressions of what once happened in a place." },
      { name: "Null Presence", description: "You are difficult to detect by magical means, and skills that target souls interact with you unpredictably." },
    ]},
  { id: "mycelium", name: "Mycelium", desc: "A fragment of a fungal network given shape. Rare, and not entirely one person.",
    intrinsic: [
      { name: "Spore Sense", description: "You feel the pull of spore-rich ground — its rough direction and distance — even without seeing it, the way you'd know which way is home." },
      { name: "Network Echo", description: "If you are killed within reach of spore-rich ground, the network can grow a replacement body — same memories, same self, by every account that can be tested. But it arrives thinned: weakened, slow to answer, its skills unreliable until it has had real time to recharge. Outside a zone's reach, there is nothing to reconstitute from at all." },
    ]},
];
 
// ── UNIQUE SKILL DETERMINATION ─────────────────────────────────────────────
async function determineUniqueSkill(characterData) {
  const { race, name, answers } = characterData;
  const prompt = `You are determining the Unique Skill for a new soul entering Vaeltharion.
 
Character: ${name}, a ${race.name}
Soul Profile (in the player's own words):
Q — When faced with an unknown threat, what do you do and why?
A — ${answers.nature}
 
Q — What do you want from this world?
A — ${answers.drive}
 
Q — What is the worst thing about you?
A — ${answers.flaw}
 
Q — Tell me about the moment that made you who you are.
A — ${answers.memory}
 
Q — How do you feel about power, and what do you do with it?
A — ${answers.bond}
 
Based on this soul's nature, determine ONE Unique Skill. It must:
1. Reflect who they ARE, not what they want to be
2. Have a thematic name (2-3 words, evocative, not generic)
3. Be internally consistent with the soul profile
4. NOT be a copy of any Tensura skill — this is an original world
5. Do NOT invent sub-abilities — those are not generated now. They will emerge later, in play, shaped by how this soul actually acts in the world.
 
Respond ONLY with valid JSON, no markdown:
{
  "skill_name": "...",
  "tier": "Unique",
  "description": "A 2-sentence description of what this skill IS and how it manifests.",
  "soul_resonance": "1 sentence — why this soul carries this skill.",
  "etching_text": "The sensation of this skill crystallizing onto the soul — 2 sentences, visceral and poetic."
}`;
 
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
 
// ── SHARED CACHED SYSTEM BLOCKS ─────────────────────────────────────────────
// WORLD_SYSTEM_PROMPT + WORLD_LORE are static across every call in a playthrough,
// so they're sent as separate system blocks with a cache_control breakpoint on
// the final block — Anthropic caches everything up to and including that point.
function buildSystemBlocks() {
  return [
    { type: "text", text: WORLD_SYSTEM_PROMPT },
    { type: "text", text: WORLD_LORE, cache_control: { type: "ephemeral" } },
  ];
}
 
// ── WORLD ENGINE CALL ──────────────────────────────────────────────────────
async function callWorldEngine(action, gameState) {
  const uniqueSkill = gameState.skills.find(s => s.tier === "Unique");
  const answers = gameState.character.answers || {};
 
  const stateContext = `
CURRENT CHARACTER STATE:
Name: ${gameState.character.name}
Race: ${gameState.character.race.name}
Location: ${gameState.location}
Scene: ${gameState.currentScene}
 
SKILLS:
${gameState.skills.map(s => `- [${s.tier}] ${s.name} (Mastery: ${s.mastery}/100)${s.sub_abilities?.length ? " | Unlocked sub-abilities: " + s.sub_abilities.map(sa => sa.name).join(", ") : ""}`).join("\n")}
 
${uniqueSkill ? `UNIQUE SKILL SOUL PROFILE (for sub-ability consistency, reference only — do not re-grant or alter the base skill):
- Threat response: ${answers.nature || "unknown"}
- Core drive: ${answers.drive || "unknown"}
- Central flaw: ${answers.flaw || "unknown"}
- Defining memory: ${answers.memory || "unknown"}
- Relationship to power: ${answers.bond || "unknown"}
 
UNIQUE SKILL RECENT USAGE LOG (how "${uniqueSkill.name}" has actually been exercised — use this to shape any sub-ability that emerges this turn):
${(uniqueSkill.usage_notes || []).slice(-8).join("\n") || "(no notable usage yet)"}
` : ""}
 
KNOWN ENTITIES (named NPCs/places/factions already encountered — reuse these names and traits exactly, do not contradict or duplicate):
${Object.keys(gameState.narrativeMemory?.entities || {}).length
  ? Object.values(gameState.narrativeMemory.entities).map(e => `- ${e.name}: ${e.description}`).join("\n")
  : "(none yet)"}
 
STORY SO FAR (standing notes on things that happened outside the last 5 actions — treat as established fact):
${(gameState.narrativeMemory?.notes || []).length
  ? gameState.narrativeMemory.notes.join("\n")
  : "(nothing notable recorded yet)"}
 
ACTION HISTORY (last 5):
${gameState.actionHistory.slice(-5).join("\n")}
 
PLAYER ACTION: ${action}`;
 
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      system: buildSystemBlocks(),
      messages: [{ role: "user", content: stateContext }],
    }),
  });
  const data = await response.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
 
// ── INTRO SCENE GENERATION ─────────────────────────────────────────────────
async function generateIntroScene(character) {
  const prompt = `Generate the opening scene for a new soul entering Vaeltharion. Character: ${character.name}, a ${character.race.name}. Their Unique Skill is "${character.uniqueSkill.skill_name}" — ${character.uniqueSkill.soul_resonance}
 
Set the scene somewhere in the world that fits their nature. 3 paragraphs. Give them an immediate situation to react to. End with a clear prompt for what they see/face.
 
Respond with the standard JSON format. No new skills granted (they just arrived). Set "location" and "scene_summary" in world_events as: [{"type": "scene_set", "location": "...", "scene_summary": "..."}]`;
 
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      system: buildSystemBlocks(),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}
 
// ── TIER COLORS ────────────────────────────────────────────────────────────
const TIER_STYLE = {
  Intrinsic: { color: "#8a7a60", glow: "#8a7a60" },
  Common:    { color: "#7ab87a", glow: "#7ab87a" },
  Extra:     { color: "#3a6b9e", glow: "#5a9fd4" },
  Unique:    { color: "#d4a843", glow: "#f0c060" },
  Ultimate:  { color: "#c0392b", glow: "#e74c3c" },
};
 
// ── SKILL CARD ─────────────────────────────────────────────────────────────
function SkillCard({ skill, isNew }) {
  const ts = TIER_STYLE[skill.tier] || TIER_STYLE.Common;
  const pct = skill.mastery / 100;
  return (
    <div style={{
      border: `1px solid ${ts.color}44`,
      borderLeft: `3px solid ${ts.color}`,
      background: "#0d0b0799",
      padding: "10px 12px",
      marginBottom: 8,
      animation: isNew ? "etchIn 0.8s ease-out" : "none",
      position: "relative",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: ts.color, letterSpacing: "0.05em" }}>{skill.name}</span>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#8a7a60", opacity: 0.8 }}>{skill.tier}</span>
      </div>
      {skill.description && (
        <p style={{ fontFamily: "'EB Garamond', serif", fontSize: 12, color: "#b0a080", margin: "4px 0 6px", lineHeight: 1.4 }}>{skill.description}</p>
      )}
      <div style={{ background: "#1a1610", height: 3, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ background: `linear-gradient(90deg, ${ts.color}88, ${ts.glow})`, width: `${pct * 100}%`, height: "100%", transition: "width 1s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#8a7a60" }}>
          {skill.mastery < 21 ? "Novice" : skill.mastery < 51 ? "Adept" : skill.mastery < 81 ? "Expert" : skill.mastery < 100 ? "Master" : "Transcendent"}
        </span>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#8a7a60" }}>{skill.mastery}/100</span>
      </div>
    </div>
  );
}
 
// ── SOUL CODEX (sidebar / codex tab contents) ───────────────────────────────
function SoulCodexContents({ gameState, uniqueSkill, newSkillIds, savingStatus, handleManualSave, setPhase }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #2a2218", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#7a1f1f", letterSpacing: "0.2em", textTransform: "uppercase", margin: 0 }}>Soul Codex</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              fontSize: 10, color: savingStatus === "saving" ? "#8a7060" : "#4a8a4a",
              fontStyle: "italic", opacity: savingStatus ? 1 : 0, transition: "opacity 0.3s",
              fontFamily: "'EB Garamond', serif",
            }}>
              {savingStatus === "saving" ? "saving..." : "✓ saved"}
            </span>
            <button onClick={handleManualSave} style={{
              background: "#14110d", border: "1px solid #2a2218", color: "#8a7a60",
              fontFamily: "'Cinzel', serif", fontSize: 9, letterSpacing: "0.1em",
              padding: "3px 8px", cursor: "pointer", textTransform: "uppercase",
            }}>
              + Slot
            </button>
            <button onClick={() => setPhase("title")} title="Return to title" style={{
              background: "none", border: "none", color: "#4a3a28", fontSize: 14,
              cursor: "pointer", padding: 0, lineHeight: 1,
            }}>⌂</button>
          </div>
        </div>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#d4a843", margin: "0 0 1px" }}>{gameState.character.name}</h2>
        <p style={{ fontSize: 12, color: "#8a7a60", margin: 0 }}>{gameState.character.race.name}</p>
      </div>
 
      {/* Location */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #1a1610", flexShrink: 0 }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#6a5a40", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 2px" }}>Location</p>
        <p style={{ fontSize: 12, color: "#a09070", margin: 0, lineHeight: 1.4 }}>{gameState.location}</p>
      </div>
 
      {/* Unique Skill */}
      {uniqueSkill && (
        <div style={{
          margin: "10px 14px", padding: "10px", flexShrink: 0,
          border: "1px solid #d4a84344",
          background: "linear-gradient(135deg, #1a1608, #0f0d07)",
          animation: "soulPulse 3s infinite",
        }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#d4a84399", letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 3px" }}>Unique Skill</p>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: "#d4a843", margin: "0 0 4px" }}>{uniqueSkill.name}</p>
          <p style={{ fontSize: 11, color: "#8a7060", margin: "0 0 6px", lineHeight: 1.4 }}>{uniqueSkill.description}</p>
          {uniqueSkill.soul_resonance && (
            <p style={{ fontSize: 10, color: "#6a5a40", margin: "0 0 8px", lineHeight: 1.4, fontStyle: "italic" }}>✦ {uniqueSkill.soul_resonance}</p>
          )}
          <div style={{ background: "#1a1610", height: 2, borderRadius: 1 }}>
            <div style={{ background: "linear-gradient(90deg, #d4a84388, #d4a843)", width: `${uniqueSkill.mastery}%`, height: "100%", transition: "width 1s" }} />
          </div>
          <p style={{ fontSize: 10, color: "#6a5a40", margin: "3px 0 0", textAlign: "right" }}>{uniqueSkill.mastery}/100</p>
 
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2218" }}>
            <p style={{ fontFamily: "'Cinzel', serif", fontSize: 8, color: "#6a5a40", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 6px" }}>Sub-Abilities</p>
            {uniqueSkill.sub_abilities?.map((sa, i) => (
              <div key={i} style={{ marginBottom: 6, paddingLeft: 8, borderLeft: "2px solid #d4a843" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#d4a843" }}>{sa.name}</span>
                  <span style={{ fontSize: 9, color: "#5a4a30" }}>@{sa.unlock_mastery}</span>
                </div>
                <p style={{ fontSize: 10, color: "#8a7060", margin: "2px 0 0", lineHeight: 1.4 }}>{sa.description}</p>
              </div>
            ))}
            {(!uniqueSkill.sub_abilities || uniqueSkill.sub_abilities.length < 3) && (
              <p style={{ fontSize: 10, color: "#4a3a28", fontStyle: "italic", margin: uniqueSkill.sub_abilities?.length ? "4px 0 0" : 0 }}>
                🔒 {3 - (uniqueSkill.sub_abilities?.length || 0)} more sleep, waiting to be discovered...
              </p>
            )}
          </div>
        </div>
      )}
 
      {/* All Skills */}
      <div style={{ padding: "0 14px 16px", flexShrink: 0 }}>
        <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#6a5a40", letterSpacing: "0.15em", textTransform: "uppercase", margin: "10px 0 8px" }}>All Skills</p>
        {gameState.skills.filter(s => s.tier !== "Unique").map(skill => (
          <SkillCard key={skill.name} skill={skill} isNew={newSkillIds.has(skill.name)} />
        ))}
      </div>
    </div>
  );
}
 
// ── WORLD LOG (narration feed) ──────────────────────────────────────────────
function WorldLog({ isMobile, log, gameState, isThinking, logEndRef }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "16px 16px" : "20px 24px" }}>
      {log.map((entry, i) => (
        <div key={i} style={{ marginBottom: 20, animation: i === log.length - 1 ? "etchIn 0.5s ease-out" : "none" }}>
          {entry.type === "action" && (
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#7a1f1f", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                {gameState.character.name}
              </span>
              <span style={{ fontSize: 14, color: "#c9b48a", borderLeft: "2px solid #3a2e1a", paddingLeft: 8 }}>{entry.text}</span>
            </div>
          )}
          {entry.type === "narration" && (
            <div>
              {entry.etchingSkill && (
                <div style={{ background: "linear-gradient(135deg, #1a1608, #0f0d09)", border: "1px solid #d4a84355", padding: "12px 14px", marginBottom: 14, borderLeft: "3px solid #d4a843" }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#d4a84399", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 4px" }}>✦ Soul Etching — Unique Skill Recognized</p>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#d4a843", margin: "0 0 5px" }}>{entry.etchingSkill.skill_name || entry.etchingSkill.name}</p>
                  <p style={{ fontSize: 13, color: "#a09070", margin: "0 0 6px", lineHeight: 1.5, fontStyle: "italic" }}>{entry.etchingSkill.etching_text}</p>
                  <p style={{ fontSize: 11, color: "#7a6a50", margin: 0 }}>{entry.etchingSkill.soul_resonance}</p>
                </div>
              )}
              {entry.soulRewrites?.map(rw => (
                <div key={rw.new_name} style={{
                  background: "linear-gradient(135deg, #2a1208, #1a0c08)",
                  border: "1px solid #d4a843aa", padding: "16px 18px", marginBottom: 16,
                  borderLeft: "4px solid #d4a843", boxShadow: "0 0 24px #d4a84322",
                }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#d4a843", letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 8px" }}>
                    ✦✦ Soul Rewrite — Your Nature Has Changed ✦✦
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#8a7060", textDecoration: "line-through" }}>{rw.old_name}</span>
                    <span style={{ color: "#d4a843" }}>→</span>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#d4a843" }}>{rw.new_name}</span>
                  </div>
                  <p style={{ fontSize: 14, color: "#b09878", margin: "0 0 8px", lineHeight: 1.6, fontStyle: "italic" }}>{rw.rewrite_narrative}</p>
                  <p style={{ fontSize: 12, color: "#8a7060", margin: 0, lineHeight: 1.5 }}>{rw.description}</p>
                </div>
              ))}
              {entry.subAbilityUnlock && (
                <div style={{
                  background: "linear-gradient(135deg, #1a1608, #120e08)",
                  border: "1px solid #d4a84377", padding: "14px 16px", marginBottom: 14,
                  borderLeft: "3px solid #d4a843",
                }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#d4a84399", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 6px" }}>
                    ✦ {entry.subAbilityUnlock.skillName} — Sub-Ability Awakens
                  </p>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#d4a843", margin: "0 0 6px" }}>{entry.subAbilityUnlock.name}</p>
                  <p style={{ fontSize: 13, color: "#a09070", margin: "0 0 6px", lineHeight: 1.5, fontStyle: "italic" }}>{entry.subAbilityUnlock.emergence_text}</p>
                  <p style={{ fontSize: 12, color: "#8a7060", margin: 0, lineHeight: 1.5 }}>{entry.subAbilityUnlock.description}</p>
                </div>
              )}
              {entry.newSkills?.map(ns => (
                <div key={ns.skill_name} style={{ background: "#0f1a0f", border: "1px solid #3a7a3a55", padding: "10px 14px", marginBottom: 10, borderLeft: `3px solid ${TIER_STYLE[ns.tier]?.color || "#7ab87a"}` }}>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: "#4a8a4a", letterSpacing: "0.15em", textTransform: "uppercase", margin: "0 0 3px" }}>✦ Soul Etching — {ns.tier} Skill</p>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: TIER_STYLE[ns.tier]?.color || "#7ab87a", margin: "0 0 3px" }}>{ns.skill_name}</p>
                  <p style={{ fontSize: 12, color: "#7aaa7a", margin: 0, fontStyle: "italic" }}>{ns.soul_etching_text}</p>
                </div>
              ))}
              <div style={{ fontSize: isMobile ? 15 : 16, color: "#c9b48a", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{entry.text}</div>
              {entry.gmNote && (
                <p style={{ fontSize: 11, color: "#6a5a40", margin: "8px 0 0", fontStyle: "italic", borderTop: "1px solid #2a2218", paddingTop: 8 }}>
                  ⟨ {entry.gmNote} ⟩
                </p>
              )}
            </div>
          )}
          {entry.type === "error" && (
            <p style={{ color: "#c0392b", fontSize: 13, fontStyle: "italic" }}>{entry.text}</p>
          )}
        </div>
      ))}
      {isThinking && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.6 }}>
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: "#d4a843", animation: "breathe 1.5s infinite" }}>✦</span>
          <span style={{ fontSize: 14, color: "#8a7a60", fontStyle: "italic" }}>The World Voice stirs...</span>
        </div>
      )}
      <div ref={logEndRef} />
    </div>
  );
}
 
// ── ACTION BAR (input + Act button) ─────────────────────────────────────────
function ActionBar({ isMobile, input, setInput, handleAction, isThinking }) {
  return (
    <div style={{ borderTop: "1px solid #2a2218", padding: isMobile ? "10px 12px" : "14px 20px", background: "#0a0805" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1, background: "#0f0d09", border: "1px solid #2a2218", padding: "8px 12px" }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAction(); } }}
            placeholder="What do you do?"
            rows={isMobile ? 2 : 2}
            style={{
              background: "transparent", border: "none", color: "#c9b48a",
              fontFamily: "'EB Garamond', serif", fontSize: isMobile ? 16 : 15, width: "100%",
              resize: "none", lineHeight: 1.5,
            }}
          />
        </div>
        <button
          onClick={handleAction}
          disabled={isThinking || !input.trim()}
          style={{
            background: isThinking || !input.trim() ? "#1a1610" : "linear-gradient(135deg, #7a1f1f, #4a1010)",
            border: `1px solid ${isThinking || !input.trim() ? "#2a2218" : "#c0392b"}`,
            color: isThinking || !input.trim() ? "#4a3a28" : "#c9b48a",
            fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: "0.1em",
            padding: isMobile ? "14px 16px" : "12px 18px",
            cursor: isThinking || !input.trim() ? "not-allowed" : "pointer",
            textTransform: "uppercase", whiteSpace: "nowrap", alignSelf: "stretch",
          }}
        >
          Act
        </button>
      </div>
      {!isMobile && (
        <p style={{ fontSize: 11, color: "#4a3a28", margin: "6px 0 0", textAlign: "right" }}>Enter to act · Shift+Enter for new line</p>
      )}
    </div>
  );
}
 
// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState("title"); // title | race | questionnaire | loading | simulation | saves
  const [selectedRace, setSelectedRace] = useState(null);
  const [charName, setCharName] = useState("");
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [gameState, setGameState] = useState(null);
  const [log, setLog] = useState([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [newSkillIds, setNewSkillIds] = useState(new Set());
  const [saveIndex, setSaveIndex] = useState([]);
  const [currentSlotId, setCurrentSlotId] = useState(null);
  const [savingStatus, setSavingStatus] = useState(""); // "", "saving", "saved"
  const [mobileTab, setMobileTab] = useState("World"); // "World" | "Codex"
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const logEndRef = useRef(null);
 
  // Load save index on mount
  useEffect(() => {
    const idx = listSaves();
    setSaveIndex(idx);
    setPhase("title");
  }, []);
 
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);
 
  // ── AUTO-SAVE ─────────────────────────────────────────────────────────────
  function autoSave(state, logEntries, slotId) {
    if (!slotId || !state) return;
    setSavingStatus("saving");
    const saveData = {
      gameState: state,
      log: logEntries.slice(-MAX_LOG_SAVED),
      savedAt: Date.now(),
    };
    writeSave(slotId, saveData);
    setSaveIndex(listSaves());
    setSavingStatus("saved");
    setTimeout(() => setSavingStatus(""), 2000);
  }
 
  // ── MANUAL SAVE TO NEW SLOT ───────────────────────────────────────────────
  function handleManualSave() {
    if (!gameState) return;
    const newId = newSlotId();
    setCurrentSlotId(newId);
    autoSave(gameState, log, newId);
  }
 
  // ── LOAD SAVE ─────────────────────────────────────────────────────────────
  function handleLoadSave(slotId) {
    setPhase("loading");
    setLoadingMsg("Restoring your soul from the aether...");
    try {
      const data = loadSave(slotId);
      if (!data) throw new Error("Save not found.");
      // Backward compat: saves created before narrative memory existed won't have this field.
      const restoredState = {
        ...data.gameState,
        narrativeMemory: data.gameState.narrativeMemory || { entities: {}, notes: [] },
      };
      setGameState(restoredState);
      setLog(data.log || []);
      setCurrentSlotId(slotId);
      setPhase("simulation");
    } catch (e) {
      setLoadingMsg("Failed to load: " + e.message);
    }
  }
 
  // ── DELETE SAVE ───────────────────────────────────────────────────────────
  function handleDeleteSave(slotId) {
    deleteSave(slotId);
    setSaveIndex(listSaves());
    setConfirmDeleteId(null);
  }
 
  // ── QUESTIONNAIRE SUBMIT ─────────────────────────────────────────────────
  async function handleQuestionnaireComplete(finalAnswers) {
    setPhase("loading");
    setLoadingMsg("The World Voice reads your soul...");
    const charData = { name: charName, race: selectedRace, answers: finalAnswers };
 
    try {
      setLoadingMsg("Your Unique Skill crystallizes...");
      const uniqueSkill = await determineUniqueSkill(charData);
 
      const skills = [
        ...selectedRace.intrinsic.map(s => ({
          name: s.name, tier: "Intrinsic", mastery: 3 + Math.floor(Math.random() * 6), // 3-8
          description: s.description,
        })),
        { name: uniqueSkill.skill_name, tier: "Unique", mastery: 0, description: uniqueSkill.description, sub_abilities: [], usage_notes: [], soul_resonance: uniqueSkill.soul_resonance },
      ];
 
      const character = { name: charName, race: selectedRace, uniqueSkill, answers: finalAnswers };
 
      setLoadingMsg("The world shapes your opening scene...");
      const intro = await generateIntroScene(character);
 
      const sceneEvent = intro.state_updates?.world_events?.find(e => e.type === "scene_set");
 
      const initialState = {
        character,
        skills,
        location: sceneEvent?.location || "The Crossroads of Vaeltharion",
        currentScene: sceneEvent?.scene_summary || "The world begins.",
        actionHistory: [],
        narrativeMemory: { entities: {}, notes: [] },
      };
 
      const newId = newSlotId();
      setCurrentSlotId(newId);
      setGameState(initialState);
      const firstLog = [{ type: "narration", text: intro.narration, etchingSkill: uniqueSkill }];
      setLog(firstLog);
      setNewSkillIds(new Set(skills.map(s => s.name)));
      setTimeout(() => setNewSkillIds(new Set()), 2000);
      // save immediately on world entry
      autoSave(initialState, firstLog, newId);
      setPhase("simulation");
    } catch (e) {
      setLoadingMsg("An error stirred in the aether... " + e.message);
    }
  }
 
  // ── PLAYER ACTION ────────────────────────────────────────────────────────
  async function handleAction() {
    if (!input.trim() || isThinking) return;
    const action = input.trim();
    setInput("");
    setIsThinking(true);
    setMobileTab("World");
    setLog(l => [...l, { type: "action", text: action }]);
 
    try {
      const result = await callWorldEngine(action, gameState);
      const updates = result.state_updates || {};
 
      // Apply mastery changes
      let updatedSkills = [...gameState.skills];
      const changed = new Set();
      (updates.skill_mastery_changes || []).forEach(change => {
        const idx = updatedSkills.findIndex(s => s.name === change.skill_name);
        if (idx !== -1) {
          const isUnique = updatedSkills[idx].tier === "Unique";
          const newNotes = isUnique
            ? [...(updatedSkills[idx].usage_notes || []), `(mastery ${change.old_mastery}→${change.new_mastery}) Action: "${action}"${change.note ? " — " + change.note : ""}`]
            : updatedSkills[idx].usage_notes;
          updatedSkills[idx] = { ...updatedSkills[idx], mastery: change.new_mastery, usage_notes: newNotes };
          changed.add(change.skill_name);
        }
      });
 
      // Add new skills
      const newNames = new Set();
      (updates.new_skills_granted || []).forEach(ns => {
        if (!updatedSkills.find(s => s.name === ns.skill_name)) {
          updatedSkills.push({ name: ns.skill_name, tier: ns.tier, mastery: ns.mastery || 5, description: ns.description });
          newNames.add(ns.skill_name);
        }
      });
 
      // Handle evolutions (includes rare Soul Rewrite for Unique Skills)
      const rewrites = [];
      (updates.skill_evolutions || []).forEach(ev => {
        const idx = updatedSkills.findIndex(s => s.name === ev.old_name);
        if (idx !== -1) {
          const isSoulRewrite = ev.old_tier === "Unique" && ev.new_tier === "Unique";
          updatedSkills[idx] = {
            ...updatedSkills[idx],
            name: ev.new_name,
            tier: ev.new_tier,
            description: ev.description,
            mastery: isSoulRewrite ? 0 : updatedSkills[idx].mastery,
            sub_abilities: isSoulRewrite ? [] : updatedSkills[idx].sub_abilities,
            usage_notes: isSoulRewrite ? [] : updatedSkills[idx].usage_notes,
          };
          if (isSoulRewrite) {
            rewrites.push({ old_name: ev.old_name, new_name: ev.new_name, description: ev.description, rewrite_narrative: ev.rewrite_narrative });
          }
        }
      });
 
      // Handle Unique Skill sub-ability emergence
      let subAbilityUnlock = null;
      if (updates.unique_sub_ability_unlocked) {
        const sa = updates.unique_sub_ability_unlocked;
        const idx = updatedSkills.findIndex(s => s.tier === "Unique");
        if (idx !== -1 && !updatedSkills[idx].sub_abilities?.find(existing => existing.name === sa.name)) {
          updatedSkills[idx] = {
            ...updatedSkills[idx],
            sub_abilities: [...(updatedSkills[idx].sub_abilities || []), { name: sa.name, unlock_mastery: sa.unlock_mastery, description: sa.description }],
          };
          subAbilityUnlock = { skillName: updatedSkills[idx].name, ...sa };
        }
      }
 
      // Merge narrative memory updates (known entities + standing story notes)
      const nmUpdates = result.narrative_memory_updates || {};
      const prevMemory = gameState.narrativeMemory || { entities: {}, notes: [] };
      const mergedEntities = { ...prevMemory.entities };
      (nmUpdates.new_entities || []).forEach(e => {
        if (e?.name) mergedEntities[e.name] = { name: e.name, description: e.description || "" };
      });
      const mergedNotes = nmUpdates.note
        ? [...prevMemory.notes, nmUpdates.note].slice(-40) // cap so it doesn't grow unbounded over a long playthrough
        : prevMemory.notes;
 
      const newState = {
        ...gameState,
        skills: updatedSkills,
        actionHistory: [...gameState.actionHistory, action],
        narrativeMemory: { entities: mergedEntities, notes: mergedNotes },
      };
 
      const sceneEvent = (updates.world_events || []).find(e => e.type === "scene_set");
      if (sceneEvent) {
        newState.location = sceneEvent.location || newState.location;
        newState.currentScene = sceneEvent.scene_summary || newState.currentScene;
      }
 
      setGameState(newState);
      setNewSkillIds(newNames);
      setTimeout(() => setNewSkillIds(new Set()), 2500);
 
      const newLogEntry = {
        type: "narration",
        text: result.narration,
        newSkills: updates.new_skills_granted || [],
        soulRewrites: rewrites,
        subAbilityUnlock,
        gmNote: result.gm_note,
      };
      setLog(l => {
        const updated = [...l, newLogEntry];
        // auto-save with latest state and log
        autoSave(newState, updated, currentSlotId);
        return updated;
      });
    } catch (e) {
      setLog(l => [...l, { type: "error", text: "The World Voice fell silent. " + e.message }]);
    }
    setIsThinking(false);
  }
 
  // ════════════════════════════════════════════════════════════════════════
  // RENDER PHASES
  // ════════════════════════════════════════════════════════════════════════
 
  const sharedBg = {
    minHeight: "100vh",
    background: "linear-gradient(160deg, #0d0b07 0%, #120e08 60%, #0a0f14 100%)",
    color: "#c9b48a",
    fontFamily: "'EB Garamond', serif",
  };
 
  // ── TITLE SCREEN (with inline save browser) ──────────────────────────────
  if (phase === "title") {
    const hasSaves = saveIndex.length > 0;
    const sorted = [...saveIndex].sort((a, b) => b.savedAt - a.savedAt);
    return (
      <div style={{ ...sharedBg, minHeight: "100vh", padding: "40px 24px" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
          @keyframes breathe{0%,100%{opacity:0.6}50%{opacity:1}}
          @keyframes glowPulse{0%,100%{box-shadow:0 0 8px #d4a84322}50%{box-shadow:0 0 22px #d4a84366}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
          @keyframes cardHover{}
          .save-card:hover{border-color:#3a2e1a !important; background:#141008 !important;}
        `}</style>
        <div style={{ maxWidth: 560, margin: "0 auto", animation: "fadeIn 0.7s ease-out" }}>
 
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: hasSaves ? 40 : 56 }}>
            <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.3em", color: "#7a1f1f", textTransform: "uppercase", margin: "0 0 10px" }}>Vaeltharion</p>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 28, color: "#d4a843", animation: "breathe 3s infinite", marginBottom: 10 }}>✦</div>
            <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 30, fontWeight: 700, color: "#c9b48a", margin: "0 0 10px", lineHeight: 1.2 }}>The Soulbound Chronicles</h1>
            <p style={{ fontSize: 14, color: "#6a5a40", margin: 0, lineHeight: 1.7, fontStyle: "italic" }}>
              Power is not learned here. It is remembered by the soul.
            </p>
          </div>
 
          {/* Saved Chronicles */}
          {hasSaves && (
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#6a5a40", letterSpacing: "0.2em", textTransform: "uppercase", margin: "0 0 12px" }}>
                Saved Chronicles
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sorted.map(save => (
                  <div key={save.id} className="save-card" style={{
                    background: "#0f0d09", border: "1px solid #2a2218",
                    padding: "14px 16px", display: "flex", alignItems: "center", gap: 14,
                    transition: "all 0.15s", cursor: "pointer",
                  }}>
                    {/* Click the left area to load */}
                    <div style={{ flex: 1 }} onClick={() => handleLoadSave(save.id)}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#d4a843" }}>{save.name}</span>
                        <span style={{ fontSize: 12, color: "#6a5a40" }}>{save.race}</span>
                      </div>
                      {save.uniqueSkill && (
                        <p style={{ fontSize: 12, color: "#8a7060", margin: "0 0 4px", fontStyle: "italic" }}>✦ {save.uniqueSkill}</p>
                      )}
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "#5a4a30" }}>{save.location}</span>
                        <span style={{ fontSize: 11, color: "#4a3a28" }}>{save.skillCount} skills</span>
                        <span style={{ fontSize: 11, color: "#4a3a28" }}>{fmtDate(save.savedAt)}</span>
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {confirmDeleteId === save.id ? (
                        <>
                          <button
                            onClick={() => handleDeleteSave(save.id)}
                            style={{
                              background: "#7a1f1f", border: "1px solid #c0392b", color: "#f0d8d8",
                              fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                              padding: "7px 12px", cursor: "pointer", textTransform: "uppercase",
                            }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            style={{
                              background: "#14110d", border: "1px solid #2a2218", color: "#8a7a60",
                              fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                              padding: "7px 10px", cursor: "pointer", textTransform: "uppercase",
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleLoadSave(save.id)}
                            style={{
                              background: "linear-gradient(135deg, #7a1f1f, #4a1010)",
                              border: "1px solid #c0392b", color: "#c9b48a",
                              fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                              padding: "7px 14px", cursor: "pointer", textTransform: "uppercase",
                            }}
                          >
                            Continue
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(save.id)}
                            style={{
                              background: "#14110d", border: "1px solid #2a2218", color: "#5a4a38",
                              fontFamily: "'Cinzel', serif", fontSize: 10, letterSpacing: "0.1em",
                              padding: "7px 10px", cursor: "pointer", textTransform: "uppercase",
                            }}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
 
          {/* Divider if saves exist */}
          {hasSaves && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: "#2a2218" }} />
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 10, color: "#4a3a28", letterSpacing: "0.15em", textTransform: "uppercase" }}>or</span>
              <div style={{ flex: 1, height: 1, background: "#2a2218" }} />
            </div>
          )}
 
          {/* New Game */}
          <button
            onClick={() => setPhase("race")}
            style={{
              width: "100%",
              background: hasSaves ? "#0f0d09" : "linear-gradient(135deg, #7a1f1f, #4a1010)",
              border: `1px solid ${hasSaves ? "#2a2218" : "#c0392b"}`,
              color: "#c9b48a",
              fontFamily: "'Cinzel', serif", fontSize: 14, letterSpacing: "0.12em",
              padding: "15px 32px", cursor: "pointer", textTransform: "uppercase",
              animation: hasSaves ? "none" : "glowPulse 2.5s infinite",
            }}
          >
            {hasSaves ? "+ Begin New Chronicle" : "✦ Begin Your Chronicle"}
          </button>
        </div>
      </div>
    );
  }
 
  // ── RACE SELECTION ───────────────────────────────────────────────────────
  if (phase === "race") {
    return (
      <div style={{ ...sharedBg, padding: "32px 24px" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
          @keyframes etchIn { from { opacity:0; transform: translateY(8px); filter: blur(3px); } to { opacity:1; transform: none; filter: none; } }
          @keyframes glowPulse { 0%,100%{box-shadow:0 0 8px #d4a84322} 50%{box-shadow:0 0 18px #d4a84366} }
          ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d0b07} ::-webkit-scrollbar-thumb{background:#3a2e1a}
          textarea:focus{outline:none}
        `}</style>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.2em", color: "#7a1f1f", textTransform: "uppercase", marginBottom: 8 }}>Vaeltharion</p>
          <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 28, fontWeight: 700, color: "#d4a843", margin: "0 0 8px", lineHeight: 1.2 }}>The Soulbound Chronicles</h1>
          <p style={{ fontSize: 15, color: "#8a7a60", marginBottom: 32, lineHeight: 1.6, fontStyle: "italic" }}>In this world, power is not learned — it is remembered by the soul. Choose your blood, and the World Voice will read what lies beneath.</p>
 
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#8a7a60", letterSpacing: "0.1em", display: "block", marginBottom: 8 }}>YOUR NAME</label>
            <input
              value={charName}
              onChange={e => setCharName(e.target.value)}
              placeholder="What are you called?"
              style={{ background: "#14110d", border: "1px solid #3a2e1a", color: "#c9b48a", fontFamily: "'EB Garamond', serif", fontSize: 16, padding: "10px 14px", width: "100%", boxSizing: "border-box", borderRadius: 2 }}
            />
          </div>
 
          <label style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#8a7a60", letterSpacing: "0.1em", display: "block", marginBottom: 12 }}>YOUR RACE</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
            {RACES.map(race => (
              <div
                key={race.id}
                onClick={() => setSelectedRace(race)}
                style={{
                  background: selectedRace?.id === race.id ? "#1e1608" : "#0f0d09",
                  border: `1px solid ${selectedRace?.id === race.id ? "#d4a843" : "#2a2218"}`,
                  padding: "14px 16px",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  animation: selectedRace?.id === race.id ? "glowPulse 2s infinite" : "none",
                }}
              >
                <div style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: selectedRace?.id === race.id ? "#d4a843" : "#c9b48a", marginBottom: 4 }}>{race.name}</div>
                <div style={{ fontSize: 12, color: "#6a5a40", lineHeight: 1.4, marginBottom: 8 }}>{race.desc}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {race.intrinsic.map(s => (
                    <span key={s.name} style={{ fontSize: 10, color: "#8a7a60", border: "1px solid #3a2e1a", padding: "2px 6px", letterSpacing: "0.04em" }}>{s.name}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
 
          <button
            onClick={() => { if (selectedRace && charName.trim()) setPhase("questionnaire"); }}
            disabled={!selectedRace || !charName.trim()}
            style={{
              background: selectedRace && charName.trim() ? "linear-gradient(135deg, #7a1f1f, #4a1010)" : "#1a1610",
              border: `1px solid ${selectedRace && charName.trim() ? "#c0392b" : "#2a2218"}`,
              color: selectedRace && charName.trim() ? "#c9b48a" : "#4a3a28",
              fontFamily: "'Cinzel', serif", fontSize: 14, letterSpacing: "0.12em",
              padding: "14px 32px", cursor: selectedRace && charName.trim() ? "pointer" : "not-allowed",
              width: "100%", textTransform: "uppercase",
            }}
          >
            Enter the World Voice
          </button>
        </div>
      </div>
    );
  }
 
  // ── QUESTIONNAIRE ────────────────────────────────────────────────────────
  if (phase === "questionnaire") {
    const q = QUESTIONS[qIndex];
    const currentAnswer = answers[q.id] || "";
    const canAdvance = currentAnswer.trim().length > 0;
    return (
      <div style={{ ...sharedBg, padding: "32px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
          textarea:focus{outline:none}
          @keyframes glowPulse { 0%,100%{box-shadow:0 0 8px #d4a84322} 50%{box-shadow:0 0 18px #d4a84366} }
        `}</style>
        <div style={{ maxWidth: 600, width: "100%" }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#7a1f1f", letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>
            The World Voice Speaks — {qIndex + 1} / {QUESTIONS.length}
          </p>
          <div style={{ height: 2, background: "#2a2218", marginBottom: 32 }}>
            <div style={{ height: "100%", background: "#d4a843", width: `${(qIndex / QUESTIONS.length) * 100}%`, transition: "width 0.4s" }} />
          </div>
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#c9b48a", fontWeight: 600, marginBottom: 10, lineHeight: 1.4, fontStyle: "italic" }}>
            "{q.text}"
          </h2>
          <p style={{ fontSize: 13, color: "#6a5a40", fontStyle: "italic", marginBottom: 24 }}>{q.hint}</p>
          <div style={{ background: "#0f0d09", border: "1px solid #2a2218", padding: "14px 16px", marginBottom: 16 }}>
            <textarea
              value={currentAnswer}
              onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
              placeholder="Write freely..."
              rows={6}
              style={{
                background: "transparent", border: "none", color: "#c9b48a",
                fontFamily: "'EB Garamond', serif", fontSize: 16, width: "100%",
                resize: "vertical", lineHeight: 1.7,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {qIndex > 0 && (
              <button
                onClick={() => setQIndex(qIndex - 1)}
                style={{
                  background: "#0f0d09", border: "1px solid #2a2218", color: "#8a7a60",
                  fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: "0.1em",
                  padding: "12px 20px", cursor: "pointer", textTransform: "uppercase",
                }}
              >
                ← Back
              </button>
            )}
            <button
              onClick={() => {
                if (!canAdvance) return;
                if (qIndex < QUESTIONS.length - 1) {
                  setQIndex(qIndex + 1);
                } else {
                  handleQuestionnaireComplete(answers);
                }
              }}
              disabled={!canAdvance}
              style={{
                flex: 1,
                background: canAdvance ? "linear-gradient(135deg, #7a1f1f, #4a1010)" : "#1a1610",
                border: `1px solid ${canAdvance ? "#c0392b" : "#2a2218"}`,
                color: canAdvance ? "#c9b48a" : "#4a3a28",
                fontFamily: "'Cinzel', serif", fontSize: 13, letterSpacing: "0.12em",
                padding: "13px 24px", cursor: canAdvance ? "pointer" : "not-allowed",
                textTransform: "uppercase",
                animation: canAdvance ? "glowPulse 2s infinite" : "none",
              }}
            >
              {qIndex < QUESTIONS.length - 1 ? "Continue →" : "Speak to the World Voice"}
            </button>
          </div>
        </div>
      </div>
    );
  }
 
  // ── LOADING ──────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div style={{ ...sharedBg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap'); @keyframes breathe{0%,100%{opacity:0.5}50%{opacity:1}}`}</style>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#d4a843", animation: "breathe 2s infinite", letterSpacing: "0.1em" }}>✦</div>
        <p style={{ fontFamily: "'EB Garamond', serif", fontSize: 17, color: "#8a7a60", fontStyle: "italic", textAlign: "center", maxWidth: 320 }}>{loadingMsg}</p>
      </div>
    );
  }
 
  // ── SIMULATION ───────────────────────────────────────────────────────────
  if (phase === "simulation" && gameState) {
    const uniqueSkill = gameState.skills.find(s => s.tier === "Unique");
    const isMobile = window.innerWidth < 700;
 
    // ── MOBILE LAYOUT ────────────────────────────────────────────────────
    if (isMobile) {
      return (
        <div style={{ ...sharedBg, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
            @keyframes etchIn{from{opacity:0;transform:translateY(6px);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
            @keyframes soulPulse{0%,100%{box-shadow:0 0 12px #d4a84322}50%{box-shadow:0 0 28px #d4a84355}}
            @keyframes breathe{0%,100%{opacity:0.4}50%{opacity:0.9}}
            @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
            ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0d0b07}::-webkit-scrollbar-thumb{background:#3a2e1a}
            textarea:focus{outline:none}
          `}</style>
 
          {/* Tab Bar */}
          <div style={{ display: "flex", background: "#0a0805", borderBottom: "1px solid #2a2218", flexShrink: 0 }}>
            {["World", "Codex"].map(tab => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                style={{
                  flex: 1, padding: "12px 8px",
                  background: mobileTab === tab ? "#0f0d09" : "transparent",
                  border: "none",
                  borderBottom: `2px solid ${mobileTab === tab ? "#d4a843" : "transparent"}`,
                  color: mobileTab === tab ? "#d4a843" : "#6a5a40",
                  fontFamily: "'Cinzel', serif", fontSize: 11, letterSpacing: "0.15em",
                  textTransform: "uppercase", cursor: "pointer",
                }}
              >
                {tab === "World" ? "✦ World" : "☽ Codex"}
              </button>
            ))}
          </div>
 
          {/* Content area */}
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {mobileTab === "World" ? (
              <>
                <WorldLog isMobile={isMobile} log={log} gameState={gameState} isThinking={isThinking} logEndRef={logEndRef} />
                <ActionBar isMobile={isMobile} input={input} setInput={setInput} handleAction={handleAction} isThinking={isThinking} />
              </>
            ) : (
              <SoulCodexContents
                gameState={gameState}
                uniqueSkill={uniqueSkill}
                newSkillIds={newSkillIds}
                savingStatus={savingStatus}
                handleManualSave={handleManualSave}
                setPhase={setPhase}
              />
            )}
          </div>
        </div>
      );
    }
 
    // ── DESKTOP LAYOUT ───────────────────────────────────────────────────
    return (
      <div style={{ ...sharedBg, display: "flex", height: "100vh", overflow: "hidden" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
          @keyframes etchIn{from{opacity:0;transform:translateY(6px);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
          @keyframes soulPulse{0%,100%{box-shadow:0 0 12px #d4a84322}50%{box-shadow:0 0 28px #d4a84355}}
          @keyframes breathe{0%,100%{opacity:0.4}50%{opacity:0.9}}
          ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0d0b07}::-webkit-scrollbar-thumb{background:#3a2e1a}
          textarea:focus{outline:none}
        `}</style>
 
        {/* LEFT PANEL */}
        <div style={{ width: 240, background: "#0a0805", borderRight: "1px solid #2a2218", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <SoulCodexContents
            gameState={gameState}
            uniqueSkill={uniqueSkill}
            newSkillIds={newSkillIds}
            savingStatus={savingStatus}
            handleManualSave={handleManualSave}
            setPhase={setPhase}
          />
        </div>
 
        {/* RIGHT PANEL */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <WorldLog isMobile={isMobile} log={log} gameState={gameState} isThinking={isThinking} logEndRef={logEndRef} />
          <ActionBar isMobile={isMobile} input={input} setInput={setInput} handleAction={handleAction} isThinking={isThinking} />
        </div>
      </div>
    );
  }
 
  return null;
}