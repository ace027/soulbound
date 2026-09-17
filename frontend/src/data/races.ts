import type { Race } from '@soulbound/shared';

export const RACES: Race[] = [
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
