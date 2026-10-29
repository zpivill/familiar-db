// Training and held items for "AI-trained" builds: the AI picks an EV preset, a nature and IVs for every
// character from its moves and its team, then hands out held items with one of each item per team.
// Overrides from the Simulator page (by character key) replace any part the AI picked.

import { TRAINING, TYPES, ITEMS, typeEff, itemDef } from './rules.js';

// EV presets, in points out of TRAINING.evTotal (66). 'atk' means Power or Energy, whichever the
// character's moves use more.
export const PRESETS = {
  fast: { name: 'Fast attacker', evs: { atk: 32, spe: 32, vit: 2 } },
  bulky: { name: 'Bulky attacker', evs: { vit: 32, atk: 32, spe: 2 } },
  trickRoom: { name: 'Trick Room attacker', evs: { vit: 32, atk: 32, grd: 1, wil: 1 } },
  wallPhys: { name: 'Physical wall', evs: { vit: 32, grd: 32, wil: 2 } },
  wallEne: { name: 'Energy wall', evs: { vit: 32, wil: 32, grd: 2 } },
  support: { name: 'Support', evs: { vit: 32, grd: 17, wil: 17 } },
};

// What a build's moves and ability say about its job.
export function kit(data, b) {
  const ms = b.moves.map(l => data.moves.get(l.id)).filter(Boolean);
  const st = b.e.stats;
  const phys = ms.filter(m => m.category === 'Physical'), ene = ms.filter(m => m.category === 'Energy');
  const weight = list => list.reduce((n, m) => n + (m.power || 60), 0);
  const atk = weight(phys) * st.pow >= weight(ene) * st.ene ? 'pow' : 'ene';
  const fx = ms.map(m => m.fx);
  const status = ms.filter(m => m.category === 'Status');
  const ab = b.ability?.ab;
  return {
    atk, other: atk === 'pow' ? 'ene' : 'pow',
    usesOther: (atk === 'pow' ? ene : phys).length > 0,
    status: status.length,
    attacks: phys.length + ene.length,
    setup: fx.some(f => f.boosts?.some(x => x.who === 'self' && Object.values(x.stats).some(v => v > 0))) && status.length > 0,
    heal: fx.some(f => f.heal),
    protect: fx.some(f => f.protect),
    trickRoom: fx.some(f => f.field?.trickRoom),
    tailwind: fx.some(f => f.tailwind),
    redirect: fx.some(f => f.followMe || f.helpingHand),
    screens: fx.some(f => f.screen),
    field: fx.some(f => f.field && !f.field.trickRoom) || !!ab?.entry?.some(o => o.op === 'field'),
    contactPhys: phys.length > 0,
    foulPlay: fx.some(f => f.foulPlay),
    stab: [...new Set([...phys, ...ene].filter(m => b.e.types.includes(m.type)).map(m => m.type))],
  };
}

const bulk = st => st.vit + st.grd + st.wil;

// The preset, nature and IVs for one build. team = the kits of the whole team, for Trick Room and Tailwind.
export function autoTraining(data, b, teamKits = []) {
  const k = kit(data, b), st = b.e.stats;
  const trTeam = teamKits.some(x => x.trickRoom), twTeam = teamKits.some(x => x.tailwind);
  const bestDef = st.grd >= st.wil ? 'grd' : 'wil';
  let preset;
  if (k.status >= 2 && (k.redirect || k.tailwind || k.trickRoom || k.screens) || k.attacks <= 1) preset = 'support';
  else if (Math.max(st.pow, st.ene) + 10 < Math.max(st.grd, st.wil) && (k.heal || k.protect) && k.attacks <= 2) preset = bestDef === 'grd' ? 'wallPhys' : 'wallEne';
  else if (trTeam && st.spe <= 70) preset = 'trickRoom';
  else if (twTeam || st.spe < 75) preset = 'bulky';
  else preset = 'fast';
  const evs = { vit: 0, pow: 0, grd: 0, ene: 0, wil: 0, spe: 0 };
  for (const [s, v] of Object.entries(PRESETS[preset].evs)) evs[s === 'atk' ? k.atk : s] += v;
  // nature: raise what the preset invests in, lower the attack stat it doesn't use (or Speed on Trick Room)
  let nature;
  const low = k.usesOther ? (st.grd <= st.wil ? 'grd' : 'wil') : k.other;
  if (preset === 'fast') nature = 'spe-' + low;
  else if (preset === 'bulky') nature = k.atk + '-' + low;
  else if (preset === 'trickRoom') nature = k.atk + '-spe';
  else if (preset === 'wallPhys') nature = 'grd-' + low;
  else if (preset === 'wallEne') nature = 'wil-' + low;
  else nature = (st.grd <= st.wil ? 'grd' : 'wil') + '-' + (k.usesOther || k.attacks === 0 ? 'spe' : k.other);
  if (nature.split('-')[0] === nature.split('-')[1]) nature = 'neutral';
  // IVs: 31 everywhere, except 0 Speed on Trick Room attackers and 0 in an unused attack stat (smaller
  // confusion self-hits and borrowed-attack moves)
  const ivs = { vit: 31, pow: 31, grd: 31, ene: 31, wil: 31, spe: 31 };
  if (preset === 'trickRoom' || (preset === 'support' && trTeam && k.trickRoom)) ivs.spe = 0;
  if (k.other === 'pow' && !k.usesOther && !teamKits.some(x => x.foulPlay)) ivs.pow = 0;
  return { preset, evs, nature, ivs };
}

// How much each item adds to one build, before the one-of-each rule. Typed items come back as 'id:Type'.
function itemScores(data, b, k, training) {
  const st = b.e.stats, out = [];
  const pureAttacker = k.status === 0, fastish = st.spe >= 70 && st.spe <= 105;
  const frail = bulk(st) < 190;
  const add = (id, v) => { if (v > 0) out.push([id, v]); };
  add('iron-gauntlet', pureAttacker && k.atk === 'pow' ? 30 : 0);
  add('focus-seal', pureAttacker && k.atk === 'ene' ? 30 : 0);
  add('swift-sandals', pureAttacker && fastish && training?.preset !== 'trickRoom' ? 27 : 0);
  add('overdrive-core', k.status <= 1 && k.attacks >= 3 ? 24 : 0);
  add('last-thread', frail ? 18 + (k.tailwind || k.trickRoom ? 10 : 0) : 0);
  add('bento-box', training?.preset?.startsWith('wall') || training?.preset === 'support' ? 22 + (k.protect ? 4 : 0) : 8);
  add('rice-ball', 14 + (bulk(st) >= 230 ? 5 : 0));
  add('battle-coat', pureAttacker && st.wil < 110 ? 22 : 0);
  add('hooded-cloak', training?.preset === 'support' ? 14 : 4);
  add('clear-amulet', k.atk === 'pow' && k.attacks >= 2 ? 12 : 0);
  add('calm-incense', k.redirect || k.tailwind || k.trickRoom || k.screens ? 18 : 0);
  add('panacea-leaf', k.setup ? 20 : 9);
  add('counterstrike-policy', bulk(st) >= 220 && (k.setup || k.attacks >= 3) ? 16 : 0);
  add('spiked-armor', training?.preset === 'wallPhys' ? 20 : 3);
  add('escape-scroll', training?.preset === 'support' ? 10 : 2);
  add('field-anchor', k.field || k.screens ? 24 : 0);
  for (const t of k.stab) add('type-emblem:' + t, k.status <= 1 ? 18 : 10);
  // Ward Charm against its worst weakness (4x counts more)
  let worst = null, we = 1;
  for (const t of TYPES) { const e = typeEff(t, b.e.types); if (e > we) { we = e; worst = t; } }
  if (worst) add('ward-charm:' + worst, we >= 4 ? 22 : 13);
  return out;
}

// Gives every build of one team its training and item. r = the battle's random numbers, for variety.
// overrides: { [character key]: { nature, evs, ivs, item } }, any part optional.
export function trainTeam(data, builds, r, opts = {}) {
  const train = opts.training === 'ai', items = opts.items === 'ai', ov = opts.overrides || {};
  if (!train && !items && !Object.keys(ov).length) return builds;
  const kits = builds.map(b => kit(data, b));
  builds.forEach((b, i) => {
    if (train) Object.assign(b, autoTraining(data, b, kits));
    const o = ov[b.e.key];
    if (o) for (const f of ['nature', 'evs', 'ivs']) if (o[f]) b[f] = cleanStat(f, o[f]) ?? b[f];
    b.kit = kits[i];
  });
  if (items) {
    const taken = new Set();
    builds.forEach(b => { const o = ov[b.e.key]; if (o?.item && itemDef(o.item)) { b.item = o.item; taken.add(o.item); } });
    // greedy: the strongest (build, item) fits first, with a little noise so teams vary
    const cand = [];
    builds.forEach((b, i) => { if (!b.item) for (const [id, v] of itemScores(data, b, kits[i], b)) cand.push({ i, id, v: v + r() * 4 }); });
    cand.sort((x, y) => y.v - x.v);
    for (const c of cand) if (!builds[c.i].item && !taken.has(c.id)) { builds[c.i].item = c.id; taken.add(c.id); }
  } else builds.forEach(b => { const o = ov[b.e.key]; if (o?.item && itemDef(o.item)) b.item = o.item; });
  builds.forEach(b => { delete b.kit; });
  return builds;
}

// Keeps an override inside the rules: EVs at most 32 per stat and 66 in all, IVs 0-31.
export function cleanStat(kind, v) {
  if (kind === 'nature') return typeof v === 'string' ? v : null;
  const out = {};
  let left = TRAINING.evTotal;
  for (const s of ['vit', 'pow', 'grd', 'ene', 'wil', 'spe']) {
    const n = Math.max(0, Math.floor(+v[s] || 0));
    if (kind === 'evs') { out[s] = Math.min(n, TRAINING.evMax, left); left -= out[s]; }
    else out[s] = v[s] == null ? TRAINING.ivMax : Math.min(n, TRAINING.ivMax);
  }
  return out;
}

export { ITEMS };
