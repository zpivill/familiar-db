// The draft for the competitive format: both players bring 10 (or 8), see only which characters the other
// brought, and pick 6 in order (the first two open). Each side's AI:
//   1. guesses the other side's hidden builds (moves, ability, nature, EVs, IVs, item),
//   2. scores every one of its 10 against every one of theirs (a quick damage race, no battle),
//   3. finds the pairs in each 10 that work together (cores),
//   4. predicts their 6, then predicts again assuming they are predicting it back,
//   5. picks the 6 that does best across those predictions without losing badly to any likely one,
//   6. orders it so the two openers fit the openers it expects, and
//   7. writes down why, from the same numbers it used.
// No DOM and no battle state, so it runs in a worker and in Node.

import { RULES, COMPETITIVE, TYPES, typeEff, battleStat, natureMult, itemDef } from './rules.js';
import { kit, trainTeam } from './builds.js';
import { rng } from './battle.js';

const LEGEND = new Set(['legendary', 'mythical']);
const STATS = ['pow', 'grd', 'ene', 'wil', 'spe'];
const TEMP = 0.06;     // how sharply predictions favour the best-looking teams (lower = sharper)
const KEEP = 24;       // predicted teams kept at each level
const RISK = 0.35;     // weight of the worst likely matchup when picking

// ---------------- builds the other side can't see ----------------

const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// The AI's guess of a 10 it can only see the characters of: a standard build per character (the same
// guess every time for the same character), trained and itemised as a whole 10.
export function guessBuilds(data, entrants, makeBuild, opts) {
  const builds = entrants.map(e => makeBuild(data, e, rng(hash(e.key)), { ...opts, movesets: 'smart', ability: null }));
  return trainTeam(data, builds, rng(hash(entrants.map(e => e.key).join('+'))), { training: 'ai', items: 'ai' });
}

// ---------------- quick matchups ----------------

function statsOf(b, level) {
  const st = b.e.stats, ev = b.evs || {}, iv = b.ivs || {}, item = itemDef(b.item);
  const out = { vit: battleStat(st.vit, level, true, ev.vit || 0, iv.vit ?? RULES.iv) };
  for (const k of STATS) out[k] = battleStat(st[k], level, false, ev[k] || 0, iv[k] ?? RULES.iv, natureMult(b.nature, k));
  if (item?.choice) out[item.choice] *= 1.5;
  if (item?.id === 'battle-coat') out.wil *= 1.5;
  return out;
}

const avgHits = fx => !fx.hits ? 1 : fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2;

// Best expected hit of a on d, as a share of d's Vitality (abilities other than type immunities are ignored).
function bestHit(data, a, sa, d, sd, level) {
  const immune = d.ability?.ab?.immune || [];
  const item = itemDef(a.item);
  let best = 0;
  for (const l of a.moves) {
    const m = data.moves.get(l.id);
    if (!m || m.category === 'Status' || !(m.power > 0) || m.fx.counter || m.fx.nothing) continue;
    if (immune.some(im => im.type === m.type || im.cat === m.category)) continue;
    const eff = typeEff(m.type, d.e.types);
    if (!eff) continue;
    const phys = m.category === 'Physical';
    const A = phys ? sa.pow : sa.ene, D = phys ? sd.grd : sd.wil;
    let dmg = (Math.floor(Math.floor(2 * level / 5 + 2) * m.power * A / Math.max(1, D)) / 50 + 2) * 0.925;
    dmg *= (a.e.types.includes(m.type) ? RULES.stab : 1) * eff * avgHits(m.fx) * ((m.accuracy ?? 100) / 100);
    if (m.fx.charge || m.fx.recharge) dmg *= 0.6;
    if (item?.id === 'overdrive-core') dmg *= 1.3;
    if (item?.id === 'type-emblem' && a.item.split(':')[1] === m.type) dmg *= 1.2;
    best = Math.max(best, dmg / sd.vit);
  }
  return best;
}

// M[i][j] in -1..1: how well mine[i] does against theirs[j] in a straight damage race.
function matchups(data, mine, theirs, level) {
  const sm = mine.map(b => statsOf(b, level)), st = theirs.map(b => statsOf(b, level));
  return mine.map((a, i) => theirs.map((d, j) => {
    const deal = bestHit(data, a, sm[i], d, st[j], level), take = bestHit(data, d, st[j], a, sm[i], level);
    const tA = deal > 0 ? Math.min(9, Math.ceil(1 / deal)) : 12, tB = take > 0 ? Math.min(9, Math.ceil(1 / take)) : 12;
    const spd = sm[i].spe > st[j].spe ? 0.5 : sm[i].spe < st[j].spe ? -0.5 : 0;
    return Math.tanh(0.7 * (tB - tA + spd));
  }));
}

// ---------------- what each character brings to a team ----------------

function roles(data, b) {
  const k = kit(data, b);
  const ms = b.moves.map(l => data.moves.get(l.id)).filter(Boolean);
  const ab = b.ability?.ab;
  const fieldTypes = new Set([...ms.map(m => m.fx.field?.boostType), ...(ab?.entry || []).filter(o => o.op === 'field').map(o => o.field.boostType)].filter(Boolean));
  return {
    ...k,
    fakeOut: ms.some(m => m.fx.firstTurn && m.fx.flinch),
    intimidate: !!ab?.entry?.some(o => o.op === 'foes' && o.intimidate),
    helping: ms.some(m => m.fx.helpingHand), follow: ms.some(m => m.fx.followMe),
    fieldTypes, spe: b.e.stats.spe, attacker: k.attacks >= 2,
  };
}

// How well two characters work together, with the reasons, for core detection and the log.
function synergy(a, b, ra, rb) {
  let v = 0;
  const why = [];
  const one = (x, y, rx, ry) => {
    if (rx.tailwind && ry.attacker && ry.spe >= 55 && ry.spe <= 105) { v += 0.5; why.push(`${x.e.name}'s Tailwind speeds up ${y.e.name}`); }
    if (rx.trickRoom && ry.attacker && ry.spe <= 60) { v += 0.6; why.push(`${x.e.name}'s Trick Room lets slow ${y.e.name} move first`); }
    if ((rx.follow || rx.redirect) && ry.setup) { v += 0.45; why.push(`${x.e.name} draws hits while ${y.e.name} sets up`); }
    else if (rx.helping && ry.attacker) { v += 0.3; why.push(`${x.e.name}'s Helping Hand powers up ${y.e.name}`); }
    for (const t of rx.fieldTypes) if (ry.stab.includes(t)) { v += 0.5; why.push(`${x.e.name}'s ${t} field boosts ${y.e.name}`); break; }
    if (rx.screens && ry.setup) { v += 0.3; why.push(`${x.e.name}'s screens cover ${y.e.name}'s setup`); }
  };
  one(a, b, ra, rb); one(b, a, rb, ra);
  let cover = 0;
  for (const t of TYPES) {
    const ea = typeEff(t, a.e.types), eb = typeEff(t, b.e.types);
    if ((ea > 1 && eb < 1) || (eb > 1 && ea < 1)) cover++;
  }
  if (cover >= 2) { v += Math.min(0.4, cover * 0.1); why.push(`${a.e.name} and ${b.e.name} cover each other's weaknesses`); }
  return { v, why };
}

const leadBonus = r => (r.fakeOut ? 0.15 : 0) + (r.tailwind || r.trickRoom ? 0.15 : 0) + (r.intimidate ? 0.1 : 0) + (r.follow || r.redirect ? 0.1 : 0);

// ---------------- teams ----------------

// Every legal 6 (as index lists) from n brought characters, with at most `cap` legendaries/mythicals.
function sixes(ents, size, cap) {
  const out = [], n = ents.length, cur = [];
  const go = (start, leg) => {
    if (cur.length === size) { out.push([...cur]); return; }
    for (let i = start; i <= n - (size - cur.length); i++) {
      const l = LEGEND.has(ents[i].rarity) ? 1 : 0;
      if (leg + l > cap) continue;
      cur.push(i); go(i + 1, leg + l); cur.pop();
    }
  };
  go(0, 0);
  return out;
}

// How a team (indices into `rows` of M) does against foes (indices into M's columns, with weights).
// coverage: an answer to each foe; exposure: how badly each member's worst foe beats it; plus synergy.
function teamScore(M, team, foes, w, syn) {
  let cov = 0, tw = 0, exp = 0, str = 0;
  for (let k = 0; k < foes.length; k++) {
    const f = foes[k], wf = w ? w[k] : 1;
    let best = -1;
    for (const a of team) if (M[a][f] > best) best = M[a][f];
    cov += best * wf; tw += wf;
  }
  for (const a of team) {
    let worst = 1, sum = 0;
    for (let k = 0; k < foes.length; k++) { const x = M[a][foes[k]]; if (x < worst) worst = x; sum += x; }
    exp += worst; str += sum / foes.length;
  }
  let s = 0;
  for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) s += syn[team[i]][team[j]];
  return cov / tw + 0.4 * exp / team.length + 0.4 * str / team.length + 0.12 * s;
}

// teamScore for every (row team, column team) pair, sped up by working out each team's best answer per foe
// and each member's worst and total against each foe team once. Same result as teamScore without weights.
function scorer(M, rowTeams, colTeams, syn) {
  const nCol = M[0].length;
  const maxT = rowTeams.map(t => { const a = new Float64Array(nCol).fill(-1); for (const x of t) for (let f = 0; f < nCol; f++) if (M[x][f] > a[f]) a[f] = M[x][f]; return a; });
  const minR = M.map(row => Float64Array.from(colTeams, X => { let m = 1; for (const f of X) if (row[f] < m) m = row[f]; return m; }));
  const sumR = M.map(row => Float64Array.from(colTeams, X => { let n = 0; for (const f of X) n += row[f]; return n; }));
  const synT = rowTeams.map(t => { let n = 0; for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) n += syn[t[i]][t[j]]; return n; });
  return (ti, xi) => {
    const t = rowTeams[ti], X = colTeams[xi], mx = maxT[ti];
    let cov = 0, exp = 0, str = 0;
    for (const f of X) cov += mx[f];
    for (const a of t) { exp += minR[a][xi]; str += sumR[a][xi]; }
    return cov / X.length + 0.4 * exp / t.length + 0.4 * str / (t.length * X.length) + 0.12 * synT[ti];
  };
}

function softmax(scores, keep) {
  const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]).slice(0, keep);
  const top = scores[idx[0]];
  const w = idx.map(i => Math.exp((scores[i] - top) / TEMP));
  const tot = w.reduce((a, b) => a + b, 0);
  return idx.map((i, k) => ({ i, p: w[k] / tot }));
}

// ---------------- the draft ----------------

// mine / theirs: the real builds of each side's bring. The AI uses its own real builds and guessed builds
// for the other side. Returns the 6 in order (openers first), the predictions and the reasoning log.
export function draftSide(data, mine, theirSeen, opts, r) {
  const level = opts.level || COMPETITIVE.level, size = COMPETITIVE.teamSize, cap = opts.pickLegendCap ?? 1;
  const theirs = theirSeen;
  const MA = matchups(data, mine, theirs, level);
  const MB = matchups(data, theirs, mine, level);
  const rm = mine.map(b => roles(data, b)), rt = theirs.map(b => roles(data, b));
  const synOf = (bs, rs) => bs.map((a, i) => bs.map((b, j) => i === j ? { v: 0, why: [] } : synergy(a, b, rs[i], rs[j])));
  const SA = synOf(mine, rm), SB = synOf(theirs, rt);
  const sa = SA.map(row => row.map(x => x.v)), sb = SB.map(row => row.map(x => x.v));
  const all = n => Array.from({ length: n }, (_, i) => i);
  const myTeams = sixes(mine.map(b => b.e), size, cap), theirTeams = sixes(theirs.map(b => b.e), size, cap);

  // level 1: what each side looks best with against the other's whole bring
  const P1 = softmax(theirTeams.map(t => teamScore(MB, t, all(mine.length), null, sb)), KEEP);
  const Q1 = softmax(myTeams.map(t => teamScore(MA, t, all(theirs.length), null, sa)), KEEP);
  // level 2: they expect my level-1 picks and answer them
  // team against team from either side: my score minus theirs
  const mineVs = scorer(MA, myTeams, theirTeams, sa), theirsVs = scorer(MB, theirTeams, myTeams, sb);
  const h2h = (ti, xi) => mineVs(ti, xi) - theirsVs(xi, ti);
  const P2 = softmax(theirTeams.map((t, xi) => Q1.reduce((n, q) => n - q.p * h2h(q.i, xi), 0)), KEEP);
  // blend both levels: a real opponent may or may not think a step ahead
  const pred = new Map();
  for (const x of P1) pred.set(x.i, (pred.get(x.i) || 0) + 0.4 * x.p);
  for (const x of P2) pred.set(x.i, (pred.get(x.i) || 0) + 0.6 * x.p);
  const P = [...pred.entries()].map(([i, p]) => ({ i, p })).sort((a, b) => b.p - a.p).slice(0, KEEP);
  const tot = P.reduce((n, x) => n + x.p, 0);
  P.forEach(x => { x.p /= tot; });

  // my pick: expected result across the predictions, minus a share of the worst likely one
  const likely = P.filter(x => x.p >= 0.08).slice(0, 3);
  const scored = myTeams.map((t, ti) => {
    let ev = 0, worst = 9, worstI = -1;
    for (const x of P) {
      const v = h2h(ti, x.i);
      ev += x.p * v;
      if (likely.includes(x) && v < worst) { worst = v; worstI = x.i; }
    }
    return { ti, ev, worst: worstI < 0 ? ev : worst, worstI, v: ev + RISK * Math.min(0, worstI < 0 ? ev : worst) };
  }).sort((a, b) => b.v - a.v);
  // a little randomness among near-equal picks, so the same 10 doesn't always draft the same 6
  const near = scored.filter(s => s.v >= scored[0].v - 0.03).slice(0, 3);
  const choice = near[Math.floor(r() * near.length)];
  const six = myTeams[choice.ti];

  // openers: fit the openers they're likely to use, plus the value of a good lead (Fake Out, speed control...)
  const theirLeads = t => {
    let best = null, bv = -9;
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
      const v = teamScore(MB, [t[i], t[j]], all(mine.length), null, sb) + leadBonus(rt[t[i]]) + leadBonus(rt[t[j]]);
      if (v > bv) { bv = v; best = [t[i], t[j]]; }
    }
    return best;
  };
  const leadGuess = P.slice(0, 6).map(x => ({ p: x.p, leads: theirLeads(theirTeams[x.i]), team: theirTeams[x.i] }));
  let lead = null, lv = -9;
  for (let i = 0; i < six.length; i++) for (let j = i + 1; j < six.length; j++) {
    const pair = [six[i], six[j]];
    let v = leadBonus(rm[six[i]]) + leadBonus(rm[six[j]]) + 0.3 * sa[six[i]][six[j]];
    for (const g of leadGuess) v += g.p * (0.6 * teamScore(MA, pair, g.leads, null, sa) + 0.4 * teamScore(MA, pair, g.team, null, sa));
    if (v > lv) { lv = v; lead = pair; }
  }
  // the back four, best coverage of the predicted teams first
  const weight = new Array(theirs.length).fill(0);
  for (const x of P) for (const f of theirTeams[x.i]) weight[f] += x.p;
  const backValue = a => weight.reduce((n, w, f) => n + w * MA[a][f], 0);
  const back = six.filter(a => !lead.includes(a)).sort((a, b) => backValue(b) - backValue(a));
  const order = [...lead, ...back];

  return {
    order, predicted: P.slice(0, 3).map(x => ({ team: theirTeams[x.i], p: x.p })),
    log: reasoning({ mine, theirs, MA, SA, SB, P, theirTeams, order, weight, choice, cap }),
  };
}

// ---------------- the reasoning log ----------------

const nm = b => b.e.name;
const list = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
const pctS = p => Math.round(p * 100) + '%';

function topCores(bs, S, n) {
  const pairs = [];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (S[i][j].v >= 0.45) pairs.push({ i, j, v: S[i][j].v, why: S[i][j].why });
  return pairs.sort((a, b) => b.v - a.v).slice(0, n);
}

function reasoning(c) {
  const { mine, theirs, MA, SA, SB, P, theirTeams, order, weight, choice, cap } = c;
  const lines = [];
  // reading their bring
  const legs = theirs.filter(b => LEGEND.has(b.e.rarity));
  const cores = topCores(theirs, SB, 3);
  let read = `**Reading their ${theirs.length}:** `;
  read += cores.length ? `${cores.length === 1 ? 'one core stands out' : `${cores.length} cores stand out`}: ${cores.map(k => `${nm(theirs[k.i])} + ${nm(theirs[k.j])} (${k.why[0]})`).join('; ')}.` : 'no strong pairs, so they look like a team of individually strong picks.';
  if (legs.length) {
    const locked = theirs.length - legs.length === COMPETITIVE.teamSize - cap;
    read += ` They brought ${legs.length} legendar${legs.length > 1 ? 'ies or mythicals' : 'y or mythical'} (${list(legs.map(nm))}) and can use only ${cap}.`;
    if (locked) read += ` That means all ${theirs.length - legs.length} of their others are certain picks.`;
  }
  const threats = weight.map((w, f) => ({ f, t: w * -Math.max(...order.map(a => MA[a][f])) })).sort((a, b) => b.t - a.t);
  lines.push(read);
  // prediction
  // the most likely 6 in full, the next ones as swaps from it
  const top = theirTeams[P[0].i];
  const swap = t => { const inn = t.filter(f => !top.includes(f)).map(f => nm(theirs[f])), out = top.filter(f => !t.includes(f)).map(f => nm(theirs[f])); return `with ${list(inn)} instead of ${list(out)}`; };
  const pTop = P.slice(0, 3).map((x, k) => k === 0 ? `most likely ${list(top.map(f => nm(theirs[f])))} (${pctS(x.p)})` : `or ${swap(theirTeams[x.i])} (${pctS(x.p)})`);
  const legP = legs.map(b => ({ b, p: P.reduce((n, x) => n + (theirTeams[x.i].some(f => theirs[f] === b) ? x.p : 0), 0) })).sort((a, b) => b.p - a.p);
  lines.push(`**Prediction:** ${pTop.join('; ')}.${legP.length ? ` ${nm(legP[0].b)} is in ${pctS(legP[0].p)} of the teams I expect.` : ''} Their builds are hidden, so I'm assuming standard builds.`);
  // my picks, one reason each
  const why = a => {
    const foes = weight.map((w, f) => ({ f, s: w * MA[a][f] })).filter(x => MA[a][x.f] > 0.3).sort((x, y) => y.s - x.s).slice(0, 2).map(x => nm(theirs[x.f]));
    const partners = order.filter(b => b !== a && SA[a][b].v >= 0.45).map(b => SA[a][b].why[0]);
    const parts = [];
    if (partners.length) parts.push(partners[0]);
    if (foes.length) parts.push(`answers ${list(foes)}`);
    if (!parts.length) parts.push('the best fit left for the back');
    return parts.join('; ');
  };
  lines.push(`**My 6:** open with ${order.slice(0, 2).map(a => `${nm(mine[a])} (${why(a)})`).join(' and ')}. In the back: ${order.slice(2).map(a => `${nm(mine[a])} (${why(a)})`).join(', ')}.`);
  // who stays home
  const out = mine.map((b, i) => i).filter(i => !order.includes(i));
  const outLeg = out.filter(i => LEGEND.has(mine[i].e.rarity));
  if (out.length) {
    const reasonOut = i => {
      const loses = weight.map((w, f) => ({ f, s: w * MA[i][f] })).filter(x => MA[i][x.f] < -0.3).sort((x, y) => x.s - y.s).slice(0, 2).map(x => nm(theirs[x.f]));
      return loses.length ? `loses to ${list(loses)}` : 'others cover the same foes better';
    };
    lines.push(`**Left out:** ${out.map(i => `${nm(mine[i])} (${outLeg.includes(i) && order.some(a => LEGEND.has(mine[a].e.rarity)) ? `only ${cap} legendary allowed` : reasonOut(i)})`).join(', ')}.`);
  }
  // risk
  if (choice.worstI >= 0 && choice.worst < choice.ev - 0.05) {
    const t = theirTeams[choice.worstI];
    const hard = threats.filter(x => t.includes(x.f)).slice(0, 2).map(x => nm(theirs[x.f]));
    const which = choice.worstI === P[0].i ? 'against their most likely 6' : `if they come ${swap(t)}`;
    lines.push(`**Risk:** ${which}, ${hard.length ? `${list(hard)} ${hard.length > 1 ? 'are' : 'is'} the hardest to handle` : 'the matchup gets closer'}.`);
  }
  return lines;
}

// Which of the 6 actually brought the AI predicted, for prediction accuracy.
export function predictionHit(predicted, actual) {
  const top = predicted[0]?.team || [];
  const hit = top.filter(i => actual.includes(i)).length;
  return { overlap: hit / actual.length, exact: hit === actual.length };
}

