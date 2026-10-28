// The Simulator page (#sim): settings, running batches in Web Workers, and the balance reports.
// A classic script that uses app.js helpers ($, esc, badge, roster, moves, charLink, rarityName, RARITY).

const SIM = {
  workers: [], ready: false, meta: null, stats: null, running: false, done: 0, target: 0, t0: 0, ms: 0, runId: 0,
  tab: 'overview', sort: {}, q: '', vsKey: '', watch: null, error: '', drawPending: false, lastOpts: null,
  opts: { format: 'duel', teamSize: 3, count: 5000, forms: 'final', tiers: [], sameTier: false, gags: true, movesets: 'smart', level: 100, hpScale: 1, focus: '' },
};
const SIM_TABS = [['overview', 'Overview'], ['chars', 'Characters'], ['abilities', 'Abilities'], ['moves', 'Moves'], ['types', 'Types'],
  ['teams', 'Teams'], ['matchups', 'Matchups'], ['watch', 'Watch a battle'], ['rules', 'Rules']];
const FORMATS = [['duel', 'One on one', 'Single character vs single character. The cleanest read on each character.'],
  ['team', 'Team singles', 'Teams battle one at a time with switching, like a trainer battle.'],
  ['duos', 'Duos', 'Two on the field per side, for special battles. Spread moves and partner abilities matter here.']];

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
    SIM.done = SIM.stats.battles; SIM.ms = performance.now() - SIM.t0;
    simDraw();
  }
  if (msg.type === 'done' && msg.id === SIM.runId) { SIM.left--; if (SIM.left <= 0) { SIM.running = false; SIM.ms = performance.now() - SIM.t0; simDraw(); } }
  if (msg.type === 'watch') { SIM.watch = msg.result; SIM.watching = false; simDraw(); }
  if (msg.type === 'error') { SIM.error = msg.message; SIM.running = false; simDraw(); }
}

const simEmpty = () => ({ battles: 0, draws: 0, turns: 0, ent: {}, abil: {}, move: {}, moveBy: {}, combo: {}, pairs: {}, vs: {}, faster: { g: 0, w: 0 } });
function simMerge(T, S) {
  T.battles += S.battles; T.draws += S.draws; T.turns += S.turns;
  for (const k of ['ent', 'abil', 'move', 'moveBy', 'combo', 'pairs', 'vs']) for (const [key, v] of Object.entries(S[k])) {
    const t = T[k][key] || (T[k][key] = {});
    for (const f in v) t[f] = (t[f] || 0) + v[f];
  }
  T.faster.g += S.faster.g; T.faster.w += S.faster.w;
  return T;
}

const simRules = () => ({ level: +SIM.opts.level, hpScale: +SIM.opts.hpScale });
function simRun() {
  if (!SIM.ready) return;
  const o = SIM.opts, n = SIM.workers.length;
  SIM.runId++; SIM.stats = simEmpty(); SIM.done = 0; SIM.target = +o.count; SIM.running = true; SIM.left = n; SIM.t0 = performance.now(); SIM.error = '';
  SIM.lastOpts = { ...o, tiers: [...o.tiers] };
  const seed = Math.floor(Math.random() * 1e9);
  SIM.workers.forEach((w, i) => {
    const count = Math.floor(SIM.target / n) + (i < SIM.target % n ? 1 : 0);
    w.postMessage({ cmd: 'run', id: SIM.runId, rules: simRules(), chunk: 250,
      opts: { format: o.format, teamSize: +o.teamSize, count, forms: o.forms, tiers: o.tiers, sameTier: o.sameTier, gags: o.gags, movesets: o.movesets, level: +o.level, focus: o.focus || null, seed: seed + i * 7919 } });
  });
  simDraw();
}
function simStop() {
  SIM.workers.forEach(w => w.terminate());
  SIM.workers = []; SIM.ready = false; SIM.running = false;
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
  const avgTurns = S.turns / S.battles;
  const flags = [];
  if (avgTurns < 3 && o.format === 'duel') flags.push(`One on one battles last ${num1(avgTurns)} turns on average, so most fights are decided by one or two hits. Setup, status and healing moves barely get a chance. Try Vitality ×1.5 or ×2 in the settings to see how longer fights change things.`);
  if (sigD / allD > 0.4) flags.push(`Signature moves deal ${pctf(sigD / allD)} of all damage and land ${pctf(sigK / allK)} of knockouts. They are always equipped, so a strong signature lifts a character a lot.`);
  const top = rows[0], bottom = rows.at(-1);
  if (top && top.wr > 0.85) flags.push(`${esc(top.e.name)} wins ${pctf(top.wr)} of its battles.`);
  if (o.format === 'duel' && S.faster.g) flags.push(`The faster character wins ${pctf(S.faster.w / S.faster.g)} of one on one battles.`);
  const tiers = RARITY.map(([k, l]) => tierRows[k] ? `<div><span>${l}</span><em style="--t:var(--accent);width:${tierRows[k].w / tierRows[k].g * 100}%"></em><span>${pctf(tierRows[k].w / tierRows[k].g)}</span></div>` : '').join('');
  return `<div class="stats">${stat(S.battles.toLocaleString(), 'battles')}${stat(num1(avgTurns), 'turns on average')}${stat(pctf(S.draws / S.battles, 1), 'draws')}
      ${stat(pctf(sigD / allD), 'of damage from signatures')}${stat(pctf(mono.w / mono.g), 'mono-type win rate')}${stat(pctf(dual.w / dual.g), 'dual-type win rate')}</div>
    ${flags.length ? `<h3>What stands out</h3><ul class="simflags">${flags.map(f => `<li>${f}</li>`).join('')}</ul>` : ''}
    <div class="simcols"><section><h3>Strongest</h3>${list(rows.slice(0, 10))}</section><section><h3>Weakest</h3>${list(rows.slice(-10).reverse())}</section></div>
    <h3>Win rate by tier</h3><p class="hint">${o.sameTier ? 'Battles were within one tier, so every tier sits near 50% and this shows nothing.' : 'Battles mix tiers, so later tiers should win more. Turn on "Same tier only" to compare characters with their own tier.'}</p>
    <div class="bars simbars">${tiers}</div>
    <p class="hint">Characters with fewer than ${minGames()} battles are left out of the lists. ± is the 95% margin: two win rates closer than that may just be luck.</p>`;
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

function simTeams() {
  const S = SIM.stats;
  const rows = Object.entries(S.pairs).map(([k, v]) => { const [a, b] = k.split('+'); return { a, b, ...v, wr: v.w / v.g }; });
  if (!rows.length) return '<p class="soon">Teammate pairs show up in Team singles and Duos runs.</p>';
  const min = Math.max(10, Math.round(rows.reduce((s, r) => s + r.g, 0) / rows.length * 2));
  const ent = S.ent, base = k => ent[k] ? ent[k].w / ent[k].g : 0.5;
  const list = rows.filter(r => r.g >= min).map(r => ({ ...r, lift: r.wr - (base(r.a) + base(r.b)) / 2 }));
  return `<p class="hint">Pairs that were on the same team at least ${min} times. "Lift" is how much better the pair does than its two members do on average: high lift means real synergy, not just two strong characters. "Sure lift" takes off the 95% margin, so it only stays positive when the synergy is likely real. With 175 characters, pairs need big runs (50,000+ battles) or a narrower pool.</p>
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

function simWatch() {
  const w = SIM.watch;
  const keys = SIM.meta.entrants.filter(e => SIM.opts.forms === 'all' || e.final).sort((a, b) => a.name.localeCompare(b.name));
  const sel = (id, v) => `<select id="${id}"><option value="">Random</option>${keys.map(e => `<option value="${esc(e.key)}"${e.key === v ? ' selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`;
  const team = (t, i) => `<section><h3>Side ${i ? 'B' : 'A'}${w.winner === i ? ' <span class="badge sigb">Won</span>' : ''}</h3>${t.map(m => `<p><b>${entLink(m.key)}</b> <span class="hint">${esc(m.ability)}</span><br><small>${m.moves.map(esc).join(' · ')}</small></p>`).join('')}</section>`;
  return `<p class="hint">Plays one battle with the settings above and shows every step, to check that the rules and the AI behave. Pick a lead for each side or leave it random.</p>
    <div class="row"><label>Side A ${sel('simwa', SIM.watchA)}</label><label>Side B ${sel('simwb', SIM.watchB)}</label>
    <button type="button" id="simwatch"${SIM.ready ? '' : ' disabled'}>${SIM.watching ? 'Playing…' : 'Play one battle'}</button></div>
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
    <p>Battle stats at level L: Vitality = floor((2 × base + 31) × L ÷ 100 × Vitality multiplier) + L + 10; other stats = floor((2 × base + 31) × L ÷ 100) + 5. Every copy counts as perfectly bred, with no training or natures, so only base stats tell characters apart. Stat stages go from −6 to +6 (×2/8 to ×8/2). Critical hits: 1 in 24, 1 in 8 with a high-crit move or ability, 1 in 2 at two stages, always at three; a crit ignores the target's raised defence and screens.</p>
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
    <p>Both sides use the same AI with full knowledge of the other side. Each turn it scores every move by expected damage, knockout chance and side effects, scores setup, healing and status moves by the situation, and switches out of bad matchups now and then. A little randomness keeps battles varied. Movesets are four moves from the form's learnset (weighted towards strong own-type attacks and some coverage, or fully random), plus the signature. Each battle rolls one of the character's abilities.</p>
  </div>`;
}

// ---- page ----
function simSettings() {
  const o = SIM.opts;
  const opt = (v, l, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${l}</option>`;
  const ents = SIM.meta ? SIM.meta.entrants.filter(e => o.forms === 'all' || e.final).sort((a, b) => a.name.localeCompare(b.name)) : [];
  return `<form id="simform" class="simform" onsubmit="return false">
    <label>Format <select name="format">${FORMATS.map(([v, l]) => opt(v, l, o.format)).join('')}</select></label>
    ${o.format !== 'duel' ? `<label>Team size <select name="teamSize">${(o.format === 'duos' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]).map(n => opt(n, n, o.teamSize)).join('')}</select></label>` : ''}
    <label>Battles <select name="count">${[1000, 5000, 10000, 25000, 50000, 100000].map(n => opt(n, n.toLocaleString(), o.count)).join('')}</select></label>
    <label>Characters <select name="forms">${opt('final', 'Final forms', o.forms)}${opt('all', 'Every form', o.forms)}</select></label>
    <label>Movesets <select name="movesets">${opt('smart', 'Sensible picks', o.movesets)}${opt('random', 'Fully random', o.movesets)}</select></label>
    <label>Level <select name="level">${[30, 50, 70, 100].map(n => opt(n, n, o.level)).join('')}</select></label>
    <label>Vitality <select name="hpScale">${[1, 1.5, 2].map(n => opt(n, '×' + n, o.hpScale)).join('')}</select></label>
    <label>Always include <select name="focus"><option value="">Nobody</option>${ents.map(e => opt(e.key, esc(e.name), o.focus)).join('')}</select></label>
    <label class="check"><input type="checkbox" name="sameTier"${o.sameTier ? ' checked' : ''}> Same tier only</label>
    <label class="check"><input type="checkbox" name="gags"${o.gags ? ' checked' : ''}> Gag characters</label>
    <fieldset class="simtiers"><legend>Tiers <span class="hint">(none ticked = all)</span></legend>${RARITY.map(([k, l]) => `<label class="check"><input type="checkbox" name="tier" value="${k}"${o.tiers.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
  </form>
  <p class="hint">${esc(FORMATS.find(f => f[0] === o.format)[2])}</p>`;
}

function renderSim() {
  const el = $('#sim');
  if (!roster.length || !moves.length) { el.innerHTML = '<p class="hint">Loading the roster…</p>'; return; }
  simWorkers();
  const S = SIM.stats;
  const rate = SIM.ms > 0 ? Math.round(SIM.done / (SIM.ms / 1000)) : 0;
  const prog = SIM.running || S ? `<div class="simprog"><progress max="${SIM.target}" value="${SIM.done}"></progress>
      <span>${SIM.done.toLocaleString()} of ${SIM.target.toLocaleString()} battles${rate ? ` · ${rate.toLocaleString()} a second` : ''}${SIM.running ? '' : ' · done'}</span></div>` : '';
  const body = !S || !S.battles ? (SIM.tab === 'rules' ? simRulesTab() : SIM.tab === 'watch' && SIM.meta ? simWatch() : '<p class="soon">Pick settings and press Run. Results fill in while it runs.</p>')
    : ({ overview: simOverview, chars: simChars, abilities: simAbilities, moves: simMoves, types: simTypes, teams: simTeams, matchups: simMatchups, watch: simWatch, rules: simRulesTab })[SIM.tab]();
  const searchable = ['chars', 'abilities', 'moves', 'types', 'teams', 'matchups'].includes(SIM.tab) && S?.battles;
  const lo = SIM.lastOpts;
  el.innerHTML = `<div class="article simhead"><h1>Battle simulator</h1>
      <p class="lead">AI against AI, thousands of battles at a time, to find what is too strong, too weak or never used.</p>
      <p class="hint">Each character battles with four moves from its learnset plus its signature, and one of its abilities. Battles run in the background in ${SIM.workers.length} worker${SIM.workers.length > 1 ? 's' : ''}, so the page stays responsive. Results are for the team and change whenever stats, moves or abilities change.</p></div>
    ${simSettings()}
    <div class="row"><button type="button" id="simrun" class="primary"${SIM.ready && !SIM.running ? '' : ' disabled'}>${SIM.ready ? 'Run' : 'Starting…'}</button>
      ${SIM.running ? '<button type="button" id="simstop">Stop</button>' : ''}${prog}</div>
    ${SIM.error ? `<p class="danger">${esc(SIM.error)}</p>` : ''}
    ${lo && S?.battles ? `<p class="hint">Results for: ${esc(FORMATS.find(f => f[0] === lo.format)[1])}${lo.format !== 'duel' ? `, teams of ${lo.teamSize}` : ''}, ${lo.forms === 'all' ? 'every form' : 'final forms'}, ${lo.tiers.length ? lo.tiers.map(rarityName).join(', ') : 'all tiers'}${lo.sameTier ? ' (same tier only)' : ''}, level ${lo.level}, Vitality ×${lo.hpScale}${lo.focus ? `, always with ${esc(entName(lo.focus))}` : ''}.</p>` : ''}
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
  if (e.target.id === 'simrun') simRun();
  if (e.target.id === 'simstop') simStop();
  if (e.target.id === 'simwatch' && SIM.ready && !SIM.watching) {
    SIM.watching = true;
    const o = SIM.opts;
    SIM.workers[0].postMessage({ cmd: 'watch', rules: simRules(), opts: { format: o.format, teamSize: +o.teamSize, forms: o.forms, tiers: o.tiers, gags: o.gags, movesets: o.movesets, level: +o.level,
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
    if (n === 'format') o.teamSize = o.format === 'duos' ? 4 : 3;
    return simDraw();
  }
  if (e.target.id === 'simvs') { SIM.vsKey = e.target.value; simDraw(); }
  if (e.target.id === 'simwa') SIM.watchA = e.target.value;
  if (e.target.id === 'simwb') SIM.watchB = e.target.value;
});
document.addEventListener('input', e => { if (e.target.id === 'simq') { SIM.q = e.target.value; simDraw(); } });
