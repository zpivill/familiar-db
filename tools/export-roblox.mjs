// Exports game data for the Roblox game (familiar-game repo) as JSON files.
// Rojo turns each .json file into a ModuleScript that returns the data, so the game reads it with require().
// Usage: node tools/export-roblox.mjs [outDir]   (default export/roblox; for the game: <game repo>/src/shared/Data)
// Hidden dev roles and balance notes are left out, and the script fails if any reach the output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepare } from '../sim/battle.js';
import { TYPES, CHART, RULES, COMPETITIVE, TRAINING, STAT_KEYS, STAT_NAMES, ITEMS, ITEM_NUM } from '../sim/rules.js';
import { moveFlags } from '../sim/compile.js';

const root = new URL('..', import.meta.url).pathname;
const read = f => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const characters = read('characters.json');
const moveList = read('moves.json').moves;
const wiki = read('wiki.json');
const out = process.argv[2] || join(root, 'export/roblox');

// Keys that are for balancers or designers only. Checked recursively on everything written.
const DEV_KEYS = ['roles', 'roleNote', 'like', 'why', 'source', 'unsupported'];
// A Set (an ability's block list) becomes { key: true }: JSON has no sets, and Luau reads this as one.
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => DEV_KEYS.includes(k) ? undefined : v instanceof Set ? Object.fromEntries([...v].map(x => [x, true])) : v));

// Compiled rules (fx / ab) go along with the text, so the Luau engine runs exactly what the JS sim runs.
const { moves, entrants } = prepare(characters, moveList);

// n keeps the moves.json order (Metronome picks by it); flags are the move's own, for a move used without a learnset entry.
const Moves = {};
let n = 0;
for (const m of moves.values()) {
  const { cat, ...rest } = m; // cat duplicates category
  Moves[m.id] = { ...rest, n: n++, flags: moveFlags(m, []) };
}

const Familiars = {};
for (const e of entrants) {
  const c = characters[e.ci];
  Familiars[e.key] = {
    key: e.key, id: e.cid, form: e.j + 1, final: e.final, evolvesAt: c.stages[e.j].level,
    name: e.name, charName: e.charName, anime: e.anime, rarity: e.rarity, villain: e.villain, gag: e.gag, early: !!c.early,
    types: e.types, stats: e.stats, signature: e.sig, learn: e.learn, abilities: e.abilities,
  };
}

const Rules = { TYPES, CHART, RULES, COMPETITIVE, TRAINING, STAT_KEYS, STAT_NAMES, ITEMS, ITEM_NUM };

// City 1: the event script and the Fray tables. Places, trainers and people are prose on the site
// and get built in Studio by hand, so they are not exported.
const byName = new Map();
for (const e of entrants) { byName.set(e.name, e.key); if (!byName.has(e.charName)) byName.set(e.charName, e.key); }
const page = wiki.pages.find(p => p.id === 'city-reykjavik');
const events = page.sections.find(s => s.title === 'Event script').items.map(({ t, n, when, where, who, lines }) => ({ title: t, text: n, when, where, who, lines: lines || [] }));
const frays = {};
for (const s of page.sections.filter(s => s.rows && s.cols.includes('Character'))) {
  const ci = s.cols.indexOf('Character'), ri = s.cols.indexOf('How often');
  frays[s.title] = s.rows.map(r => {
    const key = byName.get(r[ci]);
    if (!key) throw new Error(`${s.title}: no familiar named "${r[ci]}"`);
    return { familiar: key, rate: r[ri] };
  });
}
const City1 = { id: 'city-reykjavik', name: page.title, events, frays };

// Checks: every learned move and signature exists, no dev keys reach the game.
for (const f of Object.values(Familiars)) {
  for (const l of f.learn) if (!Moves[l.id]) throw new Error(`${f.key} learns missing move ${l.id}`);
  if (f.signature && !Moves[f.signature.id]) throw new Error(`${f.key} has missing signature ${f.signature.id}`);
}
const files = { Moves, Familiars, Rules, City1 };
mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  const json = JSON.stringify(strip(data));
  for (const k of DEV_KEYS) if (json.includes(`"${k}":`)) throw new Error(`${name}: dev key "${k}" in output`);
  writeFileSync(join(out, name + '.json'), json + '\n');
  console.log(`${name}.json  ${(json.length / 1024).toFixed(0)} KB`);
}
console.log(`${Object.keys(Familiars).length} familiars, ${Object.keys(Moves).length} moves, ${events.length} events, ${Object.keys(frays).length} Fray tables -> ${out}`);
