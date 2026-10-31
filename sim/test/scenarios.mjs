// Hand-made doubles positions with a known right answer (gap #6 of the AI gap list): which ones the fast AI
// (ai.js) and the search AI (mcts.js) get right. A measuring stick, not a pass/fail check: it prints each
// scenario's hit rate over several seeds and the totals.
//   node sim/test/scenarios.mjs [fastSeeds=20] [searchSeeds=4] [iters=128]   (searchSeeds 0 skips the search AI)
//   node sim/test/scenarios.mjs --verify   checks each right answer by playing every choice out (see verify below)
// Side 0 is the AI under test. Every scenario uses the 'None' ability so only the named moves matter.
import fs from 'fs';
import { prepare, runBattle, rng } from '../battle.js';
import { RULES, typeEff } from '../rules.js';
import { chooseAction, estDamage } from '../ai.js';
import { playSearch } from '../mcts.js';
import { BOTS } from '../bots/baselines.js';

const [FAST = 20, SEARCH = 4, ITERS = 128] = process.argv.slice(2).filter(a => !a.startsWith('--')).map(Number);
const root = new URL('../../', import.meta.url);
const data = prepare(JSON.parse(fs.readFileSync(new URL('data/characters.json', root))), JSON.parse(fs.readFileSync(new URL('data/moves.json', root))).moves);
RULES.hpScale = 3;    // the competitive setting
const BO = { format: 'duos', level: 50, turnCap: 50 };

const ent = key => data.entrants.find(e => e.key === key) || (() => { throw new Error('no ' + key); })();
const NONE = { name: 'None', ab: { atk: [], def: [], immune: [], entry: [], hitBy: [], dealHit: [], endTurn: [], threshold: [], ko: [], allyFaint: [], faint: [], block: new Set(), unsupported: [] } };
const build = (key, ids, item) => ({ e: ent(key), ability: NONE, item,
  moves: ids.map(id => ({ id, as: data.moves.get(id).name, flags: { contact: data.moves.get(id).category === 'Physical' } })) });
const mon = (B, s, k) => B.sides[s].mons[k];
const hp = (m, f) => { m.hp = Math.max(1, Math.round(m.maxhp * f)); };
const moveId = (B, s, k, a) => a.type === 'move' ? mon(B, s, k).moves[a.slot].id : 'switch';
// Side s slot k's best expected hit (ai.js estDamage) on foe slot t, as a share of t's Vitality left: 1+ is a KO.
const ko = (B, s, k, t, id) => { const u = mon(B, s, k), d = mon(B, 1 - s, t); return Math.max(0, ...u.moves.filter(mv => !id || mv.id === id).map(mv => estDamage(B.api, u, mv, d))) * d.maxhp / d.hp; };
const targ = (B, a) => a.target ? `${a.target.side.i}:${a.target.side.mons.indexOf(a.target)}` : '-';

// teams: [ours, theirs], leads are the first two. setup(B) sets the position. right(B, acts) gets our two
// choices by lead slot (0, 1) and says whether they are right. why: the known answer, in words. premise(B) gives
// [holds, what] for the facts the answer rests on, checked before the AI chooses (the run stops if one fails).
const SCENARIOS = [
  { name: 'Fake Out on turn 1', why: 'Fake Out does what Tackle does, first, and flinches; the other moves do nothing on turn 1',
    teams: [[build('nanami', ['fake-out', 'tackle', 'splash', 'protect']), build('rengoku', ['flare-blitz', 'close-combat', 'protect', 'swords-dance'])],
            [build('levi', ['swords-dance', 'close-combat', 'protect', 'quick-attack']), build('sanji/2', ['swords-dance', 'flare-blitz', 'protect', 'quick-attack'])]],
    right: (B, a) => moveId(B, 0, 0, a[0]) === 'fake-out' && a[0].target?.side.i === 1 },
  { name: 'KO with priority when slower', why: 'a foe at 5% outspeeds and KOs either of ours (15% and 10%); Bullet Punch takes it first, Protect saves only one',
    teams: [[build('nanami', ['bullet-punch', 'mega-punch', 'protect', 'splash']), build('toriko', ['mega-punch', 'tackle'])],
            [build('levi', ['close-combat', 'tackle', 'splash', 'swords-dance']), build('toriko', ['mega-punch', 'tackle'])]],
    setup: B => { hp(mon(B, 0, 0), 0.15); hp(mon(B, 0, 1), 0.1); hp(mon(B, 1, 0), 0.05); },
    premise: B => [ko(B, 1, 0, 0) >= 1 && ko(B, 1, 0, 1) >= 1 && ko(B, 0, 0, 0, 'bullet-punch') >= 1 && B.api.speed(mon(B, 1, 0)) > B.api.speed(mon(B, 0, 0)), 'the foe outspeeds and KOs either of ours; Bullet Punch KOs it'],
    right: (B, a) => moveId(B, 0, 0, a[0]) === 'bullet-punch' && a[0].target === mon(B, 1, 0) },
  { name: 'Set Trick Room when slower', why: 'both ours are much slower than both foes',
    teams: [[build('onoki', ['trick-room', 'earth-power', 'protect', 'splash']), build('guts/2', ['bitter-blade', 'close-combat', 'protect', 'swords-dance'])],
            [build('levi', ['close-combat', 'protect', 'tackle', 'swords-dance']), build('david-martinez', ['close-combat', 'protect', 'tackle', 'swords-dance'])]],
    right: (B, a) => moveId(B, 0, 0, a[0]) === 'trick-room' },
  { name: "Don't Trick Room when faster", why: 'both ours are much faster than both foes; Trick Room would make them move last',
    teams: [[build('levi', ['trick-room', 'close-combat', 'protect', 'tackle']), build('david-martinez', ['bitter-blade', 'close-combat', 'protect', 'swords-dance'])],
            [build('onoki', ['earth-power', 'protect', 'tackle', 'splash']), build('guts/2', ['bitter-blade', 'close-combat', 'protect', 'swords-dance'])]],
    right: (B, a) => moveId(B, 0, 0, a[0]) !== 'trick-room' },
  { name: "Don't double Tailwind", why: 'Tailwind is already up for 3 more turns',
    teams: [[build('misaka', ['tailwind', 'thunderbolt', 'protect', 'splash']), build('rengoku', ['flare-blitz', 'protect', 'swords-dance', 'tackle'])],
            [build('nanami', ['mega-punch', 'protect', 'tackle', 'swords-dance']), build('toriko', ['mega-punch', 'protect', 'tackle', 'swords-dance'])]],
    setup: B => { B.sides[0].tailwind = 3; },
    right: (B, a) => moveId(B, 0, 0, a[0]) !== 'tailwind' },
  { name: "Don't Protect twice in a row", why: 'Protect was used last turn, so it works only 1 time in 3, while Close Combat hurts a foe at 40%',
    teams: [[build('toriko', ['protect', 'close-combat', 'swords-dance', 'tackle']), build('rengoku', ['flare-blitz', 'protect', 'close-combat', 'tackle'])],
            [build('levi', ['close-combat', 'protect', 'tackle', 'swords-dance']), build('david-martinez', ['close-combat', 'protect', 'tackle', 'swords-dance'])]],
    setup: B => { mon(B, 0, 0).vol.protectChain = 1; hp(mon(B, 1, 0), 0.4); },
    right: (B, a) => moveId(B, 0, 0, a[0]) !== 'protect' },
  { name: 'Take the KO on the threat', why: 'one foe is at 5% and hits hard (no Protect, no recoil to finish itself); the other is healthy',
    teams: [[build('rengoku', ['fire-punch', 'close-combat', 'protect', 'tackle']), build('toriko', ['splash'])],
            [build('sanji/2', ['close-combat', 'swords-dance', 'tackle', 'splash']), build('nanami', ['mega-punch', 'tackle', 'splash', 'swords-dance'])]],
    setup: B => { hp(mon(B, 1, 0), 0.05); },
    premise: B => [ko(B, 0, 0, 0) >= 1 && ko(B, 0, 0, 1) < 1, 'we KO the weak foe and not the healthy one'],
    right: (B, a) => a[0].type === 'move' && a[0].target === mon(B, 1, 0) },
  { name: 'KO the foe without a Last Thread', why: 'both foes are at full Vitality and one Fire Punch KOs either, but the first holds a Last Thread and would hang on at 1; ours are low',
    teams: [[build('rengoku', ['fire-punch', 'tackle', 'splash']), build('toriko', ['splash'])],
            [build('nanami', ['mega-punch', 'tackle', 'splash', 'swords-dance'], 'last-thread'), build('nanami', ['mega-punch', 'tackle', 'splash', 'swords-dance'])]],
    setup: B => { for (const m of B.sides[1].mons) { m.maxhp = m.hp = Math.round(m.maxhp / 8); } hp(mon(B, 0, 0), 0.3); hp(mon(B, 0, 1), 0.3); },
    premise: B => [ko(B, 0, 0, 0) >= 1 && ko(B, 0, 0, 1) >= 1, 'Fire Punch KOs either foe (but for the Last Thread)'],
    right: (B, a) => moveId(B, 0, 0, a[0]) === 'fire-punch' && a[0].target === mon(B, 1, 1) },
  { name: "Don't hit an immune foe", why: 'Thunderbolt does nothing to the Earth type; Tackle the other or Thunderbolt the other',
    premise: B => [typeEff('Lightning', mon(B, 1, 0).e.types) === 0, 'the first foe is immune to Lightning'],
    teams: [[build('misaka', ['thunderbolt', 'tackle', 'protect', 'splash']), build('toriko', ['splash'])],
            [build('onoki', ['tackle', 'protect', 'splash', 'swords-dance']), build('nanami', ['tackle', 'protect', 'splash', 'swords-dance'])]],
    right: (B, a) => !(moveId(B, 0, 0, a[0]) === 'thunderbolt' && a[0].target === mon(B, 1, 0)) },
  { name: "Don't status a statused foe", why: 'both foes are already stunned; Thunder Wave does nothing',
    teams: [[build('misaka', ['thunder-wave', 'thunderbolt', 'protect', 'splash']), build('toriko', ['splash'])],
            [build('nanami', ['tackle', 'protect', 'splash', 'swords-dance']), build('toriko', ['tackle', 'protect', 'splash', 'swords-dance'])]],
    setup: B => { mon(B, 1, 0).status = 'stun'; mon(B, 1, 1).status = 'stun'; },
    right: (B, a) => moveId(B, 0, 0, a[0]) !== 'thunder-wave' },
  { name: 'Switch out of a lost matchup', why: 'our Fire lead, at 60%, only has resisted Fire moves into two Water foes that KO it; the bench resists Water and hits both 2x',
    teams: [[build('ace', ['flamethrower', 'fire-blast', 'protect', 'splash']), build('toriko', ['lunge', 'mega-punch', 'protect', 'tackle']), build('kagami', ['poison-jab', 'leech-life', 'protect', 'splash'])],
            [build('giyu', ['waterfall', 'aqua-jet', 'protect', 'swords-dance']), build('rem/2', ['waterfall', 'aqua-jet', 'protect', 'swords-dance'])]],
    setup: B => { hp(mon(B, 0, 0), 0.6); mon(B, 0, 0).t.turnsIn = 1; },    // a character can't switch on the turn it came in
    premise: B => [ko(B, 1, 0, 0) + ko(B, 1, 1, 0) >= 1, 'two Waterfalls KO the lead'],
    right: (B, a) => a[0].type === 'switch' },
];

const STOP = new Error('stop');
const setup = sc => B => {
  sc.setup?.(B);
  const [holds, what] = sc.premise?.(B) || [true];
  if (!holds) throw new Error(`${sc.name}: premise fails: ${what}`);
};
// The fast AI's two choices in the scenario's position.
function fast(sc, seed) {
  const acts = [];
  try {
    runBattle(data, sc.teams, { ...BO, rng: rng(seed), setup: setup(sc), decide: (kind, B, m) => {
      if (kind !== 'action' || m.side.i !== 0) return null;
      acts[m.side.mons.indexOf(m)] = chooseAction(B, m, B.api);
      if (acts.filter(Boolean).length === 2) { acts.B = B; throw STOP; }
      return acts[m.side.mons.indexOf(m)];
    } });
  } catch (e) { if (e !== STOP) throw e; }
  return acts;
}
// The search AI's pair (the foe plays the current fast AI; the search's playouts mix foe styles as usual).
function search(sc, seed) {
  const acts = [];
  try {
    playSearch(data, sc.teams, { ...BO, rng: rng(seed), setup: setup(sc) }, 0, BOTS.mirror, { iters: ITERS, onPlan: (B, s, plan) => {
      if (s !== 0) return;
      for (const [k, a] of plan) acts[k] = a.type === 'switch' ? { type: 'switch' } : { type: 'move', slot: a.slot, target: a.t >= 0 ? B.sides[a.ts].mons[a.t] : null };
      acts.B = B; throw STOP;
    } });
  } catch (e) { if (e !== STOP) throw e; }
  return acts;
}

// --verify: checks the answers themselves. Every turn-1 choice of our first lead (each move into each foe, each
// switch) is forced and the battle played out by the fast AI on both sides; the best right choice should score
// better than every wrong one (score: win rate + 0.1 x Vitality lead).
function verify(sc, n = 400) {
  const lead = sc.teams[0][0];
  const cands = [];
  for (let slot = 0; slot < lead.moves.length; slot++) for (const t of [0, 1]) cands.push({ type: 'move', slot, t });
  for (let k = 2; k < sc.teams[0].length; k++) cands.push({ type: 'switch', k });
  return cands.map(c => {
    let w = 0, B;
    for (let s = 1; s <= n; s++) {
      B = runBattle(data, sc.teams, { ...BO, rng: rng(s), setup: setup(sc), decide: (kind, B, m) => kind === 'action' && B.turn === 1 && m === mon(B, 0, 0)
        ? (c.type === 'switch' ? { type: 'switch', to: mon(B, 0, c.k) } : { type: 'move', slot: c.slot, target: mon(B, 1, c.t) }) : null });
      // a win, plus a little for the Vitality lead (as the search scores playouts), so lopsided positions still rank
      const left = i => B.sides[i].mons.reduce((n, m) => n + (m.fainted ? 0 : m.hp / m.maxhp), 0) / B.sides[i].mons.length;
      w += (B.winner === 0 ? 1 : B.winner < 0 ? 0.5 : 0) + 0.1 * (left(0) - left(1));
    }
    const a = c.type === 'switch' ? { type: 'switch', to: mon(B, 0, c.k) } : { type: 'move', slot: c.slot, target: mon(B, 1, c.t) };
    return { name: c.type === 'switch' ? 'switch' : `${lead.moves[c.slot].id}>${c.t}`, right: sc.right(B, [a]), wr: w / n };
  });
}
if (process.argv.includes('--verify')) {
  let bad = 0;
  for (const sc of SCENARIOS) {
    const v = verify(sc), best = r => Math.max(-1, ...v.filter(x => x.right === r).map(x => x.wr));
    const ok = best(true) > best(false);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${sc.name.padEnd(32)} best right ${(100 * best(true)).toFixed(1)}, best wrong ${(100 * best(false)).toFixed(1)}   ${v.map(x => `${x.name}${x.right ? '*' : ''} ${(100 * x.wr).toFixed(1)}`).join(', ')}`);
  }
  process.exit(bad ? 1 : 0);
}

const tot = { fast: [0, 0], search: [0, 0] };
for (const sc of SCENARIOS) {
  const row = {};
  for (const [kind, f, n] of [['fast', fast, FAST], ['search', search, SEARCH]]) {
    if (!n) continue;
    let hit = 0; const wrong = {};
    for (let s = 1; s <= n; s++) {
      const a = f(sc, s);
      if (sc.right(a.B, a)) hit++;
      else { const k = `${moveId(a.B, 0, 0, a[0])}>${targ(a.B, a[0])}`; wrong[k] = (wrong[k] || 0) + 1; }
    }
    tot[kind][0] += hit; tot[kind][1] += n;
    row[kind] = `${hit}/${n}` + (hit < n ? ` (wrong: ${Object.entries(wrong).map(([k, v]) => `${k} x${v}`).join(', ')})` : '');
  }
  console.log(`${sc.name.padEnd(32)} fast ${row.fast ?? '-'}${row.search ? `   search ${row.search}` : ''}`);
}
const pct = ([h, n]) => n ? `${(100 * h / n).toFixed(0)}%` : '-';
console.log(`\nright: fast ${pct(tot.fast)} (bar 90%), search ${pct(tot.search)} (bar 95%)`);
