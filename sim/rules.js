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

// Base stat to battle stat, Pokemon style: every copy counts as perfectly bred (31 IVs), no EVs or natures,
// so only base stats tell characters apart. hpScale makes everyone bulkier if battles end too fast.
export const battleStat = (base, level, hp) => hp
  ? Math.floor(Math.floor((2 * base + RULES.iv) * level / 100) * RULES.hpScale) + level + 10
  : Math.floor((2 * base + RULES.iv) * level / 100) + 5;

export const stageMult = n => n >= 0 ? (2 + n) / 2 : 2 / (2 - n);

export const typeEff = (atk, defTypes) => defTypes.reduce((m, d) => m * (CHART[atk]?.[d] ?? 1), 1);
