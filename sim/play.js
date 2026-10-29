// The Battle vs AI page (#play): pick your team and the AI's team, then fight the simulator's AI turn by turn.
// A module that uses app.js helpers ($, esc, badge, roster, moves, rarityName, charLink) and the simulator engine.
// The engine runs a battle start to finish, so a turn-by-turn battle is a replay: every choice you make is
// recorded, and each step re-runs the battle from the same seed with those choices until it reaches a choice
// you haven't made yet. Battles are short, so a replay takes a millisecond or two.
// Competitive doubles: each side brings 8 (or 10) trained characters with held items, the AI drafts its 6
// against yours in a team preview, and the 6v6 doubles battle at Lv50 is a draw after 50 turns.

import { prepare, runBattle, rng } from './battle.js';
import { makeBuild } from './batch.js';
import { estDamage, usable } from './ai.js';
import { RULES, COMPETITIVE, bringLegendCap, TRAINING, TYPES, STAT_KEYS, STAT_NAMES, NATURES, natureName, ITEMS, itemDef, itemName } from './rules.js';
import { compileAbility } from './compile.js';
import { PRESETS, kit, trainTeam } from './builds.js';
import { ARCHETYPES, archetypeById, roster as archRoster, fits, forced, BRING, PICK } from './archetypes.js';
import { guessBuilds, draftSide } from './draft.js';

const STORE = 'familiar-play';
const PAUSE = { pause: true };
const NONE = { name: 'None', ab: compileAbility({ name: 'None', text: '' }) };
const SIDE = ['Your team', 'AI team'];
const STATUS = { burn: 'Burned', freeze: 'Frozen', stun: 'Stunned', bleed: 'Bleeding', curse: 'Cursed', sleep: 'Asleep' };
const BOOST = { pow: 'Power', grd: 'Guard', ene: 'Energy', wil: 'Will', spe: 'Speed' };

const P = {
  data: null, src: null, battle: null, preview: null, target: null, msg: '',
  // comp: the brought teams for Competitive doubles, kept apart from the singles/duos teams; arch: the
  // archetype each was built from (the AI plays its plan while the team still fits it)
  opts: { format: 'singles', size: 3, forms: 'final', level: 100, hpScale: 2, teams: [[], []], bring: COMPETITIVE.bring, comp: [[], []], arch: [null, null] },
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
const isComp = () => P.opts.format === 'comp';
// the competitive format battles at Lv50 but keeps moves learned up to Lv100
const learnLv = () => isComp() ? 100 : +P.opts.level;
const pool = e => e.learn.filter(l => l.lv <= learnLv() && l.id !== e.sig?.id);
const mv = id => P.data.moves.get(id);
const LEGEND = new Set(['legendary', 'mythical']);
const isLeg = e => LEGEND.has(e?.rarity);
const sizeOf = () => isComp() ? P.opts.bring : P.opts.size;
const teamOf = side => isComp() ? P.opts.comp[side] : P.opts.teams[side];
const setTeam = (side, t) => { if (isComp()) { P.opts.comp[side] = t; P.opts.arch[side] = null; } else P.opts.teams[side] = t; };
const bringCap = () => isComp() ? bringLegendCap(P.opts.bring) : Infinity;
const COMP_OPTS = { level: COMPETITIVE.level, learnLevel: 100, format: 'comp', pickLegendCap: COMPETITIVE.legendCap };

// A slot is { key, ability, moves: [4 move ids] } or empty (filled at random when the battle starts).
// In the competitive format it also has nature, evs, ivs and item, each 'ai' (the AI's own pick for this
// character on this team), 'random' (rolled when the battle starts) or a set value; item can also be 'none'.
const AI_TRAIN = { nature: 'ai', evs: 'ai', ivs: 'ai', item: 'ai' };
const rand = Object.assign(() => Math.random(), { pick: a => a[Math.floor(Math.random() * a.length)] });
function fillSlot(key, force) {
  const e = P.byKey.get(key);
  if (!e) return null;
  const b = makeBuild(P.data, e, rand, { level: learnLv(), format: isComp() ? 'comp' : P.opts.format, force });
  return { key, ability: b.ability.name, moves: b.moves.filter(l => l !== e.sig).map(l => l.id), ...(isComp() ? AI_TRAIN : {}) };
}
function fixSlot(s) {
  const e = s && P.byKey.get(s.key);
  if (!e) return null;
  const ids = new Set(pool(e).map(l => l.id));
  if (s.moves.some(id => !ids.has(id)) || !e.abilities.some(a => a.name === s.ability) && e.abilities.length) s = { ...s, ...fillSlot(s.key), ...train(s) };
  if (isComp()) for (const f in AI_TRAIN) if (s[f] == null) s[f] = 'ai';
  return s;
}
const train = s => Object.fromEntries(Object.keys(AI_TRAIN).filter(f => s[f] != null).map(f => [f, s[f]]));
function randomTeam(side) {
  const used = new Set(), list = playable(), t = [], cap = bringCap();
  for (let guard = 0; t.length < sizeOf() && guard < 5000; guard++) {
    const e = rand.pick(list);
    if (used.has(e.cid) || isLeg(e) && t.filter(s => isLeg(P.byKey.get(s.key))).length >= cap) continue;
    used.add(e.cid); t.push(fillSlot(e.key));
  }
  setTeam(side, t);
}

// A brought team built around an archetype (archetypes.js): 1 setter and 3 abusers, each carrying the move
// or ability the plan needs, that a legal 6 can still hold, and the rest at random.
function archetypeTeam(side, id) {
  const A = archetypeById(id), ents = playable(), R = archRoster(P.data, A, ents);
  const setters = ents.filter(e => R.setters.has(e.key)), abusers = ents.filter(e => R.abusers.has(e.key));
  if (!setters.length || !abusers.length) return false;
  const cap = bringCap(), legKey = k => isLeg(P.byKey.get(k));
  for (let tries = 0; tries < 300; tries++) {
    const t = [], used = new Set();
    const add = e => { if (used.has(e.cid) || isLeg(e) && t.filter(isLeg).length >= cap) return; used.add(e.cid); t.push(e); };
    add(rand.pick(setters));
    for (let g = 0; t.length < BRING.setters + BRING.abusers && g < 200; g++) add(rand.pick(abusers));
    const keys = t.map(e => e.key);
    if (!fits(keys, R, BRING) || !fits(keys, R, PICK, legKey, COMPETITIVE.legendCap)) continue;
    for (let g = 0; t.length < P.opts.bring && g < 5000; g++) add(rand.pick(ents));
    if (t.length < P.opts.bring) continue;
    P.opts.comp[side] = t.map(e => fillSlot(e.key, forced(R, e.key)));
    P.opts.arch[side] = id;
    return true;
  }
  return false;
}
// The archetype a brought team still plays, or null once edits broke the plan.
function archOf(side, slots) {
  const id = P.opts.arch[side], A = id && archetypeById(id);
  if (!A) return null;
  const R = archRoster(P.data, A, P.data.entrants), keys = slots.filter(Boolean).map(s => s.key);
  return fits(keys, R, BRING) && fits(keys, R, PICK, k => isLeg(P.byKey.get(k)), COMPETITIVE.legendCap) ? id : null;
}

// ---- training and items (competitive) ----
const ITEM_IDS = ITEMS.flatMap(i => i.typed ? TYPES.map(t => i.id + ':' + t) : [i.id]);
const zero = () => Object.fromEntries(STAT_KEYS.map(k => [k, 0]));
function randomEvs() {
  const ev = zero();
  for (let n = 0; n < TRAINING.evTotal; n++) ev[rand.pick(STAT_KEYS.filter(k => ev[k] < TRAINING.evMax))]++;
  return ev;
}
const randomIvs = () => Object.fromEntries(STAT_KEYS.map(k => [k, Math.floor(Math.random() * (TRAINING.ivMax + 1))]));
// EV presets from builds.js ('atk' = whichever of Power or Energy the character's moves use), and IV presets
function presetEvs(s, id) {
  const k = kit(P.data, toBuild(s)), ev = zero();
  for (const [st, v] of Object.entries(PRESETS[id].evs)) ev[st === 'atk' ? k.atk : st] += v;
  return ev;
}
const IV_PRESETS = {
  max: { name: 'All 31', ivs: () => ({}) },
  slow: { name: '0 Speed (Trick Room)', ivs: () => ({ spe: 0 }) },
  noAtk: { name: '0 in the unused attack', ivs: s => ({ [kit(P.data, toBuild(s)).other]: 0 }) },
};
const presetIvs = (s, id) => ({ ...Object.fromEntries(STAT_KEYS.map(k => [k, TRAINING.ivMax])), ...IV_PRESETS[id].ivs(s) });
const same = (a, b) => a && b && STAT_KEYS.every(k => a[k] === b[k]);

// The brought team as battle builds. roll: roll the 'random' parts now (battle start); without it they stay
// on the AI's pick, for showing what the AI would choose. A set item already on another slot counts as 'ai'.
function compBuilds(slots, roll) {
  const filled = slots.filter(Boolean), builds = filled.map(toBuild), ov = {}, noItem = [], taken = new Set();
  for (const s of filled) {
    const o = ov[s.key] = {};
    if (s.nature === 'random') { if (roll) o.nature = rand.pick(NATURES); } else if (s.nature !== 'ai') o.nature = s.nature;
    if (s.evs === 'random') { if (roll) o.evs = randomEvs(); } else if (typeof s.evs === 'object') o.evs = s.evs;
    if (s.ivs === 'random') { if (roll) o.ivs = randomIvs(); } else if (typeof s.ivs === 'object') o.ivs = s.ivs;
    if (s.item === 'none' || s.item === 'random' && !roll) noItem.push(s.key);
    else if (itemDef(s.item) && !taken.has(s.item)) { o.item = s.item; taken.add(s.item); }
  }
  if (roll) for (const s of filled) if (s.item === 'random') {
    const left = ITEM_IDS.filter(id => !taken.has(id));
    if (left.length) { ov[s.key].item = rand.pick(left); taken.add(ov[s.key].item); }
  }
  trainTeam(P.data, builds, rng(7), { training: 'ai', items: 'ai', overrides: ov, noItem });
  const by = new Map(builds.map(b => [b.e.key, b]));
  return slots.map(s => s && by.get(s.key));
}
function toBuild(s) {
  const e = P.byKey.get(s.key);
  const learn = new Map(e.learn.map(l => [l.id, l]));
  const ab = e.abilities.find(a => a.name === s.ability) || e.abilities[0];
  return { e, moves: [...s.moves.map(id => learn.get(id)).filter(Boolean), e.sig], ability: ab || NONE };
}

// ---- the battle ----
// Both teams with every empty slot filled at random (one copy per character, legendary cap in the competitive format).
function fullTeams() {
  const used = new Set();
  return [0, 1].map(side => {
    const t = teamOf(side), out = [], mine = new Set();
    for (let i = 0; i < sizeOf(); i++) {
      const s = fixSlot(t[i]);
      if (s && !mine.has(P.byKey.get(s.key).cid)) { out.push(s); mine.add(P.byKey.get(s.key).cid); } else out.push(null);
    }
    let legs = out.filter(s => s && isLeg(P.byKey.get(s.key))).length;
    const list = playable().filter(e => !mine.has(e.cid) && !used.has(e.cid));
    const done = out.map(s => {
      if (s) return s;
      const ok = list.filter(e => !isLeg(e) || legs < bringCap());
      const e = rand.pick(ok.length ? ok : list);
      list.splice(list.indexOf(e), 1);
      if (isLeg(e)) legs++;
      return fillSlot(e.key);
    });
    done.forEach(s => used.add(P.byKey.get(s.key).cid));
    return done;
  });
}

function start() {
  if (isComp()) {
    const over = [0, 1].find(side => teamOf(side).filter(s => s && isLeg(P.byKey.get(s.key))).length > bringCap());
    if (over != null) { P.msg = `${SIDE[over]} brings more than ${bringCap()} legendaries or mythicals.`; return draw(); }
  }
  const teams = fullTeams();
  if (isComp()) return startPreview(teams);
  const builds = teams.map(t => t.map(toBuild));
  P.battle = { teams, builds, seed: Math.floor(Math.random() * 1e9), choices: [], format: P.opts.format, level: +P.opts.level, hpScale: +P.opts.hpScale };
  P.target = null;
  step();
}

// Team preview: both brought teams are trained and itemised, and the AI drafts its 6 against the characters
// you brought (it sees only who they are and guesses standard builds, as in the simulator).
function startPreview(teams) {
  RULES.hpScale = +P.opts.hpScale;
  const builds = teams.map(t => compBuilds(t, true));
  const plans = [archOf(0, teams[0]), archOf(1, teams[1])];
  const must = id => { if (!id) return null; const R = archRoster(P.data, archetypeById(id), P.data.entrants); const ix = f => builds[1].map((b, i) => f.has(b.e.key) ? i : -1).filter(i => i >= 0); return { setters: ix(R.setters), abusers: ix(R.abusers), need: PICK }; };
  const guess = guessBuilds(P.data, builds[0].map(b => b.e), makeBuild, COMP_OPTS);
  const ai = draftSide(P.data, builds[1], guess, { ...COMP_OPTS, must: must(plans[1]) }, rng(Math.floor(Math.random() * 1e9)));
  P.preview = { teams, builds, plans, ai, picks: [], hint: null, hpScale: +P.opts.hpScale };
  P.battle = null;
  draw();
}
// Your best 6 by the same draft AI, against standard guesses of the AI's bring.
function suggestPicks() {
  const V = P.preview;
  RULES.hpScale = V.hpScale;
  const guess = guessBuilds(P.data, V.builds[1].map(b => b.e), makeBuild, COMP_OPTS);
  const d = draftSide(P.data, V.builds[0], guess, COMP_OPTS, rng(Math.floor(Math.random() * 1e9)));
  V.picks = d.order; V.hint = d.log;
}
function lockIn() {
  const V = P.preview;
  P.battle = {
    comp: true, teams: V.teams, builds: [V.picks.map(i => V.builds[0][i]), V.ai.order.map(i => V.builds[1][i])],
    seed: Math.floor(Math.random() * 1e9), choices: [], format: 'duos', level: COMPETITIVE.level, hpScale: V.hpScale,
    turnCap: COMPETITIVE.turnCap, plans: [null, V.plans[1]],
  };
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
    const B = runBattle(P.data, G.builds, { rng: rng(G.seed), format: G.format === 'duos' ? 'duos' : 'singles', level: G.level, log: true, decide, turnCap: G.turnCap, plans: G.plans });
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
    // your items always show; the AI's once used (team sheets are closed in the competitive format)
    m.item && (m.side.i === 0 || m.itemUsed) ? `<span class="badge">${esc(m.item.label)}${m.itemUsed ? ' (used)' : ''}</span>` : '',
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
  const capped = B.winner < 0 && G.turnCap && B.turn > G.turnCap;
  const result = G.pause ? '' : `<div class="presult"><b>${B.winner === 0 ? 'You win!' : B.winner === 1 ? 'The AI wins.' : 'Draw.'}</b> ${capped ? `Nobody won within ${G.turnCap} turns, which counts as a loss for both sides.` : `After ${B.turn} turn${B.turn === 1 ? '' : 's'}.`}</div>`;
  return `<div class="pbattle">
    ${sideBox(B.sides[1], B)}
    ${fieldLine(B)}
    ${sideBox(B.sides[0], B)}
    ${G.pause ? actionPanel(G) : result}
    <div class="row">
      ${G.choices.length ? '<button type="button" id="pundo">Undo last choice</button>' : ''}
      ${G.pause ? '<button type="button" id="pforfeit">Forfeit</button>' : '<button type="button" id="prematch" class="primary">Rematch</button>'}
      ${G.comp ? '<button type="button" id="predraft">Back to team preview</button>' : ''}
      <button type="button" id="psetup">Change teams</button>
    </div>
    ${G.comp ? `<details class="pdraftlog"><summary>How the AI drafted</summary>${draftLog(P.preview.ai.log)}</details>` : ''}
    <h3>Battle log</h3>
    <pre class="simlog" id="plog">${logHtml(B)}</pre>
  </div>`;
}

function slotRow(side, i, shown) {
  const t = teamOf(side), s = t[i] && fixSlot(t[i]);
  t[i] = s;
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
    ${isComp() ? trainRow(side, i, s, shown[i]) : ''}
  </div>`;
}

// Nature, held item, EVs and IVs for one competitive slot. b = the build with the AI's picks filled in.
function trainRow(side, i, s, b) {
  const at = `${side}:${i}`, o = (v, l, cur, dis) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}${dis ? ' disabled' : ''}>${esc(l)}</option>`;
  const ai = l => `AI pick (${l})`;
  const nat = `<select data-nat="${at}">${o('ai', ai(natureName(b.nature)), s.nature)}${o('random', 'Random', s.nature)}${NATURES.map(n => o(n, natureName(n), s.nature)).join('')}</select>`;
  const taken = new Set(teamOf(side).filter((x, k) => x && k !== i && itemDef(x.item)).map(x => x.item));
  const itemOpt = id => o(id, itemName(id), s.item, taken.has(id));
  const item = `<select data-item="${at}">${o('ai', ai(b.item ? itemName(b.item) : 'none left'), s.item)}${o('random', 'Random', s.item)}${o('none', 'None', s.item)}
    ${ITEMS.map(d => d.typed ? `<optgroup label="${esc(d.name)}">${TYPES.map(t => itemOpt(d.id + ':' + t)).join('')}</optgroup>` : itemOpt(d.id)).join('')}</select>`;
  const def = itemDef(s.item) || (s.item === 'ai' ? itemDef(b.item) : null);
  const stats = (kind, val, max, presets) => {
    const cur = typeof s[kind] === 'object' ? s[kind] : null;
    const match = cur && Object.keys(presets).find(id => same(cur, kind === 'evs' ? presetEvs(s, id) : presetIvs(s, id)));
    const sel = s[kind] === 'ai' || s[kind] === 'random' ? s[kind] : match || 'custom';
    const used = kind === 'evs' && val ? STAT_KEYS.reduce((n, k) => n + val[k], 0) : 0;
    return `<div class="pstats"><span class="plabel">${kind === 'evs' ? 'EVs' : 'IVs'}</span>
      <select data-${kind}p="${at}">${o('ai', kind === 'evs' ? ai(PRESETS[b.preset]?.name || 'AI') : 'AI pick', sel)}${o('random', 'Random', sel)}${Object.entries(presets).map(([id, p]) => o(id, p.name, sel)).join('')}${o('custom', 'Custom', sel)}</select>
      ${STAT_KEYS.map(k => `<label title="${STAT_NAMES[k]}">${STAT_NAMES[k].slice(0, 3)}<input type="number" min="0" max="${max}" data-${kind.slice(0, 2)}="${at}:${k}" value="${val ? val[k] : ''}"${val ? '' : ' placeholder="?"'}></label>`).join('')}
      ${kind === 'evs' && val ? `<span class="hint">${used} / ${TRAINING.evTotal}</span>` : ''}</div>`;
  };
  const ev = s.evs === 'random' ? null : typeof s.evs === 'object' ? s.evs : b.evs;
  const iv = s.ivs === 'random' ? null : typeof s.ivs === 'object' ? s.ivs : { ...Object.fromEntries(STAT_KEYS.map(k => [k, TRAINING.ivMax])), ...b.ivs };
  return `<div class="ptrain">
    <div class="pslothead"><label>Nature ${nat}</label><label>Item ${item}</label></div>
    ${def ? `<p class="hint">${esc(def.text)}</p>` : ''}
    ${stats('evs', ev, TRAINING.evMax, PRESETS)}
    ${stats('ivs', iv, TRAINING.ivMax, IV_PRESETS)}
  </div>`;
}

function setupView() {
  const o = P.opts, comp = isComp(), opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
  const compHead = side => {
    const t = teamOf(side), legs = t.filter(s => s && isLeg(P.byKey.get(s.key))).length, arch = archOf(side, t);
    return `<div class="row"><select data-preset="${side}"><option value="">Team preset…</option><option value="random">Random team</option><option value="arch">Random archetype</option>
        <optgroup label="Archetypes">${ARCHETYPES.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</optgroup></select>
      <button type="button" data-allai="${side}" title="Set every nature, item, EVs and IVs back to the AI's pick">All AI builds</button>
      <button type="button" data-clear="${side}">Clear</button></div>
      <p class="hint">Legendary or mythical: ${legs} / ${bringCap()} brought, 1 can be picked.${arch ? ` Built as <b>${esc(archetypeById(arch).name)}</b>: ${esc(archetypeById(arch).note)}${side ? ' The AI drafts and plays this plan.' : ''}` : ''}</p>`;
  };
  const team = side => {
    const t = teamOf(side);
    for (let i = 0; i < sizeOf(); i++) t[i] = t[i] ? fixSlot(t[i]) : null;
    const shown = comp ? compBuilds(t, false) : [];
    return `<section class="pteam"><h3>${SIDE[side]}${comp ? ` (brings ${o.bring})` : ''}</h3>
    ${comp ? compHead(side) : `<div class="row"><button type="button" data-random="${side}">Random team</button><button type="button" data-clear="${side}">Clear</button></div>`}
    ${Array.from({ length: sizeOf() }, (_, i) => slotRow(side, i, shown)).join('')}</section>`;
  };
  return `<form class="simform" id="pform">
      <label>Format <select name="format">${opt('singles', 'Singles', o.format)}${opt('duos', 'Duos (two on the field)', o.format)}${opt('comp', 'Competitive doubles (bring, pick 6)', o.format)}</select></label>
      ${comp ? `<label>Bring <select name="bring">${[8, 10].map(n => opt(n, n, o.bring)).join('')}</select></label>`
        : `<label>Team size <select name="size">${(o.format === 'duos' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]).map(n => opt(n, n, o.size)).join('')}</select></label>`}
      <label>Characters <select name="forms">${opt('final', 'Final forms', o.forms)}${opt('all', 'Every form', o.forms)}</select></label>
      ${comp ? '' : `<label>Level <select name="level">${[30, 50, 70, 100].map(n => opt(n, n, o.level)).join('')}</select></label>`}
      <label>Vitality <select name="hpScale">${[1, 1.5, 2, 3].map(n => opt(n, '×' + n, o.hpScale)).join('')}</select></label>
    </form>
    ${P.msg ? `<p class="hint">${esc(P.msg)}</p>` : ''}
    <div class="simcols">${team(0)}${team(1)}</div>
    <p class="hint">${comp
      ? `Competitive doubles: 6 a side, two on the field, at Lv50 with moves learned up to Lv100, and a draw after ${COMPETITIVE.turnCap} turns counts for nobody. Each side brings ${o.bring} (at most ${bringCap()} legendary or mythical) with one of each held item, then picks 6 in team preview, the first two opening. The AI sees which characters you brought but not your builds. "AI pick" is the build the simulator's AI gives that character on this team; empty slots and "Random" parts are rolled when you press Start.`
      : 'Empty slots are filled at random when the battle starts. Each character gets four moves from its learnset (up to the battle level) plus its signature move, which is always on.'}</p>
    <div class="row"><button type="button" id="pstart" class="primary">${comp ? 'Go to team preview' : 'Start battle'}</button></div>`;
}

const draftLog = lines => lines.map(l => `<p>${esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`).join('');

// Team preview: pick your 6 in order (the first two open), with the AI's bring shown by character only.
function previewView() {
  const V = P.preview, picks = V.picks, legPicked = picks.some(i => isLeg(V.builds[0][i].e));
  const card = (b, side, i) => {
    const k = side ? -1 : picks.indexOf(i);
    const blocked = !side && k < 0 && (picks.length >= COMPETITIVE.teamSize || isLeg(b.e) && legPicked);
    const body = `<div class="ppic">${pic(b.e)}</div><div class="pinfo"><div class="pname">${esc(b.e.name)} ${b.e.types.map(badge).join('')}${!side && isLeg(b.e) ? ` <span class="badge">${esc(rarityName(b.e.rarity))}</span>` : ''}</div>
      ${side ? `<div class="hint">${esc(rarityName(b.e.rarity))}</div>` : `<div class="hint">${esc(b.ability.name)} · ${esc(b.item ? itemName(b.item) : 'No item')} · ${esc(natureName(b.nature))}</div>
      <div class="hint">${b.moves.map(l => esc(l.as)).join(', ')}</div>`}</div>`;
    return side ? `<div class="pmon pcard">${body}</div>`
      : `<button type="button" class="pmon pcard${k >= 0 ? ' on' : ''}" data-pick6="${i}"${blocked ? ' disabled' : ''}>${k >= 0 ? `<span class="pnum">${k + 1}${k < 2 ? ' · opens' : ''}</span>` : ''}${body}</button>`;
  };
  return `<div class="article"><h2>Team preview</h2>
      <p class="hint">Pick 6 of your ${V.builds[0].length} in order: the first two open the battle. At most ${COMPETITIVE.legendCap} legendary or mythical. The AI has already picked its 6 from its bring without seeing yours.</p></div>
    <div class="simcols">
      <section class="pteam"><h3>Your ${V.builds[0].length} <span class="hint">${picks.length} / ${COMPETITIVE.teamSize} picked</span></h3>${V.builds[0].map((b, i) => card(b, 0, i)).join('')}</section>
      <section class="pteam"><h3>AI's ${V.builds[1].length}${V.plans[1] ? ` <span class="hint">${esc(archetypeById(V.plans[1]).name)}</span>` : ''}</h3>${V.builds[1].map((b, i) => card(b, 1, i)).join('')}</section>
    </div>
    <div class="row">
      <button type="button" id="plock" class="primary"${picks.length === COMPETITIVE.teamSize ? '' : ' disabled'}>Battle with these 6</button>
      <button type="button" id="psuggest" title="Let the draft AI pick for you">Suggest a 6</button>
      <button type="button" id="pclearpicks"${picks.length ? '' : ' disabled'}>Clear picks</button>
      <button type="button" id="psetup">Change teams</button>
    </div>
    ${V.hint ? `<details class="pdraftlog" open><summary>Why this 6</summary>${draftLog(V.hint)}</details>` : ''}`;
}

function renderPlay() {
  const el = $('#play');
  if (!roster.length || !moves.length) { el.innerHTML = '<p class="hint">Loading the roster…</p>'; return; }
  ensureData();
  const o = P.opts;
  o.teams = [0, 1].map(s => (o.teams[s] || []).slice(0, o.size));
  o.comp = [0, 1].map(s => (o.comp?.[s] || []).slice(0, o.bring));
  if (!o.arch) o.arch = [null, null];
  el.innerHTML = `<div class="article simhead"><h1>Battle vs AI</h1>
      <p class="lead">Pick your team and the AI's team, then battle the simulator's AI one turn at a time.</p>
      <p class="hint">Same rules as the <a href="#sim">Battle simulator</a>: the type chart, damage formula, abilities, status and field effects. The AI is the one the simulator uses, and in battle it can see both teams.</p></div>
    ${P.battle ? battleView() : P.preview ? previewView() : setupView()}`;
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
  if (b.id === 'pstart') { P.msg = ''; return start(); }
  if (b.id === 'psetup') { P.battle = null; P.preview = null; return draw(); }
  if (b.id === 'prematch') { G.seed = Math.floor(Math.random() * 1e9); G.choices = []; return step(); }
  if (b.id === 'pforfeit') { P.battle = null; if (!G.comp) P.preview = null; return draw(); }
  if (b.id === 'predraft') { P.battle = null; return draw(); }
  const V = P.preview;
  if (V && !G) {
    if (d.pick6 != null) { const i = +d.pick6, k = V.picks.indexOf(i); if (k >= 0) V.picks.splice(k, 1); else V.picks.push(i); return draw(); }
    if (b.id === 'pclearpicks') { V.picks = []; V.hint = null; return draw(); }
    if (b.id === 'psuggest') { suggestPicks(); return draw(); }
    if (b.id === 'plock') return lockIn();
  }
  if (d.allai) { teamOf(+d.allai).forEach(s => s && Object.assign(s, AI_TRAIN)); save(); return draw(); }
  if (b.id === 'pundo') { G.choices.pop(); P.target = null; return step(); }
  if (d.random) { randomTeam(+d.random); save(); return draw(); }
  if (d.clear) { setTeam(+d.clear, []); save(); return draw(); }
  if (d.reroll) { const [s, i] = at(d.reroll), t = teamOf(s); t[i] = { ...fillSlot(t[i].key), ...train(t[i]) }; save(); return draw(); }
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
    o[t.name] = ['size', 'level', 'hpScale', 'bring'].includes(t.name) ? +t.value : t.value;
    if (t.name === 'format') o.size = Math.max(o.size, o.format === 'duos' ? 2 : 1);
    if (t.name === 'forms') for (const k of ['teams', 'comp']) o[k] = o[k].map(tm => tm.map(s => s && playable().some(x => x.key === s.key) ? s : null));
    save(); return draw();
  }
  const d = t.dataset;
  if (d.preset) {
    const side = +d.preset;
    P.msg = '';
    if (t.value === 'random') randomTeam(side);
    else if (t.value === 'arch') {
      const ids = ARCHETYPES.map(a => a.id).sort(() => Math.random() - 0.5);
      if (!ids.some(id => archetypeTeam(side, id))) P.msg = 'No archetype team fits these settings.';
    } else if (t.value && !archetypeTeam(side, t.value)) P.msg = `There aren't enough ${archetypeById(t.value).name} characters with these settings to build that team.`;
    save(); return draw();
  }
  if (d.pick) { const [s, i] = at(d.pick); teamOf(s)[i] = t.value ? fillSlot(t.value) : null; save(); return draw(); }
  if (d.ab) { const [s, i] = at(d.ab); teamOf(s)[i].ability = t.value; save(); return draw(); }
  if (d.mv) { const [s, i, k] = at(d.mv); teamOf(s)[i].moves[k] = t.value; save(); return draw(); }
  if (d.nat) { const [s, i] = at(d.nat); teamOf(s)[i].nature = t.value; save(); return draw(); }
  if (d.item) { const [s, i] = at(d.item); teamOf(s)[i].item = t.value; save(); return draw(); }
  for (const kind of ['evs', 'ivs']) {
    const sel = d[kind + 'p'], num = d[kind.slice(0, 2)];
    if (sel == null && num == null) continue;
    const [s, i] = at(sel ?? num), slot = teamOf(s)[i];
    const shown = () => { const b = compBuilds(teamOf(s), false)[i]; return kind === 'evs' ? { ...zero(), ...b.evs } : { ...Object.fromEntries(STAT_KEYS.map(x => [x, TRAINING.ivMax])), ...b.ivs }; };
    if (sel != null) {
      const v = t.value;
      slot[kind] = v === 'ai' || v === 'random' ? v : v === 'custom' ? (typeof slot[kind] === 'object' ? slot[kind] : shown()) : kind === 'evs' ? presetEvs(slot, v) : presetIvs(slot, v);
    } else {
      // a typed value turns the stats into a custom spread, starting from what was shown
      const cur = typeof slot[kind] === 'object' ? { ...slot[kind] } : slot[kind] === 'random' ? (kind === 'evs' ? zero() : shown()) : shown();
      const key = num.split(':')[2];
      const rest = STAT_KEYS.reduce((n, x) => n + (x === key ? 0 : cur[x]), 0);
      const max = kind === 'evs' ? Math.min(TRAINING.evMax, TRAINING.evTotal - rest) : TRAINING.ivMax;
      cur[key] = Math.max(0, Math.min(max, Math.floor(+t.value || 0)));
      slot[kind] = cur;
    }
    save(); return draw();
  }
});

draw();
