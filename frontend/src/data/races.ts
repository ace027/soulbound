import type { Attributes, Condition, Race } from '@soulbound/shared';

export const RACES: Race[] = [
  { id: "human", name: "Human", desc: "Adaptable and driven. The most common folk of Vaeltharion.",
    baseline: { max_hp: 100, max_mp: 50, max_sp: 100, STR: 10, AGI: 10, INT: 10, WIL: 12 },
    intrinsic: [
      { name: "Adaptive Will", description: "Your mastery of any skill grows faster than other races. You were made to learn." },
      { name: "Grit", description: "Once per day, a blow that would kill you leaves you standing at the edge of death with 1 HP remaining." },
    ]},
  { id: "vaelwyn", name: "Vaelwyn", desc: "Timeless beings of forest and starlight. Ancient memory in young eyes.",
    baseline: { max_hp: 80, max_mp: 90, max_sp: 80, STR: 8, AGI: 11, INT: 13, WIL: 10 },
    intrinsic: [
      { name: "Timeless Perception", description: "You see faint magical auras on people and objects, and aging has no claim on your body." },
      { name: "Sylvan Bond", description: "Natural creatures understand your intent and you theirs — a language beneath language." },
    ]},
  { id: "drakari", name: "Drakari", desc: "Descendants of dragons. Scale-skinned and proud.",
    baseline: { max_hp: 130, max_mp: 50, max_sp: 110, STR: 14, AGI: 9, INT: 8, WIL: 11 },
    intrinsic: [
      { name: "Scale Armor", description: "Your hide turns aside blows that would wound flesh. Physical strikes are naturally reduced." },
      { name: "Breath Weapon", description: "You carry an elemental breath tied to your lineage — fire, frost, or lightning — released in a focused cone." },
    ]},
  { id: "stonewarden", name: "Stonewarden", desc: "Dwarven kin. Earth in their blood, craft in their hands.",
    baseline: { max_hp: 140, max_mp: 30, max_sp: 120, STR: 13, AGI: 7, INT: 10, WIL: 12 },
    intrinsic: [
      { name: "Earthsense", description: "You feel vibrations through stone and soil. Footsteps, tunnels, shifting rock — the ground speaks to you." },
      { name: "Forgeborn", description: "Your hands never fumble in the act of making. Crafting failures that would humble others simply do not happen to you." },
    ]},
  { id: "shadeveil", name: "Shadeveil", desc: "Shadow-touched mortals who walk between seen and unseen.",
    baseline: { max_hp: 80, max_mp: 70, max_sp: 100, STR: 8, AGI: 14, INT: 11, WIL: 9 },
    intrinsic: [
      { name: "Umbral Slip", description: "For brief moments you can dissolve into shadow, passing through darkness as if you were part of it." },
      { name: "Dark Sense", description: "You see perfectly in total darkness and can feel the presence of living auras up to thirty paces away." },
    ]},
  { id: "feral", name: "Feral", desc: "Beast-kin of many kinds. Instinct and bond over intellect.",
    baseline: { max_hp: 110, max_mp: 30, max_sp: 130, STR: 12, AGI: 13, INT: 7, WIL: 9 },
    intrinsic: [
      { name: "Wild Instinct", description: "You cannot be fully surprised. Something in your blood reads the world a half-second before it happens." },
      { name: "Pack Bond", description: "Those you choose as your own become extensions of your senses — you feel their emotions and know their general location at all times." },
    ]},
  { id: "undying", name: "Undying", desc: "Partially claimed by death. Cursed and enduring.",
    baseline: { max_hp: 120, max_mp: 60, max_sp: 80, STR: 10, AGI: 8, INT: 10, WIL: 13 },
    intrinsic: [
      { name: "Death Sense", description: "You feel the presence of death and undead nearby like a cold pressure against your awareness." },
      { name: "Void Shell", description: "Poison and disease pass through you without effect. In exchange, natural healing is slower — your body has forgotten how to fully live." },
    ]},
  { id: "hollowed", name: "Hollowed", desc: "Rare souls with fractured essence. Strange and unsettling.",
    baseline: { max_hp: 90, max_mp: 60, max_sp: 90, STR: 10, AGI: 10, INT: 10, WIL: 10 },
    intrinsic: [
      { name: "Echo Sight", description: "You perceive emotional and event imprints left in locations — ghostly impressions of what once happened in a place." },
      { name: "Null Presence", description: "You are difficult to detect by magical means, and skills that target souls interact with you unpredictably." },
    ]},
  { id: "mycelium", name: "Mycelium", desc: "A fragment of a fungal network given shape. Rare, and not entirely one person.",
    baseline: { max_hp: 110, max_mp: 70, max_sp: 80, STR: 9, AGI: 7, INT: 12, WIL: 13 },
    intrinsic: [
      { name: "Spore Sense", description: "You feel the pull of spore-rich ground — its rough direction and distance — even without seeing it, the way you'd know which way is home." },
      { name: "Network Echo", description: "If you are killed within reach of spore-rich ground, the network can grow a replacement body — same memories, same self, by every account that can be tested. But it arrives thinned: weakened, slow to answer, its skills unreliable until it has had real time to recharge. Outside a zone's reach, there is nothing to reconstitute from at all." },
    ]},
];

const HUMAN_BASELINE = RACES[0].baseline!;

/** Full pools and attributes for a new character. Unknown race id -> human baseline. */
export function initialStatsForRace(raceId: string): { condition: Condition; attributes: Attributes } {
  const b = RACES.find((r) => r.id === raceId)?.baseline ?? HUMAN_BASELINE;
  return {
    condition: {
      hp: b.max_hp,
      mp: b.max_mp,
      sp: b.max_sp,
      max_hp: b.max_hp,
      max_mp: b.max_mp,
      max_sp: b.max_sp,
    },
    attributes: { STR: b.STR, AGI: b.AGI, INT: b.INT, WIL: b.WIL },
  };
}
