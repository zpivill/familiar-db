// The battle engine: one battle, start to finish, with no DOM. Runs the same in a Web Worker and in Node.
// Rules and numbers come from rules.js; move and ability effects come from compile.js.

import { RULES, TYPES, typeEff, battleStat, stageMult } from './rules.js';
import { compileMove, compileAbility, moveFlags } from './compile.js';
import { chooseAction, chooseReplacement } from './ai.js';

const STATS = ['pow', 'grd', 'ene', 'wil', 'spe'];
const NO_AB = compileAbility({ name: 'None', text: '' });

// Small fast seeded random numbers, so a batch can be replayed from its seed.
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  return r;
}

// ---------------- data preparation ----------------

// Every form becomes an entrant with its learnable moves and compiled abilities.
export function prepare(characters, moveList) {
  const moves = new Map();
  for (const m of moveList) moves.set(m.id, { ...m, fx: compileMove(m), cat: m.category, priority: m.priority || 0 });
  const entrants = [];
  characters.forEach((c, ci) => c.stages.forEach((s, j) => {
    const abilities = (s.abilities || c.abilities || []).map(a => ({ name: a.name, hidden: !!a.hidden, text: a.text, ab: compileAbility(a) }));
    const learn = new Map();
    for (const l of s.learn || []) {
      const m = moves.get(l.move);
      if (!m || learn.has(l.move)) continue;
      learn.set(l.move, { id: l.move, lv: l.lv === 'evo' ? (s.level || 1) : l.lv, as: l.as || m.name, flags: moveFlags(m, [l.as || '']) });
    }
    const sig = moves.get(s.signature);
    entrants.push({
      key: c.id + (j ? '/' + (j + 1) : ''), cid: c.id, ci, j, final: j === c.stages.length - 1,
      name: s.name || c.name, charName: c.name, anime: c.anime, rarity: c.rarity || '', villain: !!c.villain, gag: !!c.gag,
      types: s.types, stats: s.stats, total: STATS.concat('vit').reduce((n, k) => n + (s.stats?.[k] || 0), 0),
      sig: sig ? { id: sig.id, as: sig.name, flags: moveFlags(sig, []) } : null,
      learn: [...learn.values()], abilities, roles: c.roles || [],
    });
  }));
  return { moves, entrants };
}

// ---------------- battlers ----------------

function makeMon(data, e, build, level) {
  const st = e.stats;
  const mon = {
    e, key: e.key, name: e.name, level, types: [...e.types],
    maxhp: battleStat(st.vit, level, true), raw: {},
    ability: build.ability.ab, abilityName: build.ability.name, baseAbility: build.ability.ab,
    moves: build.moves.map(l => {
      const m = data.moves.get(l.id);
      return { id: l.id, m, as: l.as, flags: l.flags, pp: m.pp || 5, sig: m.signature === true };
    }),
    status: null, statusTurns: 0, bleedN: 0, boosts: {}, vol: {}, once: {}, pending: null, fainted: false,
    t: { dmg: 0, taken: 0, kos: 0, turns: 0, entries: 0, moves: {} },
  };
  STATS.forEach(k => { mon.raw[k] = battleStat(st[k], level, false); mon.boosts[k] = 0; });
  mon.hp = mon.maxhp;
  return mon;
}

// ---------------- the battle ----------------

export function runBattle(data, teams, opts = {}) {
  const r = opts.rng || rng(opts.seed || 1);
  const level = opts.level || RULES.level;
  const duos = opts.format === 'duos';
  const B = {
    r, duos, turn: 0, field: null, log: opts.log ? [] : null, over: false, winner: -1,
    sides: teams.map((team, i) => ({
      i, mons: team.map(b => makeMon(data, b.e, b, level)), active: [],
      hazards: { rocks: 0, spikes: 0, web: 0, rainbow: 0 }, screens: {}, tailwind: 0, wish: null, chip: null, drain: null,
      futures: [], faintTurn: -9, timeStop: -1, gift: null,
    })),
  };
  B.sides.forEach(s => s.mons.forEach(m => { m.side = s; }));
  const say = opts.log ? (...a) => B.log.push(`[${B.turn}] ` + a.join(' ')) : () => {};
  B.say = say;

  const foeSide = s => B.sides[1 - s.i];
  const alive = s => s.mons.filter(m => !m.fainted);
  const bench = s => s.mons.filter(m => !m.fainted && !s.active.includes(m));
  const actives = s => s.active.filter(m => m && !m.fainted);
  const foesOf = m => actives(foeSide(m.side));
  const allyOf = m => actives(m.side).find(x => x !== m);
  const abOf = m => (m.vol.suppressed > 0 ? NO_AB : m.ability);
  // A defender's ability, unless the attacker or move ignores abilities.
  const defAb = (t, u, mv) => (u && (abOf(u).moldBreaker || mv?.m.fx.ignoreAbility || (mv?.sig && abOf(u).sigBypass))) ? NO_AB : abOf(t);
  const pct = m => m.hp / m.maxhp;
  const blocks = (m, k) => abOf(m).block.has(k);

  // ---- stats ----
  // noBoost: a foe with Target Lock ignores raised Speed when working out who moves first.
  const speed = (m, noBoost) => {
    const a = abOf(m);
    let s = m.raw.spe * (a.statMult?.spe || 1) * stageMult(noBoost ? Math.min(0, m.boosts.spe) : m.boosts.spe);
    if (m.status === 'stun') s *= RULES.stun.speed;
    if (m.side.tailwind > 0) s *= 2;
    if (B.field?.foeSlow && B.field.owner !== m.side.i) s *= 0.5;
    if (a.sandevistan && m.t.turnsIn < a.sandevistan) s *= 2;
    if (a.lowBattery && pct(m) < 0.25) s *= 2;
    if (a.slowStart && !m.once.hitTaken) s *= 0.8;
    return s;
  };

  const statMods = (m, k) => {
    const a = abOf(m);
    let x = a.statMult?.[k] || 1;
    if (a.slowStart && !m.once.hitTaken) x *= 0.8;
    if (k === 'pow') {
      if (a.eyepatch) x *= pct(m) < 0.5 ? 1.5 : 0.8;
      if (a.guts && m.status) x *= 1.5;
      if (a.sleepFighter && m.status === 'sleep') x *= 1.5;
    }
    return x;
  };

  // ---- logging helpers ----
  const nm = m => `${m.name} (${m.side.i ? 'B' : 'A'})`;

  // ---- stat stages ----
  function boost(m, stats, src, opts = {}) {
    if (!m || m.fainted) return false;
    const a = abOf(m);
    const byFoe = src && src.side !== m.side;
    let changed = false, dropped = false;
    for (const [k0, v0] of Object.entries(stats)) {
      let k = k0, v = v0;
      if (k === 'highest') { k = STATS.reduce((b, s) => m.raw[s] > m.raw[b] ? s : b, 'pow'); }
      if (!STATS.includes(k)) continue;
      if (a.contrary) v = -v;
      if (v < 0 && byFoe && (a.block.has('drops') || a.block.has('drop:' + k) || (opts.intimidate && a.block.has('intimidate')))) continue;
      const before = m.boosts[k];
      m.boosts[k] = Math.max(-6, Math.min(6, before + v));
      if (m.boosts[k] !== before) { changed = true; if (v < 0) dropped = true; }
    }
    if (changed) say(nm(m), 'stats', JSON.stringify(stats));
    if (dropped && byFoe && a.defiant) boost(m, { [a.defiant]: 2 }, m);
    return changed;
  }

  // ---- healing and damage ----
  function heal(m, amount, src) {
    if (!m || m.fainted || m.once.noHeal) return 0;
    let a = Math.floor(amount);
    if (src === 'move' && abOf(m).healMult) a = Math.floor(a * abOf(m).healMult);
    const h = Math.min(m.maxhp - m.hp, Math.max(0, a));
    m.hp += h;
    return h;
  }

  // Direct damage that is not an attack: recoil, chip, hazards.
  function hurt(m, amount, why, by) {
    if (!m || m.fainted || amount <= 0) return;
    const d = Math.min(m.hp, Math.max(1, Math.floor(amount)));
    m.hp -= d;
    m.t.taken += d;
    say(nm(m), 'loses', d, why || '');
    afterHp(m, by);
    if (m.hp <= 0) faint(m, by);
  }

  // One-time triggers that fire when Vitality crosses a line.
  function afterHp(m, by) {
    if (m.fainted || m.hp <= 0) return;
    const a = abOf(m);
    a.threshold.forEach((th, i) => {
      if (m.once['th' + i] || pct(m) >= th.below) return;
      m.once['th' + i] = true;
      for (const op of th.ops) {
        if (op.op === 'boost') boost(m, op.stats, m);
        if (op.op === 'heal') heal(m, m.maxhp * op.frac);
        if (op.op === 'cure') m.status = null;
        if (op.op === 'confuse') confuse(m, m);
        if (op.op === 'kakuja') m.vol.kakuja = true;
        if (op.op === 'sub' && !m.vol.sub) m.vol.sub = Math.floor(m.maxhp * op.frac);
        if (op.op === 'foes') foesOf(m).forEach(f => boost(f, op.stats, m));
        if (op.op === 'teamHeal') alive(m.side).forEach(x => heal(x, x.maxhp * op.frac));
        if (op.op === 'noHeal') m.once.noHeal = true;
      }
    });
    if (a.wimpOut && pct(m) < a.wimpOut && !m.once.wimped && bench(m.side).length) { m.once.wimped = true; m.vol.ejectNow = true; }
  }

  function faint(m, by) {
    if (m.fainted) return;
    const a = abOf(m);
    if (a.reviveOnce && !m.once.revived) { m.once.revived = true; m.hp = Math.floor(m.maxhp * a.reviveOnce); say(nm(m), 'comes back'); return; }
    m.hp = 0; m.fainted = true;
    say(nm(m), 'is knocked out');
    m.side.faintTurn = B.turn;
    if (by && by !== m && !by.fainted) {
      by.t.kos++;
      const ba = abOf(by);
      for (const op of ba.ko) {
        if (op.oneHit && !m.vol.oneHit) continue;
        if (op.op === 'boost') boost(by, op.stats, by);
        if (op.op === 'heal') heal(by, by.maxhp * op.frac);
        if (op.op === 'foes') foesOf(by).forEach(f => boost(f, op.stats, by));
        if (op.op === 'steal-ability') { by.ability = abOf(m); }
      }
      actives(by.side).forEach(x => { if (x !== by && abOf(x).allyKO) boost(x, abOf(x).allyKO, x); });
      for (const op of a.faint) {
        if (op.op === 'aftermath') hurt(by, by.maxhp * op.frac, 'from the knockout', m);
      }
      if (m.vol.destinyBond) { say('Destiny bond'); by.hp = 0; faint(by, m); }
    }
    for (const op of a.faint) {
      if (op.op === 'requiem') { alive(m.side).forEach(x => addPending(x, { pow: 1, grd: 1, ene: 1, wil: 1, spe: 1 })); foesOf(m).forEach(f => boost(f, { pow: -1, grd: -1, ene: -1, wil: -1, spe: -1 }, m)); }
      if (op.op === 'nextBoost') m.side.gift = { stats: op.stats };
    }
    alive(m.side).forEach(x => {
      for (const op of abOf(x).allyFaint) {
        if (op.op === 'boost') addPending(x, op.stats);
        if (op.op === 'heal') heal(x, x.maxhp * op.frac);
      }
    });
  }

  // A boost for a teammate: now if it is in battle, otherwise when it next comes in.
  function addPending(m, stats) {
    if (m.side.active.includes(m)) return boost(m, stats, m);
    m.pending = m.pending || {};
    for (const [k, v] of Object.entries(stats)) m.pending[k] = (m.pending[k] || 0) + v;
  }

  // ---- status ----
  function inflict(t, kind, src, opts = {}) {
    if (!t || t.fainted) return false;
    if (kind === 'tri') kind = r.pick(['burn', 'freeze', 'stun']);
    if (kind === 'confuse') return confuse(t, src);
    const a = src && src !== t ? defAb(t, src, opts.mv) : abOf(t);
    if (t.status || a.block.has(kind) || a.block.has('status') || (a.comatose && a.block.has('status'))) return false;
    if (opts.mv && opts.mv.m.fx && src !== t && t.vol.sub && !opts.mv.m.fx.breaksSub) return false;
    if (RULES.ownTypeStatusImmune && OWN_STATUS[kind] && t.types.includes(OWN_STATUS[kind])) return false;
    if (kind === 'sleep' && B.field?.noSleep) return false;
    if (kind === 'sleep' && opts.mv?.flags?.sound && a.block.has('soundSleep')) return false;
    t.status = kind;
    t.statusTurns = kind === 'sleep' ? (abOf(t).earlyBird ? 1 : r.int(...RULES.sleep.turns)) : kind === 'freeze' ? (opts.turns || RULES.freeze.maxTurns) : 0;
    t.bleedN = 0;
    if (opts.wakeConfuse) t.vol.wakeConfuse = true;
    say(nm(t), 'gets', kind);
    if (kind === 'sleep' && src && src !== t && abOf(src).sleepHeal) heal(src, src.maxhp * abOf(src).sleepHeal);
    return true;
  }
  const OWN_STATUS = { burn: 'Fire', freeze: 'Ice', stun: 'Lightning', bleed: 'Blood' };

  function confuse(t, src) {
    if (!t || t.fainted || t.vol.confuse > 0) return false;
    if (blocks(t, 'confuse') && src !== t) return false;
    t.vol.confuse = r.int(...RULES.confuse.turns);
    say(nm(t), 'is confused');
    return true;
  }

  // ---- switching ----
  function canSwitch(m) {
    if (blocks(m, 'trap')) return true;
    if (m.vol.trapped > 0 || m.vol.bind || m.vol.rampage || m.vol.charging) return false;
    for (const f of foesOf(m)) {
      const fa = abOf(f);
      if (fa.magnetPull && m.types.includes(fa.magnetPull)) return false;
      if (fa.lowTrap && pct(m) < fa.lowTrap) return false;
    }
    return true;
  }

  function switchOut(m, opts = {}) {
    const s = m.side, a = abOf(m);
    if (a.regenerator && !m.fainted) heal(m, m.maxhp * a.regenerator);
    if (a.switchGift && !m.fainted) s.gift = a.switchGift;
    if (opts.baton) s.baton = { boosts: { ...m.boosts }, sub: m.vol.sub };
    if (!opts.keepBleed) m.bleedN = 0;
    m.vol = {}; m.ability = m.baseAbility; m.types = [...m.e.types];
    STATS.forEach(k => { m.boosts[k] = 0; });
    const slot = s.active.indexOf(m);
    s.active[slot] = null;
    return slot;
  }

  function switchIn(m, slot, how) {
    const s = m.side;
    s.active[slot] = m;
    m.vol = { entryTurn: B.turn };
    m.t.entries++; m.t.turnsIn = 0;
    m.once.dodgeEntry = false; m.once.disguiseEntry = false; m.once.quickDrawn = false;
    say(nm(m), 'comes in');
    if (s.baton) { Object.assign(m.boosts, s.baton.boosts); if (s.baton.sub) m.vol.sub = s.baton.sub; s.baton = null; }
    if (m.pending) { boost(m, m.pending, m); m.pending = null; }
    if (s.gift) { if (s.gift.heal) heal(m, m.maxhp * s.gift.heal); if (s.gift.stats) boost(m, s.gift.stats, m); s.gift = null; }
    const a = abOf(m);
    // hazards
    if (!a.block.has('hazards')) {
      const grounded = !a.immune.some(x => x.type === 'Earth') || B.field?.gravity;
      if (s.hazards.rocks) hurt(m, m.maxhp / 8 * typeEff('Earth', m.types), 'from rocks');
      if (s.hazards.rainbow && !m.fainted) hurt(m, m.maxhp / 8 * typeEff('Water', m.types), 'from the rainbow');
      if (s.hazards.spikes && grounded && !m.fainted) hurt(m, m.maxhp * [0, 1 / 8, 1 / 6, 1 / 4][s.hazards.spikes], 'from spikes');
      if (s.hazards.web && grounded && !m.fainted) boost(m, { spe: -1 }, foesOf(m)[0] || null);
    }
    if (B.field?.entryChip && B.field.owner !== s.i && !m.fainted) hurt(m, m.maxhp * B.field.entryChip, 'from the field');
    if (m.fainted) return;
    if (how === 'pivot' && a.motionSickness) confuse(m, m);
    entryAbility(m);
  }

  function entryAbility(m) {
    const a = abOf(m);
    for (const op of a.entry) {
      if (op.once) { if ((m.onceDone || (m.onceDone = new Set())).has(op)) continue; m.onceDone.add(op); }
      const foes = foesOf(m).filter(f => !op.onlyType || f.types.includes(op.onlyType));
      if (op.op === 'foes') foes.forEach(f => boost(f, op.stats, m, { intimidate: op.intimidate }));
      if (op.op === 'self' && (!op.ifFoeType || foesOf(m).some(f => f.types.includes(op.ifFoeType)))) boost(m, op.stats, m);
      if (op.op === 'ally') { const al = allyOf(m); if (al && !abOf(al).loner) boost(al, op.stats, m); }
      if (op.op === 'allyHeal') { const al = allyOf(m); if (al) heal(al, al.maxhp * op.frac); }
      if (op.op === 'sub' && !m.vol.sub) m.vol.sub = Math.floor(m.maxhp * op.frac);
      if (op.op === 'field') setField(op.field, m);
      if (op.op === 'confuse') foes.forEach(f => { if (r() < op.p) confuse(f, m); });
      if (op.op === 'trap') foes.forEach(f => { if (!blocks(f, 'trap')) f.vol.trapped = Math.max(f.vol.trapped || 0, op.turns + 1); });
      if (op.op === 'psychUp') { const f = foes[0]; if (f) STATS.forEach(k => { if (f.boosts[k] > 0) m.boosts[k] = f.boosts[k]; }); }
      if (op.op === 'download') {
        const f = foes[0];
        if (f) boost(m, f.raw.grd * stageMult(f.boosts.grd) < f.raw.wil * stageMult(f.boosts.wil) ? { pow: 1 } : { ene: 1 }, m);
      }
      if (op.op === 'trace') { const f = foes[0]; if (f) { m.ability = abOf(f); if (m.ability.entry.length && !m.ability.entry.some(o => o.op === 'trace')) entryAbility(m); } }
      if (op.op === 'imposter') { const f = foes[0]; if (f) transform(m, f, false); }
      if (op.op === 'drainField') m.side.drain = { frac: op.frac, turns: op.turns, by: m };
      if (op.op === 'clearFoeSide') { const fs = foeSide(m.side); fs.screens = {}; fs.tailwind = 0; }
      if (op.op === 'theWorld' && !m.once.theWorld) { m.once.theWorld = true; foeSide(m.side).timeStop = B.turn + 1; }
      if (op.op === 'encore') { const f = foes[0]; if (f && f.vol.lastMove && !blocks(f, 'encore')) f.vol.encore = { turns: 3, id: f.vol.lastMove }; }
      if (op.op === 'wake') foes.forEach(f => { if (f.status === 'sleep') f.status = null; });
    }
    if (B.duos && a.pair) {
      const al = allyOf(m);
      if (al && al.e.charName === a.pair.name) {
        if (a.pair.speed) { boost(m, { spe: 1 }, m); boost(al, { spe: 1 }, m); }
        if (a.pair.pow) boost(m, { pow: 1 }, m);
      }
    }
  }

  function transform(m, f, withAbility) {
    m.types = [...f.types];
    STATS.forEach(k => { m.raw[k] = f.raw[k]; m.boosts[k] = f.boosts[k]; });
    m.moves = f.moves.map(x => ({ ...x, pp: Math.min(x.pp, 5) }));
    if (withAbility) m.ability = abOf(f);
    m.vol.transformed = true;
    say(nm(m), 'transforms into', f.name);
  }

  // Bring in the next character after a knockout, a pivot or a forced switch.
  function bringIn(s, slot, how, pickRandom) {
    const options = bench(s);
    if (!options.length) return false;
    const next = pickRandom ? r.pick(options) : chooseReplacement(B, s, options, api);
    switchIn(next, slot, how);
    return true;
  }

  function setField(f, by) {
    B.field = { ...f, owner: by.side.i, by };
    say('Field set by', nm(by), JSON.stringify(f));
  }

  // ---- damage ----
  function moveType(u, mv, t) {
    const fx = mv.m.fx;
    if ((fx.bestType || (mv.sig && abOf(u).bestTypeSig)) && t) return TYPES.reduce((b, x) => typeEff(x, t.types) > typeEff(b, t.types) ? x : b, mv.m.type);
    return mv.m.type;
  }

  function effectiveness(u, mv, t, type, cryptidCheck = true) {
    const fx = mv.m.fx;
    const ua = abOf(u), ta = defAb(t, u, mv);
    const types = fx.dualType ? fx.dualType : [type];
    let e = 1;
    for (const ty of types) {
      for (const d of t.types) {
        let x = typeEff(ty, [d]);
        if (fx.superVs?.includes(d)) x = 2;
        if (ua.scrappy && x === 0 && d === 'Spirit') x = 1;
        if (ua.pierce && ty === ua.pierce[0] && d === ua.pierce[1] && x < 1) x = 1;
        e *= x;
      }
    }
    if (ta.unweak && type === ta.unweak && e > 1) e = 1;
    if (cryptidCheck && ta.cryptid && !t.once.cryptid) e = e === 0 ? 0 : 1;
    return e;
  }

  // The power after per-move rules (stored power, reversal, ramping moves...).
  function basePower(u, mv, t) {
    const fx = mv.m.fx;
    let p = mv.m.power || 0;
    switch (fx.power) {
      case 'stored': p += 20 * STATS.reduce((n, k) => n + Math.max(0, u.boosts[k]), 0); break;
      case 'hex': if (t?.status) p *= 2; break;
      case 'fury': p = Math.min(160, p * 2 ** Math.min(2, u.vol.furyN || 0)); break;
      case 'flux': p = Math.min(200, p + 50 * (u.vol.lastMove === mv.id ? (u.vol.streak || 0) : 0)); break;
      case 'reversal': { const x = pct(u); p = x > 0.7 ? 20 : x > 0.35 ? 40 : x > 0.2 ? 80 : x > 0.1 ? 100 : x > 0.04 ? 150 : 200; break; }
      case 'avenge': if (u.side.faintTurn === B.turn - 1) p *= 2; break;
      case 'avenge15': if (u.side.faintTurn === B.turn - 1) p *= 1.5; break;
      case 'vsEnergy': if (t?.vol.usedEnergyTurn === B.turn) p *= 2; break;
    }
    return p;
  }

  // Damage of one hit. With est set, returns the average roll with no crit, for the AI.
  function calc(u, t, mv, o = {}) {
    const fx = mv.m.fx;
    if (fx.fixed === 'level') return u.level;
    if (fx.fixed === 'halfhp') return Math.max(1, Math.floor(t.hp / 2));
    const type = moveType(u, mv, t);
    const eff = o.eff ?? effectiveness(u, mv, t, type, !o.est);
    if (eff === 0) return 0;
    const ua = abOf(u), ta = defAb(t, u, mv);
    const phys = mv.m.cat === 'Physical';
    const crit = !!o.crit;
    // attack
    let akey = phys ? 'pow' : 'ene', attacker = u;
    if (fx.foulPlay) attacker = t;
    if (phys && ua.speedAsPower) akey = 'spe';
    let aStage = attacker.boosts[akey];
    if (ta.unaware || (crit && aStage < 0)) aStage = 0;
    let A = attacker.raw[akey] * stageMult(aStage) * statMods(attacker, akey === 'spe' ? 'pow' : akey);
    // defence
    const dkey = phys || fx.psyshock ? 'grd' : 'wil';
    let dStage = t.boosts[dkey];
    if (ua.unaware || fx.ignoreBoosts === 'all') dStage = 0;
    if ((fx.ignoreBoosts === 'def' || ua.ignoreDefBoosts) && dStage > 0) dStage = 0;
    if (crit && dStage > 0) dStage = 0;
    if (ua.instantDomain && mv.flags.contact && !u.once.domain) dStage = Math.min(dStage, 0);
    let D = t.raw[dkey] * stageMult(dStage) * statMods(t, dkey);
    if (dkey === 'grd' && B.field?.snow && t.types.includes('Ice')) D *= 1.5;
    if (dkey === 'wil' && t.status === 'curse') D *= RULES.curse.will;
    if (ua.instantDomain && mv.flags.contact && !u.once.domain) D = Math.min(D, t.raw[dkey]) * 0.5;
    D = Math.max(1, D);
    let power = o.power ?? basePower(u, mv, t);
    // ability power modifiers
    let mod = 1;
    for (const w of ua.atk) if (atkApplies(w, u, t, mv, type, power)) mod *= w.mult;
    if (ua.flashFireOn && type === 'Fire') mod *= 1.5;
    if (u.vol.flashFire && type === 'Fire') mod *= 1.5;
    if (ua.ramp && type === ua.ramp.type) mod *= Math.min(ua.ramp.max, 1 + ua.ramp.step * (u.t.turnsIn || 0));
    if (ua.alternate && u.vol.altNext === type) mod *= ua.alternate[2];
    if (ua.stylish) mod *= Math.min(1.5, 1 + 0.1 * (u.vol.styleN || 0));
    if (u.vol.charged && type === 'Lightning') mod *= 2;
    if (u.vol.senkai && power > 0) mod *= 2;
    if (u.vol.helped) mod *= 1.5;
    if (B.duos) {
      const al = allyOf(u);
      if (al && abOf(al).battery && mv.m.cat === 'Energy') mod *= abOf(al).battery;
      if (al && ua.pair?.mult && al.e.charName === ua.pair.name) mod *= ua.pair.mult;
      if (al && abOf(al).pair?.mult && abOf(al).pair.name === u.e.charName && /Toriko/.test(abOf(al).pair.name)) mod *= abOf(al).pair.mult;
    }
    if (B.field?.boostType === type) mod *= RULES.fieldBoost;
    // base damage
    let dmg = Math.floor(Math.floor(Math.floor(2 * u.level / 5 + 2) * power * A / D) / 50) + 2;
    if (o.spread) dmg *= RULES.spread;
    if (crit) dmg *= ua.critMult || RULES.crit.mult;
    dmg *= o.est ? (RULES.random[0] + RULES.random[1]) / 2 : RULES.random[0] + r() * (RULES.random[1] - RULES.random[0]);
    const own = fx.dualType ? fx.dualType.some(x => u.types.includes(x)) : u.types.includes(type);
    if (own) dmg *= RULES.stab; else if (ua.offStab) dmg *= ua.offStab;
    dmg *= eff;
    if (phys && u.status === 'burn' && !ua.guts) dmg *= RULES.burn.physical;
    if (!phys && u.status === 'curse') dmg *= RULES.curse.energy;
    // screens
    const ts = t.side.screens;
    if (!crit && !fx.breaksScreens && ((phys && ts.reflect) || (!phys && ts.light) || ts.veil)) dmg *= B.duos ? RULES.screen.duos : RULES.screen.singles;
    dmg *= mod;
    // defender ability
    for (const w of ta.def) if (defApplies(w, t, u, mv, type, eff)) dmg *= w.mult;
    if (ta.multiscale && !t.once.multiscale && (ta.multiscale === true || ta.multiscale === mv.m.cat)) dmg *= 0.5;
    if (ta.adaptive && t.vol.adapted?.includes(type)) dmg *= 0.5;
    if (B.duos) { const al = allyOf(t); if (al && abOf(al).allyGuard) dmg *= abOf(al).allyGuard; }
    return Math.max(1, Math.floor(dmg));
  }

  function atkApplies(w, u, t, mv, type, power) {
    if (w.type === 'own' && !u.types.includes(type)) return false;
    if (w.type && w.type !== 'own' && w.type !== type) return false;
    if (w.lowHp && pct(u) >= w.lowHp) return false;
    if (w.cat && w.cat !== mv.m.cat) return false;
    if (w.flag === 'punchkick' ? !(mv.flags.punch || mv.flags.kick) : w.flag && !mv.flags[w.flag]) return false;
    if (w.contact && !mv.flags.contact) return false;
    if (w.maxPower && !(power > 0 && power <= w.maxPower)) return false;
    if (w.recoil && !mv.m.fx.recoil) return false;
    if (w.priority && !(mv.m.priority > 0)) return false;
    if (w.size && mv.m.size !== w.size) return false;
    if (w.notSig && mv.sig) return false;
    if (w.vsTypes && !t.types.some(x => w.vsTypes.includes(x))) return false;
    if (w.vsVillain && !t.e.villain) return false;
    if (w.vsLowHp && pct(t) >= w.vsLowHp) return false;
    if (w.vsBoosted && !STATS.some(k => t.boosts[k] > 0)) return false;
    if (w.vsHitBefore && !u.vol.hitKeys?.has(t.key)) return false;
    if (w.vsCaster && !(t.raw.ene > t.raw.pow)) return false;
    if (w.targetNotMoved && t.vol.movedTurn === B.turn) return false;
    if (w.movedAfter && t.vol.movedTurn !== B.turn) return false;
    if (w.firstOnce && u.once[w.firstOnce]) return false;
    if (w.gravity && !B.field?.gravity) return false;
    if (w.tailwind && !(u.side.tailwind > 0)) return false;
    if (w.duos && !B.duos) return false;
    return true;
  }

  function defApplies(w, t, u, mv, type, eff) {
    if (w.type && w.type !== type) return false;
    if (w.notType && w.notType === type) return false;
    if (w.cat && w.cat !== mv.m.cat) return false;
    if (w.contact && !mv.flags.contact) return false;
    if (w.superEff && !(eff > 1)) return false;
    if (w.lowHp && pct(t) >= w.lowHp) return false;
    return true;
  }

  function critStage(u, mv, t) {
    const ua = abOf(u);
    if (blocks(t, 'crit') && !(ua.moldBreaker || mv.m.fx.ignoreAbility)) return -1;
    if (mv.m.fx.alwaysCrit || u.vol.lockCrit) return 3;
    if (mv.m.fx.critBelowHalf && pct(t) < 0.5) return 3;
    if (ua.onePunch && !u.vol.punched?.has(t.key)) return 3;
    let s = mv.m.fx.crit || 0;
    if (ua.crit && (!ua.crit.type || ua.crit.type === mv.m.type) && (!ua.crit.flag || mv.flags[ua.crit.flag]) && (!ua.crit.lowHp || pct(u) < ua.crit.lowHp)) s += ua.crit.stage;
    if (abOf(t).badLuck) s += 1;
    return s;
  }

  // ---- using a move ----
  function useMove(u, slotIdx, targetHint) {
    if (u.fainted || !u.side.active.includes(u)) return;
    const a = abOf(u);
    u.vol.actedTurn = B.turn;
    // can it act?
    if (u.vol.recharge > 0) { u.vol.recharge--; say(nm(u), 'must rest'); return; }
    if (u.side.timeStop === B.turn) { say(nm(u), 'is frozen in stopped time'); return; }
    if (u.vol.loseTurn) { u.vol.loseTurn = false; say(nm(u), 'loses its turn'); return; }
    if (a.truantFirst && !u.once.read) { u.once.read = true; say(nm(u), 'is reading'); return; }
    if (u.status === 'sleep' && !a.comatose && !a.sleepFighter) {
      u.statusTurns--;
      if (u.statusTurns > 0) { say(nm(u), 'is asleep'); return; }
      u.status = null; say(nm(u), 'wakes up');
      if (u.vol.wakeConfuse) { u.vol.wakeConfuse = false; confuse(u, u); }
    }
    if (u.status === 'freeze') {
      u.statusTurns--;
      if (u.statusTurns > 0 && r() >= RULES.freeze.thaw) { say(nm(u), 'is frozen'); return; }
      u.status = null; say(nm(u), 'thaws');
    }
    if (u.status === 'stun' && r() < RULES.stun.skip) { say(nm(u), 'is stunned'); return; }
    if (u.vol.flinch) { u.vol.flinch = false; if (!blocks(u, 'flinch')) { say(nm(u), 'flinches'); return; } }
    if (a.narcolepsy && r() < a.narcolepsy) { heal(u, u.maxhp / 8); say(nm(u), 'dozes off'); return; }
    if (a.lowBattery && pct(u) < 0.25 && r() < 0.33) { hurtSelfConfused(u); return; }
    if (u.vol.confuse > 0) {
      u.vol.confuse--;
      if (u.vol.confuse === 0) say(nm(u), 'snaps out of confusion');
      else if (r() < RULES.confuse.self) { hurtSelfConfused(u); return; }
    }
    // which move
    const rampaging = !!u.vol.rampage;
    let mv = u.moves[slotIdx];
    if (u.vol.rampage) mv = u.moves.find(x => x.id === u.vol.rampage.id) || mv;
    if (u.vol.charging) mv = u.moves.find(x => x.id === u.vol.charging) || mv;
    if (u.vol.encore && !u.vol.charging && !u.vol.rampage) mv = u.moves.find(x => x.id === u.vol.encore.id) || mv;
    if (!mv) return;
    const fx0 = mv.m.fx;
    if (fx0.metronome) {
      const pool = [...data.moves.values()].filter(m => !m.signature && !m.fx.metronome && m.id !== 'protect');
      mv.pp--;
      const pick = r.pick(pool);
      say(nm(u), 'waves a finger:', pick.name);
      mv = { id: pick.id, m: pick, as: pick.name, flags: moveFlags(pick, []), pp: 1, sig: false, fromMetronome: true };
    }
    const fx = mv.m.fx;
    const isStatus = mv.m.cat === 'Status';
    if (isStatus && a.mimicChest && r() < a.mimicChest) { say(nm(u), 'is eaten by a treasure chest'); return; }
    if (!u.vol.charging && !rampaging && !mv.fromMetronome) mv.pp--;
    track(u, mv).uses++;
    // streaks
    u.vol.streak = u.vol.lastMove === mv.id ? (u.vol.streak || 0) + 1 : 0;
    if (u.vol.lastMove !== mv.id) u.vol.furyN = 0;
    if (a.stylish) u.vol.styleN = u.vol.lastMove && u.vol.lastMove !== mv.id ? (u.vol.styleN || 0) + 1 : 0;
    u.vol.lastMove = mv.id;
    if (mv.m.cat === 'Energy') u.vol.usedEnergyTurn = B.turn;
    if (a.protean && !u.vol.charging) u.types = [mv.m.type];
    say(nm(u), 'uses', mv.as);
    // failure rules
    if (fx.firstTurn && u.t.turnsIn > 0) { say('but it fails'); return; }
    if (fx.noRepeat && u.vol.prevMove === mv.id) { say('but it fails'); u.vol.prevMove = null; return; }
    u.vol.prevMove = mv.id;
    if (fx.nothing) return;
    // two-turn moves
    if (fx.charge && !u.vol.charging) {
      u.vol.charging = mv.id;
      if (fx.charge.invuln) u.vol.invuln = true;
      if (fx.charge.boost) boost(u, fx.charge.boost, u);
      say(nm(u), 'charges up');
      return;
    }
    if (u.vol.charging) { u.vol.charging = null; u.vol.invuln = false; }
    // rampage
    if (fx.rampage) {
      if (!u.vol.rampage) u.vol.rampage = { id: mv.id, left: r.int(...fx.rampage) - 1 };
      else if (--u.vol.rampage.left <= 0) { u.vol.rampage = null; if (fx.selfConfuse) confuse(u, u); }
    }
    // targets
    const targets = pickTargets(u, mv, targetHint);
    if (isStatus) statusMove(u, mv, targets);
    else attack(u, mv, targets);
    // after the move
    if (fx.charged) u.vol.charged = true; else if (!isStatus && mv.m.type === 'Lightning') u.vol.charged = false;
    if (!isStatus && u.vol.senkai) u.vol.senkai = false;
    if (fx.lockOn) { u.vol.lockOn = 2; if (fx.lockOn === 'crit') u.vol.lockCritNext = true; }
    if (a.afterMove && mv.m.type === a.afterMove.type) boost(u, a.afterMove.stats, u);
    if (a.alternate) u.vol.altNext = mv.m.type === a.alternate[0] ? a.alternate[1] : mv.m.type === a.alternate[1] ? a.alternate[0] : u.vol.altNext;
    if (a.heavyChip && mv.m.size === 'heavy') hurt(u, u.maxhp * a.heavyChip, 'from his back');
    if (fx.recharge && !u.fainted) u.vol.recharge = fx.recharge;
    if (fx.selfConfuse && !fx.rampage) confuse(u, u);
    if (fx.selfChip) u.vol.selfChip = fx.selfChip;
    if (fx.noRecoil) u.once.noRecoil = true;
    if (!u.fainted && (fx.switchOut || (a.explodeOut && mv.id === 'explosion-megumin'))) pivot(u, fx.batonPass);
    if (!u.fainted && u.vol.ejectNow) { u.vol.ejectNow = false; pivot(u); }
  }

  function hurtSelfConfused(u) {
    const d = Math.max(1, Math.floor(Math.floor(Math.floor(2 * u.level / 5 + 2) * RULES.confuse.power * u.raw.pow * stageMult(u.boosts.pow) / Math.max(1, u.raw.grd * stageMult(u.boosts.grd))) / 50) + 2);
    say(nm(u), 'hurts itself in confusion');
    hurt(u, d, 'in confusion');
  }

  function pivot(u, baton) {
    if (!bench(u.side).length) return;
    const slot = switchOut(u, { baton });
    bringIn(u.side, slot, 'pivot');
  }

  function pickTargets(u, mv, hint) {
    const fx = mv.m.fx, foes = foesOf(u);
    const selfish = mv.m.cat === 'Status' && !fx.status && !fx.encore && !fx.taunt && !fx.forceSwitch && !fx.trap && !fx.confuseFoes && !fx.countdown && !fx.painSplit && !fx.steal && !fx.clearFoeBoosts && !fx.seed && !(fx.boosts || []).some(b => b.who === 'foe' || b.who === 'foes') && !fx.soak && !fx.yawn;
    if (selfish) return [u];
    let spread = fx.spread || (abOf(u).spreadType === mv.m.type ? 'foes' : null) || (fx.status?.who === 'foes' ? 'foes' : null) || ((fx.boosts || []).some(b => b.who === 'foes') && mv.m.cat === 'Status' ? 'foes' : null);
    if (fx.countdown?.who === 'foes' || fx.confuseFoes) spread = 'foes';
    if (spread === 'all') return [...foes, ...(allyOf(u) ? [allyOf(u)] : [])];
    if (spread === 'foes') return foes;
    // single target: a foe using Follow Me draws it
    const drawer = foes.find(f => f.vol.followMe);
    let t = drawer || (hint && foes.includes(hint) ? hint : foes[0]);
    if (abOf(u).lost && r() < abOf(u).lost) { const all = [...foes, ...(allyOf(u) ? [allyOf(u)] : [])]; t = r.pick(all); }
    return t ? [t] : [];
  }

  // Accuracy, protection, dodges. Returns false when the move doesn't connect with t.
  function connects(u, mv, t, nTargets) {
    const fx = mv.m.fx, ua = abOf(u), ta = defAb(t, u, mv);
    if (t === u) return true;
    const prio = effPriority(u, mv) > 0;
    if (t.vol.protect && !fx.breaksProtect && !(ua.heavyBypass && (mv.m.size === 'heavy' || mv.sig)) && !(ua.sigBypass && mv.sig)) {
      say(nm(t), 'protects itself');
      const pr = t.vol.protect;
      if (mv.flags.contact) {
        if (pr.contactChip) hurt(u, u.maxhp * pr.contactChip, 'on the guard', t);
        if (pr.contactPow) boost(u, { pow: pr.contactPow }, t);
        const tab = abOf(t);
        if (tab.spikyShield) hurt(u, u.maxhp * tab.spikyShield, 'on the shield', t);
        if (tab.royalGuard) hurt(u, calc(u, t, mv, { est: true }) * tab.royalGuard, 'from the royal guard', t);
      }
      return false;
    }
    if (prio && t.side.quickGuard === B.turn) { say('quick guard blocks it'); return false; }
    if (prio && B.field?.noPriority && t.side !== u.side) { say('the field blocks quick moves'); return false; }
    if (prio && t.side !== u.side && ta.block.has('priority')) { say(nm(t), 'senses it'); return false; }
    if (prio && t.side !== u.side && ta.priorityDodgeOnce && !t.once.pdodge) { t.once.pdodge = true; say(nm(t), 'dodges'); return false; }
    if (t.vol.invuln && !ua.hitsInvuln && !(ua.neverMiss === true)) { say(nm(t), 'is out of reach'); return false; }
    if (ta.dodge && t.side !== u.side && (!ta.dodge.contact || mv.flags.contact)) {
      const k = ta.dodge.reset ? 'dodgeEntry' : 'dodge';
      if (!t.once[k]) { t.once[k] = true; say(nm(t), 'dodges it'); return false; }
    }
    if (mv.m.cat === 'Status' && ta.statusDodge && t.side !== u.side && r() < ta.statusDodge) { say(nm(t), 'reads it'); return false; }
    if (mv.m.cat === 'Status' && t.side !== u.side && t.vol.sub && !fx.breaksSub && !ua.infiltrator && (fx.status || fx.boosts)) { say('the decoy takes it'); return false; }
    // accuracy
    const acc = mv.m.accuracy;
    if (acc == null || fx.neverMiss || u.vol.lockOn > 0 || ua.neverMiss === true || ua.neverMiss === mv.m.cat || ua.neverMiss === mv.m.type || (ua.neverMiss === 'sound' && mv.flags.sound) || ta.neverMissOn) return true;
    if (ua.instantDomain && mv.flags.contact && !u.once.domain) return true;
    let p = acc / 100 * (ua.accMult || 1);
    if (B.field?.gravity) p *= 5 / 3;
    if (r() < p) return true;
    say(nm(u), 'misses');
    track(u, mv).misses++;
    if (fx.missDmg) hurt(u, u.maxhp * fx.missDmg, 'from missing');
    return false;
  }

  // Ability immunities (Flash Fire, Levitate...). True when the hit is absorbed.
  function absorbs(u, mv, t) {
    if (t.side === u.side && t === u) return false;
    const ta = defAb(t, u, mv);
    const type = moveType(u, mv, t);
    for (const im of ta.immune) {
      if ((im.type && im.type === type) || (im.cat && im.cat === mv.m.cat) || (im.flag && mv.flags[im.flag])) {
        say(nm(t), 'is immune');
        if (im.heal) heal(t, t.maxhp * im.heal);
        if (im.boost) boost(t, im.boost, t);
        if (im.flashFire) t.vol.flashFire = true;
        return true;
      }
    }
    return false;
  }

  function attack(u, mv, targets) {
    const fx = mv.m.fx, ua = abOf(u);
    if (fx.sucker) {
      const t = targets[0];
      if (!t || t.vol.actedTurn === B.turn || !t.vol.plannedAttack) { say('but it fails'); return; }
    }
    if (fx.clearFoeBoosts === 'before') targets.forEach(t => STATS.forEach(k => { if (t.boosts[k] > 0) t.boosts[k] = 0; }));
    if (fx.breaksScreens) targets.forEach(t => { t.side.screens = {}; });
    if (fx.clearField) B.field = null;
    if (fx.haze) [...actives(B.sides[0]), ...actives(B.sides[1])].forEach(m => STATS.forEach(k => { m.boosts[k] = 0; }));
    if (fx.delayed) {
      const t = targets[0];
      if (t) t.side.futures.push({ turn: B.turn + fx.delayed.turns, by: u, mv, slot: t.side.active.indexOf(t) });
      say(nm(u), 'foresees an attack');
      return;
    }
    const spread = targets.length > 1;
    let totalDealt = 0, anyHit = false, koAny = false;
    for (const t of targets) {
      if (t.fainted) continue;
      if (fx.counter) {
        const took = fx.counter.cat === 'Physical' ? u.vol.tookPhys : fx.counter.cat === 'Energy' ? u.vol.tookEne : (u.vol.tookPhys || 0) + (u.vol.tookEne || 0);
        if (!took || u.vol.tookTurn !== B.turn) { say('but it fails'); return; }
        if (!connects(u, mv, t)) continue;
        dealDamage(u, t, mv, Math.floor(took * fx.counter.mult), false, spread);
        anyHit = true; continue;
      }
      if (!connects(u, mv, t, targets.length)) continue;
      if (absorbs(u, mv, t)) continue;
      const type = moveType(u, mv, t);
      const eff = effectiveness(u, mv, t, type);
      if (eff === 0) { say(nm(t), 'is not affected'); continue; }
      // hit count
      let n = 1;
      if (fx.hits) n = ua.skillLink ? fx.hits[1] : fx.hits[0] === fx.hits[1] ? fx.hits[0] : rollHits(fx.hits);
      const parental = ua.parental && (ua.parental.flag === 'contact' ? mv.flags.contact : mv.flags[ua.parental.flag]) && n === 1 && !spread;
      let dealt = 0, hits = 0, crits = 0;
      const total = parental ? 2 : n;
      for (let h = 0; h < total && !t.fainted && !u.fainted; h++) {
        const cs = critStage(u, mv, t);
        const crit = cs >= 0 && r() < RULES.crit.chance[Math.min(3, cs)];
        let d = calc(u, t, mv, { crit, spread, eff });
        if (parental && h === 1) d = Math.max(1, Math.floor(d * ua.parental.mult));
        if (crit) { crits++; say('critical hit'); }
        const res = dealDamage(u, t, mv, d, crit, spread, h === total - 1);
        dealt += res; hits++;
        if (crit && ua.critBoost) boost(u, ua.critBoost, u);
        if (crit && ua.critSplash) foesOf(u).forEach(f => hurt(f, f.maxhp * ua.critSplash, 'from rubble', u));
        if (crit && abOf(t).angerPoint && !t.fainted) { t.boosts.pow = 6; }
        if (fx.status?.each) secondaryStatus(u, t, mv);
      }
      if (!hits) continue;
      anyHit = true;
      totalDealt += dealt;
      track(u, mv).hits += hits; track(u, mv).dmg += dealt; track(u, mv).crits += crits;
      if (eff > 1) track(u, mv).sup++;
      if (ua.onePunch) (u.vol.punched = u.vol.punched || new Set()).add(t.key);
      (u.vol.hitKeys = u.vol.hitKeys || new Set()).add(t.key);
      t.once.cryptid = true;
      if (eff > 1 && defAb(t, u, mv).adaptive) (t.vol.adapted = t.vol.adapted || []).push(type);
      if (eff < 1 && ua.gloom) boost(u, { spe: -1 }, u);
      if (t.fainted) { koAny = true; track(u, mv).kos++; if (fx.koHeal) heal(u, u.maxhp * fx.koHeal); continue; }
      // secondary effects on the target
      const grace = ua.sereneGrace === true || (ua.sereneGrace === mv.m.type) ? 2 : 1;
      if (fx.status && !fx.status.each) secondaryStatus(u, t, mv, grace);
      if (fx.flinch && t.vol.actedTurn !== B.turn && r() < fx.flinch * grace) t.vol.flinch = true;
      if (fx.timeStop && r() < fx.timeStop * grace) t.vol.loseTurn = true;
      for (const b of fx.boosts || []) if ((b.who === 'foe' || b.who === 'foes') && r() < b.p * (b.p < 1 ? grace : 1)) boost(t, b.stats, u);
      if (fx.clearFoeBoosts === 'after') STATS.forEach(k => { if (t.boosts[k] > 0) t.boosts[k] = 0; });
      if (fx.suppress) t.vol.suppressed = fx.suppress;
      if (fx.trap && !blocks(t, 'trap')) t.vol.trapped = fx.trap;
      if (fx.bind && !blocks(t, 'trap')) t.vol.bind = { left: r.int(...fx.bind.turns), frac: fx.bind.frac, by: u };
      if (fx.seed) t.vol.seed = { frac: fx.seed, by: u };
      if (fx.slowNext) t.vol.slowTurn = B.turn + 1;
      if (fx.forceSwitch && !blocks(t, 'forceOut') && bench(t.side).length) { const slot = switchOut(t); bringIn(t.side, slot, 'forced', true); }
      if (fx.echo) t.side.futures.push({ turn: B.turn + 1, by: u, mv, slot: t.side.active.indexOf(t), mult: fx.echo });
      if (fx.sideChip) foeSide(u.side).chip = { frac: fx.sideChip.frac, turns: fx.sideChip.turns, by: u };
      for (const dh of ua.dealHit) {
        if (dh.contact && !mv.flags.contact) continue;
        if (dh.cat && dh.cat !== mv.m.cat) continue;
        if (dh.p && r() >= dh.p) continue;
        if (dh.status) inflict(t, dh.status, u, { mv });
        if (dh.suppress) t.vol.suppressed = dh.suppress;
        if (dh.decay) t.vol.decay = dh.decay;
        if (dh.trap && !blocks(t, 'trap')) t.vol.trapped = dh.trap;
      }
      if (ua.catBurglar) { const k = STATS.find(x => t.boosts[x] > 0); if (k) { t.boosts[k]--; boost(u, { [k]: 1 }, u); } }
      if (ua.transformOnHit && mv.flags.contact && !u.vol.transformed) transform(u, t, ua.transformAbility);
      if (defAb(t, u, mv).ejectSuper && eff > 1 && bench(t.side).length && !t.fainted) { const slot = switchOut(t); bringIn(t.side, slot, 'eject'); }
      if (t.vol.ejectNow && !t.fainted) { t.vol.ejectNow = false; const slot = switchOut(t); bringIn(t.side, slot, 'eject'); }
    }
    if (mv.m.fx.power === 'fury') u.vol.furyN = anyHit ? (u.vol.furyN || 0) + 1 : 0;
    if (ua.instantDomain && mv.flags.contact) u.once.domain = true;
    if (mv.m.cat === 'Energy' && ua.atk.some(w => w.firstOnce)) u.once.concealed = true;
    if (u.vol.lockOn > 0) { u.vol.lockOn = 0; u.vol.lockCrit = false; }
    if (u.vol.lockCritNext) { u.vol.lockCrit = true; u.vol.lockCritNext = false; u.vol.lockOn = 1; }
    if (!anyHit) return;
    // effects on the user
    if (fx.drain || ua.drain) {
      let f = fx.drain || 0;
      if (ua.drain && (!ua.drain.type || ua.drain.type === mv.m.type) && (!ua.drain.contact || mv.flags.contact)) f += ua.drain.frac;
      if (f) heal(u, totalDealt * f);
    }
    if (fx.recoil && !u.once.noRecoil) hurt(u, totalDealt * fx.recoil, 'in recoil');
    if (ua.dealRecoil && mv.m.cat === 'Energy') hurt(u, totalDealt * ua.dealRecoil, 'in recoil');
    if (fx.selfDmg && !u.fainted) hurt(u, u.maxhp * fx.selfDmg, 'from the strain');
    for (const b of fx.boosts || []) if ((b.who === 'self' || b.who === 'team') && r() < b.p) {
      if (b.who === 'team') actives(u.side).forEach(x => boost(x, b.stats, u)); else boost(u, b.stats, u);
    }
    for (const b of fx.boosts || []) if (b.who === 'incoming') u.side.gift = { stats: b.stats };
    if (fx.field) setField(fx.field, u);
    if (fx.clearHazards === 'foe') { const fs = foeSide(u.side); fs.hazards = { rocks: 0, spikes: 0, web: 0, rainbow: 0 }; fs.screens = {}; }
    if (fx.clearHazards === 'own') u.side.hazards = { rocks: 0, spikes: 0, web: 0, rainbow: 0 };
  }

  function rollHits([lo, hi]) {
    if (lo === 2 && hi === 5) { const x = r(); return x < 0.35 ? 2 : x < 0.7 ? 3 : x < 0.85 ? 4 : 5; }
    return r.int(lo, hi);
  }

  function secondaryStatus(u, t, mv, grace = 1) {
    const s = mv.m.fx.status;
    if (!s || t.fainted) return;
    if (r() < Math.min(1, s.p * (s.p < 1 ? grace : 1))) inflict(t, s.kind, u, { mv, turns: s.turns, wakeConfuse: mv.m.fx.wakeConfuse });
  }

  // Applies one hit: decoy, disguise, Endure/Sturdy, then the damage and every on-hit reaction.
  function dealDamage(u, t, mv, d, crit, spread, last = true) {
    const ta = defAb(t, u, mv);
    if (t.vol.sub && t !== u && !mv.m.fx.breaksSub && !abOf(u).infiltrator && !(abOf(u).sigBypass && mv.sig) && !mv.flags.sound) {
      const x = Math.min(t.vol.sub, d);
      t.vol.sub -= x;
      say('the decoy takes', x);
      if (t.vol.sub <= 0) { t.vol.sub = 0; say('the decoy breaks'); }
      return 0;
    }
    if (ta.disguise === 'once' && !t.once.disguise) { t.once.disguise = true; say(nm(t), 'leaves a fake behind'); return 0; }
    if (ta.disguise === 'entry' && !t.once.disguiseEntry) { t.once.disguiseEntry = true; say('Infinity stops it'); return 0; }
    if (ta.multiscale) t.once.multiscale = true;
    const full = t.hp === t.maxhp;
    if (d >= t.hp) {
      if (ta.disguise === 'koOnce' && !t.once.contract) { t.once.contract = true; say('the contract takes it'); return 0; }
      if (t.vol.endure === B.turn) d = t.hp - 1;
      else if (ta.sturdy && full) { d = t.hp - 1; if (ta.sturdyBoost) boost(t, ta.sturdyBoost, t); say(nm(t), 'hangs on'); }
      else if (ta.surviveOnce && !t.once.survived) { t.once.survived = true; d = t.hp - 1; say(nm(t), 'hangs on'); if (ta.surviveSwitch) t.vol.ejectNow = true; }
    }
    d = Math.max(0, Math.min(t.hp, d));
    if (d === t.hp && full) t.vol.oneHit = true;
    t.hp -= d;
    u.t.dmg += d; t.t.taken += d;
    // what Counter-style moves hit back with this turn
    if (t.vol.tookTurn !== B.turn) { t.vol.tookPhys = 0; t.vol.tookEne = 0; t.vol.tookTurn = B.turn; }
    if (mv.m.cat === 'Physical') t.vol.tookPhys += d; else t.vol.tookEne += d;
    t.once.hitTaken = true;
    if (abOf(t).slowStart && abOf(t).slowStartBoost && !t.once.bullet) { t.once.bullet = true; boost(t, abOf(t).slowStartBoost, t); }
    say(nm(t), 'takes', d, `(${Math.round(t.hp / t.maxhp * 100)}% left)`);
    if (t.status === 'freeze' && mv.m.type === 'Fire' && t.hp > 0) { t.status = null; say(nm(t), 'thaws'); }
    if (t.hp <= 0) { faint(t, u); if (!t.fainted) return d; }
    else afterHp(t, u);
    // reactions to being hit
    if (u !== t && t.side !== u.side) {
      const type = mv.m.type;
      for (const h of ta.hitBy) {
        if (h.contact && !mv.flags.contact) continue;
        if (h.cat && h.cat !== mv.m.cat) continue;
        if (h.types && !h.types.includes(type)) continue;
        if (h.superEff && !(effectiveness(u, mv, t, type, false) > 1)) continue;
        if (h.attackerType && !u.types.includes(h.attackerType)) continue;
        if (h.p != null && h.p < 1 && r() >= h.p) continue;
        if (h.self) { if (!t.fainted) boost(t, h.stats, t); continue; }
        if (h.status) inflict(u, h.status, t);
        if (h.chip) hurt(u, u.maxhp * h.chip, 'from the counterattack', t);
        if (h.stats) boost(u, h.stats, t);
      }
      if (ta.bounce && mv.m.cat === ta.bounce.cat && r() < ta.bounce.p) hurt(u, d * ta.bounce.frac, 'from the bounce', t);
    }
    return d;
  }

  function statusMove(u, mv, targets) {
    const fx = mv.m.fx, ua = abOf(u);
    if (fx.duosOnly && !B.duos) return;
    if (fx.protect) {
      const chain = u.vol.protectChain || 0;
      if (chain > 0 && !fx.protect.repeat && !ua.protectAlways && r() >= 1 / 3 ** chain) { u.vol.protectChain = 0; say('but it fails'); return; }
      u.vol.protect = fx.protect; u.vol.protectTurn = B.turn; u.vol.protectChain = chain + 1;
      if (fx.heal) heal(u, u.maxhp * fx.heal, 'move');
      return;
    }
    if (fx.endure) {
      const chain = u.vol.protectChain || 0;
      if (chain > 0 && r() >= 1 / 3 ** chain) { u.vol.protectChain = 0; say('but it fails'); return; }
      u.vol.endure = B.turn; u.vol.protectChain = chain + 1; return;
    }
    if (fx.quickGuard) { u.side.quickGuard = B.turn; return; }
    if (fx.followMe) u.vol.followMe = B.turn;
    if (fx.helpingHand) { const al = allyOf(u); if (al) al.vol.helped = true; }
    if (fx.substitute) {
      if (u.vol.sub || u.hp <= u.maxhp * fx.substitute) { say('but it fails'); return; }
      hurt(u, u.maxhp * fx.substitute, 'into a decoy'); u.vol.sub = Math.floor(u.maxhp * fx.substitute);
    }
    if (fx.selfDmg) {
      if (u.hp <= u.maxhp * fx.selfDmg) { say('but it fails'); return; }
      hurt(u, u.maxhp * fx.selfDmg, 'for power');
    }
    // heals
    if (fx.heal || fx.cure) {
      const who = fx.healWho === 'team' ? actives(u.side) : fx.healWho === 'ally' ? [allyOf(u) || u] : [u];
      for (const x of who) {
        if (fx.heal) heal(x, x.maxhp * fx.heal, 'move');
        if (fx.cure === 'team') alive(u.side).forEach(y => { y.status = null; }); else if (fx.cure) x.status = null;
        if (ua.deadlyCooking && x !== u) inflict(x, 'bleed', u);
      }
      if (fx.restSleep) { u.status = 'sleep'; u.statusTurns = 3; }
      if (ua.healBoost) boost(u, ua.healBoost, u);
      if (ua.senkaimaru && fx.heal) u.vol.senkai = true;
    }
    if (fx.wish) u.side.wish = { turn: B.turn + 1, amount: u.maxhp * fx.wish };
    if (fx.aquaRing) u.vol.aquaRing = true;
    if (fx.revive) {
      const down = u.side.mons.find(x => x.fainted && !x.once.revivedByMove);
      if (down) { down.fainted = false; down.hp = Math.floor(down.maxhp * fx.revive); down.once.revivedByMove = true; say(down.name, 'is revived'); }
      else say('but it fails');
    }
    if (fx.screen) u.side.screens[fx.screen] = 5;
    if (fx.tailwind) u.side.tailwind = fx.tailwind + (ua.longTailwind || 0);
    if (fx.hazard) {
      const h = foeSide(u.side).hazards;
      if (fx.hazard === 'spikes') h.spikes = Math.min(3, h.spikes + 1); else h[fx.hazard] = 1;
    }
    if (fx.clearHazards === 'both') B.sides.forEach(s => { s.hazards = { rocks: 0, spikes: 0, web: 0, rainbow: 0 }; s.screens = {}; });
    if (fx.clearHazards === 'own') u.side.hazards = { rocks: 0, spikes: 0, web: 0, rainbow: 0 };
    if (fx.haze) [...actives(B.sides[0]), ...actives(B.sides[1])].forEach(m => STATS.forEach(k => { m.boosts[k] = 0; }));
    if (fx.clearField) B.field = null;
    if (fx.field) setField(fx.field, u);
    if (fx.extraTurn) u.vol.extraTurn = B.turn + 1;
    if (fx.charged) u.vol.charged = true;
    // self and team boosts
    for (const b of fx.boosts || []) {
      if (b.who === 'self') boost(u, b.stats, u);
      if (b.who === 'team') actives(u.side).forEach(x => { if (x === u || !abOf(x).loner) boost(x, b.stats, u); });
      if (b.who === 'ally') { const al = allyOf(u) || u; if (!abOf(al).loner) boost(al, b.stats, u); }
      if (b.who === 'incoming') u.side.gift = { stats: b.stats };
    }
    // moves aimed at foes
    for (const t of targets) {
      if (t === u || t.side === u.side) continue;
      if (!connects(u, mv, t)) continue;
      const ta = defAb(t, u, mv);
      if (fx.status && r() < (fx.status.p ?? 1)) {
        if (mv.flags.sound && ta.immune.some(x => x.flag === 'sound')) { say(nm(t), 'is immune'); continue; }
        if (fx.status.kind === 'stun' && ta.immune.some(x => x.type === 'Lightning')) { say(nm(t), 'is immune'); continue; }
        inflict(t, fx.status.kind, u, { mv, turns: fx.status.turns, wakeConfuse: fx.wakeConfuse });
      }
      if (fx.confuseFoes) confuse(t, u);
      for (const b of fx.boosts || []) if (b.who === 'foe' || b.who === 'foes') {
        if (b.stats.pow < 0 && mv.id === 'charm' && ta.block.has('charm')) continue;
        boost(t, b.stats, u);
      }
      if (fx.encore && t.vol.lastMove && !ta.block.has('encore')) t.vol.encore = { turns: fx.encore, id: t.vol.lastMove };
      if (fx.taunt && !ta.block.has('taunt')) t.vol.taunt = fx.taunt;
      if (fx.trap && !ta.block.has('trap')) t.vol.trapped = fx.trap;
      if (fx.forceSwitch && !ta.block.has('forceOut') && bench(t.side).length) { const slot = switchOut(t); bringIn(t.side, slot, 'forced', true); }
      if (fx.yawn && !t.status) t.vol.yawn = B.turn + 1;
      if (fx.painSplit) { const avg = Math.floor((u.hp + t.hp) / 2); u.hp = Math.min(u.maxhp, avg); t.hp = Math.min(t.maxhp, avg); afterHp(t, u); }
      if (fx.steal) STATS.forEach(k => { if (t.boosts[k] > 0) { u.boosts[k] = Math.min(6, u.boosts[k] + t.boosts[k]); t.boosts[k] = 0; } });
      if (fx.clearFoeBoosts) STATS.forEach(k => { if (t.boosts[k] > 0) t.boosts[k] = 0; });
      if (fx.seed) t.vol.seed = { frac: fx.seed, by: u };
      if (fx.soak) t.types = [fx.soak];
      if (fx.countdown && !ta.block.has('countdown') && !(mv.id === 'death-note' && t.e.gag)) t.vol.countdown = B.turn + fx.countdown.turns;
    }
    if (fx.destinyBond) u.vol.destinyBond = true;
    if (fx.switchOut) {}  // handled after the move
  }

  // ---- turn order ----
  function effPriority(m, mv) {
    if (!mv) return 0;
    const a = abOf(m);
    let p = mv.m.priority || 0;
    if (a.prankster && mv.m.cat === 'Status') p += 1;
    if (a.quickDraw && !m.once.quickDrawn && (a.quickDraw === true || a.quickDraw === mv.m.cat)) p += 0.5;
    if (a.pivotPriority && mv.m.fx.switchOut) p += 1;
    if (a.goLast) p -= 0.5;
    return p;
  }

  // ---- end of turn ----
  function endTurn() {
    for (const s of B.sides) {
      // delayed hits
      s.futures = s.futures.filter(f => {
        if (f.turn !== B.turn) return true;
        const t = s.active[f.slot] || actives(s)[0];
        if (t && !t.fainted && !blocks(t, 'delayed')) {
          const d = calc(f.by, t, f.mv, { crit: false }) * (f.mult || 1);
          say('the delayed hit lands'); dealDamage(f.by, t, f.mv, Math.floor(d), false, false);
          track(f.by, f.mv).dmg += Math.floor(d);
        }
        return false;
      });
      if (s.wish && s.wish.turn === B.turn) { actives(s).forEach(m => heal(m, s.wish.amount)); s.wish = null; }
    }
    if (B.field?.sideHeal) actives(B.sides[B.field.owner]).forEach(m => heal(m, m.maxhp * B.field.sideHeal));
    for (const s of B.sides) {
      if (s.chip) { actives(s).forEach(m => hurt(m, m.maxhp * s.chip.frac, 'from the shrine', s.chip.by)); if (--s.chip.turns <= 0) s.chip = null; }
      const fd = foeSide(s).drain;
      if (fd && !fd.by.fainted) { let got = 0; actives(s).forEach(m => { const before = m.hp; hurt(m, m.maxhp * fd.frac, 'to devouring time', fd.by); got += before - m.hp; }); heal(fd.by, got); }
    }
    for (const s of B.sides) if (s.drain && --s.drain.turns <= 0) s.drain = null;
    for (const m of [...actives(B.sides[0]), ...actives(B.sides[1])]) {
      if (m.fainted) continue;
      const a = abOf(m);
      m.t.turnsIn = (m.t.turnsIn || 0) + 1; m.t.turns++;
      if (B.field?.snow && !m.types.includes('Ice')) hurt(m, m.maxhp / 16, 'from the snow');
      if (m.vol.bind) { hurt(m, m.maxhp * m.vol.bind.frac, 'from the bind', m.vol.bind.by); if (m.vol.bind && --m.vol.bind.left <= 0) m.vol.bind = null; }
      if (m.vol.seed && !m.fainted) { const before = m.hp; hurt(m, m.maxhp * m.vol.seed.frac, 'to the buds', m.vol.seed.by); if (!m.vol.seed.by.fainted) heal(m.vol.seed.by, before - m.hp); }
      if (m.vol.decay && !m.fainted) hurt(m, m.maxhp * m.vol.decay, 'from decay');
      if (m.fainted) continue;
      if (m.status === 'burn') hurt(m, m.maxhp * RULES.burn.chip, 'from its burn');
      if (m.status === 'bleed') {
        m.bleedN++;
        if (a.poisonHeal) heal(m, m.maxhp * a.poisonHeal); else hurt(m, m.maxhp * RULES.bleed.step * m.bleedN, 'from bleeding');
      }
      if (m.fainted) continue;
      if (m.vol.aquaRing) heal(m, m.maxhp / 16);
      for (const op of a.endTurn) {
        if (op.op === 'heal' && (!op.lowHp || pct(m) < op.lowHp) && (!op.asleep || m.status === 'sleep')) heal(m, m.maxhp * op.frac);
        if (op.op === 'boost' && (!op.ifNoAttack || m.vol.lastAttackTurn !== B.turn)) boost(m, op.stats, m);
        if (op.op === 'chip') hurt(m, m.maxhp * op.frac, 'from its body');
        if (op.op === 'every3' && m.t.turnsIn % 3 === 0) boost(m, op.stats, m);
        if (op.op === 'moody') { const up = r.pick(STATS), dn = r.pick(STATS.filter(k => k !== up)); boost(m, { [up]: 2, [dn]: -1 }, m); }
        if (op.op === 'drunk' && r() < op.p) { confuse(m, m); boost(m, { pow: 1 }, m); }
        if (op.op === 'poke') { const f = r.pick(foesOf(m)); if (f) hurt(f, f.maxhp * op.frac, 'from the helpers', m); }
        if (op.op === 'badDreams') foesOf(m).forEach(f => { if (f.status === 'sleep') hurt(f, f.maxhp * op.frac, 'in its dreams', m); });
      }
      if (a.timed && m.t.turnsIn === a.timed.turn) boost(m, a.timed.stats, m);
      if (m.vol.selfChip) hurt(m, m.maxhp * m.vol.selfChip, 'from the armour');
      if (m.vol.kakuja) hurt(m, m.maxhp / 16, 'from the kakuja');
      if (B.duos && a.atk.some(w => w.duos)) { const al = allyOf(m); if (al) hurt(al, al.maxhp / 16, 'from its partner'); }
      if (B.duos && a.healer) { const al = allyOf(m); if (al?.status && r() < a.healer) al.status = null; }
      if (m.fainted) continue;
      if (m.vol.countdown === B.turn) { say(nm(m), "'s countdown ends"); m.hp = 0; faint(m, foesOf(m)[0]); continue; }
      if (m.vol.yawn === B.turn) { m.vol.yawn = 0; inflict(m, 'sleep', null); }
      // timers
      if (m.vol.trapped > 0) m.vol.trapped--;
      if (m.vol.taunt > 0) m.vol.taunt--;
      if (m.vol.encore && --m.vol.encore.turns <= 0) m.vol.encore = null;
      if (m.vol.suppressed > 0) m.vol.suppressed--;
      if (m.vol.lockOn > 0 && m.vol.lockOnSet !== B.turn) m.vol.lockOn--;
      m.vol.protect = null; m.vol.followMe = 0; m.vol.helped = false;
      if (m.vol.protectTurn !== B.turn) m.vol.protectChain = 0;
      if (m.vol.actedTurn === B.turn) m.once.quickDrawn = true;
    }
    for (const s of B.sides) {
      for (const k of Object.keys(s.screens)) if (--s.screens[k] <= 0) delete s.screens[k];
      if (s.tailwind > 0) s.tailwind--;
    }
    if (B.field && --B.field.turns <= 0) { say('the field fades'); B.field = null; }
  }

  // ---- stats tracking ----
  function track(m, mv) {
    return m.t.moves[mv.id] || (m.t.moves[mv.id] = { uses: 0, hits: 0, dmg: 0, kos: 0, crits: 0, misses: 0, sup: 0 });
  }

  // Shared with the AI so it can estimate damage and read the state.
  const api = { calc, effectiveness, moveType, speed, effPriority, foesOf, allyOf, bench, actives, abOf, defAb, canSwitch, pct, blocks, basePower };
  B.api = api;

  // ---- main loop ----
  const slots = duos ? 2 : 1;
  for (const s of B.sides) for (let k = 0; k < slots; k++) {
    const m = s.mons[k];
    if (m) { s.active[k] = m; m.vol = { entryTurn: 0 }; m.t.entries++; m.t.turnsIn = 0; }
  }
  // Entry abilities of the leads, faster first.
  [...actives(B.sides[0]), ...actives(B.sides[1])].sort((x, y) => speed(y) - speed(x)).forEach(m => { say(nm(m), 'leads'); entryAbility(m); });

  while (!B.over) {
    B.turn++;
    if (B.turn > RULES.turnCap) { B.over = true; B.winner = -1; break; }
    const acts = [];
    for (const s of B.sides) for (const m of actives(s)) {
      const act = chooseAction(B, m, api);
      act.m = m;
      if (act.type === 'move') m.vol.plannedAttack = m.moves[act.slot]?.m.cat !== 'Status';
      acts.push(act);
    }
    const order = a => a.type === 'switch' ? 10 : effPriority(a.m, a.m.moves[a.slot]);
    acts.forEach(a => { a.pri = order(a); a.spd = speed(a.m, foesOf(a.m).some(f => abOf(f).targetLock)); a.tie = r(); if (a.m.vol.slowTurn === B.turn) a.pri -= 9; });
    const tr = B.field?.trickRoom ? -1 : 1;
    acts.sort((x, y) => (y.pri - x.pri) || (tr * (y.spd - x.spd)) || (y.tie - x.tie));
    for (const a of acts) {
      const m = a.m;
      if (m.fainted || !m.side.active.includes(m)) continue;
      if (a.type === 'switch') {
        if (a.to.fainted || m.side.active.includes(a.to)) continue;
        const slot = switchOut(m);
        switchIn(a.to, slot, 'switch');
        continue;
      }
      const target = a.target && !a.target.fainted ? a.target : null;
      useMove(m, a.slot, target);
      m.vol.movedTurn = B.turn;
      if (m.moves[a.slot]?.m.cat !== 'Status') m.vol.lastAttackTurn = B.turn;
      if (m.vol.extraTurn === B.turn && !m.fainted && m.side.active.includes(m)) {
        m.vol.extraTurn = 0;
        const again = chooseAction(B, m, api);
        if (again.type === 'move') useMove(m, again.slot, again.target);
      }
      if (B.sides.some(s => !alive(s).length)) break;
    }
    endTurn();
    // winner?
    const left = B.sides.map(s => alive(s).length);
    if (!left[0] || !left[1]) { B.over = true; B.winner = left[0] ? 0 : left[1] ? 1 : -1; break; }
    // replace knocked-out characters
    for (const s of B.sides) for (let k = 0; k < slots; k++) {
      const m = s.active[k];
      if ((!m || m.fainted) && bench(s).length) { s.active[k] = null; bringIn(s, k, 'faint'); }
    }
    const left2 = B.sides.map(s => alive(s).length);
    if (!left2[0] || !left2[1]) { B.over = true; B.winner = left2[0] ? 0 : left2[1] ? 1 : -1; }
  }
  return B;
}

