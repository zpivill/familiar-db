// AI test bench. Run it before and after every AI change and add the numbers to docs/balance-history.md.
//
//   node sim/bench.mjs strength [battles per opponent = 1000] [seed = 1]
//     The current AI (sim/ai.js) against fixed opponents in competitive doubles mirror matches: the same 6 on
//     both sides (random legal teams, AI-trained builds), Vitality x3. Games come in pairs with the same team
//     and the same luck, sides swapped, so team strength, side and luck cancel out. Prints win / loss / draw
//     with a 95% margin, and ms per battle.
//   node sim/bench.mjs stability run1.json run2.json [run3.json ...]
//     Compares meta chains saved with  node sim/cli.mjs 200000 comp <seed> --draft --hp=3 --forms=all
//     --search=meta --arch --json=runN.json  (use a different seed per run): how far the runs agree.
import fs from 'fs';
import { prepare, runBattle, rng } from './battle.js';
import { makeBuild, entrantPool, withFormat } from './batch.js';
import { trainTeam } from './builds.js';
import { RULES } from './rules.js';
import { usable, estDamage } from './ai.js';
import * as v1 from './bots/ai-v1.js';

const [cmd = 'strength', ...rest] = process.argv.slice(2);

// ---- opponents: each returns an action for mon m, or a replacement for side s ----
const pickOne = (r, xs) => xs[Math.floor(r() * xs.length)];
const BOTS = {
  // any usable move into any foe
  random: { action: (B, m) => {
    const foes = B.api.foesOf(m), ok = m.moves.map((mv, i) => [mv, i]).filter(([mv]) => usable(m, mv));
    const [, slot] = ok.length ? pickOne(B.r, ok) : [null, 0];
    return { type: 'move', slot, target: pickOne(B.r, foes) };
  } },
  // the hardest-hitting attack into the best target, never a status move or a switch
  greedy: { action: (B, m) => {
    const api = B.api, foes = api.foesOf(m);
    let best = null, bv = -1;
    m.moves.forEach((mv, i) => {
      if (!usable(m, mv) || mv.m.cat === 'Status') return;
      for (const f of foes) { const v = estDamage(api, m, mv, f) * (mv.m.fx.spread ? foes.length * 0.75 : 1); if (v > bv) { bv = v; best = { type: 'move', slot: i, target: f }; } }
    });
    return best;
  } },
  // the frozen AI from 2026-10-29
  v1: { action: (B, m) => v1.chooseAction(B, m, B.api), replace: (B, s, options) => v1.chooseReplacement(B, s, options, B.api) },
  // the current AI against itself: should come out even
  mirror: { action: () => null },
};

function strength(battles = 1000, seed = 1) {
  RULES.hpScale = 3;
  const here = new URL('..', import.meta.url);
  const data = prepare(JSON.parse(fs.readFileSync(new URL('data/characters.json', here))), JSON.parse(fs.readFileSync(new URL('data/moves.json', here))).moves);
  const opts = withFormat({ format: 'comp', forms: 'all', movesets: 'smart' });
  const pool = entrantPool(data, opts), LEG = new Set(['legendary', 'mythical']);
  const team = r => {
    const t = [], used = new Set();
    while (t.length < 6) { const e = r.pick(pool); if (used.has(e.cid) || (LEG.has(e.rarity) && t.some(x => LEG.has(x.rarity)))) continue; used.add(e.cid); t.push(e); }
    return trainTeam(data, t.map(e => makeBuild(data, e, r, opts)), r, opts);
  };
  console.log(`Current AI vs each opponent: ${battles} mirror battles each, Vitality x3, seed ${seed}`);
  for (const [name, bot] of Object.entries(BOTS)) {
    let w = 0, l = 0, d = 0, turns = 0;
    const t0 = performance.now();
    for (let n = 0; n < battles; n++) {
      const k = Math.floor(n / 2), me = n % 2;          // a pair: same team, same luck, sides swapped
      const tm = team(rng(seed * 1e6 + k));
      const B = runBattle(data, [tm, tm], { format: 'duos', level: opts.level, turnCap: opts.turnCap, rng: rng(seed * 1e6 + k + 5e5),
        decide: (kind, B, x, options) => kind === 'action' ? (x.side.i !== me ? bot.action(B, x) : null) : (x.i !== me && bot.replace ? bot.replace(B, x, options) : null) });
      if (B.winner === me) w++; else if (B.winner < 0) d++; else l++;
      turns += B.turn;
    }
    const ms = (performance.now() - t0) / battles, p = w / battles, moe = 1.96 * Math.sqrt(p * (1 - p) / battles);
    console.log(`${name.padEnd(7)} won ${(100 * p).toFixed(1)}% ±${(100 * moe).toFixed(1)}, lost ${(100 * l / battles).toFixed(1)}%, drew ${(100 * d / battles).toFixed(1)}%, ${(turns / battles).toFixed(1)} turns, ${ms.toFixed(1)} ms/battle`);
  }
}

// ---- stability across saved meta chains ----
function stability(files) {
  const runs = files.map(f => JSON.parse(fs.readFileSync(f)));
  const meta = R => R.chain.teams.filter(t => !t.arch);
  // characters by how many meta-team spots they hold, top 12
  const top = R => { const c = {}; meta(R).forEach(t => t.keys.forEach(k => { c[k] = (c[k] || 0) + 1; })); return Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, 12); };
  // an archetype team's win rate over the final round robin
  const archWr = R => Object.fromEntries(R.chain.teams.filter(t => t.arch).map(t => {
    const k = [...t.keys].sort().join('+'); let g = 0, w = 0;
    for (const [hk, v] of Object.entries(R.chain.h2h)) if (hk.split('|')[0] === k) { g += v.g; w += v.w; }
    return [t.archName, g ? w / g : NaN];
  }));
  // win rate when picked, per character with 200+ picks
  const picked = R => Object.fromEntries(Object.entries(R.stats.bring || {}).filter(([, v]) => v.p >= 200).map(([k, v]) => [k, v.pw / v.p]));
  const rank = xs => { const o = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; o.forEach(([, i], j) => { r[i] = j; }); return r; };
  const spearman = (a, b) => { const ks = Object.keys(a).filter(k => k in b); if (ks.length < 5) return NaN; const ra = rank(ks.map(k => a[k])), rb = rank(ks.map(k => b[k])), n = ks.length; return 1 - 6 * ks.reduce((s, _, i) => s + (ra[i] - rb[i]) ** 2, 0) / (n * (n * n - 1)); };
  const pairs = [];
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) pairs.push([i, j]);
  const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const T = runs.map(top), A = runs.map(archWr), P = runs.map(picked);
  console.log(`${runs.length} runs: ${files.join(', ')}`);
  console.log(`Top-12 meta characters shared, average over pairs: ${avg(pairs.map(([i, j]) => T[i].filter(k => T[j].includes(k)).length)).toFixed(1)} of 12`);
  console.log(`Win-rate-when-picked rank correlation, average over pairs: ${avg(pairs.map(([i, j]) => spearman(P[i], P[j]))).toFixed(2)}`);
  const names = [...new Set(A.flatMap(a => Object.keys(a)))];
  const spreads = names.map(nm => { const xs = A.map(a => a[nm]).filter(isFinite); return [nm, xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : NaN, xs]; });
  console.log(`Archetype win rate spread across runs (largest ${(100 * Math.max(...spreads.map(s => s[1]).filter(isFinite))).toFixed(0)} points):`);
  for (const [nm, sp, xs] of spreads) console.log(`  ${nm.padEnd(30)} ${xs.map(x => (100 * x).toFixed(0) + '%').join(' / ').padEnd(20)} spread ${(100 * sp).toFixed(0)}`);
}

if (cmd === 'strength') strength(+rest[0] || 1000, +rest[1] || 1);
else if (cmd === 'stability') stability(rest);
else console.log('usage: node sim/bench.mjs strength [battles] [seed] | stability run1.json run2.json ...');
