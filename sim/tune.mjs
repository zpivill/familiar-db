// Searches for better battle AI weights (W in sim/ai.js) with a simple evolution strategy:
// each generation tries `pop` random nudges of the current weights plus the current weights themselves,
// all on the same fresh battles (paired mirror matches against frozen v1 and greedy, see bench.mjs),
// and moves the weights toward the best few. Runs on every core.
//
//   node sim/tune.mjs [generations = 40] [battles per opponent per candidate = 200] [seed = 1] [--distill=file]
//
// Prints each generation and writes the best weights to sim/tuned-weights.json, which you then check
// with bench.mjs on new seeds before copying them into W. Fitness only uses seeds 1000+, so bench.mjs
// seeds 1-999 stay unseen.
import fs from 'fs';
import os from 'os';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { W } from './ai.js';
import { rng } from './battle.js';

const OPPONENTS = ['v1', 'greedy'];

// --distill=file: fitness is instead how closely the fast AI agrees with the search AI's recorded choices
// (from  node sim/bench.mjs search ... --record=file): 1 - its average regret, the share of a win it gives up
// per turn by not choosing what the search found best. No battles are played, only replays.
const distill = process.argv.find(a => a.startsWith('--distill='))?.slice(10);

if (!isMainThread) {
  const { arena } = await import('./bench.mjs');
  const play = arena();
  const { judge } = await import('./mcts.js');
  const recs = workerData.distill ? JSON.parse(fs.readFileSync(workerData.distill)).map(r => ({ ...r, ...play.setup(r.seed, r.n) })) : null;
  parentPort.on('message', ({ w, seed, battles }) => {
    Object.assign(W, w);
    if (recs) {
      let regret = 0, n = 0;
      for (const r of recs) for (const p of judge(r.data, r.teams, r.bo, r.me, r.replay)) { regret += p.regret; n++; }
      return parentPort.postMessage(1 - regret / n);
    }
    let score = 0;
    for (const name of OPPONENTS) for (let n = 0; n < battles; n++) if (play(name, seed, n).res === 'w') score++;
    parentPort.postMessage(score / (battles * OPPONENTS.length));
  });
} else {
  const [gens = 40, battles = 200, seed = 1] = process.argv.slice(2).filter(a => !a.startsWith('--')).map(Number);
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const keys = Object.keys(W);
  // weights that can go negative or sit near 0 move additively, the rest by a factor
  const additive = new Set();
  let mean = { ...W }, sigma = 0.35;
  const nudge = () => Object.fromEntries(keys.map(k => [k, additive.has(k) ? mean[k] + gauss() * sigma * 0.3 : mean[k] * Math.exp(gauss() * sigma)]));
  const clamp = w => { w.noise = Math.min(w.noise, 1); w.predictProtect = Math.min(w.predictProtect, 1); return w; };

  const n = os.availableParallelism?.() || os.cpus().length;
  const workers = Array.from({ length: n }, () => new Worker(new URL(import.meta.url), { workerData: { distill } }));
  const evalAll = (cands, s) => new Promise(done => {
    const out = new Array(cands.length);
    let next = 0, left = cands.length;
    const feed = w => {
      if (next >= cands.length) return;
      const i = next++;
      w.once('message', f => { out[i] = f; left--; if (!left) done(out); else feed(w); });
      w.postMessage({ w: cands[i], seed: s, battles });
    };
    workers.forEach(feed);
  });

  const pop = Math.max(8, n * 2), elite = 3;
  let best = { w: mean, f: -1 };
  for (let g = 0; g < gens; g++) {
    const cands = [mean, ...Array.from({ length: pop }, () => clamp(nudge()))];
    const fit = await evalAll(cands, 1000 + seed * 1000 + g);
    const order = fit.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]);
    const top = order.slice(0, elite).map(([, i]) => cands[i]);
    // geometric mean of the elite (arithmetic for additive weights), so one lucky candidate can't jump far
    mean = clamp(Object.fromEntries(keys.map(k => [k, additive.has(k) ? top.reduce((s, w) => s + w[k], 0) / elite : Math.exp(top.reduce((s, w) => s + Math.log(Math.max(1e-6, w[k])), 0) / elite)])));
    sigma *= 0.96;
    if (order[0][0] > best.f) best = { w: cands[order[0][1]], f: order[0][0] };
    console.log(`gen ${g + 1}: current weights ${(100 * fit[0]).toFixed(1)}%, best nudge ${(100 * order[0][0]).toFixed(1)}%, sigma ${sigma.toFixed(2)}`);
  }
  const round = w => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toPrecision(3)]));
  fs.writeFileSync(new URL('./tuned-weights.json', import.meta.url), JSON.stringify({ mean: round(mean), best: round(best.w), bestFit: best.f }, null, 1) + '\n');
  console.log('final weights', JSON.stringify(round(mean)));
  await Promise.all(workers.map(w => w.terminate()));
}
