// Run a batch from the command line:  node sim/cli.mjs [count] [duel|team|duos] [seed]
// Prints the top and bottom characters by win rate and how long it took.
import fs from 'fs';
import { prepare } from './battle.js';
import { runBatch, watchBattle } from './batch.js';

const here = new URL('..', import.meta.url);
const chars = JSON.parse(fs.readFileSync(new URL('data/characters.json', here)));
const moves = JSON.parse(fs.readFileSync(new URL('data/moves.json', here))).moves;
const [count = '1000', format = 'duel', seed = '1', watch] = process.argv.slice(2);
const data = prepare(chars, moves);
if (watch) {
  const w = watchBattle(data, { format, seed: +seed });
  console.log(JSON.stringify(w.teams, null, 1));
  console.log(w.log.join('\n'));
  console.log('winner', w.winner, 'turns', w.turns);
  process.exit(0);
}
const t0 = Date.now();
const S = runBatch(data, { count: +count, format, seed: +seed });
const ms = Date.now() - t0;
const rows = Object.entries(S.ent).map(([k, v]) => [k, v.w / v.g, v.g]).sort((a, b) => b[1] - a[1]);
console.log(`${S.battles} battles in ${ms} ms (${(ms / S.battles).toFixed(2)} ms each), avg ${(S.turns / S.battles).toFixed(1)} turns, ${S.draws} draws`);
console.log('top', rows.slice(0, 12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
console.log('bottom', rows.slice(-12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
