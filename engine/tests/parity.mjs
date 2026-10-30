// Runs the same single-thread batch in JS and Rust and compares the totals:  node engine/tests/parity.mjs [count] [format] [seed] [--draft] [--hp=3]
import fs from 'fs';
import { execFileSync } from 'child_process';
import { prepare } from '../../sim/battle.js';
import { runBatch } from '../../sim/batch.js';
import { RULES } from '../../sim/rules.js';

const here = new URL('../../', import.meta.url);
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = n => process.argv.find(a => a.startsWith('--' + n + '='))?.split('=')[1] ?? (process.argv.includes('--' + n) ? true : undefined);
const [count = '50', format = 'comp', seed = '1'] = args;
const data = prepare(JSON.parse(fs.readFileSync(new URL('data/characters.json', here))), JSON.parse(fs.readFileSync(new URL('data/moves.json', here))).moves);
if (flag('hp')) RULES.hpScale = +flag('hp');
const opts = { format, count: +count, seed: +seed, ...(flag('draft') ? { draft: true, bring: +flag('bring') || 8 } : {}), ...(flag('forms') ? { forms: flag('forms') } : {}), ...(flag('trained') ? { training: 'ai', items: 'ai' } : {}) };
let t = Date.now();
const J = runBatch(data, opts);
const jsMs = Date.now() - t;
const bin = new URL('target/release/familiar-sim', new URL('../', import.meta.url)).pathname;
t = Date.now();
const R = JSON.parse(execFileSync(bin, ['batch', count, format, seed, ...process.argv.slice(2).filter(a => a.startsWith('--'))], { cwd: new URL('../', import.meta.url).pathname, maxBuffer: 1 << 28 }));
const rsMs = Date.now() - t;
let bad = 0;
const cmp = (path, a, b) => {
  if (typeof a === 'number' || typeof b === 'number') { if (Math.abs((a || 0) - (b || 0)) > 1e-6 * Math.max(1, Math.abs(a || 0))) { if (bad++ < 20) console.log('differs', path, a, b); } return; }
  if (a && typeof a === 'object' || b && typeof b === 'object') for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) cmp(path + '.' + k, a?.[k], b?.[k]);
};
cmp('', J, R);
console.log(`${J.battles} battles: JS ${jsMs} ms, Rust ${rsMs} ms; ${bad ? bad + ' differences' : 'identical'}`);
process.exit(bad ? 1 : 0);
