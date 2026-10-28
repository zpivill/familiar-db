// Runs many battles and keeps only running totals, so thousands of battles stay light on memory.
// Used by the Web Worker on the site and by sim/cli.mjs in Node.

import { runBattle, rng } from './battle.js';
import { RULES } from './rules.js';

const avgHits = fx => !fx.hits ? 1 : fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2;

// How useful a move looks on paper for this character, to pick sensible movesets.
function rateMove(data, e, l) {
  const m = data.moves.get(l.id), fx = m.fx;
  if (fx.duosOnly || fx.nothing) return 0.5;
  if (m.category === 'Status') {
    if (fx.boosts?.some(b => b.who === 'self' && Object.values(b.stats).some(v => v > 0))) return 55;
    if (fx.heal) return 50;
    if (fx.status) return 45;
    if (fx.protect || fx.substitute || fx.hazard || fx.screen || fx.field || fx.tailwind) return 35;
    return 20;
  }
  const atk = m.category === 'Physical' ? e.stats.pow : e.stats.ene;
  const best = Math.max(e.stats.pow, e.stats.ene);
  const power = fx.fixed ? 80 : fx.power === 'reversal' ? 70 : (m.power || 60);
  let v = power * avgHits(fx) * ((m.accuracy ?? 100) / 100) * (e.types.includes(m.type) ? 1.5 : 1) * (atk / best) ** 1.5;
  if (fx.recharge || fx.charge) v *= 0.6;
  if (fx.selfDmg) v *= 1 - fx.selfDmg;
  if ((m.priority || 0) > 0) v *= 1.15;
  return v;
}

export function makeBuild(data, e, r, opts = {}) {
  const level = opts.level || RULES.level;
  const pool = e.learn.filter(l => l.lv <= level && l.id !== e.sig?.id);
  let picks = [];
  if (opts.movesets === 'random') {
    const p = [...pool];
    while (picks.length < 4 && p.length) picks.push(p.splice(Math.floor(r() * p.length), 1)[0]);
  } else {
    // weighted picks: strong own-type attacks first, then coverage and one or two utility moves
    const rated = pool.map(l => ({ l, v: rateMove(data, e, l), m: data.moves.get(l.id) }));
    const types = new Set(), cats = { atk: 0, st: 0 };
    while (picks.length < 4 && rated.length) {
      const w = rated.map(x => {
        let v = x.v;
        const st = x.m.category === 'Status';
        if (!st && types.has(x.m.type)) v *= 0.45;
        if (st && cats.st >= 2) v *= 0.2;
        if (!st && cats.atk === 0) v *= 1.5;
        return Math.max(0.1, v) ** 1.6;
      });
      let t = r() * w.reduce((s, x) => s + x, 0), k = 0;
      while (k < w.length - 1 && (t -= w[k]) > 0) k++;
      const [x] = rated.splice(k, 1);
      picks.push(x.l);
      if (x.m.category === 'Status') cats.st++; else { cats.atk++; types.add(x.m.type); }
    }
  }
  const moves = e.sig ? [...picks, e.sig] : picks;
  const abs = e.abilities.length ? e.abilities : [{ name: 'None', ab: null }];
  const ability = opts.ability ? abs.find(a => a.name === opts.ability) || r.pick(abs) : r.pick(abs);
  return { e, moves, ability: ability.ab ? ability : { name: 'None', ab: abs[0].ab } };
}

export function entrantPool(data, opts = {}) {
  const tiers = opts.tiers?.length ? new Set(opts.tiers) : null;
  return data.entrants.filter(e => (opts.forms === 'all' || e.final) && (!tiers || tiers.has(e.rarity)) && (opts.gags !== false || !e.gag) && e.stats && e.sig);
}

export function emptyStats() {
  return { battles: 0, draws: 0, turns: 0, ent: {}, abil: {}, move: {}, moveBy: {}, combo: {}, pairs: {}, vs: {}, full: {}, faster: { g: 0, w: 0 }, lead: { g: 0, w: 0 } };
}

const inc = (o, k, f) => (o[k] || (o[k] = f()));

function record(S, B, builds, opts) {
  S.battles++;
  S.turns += B.turn;
  if (B.winner < 0) S.draws++;
  B.sides.forEach((s, si) => {
    const won = B.winner === si ? 1 : 0, half = B.winner < 0 ? 0.5 : 0;
    const w = won || half;
    s.mons.forEach((m, k) => {
      const b = builds[si][k];
      const E = inc(S.ent, m.key, () => ({ g: 0, w: 0, kos: 0, dmg: 0, taken: 0, turns: 0, faint: 0, lead: 0, leadW: 0 }));
      E.g++; E.w += w; E.kos += m.t.kos; E.dmg += m.t.dmg / m.maxhp; E.taken += m.t.taken / m.maxhp; E.turns += m.t.turns; E.faint += m.fainted ? 1 : 0;
      if (k === 0) { E.lead++; E.leadW += w; }
      const A = inc(S.abil, m.key + '|' + b.ability.name, () => ({ g: 0, w: 0 }));
      A.g++; A.w += w;
      for (const mv of b.moves) {
        const M = inc(S.move, mv.id, () => ({ eq: 0, w: 0, uses: 0, hits: 0, dmg: 0, kos: 0, crits: 0, misses: 0, sup: 0 }));
        M.eq++; M.w += w;
        const t = m.t.moves[mv.id];
        if (t) { M.uses += t.uses; M.hits += t.hits; M.dmg += t.dmg; M.kos += t.kos; M.crits += t.crits; M.misses += t.misses; M.sup += t.sup; }
        const MB = inc(S.moveBy, m.key + '|' + mv.id, () => ({ eq: 0, w: 0, uses: 0 }));
        MB.eq++; MB.w += w; MB.uses += t?.uses || 0;
      }
      const C = inc(S.combo, m.e.types.join('/'), () => ({ g: 0, w: 0 }));
      C.g++; C.w += w;
    });
    // teammates that win together
    if (s.mons.length > 1) {
      const keys = s.mons.map(m => m.key).sort();
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const P = inc(S.pairs, keys[i] + '+' + keys[j], () => ({ g: 0, w: 0 }));
        P.g++; P.w += w;
      }
    }
  });
  // head-to-head (one on one only) and who moved first
  if (B.sides[0].mons.length === 1 && B.sides[1].mons.length === 1) {
    const [a, b] = [B.sides[0].mons[0], B.sides[1].mons[0]];
    const [x, y, xw] = a.key < b.key ? [a, b, B.winner === 0] : [b, a, B.winner === 1];
    const V = inc(S.vs, x.key + '>' + y.key, () => ({ g: 0, w: 0 }));
    V.g++; V.w += B.winner < 0 ? 0.5 : xw ? 1 : 0;
    const sa = a.raw.spe, sb = b.raw.spe;
    if (sa !== sb && B.winner >= 0) { S.faster.g++; S.faster.w += (sa > sb) === (B.winner === 0) ? 1 : 0; }
  }
}

export function mergeStats(T, S) {
  T.battles += S.battles; T.draws += S.draws; T.turns += S.turns;
  for (const k of ['ent', 'abil', 'move', 'moveBy', 'combo', 'pairs', 'vs', 'full']) {
    for (const [key, v] of Object.entries(S[k])) {
      const t = T[k][key] || (T[k][key] = Object.fromEntries(Object.keys(v).map(f => [f, 0])));
      for (const f in v) t[f] += v[f];
    }
  }
  T.faster.g += S.faster.g; T.faster.w += S.faster.w;
  return T;
}

const teamSize = opts => opts.format === 'duel' ? 1 : opts.format === 'duos' ? Math.max(2, opts.teamSize || 4) : Math.max(1, opts.teamSize || 3);
export const teamKey = t => t.map(e => e.key).sort().join('+');

// Whole teams for team ranking. Every worker builds the same list from the same seed.
// A generation is the kept teams (`top`), plus for each kept team `variants` copies with one member swapped,
// `crosses` teams mixed from two kept teams, and `fresh` brand-new random teams so the search keeps exploring.
// Swapped-in and fresh members come from the whole pool, so a lower tier or unevolved character stays
// only if it actually helps its team win.
export function ladderTeams(data, opts) {
  const L = opts.ladder, r = rng(L.seed), size = teamSize(opts);
  const pool = entrantPool(data, opts), byKey = new Map(data.entrants.map(e => [e.key, e]));
  const byTier = {};
  pool.forEach(e => { (byTier[e.rarity] || (byTier[e.rarity] = [])).push(e); });
  const tierKeys = Object.keys(byTier).filter(t => byTier[t].length >= size);
  const focus = opts.focus ? pool.find(e => e.key === opts.focus) : null;
  // L.weights (character key -> how strongly to favour it, from win rates so far) steers most new picks toward
  // characters that are doing well; a third stay uniform so niche picks keep getting tried.
  const W = L.weights, cum = new Map();
  const pick = src => {
    if (!W || r() < 1 / 3) return r.pick(src);
    let c = cum.get(src);
    if (!c) { let t = 0; c = src.map(e => (t += W[e.key] ?? 0.05)); cum.set(src, c); }
    const x = r() * c[c.length - 1];
    let lo = 0, hi = c.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < x) lo = m + 1; else hi = m; }
    return src[lo];
  };
  const fill = (t, src) => {
    const used = new Set(t.map(e => e.cid));
    for (let guard = 0; t.length < size && guard < 500; guard++) {
      const e = pick(src);
      if (!used.has(e.cid)) { used.add(e.cid); t.push(e); }
    }
    return t.length === size ? t : null;
  };
  const out = [], seen = new Set();
  const add = t => { if (t && !seen.has(teamKey(t))) { seen.add(teamKey(t)); out.push(t); return true; } return false; };
  const srcOf = t => opts.sameTier ? byTier[t[0].rarity] || pool : pool;
  const top = (L.top || []).map(ks => ks.map(k => byKey.get(k)).filter(Boolean)).filter(t => t.length === size);
  top.forEach(add);
  for (const t of top) {
    const swappable = t.filter(e => e !== focus);
    for (let v = 0; v < (L.variants || 0) && swappable.length; v++) {
      for (let tries = 0; tries < 10; tries++) {
        const gone = r.pick(swappable);
        if (add(fill(t.filter(e => e !== gone), srcOf(t)))) break;
      }
    }
  }
  for (let c = 0, tries = 0; c < (L.crosses || 0) && top.length > 1 && tries < L.crosses * 10; tries++) {
    const a = r.pick(top), b = r.pick(top);
    if (a === b || (opts.sameTier && a[0].rarity !== b[0].rarity)) continue;
    const mix = [...a, ...b].filter((e, i, all) => all.findIndex(x => x.cid === e.cid) === i);
    const t = focus ? [focus] : [];
    const rest = mix.filter(e => e !== focus);
    while (t.length < size && rest.length) t.push(rest.splice(Math.floor(r() * rest.length), 1)[0]);
    if (add(fill(t, srcOf(a)))) c++;
  }
  const want = out.length + (L.fresh || 0);
  for (let tries = 0; out.length < want && tries < (L.fresh || 0) * 20; tries++) {
    const src = opts.sameTier && tierKeys.length ? byTier[r.pick(tierKeys)] : pool;
    add(fill(focus ? [focus] : [], src));
  }
  if (out.length < 2) throw new Error('Not enough characters to make teams. Pick more tiers or a smaller team size.');
  return out;
}

// Runs `count` battles. onChunk gets partial stats every `chunk` battles so a page can show progress.
export function runBatch(data, opts, onChunk) {
  const r = rng(opts.seed || 1);
  const pool = entrantPool(data, opts);
  if (pool.length < 2) throw new Error('Pick at least two characters.');
  const format = opts.format || 'duel';
  const size = teamSize(opts);
  const ladder = opts.ladder ? ladderTeams(data, opts) : null;
  const focus = opts.focus ? pool.find(e => e.key === opts.focus) : null;
  const byTier = {};
  pool.forEach(e => { (byTier[e.rarity] || (byTier[e.rarity] = [])).push(e); });
  const tierKeys = Object.keys(byTier).filter(t => byTier[t].length >= (opts.sameTier ? size * 2 : 1));
  let S = emptyStats();
  const chunk = opts.chunk || 100;
  for (let n = 0; n < opts.count; n++) {
    const src = opts.sameTier && tierKeys.length ? byTier[r.pick(tierKeys)] : pool;
    const used = new Set();
    const team = (forceFirst) => {
      const t = [];
      if (forceFirst) { t.push(forceFirst); used.add(forceFirst.cid); }
      let guard = 0;
      while (t.length < size && guard++ < 500) {
        const e = r.pick(src);
        if (used.has(e.cid)) continue;
        used.add(e.cid); t.push(e);
      }
      return t;
    };
    let sides;
    if (ladder) {
      // every team plays in turn against a random other team from the same list; mirror characters are allowed
      const a = (n + (opts.offset || 0)) % ladder.length;
      const b = (a + 1 + Math.floor(r() * (ladder.length - 1))) % ladder.length;
      sides = [ladder[a], ladder[b]];
    } else {
      sides = [team(focus), team(null)];
      if (sides[1].length < size || sides[0].length < size) continue;
    }
    if (r() < 0.5) sides = [sides[1], sides[0]];
    const builds = sides.map(t => t.map(e => makeBuild(data, e, r, opts)));
    const B = runBattle(data, builds, { rng: r, format: format === 'duos' ? 'duos' : 'singles', level: opts.level });
    record(S, B, builds, opts);
    if (ladder) sides.forEach((t, si) => {
      const F = inc(S.full, teamKey(t), () => ({ g: 0, w: 0 }));
      F.g++; F.w += B.winner === si ? 1 : B.winner < 0 ? 0.5 : 0;
    });
    if (onChunk && (n + 1) % chunk === 0) { onChunk(S, n + 1); S = emptyStats(); }
  }
  if (onChunk && S.battles) onChunk(S, opts.count);
  return S;
}

// One battle with a full text log, for watching what the AI and the rules do.
export function watchBattle(data, opts) {
  const r = rng(opts.seed || Date.now() % 1e9);
  const pool = entrantPool(data, opts);
  const size = teamSize(opts);
  const pickTeam = (keys, used) => {
    const t = (keys || []).map(k => pool.find(e => e.key === k) || data.entrants.find(e => e.key === k)).filter(Boolean);
    t.forEach(e => used.add(e.cid));
    while (t.length < size) { const e = r.pick(pool); if (!used.has(e.cid)) { used.add(e.cid); t.push(e); } }
    return t;
  };
  const used = new Set();
  const sides = [pickTeam(opts.teamA, used), pickTeam(opts.teamB, used)];
  const builds = sides.map(t => t.map(e => makeBuild(data, e, r, opts)));
  const B = runBattle(data, builds, { rng: r, format: opts.format === 'duos' ? 'duos' : 'singles', level: opts.level, log: true });
  return {
    winner: B.winner, turns: B.turn, log: B.log,
    teams: builds.map(t => t.map(b => ({ key: b.e.key, name: b.e.name, ability: b.ability.name, moves: b.moves.map(l => l.as) }))),
  };
}
