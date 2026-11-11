// Parity check for the Roblox (Luau) battle engine in the familiar-game repo.
// Plays seeded battles in the JS sim with random teams and a random-choice bot, and writes one hash per battle
// of the whole battle state at every choice. The game repo's tests/parity.luau plays the same seeds through
// the Luau engine and must get the same hashes.
// Usage: node tools/roblox-parity.mjs <game repo>/tests/parity-expected.json [count=300]
//        node tools/roblox-parity.mjs --trace=<seed>     (prints the state lines, to diff against the Luau side)
// tests/parity.luau mirrors genBattle, the bot and stateLine line by line: change both together.
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare, runBattle, rng } from '../sim/battle.js';
import { TYPES, ITEMS } from '../sim/rules.js';
import { usable } from '../sim/ai.js';

const root = new URL('..', import.meta.url);
const read = f => JSON.parse(readFileSync(new URL('data/' + f, root), 'utf8'));
const data = prepare(read('characters.json'), read('moves.json').moves);
const byKey = new Map(data.entrants.map(e => [e.key, e]));
const KEYS = [...byKey.keys()].sort();
const STATS = ['pow', 'grd', 'ene', 'wil', 'spe'];
const LEVELS = [5, 12, 50, 100];

// The engine's random numbers, counted, so the trace shows the first roll that goes missing.
function counted(seed) {
  const base = rng(seed);
  const r = () => { r.n++; return base(); };
  r.n = 0;
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  return r;
}

function genBuild(g, perMon) {
  const e = byKey.get(KEYS[g.int(0, KEYS.length - 1)]);
  const pool = e.learn.filter(l => l.id !== e.sig?.id), moves = [];
  while (moves.length < 4 && pool.length) moves.push(pool.splice(g.int(0, pool.length - 1), 1)[0]);
  if (e.sig) moves.push(e.sig);
  const b = { e, moves, ability: e.abilities[g.int(0, e.abilities.length - 1)] };
  if (g() < 0.6) { const it = ITEMS[g.int(0, ITEMS.length - 1)]; b.item = it.typed ? it.id + ':' + TYPES[g.int(0, TYPES.length - 1)] : it.id; }
  if (g() < 0.5) { b.evs = {}; for (const k of ['vit', ...STATS]) b.evs[k] = g.int(0, 32); }
  if (g() < 0.3) { b.ivs = {}; for (const k of ['vit', ...STATS]) b.ivs[k] = g.int(0, 31); }
  if (g() < 0.5) b.nature = STATS[g.int(0, 4)] + '-' + STATS[g.int(0, 4)];
  if (perMon) b.level = g.int(3, 100);
  return b;
}

function genBattle(seed) {
  const g = rng(seed);
  const format = g() < 0.5 ? 'duos' : 'singles';
  const level = LEVELS[g.int(0, 3)];
  const perMon = g() < 0.3;
  const teams = [0, 1].map(() => { const n = g.int(2, 6), t = []; for (let i = 0; i < n; i++) t.push(genBuild(g, perMon)); return t; });
  return { format, level, teams };
}

function stateLine(B, r) {
  const out = [`T${B.turn} R${r.n} F${B.field ? B.field.turns : -1}`];
  for (const s of B.sides) {
    const h = s.hazards, sc = s.screens;
    out.push(`S${s.tailwind} ${h.rocks}${h.spikes}${h.web}${h.rainbow} ${sc.reflect || 0},${sc.light || 0},${sc.veil || 0} A${s.active.map(m => m ? s.mons.indexOf(m) : -1).join(',')}`);
    for (const m of s.mons) out.push([
      m.hp, m.maxhp, m.status || '-', m.statusTurns, m.bleedN, ...STATS.map(k => m.boosts[k]), ...STATS.map(k => m.raw[k]),
      ...m.moves.map(x => x.pp), m.fainted ? 1 : 0, m.itemUsed ? 1 : 0, m.vol.sub || 0, m.vol.confuse || 0, m.types.join('/'),
    ].join(','));
  }
  return out.join('|');
}

export function play(seed, onLine) {
  const { format, level, teams } = genBattle(seed);
  const r = counted(seed), b = rng(seed + 1000003);
  let hash = 0, lines = 0;
  const line = B => {
    const s = stateLine(B, r);
    onLine?.(s);
    for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) >>> 0;
    lines++;
  };
  const decide = (kind, B, x, options, extra) => {
    line(B);
    if (kind === 'replace') return b.pick(options);
    const bench = B.api.bench(x.side);
    if (!extra && b() < 0.12 && bench.length && B.api.canSwitch(x)) return { type: 'switch', to: b.pick(bench) };
    const slots = x.moves.map((mv, i) => i).filter(i => usable(x, x.moves[i]));
    return { type: 'move', slot: slots.length ? b.pick(slots) : 0, target: b.pick(B.api.foesOf(x)) };
  };
  const B = runBattle(data, teams, { rng: r, format, level, turnCap: 60, decide });
  line(B);
  return { seed, hash, lines, winner: B.winner, turn: B.turn };
}

const trace = process.argv.find(a => a.startsWith('--trace='));
if (trace) play(+trace.split('=')[1], s => console.log(s));
else {
  const [out, count = '300'] = process.argv.slice(2);
  if (!out) throw new Error('usage: node tools/roblox-parity.mjs <game repo>/tests/parity-expected.json [count]');
  const battles = [];
  for (let seed = 1; seed <= +count; seed++) battles.push(play(seed));
  writeFileSync(out, JSON.stringify({ note: 'Made by familiar-db tools/roblox-parity.mjs. Never edit by hand.', battles }) + '\n');
  console.log(`${battles.length} battles -> ${out}`);
}
