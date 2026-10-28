// The Battle vs AI page (#play): pick your team and the AI's team, then fight the simulator's AI turn by turn.
// A module that uses app.js helpers ($, esc, badge, roster, moves, rarityName, charLink) and the simulator engine.
// The engine runs a battle start to finish, so a turn-by-turn battle is a replay: every choice you make is
// recorded, and each step re-runs the battle from the same seed with those choices until it reaches a choice
// you haven't made yet. Battles are short, so a replay takes a millisecond or two.

import { prepare, runBattle, rng } from './battle.js';
import { makeBuild } from './batch.js';
import { estDamage, usable } from './ai.js';
import { RULES } from './rules.js';
import { compileAbility } from './compile.js';

const STORE = 'familiar-play';
const PAUSE = { pause: true };
const NONE = { name: 'None', ab: compileAbility({ name: 'None', text: '' }) };
const SIDE = ['Your team', 'AI team'];
const STATUS = { burn: 'Burned', freeze: 'Frozen', stun: 'Stunned', bleed: 'Bleeding', curse: 'Cursed', sleep: 'Asleep' };
const BOOST = { pow: 'Power', grd: 'Guard', ene: 'Energy', wil: 'Will', spe: 'Speed' };

const P = {
  data: null, src: null, battle: null, target: null,
  opts: { format: 'singles', size: 3, forms: 'final', level: 100, hpScale: 2, teams: [[], []] },
};
try { Object.assign(P.opts, JSON.parse(localStorage.getItem(STORE)) || {}); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(P.opts)); } catch {} };

// ---- data ----
function ensureData() {
  if (P.data && P.src === roster) return;
  P.data = prepare(roster, moves);
  P.src = roster;
  P.byKey = new Map(P.data.entrants.map(e => [e.key, e]));
}
const playable = () => P.data.entrants.filter(e => e.stats && e.sig && (P.opts.forms === 'all' || e.final));
const pool = e => e.learn.filter(l => l.lv <= +P.opts.level && l.id !== e.sig?.id);
const mv = id => P.data.moves.get(id);

// A slot is { key, ability, moves: [4 move ids] } or empty (filled at random when the battle starts).
const rand = Object.assign(() => Math.random(), { pick: a => a[Math.floor(Math.random() * a.length)] });
function fillSlot(key) {
  const e = P.byKey.get(key);
  if (!e) return null;
  const b = makeBuild(P.data, e, rand, { level: +P.opts.level });
  return { key, ability: b.ability.name, moves: b.moves.filter(l => l !== e.sig).map(l => l.id) };
}
function fixSlot(s) {
  const e = s && P.byKey.get(s.key);
  if (!e) return null;
  const ids = new Set(pool(e).map(l => l.id));
  if (s.moves.some(id => !ids.has(id)) || !e.abilities.some(a => a.name === s.ability) && e.abilities.length) return fillSlot(s.key);
  return s;
}
function randomTeam(side) {
  const used = new Set(), list = playable();
  P.opts.teams[side] = [];
  for (let i = 0; i < P.opts.size && used.size < list.length; i++) {
    let e; do e = list[Math.floor(Math.random() * list.length)]; while (used.has(e.cid));
    used.add(e.cid);
    P.opts.teams[side][i] = fillSlot(e.key);
  }
}
function toBuild(s) {
  const e = P.byKey.get(s.key);
  const learn = new Map(e.learn.map(l => [l.id, l]));
  const ab = e.abilities.find(a => a.name === s.ability) || e.abilities[0];
  return { e, moves: [...s.moves.map(id => learn.get(id)).filter(Boolean), e.sig], ability: ab || NONE };
}

// ---- the battle ----
function start() {
  const teams = P.opts.teams.map((t, side) => {
    const used = new Set();
    const out = [];
    for (let i = 0; i < P.opts.size; i++) {
      const s = fixSlot(t[i]);
      if (s) { out.push(s); used.add(P.byKey.get(s.key).cid); }
      else out.push(null);
    }
    const list = playable().filter(e => !used.has(e.cid));
    return out.map(s => {
      if (s) return s;
      const k = Math.floor(Math.random() * list.length), [e] = list.splice(k, 1);
      return fillSlot(e.key);
    });
  });
  const builds = teams.map(t => t.map(toBuild));
  P.battle = { teams, builds, seed: Math.floor(Math.random() * 1e9), choices: [], format: P.opts.format, level: +P.opts.level, hpScale: +P.opts.hpScale };
  P.target = null;
  step();
}

// Re-run the battle from its seed with every recorded choice, stopping at the first choice still to make.
function step() {
  const G = P.battle;
  Object.assign(RULES, { level: G.level, hpScale: G.hpScale });
  let i = 0, pause = null;
  const decide = (kind, B, x, options, extra) => {
    const side = kind === 'action' ? x.side : x;
    if (side.i !== 0) return null;
    if (kind === 'action' && (x.vol.recharge > 0 || x.vol.charging || x.vol.rampage)) return null;  // locked in: the engine picks
    if (i < G.choices.length) return decode(G.choices[i++], B, kind, x, options);
    pause = { kind, B, m: kind === 'action' ? x : null, side, options, extra };
    throw PAUSE;
  };
  try {
    const B = runBattle(P.data, G.builds, { rng: rng(G.seed), format: G.format === 'duos' ? 'duos' : 'singles', level: G.level, log: true, decide });
    G.B = B; G.pause = null;
  } catch (e) {
    if (e !== PAUSE) throw e;
    G.B = pause.B; G.pause = pause;
  }
  draw();
}

function decode(c, B, kind, x, options) {
  const me = B.sides[0], foe = B.sides[1];
  if (kind === 'replace') return options.find(m => m === me.mons[c.to]) || options[0];
  if (c.t === 's') return { type: 'switch', to: me.mons[c.to] };
  return { type: 'move', slot: c.slot, target: foe.mons[c.target] || B.api.foesOf(x)[0] };
}

function choose(c) {
  P.battle.choices.push(c);
  P.target = null;
  step();
}

// ---- drawing ----
const pctOf = m => Math.max(0, Math.round(m.hp / m.maxhp * 100));
const hpColor = p => p > 50 ? '#3aa55d' : p > 20 ? '#d9a21b' : '#d0453a';
const pic = e => {
  const s = roster[e.ci]?.stages[e.j];
  return s?.image ? `<img src="${esc(imgSrc(s.image))}" alt="" loading="lazy">` : '';
};

function monCard(m, B) {
  const p = pctOf(m);
  const boosts = Object.entries(m.boosts).filter(([, n]) => n).map(([k, n]) => `<span class="badge">${BOOST[k]} ${n > 0 ? '+' : ''}${n}</span>`);
  const extra = [
    m.status ? `<span class="badge danger">${STATUS[m.status] || m.status}</span>` : '',
    m.vol.confuse > 0 ? '<span class="badge">Confused</span>' : '',
    m.vol.sub ? '<span class="badge">Substitute</span>' : '',
    m.vol.taunt > 0 ? '<span class="badge">Taunted</span>' : '',
    m.vol.countdown ? `<span class="badge danger">Countdown: turn ${m.vol.countdown}</span>` : '',
    ...boosts,
  ].join('');
  return `<div class="pmon">
    <div class="ppic">${pic(m.e)}</div>
    <div class="pinfo">
      <div class="pname"><a href="${charLink(roster[m.e.ci], m.e.j)}">${esc(m.name)}</a> ${m.types.map(badge).join('')}</div>
      <div class="php"><span style="width:${p}%;background:${hpColor(p)}"></span></div>
      <div class="hint">${m.side.i === 0 ? `${m.hp} / ${m.maxhp}` : `${p}%`} · ${esc(m.abilityName)}</div>
      ${extra ? `<div class="ptags">${extra}</div>` : ''}
    </div></div>`;
}

function sideBox(s, B) {
  const act = s.active.filter(m => m && !m.fainted);
  const team = s.mons.map(m => `<span class="pball${m.fainted ? ' out' : ''}${act.includes(m) ? ' on' : ''}" title="${esc(m.name)}${m.fainted ? ' (knocked out)' : ` (${pctOf(m)}%)`}"></span>`).join('');
  const h = s.hazards, notes = [
    h.rocks ? 'Rocks' : '', h.spikes ? `Spikes ×${h.spikes}` : '', h.web ? 'Web' : '', h.rainbow ? 'Rainbow' : '',
    ...Object.entries(s.screens).map(([k, n]) => `${{ reflect: 'Physical screen', light: 'Energy screen', veil: 'Veil' }[k] || k} (${n})`),
    s.tailwind ? `Tailwind (${s.tailwind})` : '',
  ].filter(Boolean);
  return `<section class="pside">
    <h3>${SIDE[s.i]} <span class="pballs">${team}</span></h3>
    ${notes.length ? `<p class="hint">${notes.map(esc).join(' · ')}</p>` : ''}
    <div class="pmons">${act.map(m => monCard(m, B)).join('') || '<p class="hint">Nobody left.</p>'}</div>
  </section>`;
}

const effLabel = e => e === 0 ? 'No effect' : e >= 4 ? 'Super effective ×4' : e >= 2 ? 'Super effective' : e <= 0.25 ? 'Barely effective' : e < 1 ? 'Not very effective' : '';

function moveButton(B, m, x, i, foe) {
  const md = x.m, api = B.api;
  const can = usable(m, x);
  let hint = '';
  if (foe && md.cat !== 'Status') {
    const type = api.moveType(m, x, foe);
    const e = api.effectiveness(m, x, foe, type, false);
    const d = estDamage(api, m, x, foe);
    hint = [effLabel(e), d > 0 ? `≈${Math.round(d * 100)}%` : ''].filter(Boolean).join(' · ');
  }
  const type = foe ? api.moveType(m, x, foe) : md.type;
  return `<button type="button" class="pmove" data-move="${i}"${can ? '' : ' disabled'} title="${esc(md.effect || '')}" style="--t:var(--${type})">
    <span class="pmn">${esc(x.as)}${x.sig ? ' <span class="badge sigb">Signature</span>' : ''}</span>
    <span class="pmd">${badge(type)} ${md.cat}${md.power ? ` · ${md.power}` : ''}${md.accuracy ? ` · ${md.accuracy}%` : ''} · ${x.pp}/${md.pp || 5} PP</span>
    ${hint ? `<span class="pmh">${esc(hint)}</span>` : ''}
    ${md.effect ? `<span class="pme">${esc(md.effect)}</span>` : ''}
  </button>`;
}

function actionPanel(G) {
  const { B, pause } = G;
  const me = B.sides[0], api = B.api;
  if (pause.kind === 'replace') {
    return `<div class="pact"><p><b>Who comes in?</b></p><div class="pswitch">${pause.options.map(m =>
      `<button type="button" data-replace="${me.mons.indexOf(m)}">${esc(m.name)} <span class="hint">${pctOf(m)}%</span></button>`).join('')}</div></div>`;
  }
  const m = pause.m, foes = api.foesOf(m);
  if (P.target != null) {
    const x = m.moves[P.target];
    return `<div class="pact"><p><b>${esc(x.as)}</b>: which foe?</p><div class="pswitch">${foes.map(f =>
      `<button type="button" data-target="${B.sides[1].mons.indexOf(f)}">${esc(f.name)} <span class="hint">${(() => { const d = estDamage(api, m, x, f); return d > 0 ? `≈${Math.round(d * 100)}%` : effLabel(0); })()}</span></button>`).join('')}
      <button type="button" data-target="back">Back</button></div></div>`;
  }
  const foe = foes.length === 1 ? foes[0] : null;
  const bench = api.bench(me);
  const canSw = api.canSwitch(m) && !pause.extra;
  return `<div class="pact">
    <p><b>What will ${esc(m.name)} do?</b>${pause.extra ? ' <span class="hint">(extra turn)</span>' : ''}${foes.length > 1 ? ' <span class="hint">Damage estimates show once you pick a target.</span>' : ''}</p>
    <div class="pmoves">${m.moves.map((x, i) => moveButton(B, m, x, i, foe)).join('')}</div>
    ${bench.length ? `<p class="hint">Switch${canSw ? '' : ': can\'t switch right now'}</p><div class="pswitch">${bench.map(b =>
      `<button type="button" data-switch="${me.mons.indexOf(b)}"${canSw ? '' : ' disabled'}>${esc(b.name)} <span class="hint">${pctOf(b)}%</span></button>`).join('')}</div>` : ''}
  </div>`;
}

function fieldLine(B) {
  if (!B.field) return '';
  const f = B.field;
  const what = f.trickRoom ? 'Slower characters move first' : f.boostType ? `${f.boostType} moves do ${RULES.fieldBoost}×` : f.foeSlow ? 'Foes of the setter move at half Speed'
    : f.gravity ? 'Gravity' : f.snow ? 'Snow' : f.sideHeal ? 'The setter\'s side heals each turn' : f.entryChip ? 'Hurts foes coming in' : 'Field effect';
  return `<p class="pfield">Field from ${esc(f.by?.name || '')} (${f.owner ? 'AI' : 'you'}): ${esc(what)}, ${f.turns} turn${f.turns === 1 ? '' : 's'} left</p>`;
}

function logHtml(B) {
  const stats = j => Object.entries(JSON.parse(j)).map(([k, n]) => `${BOOST[k] || k} ${n > 0 ? '+' : ''}${n}`).join(', ');
  const lines = B.log.map(l => l.replace(/ \(A\)/g, ' (you)').replace(/ \(B\)/g, ' (AI)')
    .replace(/ stats (\{.*\})$/, (_, j) => ': ' + stats(j)).replace(/^(\[\d+\] Field set by .*?) \{.*\}$/, '$1'));
  let out = '', turn = -1;
  for (const l of lines) {
    const [, t, rest] = l.match(/^\[(\d+)\] (.*)$/) || [, turn, l];
    if (+t !== turn) { turn = +t; out += `<b>${turn ? `Turn ${turn}` : 'Start'}</b>\n`; }
    out += esc(rest) + '\n';
  }
  return out;
}

function battleView() {
  const G = P.battle, B = G.B;
  const result = G.pause ? '' : `<div class="presult"><b>${B.winner === 0 ? 'You win!' : B.winner === 1 ? 'The AI wins.' : 'Draw.'}</b> After ${B.turn} turn${B.turn === 1 ? '' : 's'}.</div>`;
  return `<div class="pbattle">
    ${sideBox(B.sides[1], B)}
    ${fieldLine(B)}
    ${sideBox(B.sides[0], B)}
    ${G.pause ? actionPanel(G) : result}
    <div class="row">
      ${G.choices.length ? '<button type="button" id="pundo">Undo last choice</button>' : ''}
      ${G.pause ? '<button type="button" id="pforfeit">Forfeit</button>' : '<button type="button" id="prematch" class="primary">Rematch</button>'}
      <button type="button" id="psetup">Change teams</button>
    </div>
    <h3>Battle log</h3>
    <pre class="simlog" id="plog">${logHtml(B)}</pre>
  </div>`;
}

function slotRow(side, i) {
  const s = P.opts.teams[side][i] && fixSlot(P.opts.teams[side][i]);
  P.opts.teams[side][i] = s;
  const list = playable().sort((a, b) => a.name.localeCompare(b.name));
  const sel = `<select data-pick="${side}:${i}"><option value="">Random</option>${list.map(e =>
    `<option value="${esc(e.key)}"${s?.key === e.key ? ' selected' : ''}>${esc(e.name)} (${esc(rarityName(e.rarity))})</option>`).join('')}</select>`;
  if (!s) return `<div class="pslot"><div class="pslothead"><span class="num">${i + 1}</span>${sel}</div></div>`;
  const e = P.byKey.get(s.key);
  const opts = pool(e).sort((a, b) => a.as.localeCompare(b.as));
  const moveSel = k => `<select data-mv="${side}:${i}:${k}">${opts.map(l => { const m = mv(l.id); return `<option value="${esc(l.id)}"${s.moves[k] === l.id ? ' selected' : ''}>${esc(l.as)} (${m.type}, ${m.category === 'Status' ? 'status' : m.power || '—'})</option>`; }).join('')}</select>`;
  const sig = mv(e.sig.id);
  return `<div class="pslot">
    <div class="pslothead"><span class="num">${i + 1}</span>${sel} ${e.types.map(badge).join('')}
      <label>Ability <select data-ab="${side}:${i}">${e.abilities.map(a => `<option${a.name === s.ability ? ' selected' : ''}>${esc(a.name)}</option>`).join('') || '<option>None</option>'}</select></label>
      <button type="button" data-reroll="${side}:${i}" title="Pick a new sensible moveset">Re-roll moves</button></div>
    <div class="pslotmoves">${[0, 1, 2, 3].filter(k => k < Math.min(4, opts.length)).map(moveSel).join('')}
      <span class="hint">+ ${esc(sig.name)} <span class="badge sigb">Signature</span></span></div>
  </div>`;
}

function setupView() {
  const o = P.opts, opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
  const team = side => `<section class="pteam"><h3>${SIDE[side]}</h3>
    <div class="row"><button type="button" data-random="${side}">Random team</button><button type="button" data-clear="${side}">Clear</button></div>
    ${Array.from({ length: o.size }, (_, i) => slotRow(side, i)).join('')}</section>`;
  return `<form class="simform" id="pform">
      <label>Format <select name="format">${opt('singles', 'Singles', o.format)}${opt('duos', 'Duos (two on the field)', o.format)}</select></label>
      <label>Team size <select name="size">${(o.format === 'duos' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]).map(n => opt(n, n, o.size)).join('')}</select></label>
      <label>Characters <select name="forms">${opt('final', 'Final forms', o.forms)}${opt('all', 'Every form', o.forms)}</select></label>
      <label>Level <select name="level">${[30, 50, 70, 100].map(n => opt(n, n, o.level)).join('')}</select></label>
      <label>Vitality <select name="hpScale">${[1, 1.5, 2].map(n => opt(n, '×' + n, o.hpScale)).join('')}</select></label>
    </form>
    <div class="simcols">${team(0)}${team(1)}</div>
    <p class="hint">Empty slots are filled at random when the battle starts. Each character gets four moves from its learnset (up to the battle level) plus its signature move, which is always on.</p>
    <div class="row"><button type="button" id="pstart" class="primary">Start battle</button></div>`;
}

function renderPlay() {
  const el = $('#play');
  if (!roster.length || !moves.length) { el.innerHTML = '<p class="hint">Loading the roster…</p>'; return; }
  ensureData();
  const o = P.opts;
  o.teams = [0, 1].map(s => (o.teams[s] || []).slice(0, o.size));
  el.innerHTML = `<div class="article simhead"><h1>Battle vs AI</h1>
      <p class="lead">Pick your team and the AI's team, then battle the simulator's AI one turn at a time.</p>
      <p class="hint">Same rules as the <a href="#sim">Battle simulator</a>: the type chart, damage formula, abilities, status and field effects. The AI is the one the simulator uses, and it can see both teams.</p></div>
    ${P.battle ? battleView() : setupView()}`;
  const log = $('#plog');
  if (log) log.scrollTop = log.scrollHeight;
}

function draw() { if (location.hash === '#play') renderPlay(); }
window.renderPlay = renderPlay;

// ---- events ----
const at = s => s.split(':').map(Number);
document.addEventListener('click', e => {
  if (location.hash !== '#play') return;
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset, G = P.battle;
  if (b.id === 'pstart') return start();
  if (b.id === 'psetup') { P.battle = null; return draw(); }
  if (b.id === 'prematch') { G.seed = Math.floor(Math.random() * 1e9); G.choices = []; return step(); }
  if (b.id === 'pforfeit') { P.battle = null; return draw(); }
  if (b.id === 'pundo') { G.choices.pop(); P.target = null; return step(); }
  if (d.random) { randomTeam(+d.random); save(); return draw(); }
  if (d.clear) { P.opts.teams[+d.clear] = []; save(); return draw(); }
  if (d.reroll) { const [s, i] = at(d.reroll); P.opts.teams[s][i] = fillSlot(P.opts.teams[s][i].key); save(); return draw(); }
  if (!G?.pause) return;
  if (d.replace != null) return choose({ t: 'r', to: +d.replace });
  if (d.switch != null) return choose({ t: 's', to: +d.switch });
  if (d.move != null) {
    const m = G.pause.m, x = m.moves[+d.move], foes = G.B.api.foesOf(m);
    const spread = x.m.fx.spread || G.B.api.abOf(m).spreadType === x.m.type;
    if (foes.length > 1 && x.m.cat !== 'Status' && !spread) { P.target = +d.move; return draw(); }
    return choose({ t: 'm', slot: +d.move, target: foes[0] ? G.B.sides[1].mons.indexOf(foes[0]) : -1 });
  }
  if (d.target != null) {
    if (d.target === 'back') { P.target = null; return draw(); }
    return choose({ t: 'm', slot: P.target, target: +d.target });
  }
});

document.addEventListener('change', e => {
  if (location.hash !== '#play') return;
  const t = e.target, o = P.opts;
  if (t.closest('#pform')) {
    o[t.name] = ['size', 'level', 'hpScale'].includes(t.name) ? +t.value : t.value;
    if (t.name === 'format') o.size = Math.max(o.size, o.format === 'duos' ? 2 : 1);
    if (t.name === 'forms') o.teams = o.teams.map(tm => tm.map(s => s && playable().some(x => x.key === s.key) ? s : null));
    save(); return draw();
  }
  if (t.dataset.pick) { const [s, i] = at(t.dataset.pick); o.teams[s][i] = t.value ? fillSlot(t.value) : null; save(); return draw(); }
  if (t.dataset.ab) { const [s, i] = at(t.dataset.ab); o.teams[s][i].ability = t.value; save(); return; }
  if (t.dataset.mv) { const [s, i, k] = at(t.dataset.mv); o.teams[s][i].moves[k] = t.value; save(); return; }
});

draw();
