// Run a batch from the command line:  node sim/cli.mjs [count] [duel|team|duos] [seed] [watch]
// Flags: --trained (AI-chosen EVs, nature, IVs and held items), --level=50, --size=4,
// --draft (comp only: bring 10 and draft 6), --bring=8
// Prints the top and bottom characters by win rate and how long it took.
import fs from 'fs';
import { prepare } from './battle.js';
import { runBatch, watchBattle } from './batch.js';

const here = new URL('..', import.meta.url);
const chars = JSON.parse(fs.readFileSync(new URL('data/characters.json', here)));
const moves = JSON.parse(fs.readFileSync(new URL('data/moves.json', here))).moves;
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = n => process.argv.find(a => a.startsWith('--' + n))?.split('=')[1] ?? (process.argv.includes('--' + n) ? true : undefined);
const [count = '1000', format = 'duel', seed = '1', watch] = args;
const extra = { ...(flag('trained') ? { training: 'ai', items: 'ai' } : {}), ...(flag('level') ? { level: +flag('level') } : {}), ...(flag('size') ? { teamSize: +flag('size') } : {}), ...(flag('draft') ? { draft: true, bring: +flag('bring') || 10 } : {}) };
const data = prepare(chars, moves);
if (watch) {
  const w = watchBattle(data, { format, seed: +seed, ...extra });
  if (w.drafts) w.drafts.forEach((d, s) => console.log(`--- side ${s ? 'B' : 'A'} draft ---\n` + d.log.join('\n')));
  else console.log(JSON.stringify(w.teams, null, 1));
  console.log(w.log.join('\n'));
  console.log('winner', w.winner, 'turns', w.turns);
  process.exit(0);
}
const t0 = Date.now();
const S = runBatch(data, { count: +count, format, seed: +seed, ...extra });
const ms = Date.now() - t0;
const rows = Object.entries(S.ent).map(([k, v]) => [k, v.w / v.g, v.g]).sort((a, b) => b[1] - a[1]);
console.log(`${S.battles} battles in ${ms} ms (${(ms / S.battles).toFixed(2)} ms each), avg ${(S.turns / S.battles).toFixed(1)} turns, ${S.draws} draws`);
console.log('top', rows.slice(0, 12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
console.log('bottom', rows.slice(-12).map(r => `${r[0]} ${(r[1] * 100).toFixed(0)}% (${r[2]})`).join(', '));
