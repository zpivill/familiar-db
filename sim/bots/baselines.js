// Fixed opponents for the bench, the tuner and the search AI's playouts. Each has action(B, mon) -> an action
// for runBattle's decide hook (null leaves it to the current AI) and optionally replace(B, side, options).
import { usable, estDamage } from '../ai.js';
import * as v1 from './ai-v1.js';
import * as v2 from './ai-v2.js';

const pickOne = (r, xs) => xs[Math.floor(r() * xs.length)];
export const BOTS = {
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
  // the step-2 AI from 2026-10-29 (tuned weights, joint side actions)
  v2: { action: (B, m) => v2.chooseAction(B, m, B.api), replace: (B, s, options) => v2.chooseReplacement(B, s, options, B.api) },
  // the current AI against itself: should come out even
  mirror: { action: () => null },
};
