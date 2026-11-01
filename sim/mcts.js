// The search AI (step 3 of the AI plan): slow but strong, used to measure and teach the fast AI (ai.js),
// not to run the big batches. Each turn it takes the k best options of each of its characters (from the
// fast AI's own scoring, plus a switch), and for each pair plays the rest of the battle out with new luck,
// many times, picking which pair to try next by UCB1. It keeps the pair it tried most.
// In those playouts the opponent plays the current AI 2 times in 3 and the frozen v1 otherwise, so the search
// doesn't bet on the foe playing exactly like itself. (Greedy was a third style until 2026-10-31: plays that
// only beat a foe who never protects or sets up, like Protect + Swords Dance, won its playouts.)
//
// A battle can't be copied mid-way, so every playout replays the battle from its seed with all the choices
// made so far, then branches at the start of this turn. To make that replay exact, the real battle never
// lets the engine's own AI choose (that would draw on the battle's random numbers): every choice for both
// sides is made here, with separate random numbers, and recorded.

import { runBattle, rng } from './battle.js';
import { chooseAction, chooseReplacement, options } from './ai.js';
import { BOTS } from './bots/baselines.js';

const STYLES = ['mirror', 'mirror', 'v1'];

// a seeded rng whose stream can be swapped mid-battle, so a playout gets new luck after the replayed part
function srng(seed) {
  let inner = rng(seed);
  const r = () => inner();
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = a => a[Math.floor(r() * a.length)];
  r.swap = s => { inner = rng(s); };
  return r;
}
// Choices are stored by position (side, slot in the team), so they can be replayed in another copy of the battle.
const enc = a => a.type === 'switch' ? { type: 'switch', to: a.to.side.mons.indexOf(a.to) }
  : { type: 'move', slot: a.slot, ts: a.target ? a.target.side.i : -1, t: a.target ? a.target.side.mons.indexOf(a.target) : -1 };
const dec = (B, m, a) => a.type === 'switch' ? { type: 'switch', to: m.side.mons[a.to] }
  : { type: 'move', slot: a.slot, target: a.t >= 0 ? B.sides[a.ts].mons[a.t] : undefined };
// run f with the battle's random numbers swapped for r, so an AI's noise doesn't touch the battle's luck
const withRng = (B, r, f) => { const keep = B.r; B.r = r; try { return f(); } finally { B.r = keep; } };

// Plays one battle with side `me` run by the search and the other side by `foe` (a bot from bots/baselines.js).
// me can be [0, 1] for both sides searching (foe is then unused), as the meta re-check does.
// bo: runBattle options with bo.rng a seeded rng. Returns the finished battle.
// onPlan(B, side, plan) sees each turn's chosen pair (slot -> choice) as soon as it is made (the scenario tests).
// With record set, B.replay.positions keeps every turn's options and how each scored, for teaching the fast AI.
export function playSearch(data, teams, bo, me, foe, { iters = 128, k = 4, record = false, onPlan } = {}) {
  const seed = Math.floor(bo.rng() * 1e9);              // every replay starts from this luck
  const mine = srng(seed + 1), theirs = srng(seed + 2), search = srng(seed + 3);
  const rec = [], turnStart = {}, positions = [], searching = [].concat(me), plan = [null, null];

  // One playout: replay the first `upto` recorded choices, then from turn T on our side plays `pair` this turn
  // and the fast AI after it, and the foe plays `style` throughout. With hidden builds (bo.beliefs), the foes have
  // the builds we believe from turn T on. Returns win (1) or not (0), plus a little for the Vitality lead so close
  // results still rank.
  function playout(upto, T, me, pair, style, luck) {
    const r = srng(seed), bot = BOTS[style];
    let i = 0, branched = false;
    const B = runBattle(data, teams, { ...bo, rng: r, assume: { side: me, turn: T }, decide: (kind, B, x, opts, extra) => {
      if (i < upto) { const d = rec[i++]; return kind === 'replace' ? x.mons[d] : dec(B, x, d); }
      if (!branched) { branched = true; r.swap(luck); }
      if (kind === 'replace') return x.i !== me && bot.replace ? bot.replace(B, x, opts) : null;
      if (x.side.i === me) return B.turn === T && !extra && pair.has(x.side.mons.indexOf(x)) ? dec(B, x, pair.get(x.side.mons.indexOf(x))) : null;
      return bot.action(B, x);
    } });
    const hp = s => s.mons.reduce((n, m) => n + (m.fainted ? 0 : m.hp / m.maxhp), 0) / s.mons.length;
    return (B.winner === me ? 1 : 0) + 0.1 * (hp(B.sides[me]) - hp(B.sides[1 - me]));
  }

  // The pair for this turn: candidates per character, then UCB1 over the pairs.
  function think(B, T, me) {
    const api = B.api, team = api.actives(B.sides[me]);
    const lists = team.map(m => {
      const opts = withRng(B, search, () => options(B, m, api)).slice(0, k);
      const bench = api.bench(m.side);
      if (!opts.some(o => o.type === 'switch') && bench.length && api.canSwitch(m) && m.t.turnsIn >= 1) opts.push({ type: 'switch', to: withRng(B, search, () => chooseReplacement(B, m.side, bench, api)) });
      return opts.map(enc);
    });
    let pairs = lists[0].map(a => [a]);
    if (lists[1]) pairs = pairs.flatMap(p => lists[1].filter(b => !(b.type === 'switch' && p[0].type === 'switch' && b.to === p[0].to)).map(b => [...p, b]));
    if (!pairs.length) pairs = [[lists[0][0]]];          // both can only switch to the same one: the partner falls back to the fast AI
    const slots = team.map(m => m.side.mons.indexOf(m));
    const asMap = p => new Map(p.map((a, j) => [slots[j], a]));
    if (pairs.length === 1) return asMap(pairs[0]);
    const N = pairs.map(() => 0), S = pairs.map(() => 0);
    for (let it = 0; it < Math.max(iters, pairs.length); it++) {
      let j = N.indexOf(0);
      if (j < 0) { const ln = Math.log(it); j = 0; let bv = -1; N.forEach((n, x) => { const v = S[x] / n + 0.5 * Math.sqrt(ln / n); if (v > bv) { bv = v; j = x; } }); }
      N[j]++; S[j] += playout(turnStart[T], T, me, asMap(pairs[j]), STYLES[Math.floor(search() * STYLES.length)], Math.floor(search() * 1e9));
    }
    let best = 0;
    N.forEach((n, x) => { if (n > N[best] || (n === N[best] && S[x] > S[best])) best = x; });
    if (record) positions.push({ at: rec.length, slots, pairs: pairs.map((p, x) => ({ a: p, n: N[x], v: N[x] ? S[x] / N[x] : 0 })) });
    return asMap(pairs[best]);
  }

  const B = runBattle(data, teams, { ...bo, rng: srng(seed), decide: (kind, B, x, opts, extra) => {
    if (kind === 'replace') {
      const pick = searching.includes(x.i) ? withRng(B, mine, () => chooseReplacement(B, x, opts, B.api))
        : withRng(B, theirs, () => (foe.replace && foe.replace(B, x, opts)) || chooseReplacement(B, x, opts, B.api));
      rec.push(x.mons.indexOf(pick));
      return pick;
    }
    if (turnStart[B.turn] == null) turnStart[B.turn] = rec.length;
    let act;
    const si = x.side.i;
    if (!searching.includes(si)) act = withRng(B, theirs, () => foe.action(B, x) || chooseAction(B, x, B.api));
    else if (extra) act = withRng(B, mine, () => chooseAction(B, x, B.api));
    else {
      if (plan[si]?.turn !== B.turn) { plan[si] = { turn: B.turn, acts: think(B, B.turn, si) }; onPlan?.(B, si, plan[si].acts); }
      const a = plan[si].acts.get(x.side.mons.indexOf(x));
      act = a ? dec(B, x, a) : withRng(B, mine, () => chooseAction(B, x, B.api));
    }
    rec.push(enc(act));
    return act;
  } });
  B.replay = { seed, choices: rec, ...(record ? { positions } : {}) };                    // for checking that replays give back this battle
  return B;
}

// Replays a battle from playSearch's B.replay: should end exactly as the original did.
export function replay(data, teams, bo, { seed, choices }) {
  let i = 0;
  return runBattle(data, teams, { ...bo, rng: srng(seed), decide: (kind, B, x) => { const d = choices[i++]; return kind === 'replace' ? x.mons[d] : dec(B, x, d); } });
}

// How close the fast AI (ai.js, with whatever weights W holds now) comes to the search's choices in a recorded
// battle: replays it, and at each recorded turn asks the fast AI for its pair. Regret is how much worse the
// search found that pair than its best one (a pair the search never tried counts as its worst tried).
export function judge(data, teams, bo, me, { seed, choices, positions }) {
  const at = new Map(positions.map(p => [p.at, p])), fast = srng(seed + 4), out = [];
  let i = 0;
  runBattle(data, teams, { ...bo, rng: srng(seed), decide: (kind, B, x) => {
    const P = at.get(i), d = choices[i++];
    if (P) {
      const act = withRng(B, fast, () => chooseAction(B, x, B.api));
      const plan = x.side.jointPlan?.turn === B.turn ? x.side.jointPlan.acts : null;
      const mine = P.slots.map(s => { const m = B.sides[me].mons[s]; return JSON.stringify(enc(m === x ? act : plan?.get(m) || act)); });
      const tried = P.pairs.filter(p => p.n), best = Math.max(...tried.map(p => p.v)), worst = Math.min(...tried.map(p => p.v));
      const hit = P.pairs.find(p => p.n && p.a.every((a, j) => JSON.stringify(a) === mine[j]));
      out.push({ regret: best - (hit ? hit.v : worst), agree: hit && hit.v === best ? 1 : 0, fast: mine.map(x => JSON.parse(x)), best: tried.find(p => p.v === best).a, slots: P.slots });
    }
    return kind === 'replace' ? x.mons[d] : dec(B, x, d);
  } });
  return out;
}
