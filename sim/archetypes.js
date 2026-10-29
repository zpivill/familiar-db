// Team archetypes for Competitive doubles: the team plans a meta chain can force the search to build, so
// archetypes the AI wouldn't find on its own (Trick Room, weather-style fields, redirection...) still get
// tested against the meta teams.
//
// Each archetype has setters (the enabler) and abusers (the characters the plan is for). A forced team must
// bring at least BRING.setters setters and BRING.abusers abusers, and its draft must pick at least
// PICK.setters and PICK.abusers of them, so the plan can't be benched. A setter always carries the move or
// ability that sets the plan up, and an abuser the move it abuses it with (when the plan needs one).
// plan(fx, B, side): true for a move that puts the plan up this turn; the battle AI gives it a bonus on a
// forced side, so the setter sets up instead of just attacking.
// Membership is worked out from the data, so new characters join the archetypes they fit.
// No DOM, so it runs in a worker and in Node.

export const BRING = { setters: 1, abusers: 3 };
export const PICK = { setters: 1, abusers: 2 };

const moveOf = (data, e, f) => [...e.learn, ...(e.sig ? [e.sig] : [])].find(l => { const m = data.moves.get(l.id); return m && f(m.fx, m); });
const abilityOf = (e, f) => e.abilities.find(a => a.ab && f(a.ab));
const best = e => Math.max(e.stats.pow, e.stats.ene);
const bulk = e => (e.stats.vit + e.stats.grd + e.stats.wil) / 3;
// answers for setter / abuser: null (not one), or what the build must carry: { move } (a learnset entry),
// { ability } (an ability name), or {} (nothing in particular)
const viaMove = l => l ? { move: l.id } : null;
const viaAbility = a => a ? { ability: a.name } : null;
const entryField = f => ab => ab.entry?.some(o => o.op === 'field' && f(o.field));
const setupMove = (data, e) => viaMove(moveOf(data, e, (fx, m) => m.category === 'Status' && fx.boosts?.some(b => b.who === 'self' && ((b.stats.pow || 0) >= 2 || (b.stats.ene || 0) >= 2 || (b.stats.highest || 0) >= 1))));
// a strong own-type attack of this type
const typeAttacker = (data, e, type) => e.types.includes(type) && best(e) >= 100 ? viaMove(moveOf(data, e, (fx, m) => m.type === type && m.category !== 'Status' && (m.power || 0) >= 70)) : null;
const fieldPlan = type => (fx, B) => fx.field?.boostType === type && B.field?.boostType !== type;
const fieldSetter = type => (data, e) => viaAbility(abilityOf(e, entryField(f => f.boostType === type))) || viaMove(moveOf(data, e, fx => fx.field?.boostType === type));

export const ARCHETYPES = [
  { id: 'tailwind', name: 'Tailwind offense', note: 'Tailwind doubles the side\'s Speed for 4 turns; mid-speed hitters then outspeed everything.',
    setter: (data, e) => viaMove(moveOf(data, e, fx => fx.tailwind)), plan: (fx, B, side) => fx.tailwind && !side.tailwind,
    abuser: (data, e) => e.stats.spe >= 75 && e.stats.spe <= 110 && best(e) >= 115 ? {} : null },
  { id: 'trickRoom', name: 'Trick Room', note: 'Slow, hard-hitting characters move first for 5 turns.',
    setter: (data, e) => viaMove(moveOf(data, e, fx => fx.field?.trickRoom)), plan: (fx, B) => fx.field?.trickRoom && !B.field?.trickRoom,
    abuser: (data, e) => e.stats.spe <= 80 && best(e) >= 110 ? {} : null },
  { id: 'fire', name: 'Fire field', note: 'A Fire field (Bankai Yamamoto\'s Zanka no Tachi) powers up Fire attackers.',
    setter: fieldSetter('Fire'), plan: fieldPlan('Fire'), abuser: (data, e) => typeAttacker(data, e, 'Fire') },
  { id: 'water', name: 'Water field', note: 'A Water field (Juvia\'s Rain Woman) powers up Water attackers.',
    setter: fieldSetter('Water'), plan: fieldPlan('Water'), abuser: (data, e) => typeAttacker(data, e, 'Water') },
  { id: 'lightning', name: 'Lightning field', note: 'A Lightning field (Enel, Misaka, Zeus Nami, Lucy) powers up Lightning attackers.',
    setter: fieldSetter('Lightning'), plan: fieldPlan('Lightning'), abuser: (data, e) => typeAttacker(data, e, 'Lightning') },
  { id: 'snow', name: 'Snow', note: 'Snow on entry (Adult Bankai Toshiro\'s Tenso Jirin) for Ice attackers.',
    setter: (data, e) => viaAbility(abilityOf(e, entryField(f => f.snow))) || viaMove(moveOf(data, e, fx => fx.field?.snow)), plan: (fx, B) => fx.field?.snow && !B.field?.snow,
    abuser: (data, e) => typeAttacker(data, e, 'Ice') },
  { id: 'redirect', name: 'Redirection + setup', note: 'A Follow Me user draws the hits while a setup sweeper boosts.',
    setter: (data, e) => viaMove(moveOf(data, e, fx => fx.followMe)), plan: fx => fx.followMe,
    abuser: (data, e) => best(e) >= 110 ? setupMove(data, e) : null },
  { id: 'screens', name: 'Screens + setup', note: 'Screens halve the damage while a setup sweeper boosts.',
    setter: (data, e) => viaMove(moveOf(data, e, fx => fx.screen)), plan: (fx, B, side) => fx.screen && !side.screens[fx.screen],
    abuser: (data, e) => best(e) >= 110 ? setupMove(data, e) : null },
  { id: 'gravity', name: 'Gravity', note: 'Gravity makes every move more accurate and grounds flyers: heavy, inaccurate hitters land.',
    setter: (data, e) => viaMove(moveOf(data, e, fx => fx.field?.gravity)), plan: (fx, B) => fx.field?.gravity && !B.field?.gravity,
    abuser: (data, e) => best(e) >= 110 ? viaAbility(abilityOf(e, ab => ab.atk?.some(w => w.gravity))) || viaMove(moveOf(data, e, (fx, m) => m.category !== 'Status' && (m.power || 0) >= 90 && m.accuracy != null && m.accuracy <= 85)) : null },
  { id: 'balance', name: 'Intimidate + Fake Out balance', note: 'Intimidate and Fake Out buy turns for bulky attackers.',
    setter: (data, e) => viaAbility(abilityOf(e, ab => ab.entry?.some(o => o.op === 'foes' && o.intimidate))) || viaMove(moveOf(data, e, fx => fx.firstTurn && fx.flinch)),
    abuser: (data, e) => bulk(e) >= 95 && best(e) >= 110 ? {} : null },
  { id: 'spread', name: 'Spread offense', note: 'Moves that hit both foes, with Helping Hand behind them.',
    setter: (data, e) => viaMove(moveOf(data, e, fx => fx.helpingHand)), plan: fx => fx.helpingHand,
    abuser: (data, e) => best(e) >= 100 ? viaMove(moveOf(data, e, (fx, m) => m.category !== 'Status' && fx.spread && (m.power || 0) >= 80)) : null },
];
export const archetypeById = id => ARCHETYPES.find(a => a.id === id);

// The setters and abusers of an archetype among these entrants, with what each must carry.
export function roster(data, arch, ents) {
  const setters = new Map(), abusers = new Map();
  for (const e of ents) {
    const s = arch.setter(data, e), a = arch.abuser(data, e);
    if (s) setters.set(e.key, s);
    if (a) abusers.set(e.key, a);
  }
  return { setters, abusers };
}

// Whether a list of entrant keys has n setters and m abusers, each a different character. With `legend` (a
// key -> bool test) and `cap`, at most cap of the members counted may be legendary or mythical, as in a picked 6.
export function fits(keys, R, need, legend, cap = Infinity) {
  const plain = ks => {
    const s = ks.filter(k => R.setters.has(k)), a = ks.filter(k => R.abusers.has(k));
    if (s.length < need.setters || a.length < need.abusers) return false;
    return new Set([...s, ...a]).size >= need.setters + need.abusers;
  };
  if (!legend || cap >= keys.length) return plain(keys);
  const rest = keys.filter(k => !legend(k)), legs = keys.filter(legend);
  return plain(rest) || (cap >= 1 && legs.some(l => plain([...rest, l])));
}

// What a member of a forced team must carry, merged from its setter and abuser jobs.
export function forced(R, key) {
  const s = R.setters.get(key), a = R.abusers.get(key);
  if (!s && !a) return null;
  return { moves: [s?.move, a?.move].filter(Boolean), ability: s?.ability || a?.ability || null };
}
