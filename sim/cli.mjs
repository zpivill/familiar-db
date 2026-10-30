// Run a batch from the command line:  node sim/cli.mjs [count] [duel|team|duos|comp] [seed] [watch]
// Flags: --trained (AI-chosen EVs, nature, IVs and held items), --level=50, --size=4,
// --draft (comp only: bring 8 and draft 6), --bring=10, --hp=3 (Vitality multiplier), --forms=all,
// --workers=4 (default: every core; results repeat for the same seed and worker count),
// --search=best|meta (Strongest teams / Meta chain, as on the page), --arch (archetype rounds), --ban=2,
// --json=out.json (save the results, e.g. for sim/bench.mjs),
// --recheck=meta.json (replay a saved meta chain's final round robin with the search AI on both sides, [count]
// battles in all, --iters=128 playouts a turn, and compare each team's win rate with the fast AI's)
// Prints the top and bottom characters by win rate (or the meta teams) and how long it took.
import fs from 'fs';
import os from 'os';
import { Worker } from 'worker_threads';
import { prepare, rng } from './battle.js';
import { watchBattle } from './batch.js';
import { RULES } from './rules.js';
import { searchTeams, metaChain } from './search.js';
import { ARCHETYPES } from './archetypes.js';

const here = new URL('..', import.meta.url);
const chars = JSON.parse(fs.readFileSync(new URL('data/characters.json', here)));
const moves = JSON.parse(fs.readFileSync(new URL('data/moves.json', here))).moves;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = n => process.argv.find(a => a.startsWith('--' + n + '='))?.split('=')[1] ?? (process.argv.includes('--' + n) ? true : undefined);
const [count = '1000', format = 'duel', seed = '1', watch] = args;
const extra = { ...(flag('trained') ? { training: 'ai', items: 'ai' } : {}), ...(flag('level') ? { level: +flag('level') } : {}), ...(flag('size') ? { teamSize: +flag('size') } : {}),
  ...(flag('draft') ? { draft: true, bring: +flag('bring') || 8 } : {}), ...(flag('forms') ? { forms: flag('forms') } : {}),
  ...(flag('recheck') ? { ai: 'search', ...(flag('iters') ? { iters: +flag('iters') } : {}) } : {}) };
const rules = flag('hp') ? { hpScale: +flag('hp') } : {};
Object.assign(RULES, rules);
if (watch) {
  const data = prepare(chars, moves);
  const w = watchBattle(data, { format, seed: +seed, ...extra });
  if (w.drafts) w.drafts.forEach((d, s) => console.log(`--- side ${s ? 'B' : 'A'} draft ---\n` + d.log.join('\n')));
  else console.log(JSON.stringify(w.teams, null, 1));
  console.log(w.log.join('\n'));
  console.log('winner', w.winner, 'turns', w.turns);
  process.exit(0);
}

// ---- workers: the same protocol as the page (sim/worker.js) ----
const n = Math.max(1, +flag('workers') || os.availableParallelism?.() || os.cpus().length);
const workers = Array.from({ length: n }, () => new Worker(new URL('./node-worker.mjs', import.meta.url)));
const send1 = (w, msg, onProgress) => new Promise((res, rej) => {
  const on = m => {
    if (m.type === 'progress') onProgress(m.stats);
    if (m.type === 'error') { w.off('message', on); rej(new Error(m.message)); }
    if (m.type === 'done' || m.type === 'ready') { w.off('message', on); res(m); }
  };
  w.on('message', on);
  w.postMessage(msg);
});
const ready = await Promise.all(workers.map(w => send1(w, { cmd: 'init', characters: chars, moves }, () => {})));
// every counter in the stats is a number inside nested objects, so one deep add merges any of them
const add = (T, S) => { for (const [k, v] of Object.entries(S || {})) { if (v && typeof v === 'object') add(T[k] || (T[k] = {}), v); else T[k] = (T[k] || 0) + v; } return T; };

const R = rng(+seed);
const ctx = {
  stats: {}, done: 0, target: +count, jobId: 1, random: R,
  lastOpts: { format, arch: flag('arch') ? 'all' : '', ban: +flag('ban') || 0 },
  meta: { archetypes: ARCHETYPES },
  chain: { teams: [], detail: {}, h2h: {}, round: 0, rounds: 0 },
  // split `total` battles over the workers, each starting at a different ladder team, like the page
  async send(total, ladder, ladderSize) {
    const batch = { full: {}, h2h: {}, detail: {}, pick: {} }, base = Math.floor(R() * 1e9);
    await Promise.all(workers.map((w, i) => send1(w, { cmd: 'run', id: 1, rules, chunk: 250,
      opts: { format, count: Math.floor(total / n) + (i < total % n ? 1 : 0), seed: base + i * 7919, ...extra, ladder, offset: Math.floor(i * (ladderSize || 0) / n) } },
    S => { add(ctx.stats, S); ctx.done += S.battles; add(batch.full, S.full); add(batch.h2h, S.h2h); add(batch.detail, S.detail); add(batch.pick, S.teamPick); })));
    return batch;
  },
};

const t0 = Date.now();
const mode = flag('search');
let out;
const recheck = flag('recheck') && JSON.parse(fs.readFileSync(flag('recheck'))).chain;
if (recheck) {
  const keys = recheck.teams.map(t => t.keys), forced = Object.fromEntries(recheck.teams.filter(t => t.arch).map(t => [[...t.keys].sort().join('+'), t.arch]));
  out = await ctx.send(+count, { top: keys, forced, h2h: true, seed: Math.floor(R() * 1e9) }, keys.length);
}
else if (mode === 'meta') await metaChain(ctx, +count);
else if (mode === 'best') out = await searchTeams(ctx, +count);
else await ctx.send(+count);
const ms = Date.now() - t0;
const S = ctx.stats;
const name = k => ready[0].entrants.find(e => e.key === k)?.name || k;
console.log(`${S.battles} battles in ${ms} ms on ${n} workers (${(ms / S.battles).toFixed(2)} ms each), avg ${(S.turns / S.battles).toFixed(1)} turns, ${S.draws || 0} draws`);
// a team's win rate over a round robin's head-to-head table (keys 'team|opponent')
const rr = (h2h, k) => { let g = 0, w = 0; for (const [hk, v] of Object.entries(h2h)) if (hk.split('|')[0] === k) { g += v.g; w += v.w; } return [g ? w / g : NaN, g]; };
if (recheck) {
  console.log('team                 fast AI   search AI (games)');
  for (const t of recheck.teams) {
    const k = [...t.keys].sort().join('+'), [f] = rr(recheck.h2h, k), [s, g] = rr(out.h2h, k);
    console.log(`${(t.archName || 'meta').padEnd(20)} ${(100 * f).toFixed(0).padStart(4)}%   ${(100 * s).toFixed(0).padStart(4)}% (${g})  ${t.keys.map(name).join(', ')}`);
  }
} else if (mode === 'meta') {
  for (const t of ctx.chain.teams) console.log(`${t.archName ? t.archName.padEnd(14) : 'meta'.padEnd(14)} ${(t.wr * 100).toFixed(0)}% (${t.g})  ${t.keys.map(name).join(', ')}`);
} else if (mode === 'best') {
  for (const r of out.rows.slice(0, 8)) console.log(`${(r.wr * 100).toFixed(0)}% (${r.g})  ${r.keys.map(name).join(', ')}`);
} else {
  const rows = Object.entries(S.ent).map(([k, v]) => [k, v.w / v.g, v.g]).sort((a, b) => b[1] - a[1]);
  console.log('top', rows.slice(0, 12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
  console.log('bottom', rows.slice(-12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
}
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ args: process.argv.slice(2), ms, stats: S, chain: mode === 'meta' ? ctx.chain : undefined, recheck: recheck ? out.h2h : undefined, best: out?.rows?.slice(0, 32) }));
await Promise.all(workers.map(w => w.terminate()));
