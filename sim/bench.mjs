// AI test bench. Run it before and after every AI change and add the numbers to docs/balance-history.md.
//
//   node sim/bench.mjs strength [battles per opponent = 1000] [seed = 1]
//     The current AI (sim/ai.js) against fixed opponents in competitive doubles mirror matches: the same 6 on
//     both sides (random legal teams, AI-trained builds), Vitality x3. Games come in pairs with the same team
//     and the same luck, sides swapped, so team strength, side and luck cancel out. Prints win / loss / draw
//     with a 95% margin, and ms per battle.
//   node sim/bench.mjs search [battles per opponent = 100] [seed = 1] [playouts a turn = 128]
//     The same, for the search AI (sim/mcts.js) against the current AI, frozen v1 and greedy, on every core.
//   node sim/bench.mjs hidden [battles = 2000] [seed = 1]
//     The current AI seeing foe builds only as it guessed them (batch --hidden) against the same AI seeing them
//     exactly, same mirror matches. A small gap means hiding builds costs little skill.
//   node sim/bench.mjs stability run1.json run2.json [run3.json ...]
//     Compares meta chains saved with  node sim/cli.mjs 200000 comp <seed> --draft --hp=3 --forms=all
//     --search=meta --arch --json=runN.json  (use a different seed per run): how far the runs agree.
//     Population metas (--search=pop) compare the same way, with each character weighted by its Nash share.
import fs from 'fs';
import os from 'os';
import { pathToFileURL } from 'url';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { playSearch } from './mcts.js';
import { prepare, runBattle, rng } from './battle.js';
import { makeBuild, entrantPool, withFormat } from './batch.js';
import { trainTeam } from './builds.js';
import { RULES } from './rules.js';
import { BOTS } from './bots/baselines.js';
import { guessBuilds } from './draft.js';

const [cmd = 'strength', ...rest] = process.argv.slice(2);

// Mirror-match arena: game n of a seed is one half of a pair (same team, same luck, sides swapped).
// play(bot, seed, n, player?) returns res ('w', 'l' or 'd' for the current AI) and the turns.
export function arena() {
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
  // player(data, teams, battleOpts, me, bot) plays our side instead of the current AI (the search AI does)
  const play = (name, seed, n, player) => {
    const bot = BOTS[name], k = Math.floor(n / 2), me = n % 2;
    const tm = team(rng(seed * 1e6 + k));
    const bo = { format: 'duos', level: opts.level, turnCap: opts.turnCap, rng: rng(seed * 1e6 + k + 5e5) };
    const B = player ? player(data, [tm, tm], bo, me, bot) : runBattle(data, [tm, tm], { ...bo,
      decide: (kind, B, x, options) => kind === 'action' ? (x.side.i !== me ? bot.action(B, x) : null) : (x.i !== me && bot.replace ? bot.replace(B, x, options) : null) });
    return { res: B.winner === me ? 'w' : B.winner < 0 ? 'd' : 'l', turns: B.turn, B };
  };
  // the same battle's setup, for replaying it (sim/mcts.js judge)
  play.setup = (seed, n) => { const tm = team(rng(seed * 1e6 + Math.floor(n / 2))); return { data, teams: [tm, tm], bo: { format: 'duos', level: opts.level, turnCap: opts.turnCap }, me: n % 2 }; };
  return play;
}

function hidden(battles = 2000, seed = 1) {
  const play = arena(), opts = withFormat({ format: 'comp', forms: 'all', movesets: 'smart' });
  const guess = (data, t) => { const g = guessBuilds(data, t.map(b => b.e), makeBuild, opts); return t.map(b => g.find(x => x.e.key === b.e.key)); };
  let w = 0, l = 0;
  for (let n = 0; n < battles; n++) {
    const g = play('mirror', seed, n, (data, teams, bo, me) => runBattle(data, teams, { ...bo, beliefs: me === 0 ? [guess(data, teams[1]), null] : [null, guess(data, teams[0])] }));
    if (g.res === 'w') w++; else if (g.res === 'l') l++;
  }
  const p = w / battles;
  console.log(`hidden-info AI vs full-info AI, ${battles} mirror battles, seed ${seed}: won ${(100 * p).toFixed(1)}% ±${(196 * Math.sqrt(p * (1 - p) / battles)).toFixed(1)}, lost ${(100 * l / battles).toFixed(1)}%`);
}

function strength(battles = 1000, seed = 1) {
  const play = arena();
  console.log(`Current AI vs each opponent: ${battles} mirror battles each, Vitality x3, seed ${seed}`);
  for (const name of Object.keys(BOTS)) {
    let w = 0, l = 0, d = 0, turns = 0;
    const t0 = performance.now();
    for (let n = 0; n < battles; n++) {
      const g = play(name, seed, n);
      if (g.res === 'w') w++; else if (g.res === 'd') d++; else l++;
      turns += g.turns;
    }
    const ms = (performance.now() - t0) / battles, p = w / battles, moe = 1.96 * Math.sqrt(p * (1 - p) / battles);
    console.log(`${name.padEnd(7)} won ${(100 * p).toFixed(1)}% ±${(100 * moe).toFixed(1)}, lost ${(100 * l / battles).toFixed(1)}%, drew ${(100 * d / battles).toFixed(1)}%, ${(turns / battles).toFixed(1)} turns, ${ms.toFixed(1)} ms/battle`);
  }
}

// ---- stability across saved meta chains ----
function stability(files) {
  const runs = files.map(f => JSON.parse(fs.readFileSync(f)));
  // each character's share of the meta: a chain counts its meta teams equally, a population meta by Nash weight
  const share = R => {
    const c = {}, ts = R.pop ? R.pop.teams.map(t => [t, t.weight]) : R.chain.teams.filter(t => !t.arch).map((t, _, a) => [t, 1 / a.length]);
    for (const [t, w] of ts) for (const k of t.keys) c[k] = (c[k] || 0) + w;
    return c;
  };
  // characters by share, top 12
  const top = R => { const c = share(R); return Object.keys(c).filter(k => c[k] > 0.005).sort((a, b) => c[b] - c[a]).slice(0, 12); };
  // how much of the meta two runs share: the overlap of their character shares, as a fraction of a run's total (team size; 8 when bringing 8)
  const overlap = (a, b) => Object.keys(a).reduce((s, k) => s + Math.min(a[k], b[k] || 0), 0) / Object.values(a).reduce((s, x) => s + x, 0);
  // an archetype team's win rate over the final round robin (against the mix, for a population meta)
  const archWr = R => R.pop ? Object.fromEntries(R.pop.teams.filter(t => t.arch).map(t => [t.archName, t.vsMix])) : Object.fromEntries(R.chain.teams.filter(t => t.arch).map(t => {
    const k = [...t.keys].sort().join('+'); let g = 0, w = 0;
    for (const [hk, v] of Object.entries(R.chain.h2h)) if (hk.split('|')[0] === k) { g += v.g; w += v.w; }
    return [t.archName, g ? w / g : NaN];
  }));
  // win rate when picked, per character with 200+ picks
  const picked = R => Object.fromEntries(Object.entries(R.stats.bring || {}).filter(([, v]) => v.p >= 200).map(([k, v]) => [k, v.pw / v.p]));
  // ties share their average rank (pooled shares have many zeros), and the correlation is Pearson's on the ranks
  const rank = xs => { const o = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = []; for (let j = 0; j < o.length;) { let e = j; while (e + 1 < o.length && o[e + 1][0] === o[j][0]) e++; for (let q = j; q <= e; q++) r[o[q][1]] = (j + e) / 2; j = e + 1; } return r; };
  const spearman = (a, b) => { const ks = Object.keys(a).filter(k => k in b); if (ks.length < 5) return NaN; const ra = rank(ks.map(k => a[k])), rb = rank(ks.map(k => b[k])), m = (ks.length - 1) / 2; let sab = 0, saa = 0, sbb = 0; ra.forEach((x, i) => { sab += (x - m) * (rb[i] - m); saa += (x - m) ** 2; sbb += (rb[i] - m) ** 2; }); return sab / Math.sqrt(saa * sbb); };
  const pairs = [];
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) pairs.push([i, j]);
  const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const T = runs.map(top), A = runs.map(archWr), P = runs.map(picked);
  console.log(`${runs.length} runs: ${files.join(', ')}`);
  console.log(`Top-12 meta characters shared, average over pairs: ${avg(pairs.map(([i, j]) => T[i].filter(k => T[j].includes(k)).length)).toFixed(1)} of 12`);
  const SH = runs.map(share);
  console.log(`Meta share overlap, average over pairs: ${(100 * avg(pairs.map(([i, j]) => overlap(SH[i], SH[j])))).toFixed(0)}%`);
  console.log(`Win-rate-when-picked rank correlation, average over pairs: ${avg(pairs.map(([i, j]) => spearman(P[i], P[j]))).toFixed(2)}`);
  const names = [...new Set(A.flatMap(a => Object.keys(a)))];
  const spreads = names.map(nm => { const xs = A.map(a => a[nm]).filter(isFinite); return [nm, xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : NaN, xs]; });
  console.log(`Archetype win rate spread across runs (largest ${(100 * Math.max(...spreads.map(s => s[1]).filter(isFinite))).toFixed(0)} points):`);
  for (const [nm, sp, xs] of spreads) console.log(`  ${nm.padEnd(30)} ${xs.map(x => (100 * x).toFixed(0) + '%').join(' / ').padEnd(20)} spread ${(100 * sp).toFixed(0)}`);
  if (runs.length < 4) return;

  // pooled runs: how far two disjoint groups of m runs agree once each group's results are averaged
  const poolShare = ix => { const c = {}; for (const i of ix) for (const k in SH[i]) c[k] = (c[k] || 0) + SH[i][k] / ix.length; return c; };
  const poolPicked = ix => { const c = {}; for (const i of ix) for (const [k, v] of Object.entries(runs[i].stats.bring || {})) { c[k] ??= { p: 0, pw: 0 }; c[k].p += v.p; c[k].pw += v.pw; } return Object.fromEntries(Object.entries(c).filter(([, v]) => v.p >= 200 * ix.length).map(([k, v]) => [k, v.pw / v.p])); };
  const top40 = (a, b) => { const ks = new Set([a, b].flatMap(c => Object.keys(c).sort((x, y) => c[y] - c[x]).slice(0, 40))); const f = c => Object.fromEntries([...ks].map(k => [k, c[k] || 0])); return spearman(f(a), f(b)); };
  const r = rng(7);
  console.log(`\nPooled groups (disjoint groups of m runs, averaged over 30 random splits):`);
  console.log(`   m   top-12 shared   share overlap   share rank corr (top 40)   picked win rate rank corr`);
  for (let m = 1; 2 * m <= runs.length; m *= 2) {
    const out = [[], [], [], []];
    for (let t = 0; t < 30; t++) {
      const ix = runs.map((_, i) => i); for (let i = ix.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ix[i], ix[j]] = [ix[j], ix[i]]; }
      const a = poolShare(ix.slice(0, m)), b = poolShare(ix.slice(m, 2 * m));
      const ta = Object.keys(a).sort((x, y) => a[y] - a[x]).slice(0, 12), tb = Object.keys(b).sort((x, y) => b[y] - b[x]).slice(0, 12);
      out[0].push(ta.filter(k => tb.includes(k)).length); out[1].push(overlap(a, b)); out[2].push(top40(a, b)); out[3].push(spearman(poolPicked(ix.slice(0, m)), poolPicked(ix.slice(m, 2 * m))));
    }
    console.log(`  ${String(m).padStart(2)}   ${avg(out[0]).toFixed(1).padStart(6)} of 12   ${(100 * avg(out[1])).toFixed(0).padStart(8)}%   ${avg(out[2]).toFixed(2).padStart(14)}   ${avg(out[3]).toFixed(2).padStart(24)}`);
  }
  // each top character's share across all runs, with its error bar across runs (not battles)
  const all = poolShare(runs.map((_, i) => i));
  const slots = Object.values(all).reduce((s, x) => s + x, 0);
  console.log(`\nTop 20 by pooled meta share (share of meta team slots; ±95% across runs; runs it appears in):`);
  for (const k of Object.keys(all).sort((a, b) => all[b] - all[a]).slice(0, 20)) {
    const xs = SH.map(c => c[k] || 0), sd = Math.sqrt(xs.reduce((s, x) => s + (x - all[k]) ** 2, 0) / (xs.length - 1));
    console.log(`  ${k.padEnd(34)} ${(100 * all[k] / slots).toFixed(1).padStart(5)}% ±${(100 * 1.96 * sd / Math.sqrt(xs.length) / slots).toFixed(1)}   ${xs.filter(x => x > 0).length}/${xs.length}`);
  }
}

// ---- the search AI (sim/mcts.js) against the fixed opponents, split over every core ----
const SEARCH_FOES = ['mirror', 'v1', 'greedy'];
async function searchStrength(battles = 100, seed = 1, iters = 128, record = null) {
  const recs = [];
  const n = os.availableParallelism?.() || os.cpus().length;
  console.log(`Search AI (${iters} playouts a turn) vs each opponent: ${battles} mirror battles each, Vitality x3, seed ${seed}, ${n} workers`);
  for (const name of SEARCH_FOES) {
    const t0 = performance.now(), tally = { w: 0, l: 0, d: 0, turns: 0 };
    await Promise.all(Array.from({ length: n }, (_, i) => new Promise((done, fail) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { searchJob: { name, seed, iters, record: !!record, games: Array.from({ length: battles }, (_, g) => g).filter(g => g % n === i) } } });
      w.once('message', t => { for (const k in tally) tally[k] += t[k]; recs.push(...t.recs); w.terminate(); done(); });
      w.once('error', fail);
    })));
    const p = tally.w / battles, moe = 1.96 * Math.sqrt(p * (1 - p) / battles);
    console.log(`${name.padEnd(7)} won ${(100 * p).toFixed(1)}% ±${(100 * moe).toFixed(1)}, lost ${(100 * tally.l / battles).toFixed(1)}%, drew ${(100 * tally.d / battles).toFixed(1)}%, ${(tally.turns / battles).toFixed(1)} turns, ${((performance.now() - t0) / battles * n / 1000).toFixed(1)} s/battle per core`);
  }
  // the search's choices, for teaching the fast AI:  node sim/tune.mjs 40 0 1 --distill=file
  if (record) fs.writeFileSync(record, JSON.stringify(recs));
}

if (!isMainThread && workerData?.searchJob) {
  const { name, seed, iters, games, record } = workerData.searchJob, play = arena(), t = { w: 0, l: 0, d: 0, turns: 0 }, recs = [];
  const player = (data, teams, bo, me, bot) => playSearch(data, teams, bo, me, bot, { iters, record });
  for (const g of games) { const x = play(name, seed, g, player); t[x.res]++; t.turns += x.turns; if (record) recs.push({ seed, n: g, replay: x.B.replay }); }
  parentPort.postMessage({ ...t, recs });
}
else if (!isMainThread || import.meta.url !== pathToFileURL(process.argv[1]).href) { /* imported by tune.mjs */ }
else if (cmd === 'strength') strength(+rest[0] || 1000, +rest[1] || 1);
else if (cmd === 'search') searchStrength(+rest[0] || 100, +rest[1] || 1, +rest[2] || 128, process.argv.find(a => a.startsWith('--record='))?.slice(9));
else if (cmd === 'hidden') hidden(+rest[0] || 2000, +rest[1] || 1);
else if (cmd === 'stability') stability(rest);
else console.log('usage: node sim/bench.mjs strength [battles] [seed] | search [battles] [seed] [playouts] | stability run1.json run2.json ...');
