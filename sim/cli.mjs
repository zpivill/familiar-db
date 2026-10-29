// Run a batch from the command line:  node sim/cli.mjs [count] [duel|team|duos|comp] [seed] [watch]
// Flags: --trained (AI-chosen EVs, nature, IVs and held items), --level=50, --size=4,
// --draft (comp only: bring 8 and draft 6), --bring=10, --hp=3 (Vitality multiplier), --forms=all,
// --workers=4 (default: every core; results repeat for the same seed and worker count),
// --search=best|meta (Strongest teams / Meta chain, as on the page), --arch (archetype rounds), --ban=2,
// --json=out.json (save the results, e.g. for sim/bench.mjs)
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
  ...(flag('draft') ? { draft: true, bring: +flag('bring') || 8 } : {}), ...(flag('forms') ? { forms: flag('forms') } : {}) };
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
if (mode === 'meta') await metaChain(ctx, +count);
else if (mode === 'best') out = await searchTeams(ctx, +count);
else await ctx.send(+count);
const ms = Date.now() - t0;
const S = ctx.stats;
const name = k => ready[0].entrants.find(e => e.key === k)?.name || k;
console.log(`${S.battles} battles in ${ms} ms on ${n} workers (${(ms / S.battles).toFixed(2)} ms each), avg ${(S.turns / S.battles).toFixed(1)} turns, ${S.draws || 0} draws`);
if (mode === 'meta') {
  for (const t of ctx.chain.teams) console.log(`${t.archName ? t.archName.padEnd(14) : 'meta'.padEnd(14)} ${(t.wr * 100).toFixed(0)}% (${t.g})  ${t.keys.map(name).join(', ')}`);
} else if (mode === 'best') {
  for (const r of out.rows.slice(0, 8)) console.log(`${(r.wr * 100).toFixed(0)}% (${r.g})  ${r.keys.map(name).join(', ')}`);
} else {
  const rows = Object.entries(S.ent).map(([k, v]) => [k, v.w / v.g, v.g]).sort((a, b) => b[1] - a[1]);
  console.log('top', rows.slice(0, 12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
  console.log('bottom', rows.slice(-12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
}
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify({ args: process.argv.slice(2), ms, stats: S, chain: mode === 'meta' ? ctx.chain : undefined, best: out?.rows.slice(0, 32) }));
await Promise.all(workers.map(w => w.terminate()));
