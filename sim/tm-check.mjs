// Checks the TM/HM proposal (docs/tm-hm-proposal.json) against the game data. Nothing here changes data/.
//   node sim/tm-check.mjs                 check every character-move pair; exits non-zero on a failure
//   node sim/tm-check.mjs --pairs=f.txt   also write "key move" lines (one per form that learns it) [--demo adds the demo moves]
//   node sim/tm-check.mjs --patch=dir     also write characters.json with the Patterns added to learnsets into dir
//                                         (a scratch copy for sim tests; refuses to write into the repo's data/)
//   node sim/tm-check.mjs --md            print the compatibility tables as Markdown
// The pair test (test 1 in docs/TM-HM.md): the character must not already have the move in any form, and must not
// have a near-copy of it, in its learnsets or as a signature. A near-copy is:
//   attacks: same type and category, same role (single target / spread, priority, switches out) and power within 10 (a guaranteed stat drop counts as a different role);
//   status moves: the same job (raises the same stats, heals, the same status, the same screen or field, Protect...).
import fs from 'fs';
import path from 'path';
import { prepare } from './battle.js';

const here = new URL('..', import.meta.url);
const read = f => JSON.parse(fs.readFileSync(new URL(f, here)));
const chars = read('data/characters.json'), moves = read('data/moves.json').moves, P = read('docs/tm-hm-proposal.json');
const data = prepare(chars, moves);
const arg = n => { const a = process.argv.find(x => x === '--' + n || x.startsWith('--' + n + '=')); return a ? (a.split('=')[1] ?? true) : null; };

const byId = new Map(chars.map(c => [c.id, c]));
const keyOf = (c, i) => i ? `${c.id}/${i + 1}` : c.id;

// what job a move does, for the near-copy test
export function role(m) {
  const fx = m.fx || {};
  if (m.category !== 'Status') {
    // a guaranteed stat drop on the target (Rock Tomb's Speed drop) is a different job from a plain hit
    const sure = (fx.boosts || []).filter(b => b.who !== 'self' && b.p === 1).flatMap(b => Object.keys(b.stats)).sort().join('+');
    return ['atk', m.type, m.category, fx.spread ? 'spread' : 'single', (m.priority || 0) > 0 ? 'pri' : '', fx.switchOut ? 'pivot' : '', sure].join('|');
  }
  const self = (fx.boosts || []).filter(b => b.who === 'self').flatMap(b => Object.entries(b.stats).filter(([, v]) => v > 0).map(([k]) => k)).sort().join('+');
  const foe = (fx.boosts || []).filter(b => b.who !== 'self' && b.who !== 'ally' && b.who !== 'team').flatMap(b => Object.entries(b.stats).filter(([, v]) => v < 0).map(([k]) => k)).sort().join('+');
  if (self) return 'boost|' + self;
  if (foe) return 'drop|' + foe;
  if (fx.heal) return 'heal';
  if (fx.status) return 'status|' + fx.status.kind;
  if (fx.screen) return 'screen|' + fx.screen;
  if (fx.field) return 'field|' + Object.keys(fx.field).filter(k => k !== 'turns').sort().join('+');
  const keys = Object.keys(fx).filter(k => k !== 'unsupported').sort().join('+');
  return 'st|' + (keys || m.id);
}
export function nearCopy(a, b) {
  if (a.id === b.id) return true;
  if (role(a) !== role(b)) return false;
  if (a.category === 'Status') return true;
  return Math.abs((a.power || 0) - (b.power || 0)) <= 10;
}
// every move a character has in any form, signatures included
function known(c) {
  const out = new Map();
  c.stages.forEach((s, i) => {
    for (const l of s.learn || []) if (!out.has(l.move)) out.set(l.move, `form ${i + 1}`);
    if (s.signature) out.set(s.signature, `form ${i + 1} signature`);
  });
  return out;
}
export function pairProblem(c, moveId) {
  const m = data.moves.get(moveId);
  if (!m) return `no move ${moveId}`;
  for (const [id, where] of known(c)) {
    const k = data.moves.get(id);
    if (!k) continue;
    if (id === moveId) return `already has ${m.name} (${where})`;
    if (nearCopy(m, k)) return `near-copy of ${k.name} (${where}: ${k.type} ${k.category}${k.power ? ' ' + k.power : ''})`;
  }
  return null;
}
const HEALS = c => [...known(c).keys()].some(id => data.moves.get(id)?.fx?.heal);

// the pairs of a Pattern: [{ c, from, why }]
function learners(p) {
  if (p.rule === 'all' || p.rule === 'rest') {
    return chars.filter(c => !(p.cannot || {})[c.id] && !pairProblem(c, p.move) && !(p.rule === 'rest' && HEALS(c))).map(c => ({ c, from: 0, why: p.rule === 'all' ? 'universal' : 'by rule' }));
  }
  return Object.entries(p.can || {}).map(([k, why]) => { const [id, f] = k.split('/'); return { c: byId.get(id), id, from: f ? +f - 1 : 0, why }; });
}

let bad = 0, pairs = 0;
const fail = s => { bad++; console.log('FAIL ' + s); };
const all = [];   // { key, move }
const table = [];
for (const p of P.patterns) {
  const m = data.moves.get(p.move);
  if (!m) { fail(`P${p.no}: no move ${p.move}`); continue; }
  const L = learners(p);
  for (const l of L) {
    if (!l.c) { fail(`P${p.no} ${m.name}: no character ${l.id}`); continue; }
    if (l.from >= l.c.stages.length) { fail(`P${p.no} ${m.name}: ${l.c.id} has no form ${l.from + 1}`); continue; }
    const why = pairProblem(l.c, p.move);
    if (why) { fail(`P${p.no} ${m.name} on ${l.c.id}: ${why}`); continue; }
    pairs++;
    l.c.stages.forEach((s, i) => { if (i >= l.from) all.push({ key: keyOf(l.c, i), move: p.move, c: l.c, i }); });
  }
  for (const id of Object.keys(p.cannot || {})) {
    if (!byId.has(id.split('/')[0])) fail(`P${p.no} ${m.name}: cannot-list has no character ${id}`);
    if ((p.can || {})[id]) fail(`P${p.no} ${m.name}: ${id} is on both lists`);
  }
  table.push({ p, m, L });
}
const demo = [];
for (const d of P.demo || []) for (const k of d.on) {
  const [id, f] = k.split('/'); const c = byId.get(id);
  if (!c || !data.moves.get(d.move)) { fail(`demo ${d.move} on ${k}`); continue; }
  if (known(c).has(d.move)) { fail(`demo ${d.move} on ${k}: already has it`); continue; }
  const i = f ? +f - 1 : c.stages.length - 1;
  demo.push({ key: keyOf(c, i), move: d.move, c, i, from: i });
}
for (const f of P.field || []) for (const id of Object.keys(f.cannot || {})) if (!byId.has(id.split('/')[0])) fail(`field ${f.name}: no character ${id}`);

console.log(`${P.patterns.length} Patterns, ${pairs} character-move pairs (${all.length} with forms), ${(P.field || []).length} field techniques`);

if (arg('pairs')) {
  const list = arg('demo') ? [...all, ...demo] : all;
  fs.writeFileSync(arg('pairs'), list.map(x => `${x.key} ${x.move}`).join('\n') + '\n');
  console.log(`wrote ${list.length} pairs to ${arg('pairs')}`);
}
if (arg('patch')) {
  const dir = path.resolve(arg('patch'));
  if (dir === path.resolve(new URL('data', here).pathname)) { console.error('refusing to write into the repo data/ folder'); process.exit(2); }
  const only = arg('only') ? new Set(String(arg('only')).split(',')) : null;   // --only=move,move
  const out = JSON.parse(JSON.stringify(chars));
  const idx = new Map(out.map(c => [c.id, c]));
  let n = 0;
  for (const x of [...all, ...(arg('demo') ? demo : [])]) {
    if (only && !only.has(x.move)) continue;
    const s = idx.get(x.c.id).stages[x.i];
    // a demo move goes on later forms too, so the form tested keeps it
    if (!s.learn.some(l => l.move === x.move)) { s.learn.push({ lv: 1, move: x.move }); n++; }
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'characters.json'), JSON.stringify(out, null, 2));
  console.log(`wrote ${n} learnset entries to ${path.join(dir, 'characters.json')}`);
}
if (arg('md')) {
  const nm = c => c.name;
  for (const { p, m, L } of table) {
    console.log(`\n#### P${String(p.no).padStart(2, '0')} ${m.name} (${m.type}${m.power ? ', ' + m.category.toLowerCase() + ' ' + m.power : ', status'}), band ${p.band}\n`);
    console.log(`${p.why} *Source:* ${p.source}\n`);
    if (p.rule) console.log(`**Can:** ${p.rule === 'all' ? 'everyone who does not already have it' : 'everyone except characters with a healing move and the ones below'} (${L.length} characters).\n`);
    else { console.log('| Can | Why |\n|---|---|'); for (const l of L) console.log(`| ${nm(l.c)}${l.from ? ` (from form ${l.from + 1})` : ''} | ${l.why} |`); console.log(''); }
    const cn = Object.entries(p.cannot || {});
    if (cn.length) { console.log('| Cannot | Why |\n|---|---|'); for (const [id, why] of cn) console.log(`| ${nm(byId.get(id.split('/')[0]))} | ${why} |`); }
  }
}
if (bad) { console.log(`${bad} failed`); process.exit(1); }
console.log('all pairs passed the learnset and near-copy check');
