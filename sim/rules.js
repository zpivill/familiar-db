// Battle rules for the simulator. Every number the team may want to tune lives here,
// so a balance change is one edit and a rerun. Shown on the Simulator page under "Rules".

export const TYPES = ['Fire', 'Water', 'Ice', 'Wind', 'Earth', 'Lightning', 'Light', 'Dark',
  'Spirit', 'Cosmic', 'Time', 'Tech', 'Beast', 'Blood', 'Neutral'];

// The draft type chart from the game map: what each attacking type is super effective against,
// and what each defending type resists or is immune to.
const SUPER = {
  Fire: ['Ice', 'Beast', 'Tech'], Water: ['Fire', 'Earth', 'Tech'], Ice: ['Wind', 'Earth', 'Beast'],
  Wind: ['Dark', 'Earth'], Earth: ['Fire', 'Lightning'], Lightning: ['Water', 'Wind', 'Tech'],
  Light: ['Dark', 'Spirit', 'Blood'], Dark: ['Light', 'Time', 'Spirit'], Spirit: ['Neutral', 'Dark', 'Blood'],
  Cosmic: ['Light', 'Spirit'], Time: ['Cosmic', 'Lightning'], Tech: ['Ice', 'Beast'], Beast: ['Wind', 'Blood'],
  Blood: ['Water', 'Time'], Neutral: [],
};
const RESISTS = {  // defender: attacking types it takes half from
  Fire: ['Ice', 'Tech'], Water: ['Fire', 'Ice'], Ice: ['Water', 'Wind'], Wind: ['Earth', 'Dark'],
  Earth: ['Fire', 'Beast'], Lightning: ['Wind', 'Light'], Light: ['Fire', 'Spirit'], Dark: ['Cosmic', 'Blood'],
  Spirit: ['Blood', 'Beast'], Cosmic: ['Light', 'Fire', 'Ice'], Time: ['Neutral', 'Tech'], Tech: ['Ice', 'Wind', 'Neutral'],
  Beast: ['Earth', 'Water', 'Dark'], Blood: ['Fire', 'Dark'], Neutral: [],
};
const IMMUNE = { Earth: ['Lightning'], Spirit: ['Neutral'], Cosmic: ['Earth'], Tech: ['Blood'] };

// CHART[attack][defend] = multiplier for one defending type.
export const CHART = {};
for (const a of TYPES) {
  CHART[a] = {};
  for (const d of TYPES) {
    CHART[a][d] = (IMMUNE[d] || []).includes(a) ? 0 : SUPER[a].includes(d) ? 2 : RESISTS[d].includes(a) ? 0.5 : 1;
  }
}
export const CHART_SOURCE = { SUPER, RESISTS, IMMUNE };

export const RULES = {
  level: 100,                 // battle level (cap is 100); every move in the form's learnset up to this level can be equipped
  iv: 31,                     // flat bonus on every stat, as if every copy were perfectly bred
  hpScale: 1,                 // multiplies Vitality; raise it to make battles last longer
  stab: 1.5,                  // own-type moves
  crit: { mult: 1.5, chance: [1 / 24, 1 / 8, 1 / 2, 1] },  // by crit stage 0, 1, 2, 3+
  random: [0.85, 1],          // damage roll
  spread: 0.75,               // a move that hits more than one target in duos
  screen: { singles: 0.5, duos: 2 / 3 },
  fieldBoost: 1.3,            // "Field for 5 turns: X moves do 1.3x"
  turnCap: 100,               // a battle still going after this many turns is a draw
  // Status effects (framework: type-linked, one at a time; Confuse is separate and can stack with them)
  burn: { physical: 0.5, chip: 1 / 16 },                  // Fire: lowers Power (physical damage dealt), chip damage
  freeze: { thaw: 0.25, maxTurns: 3 },                    // Ice: can't act, 25% thaw each turn, always thaws after 3
  stun: { skip: 0.25, speed: 0.5 },                       // Lightning: may lose a turn, lowers Speed
  bleed: { step: 1 / 16 },                                // Blood: 1/16, 2/16, 3/16... growing each turn
  curse: { energy: 0.5, will: 0.75 },                     // Spirit/Dark: lowers Energy (energy damage dealt) and Will
  sleep: { turns: [1, 3] },
  confuse: { turns: [2, 5], self: 1 / 3, power: 40 },     // Time/Wind: may hit itself
  ownTypeStatusImmune: true,  // Fire can't be Burned, Ice can't be Frozen, Lightning can't be Stunned, Blood can't Bleed
};

// Training for the competitive format (and any run with "AI-trained" builds).
// EV points: each point adds level / 50 to that stat (+1 at Lv50, +2 at Lv100).
// A nature raises one stat other than Vitality by 10% and lowers another by 10%, or changes nothing.
// IVs go from 0 to 31 per stat; a build without IVs counts as 31 everywhere.
export const TRAINING = { evTotal: 66, evMax: 32, nature: 0.1, ivMax: 31 };
export const STAT_KEYS = ['vit', 'pow', 'grd', 'ene', 'wil', 'spe'];
export const STAT_NAMES = { vit: 'Vitality', pow: 'Power', grd: 'Guard', ene: 'Energy', wil: 'Will', spe: 'Speed' };
// 'neutral' plus one nature per (raised, lowered) pair, keyed 'spe-pow' = +Speed -Power.
export const NATURES = ['neutral'];
for (const up of STAT_KEYS.slice(1)) for (const dn of STAT_KEYS.slice(1)) if (up !== dn) NATURES.push(up + '-' + dn);
export const natureName = n => !n || n === 'neutral' ? 'Neutral' : `+${STAT_NAMES[n.split('-')[0]]} −${STAT_NAMES[n.split('-')[1]]}`;
export const natureMult = (n, k) => { if (!n || n === 'neutral') return 1; const [up, dn] = n.split('-'); return k === up ? 1 + TRAINING.nature : k === dn ? 1 - TRAINING.nature : 1; };

// Held items. One per character and, in team runs, one of each item per team; a Ward Charm or Type Emblem
// of each type counts as its own item. Names are placeholders, with the Pokémon item in brackets.
export const ITEMS = [
  { id: 'last-thread', name: 'Last Thread', like: 'Focus Sash', text: 'At full Vitality, survives one hit with 1 Vitality left. Used up.' },
  { id: 'iron-gauntlet', name: 'Iron Gauntlet', like: 'Choice Band', text: 'Power ×1.5, but locked into the first move used until it switches out.', choice: 'pow' },
  { id: 'focus-seal', name: 'Focus Seal', like: 'Choice Specs', text: 'Energy ×1.5, but locked into the first move used until it switches out.', choice: 'ene' },
  { id: 'swift-sandals', name: 'Swift Sandals', like: 'Choice Scarf', text: 'Speed ×1.5, but locked into the first move used until it switches out.', choice: 'spe' },
  { id: 'overdrive-core', name: 'Overdrive Core', like: 'Life Orb', text: 'Attacks do 1.3x, and each attack that hits costs 1/10 of max Vitality.' },
  { id: 'bento-box', name: 'Bento Box', like: 'Leftovers', text: 'Heals 1/16 of max Vitality at the end of each turn.' },
  { id: 'rice-ball', name: 'Rice Ball', like: 'Sitrus Berry', text: 'Heals 1/4 of max Vitality once, when it drops below half. Used up.' },
  { id: 'battle-coat', name: 'Battle Coat', like: 'Assault Vest', text: 'Will ×1.5, but only attacking moves can be used.' },
  { id: 'ward-charm', name: 'Ward Charm', like: 'resist berry', text: 'Halves one super effective hit of its type. Used up.', typed: true },
  { id: 'type-emblem', name: 'Type Emblem', like: 'type booster', text: 'Moves of its type do 1.2x.', typed: true },
  { id: 'hooded-cloak', name: 'Hooded Cloak', like: 'Covert Cloak', text: "Immune to the side effects of foes' moves: flinching, stat drops, status chances." },
  { id: 'clear-amulet', name: 'Clear Amulet', like: 'Clear Amulet', text: "Foes can't lower its stats." },
  { id: 'calm-incense', name: 'Calm Incense', like: 'Mental Herb', text: 'Cures Taunt or Encore once. Used up.' },
  { id: 'panacea-leaf', name: 'Panacea Leaf', like: 'Lum Berry', text: 'Cures a status effect or confusion once. Used up.' },
  { id: 'counterstrike-policy', name: 'Counterstrike Policy', like: 'Weakness Policy', text: 'When hit by a super effective move, +2 Power and +2 Energy. Used up.' },
  { id: 'spiked-armor', name: 'Spiked Armor', like: 'Rocky Helmet', text: 'Attackers that make contact lose 1/6 of their max Vitality.' },
  { id: 'escape-scroll', name: 'Escape Scroll', like: 'Eject Button', text: 'Switches out after being hit, if a teammate can come in. Used up.' },
  { id: 'field-anchor', name: 'Field Anchor', like: 'Terrain Extender', text: 'Fields and screens it sets last 8 turns instead of 5.' },
];
export const ITEM_NUM = {
  choice: 1.5, lifeOrb: 1.3, lifeOrbCost: 1 / 10, leftovers: 1 / 16, sitrus: 1 / 4, sitrusBelow: 0.5, vest: 1.5,
  ward: 0.5, emblem: 1.2, policy: 2, helmet: 1 / 6, anchorTurns: 8,
};
export const itemDef = id => ITEMS.find(i => i.id === (id || '').split(':')[0]) || null;
export const itemName = id => { const d = itemDef(id); if (!d) return 'None'; const t = (id || '').split(':')[1]; return d.typed && t ? `${t} ${d.name}` : d.name; };

// Base stat to battle stat, Pokemon style. Without training every copy counts as perfectly bred (31 IVs)
// with no EVs or natures, so only base stats tell characters apart. hpScale makes everyone bulkier if
// battles end too fast. ev = EV points, iv = 0-31, nat = nature multiplier.
export const battleStat = (base, level, hp, ev = 0, iv = RULES.iv, nat = 1) => {
  const bonus = Math.floor(ev * level / 50);
  return hp
    ? Math.floor(Math.floor((2 * base + iv) * level / 100) * RULES.hpScale) + level + 10 + bonus
    : Math.floor((Math.floor((2 * base + iv) * level / 100) + 5 + bonus) * nat);
};

export const stageMult = n => n >= 0 ? (2 + n) / 2 : 2 / (2 - n);

export const typeEff = (atk, defTypes) => defTypes.reduce((m, d) => m * (CHART[atk]?.[d] ?? 1), 1);
