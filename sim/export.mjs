// Writes the compiled game data (moves with their effects read from text, abilities as rules, archetype
// rosters) as one JSON file for the Rust engine in engine/, which doesn't read the move texts itself.
//   node sim/export.mjs [out = engine/data.json]
// Run it again after any change to data/ (the Rust CLI checks and says so).
import fs from 'fs';
import { prepare } from './battle.js';
import { ARCHETYPES, roster } from './archetypes.js';
import { moveFlags } from './compile.js';

const here = new URL('..', import.meta.url);
const read = f => JSON.parse(fs.readFileSync(new URL(f, here)));
const chars = read('data/characters.json'), moveList = read('data/moves.json').moves;
const data = prepare(chars, moveList);
const ab = a => a && { ...a, block: [...a.block], unsupported: undefined };
const out = {
  // the Rust CLI compares this with the data files to tell when the export is stale
  source: fs.statSync(new URL('data/characters.json', here)).size + ':' + fs.statSync(new URL('data/moves.json', here)).size,
  moves: [...data.moves.values()].map(m => ({ id: m.id, name: m.name, type: m.type, cat: m.cat, size: m.size || null, power: m.power || 0,
    accuracy: m.accuracy ?? null, pp: m.pp || 5, priority: m.priority || 0, signature: m.signature === true, isSig: !!m.signature, flags: moveFlags(m, []), fx: { ...m.fx, unsupported: undefined } })),
  entrants: data.entrants.map(e => ({ ...e, anime: undefined, roles: undefined, abilities: e.abilities.map(a => ({ name: a.name, ab: ab(a.ab) })) })),
  archetypes: ARCHETYPES.map(a => { const R = roster(data, a, data.entrants); return { id: a.id, name: a.name, setters: Object.fromEntries(R.setters), abusers: Object.fromEntries(R.abusers) }; }),
};
const file = process.argv[2] || new URL('engine/data.json', here);
fs.writeFileSync(file, JSON.stringify(out));
console.log(`wrote ${out.moves.length} moves, ${out.entrants.length} entrants to ${file instanceof URL ? file.pathname : file}`);
