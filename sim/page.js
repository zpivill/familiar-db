// The Simulator page (#sim): settings, running batches in Web Workers, and the balance reports.
// A classic script that uses app.js helpers ($, esc, badge, roster, moves, charLink, rarityName, RARITY).

const SIM = {
  workers: [], ready: false, meta: null, stats: null, running: false, done: 0, target: 0, t0: 0, ms: 0, runId: 0,
  tab: 'overview', sort: {}, q: '', vsKey: '', watch: null, error: '', drawPending: false, lastOpts: null,
  opts: { format: 'duel', teamSize: 3, count: 5000, forms: 'final', tiers: [], sameTier: false, gags: true, movesets: 'smart', level: 100, hpScale: 1, focus: '', teamSearch: '', ban: 0, training: 'base', items: 'none', draft: '8' },
  overrides: {},
};
const SIM_TABS = [['overview', 'Overview'], ['chars', 'Characters'], ['abilities', 'Abilities'], ['moves', 'Moves'], ['types', 'Types'],
  ['teams', 'Teams'], ['matchups', 'Matchups'], ['draft', 'Draft'], ['meta', 'Meta'], ['builds', 'Builds'], ['watch', 'Watch a battle'], ['rules', 'Rules']];
const FORMATS = [['duel', 'One on one', 'Single character vs single character. The cleanest read on each character.'],
  ['team', 'Team singles', 'Teams battle one at a time with switching, like a trainer battle.'],
  ['duos', 'Duos', 'Two on the field per side, for special battles. Spread moves and partner abilities matter here.'],
  ['comp', 'Competitive doubles', 'The future competitive format. With Team preview on, each side brings 8 (or 10) with up to 3 legendaries or mythicals (5 when bringing 10), sees only the other side\'s characters, and its AI drafts 6 with at most 1 legendary or mythical; the first two picked open. Doubles with all 6, everyone at level 50 with moves learned up to level 100, AI-trained EVs, natures and IVs, one held item each (one of each per team). A battle still going after 50 turns is a draw and counts as a non-win for both sides. Watch a battle shows each side\'s draft reasoning.']];

// ---- workers ----
function simWorkers() {
  if (SIM.workers.length) return;
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  let ready = 0;
  for (let i = 0; i < n; i++) {
    const w = new Worker('sim/worker.js', { type: 'module' });
    w.onmessage = ({ data: msg }) => simMessage(msg, i, () => { if (++ready === n) { SIM.ready = true; simDraw(); } });
    w.onerror = e => { SIM.error = 'The simulator could not start in this browser: ' + (e.message || 'worker error'); simDraw(); };
    w.postMessage({ cmd: 'init', characters: roster, moves });
    SIM.workers.push(w);
  }
}

function simMessage(msg, i, onReady) {
  if (msg.type === 'ready') { if (!SIM.meta) SIM.meta = { ...msg, byKey: new Map(msg.entrants.map(e => [e.key, e])), moveById: new Map(msg.moves.map(m => [m.id, m])) }; onReady(); }
  if (msg.type === 'progress' && msg.id === SIM.runId) {
    SIM.stats = simMerge(SIM.stats || simEmpty(), msg.stats);
    simMergeTeams(SIM.batch, msg.stats);
    const T = SIM.plan && SIM.full[SIM.gen]; if (T) simAddWins(T, msg.stats.full);
    SIM.done = SIM.stats.battles; SIM.ms = performance.now() - SIM.t0;
    simDraw();
  }
  if (msg.type === 'done' && msg.id === SIM.runId) {
    SIM.left--;
    if (SIM.left > 0) return;
    const res = SIM.resolve; SIM.resolve = null;
    if (res) return res(SIM.batch);
    SIM.running = false; SIM.ms = performance.now() - SIM.t0; simDraw();
  }
  if (msg.type === 'watch') { SIM.watch = msg.result; SIM.watching = false; simDraw(); }
  if (msg.type === 'error') { SIM.error = msg.message; SIM.running = false; SIM.resolve = null; simDraw(); }
}

const simEmpty = () => ({ battles: 0, draws: 0, turns: 0, turnHist: {}, ent: {}, abil: {}, move: {}, moveBy: {}, combo: {}, pairs: {}, vs: {}, item: {}, nature: {}, bring: {}, core: {}, leadPair: {}, vsChar: {}, draft: { g: 0, overlap: 0, exact: 0 }, faster: { g: 0, w: 0 } });
function simMerge(T, S) {
  T.battles += S.battles; T.draws += S.draws; T.turns += S.turns;
  for (const [t, n] of Object.entries(S.turnHist || {})) T.turnHist[t] = (T.turnHist[t] || 0) + n;
  if (S.draft) for (const f of ['g', 'overlap', 'exact']) T.draft[f] += S.draft[f];
  for (const k of ['ent', 'abil', 'move', 'moveBy', 'combo', 'pairs', 'vs', 'item', 'nature', 'bring', 'core', 'leadPair', 'vsChar']) for (const [key, v] of Object.entries(S[k] || {})) {
    const t = T[k][key] || (T[k][key] = {});
    for (const f in v) t[f] = (t[f] || 0) + v[f];
  }
  T.faster.g += S.faster.g; T.faster.w += S.faster.w;
  return T;
}
const simAddWins = (T, S) => { for (const [k, v] of Object.entries(S || {})) { const t = T[k] || (T[k] = { g: 0, w: 0 }); t.g += v.g; t.w += v.w; } return T; };
// Team results of the batch in flight: wins per team, head-to-head, and how each team wins.
function simMergeTeams(T, S) {
  if (!T) return;
  simAddWins(T.full, S.full); simAddWins(T.h2h, S.h2h);
  for (const [k, P] of Object.entries(S.teamPick || {})) {
    const t = T.pick[k] || (T.pick[k] = { g: 0, w: 0, turns: 0, pick: {}, lead: {}, pickW: {} });
    t.g += P.g; t.w += P.w; t.turns += P.turns;
    for (const f of ['pick', 'lead', 'pickW']) for (const [x, v] of Object.entries(P[f])) t[f][x] = (t[f][x] || 0) + v;
  }
  for (const [k, D] of Object.entries(S.detail || {})) {
    const t = T.detail[k] || (T.detail[k] = { g: 0, w: 0, winTurns: 0, kos: {}, dmg: {}, use: {} });
    t.g += D.g; t.w += D.w; t.winTurns += D.winTurns;
    for (const f of ['kos', 'dmg', 'use']) for (const [x, v] of Object.entries(D[f])) t[f][x] = (t[f][x] || 0) + v;
  }
}
function simMergeDetail(T, S) { simMergeTeams({ full: {}, h2h: {}, pick: {}, detail: T }, { detail: S }); return T; }
function simMergePick(T, S) { simMergeTeams({ full: {}, h2h: {}, detail: {}, pick: T }, { teamPick: S }); return T; }

const simRules = () => ({ level: +SIM.opts.level, hpScale: +SIM.opts.hpScale });
// Training and items options sent with every run: AI picks plus the overrides from the Builds tab.
const simBuildOpts = o => ({ training: o.training === 'ai' ? 'ai' : 'none', items: o.items === 'ai' ? 'ai' : 'none', overrides: SIM.overrides,
  draft: o.format === 'comp' && o.draft !== 'off', bring: +o.draft || 8 });
// Sends `total` battles to the workers, split evenly, and resolves with that batch's team results.
// A team ranking passes the same ladder to all of them, and each worker starts at a different team
// so every team gets about the same number of battles.
function simSend(total, ladder, ladderSize) {
  const o = SIM.lastOpts, n = SIM.workers.length;
  const seed = Math.floor(Math.random() * 1e9);
  SIM.runId++; SIM.left = n; SIM.batch = { full: {}, h2h: {}, detail: {}, pick: {} };
  const done = new Promise(res => { SIM.resolve = res; });
  SIM.workers.forEach((w, i) => {
    const count = Math.floor(total / n) + (i < total % n ? 1 : 0);
    w.postMessage({ cmd: 'run', id: SIM.runId, rules: simRules(), chunk: 250,
      opts: { format: o.format, teamSize: +o.teamSize, count, forms: o.forms, tiers: o.tiers, sameTier: o.sameTier, gags: o.gags, movesets: o.movesets, level: +o.level, focus: o.focus || null, seed: seed + i * 7919, ...simBuildOpts(o),
        ladder, offset: Math.floor(i * (ladderSize || 0) / n) } });
  });
  return done;
}
const simRows = full => Object.entries(full).map(([k, v]) => { const wr = v.w / v.g; return { k, keys: k.split('+'), ...v, wr, sure: wr - margin(wr, v.g) }; }).sort((a, b) => b.sure - a.sure);

// Team ranking is a search over generations. Generation 1 plays a big field of random teams against each other.
// Each later generation keeps the best fifth, adds two one-swap variants of each, mixes kept teams together,
// and adds fresh random teams; new members lean toward characters with good win rates so far, but a third
// of picks stay uniform so niche and lower tier picks keep getting a chance. The last generation replays
// only the best 32 teams found with a quarter of the battles, so their win rates are tight.
// With `field` set, every team plays those fixed opponents instead of each other, so the search looks for
// the best counter to them.
const SIM_FINAL_TEAMS = 32;
function simPlan(total) {
  const gens = Math.max(3, Math.min(14, Math.round(total / 8000) + 2));
  const first = Math.round(total * 0.2), mid = Math.floor((total - first - Math.round(total * 0.25)) / (gens - 2));
  return Array.from({ length: gens }, (_, i) => i === 0 ? first : i < gens - 1 ? mid : total - first - mid * (gens - 2));
}
async function simSearch(total, field, start, ban) {
  const id = SIM.jobId;
  SIM.plan = simPlan(total); SIM.gen = 0; SIM.full = [{}]; SIM.kept = {};
  const vs = { ...(field ? { vs: field.vs, vsWeights: field.weights } : {}), ...(ban?.length ? { ban } : {}) };
  const first = Math.max(40, Math.min(400, Math.round(SIM.plan[0] * 2 / 60)));
  let res = await simSend(SIM.plan[0], { fresh: first, top: start || [], variants: start ? 1 : 0, seed: Math.floor(Math.random() * 1e9), ...vs }, first + (start?.length || 0) * 2);
  for (SIM.gen = 1; SIM.gen < SIM.plan.length; SIM.gen++) {
    if (id !== SIM.jobId) return null;
    const prev = simRows(res.full), battles = SIM.plan[SIM.gen], last = SIM.gen === SIM.plan.length - 1;
    SIM.full.push({});
    const weights = Object.fromEntries(Object.entries(SIM.stats.ent).map(([k, v]) => [k, Math.max(0.02, v.w / v.g) ** 3]));
    const seed = Math.floor(Math.random() * 1e9);
    let ladder, size;
    if (last) { ladder = { top: prev.slice(0, SIM_FINAL_TEAMS).map(r => r.keys), detail: true, seed, ...vs }; size = ladder.top.length; }
    else {
      const pop = Math.max(30, Math.min(160, Math.round(battles * 2 / 80))), keep = Math.round(pop / 5);
      ladder = { top: prev.slice(0, keep).map(r => r.keys), variants: 2, crosses: keep, fresh: keep, weights, seed, picks: simPickRates(res.pick, prev.slice(0, keep)), ...vs };
      size = keep * 5;
    }
    for (const t of ladder.top) for (const k of t) SIM.kept[k] = (SIM.kept[k] || 0) + 1;
    simDraw();
    res = await simSend(battles, ladder, size);
  }
  SIM.gen = SIM.plan.length - 1;
  return { rows: simRows(res.full), detail: res.detail, pick: res.pick };
}
// How often the draft picked each member of these teams, as team key -> { member: share of games }.
function simPickRates(pick, rows) {
  const out = {};
  for (const r of rows) { const P = pick?.[r.k]; if (P?.g) out[r.k] = Object.fromEntries(r.keys.map(x => [x, (P.pick[x] || 0) / P.g])); }
  return out;
}

// Meta chain: find the strongest team, then the best counter to it, then the best counter to that one, and so on.
// Each counter search plays the latest meta team 60% of the time and the earlier ones the rest, so a counter
// has to beat the current top team without folding to the older ones. At the end every meta team plays every
// other one, for the who-beats-whom table.
async function simMetaChain(total) {
  const id = SIM.jobId, C = SIM.chain;
  const rounds = Math.max(2, Math.min(5, Math.round(total / 20000)));
  const firstBudget = Math.round(total * 0.4), matrix = Math.round(total * 0.1), each = Math.floor((total - firstBudget - matrix) / rounds);
  C.rounds = rounds + 1;
  C.round = 0;
  let res = await simSearch(firstBudget);
  if (!res || id !== SIM.jobId) return;
  C.teams.push({ keys: res.rows[0].keys, wr: res.rows[0].wr, g: res.rows[0].g, vsField: 'the strongest teams found', pick: res.pick?.[res.rows[0].k] });
  simMergeDetail(C.detail, res.detail);
  for (let k = 1; k <= rounds; k++) {
    C.round = k;
    const prevKeys = C.teams.map(t => t.keys.join('+'));
    const n = C.teams.length;
    const weights = C.teams.map((_, i) => i === n - 1 ? (n === 1 ? 1 : 0.6) : 0.4 / (n - 1));
    // optional bans: the characters picked most often by the meta teams so far sit out this counter round,
    // so the search has to find other answers (ties go to the higher individual win rate)
    const picks = {};
    C.teams.forEach(t => t.keys.forEach(x => { picks[x] = (picks[x] || 0) + 1; }));
    const wr = x => { const v = SIM.stats.ent[x]; return v ? v.w / v.g : 0; };
    const ban = +SIM.lastOpts.ban ? Object.keys(picks).sort((a, b) => picks[b] - picks[a] || wr(b) - wr(a)).slice(0, +SIM.lastOpts.ban) : [];
    const start = res.rows.filter(r => !prevKeys.includes(r.k) && !r.keys.some(x => ban.includes(x))).slice(0, 8).map(r => r.keys);
    res = await simSearch(each, { vs: C.teams.map(t => t.keys), weights }, start, ban);
    if (!res || id !== SIM.jobId) return;
    const best = res.rows.find(r => !prevKeys.includes(r.k)) || res.rows[0];
    C.teams.push({ keys: best.keys, wr: best.wr, g: best.g, banned: ban, pick: res.pick?.[best.k] });
    simMergeDetail(C.detail, res.detail);
  }
  C.round = rounds + 1; C.matrix = true;
  SIM.plan = null;
  res = await simSend(SIM.target - SIM.done, { top: C.teams.map(t => t.keys), h2h: true, detail: true, seed: Math.floor(Math.random() * 1e9) }, C.teams.length);
  if (id !== SIM.jobId) return;
  simAddWins(C.h2h, res.h2h); simMergeDetail(C.detail, res.detail);
  for (const t of C.teams) { const P = res.pick?.[t.keys.join('+')]; if (P?.g) t.pick = P; }
}

async function simRun() {
  if (!SIM.ready) return;
  const o = SIM.opts;
  SIM.stats = simEmpty(); SIM.done = 0; SIM.target = +o.count; SIM.running = true; SIM.t0 = performance.now(); SIM.error = '';
  SIM.lastOpts = { ...o, tiers: [...o.tiers] };
  SIM.jobId = (SIM.jobId || 0) + 1; SIM.stopped = false;
  SIM.plan = null; SIM.full = []; SIM.kept = {}; SIM.best = null;
  SIM.mode = o.format !== 'duel' ? o.teamSearch || '' : '';
  SIM.chain = SIM.mode === 'meta' ? { teams: [], detail: {}, h2h: {}, round: 0, rounds: 0 } : null;
  simDraw();
  if (!SIM.mode) await simSend(SIM.target);
  else {
    SIM.tab = 'teams';
    if (SIM.mode === 'best') { const r = await simSearch(SIM.target); if (r) SIM.best = r; }
    else await simMetaChain(SIM.target);
  }
  SIM.running = false; SIM.ms = performance.now() - SIM.t0;
  simDraw();
}
function simStop() {
  SIM.workers.forEach(w => w.terminate());
  SIM.workers = []; SIM.ready = false; SIM.running = false; SIM.stopped = true; SIM.resolve = null; SIM.jobId = (SIM.jobId || 0) + 1;
  simWorkers();
  simDraw();
}

// ---- helpers ----
const pctf = (x, d = 0) => isFinite(x) ? (x * 100).toFixed(d) + '%' : '—';
const num1 = (x, d = 1) => isFinite(x) ? (+x).toFixed(d) : '—';
// 95% margin of a win rate, so small samples aren't read as real differences.
// A pinch of smoothing keeps 3 wins out of 3 from showing as a certain 100%.
const margin = (p, n) => { if (!n) return 1; const q = (p * n + 1) / (n + 2); return 1.96 * Math.sqrt(q * (1 - q) / n); };
const entName = k => SIM.meta?.byKey.get(k)?.name || k;
const entLink = k => {
  const e = SIM.meta?.byKey.get(k);
  const c = e && find(roster, e.cid);
  const j = +(k.split('/')[1] || 1) - 1;
  return c ? `<a href="${charLink(c, j)}">${esc(e.name)}</a>` : esc(k);
};
const minGames = () => {
  const S = SIM.stats; if (!S) return 1;
  const per = S.battles * 2 * (SIM.lastOpts?.format === 'duel' ? 1 : +SIM.lastOpts?.teamSize || 3) / Math.max(1, Object.keys(S.ent).length);
  return Math.max(5, Math.round(per * 0.25));
};

// Sortable table. cols: [label, value fn, render fn?, cls?]
function simTable(id, rows, cols, opts = {}) {
  const st = SIM.sort[id] || { k: opts.sortBy ?? 0, dir: -1 };
  const q = SIM.q.trim().toLowerCase();
  let list = q && opts.search ? rows.filter(r => opts.search(r).toLowerCase().includes(q)) : rows;
  const val = cols[st.k][1];
  list = [...list].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * st.dir; });
  const limit = opts.limit || 300;
  const head = cols.map((c, k) => `<th class="${c[3] || ''}"><button type="button" class="sortb" data-sort="${id}:${k}">${c[0]}${st.k === k ? (st.dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`).join('');
  const body = list.slice(0, limit).map(r => `<tr>${cols.map(c => `<td class="${c[3] || ''}">${c[2] ? c[2](r) : esc(c[1](r))}</td>`).join('')}</tr>`).join('');
  SIM.tables = SIM.tables || {};
  SIM.tables[id] = { cols, list };
  return `<div class="scroll"><table class="moves simt"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="tbd">Nothing yet</td></tr>`}</tbody></table></div>
    <p class="hint">${list.length > limit ? `Showing ${limit} of ${list.length}. ` : ''}<button type="button" class="linkb" data-csv="${id}">Download as CSV</button></p>`;
}

function simCsv(id) {
  const t = SIM.tables?.[id]; if (!t) return;
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [t.cols.map(c => cell(c[0])).join(','), ...t.list.map(r => t.cols.map(c => cell(c[1](r))).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `familiar-sim-${id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const winCell = (w, g) => `${pctf(w / g, 1)} <span class="hint">±${(margin(w / g, g) * 100).toFixed(0)}</span>`;

// ---- report sections ----
function simCharRows() {
  const S = SIM.stats, min = minGames();
  return Object.entries(S.ent).filter(([, v]) => v.g >= min).map(([k, v]) => ({ k, e: SIM.meta.byKey.get(k) || {}, ...v, wr: v.w / v.g }));
}

function simOverview() {
  const S = SIM.stats, o = SIM.lastOpts;
  const rows = simCharRows().sort((a, b) => b.wr - a.wr);
  let sigD = 0, allD = 0, sigK = 0, allK = 0;
  for (const [id, v] of Object.entries(S.move)) { const m = SIM.meta.moveById.get(id); allD += v.dmg; allK += v.kos; if (m?.sig) { sigD += v.dmg; sigK += v.kos; } }
  const tierRows = {};
  rows.forEach(r => { const t = tierRows[r.e.rarity] || (tierRows[r.e.rarity] = { g: 0, w: 0, n: 0 }); t.g += r.g; t.w += r.w; t.n++; });
  const mono = { g: 0, w: 0 }, dual = { g: 0, w: 0 };
  rows.forEach(r => { const x = r.e.types?.length > 1 ? dual : mono; x.g += r.g; x.w += r.w; });
  const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  const list = rs => `<ol class="simlist">${rs.map(r => `<li>${entLink(r.k)} <span class="hint">${rarityName(r.e.rarity)}</span> <b>${pctf(r.wr)}</b></li>`).join('')}</ol>`;
  const avgTurns = S.turns / S.battles, len = simTurnStats(S);
  const flags = [];
  if (avgTurns < 3 && o.format === 'duel') flags.push(`One on one battles last ${num1(avgTurns)} turns on average, so most fights are decided by one or two hits. Setup, status and healing moves barely get a chance. Try Vitality ×1.5 or ×2 in the settings to see how longer fights change things.`);
  if (len && o.format !== 'duel' && len.p90 <= 10) flags.push(`Nine in ten battles end by turn ${len.p90} (middle 80%: turns ${len.p10} to ${len.p90}), so almost every game is a short race. Supports, setup and speed control have little time to pay off.`);
  if (sigD / allD > 0.4) flags.push(`Signature moves deal ${pctf(sigD / allD)} of all damage and land ${pctf(sigK / allK)} of knockouts. They are always equipped, so a strong signature lifts a character a lot.`);
  const top = rows[0], bottom = rows.at(-1);
  if (top && top.wr > 0.85) flags.push(`${esc(top.e.name)} wins ${pctf(top.wr)} of its battles.`);
  if (o.format === 'duel' && S.faster.g) flags.push(`The faster character wins ${pctf(S.faster.w / S.faster.g)} of one on one battles.`);
  const tiers = RARITY.map(([k, l]) => tierRows[k] ? `<div><span>${l}</span><em style="--t:var(--accent);width:${tierRows[k].w / tierRows[k].g * 100}%"></em><span>${pctf(tierRows[k].w / tierRows[k].g)}</span></div>` : '').join('');
  return `<div class="stats">${stat(S.battles.toLocaleString(), 'battles')}${stat(num1(avgTurns), 'turns on average')}${len ? stat(num1(len.sd), 'turns spread (std)') : ''}${stat(pctf(S.draws / S.battles, 1), 'draws')}
      ${stat(pctf(sigD / allD), 'of damage from signatures')}${stat(pctf(mono.w / mono.g), 'mono-type win rate')}${stat(pctf(dual.w / dual.g), 'dual-type win rate')}</div>
    ${flags.length ? `<h3>What stands out</h3><ul class="simflags">${flags.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
    <div class="simcols"><section><h3>Strongest</h3>${list(rows.slice(0, 10))}</section><section><h3>Weakest</h3>${list(rows.slice(-10).reverse())}</section></div>
    ${len ? simTurnBars(len) : ''}
    <h3>Win rate by tier</h3><p class="hint">${o.sameTier ? 'Battles were within one tier, so every tier sits near 50% and this shows nothing.' : 'Battles mix tiers, so later tiers should win more. Turn on "Same tier only" to compare characters with their own tier.'}</p>
    <div class="bars simbars">${tiers}</div>
    <p class="hint">Characters with fewer than ${minGames()} battles are left out of the lists. ± is the 95% margin: two win rates closer than that may just be luck.</p>`;
}

// Battle length from the turn counts: average, spread and the share of battles ending on each turn.
function simTurnStats(S) {
  const H = Object.entries(S.turnHist || {}).map(([t, n]) => [+t, n]).sort((a, b) => a[0] - b[0]);
  const N = H.reduce((s, x) => s + x[1], 0);
  if (!N) return null;
  const mean = H.reduce((s, [t, n]) => s + t * n, 0) / N;
  const q = p => { let c = 0; for (const [t, n] of H) if ((c += n) >= p * N) return t; return H.at(-1)[0]; };
  return { H, N, mean, sd: Math.sqrt(H.reduce((s, [t, n]) => s + n * (t - mean) ** 2, 0) / N), p10: q(0.1), median: q(0.5), p90: q(0.9) };
}
function simTurnBars(L) {
  const buckets = [];
  const add = (label, lo, hi) => { const n = L.H.filter(([t]) => t >= lo && t <= hi).reduce((s, x) => s + x[1], 0); if (n) buckets.push([label, n / L.N]); };
  add('1-3', 1, 3);
  for (let t = 4; t <= 15; t++) add(String(t), t, t);
  add('16-25', 16, 25); add('26-49', 26, 49); add('50+', 50, 1e9);
  const top = Math.max(...buckets.map(b => b[1]));
  return `<h3>Battle length</h3><p class="hint">Average ${num1(L.mean)} turns, spread (standard deviation) ${num1(L.sd)}, median ${L.median}. The middle 80% of battles end between turn ${L.p10} and turn ${L.p90}. Each bar is the share of battles that ended on that turn.</p>
    <div class="bars simbars">${buckets.map(([l, f]) => `<div><span>${l}</span><em style="--t:var(--accent);width:${f / top * 100}%"></em><span>${pctf(f, 1)}</span></div>`).join('')}</div>`;
}

function simChars() {
  const rows = simCharRows();
  return `<p class="hint">Win rate is the share of battles the character's side won. KOs, damage and survival are per battle; damage is in bars of the character's own Vitality.</p>
    ${simTable('chars', rows, [
      ['Character', r => r.e.name || r.k, r => entLink(r.k)],
      ['Tier', r => rarityName(r.e.rarity)],
      ['Types', r => (r.e.types || []).join('/'), r => (r.e.types || []).map(badge).join(' ')],
      ['Total', r => r.e.total || 0, null, 'sv'],
      ['Battles', r => r.g, null, 'sv'],
      ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
      ['KOs', r => r.kos / r.g, r => num1(r.kos / r.g, 2), 'sv'],
      ['Damage', r => r.dmg / r.g, r => num1(r.dmg / r.g, 2), 'sv'],
      ['Survived', r => 1 - r.faint / r.g, r => pctf(1 - r.faint / r.g), 'sv'],
      ['Turns out', r => r.turns / r.g, r => num1(r.turns / r.g), 'sv'],
    ], { sortBy: 5, search: r => `${r.e.name} ${r.e.charName} ${r.e.rarity} ${(r.e.types || []).join(' ')}` })}`;
}

function simAbilities() {
  const S = SIM.stats, ent = S.ent;
  const rows = Object.entries(S.abil).map(([k, v]) => {
    const [key, name] = k.split('|');
    const e = SIM.meta.byKey.get(key) || {};
    const base = ent[key] ? ent[key].w / ent[key].g : 0.5;
    return { key, name, e, hidden: e.abilities?.find(a => a.name === name)?.hidden, ...v, wr: v.w / v.g, d: v.w / v.g - base };
  }).filter(r => r.g >= Math.max(5, minGames() / 3));
  return `<p class="hint">Each caught copy rolls one ability, so the simulator rolls one per battle. "Vs. average" is the ability's win rate minus that character's overall win rate: a big gap means the ability decides the character.</p>
    ${simTable('abilities', rows, [
      ['Character', r => r.e.name || r.key, r => entLink(r.key)],
      ['Ability', r => r.name, r => `<b>${esc(r.name)}</b>${r.hidden ? ' <span class="badge">Hidden</span>' : ''}`],
      ['Battles', r => r.g, null, 'sv'],
      ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
      ['Vs. average', r => r.d, r => `${r.d >= 0 ? '+' : ''}${(r.d * 100).toFixed(1)}`, 'sv'],
      ['Sure gap', r => Math.max(0, Math.abs(r.d) - margin(r.wr, r.g)), r => (Math.max(0, Math.abs(r.d) - margin(r.wr, r.g)) * 100).toFixed(1), 'sv'],
    ], { sortBy: 5, search: r => `${r.e.name} ${r.name}` })}
    <p class="hint">"Sure gap" is the gap minus its 95% margin, so a big number means the difference is real and not just a small sample. Sort by it to find abilities that make or break a character.</p>`;
}

function simMoves() {
  const S = SIM.stats;
  const rows = Object.entries(S.move).map(([id, v]) => {
    const m = SIM.meta.moveById.get(id) || {};
    return { id, m, ...v, wr: v.w / v.eq, pick: v.uses / v.eq, per: v.uses ? v.dmg / v.uses : 0, ko: v.uses ? v.kos / v.uses : 0, miss: v.uses ? v.misses / v.uses : 0 };
  }).filter(r => r.eq >= 10);
  return `<p class="hint">Equipped counts battles a character carried the move. Used per battle shows how often the AI picks it when it has it: a move that is equipped but never used is dead weight. Damage is raw Vitality per use.</p>
    ${simTable('moves', rows, [
      ['Move', r => r.m.name || r.id, r => `<b>${esc(r.m.name || r.id)}</b>${r.m.sig ? ` <span class="badge sigb">Signature</span> <span class="hint">${esc(entName(r.m.owner))}</span>` : ''}`],
      ['Type', r => r.m.type || '', r => r.m.type ? badge(r.m.type) : ''],
      ['Cat.', r => r.m.cat || ''],
      ['Power', r => r.m.power || 0, r => r.m.power ?? '—', 'sv'],
      ['Equipped', r => r.eq, null, 'sv'],
      ['Win % with it', r => r.wr, r => winCell(r.w, r.eq), 'sv'],
      ['Used per battle', r => r.pick, r => num1(r.pick, 2), 'sv'],
      ['Damage per use', r => r.per, r => Math.round(r.per), 'sv'],
      ['KO per use', r => r.ko, r => pctf(r.ko), 'sv'],
      ['Miss %', r => r.miss, r => pctf(r.miss), 'sv'],
    ], { sortBy: 5, search: r => `${r.m.name} ${r.m.type} ${r.m.cat} ${r.m.sig ? 'signature ' + entName(r.m.owner) : ''}` })}`;
}

function simTypes() {
  const S = SIM.stats;
  const combos = Object.entries(S.combo).map(([k, v]) => ({ k, ...v, wr: v.w / v.g, dual: k.includes('/') })).filter(r => r.g >= 10);
  const at = {};
  for (const [id, v] of Object.entries(S.move)) {
    const m = SIM.meta.moveById.get(id); if (!m || m.cat === 'Status') continue;
    const t = at[m.type] || (at[m.type] = { type: m.type, uses: 0, dmg: 0, kos: 0, sup: 0, hits: 0 });
    t.uses += v.uses; t.dmg += v.dmg; t.kos += v.kos; t.sup += v.sup; t.hits += v.hits;
  }
  const atk = Object.values(at);
  const totalDmg = atk.reduce((s, x) => s + x.dmg, 0);
  return `<h3>Defending: win rate by type</h3><p class="hint">Each character's own types. Dual types count as one combination.</p>
    ${simTable('combos', combos, [
      ['Types', r => r.k, r => r.k.split('/').map(badge).join(' ')],
      ['Mono or dual', r => r.dual ? 'Dual' : 'Mono'],
      ['Battles', r => r.g, null, 'sv'],
      ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
    ], { sortBy: 3, search: r => r.k })}
    <h3>Attacking: how each move type performs</h3><p class="hint">Super effective is the share of hits that landed for double or more.</p>
    ${simTable('atk', atk, [
      ['Move type', r => r.type, r => badge(r.type)],
      ['Uses', r => r.uses, null, 'sv'],
      ['Share of damage', r => r.dmg / totalDmg, r => pctf(r.dmg / totalDmg, 1), 'sv'],
      ['Damage per use', r => r.dmg / Math.max(1, r.uses), r => Math.round(r.dmg / Math.max(1, r.uses)), 'sv'],
      ['Super effective', r => r.sup / Math.max(1, r.hits), r => pctf(r.sup / Math.max(1, r.hits)), 'sv'],
      ['KOs', r => r.kos, null, 'sv'],
    ], { sortBy: 2 })}`;
}

function simFullRows(gen) {
  return Object.entries(SIM.full?.[gen] || {}).map(([k, v]) => {
    const wr = v.w / v.g;
    return { k, keys: k.split('+'), ...v, wr, sure: wr - margin(wr, v.g) };
  });
}
// A one-line playstyle from how the team actually won: who lands its knockouts, how quickly its wins come,
// what it spends turns on, and what its members share (speed, bulk, type). Most features are compared with
// the other teams in the same table (`ref`), since top teams all look strong next to the whole roster.
function simTeamFeatures(keys, D) {
  const ents = keys.map(k => SIM.meta.byKey.get(k)).filter(e => e && e.stats);
  const U = Object.values(D.use).reduce((x, y) => x + y, 0) || 1, share = k => (D.use[k] || 0) / U;
  const avgTurns = SIM.stats.battles ? SIM.stats.turns / SIM.stats.battles : 1;
  const mean = f => ents.reduce((s, e) => s + f(e), 0) / (ents.length || 1);
  return {
    ents, U, share,
    setup: share('setup'), sustain: share('heal') + share('protect'), status: share('status'), attack: share('attack'),
    tempo: D.w ? D.winTurns / D.w / avgTurns : 1, winTurns: D.w ? D.winTurns / D.w : 0, avgTurns,
    spe: mean(e => e.stats.spe), bulk: mean(e => (e.stats.vit + e.stats.grd + e.stats.wil) / 3),
    phys: mean(e => e.stats.pow - e.stats.ene),
  };
}
function simPlayRef(list) {
  const fs = list.filter(x => x.D && x.D.g).map(x => simTeamFeatures(x.keys, x.D));
  const ref = {};
  for (const f of ['setup', 'sustain', 'status', 'attack', 'tempo', 'spe', 'bulk', 'phys']) ref[f] = fs.length ? fs.reduce((s, x) => s + x[f], 0) / fs.length : 0;
  return ref;
}
function simPlaystyle(keys, D, ref) {
  if (!D || !D.g || !SIM.meta) return { text: '', why: '' };
  const F = simTeamFeatures(keys, D), R = ref || F, size = keys.length;
  const kos = keys.map(k => ({ k, n: D.kos[k] || 0 })).sort((a, b) => b.n - a.n);
  const koTot = kos.reduce((s, x) => s + x.n, 0) || 1;
  const [a, b] = kos, sa = a.n / koTot, sb = b ? b.n / koTot : 0;
  const lead = size > 1 && sa >= Math.max(0.25, 1.6 / size) ? `${entName(a.k)} carry` : size > 2 && sa + sb >= Math.max(0.4, 2.6 / size) ? `${entName(a.k)} and ${entName(b.k)} lead` : '';
  // the feature that sets this team apart most from the others in the table
  const cands = [
    [(F.setup - R.setup) / Math.max(0.02, R.setup), 0.4, lead ? 'set up, then sweep' : 'setup offense'],
    [(F.sustain - R.sustain) / Math.max(0.02, R.sustain), 0.35, 'sustain and outlast'],
    [(F.status - R.status) / Math.max(0.02, R.status), 0.6, 'status pressure'],
    [(R.tempo - F.tempo) / 0.08, 1, lead ? 'fast sweep' : 'hyper offense'],
    [(F.tempo - R.tempo) / 0.08, 1, 'slow grind'],
    [(F.spe - R.spe) / 8, 1, 'fast attackers'],
    [(F.bulk - R.bulk) / 6, 1, 'bulky wall'],
    [(F.attack - R.attack) / 0.04, 1, 'all-out attack'],
  ].map(([score, need, label]) => ({ v: score / need, label })).sort((x, y) => y.v - x.v);
  const style = cands[0].v >= 1 ? cands[0].label : 'balanced attack and defence';
  const types = {}; F.ents.forEach(e => e.types.forEach(t => { types[t] = (types[t] || 0) + 1; }));
  const [coreType, coreN] = Object.entries(types).sort((x, y) => y[1] - x[1])[0] || [];
  const core = coreN >= Math.max(2, Math.ceil(F.ents.length / 2)) ? `${coreType} core` : '';
  const side = F.phys >= 15 ? 'physical' : F.phys <= -15 ? 'energy' : '';
  const text = [lead, style, [side, core].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const why = `KOs: ${kos.slice(0, 2).map(x => `${entName(x.k)} ${pctf(x.n / koTot)}`).join(', ')}. Wins take ${F.winTurns.toFixed(0)} turns (average ${F.avgTurns.toFixed(0)}). Turns spent: ${pctf(F.attack)} attacking, ${pctf(F.setup)} setup, ${pctf(F.sustain)} healing or protecting, ${pctf(F.status)} status.`;
  return { text: text[0].toUpperCase() + text.slice(1), why };
}
const playCell = p => p.text ? `${esc(p.text)}<br><span class="hint">${esc(p.why)}</span>` : '—';

// Meta chain results: the line of meta teams, each the best counter to the ones before, and who beats whom.
function simMetaView() {
  const C = SIM.chain;
  if (!C) return '';
  const T = C.teams, n = T.length, k = t => t.keys.join('+');
  const ref = simPlayRef(T.map(t => ({ keys: t.keys, D: C.detail[k(t)] })));
  const h = (i, j) => { const x = C.h2h[k(T[i]) + '|' + k(T[j])]; return x && x.g ? x.w / x.g : NaN; };
  const status = SIM.running ? (C.matrix ? 'Playing every meta team against every other one.' : C.round === 0 ? 'Round 1: finding the strongest team.' : `Round ${C.round + 1} of ${C.rounds}: finding the best counter to meta team ${n}.`)
    : SIM.stopped && !C.matrix ? 'The run stopped before the chain finished.' : '';
  const rows = T.map((t, i) => {
    const p = simPlaystyle(t.keys, C.detail[k(t)], ref);
    const others = T.map((_, j) => j).filter(j => j !== i).map(j => h(i, j)).filter(isFinite);
    return `<tr><td class="sv">${i + 1}</td><td>${t.keys.map(entLink).join(' + ')}${t.banned?.length ? `<br><span class="hint">Banned this round: ${esc(t.banned.map(entName).join(', '))}</span>` : ''}</td><td>${playCell(p)}</td>
      <td class="sv">${i === 0 ? '—' : pctf(h(i, i - 1), 1)}</td><td class="sv">${others.length ? pctf(others.reduce((a, b) => a + b, 0) / others.length, 1) : '—'}</td></tr>`;
  }).join('');
  const matrix = C.matrix && n > 1 ? `<h3>Who beats whom</h3><p class="hint">Win % of the row team against the column team.</p>
    <div class="scroll"><table class="moves simt"><thead><tr><th></th>${T.map((_, j) => `<th class="sv">vs ${j + 1}</th>`).join('')}</tr></thead><tbody>
    ${T.map((_, i) => `<tr><td class="sv">${i + 1}</td>${T.map((_, j) => i === j ? '<td class="sv">—</td>' : `<td class="sv">${pctf(h(i, j))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  return `<h2>Meta chain</h2>
    <p class="hint">Meta team 1 is the strongest team the search found. Each next one is the best counter found against the teams before it: it plays the latest meta team 60% of the time and the earlier ones the rest, so it has to beat the current top team without folding to the older ones. "Beats previous" and "Vs other meta teams" come from a final round where every meta team plays every other one. The playstyle line is worked out from how the team actually won.</p>
    ${status ? `<p class="hint"><strong>${status}</strong></p>` : ''}
    ${n ? `<div class="scroll"><table class="moves simt"><thead><tr><th class="sv">#</th><th>Team</th><th>Playstyle</th><th class="sv">Beats previous</th><th class="sv">Vs other meta teams</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${matrix}
    ${T.some(t => t.pick?.g) ? `<h3>Brought list vs picked 6</h3><p class="hint">${SIM_PICK_NOTE}${C.matrix ? ' From the final round where every meta team plays every other one.' : ''}</p>${T.map((t, i) => simPickTable(t, t.pick, `Meta team ${i + 1}`)).join('')}` : ''}`;
}

// Brought list vs picked 6: for each member of a brought list, how often the draft put it in the 6 and in the
// opening pair, how the team did when it played, and its hidden roles, so a member that never plays stands out.
function simPickTable(t, P, label) {
  if (!P?.g) return '';
  const rows = t.keys.map(x => ({ x, e: SIM.meta.byKey.get(x) || {}, p: (P.pick[x] || 0) / P.g, l: (P.lead[x] || 0) / P.g, n: P.pick[x] || 0, w: P.pick[x] ? P.pickW[x] / P.pick[x] : NaN }))
    .sort((a, b) => b.p - a.p);
  const roles = e => (find(roster, e.cid)?.roles || []).map(r => `<span class="badge role">${esc(r)}</span>`).join(' ') || '—';
  const body = rows.map(r => `<tr${r.p < 0.1 ? ' class="tbd"' : ''}><td>${entLink(r.x)}</td><td>${esc(rarityName(r.e.rarity))}${r.e.final === false ? ' <span class="hint">(not final form)</span>' : ''}</td><td>${roles(r.e)}</td>
    <td class="sv">${pctf(r.p)}</td><td class="sv">${pctf(r.l)}</td><td class="sv">${isFinite(r.w) ? winCell(r.w * r.n, r.n) : '—'}</td></tr>`).join('');
  const benched = rows.filter(r => r.p < 0.1).length;
  return `<h4>${label} <span class="hint">${P.g.toLocaleString()} games, ${num1(P.turns / P.g)} turns on average${benched ? `, ${benched} member${benched > 1 ? 's' : ''} picked under 10%` : ''}</span></h4>
    <div class="scroll"><table class="moves simt"><thead><tr><th>Brought</th><th>Tier</th><th>Roles</th><th class="sv">Picked</th><th class="sv">Opens</th><th class="sv">Win % when picked</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
const SIM_PICK_NOTE = 'How often the draft put each member of the brought list into the final 6 and into the opening pair, and the team\'s win rate in the games that member played. Members picked under 10% of the time are greyed out: they hardly ever fight, so the team is really the other members.';

function simRanking() {
  if (SIM.chain) return simMetaView() + (SIM.running && SIM.plan ? `<h3>Current search</h3>${simRankingTable()}` : '') + '<h2>Teammate pairs</h2>';
  if (!SIM.plan || !SIM.full.length) return '';
  return simRankingTable() + '<h2>Teammate pairs</h2>';
}
function simRankingTable() {
  const G = SIM.plan.length, finalGen = SIM.gen === G - 1, done = finalGen && !SIM.running;
  const rows = simFullRows(SIM.gen);
  const detail = SIM.best?.detail || (finalGen ? SIM.batch?.detail : null);
  const cols = [
    ['Team', r => r.keys.map(entName).join(' + '), r => r.keys.map(entLink).join(' + ')],
    ['Battles', r => r.g, null, 'sv'],
    ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
    ['Sure win %', r => r.sure, r => pctf(r.sure, 1), 'sv'],
  ];
  if (detail && !SIM.chain) {
    const ref = simPlayRef(rows.slice().sort((a, b) => b.sure - a.sure).slice(0, 16).map(r => ({ keys: r.keys, D: detail[r.k] })));
    cols.push(['Playstyle', r => simPlaystyle(r.keys, detail[r.k], ref).text, r => playCell(simPlaystyle(r.keys, detail[r.k], ref))]);
  }
  const search = r => r.keys.map(entName).join(' ');
  // Who keeps turning up in the best teams. Steadier between runs than the exact teams, which can differ by one member.
  const best = [...(finalGen ? rows : simFullRows(SIM.gen - 1))].sort((a, b) => b.sure - a.sure).slice(0, 16);
  const mem = {};
  best.forEach(r => r.keys.forEach(k => { const m = mem[k] || (mem[k] = { k, n: 0, wr: 0 }); m.n++; m.wr += r.wr; }));
  for (const k of Object.keys(SIM.kept)) if (!mem[k]) mem[k] = { k, n: 0, wr: 0 };
  const topTier = SIM.meta ? Math.max(...best.flatMap(r => r.keys.map(k => RARITY.findIndex(([t]) => t === SIM.meta.byKey.get(k)?.rarity)))) : -1;
  const memRows = Object.values(mem).map(m => ({ ...m, e: SIM.meta?.byKey.get(m.k) || {}, kept: SIM.kept[m.k] || 0, avg: m.n ? m.wr / m.n : NaN }));
  const status = SIM.running ? `Generation ${SIM.gen + 1} of ${G} is running.` : SIM.stopped && !done ? `The run stopped in generation ${SIM.gen + 1} of ${G}.` : '';
  if (SIM.chain) return `<p class="hint">Generation ${SIM.gen + 1} of ${G}. Win % here is against the meta teams so far.</p>${simTable('fullteams', rows, cols, { sortBy: 3, search, limit: 20 })}`;
  return `<h2>Best whole teams</h2>
    <p class="hint">A search over ${G} generations. The first plays random teams. Each later one keeps the best fifth, tries them with one member swapped, mixes kept teams together and adds fresh teams. New members come from the whole pool you picked, leaning toward characters who are winning, so a lower tier or unevolved character only stays if it helps. The last generation replays the best ${SIM_FINAL_TEAMS} against each other with a quarter of all battles. Movesets and abilities are rolled fresh every battle, so this ranks the members, not one exact build. "Sure win %" takes off the 95% margin and is what the ranking goes by.</p>
    ${status ? `<p class="hint"><strong>${status}</strong> ${finalGen ? '' : 'The table shows the current generation, which still includes untested new teams.'}</p>` : ''}
    <h3>${done ? 'Final ranking' : `Generation ${SIM.gen + 1}`}</h3>
    ${simTable('fullteams', rows, cols, { sortBy: 3, search, limit: finalGen ? 300 : 50 })}
    ${done && SIM.best?.pick ? `<h3>Brought list vs picked 6, top 5 teams</h3><p class="hint">${SIM_PICK_NOTE}</p>${SIM.best.rows.slice(0, 5).map((r, i) => simPickTable(r, SIM.best.pick[r.k], `Team ${i + 1}`)).join('')}` : ''}
    <h3>Most common members of the top 16 teams</h3>
    <p class="hint">"In top 16" counts teams in ${finalGen ? 'the final ranking' : 'the last finished generation'}. "Kept" counts how many times across all generations the character was in a kept team: high means it keeps winning its place, not just one lucky team. Characters below the top tier present, or not in a final form, are marked, so you can see which ones earn a spot anyway.</p>
    ${simTable('members', memRows, [
      ['Character', r => entName(r.k), r => entLink(r.k)],
      ['Tier', r => rarityName(r.e.rarity || ''), r => `${esc(rarityName(r.e.rarity || ''))}${topTier >= 0 && RARITY.findIndex(([t]) => t === r.e.rarity) < topTier ? ' <span class="badge">lower tier</span>' : ''}`],
      ['Form', r => r.e.final ? 'Final' : 'Earlier', r => r.e.final ? 'Final' : '<span class="badge">earlier form</span>'],
      ['In top 16', r => r.n, null, 'sv'],
      ['Kept', r => r.kept, null, 'sv'],
      ['Avg team win %', r => r.avg, r => pctf(r.avg, 1), 'sv'],
    ], { sortBy: 3, search: r => entName(r.k), limit: 60 })}`;
}

function simTeams() {
  const S = SIM.stats;
  const ranking = simRanking();
  const rows = Object.entries(S.pairs).map(([k, v]) => { const [a, b] = k.split('+'); return { a, b, ...v, wr: v.w / v.g }; });
  if (!rows.length) return '<p class="soon">Teammate pairs and team rankings show up in Team singles and Duos runs.</p>';
  const min = Math.max(10, Math.round(rows.reduce((s, r) => s + r.g, 0) / rows.length * 2));
  const ent = S.ent, base = k => ent[k] ? ent[k].w / ent[k].g : 0.5;
  const list = rows.filter(r => r.g >= min).map(r => ({ ...r, lift: r.wr - (base(r.a) + base(r.b)) / 2 }));
  return `${ranking || `<p class="hint">To rank whole teams, tick "Rank whole teams" and run again.</p>`}<p class="hint">Pairs that were on the same team at least ${min} times. "Lift" is how much better the pair does than its two members do on average: high lift means real synergy, not just two strong characters. "Sure lift" takes off the 95% margin, so it only stays positive when the synergy is likely real. With 175 characters, pairs need big runs (50,000+ battles) or a narrower pool.</p>
    ${simTable('pairs', list, [
      ['Pair', r => `${entName(r.a)} + ${entName(r.b)}`, r => `${entLink(r.a)} + ${entLink(r.b)}`],
      ['Together', r => r.g, null, 'sv'],
      ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
      ['Lift', r => r.lift, r => `${r.lift >= 0 ? '+' : ''}${(r.lift * 100).toFixed(1)}`, 'sv'],
      ['Sure lift', r => r.lift - margin(r.wr, r.g), r => `${(r.lift - margin(r.wr, r.g)) >= 0 ? '+' : ''}${((r.lift - margin(r.wr, r.g)) * 100).toFixed(1)}`, 'sv'],
    ], { sortBy: 4, search: r => `${entName(r.a)} ${entName(r.b)}` })}
    ${list.length ? '' : `<p class="hint">No pair has met ${min} times yet. Run more battles, or pick fewer tiers so the same characters meet more often.</p>`}`;
}

function simMatchups() {
  const S = SIM.stats;
  const pairs = Object.entries(S.vs);
  if (!pairs.length) return '<p class="soon">Head-to-head matchups come from One on one runs.</p>';
  const keys = Object.keys(S.ent).sort((a, b) => entName(a).localeCompare(entName(b)));
  const k = SIM.vsKey && S.ent[SIM.vsKey] ? SIM.vsKey : keys[0];
  const rows = [];
  for (const [p, v] of pairs) {
    const [a, b] = p.split('>');
    if (a === k) rows.push({ o: b, g: v.g, w: v.w });
    else if (b === k) rows.push({ o: a, g: v.g, w: v.g - v.w });
  }
  rows.forEach(r => { r.wr = r.w / r.g; });
  return `<label>Character <select id="simvs">${keys.map(x => `<option value="${esc(x)}"${x === k ? ' selected' : ''}>${esc(entName(x))}</option>`).join('')}</select></label>
    <p class="hint">Every opponent ${esc(entName(k))} met one on one. Sort by Win % to find its counters (lowest) and the characters it walls (highest). With 175 characters, a pair needs a big run to meet often: 20,000+ battles gives a few meetings each.</p>
    ${simTable('vs', rows, [
      ['Opponent', r => entName(r.o), r => entLink(r.o)],
      ['Types', r => (SIM.meta.byKey.get(r.o)?.types || []).join('/'), r => (SIM.meta.byKey.get(r.o)?.types || []).map(badge).join(' ')],
      ['Tier', r => rarityName(SIM.meta.byKey.get(r.o)?.rarity)],
      ['Met', r => r.g, null, 'sv'],
      ['Win %', r => r.wr, r => pctf(r.wr), 'sv'],
    ], { sortBy: 4, search: r => entName(r.o) })}`;
}

const SIM_STAT = { vit: 'Vitality', pow: 'Power', grd: 'Guard', ene: 'Energy', wil: 'Will', spe: 'Speed' };
const simItemName = id => { const [k, t] = (id || '').split(':'); const d = SIM.meta?.items.find(i => i.id === k); return d ? (t ? `${t} ${d.name}` : d.name) : id; };
const simNatureName = id => SIM.meta?.natures.find(n => n.id === id)?.name || id;

// Builds tab: overrides for any character (the AI keeps choosing for everyone else), then how each held
// item and nature did in the last run.
function simBuilds() {
  const M = SIM.meta, S = SIM.stats, T = M.training;
  const ents = M.entrants.filter(e => SIM.opts.forms === 'all' || e.final).sort((a, b) => a.name.localeCompare(b.name));
  const ed = SIM.ovEdit || (SIM.ovEdit = { key: ents[0]?.key || '' });
  const cur = SIM.overrides[ed.key] || {};
  const opt = (v, l, c) => `<option value="${esc(v)}"${String(c) === String(v) ? ' selected' : ''}>${esc(l)}</option>`;
  const stats = Object.keys(SIM_STAT);
  const [ik, it] = (cur.item || '').split(':');
  const typed = M.items.find(i => i.id === ik)?.typed;
  const editor = `<form id="simov" class="simform" onsubmit="return false">
      <label>Character <select name="key">${ents.map(e => opt(e.key, e.name, ed.key)).join('')}</select></label>
      <label>Nature <select name="nature">${opt('', 'AI picks', cur.nature || '')}${M.natures.map(n => opt(n.id, n.name, cur.nature || '')).join('')}</select></label>
      <label>Held item <select name="item">${opt('', 'AI picks', ik || '')}${M.items.map(i => opt(i.id, `${i.name} (${i.like})`, ik || '')).join('')}</select></label>
      ${typed ? `<label>Type <select name="itemType">${M.types.map(t => opt(t, t, it || M.types[0])).join('')}</select></label>` : ''}
      <fieldset class="simtiers"><legend>EV points <span class="hint">(max ${T.evMax} a stat, ${T.evTotal} in all; leave all 0 for the AI)</span></legend>${stats.map(k => `<label>${SIM_STAT[k]} <input type="number" name="ev-${k}" min="0" max="${T.evMax}" value="${cur.evs?.[k] ?? 0}" style="width:4.5em"></label>`).join('')}</fieldset>
      <fieldset class="simtiers"><legend>IVs <span class="hint">(0 to ${T.ivMax})</span></legend>${stats.map(k => `<label>${SIM_STAT[k]} <input type="number" name="iv-${k}" min="0" max="${T.ivMax}" value="${cur.ivs?.[k] ?? T.ivMax}" style="width:4.5em"></label>`).join('')}</fieldset>
      <button type="button" id="simovsave" class="primary">Save override</button>${SIM.overrides[ed.key] ? ' <button type="button" id="simovdel">Remove override</button>' : ''}
    </form>`;
  const list = Object.entries(SIM.overrides);
  const listHtml = list.length ? `<ul>${list.map(([k, o]) => `<li><b>${entLink(k)}</b>: ${[o.nature && simNatureName(o.nature), o.item && simItemName(o.item), o.evs && 'EVs ' + stats.filter(x => o.evs[x]).map(x => `${o.evs[x]} ${SIM_STAT[x]}`).join(', '), o.ivs && stats.some(x => o.ivs[x] < T.ivMax) && 'IVs ' + stats.filter(x => o.ivs[x] < T.ivMax).map(x => `${o.ivs[x]} ${SIM_STAT[x]}`).join(', ')].filter(Boolean).map(esc).join(' · ')}</li>`).join('')}</ul>` : '<p class="hint">No overrides yet.</p>';
  let results = '';
  if (S?.battles) {
    const ent = S.ent, base = k => ent[k] ? ent[k].w / ent[k].g : 0.5, min = Math.max(5, minGames() / 4);
    const items = Object.entries(S.item || {}).map(([k, v]) => { const [key, id] = k.split('|'); return { key, id, ...v, wr: v.w / v.g, d: v.w / v.g - base(key) }; }).filter(r => r.g >= min);
    const nats = Object.entries(S.nature || {}).map(([k, v]) => { const [key, id, preset] = k.split('|'); return { key, id, preset, ...v, wr: v.w / v.g, d: v.w / v.g - base(key) }; }).filter(r => r.g >= min);
    const pdelta = r => `${r.d >= 0 ? '+' : ''}${(r.d * 100).toFixed(1)}`;
    results = items.length || nats.length ? `<h3>Held items</h3>
      ${simTable('items', items, [
        ['Character', r => entName(r.key), r => entLink(r.key)],
        ['Item', r => simItemName(r.id)],
        ['Battles', r => r.g, null, 'sv'],
        ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
        ['Vs. average', r => r.d, pdelta, 'sv'],
        ['Used up', r => r.used / r.g, r => M.items.find(i => i.id === r.id.split(':')[0])?.text.includes('Used up') ? pctf(r.used / r.g) : '—', 'sv'],
      ], { sortBy: 2, search: r => `${entName(r.key)} ${simItemName(r.id)}` })}
      <h3>Natures and EV presets</h3>
      ${simTable('natures', nats, [
        ['Character', r => entName(r.key), r => entLink(r.key)],
        ['Nature', r => simNatureName(r.id)],
        ['EV preset', r => M.presets[r.preset] || 'Override'],
        ['Battles', r => r.g, null, 'sv'],
        ['Win %', r => r.wr, r => winCell(r.w, r.g), 'sv'],
        ['Vs. average', r => r.d, pdelta, 'sv'],
      ], { sortBy: 3, search: r => `${entName(r.key)} ${simNatureName(r.id)}` })}` : '<p class="hint">The last run used base stats only. Set Training or Held items to "AI picks" and run again to see how builds do.</p>';
  }
  return `<p class="hint">With Training set to "AI picks", the AI gives every character an EV preset, a nature and IVs that fit its moves and its team (slow attackers go Trick Room style next to a Trick Room setter, with 0 Speed IVs). With Held items on, it hands out items by role, one of each per team. An override below replaces the AI's pick for that character in every battle of the next run; anything left on "AI picks" stays the AI's choice.</p>
    ${editor}<h3>Overrides</h3>${listHtml}${results}`;
}

function simSaveOverride() {
  const f = $('#simov'); if (!f) return;
  const val = n => f.querySelector(`[name="${n}"]`)?.value;
  const key = val('key'), T = SIM.meta.training, o = {};
  if (val('nature')) o.nature = val('nature');
  const it = val('item');
  if (it) { const d = SIM.meta.items.find(i => i.id === it); o.item = d?.typed ? `${it}:${val('itemType') || SIM.meta.types[0]}` : it; }
  const stats = Object.keys(SIM_STAT);
  let left = T.evTotal;
  const evs = Object.fromEntries(stats.map(k => { const n = Math.max(0, Math.min(T.evMax, left, Math.floor(+val('ev-' + k) || 0))); left -= n; return [k, n]; }));
  if (stats.some(k => evs[k])) o.evs = evs;
  const ivs = Object.fromEntries(stats.map(k => [k, Math.max(0, Math.min(T.ivMax, Math.floor(+(val('iv-' + k) ?? T.ivMax))))]));
  if (stats.some(k => ivs[k] < T.ivMax)) o.ivs = ivs;
  if (Object.keys(o).length) SIM.overrides[key] = o; else delete SIM.overrides[key];
  simDraw();
}

// Draft tab: who gets brought, who gets picked from the 10, who opens, how picked characters do, and how
// often the draft AI guessed the other side's 6.
function simDraft() {
  const S = SIM.stats, D = S.draft;
  if (!D?.g) return '<p class="hint">The draft only runs in Competitive doubles with Team preview on. Pick that format and run again.</p>';
  const rows = Object.entries(S.bring).map(([key, v]) => ({ key, e: SIM.meta.byKey.get(key) || {}, ...v, pr: v.p / v.b, lr: v.p ? v.lead / v.p : 0, wr: v.p ? v.pw / v.p : NaN })).filter(r => r.b >= Math.max(3, minGames() / 4));
  return `<div class="stats"><div class="stat"><b>${pctf(D.overlap / D.g)}</b><span>of the opponent's 6 predicted right, on average</span></div>
      <div class="stat"><b>${pctf(D.exact / D.g)}</b><span>of drafts guessed the whole 6</span></div></div>
    <p class="hint">Each side sees only the other's characters, guesses their builds, predicts their 6 (and how they'd answer its own likely picks), then picks the 6 that does best across those predictions without losing badly to any likely one. The first two picked open. "Picked" is how often a character makes the 6 when brought: a low number means it's usually the one left home; a high win rate with a low pick rate is a niche pick worth a look.</p>
    ${simTable('draft', rows, [
      ['Character', r => r.e.name || r.key, r => entLink(r.key)],
      ['Tier', r => rarityName(r.e.rarity)],
      ['Brought', r => r.b, null, 'sv'],
      ['Picked', r => r.pr, r => pctf(r.pr), 'sv'],
      ['Opens', r => r.lr, r => r.p ? pctf(r.lr) : '—', 'sv'],
      ['Win % when picked', r => isFinite(r.wr) ? r.wr : -1, r => r.p ? winCell(r.pw, r.p) : '—', 'sv'],
    ], { sortBy: 3, search: r => r.e.name || r.key })}`;
}

// Meta tab: the shape of a Competitive doubles meta from the draft runs (sim/meta.js): cores, general and
// specific supports, niche answers, legendaries, openers, common builds, and best and niche teams when a
// team search ran. The module loads the first time the tab opens.
function simMetaSummary() {
  if (!SIM.metaMod) { import('./meta.js').then(m => { SIM.metaMod = m; simDraw(); }); return null; }
  const S = SIM.stats, lo = SIM.lastOpts || {};
  let teams = [];
  if (SIM.chain?.teams.length) teams = SIM.chain.teams;
  else if (SIM.plan && SIM.full.length) teams = simFullRows(SIM.full.length - 1).filter(r => r.g >= 5).sort((a, b) => b.sure - a.sure).map(r => ({ ...r, pick: SIM.best?.pick?.[r.k] }));
  const title = `${S.battles.toLocaleString()} battles, ${lo.draft === 'off' ? 'no draft' : `bring ${lo.draft}, pick 6`}, ${lo.tiers?.length ? lo.tiers.map(rarityName).join(', ') : 'all tiers'}.`;
  return SIM.metaMod.metaSummary(S, { byKey: SIM.meta.byKey, teams, minGames: Math.max(8, Math.round(minGames() / 2)), title,
    fmt: { item: simItemName, nature: simNatureName, preset: id => SIM.meta.presets?.[id] || id } });
}
function simMetaTab() {
  if (!SIM.stats.draft?.g) return '<p class="hint">The meta summary comes from the draft, so it only fills in for Competitive doubles with Team preview on. Pick that format and run again.</p>';
  const m = simMetaSummary();
  if (!m) return '<p class="hint">Loading…</p>';
  SIM.metaMd = m.markdown;
  const pair = keys => keys.map(entLink).join(' + ');
  const team = t => t.keys.map(entLink).join(', ');
  const sec = (h, note, rows, cols, id, empty, sortBy = 0) => `<h2>${h}</h2><p class="hint">${note}</p>${rows.length ? simTable(id, rows, cols, { sortBy }) : `<p class="hint">${empty || 'None yet. More battles will fill this in.'}</p>`}`;
  const wr = (w, g) => r => winCell(r[w] * r[g], r[g]);
  return `<div class="article">${m.lead.map(l => `<p>${esc(l)}</p>`).join('')}
      <p class="hint">${SIM.running ? 'Still running: these fill in and settle as more battles come in. ' : ''}Small samples move a lot, so treat a row with few games as a lead to check, not a verdict. <button type="button" class="linkb" id="simmetamd">Download summary (.md)</button></p></div>
    ${sec('Best teams', 'The strongest brought lists from the team search.', m.best, [
      ['Team (picked half the time or more)', r => r.plays.map(entName).join(', '), r => r.plays.map(entLink).join(', '), 'wrap'], ['Rarely picked', r => r.bench.map(entName).join(', '), r => r.bench.map(entLink).join(', ') || '—', 'wrap'],
      ['Battles', r => r.g, null, 'sv'], ['Win %', r => r.wr, wr('wr', 'g'), 'sv'],
      ['Cores in it', r => r.cores.map(c => c.label).join(', '), r => r.cores.map(c => `${pair(c.keys)} <span class="hint">(${esc(c.label)})</span>`).join('<br>') || '—']], 'metabest', m.hasTeams ? '' : 'Run with Team search set to Strongest teams to rank whole brought lists.', 3)}
    ${sec('Cores', (m.hasPicks ? 'Cores a top team\'s draft actually picks together (both in at least half its games) are listed first. ' : '') + 'Pairs the draft picked together because one makes the other better (Tailwind or Trick Room with attackers, redirection or screens with setup, Helping Hand, fields) or because they cover each other\'s weaknesses. "Vs. members alone" is the pair\'s win rate minus the average of each one\'s usual win rate.', m.cores, [
      ['Core', r => r.keys.map(entName).join(' + '), r => pair(r.keys)], ['Kind', r => r.label], ['Games', r => r.g, null, 'sv'], ['Win %', r => r.wr, wr('wr', 'g'), 'sv'],
      ['Vs. members alone', r => r.lift, r => `${r.lift >= 0 ? '+' : ''}${Math.round(r.lift * 100)}`, 'sv'],
      ...(m.hasPicks ? [['Top team plays it', r => r.inTeam ? r.inTeam.rate : -1, r => r.inTeam ? `Team ${r.inTeam.team + 1}, ${pctf(r.inTeam.rate)}` : '—', 'sv']] : [])], 'metacores', '', m.hasPicks ? 5 : 3)}
    ${sec('General supports', 'Characters that enable cores with many different partners and still win at least half the time: safe picks for almost any 10.', m.general, [
      ['Support', r => entName(r.key), r => entLink(r.key)], ['Core partners', r => r.partners, null, 'sv'], ['Picked', r => r.picks, null, 'sv'], ['Win % when picked', r => r.wr, r => pctf(r.wr), 'sv']], 'metagen', '', 1)}
    ${sec('Specific supports', 'Characters that win far more with one partner than they usually do: build the pair, not the support alone.', m.specific, [
      ['Support', r => entName(r.key), r => entLink(r.key)], ['Best with', r => entName(r.top.key), r => entLink(r.top.key)], ['Games together', r => r.top.g, null, 'sv'],
      ['Win % together', r => r.top.wr, r => winCell(r.top.wr * r.top.g, r.top.g), 'sv'], ['Win % usually', r => r.wr, r => pctf(r.wr), 'sv']], 'metaspec', '', 3)}
    ${sec('Niche teams', 'Strong brought lists built mostly from characters the other top lists don\'t use.', m.niche, [
      ['Team (brought)', r => r.keys.map(entName).join(', '), team, 'wrap'], ['Win %', r => r.wr, wr('wr', 'g'), 'sv'], ['Rare picks', r => r.rare.map(entName).join(', '), r => r.rare.map(entLink).join(', ')]], 'metaniche', m.hasTeams ? 'No niche list stood out in this search.' : 'Run with Team search set to Strongest teams to find niche lists.', 1)}
    ${sec('Answers', 'Characters picked less than most that beat one of the most popular characters far more often than they usually win: direct answers to bring when the meta settles.', m.answers, [
      ['Answer', r => entName(r.key), r => entLink(r.key)], ['Against', r => entName(r.vs), r => entLink(r.vs)], ['Games', r => r.g, null, 'sv'], ['Win %', r => r.wr, wr('wr', 'g'), 'sv'],
      ['Over its usual', r => r.gap, r => `+${Math.round(r.gap * 100)}`, 'sv']], 'metaans', '', 4)}
    ${sec('Legendaries and mythicals', 'Only one can make the 6, so "Picked when brought" shows which one the draft trusts most.', m.legends, [
      ['Character', r => entName(r.key), r => entLink(r.key)], ['Brought', r => r.b, null, 'sv'], ['Picked when brought', r => r.rate, r => pctf(r.rate), 'sv'],
      ['Win % when picked', r => isFinite(r.wr) ? r.wr : -1, r => pctf(r.wr), 'sv'], ['Core', r => r.core?.label || '', r => r.core ? `with ${entLink(r.core.with)} <span class="hint">(${esc(r.core.label)})</span>` : '—']], 'metaleg', '', 2)}
    ${sec('Openers', 'The first two picked start on the field.', m.openers, [
      ['Opening pair', r => r.keys.map(entName).join(' + '), r => pair(r.keys)], ['Games', r => r.g, null, 'sv'], ['Win %', r => r.wr, wr('wr', 'g'), 'sv']], 'metaopen', '', 2)}
    ${sec('Common builds', 'The item and nature the AI gave the 20 most picked characters most often.', m.builds.filter(b => b.item || b.nature), [
      ['Character', r => entName(r.key), r => entLink(r.key)], ['Item', r => r.item ? simItemName(r.item.id) : '—'], ['Nature', r => r.nature ? simNatureName(r.nature.id.nature) : '—'],
      ['EV preset', r => r.nature ? SIM.meta.presets?.[r.nature.id.preset] || r.nature.id.preset : '—']], 'metabuilds')}`;
}
function simMetaDownload() {
  if (!SIM.metaMd) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([SIM.metaMd], { type: 'text/markdown' }));
  a.download = 'familiar-meta-summary.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Watch a battle: both brought teams with what each side picked, and each side's reasoning.
function simDraftView(w) {
  const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return `<h3>Draft</h3><div class="simcols">${w.drafts.map((d, s) => {
    const pick = new Map(d.order.map((i, k) => [i, k]));
    return `<section><h3>Side ${s ? 'B' : 'A'} brought</h3>
      <p>${d.bring.map((b, i) => `${pick.has(i) ? `<b>${entLink(b.key)}</b>${pick.get(i) < 2 ? ' <span class="badge sigb">Opens</span>' : ' <span class="badge">Picked</span>'}` : `<span class="hint">${esc(b.name)}</span>`}${['legendary', 'mythical'].includes(b.rarity) ? ` <small class="hint">${esc(rarityName(b.rarity))}</small>` : ''}`).join(' · ')}</p>
      <h4>Side ${s ? 'B' : 'A'}'s reasoning</h4>${d.log.map(l => `<p>${md(l)}</p>`).join('')}</section>`;
  }).join('')}</div>`;
}

function simWatch() {
  const w = SIM.watch;
  const keys = SIM.meta.entrants.filter(e => SIM.opts.forms === 'all' || e.final).sort((a, b) => a.name.localeCompare(b.name));
  const sel = (id, v) => `<select id="${id}"><option value="">Random</option>${keys.map(e => `<option value="${esc(e.key)}"${e.key === v ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`;
  const spread = m => m.evs ? ` · EVs ${['vit', 'pow', 'grd', 'ene', 'wil', 'spe'].filter(k => m.evs[k]).map(k => `${m.evs[k]} ${SIM_STAT[k]}`).join(', ')}` : '';
  const ivNote = m => m.ivs ? ['vit', 'pow', 'grd', 'ene', 'wil', 'spe'].filter(k => m.ivs[k] < 31).map(k => ` · ${m.ivs[k]} ${SIM_STAT[k]} IV`).join('') : '';
  const team = (t, i) => `<section><h3>Side ${i ? 'B' : 'A'}${w.winner === i ? ' <span class="badge sigb">Won</span>' : ''}</h3>${t.map(m => `<p><b>${entLink(m.key)}</b> <span class="hint">${esc(m.ability)}${m.item ? ` @ ${esc(m.item)}` : ''}</span><br><small>${m.moves.map(esc).join(' · ')}</small>${m.nature || m.evs ? `<br><small class="hint">${esc(m.nature || 'Neutral')}${spread(m)}${ivNote(m)}</small>` : ''}</p>`).join('')}</section>`;
  return `<p class="hint">Plays one battle with the settings above and shows every step, to check that the rules and the AI behave. Pick a lead for each side or leave it random.</p>
    <div class="row"><label>Side A ${sel('simwa', SIM.watchA)}</label><label>Side B ${sel('simwb', SIM.watchB)}</label>
    <button type="button" id="simwatch"${SIM.ready ? '' : ' disabled'}>${SIM.watching ? 'Playing…' : 'Play one battle'}</button></div>
    ${w?.drafts ? simDraftView(w) : ''}
    ${w ? `<div class="simcols">${w.teams.map(team).join('')}</div>
      <p><b>${w.winner < 0 ? 'Draw' : `Side ${w.winner ? 'B' : 'A'} wins`}</b> after ${w.turns} turns.</p>
      <pre class="simlog">${esc(w.log.join('\n'))}</pre>` : ''}`;
}

function simRulesTab() {
  const un = SIM.meta?.unsupported || [];
  const st = (n, t) => `<div><dt>${n}</dt><dd>${t}</dd></div>`;
  return `<div class="article simrules">
    <h3>Damage formula</h3>
    <p>Pokémon's formula with Familiar's stats. Physical moves use the attacker's Power against the target's Guard; Energy moves use Energy against Will.</p>
    <pre class="simformula">Damage = (floor(floor((2 × Level ÷ 5 + 2) × Power of move × Attack ÷ Defence) ÷ 50) + 2)
        × spread (0.75 when a duos move hits more than one target)
        × critical (1.5, or the ability's value)
        × random (0.85 to 1.00)
        × same type (1.5 if the move matches one of the user's types)
        × type matchup (2 super effective, 0.5 resisted, 0 immune; both types multiply)
        × Burn (0.5 on Physical) or Curse (0.5 on Energy)
        × screens (0.5 in singles, 2/3 in duos)
        × field (1.3 for the boosted type)
        × abilities (attacker's boosts, then defender's cuts)</pre>
    <p>Battle stats at level L: Vitality = floor((2 × base + 31) × L ÷ 100 × Vitality multiplier) + L + 10; other stats = floor((2 × base + 31) × L ÷ 100) + 5. With Training off, every copy counts as perfectly bred (31 IVs) with no EV points or nature, so only base stats tell characters apart. Stat stages go from −6 to +6 (×2/8 to ×8/2). Critical hits: 1 in 24, 1 in 8 with a high-crit move or ability, 1 in 2 at two stages, always at three; a crit ignores the target's raised defence and screens.</p>
    <h3>Training and held items</h3>
    <p>With Training on: each EV point adds L ÷ 50 to its stat after the formula above (+1 at level 50), at most ${SIM.meta?.training.evMax ?? 32} points in one stat and ${SIM.meta?.training.evTotal ?? 66} in all. A nature raises one stat other than Vitality by 10% and lowers another by 10% (or is neutral). IVs go from 0 to 31 and replace the 31 in the formula. The AI picks an EV preset (${esc(Object.values(SIM.meta?.presets || {}).join(', '))}), a nature and IVs from each character's moves and its team, and the Builds tab lets you override any character.</p>
    <p>With Held items on, every character holds one item and a team never holds two of the same item (each type of Ward Charm or Type Emblem counts as its own item). Names are placeholders, with the Pokémon item in brackets.</p>
    <dl>${(SIM.meta?.items || []).map(i => st(`${i.name} (${i.like})`, esc(i.text))).join('')}</dl>
    <h3>Competitive doubles</h3>
    <p>The planned competitive format, for now without the bring-10 draft: 6 a side in doubles with all 6 used, the first two of each team opening. Everyone fights at level 50 but keeps moves learned up to level 100, with AI-trained EVs, natures and IVs and one held item each (one of each per team). A battle still going after 50 turns is a draw, and a draw counts as a non-win for both sides, so stalling out the clock never pays. Other formats draw at 100 turns and count a draw as half a win.</p>
    <p>With Team preview on, each side brings 8 (or 10) with up to 3 legendaries or mythicals (5 when bringing 10, so there are always enough others to fill the 6) and sees only the other side's characters. Each side's AI guesses the other's builds (the same standard build for a character every time), scores every one of its characters against every one of theirs in a quick damage race, finds pairs that work together (Tailwind or Trick Room with the attackers they help, redirection with setup, a field with the types it boosts, partners that cover each other's weaknesses), and predicts the other side's 6 twice: once on its own, once as an answer to its own likely picks. It then picks the 6 (at most 1 legendary or mythical) that does best across those predictions, with a penalty for losing badly to any likely one, and orders it so the two openers fit the openers it expects. Watch a battle shows each side's reasoning, and the Draft tab shows pick rates and how often the prediction was right.</p>
    <p>The Meta tab reads the draft runs. A core is a pair the draft picked together because one enables the other (Tailwind or Trick Room with attackers, redirection or screens with setup, Helping Hand, a field) or because they cover each other's weaknesses. A general support enables cores with 3 or more partners and wins at least half the time; a specific support wins at least 60% with one partner and 12 points more than usual. An answer is a character picked less than the median that beats one of the 8 most picked characters at least 55% of the time and 12 points more than usual.</p>
    <h3>Turn order</h3>
    <p>Switches go first, then moves by priority (Goes first +1, Extreme Speed +2, Protect +4, Goes last −5 or lower), then by Speed. Prankster-style abilities add +1 to Status moves; Quick Draw-style ones let the first move after entering go before others in its bracket. Trick Room reverses Speed order. A knocked-out character is replaced for free at the end of the turn; a switch by choice costs the turn.</p>
    <h3>Status effects</h3>
    <dl>${st('Burn (Fire)', 'Physical damage dealt ×0.5, loses 1/16 of max Vitality each turn.')}
      ${st('Freeze (Ice)', "Can't act. 25% chance to thaw each turn, always thaws after 3 turns or when hit by a Fire move.")}
      ${st('Stun (Lightning)', '25% chance to lose the turn, Speed ×0.5.')}
      ${st('Bleed (Blood)', 'Loses 1/16, then 2/16, 3/16... of max Vitality each turn. The count resets on switching out.')}
      ${st('Curse (Spirit, Dark)', 'Energy damage dealt ×0.5, Will ×0.75. No chip damage.')}
      ${st('Sleep', "Can't act for 1 to 3 turns.")}
      ${st('Confuse (Time, Wind)', 'Lasts 2 to 5 turns. Each turn, 1 in 3 chance to hit itself with a 40-power typeless Physical hit. Stacks with the others.')}</dl>
    <p>A character holds one of Burn, Freeze, Stun, Bleed, Curse or Sleep at a time. Characters of a status's own type are immune to it (Fire can't be Burned, Ice can't be Frozen, Lightning can't be Stunned, Blood can't Bleed).</p>
    <h3>Field effects</h3>
    <p>One field at a time; a new field replaces the old one. Fields last 5 turns.</p>
    <dl>${st('Type fields', 'Field moves and abilities like Electric Terrain, Deep Forest, Unlimited Blade Works, Zanka no Tachi and Rain Woman: moves of the named type do 1.3x, plus each field\'s extra (no sleep, healing, entry chip, no priority).')}
      ${st('Snow', 'Ice types get 1.5x Guard; everyone else loses 1/16 each turn.')}
      ${st('Trick Room', 'Slower characters move first.')}
      ${st('Quagmire', "Every foe of the user's side moves at half Speed.")}
      ${st('Gravity', 'Every move is more accurate (×5/3), and abilities that need Gravity switch on.')}
      ${st('Side effects', 'Reflect, Light Screen and Aurora Veil (5 turns), Tailwind (4 turns, doubles Speed), hazards on switching in: rocks (1/8 × Earth matchup), Catch the Rainbow (1/8 × Water matchup), spikes (1/8, 1/6, 1/4 by layers) and sticky web (−1 Speed).')}</dl>
    <h3>Abilities and move effects</h3>
    <p>Every ability text and move effect in the data is read by the simulator: ${SIM.meta ? `${SIM.meta.moves.length - new Set(un.filter(u => u.kind === 'move').map(u => u.id)).size} of ${SIM.meta.moves.length} moves` : 'moves'} and every ability have rules. The ones below are not simulated yet, so the move or ability works without that part.</p>
    <ul>${un.map(u => `<li><b>${esc(u.name)}</b> <span class="hint">${u.kind}</span>: ${esc(u.text)}</li>`).join('') || '<li>None</li>'}</ul>
    <p>Notes: Illusion-style abilities, Frisk-style "knows the foe's moves", held items (4D Pocket) and the hidden rain (Loch Dweller) have no effect, because the AI already knows everything and nothing in the game sets rain yet. Move shapes the data doesn't store (contact, punching, kicking, slicing, sound, shot) are read from the move's name and each character's name for it; every Physical move counts as contact except throws and quakes.</p>
    <h3>AI</h3>
    <p>Both sides use the same AI with full knowledge of the other side. Each turn it scores every move by expected damage, knockout chance and side effects, scores setup, healing and status moves by the situation, and switches out of bad matchups now and then. In duos it also aims at the foe that threatens its side most, finishes off a foe its partner can knock out this turn, Protects when both foes can hit it hard, and judges Tailwind and Trick Room by the speed of its whole side. A little randomness keeps battles varied. Movesets are four moves from the form's learnset (weighted towards strong own-type attacks and some coverage, or fully random), plus the signature. Each battle rolls one of the character's abilities.</p>
  </div>`;
}

// ---- page ----
function simSettings() {
  const o = SIM.opts;
  const opt = (v, l, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`;
  const ents = SIM.meta ? SIM.meta.entrants.filter(e => o.forms === 'all' || e.final).sort((a, b) => a.name.localeCompare(b.name)) : [];
  return `<form id="simform" class="simform" onsubmit="return false">
    <label>Format <select name="format">${FORMATS.map(([v, l]) => opt(v, l, o.format)).join('')}</select></label>
    ${o.format !== 'duel' && o.format !== 'comp' ? `<label>Team size <select name="teamSize">${(o.format === 'duos' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]).map(n => opt(n, n, o.teamSize)).join('')}</select></label>` : ''}
    <label>Battles <select name="count">${[1000, 5000, 10000, 25000, 50000, 100000, 200000].map(n => opt(n, n.toLocaleString(), o.count)).join('')}</select></label>
    <label>Characters <select name="forms">${opt('final', 'Final forms', o.forms)}${opt('all', 'Every form', o.forms)}</select></label>
    <label>Movesets <select name="movesets">${opt('smart', 'Sensible picks', o.movesets)}${opt('random', 'Fully random', o.movesets)}</select></label>
    ${o.format === 'comp' ? '' : `<label>Level <select name="level">${[30, 50, 70, 100].map(n => opt(n, n, o.level)).join('')}</select></label>`}
    ${o.format === 'comp' ? `<label>Team preview <select name="draft">${opt('8', 'Bring 8, pick 6', o.draft)}${opt('10', 'Bring 10, pick 6', o.draft)}${opt('off', 'Off (random 6)', o.draft)}</select></label>` : ''}
    <label>Vitality <select name="hpScale">${[1, 1.5, 2, 3].map(n => opt(n, '×' + n, o.hpScale)).join('')}</select></label>
    ${o.format === 'comp' ? '' : `<label>Training <select name="training">${opt('base', 'None (base stats only)', o.training)}${opt('ai', 'AI picks EVs, nature, IVs', o.training)}</select></label>
    <label>Held items <select name="items">${opt('none', 'None', o.items)}${opt('ai', 'AI picks (one of each per team)', o.items)}</select></label>`}
    <label>Always include <select name="focus"><option value="">Nobody</option>${ents.map(e => opt(e.key, esc(e.name), o.focus)).join('')}</select></label>
    <label class="check"><input type="checkbox" name="sameTier"${o.sameTier ? ' checked' : ''}> Same tier only</label>
    ${o.format !== 'duel' ? `<label>Team search <select name="teamSearch">${opt('', 'Off', o.teamSearch)}${opt('best', 'Strongest teams', o.teamSearch)}${opt('meta', 'Meta chain (counters)', o.teamSearch)}</select></label>` : ''}
    ${o.format !== 'duel' && o.teamSearch === 'meta' ? `<label>Bans in counter rounds <select name="ban">${[[0, 'None'], [3, 'Top 3 picks'], [6, 'Top 6 picks'], [10, 'Top 10 picks']].map(([v, l]) => opt(v, l, o.ban)).join('')}</select></label>` : ''}
    <label class="check"><input type="checkbox" name="gags"${o.gags ? ' checked' : ''}> Gag characters</label>
    <fieldset class="simtiers"><legend>Tiers <span class="hint">(none ticked = all)</span></legend>${RARITY.map(([k, l]) => `<label class="check"><input type="checkbox" name="tier" value="${k}"${o.tiers.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
  </form>
  <p class="hint">${esc(FORMATS.find(f => f[0] === o.format)[2])}${o.format === 'duel' ? '' : o.teamSearch === 'best' ? ' Strongest teams searches over several generations of teams and ranks the best ones on the Teams tab. More battles means more generations: 50,000 or more gives the steadiest results.' : o.teamSearch === 'meta' ? ' Meta chain finds the strongest team, then the best counter to it, then the best counter to that, and so on, and shows who beats whom on the Teams tab. 100,000 battles gives 6 meta teams. With bans, the characters the meta teams pick most sit out each counter round, so niche counters get a chance; the earlier meta teams still use them.' : ''}</p>`;
}

function renderSim() {
  const el = $('#sim');
  if (!roster.length || !moves.length) { el.innerHTML = '<p class="hint">Loading the roster…</p>'; return; }
  simWorkers();
  const S = SIM.stats;
  const rate = SIM.ms > 0 ? Math.round(SIM.done / (SIM.ms / 1000)) : 0;
  const prog = SIM.running || S ? `<div class="simprog"><progress max="${SIM.target}" value="${SIM.done}"></progress>
      <span>${SIM.done.toLocaleString()} of ${SIM.target.toLocaleString()} battles${SIM.running && SIM.chain ? ` · ${SIM.chain.matrix ? 'final round robin' : `meta round ${SIM.chain.round + 1} of ${SIM.chain.rounds}`}` : ''}${SIM.running && SIM.plan ? ` · generation ${SIM.gen + 1} of ${SIM.plan.length}` : ''}${rate ? ` · ${rate.toLocaleString()} a second` : ''}${SIM.running ? '' : ' · done'}</span></div>` : '';
  const body = !S || !S.battles ? (SIM.tab === 'rules' ? simRulesTab() : SIM.tab === 'watch' && SIM.meta ? simWatch() : SIM.tab === 'builds' && SIM.meta ? simBuilds() : '<p class="soon">Pick settings and press Run. Results fill in while it runs.</p>')
    : ({ overview: simOverview, chars: simChars, abilities: simAbilities, moves: simMoves, types: simTypes, teams: simTeams, matchups: simMatchups, draft: simDraft, meta: simMetaTab, builds: simBuilds, watch: simWatch, rules: simRulesTab })[SIM.tab]();
  const searchable = ['chars', 'abilities', 'moves', 'types', 'teams', 'matchups', 'draft', 'meta', 'builds'].includes(SIM.tab) && S?.battles;
  const lo = SIM.lastOpts;
  el.innerHTML = `<div class="article simhead"><h1>Battle simulator</h1>
      <p class="lead">AI against AI, thousands of battles at a time, to find what is too strong, too weak or never used.</p>
      <p class="hint">Each character battles with four moves from its learnset plus its signature, and one of its abilities. Battles run in the background in ${SIM.workers.length} worker${SIM.workers.length > 1 ? 's' : ''}, so the page stays responsive. Results are for the team and change whenever stats, moves or abilities change.</p></div>
    ${simSettings()}
    <div class="row"><button type="button" id="simrun" class="primary"${SIM.ready && !SIM.running ? '' : ' disabled'}>${SIM.ready ? 'Run' : 'Starting…'}</button>
      ${SIM.running ? '<button type="button" id="simstop">Stop</button>' : ''}${prog}</div>
    ${SIM.error ? `<p class="danger">${esc(SIM.error)}</p>` : ''}
    ${lo && S?.battles ? `<p class="hint">Results for: ${esc(FORMATS.find(f => f[0] === lo.format)[1])}${lo.format !== 'duel' ? `, teams of ${lo.teamSize}` : ''}, ${lo.forms === 'all' ? 'every form' : 'final forms'}, ${lo.tiers.length ? lo.tiers.map(rarityName).join(', ') : 'all tiers'}${lo.sameTier ? ' (same tier only)' : ''}, ${lo.format === 'comp' ? (lo.draft === 'off' ? 'no draft, ' : `bring ${lo.draft} and pick 6, `) : ''}level ${lo.format === 'comp' ? 50 : lo.level}, Vitality ×${lo.hpScale}${lo.training === 'ai' || lo.format === 'comp' ? ', AI training' : ''}${lo.items === 'ai' || lo.format === 'comp' ? ', held items' : ''}${Object.keys(SIM.overrides).length ? `, ${Object.keys(SIM.overrides).length} build override${Object.keys(SIM.overrides).length > 1 ? 's' : ''}` : ''}${lo.focus ? `, always with ${esc(entName(lo.focus))}` : ''}${SIM.mode ? '. Team search run: later rounds replay the best teams a lot, so the other tabs lean toward them' : ''}.</p>` : ''}
    <nav class="tabs simtabs" aria-label="Simulator views">${SIM_TABS.map(([k, l]) => `<a href="#sim" data-simtab="${k}"${k === SIM.tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    ${searchable ? `<input id="simq" type="search" placeholder="Filter rows" value="${esc(SIM.q)}">` : ''}
    <div class="simbody">${body}</div>`;
}

// Redraw at most a few times a second while results stream in, and keep focus in the filter box.
function simDraw() {
  if (location.hash !== '#sim' || SIM.drawPending) return;
  SIM.drawPending = true;
  setTimeout(() => {
    SIM.drawPending = false;
    const f = document.activeElement?.id === 'simq', pos = f ? document.activeElement.selectionStart : 0;
    renderSim();
    if (f) { const q = $('#simq'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
  }, SIM.running ? 400 : 0);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-simtab]');
  if (t) { e.preventDefault(); SIM.tab = t.dataset.simtab; SIM.q = ''; return simDraw(); }
  const s = e.target.closest('[data-sort]');
  if (s) { const [id, k] = s.dataset.sort.split(':'); const cur = SIM.sort[id]; SIM.sort[id] = { k: +k, dir: cur && cur.k === +k ? -cur.dir : -1 }; return simDraw(); }
  const c = e.target.closest('[data-csv]');
  if (c) return simCsv(c.dataset.csv);
  if (e.target.id === 'simmetamd') return simMetaDownload();
  if (e.target.id === 'simovsave') return simSaveOverride();
  if (e.target.id === 'simovdel') { delete SIM.overrides[SIM.ovEdit?.key]; return simDraw(); }
  if (e.target.id === 'simrun') simRun();
  if (e.target.id === 'simstop') simStop();
  if (e.target.id === 'simwatch' && SIM.ready && !SIM.watching) {
    SIM.watching = true;
    const o = SIM.opts;
    SIM.workers[0].postMessage({ cmd: 'watch', rules: simRules(), opts: { format: o.format, teamSize: +o.teamSize, forms: o.forms, tiers: o.tiers, gags: o.gags, movesets: o.movesets, level: +o.level, ...simBuildOpts(o),
      teamA: SIM.watchA ? [SIM.watchA] : [], teamB: SIM.watchB ? [SIM.watchB] : [], seed: Math.floor(Math.random() * 1e9) } });
    simDraw();
  }
});
document.addEventListener('change', e => {
  const f = e.target.closest('#simform');
  if (f) {
    const n = e.target.name, o = SIM.opts;
    if (n === 'tier') o.tiers = [...f.querySelectorAll('[name=tier]:checked')].map(x => x.value);
    else if (e.target.type === 'checkbox') o[n] = e.target.checked;
    else o[n] = e.target.value;
    if (n === 'format') o.teamSize = o.format === 'comp' ? 6 : o.format === 'duos' ? 4 : 3;
    return simDraw();
  }
  const ov = e.target.closest('#simov');
  if (ov && e.target.name === 'key') { SIM.ovEdit = { key: e.target.value }; return simDraw(); }
  // a new item saves the form at once, so the Type picker for Ward Charm / Type Emblem shows up
  if (ov && e.target.name === 'item') return simSaveOverride();
  if (e.target.id === 'simvs') { SIM.vsKey = e.target.value; simDraw(); }
  if (e.target.id === 'simwa') SIM.watchA = e.target.value;
  if (e.target.id === 'simwb') SIM.watchB = e.target.value;
});
document.addEventListener('input', e => { if (e.target.id === 'simq') { SIM.q = e.target.value; simDraw(); } });
