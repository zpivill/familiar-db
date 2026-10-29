// Web Worker for the Simulator page: runs battles off the main thread and posts running totals.
import { prepare } from './battle.js';
import { runBatch, watchBattle } from './batch.js';
import { RULES, ITEMS, NATURES, natureName, TYPES, TRAINING } from './rules.js';
import { PRESETS } from './builds.js';
import { ARCHETYPES } from './archetypes.js';

let data = null;

self.onmessage = ({ data: msg }) => {
  try {
    if (msg.cmd === 'init') {
      data = prepare(msg.characters, msg.moves);
      const unsupported = [];
      for (const m of data.moves.values()) for (const s of m.fx.unsupported) unsupported.push({ kind: 'move', name: m.name, id: m.id, text: s });
      for (const e of data.entrants) for (const a of e.abilities) for (const s of a.ab.unsupported) unsupported.push({ kind: 'ability', name: a.name, id: e.key, text: s });
      self.postMessage({
        type: 'ready',
        entrants: data.entrants.map(e => ({ key: e.key, cid: e.cid, name: e.name, charName: e.charName, rarity: e.rarity, types: e.types, stats: e.stats, total: e.total, final: e.final, gag: e.gag, villain: e.villain, abilities: e.abilities.map(a => ({ name: a.name, hidden: a.hidden })) })),
        moves: [...data.moves.values()].map(m => ({ id: m.id, name: m.name, type: m.type, cat: m.category, power: m.power, size: m.size, sig: !!m.signature, owner: m.owner })),
        unsupported,
        items: ITEMS, types: TYPES, training: TRAINING, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.name])),
        natures: NATURES.map(n => ({ id: n, name: natureName(n) })),
        archetypes: ARCHETYPES.map(a => ({ id: a.id, name: a.name, note: a.note })),
      });
    }
    if (msg.cmd === 'run') {
      Object.assign(RULES, msg.rules || {});
      runBatch(data, { ...msg.opts, chunk: msg.chunk || 250 }, (stats, done) => self.postMessage({ type: 'progress', id: msg.id, stats, done }));
      self.postMessage({ type: 'done', id: msg.id });
    }
    if (msg.cmd === 'watch') {
      Object.assign(RULES, msg.rules || {});
      self.postMessage({ type: 'watch', result: watchBattle(data, msg.opts) });
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: msg.id, message: String(e && e.stack || e) });
  }
};
