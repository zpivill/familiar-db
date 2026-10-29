// Team search, shared by the Simulator page (page.js) and the terminal (cli.mjs): Strongest teams and the
// Meta chain of counters. No DOM. It runs battles through ctx.send and keeps its progress on ctx, so the page
// can draw it while it runs.
//
// ctx.send(total, ladder, ladderSize) -> Promise of that batch's team results { full, h2h, detail, pick }
// ctx.stats: running totals of everything played so far (ctx.stats.ent gives the win-rate weights)
// ctx.lastOpts: the run's settings (format, ban, arch); ctx.meta.archetypes: the 11 archetypes
// ctx.jobId: a new value stops the search; ctx.target / ctx.done: battles asked for / played
// ctx.draw(): optional redraw; ctx.random(): optional seeded random numbers (default Math.random)
// Written on ctx: plan (battles per generation), gen, full (team wins per generation), kept, chain.

import { mergeDetail, emptyDetail } from './batch.js';

// 95% margin of a win rate, with a pinch of smoothing (the same as the page's margin).
const margin = (p, n) => { if (!n) return 1; const q = (p * n + 1) / (n + 2); return 1.96 * Math.sqrt(q * (1 - q) / n); };
const addWins = (T, S) => { for (const [k, v] of Object.entries(S || {})) { const t = T[k] || (T[k] = { g: 0, w: 0 }); t.g += v.g; t.w += v.w; } return T; };
const addDetail = (T, S) => { for (const [k, D] of Object.entries(S || {})) mergeDetail(T[k] || (T[k] = emptyDetail()), D); return T; };
const seedOf = ctx => Math.floor((ctx.random || Math.random)() * 1e9);
export const teamRows = full => Object.entries(full).map(([k, v]) => { const wr = v.w / v.g; return { k, keys: k.split('+'), ...v, wr, sure: wr - margin(wr, v.g) }; }).sort((a, b) => b.sure - a.sure);

// Team ranking is a search over generations. Generation 1 plays a big field of random teams against each other.
// Each later generation keeps the best fifth, adds two one-swap variants of each, mixes kept teams together,
// and adds fresh random teams; new members lean toward characters with good win rates so far, but a third
// of picks stay uniform so niche and lower tier picks keep getting a chance. The last generation replays
// only the best 32 teams found with a quarter of the battles, so their win rates are tight.
// With `field` set, every team plays those fixed opponents instead of each other, so the search looks for
// the best counter to them.
const FINAL_TEAMS = 32;
export function searchPlan(total) {
  const gens = Math.max(3, Math.min(14, Math.round(total / 8000) + 2));
  const first = Math.round(total * 0.2), mid = Math.floor((total - first - Math.round(total * 0.25)) / (gens - 2));
  return Array.from({ length: gens }, (_, i) => i === 0 ? first : i < gens - 1 ? mid : total - first - mid * (gens - 2));
}
// With `archetype` set, every team the search builds must play that archetype's plan (sim/archetypes.js).
export async function searchTeams(ctx, total, field, start, ban, archetype) {
  const id = ctx.jobId;
  ctx.plan = searchPlan(total); ctx.gen = 0; ctx.full = [{}]; ctx.kept = {};
  const vs = { ...(field ? { vs: field.vs, vsWeights: field.weights } : {}), ...(ban?.length ? { ban } : {}), ...(archetype ? { archetype } : {}) };
  const first = Math.max(40, Math.min(400, Math.round(ctx.plan[0] * 2 / 60)));
  let res = await ctx.send(ctx.plan[0], { fresh: first, top: start || [], variants: start ? 1 : 0, seed: seedOf(ctx), ...vs }, first + (start?.length || 0) * 2);
  for (ctx.gen = 1; ctx.gen < ctx.plan.length; ctx.gen++) {
    if (id !== ctx.jobId) return null;
    const prev = teamRows(res.full), battles = ctx.plan[ctx.gen], last = ctx.gen === ctx.plan.length - 1;
    ctx.full.push({});
    const weights = Object.fromEntries(Object.entries(ctx.stats.ent).map(([k, v]) => [k, Math.max(0.02, v.w / v.g) ** 3]));
    const seed = seedOf(ctx);
    let ladder, size;
    if (last) { ladder = { top: prev.slice(0, FINAL_TEAMS).map(r => r.keys), detail: true, seed, ...vs }; size = ladder.top.length; }
    else {
      const pop = Math.max(30, Math.min(160, Math.round(battles * 2 / 80))), keep = Math.round(pop / 5);
      ladder = { top: prev.slice(0, keep).map(r => r.keys), variants: 2, crosses: keep, fresh: keep, weights, seed, picks: pickRates(res.pick, prev.slice(0, keep)), ...vs };
      size = keep * 5;
    }
    for (const t of ladder.top) for (const k of t) ctx.kept[k] = (ctx.kept[k] || 0) + 1;
    ctx.draw?.();
    res = await ctx.send(battles, ladder, size);
  }
  ctx.gen = ctx.plan.length - 1;
  return { rows: teamRows(res.full), detail: res.detail, pick: res.pick };
}
// How often the draft picked each member of these teams, as team key -> { member: share of games }.
function pickRates(pick, rows) {
  const out = {};
  for (const r of rows) { const P = pick?.[r.k]; if (P?.g) out[r.k] = Object.fromEntries(r.keys.map(x => [x, (P.pick[x] || 0) / P.g])); }
  return out;
}

// Meta chain: find the strongest team, then the best counter to it, then the best counter to that one, and so on.
// Each counter search plays the latest meta team 60% of the time and the earlier ones the rest, so a counter
// has to beat the current top team without folding to the older ones. At the end every meta team plays every
// other one, for the who-beats-whom table.
// With archetype rounds on, each archetype (sim/archetypes.js) then gets its own search for the best team that
// plays its plan against the meta teams (all weighted the same), and those teams join the final round robin
// still forced to play their plan.
// ctx.chain starts as { teams: [], detail: {}, h2h: {}, round: 0, rounds: 0 } and holds the result.
export async function metaChain(ctx, total) {
  const id = ctx.jobId, C = ctx.chain;
  const archs = ctx.lastOpts.arch === 'all' && ctx.lastOpts.format === 'comp' ? ctx.meta.archetypes || [] : [];
  const rounds = Math.max(2, Math.min(5, Math.round(total / 20000)));
  const firstBudget = Math.round(total * (archs.length ? 0.3 : 0.4)), matrix = Math.round(total * 0.1), archEach = archs.length ? Math.floor(total * 0.3 / archs.length) : 0;
  const each = Math.floor((total - firstBudget - matrix - archEach * archs.length) / rounds);
  C.rounds = rounds + 1; C.archs = archs.length;
  C.round = 0;
  let res = await searchTeams(ctx, firstBudget);
  if (!res || id !== ctx.jobId) return;
  C.teams.push({ keys: res.rows[0].keys, wr: res.rows[0].wr, g: res.rows[0].g, vsField: 'the strongest teams found', pick: res.pick?.[res.rows[0].k] });
  addDetail(C.detail, res.detail);
  for (let k = 1; k <= rounds; k++) {
    C.round = k;
    const prevKeys = C.teams.map(t => t.keys.join('+'));
    const n = C.teams.length;
    const weights = C.teams.map((_, i) => i === n - 1 ? (n === 1 ? 1 : 0.6) : 0.4 / (n - 1));
    // optional bans: the characters picked most often by the meta teams so far sit out this counter round,
    // so the search has to find other answers (ties go to the higher individual win rate)
    const picks = {};
    C.teams.forEach(t => t.keys.forEach(x => { picks[x] = (picks[x] || 0) + 1; }));
    const wr = x => { const v = ctx.stats.ent[x]; return v ? v.w / v.g : 0; };
    const ban = +ctx.lastOpts.ban ? Object.keys(picks).sort((a, b) => picks[b] - picks[a] || wr(b) - wr(a)).slice(0, +ctx.lastOpts.ban) : [];
    const start = res.rows.filter(r => !prevKeys.includes(r.k) && !r.keys.some(x => ban.includes(x))).slice(0, 8).map(r => r.keys);
    res = await searchTeams(ctx, each, { vs: C.teams.map(t => t.keys), weights }, start, ban);
    if (!res || id !== ctx.jobId) return;
    const best = res.rows.find(r => !prevKeys.includes(r.k)) || res.rows[0];
    C.teams.push({ keys: best.keys, wr: best.wr, g: best.g, banned: ban, pick: res.pick?.[best.k] });
    addDetail(C.detail, res.detail);
  }
  const meta = C.teams.map(t => t.keys), metaKeys = meta.map(t => t.join('+'));
  for (const [i, a] of archs.entries()) {
    C.arch = i + 1; C.archName = a.name;
    res = await searchTeams(ctx, archEach, { vs: meta, weights: meta.map(() => 1) }, null, null, a.id);
    if (!res || id !== ctx.jobId) return;
    const best = res.rows.find(r => !metaKeys.includes(r.k) && !C.teams.some(t => t.keys.join('+') === r.k));
    if (!best) continue;
    C.teams.push({ keys: best.keys, wr: best.wr, g: best.g, arch: a.id, archName: a.name, pick: res.pick?.[best.k] });
    addDetail(C.detail, res.detail);
  }
  C.arch = 0;
  C.round = rounds + 1; C.matrix = true;
  ctx.plan = null;
  const forced = Object.fromEntries(C.teams.filter(t => t.arch).map(t => [[...t.keys].sort().join('+'), t.arch]));
  res = await ctx.send(ctx.target - ctx.done, { top: C.teams.map(t => t.keys), forced, h2h: true, detail: true, seed: seedOf(ctx) }, C.teams.length);
  if (id !== ctx.jobId) return;
  addWins(C.h2h, res.h2h); addDetail(C.detail, res.detail);
  for (const t of C.teams) { const P = res.pick?.[t.keys.join('+')]; if (P?.g) t.pick = P; }
}
