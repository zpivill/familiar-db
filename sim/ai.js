// The battle AI: a quick one-turn lookahead that scores every legal move and switch with simple
// heuristics, plus a little noise so the same matchup doesn't always play out the same way.
// Both sides use the same AI with full knowledge, so differences in results come from the characters.

import { archetypeById } from './archetypes.js';

const STATS = ['pow', 'grd', 'ene', 'wil', 'spe'];
// Weights of the scoring below, in one place so sim/tune.mjs can search for better ones. These are the
// tuned values from 2026-10-29 (hand-set before; the old ones live on in sim/bots/ai-v1.js).
// Scale: an attack is worth the share of the target's Vitality it takes x 100.
export const W = {
  noise: 0.166,        // each score x random (1 - noise/2) to (1 + noise/2), + up to 1
  ko: 73.7, koPriority: 32.7, statusChance: 8.03, flinch: 8.38, recoil: 39.2, recharge: 26.7,
  threat: 11.3, allyFinish: 16,                       // doubles targeting
  hhKo: 10.7, speedFlip: 27.1, protectSave: 310, protectAlly: 29, wideGuard: 0.321, followSetup: 40.6, followSave: 81.2,
  setup: 1.78, heal: 85.9, statusMove: 0.934, tailwind: 56.6, trickRoom: 57.5, screen: 29.9, protect: 6,
  statusScale: 1.47,   // every status move's total score
  switchBad: -0.369, switchGain: 1.43, switchP: 0.696,
  overkill: 0.389, combo: 15.2,                     // joint side actions
};

const avgHits = (fx, ab) => !fx.hits ? 1 : ab.skillLink ? fx.hits[1] : fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2;

function immune(api, u, mv, t) {
  const ta = api.defAb(t, u, mv), type = api.moveType(u, mv, t);
  return ta.immune.some(im => (im.type && im.type === type) || (im.cat && im.cat === mv.m.cat) || (im.flag && mv.flags[im.flag]));
}

// Expected damage of a move as a share of the target's max Vitality (can exceed 1).
// api.cache (set by the engine while both sides choose their moves, when nothing changes) keeps each
// move-target estimate so the AI's many repeat looks cost nothing.
export function estDamage(api, u, mv, t) {
  const c = api.cache;
  if (!c) return estDamageNow(api, u, mv, t);
  let row = c.get(mv);
  if (!row) c.set(mv, row = new Map());
  let d = row.get(t);
  if (d === undefined) row.set(t, d = estDamageNow(api, u, mv, t));
  return d;
}
function estDamageNow(api, u, mv, t) {
  const fx = mv.m.fx;
  if (mv.m.cat === 'Status' || fx.counter || fx.nothing) return 0;
  if (immune(api, u, mv, t)) return 0;
  const type = api.moveType(u, mv, t);
  if (api.effectiveness(u, mv, t, type, false) === 0 && !fx.fixed) return 0;
  let d = api.calc(u, t, mv, { est: true }) * avgHits(fx, api.abOf(u));
  const acc = mv.m.accuracy == null || fx.neverMiss || api.abOf(u).neverMiss === true ? 1 : mv.m.accuracy / 100 * (api.abOf(u).accMult || 1);
  return d * acc / t.maxhp;
}

export const usable = (m, mv) => {
  if (mv.pp <= 0) return false;
  if (m.vol.taunt > 0 && mv.m.cat === 'Status') return false;
  if (m.vol.encore && mv.id !== m.vol.encore.id) return false;
  if (mv.m.fx.noRepeat && m.vol.prevMove === mv.id) return false;
  if (m.vol.choice && mv.id !== m.vol.choice && m.moves.some(x => x.id === m.vol.choice && x.pp > 0)) return false;
  if (mv.m.cat === 'Status' && m.item?.id === 'battle-coat') return false;
  return true;
};

function bestHit(api, u, t) {
  let best = 0;
  for (const mv of u.moves) if (mv.pp > 0) best = Math.max(best, estDamage(api, u, mv, t));
  return best;
}

// Whether u has a move that knocks f out before f moves (priority, or faster; Trick Room reverses Speed).
// shortcut: ignores f's own priority moves, fine while few characters carry both.
function koFirst(B, api, u, f) {
  const first = api.speed(u) !== api.speed(f) && (api.speed(u) > api.speed(f)) !== !!B.field?.trickRoom;
  return u.moves.some(mv => mv.pp > 0 && estDamage(api, u, mv, f) >= Math.max(1, f.hp) / f.maxhp && (first || api.effPriority(u, mv) > 0));
}

// How well a character does against a foe: what it deals minus what it takes, with Speed as a tiebreak.
function matchup(api, m, f) {
  const deal = Math.min(1.2, bestHit(api, m, f) * f.maxhp / Math.max(1, f.hp));
  const take = Math.min(1.2, bestHit(api, f, m) * m.maxhp / Math.max(1, m.hp));
  const faster = api.speed(m) > api.speed(f) ? 0.15 : -0.05;
  return deal - take + faster;
}

// Speed of a side for speed control: the characters on the field, plus a lighter weight for the back.
function sideSpeed(B, api, side) {
  const on = api.actives(side), back = api.bench(side);
  const avg = xs => xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : 0;
  return on.length ? avg(on.map(m => api.speed(m))) * 0.7 + (back.length ? avg(back.map(m => m.raw.spe)) : avg(on.map(m => api.speed(m)))) * 0.3 : 0;
}

// Doubles support moves, on the same scale as attacks (share of a foe's Vitality x 100, +55 for a knockout),
// so the AI weighs what the move does for the side this turn and the next few against just attacking.
// Added on top of statusValue's base score. Without this, an attack outscores Protect, Tailwind or
// Helping Hand almost every turn and battles become pure damage races.
function duosSupportValue(B, api, u, mv, foes) {
  const fx = mv.m.fx, a = api.abOf(u), al = api.allyOf(u);
  const ally = al && !al.fainted ? al : null;
  const left = f => Math.max(1, f.hp) / f.maxhp;
  let v = 0;
  if (fx.helpingHand && ally) {
    // the ally's best hit gets 1.5x: worth the extra damage, and more if that turns a hit into a knockout
    let best = 0;
    for (const f of foes) {
      const h = bestHit(api, ally, f);
      best = Math.max(best, Math.min(h * 0.5, left(f)) * 100 + (h < left(f) && h * 1.5 >= left(f) ? W.hhKo : 0));
    }
    v += best;
  }
  const mine = [...api.actives(u.side).map(m => [m, 1]), ...api.bench(u.side).map(m => [m, 0.5])];
  const flips = (mult, reverse) => {
    let n = 0;
    for (const [m, w] of mine) for (const f of foes) {
      const now = api.speed(m) > api.speed(f), after = reverse ? api.speed(m) < api.speed(f) : api.speed(m) * mult > api.speed(f);
      n += (after && !now ? 1 : !after && now ? -1 : 0) * w;
    }
    return n;
  };
  if (fx.tailwind && !u.side.tailwind) v += Math.max(0, flips(2, false)) * W.speedFlip;
  if (fx.field?.trickRoom && !B.field?.trickRoom) v += Math.max(0, flips(1, true)) * W.speedFlip;
  const chained = (u.vol.protectChain || 0) && !fx.protect?.repeat && !a.protectAlways;
  if (fx.protect && !chained) {
    // both foes can knock it out between them (or one alone can): protecting buys a turn for the ally.
    // A foe it can knock out before that foe moves is no threat: hitting it beats protecting from it.
    const threats = foes.filter(f => !koFirst(B, api, u, f));
    const one = Math.max(0, ...threats.map(f => bestHit(api, f, u))), both = threats.reduce((n, f) => n + bestHit(api, f, u), 0);
    if (one >= left(u) || (foes.length > 1 && both >= left(u))) {
      v += W.protectSave;
      if (ally) v += W.protectAlly + (foes.some(f => bestHit(api, ally, f) >= left(f)) ? 15 : 0);
    }
  }
  if (fx.wideGuard) {
    // the spread hits it would stop this turn, if the foes use them (about half the time)
    const mine = api.actives(u.side);
    for (const f of foes) {
      let best = 0;
      for (const fm of f.moves) {
        if (fm.pp <= 0 || fm.m.cat === 'Status' || !(fm.m.fx.spread || api.abOf(f).spreadType === fm.m.type)) continue;
        best = Math.max(best, mine.reduce((n, m) => n + Math.min(estDamage(api, f, fm, m) * 0.75, left(m)), 0));
      }
      v += best * 100 * W.wideGuard;
    }
  }
  if (fx.followMe && ally) {
    // redirection + setup: draw the hits while the ally boosts
    const allySetup = ally.moves.some(x => x.pp > 0 && x.m.cat === 'Status' && x.m.fx.boosts?.some(b => b.who === 'self' && Object.values(b.stats).some(n => n >= 2)));
    const main = ally.raw.pow >= ally.raw.ene ? 'pow' : 'ene';
    if (allySetup && (ally.boosts[main] || 0) < 2) v += W.followSetup;
    const allyRisk = Math.max(...foes.map(f => bestHit(api, f, ally) / left(ally))), myRisk = Math.max(...foes.map(f => bestHit(api, f, u) / left(u)));
    if (allyRisk >= 1 && myRisk < 1) v += W.followSave;
  }
  return v;
}

const stageMult = n => n >= 0 ? (2 + n) / 2 : 2 / (2 - n);
// Turns of attacking a setup move buys before the user is knocked out, at most 3: how much of its Vitality
// the foes take per turn (in doubles the second foe counts half, since both rarely aim at it), minus the
// turn spent setting up. Redirection from the ally, screens or a faster side add a turn of safety.
function setupTurns(B, api, u, foes) {
  const hits = foes.map(f => bestHit(api, f, u)).sort((x, y) => y - x);
  const per = (hits[0] || 0) + (hits[1] || 0) * 0.5;
  const left = u.hp / u.maxhp;
  let turns = per > 0 ? left / per - 1 : 3;
  const al = B.duos ? api.allyOf(u) : null;
  if (al && !al.fainted && al.moves.some(x => x.m.fx.followMe && x.pp > 0)) turns++;
  if (u.side.screens && Object.values(u.side.screens).some(x => x)) turns++;
  if (foes.every(f => api.speed(u) > api.speed(f))) turns += 0.5;
  return Math.max(0, Math.min(3, turns));
}

function statusValue(B, api, u, mv, foes) {
  const fx = mv.m.fx, a = api.abOf(u);
  const foe = foes[0];
  if (!foe) return 0;
  const threat = Math.max(...foes.map(f => bestHit(api, f, u) * u.maxhp / Math.max(1, u.hp)));
  const hp = api.pct(u);
  let v = 0;
  if (fx.duosOnly && !B.duos) return -5;
  if (fx.nothing) return -5;
  if (fx.boosts) {
    const main = u.moves.some(x => x.m.cat === 'Physical') && u.raw.pow >= u.raw.ene ? 'pow' : 'ene';
    // Raising the main attacking stat pays off on every later attack, not just this turn: score it as the
    // extra damage it adds over the turns the user is likely to stay in (see setupTurns).
    let other = 0;
    const turns = setupTurns(B, api, u, foes);
    for (const b of fx.boosts) {
      if (b.who === 'self' || b.who === 'team' || b.who === 'ally') {
        for (const [k, n] of Object.entries(b.stats)) {
          const kk = k === 'highest' ? main : k;
          const cur = u.boosts[kk] || 0;
          if (kk === main && b.who === 'self' && !a.contrary) {
            const best = Math.max(...foes.map(f => Math.min(bestHit(api, u, f), 1)));
            const gain = stageMult(Math.min(6, cur + n)) / stageMult(cur) - 1;
            v += best * 100 * gain * turns * W.setup * (b.p ?? 1);
            continue;
          }
          const w = kk === main ? 16 : kk === 'spe' ? 12 : kk === 'pow' || kk === 'ene' ? 3 : 8;
          other += n * w * (cur >= 4 ? 0 : cur >= 2 ? 0.5 : 1) * (a.contrary ? -1 : 1);
        }
      } else if (b.who === 'foe' || b.who === 'foes') {
        for (const [k, n] of Object.entries(b.stats)) other += -n * 7 * (foe.boosts[k] <= -4 ? 0 : 1);
      }
    }
    other *= threat > 0.6 ? 0.25 : threat > 0.35 ? 0.6 : 1;
    if (hp < 0.5) other *= 0.5;
    v += other;
  }
  if (fx.heal) {
    const miss = 1 - hp;
    v += miss < 0.25 ? 0 : miss * W.heal * (a.healMult || 1);
    if (fx.restSleep) v -= 15;
  }
  if (fx.cure && u.status) v += 20;
  if (fx.status) {
    const k = fx.status.kind;
    const open = foes.filter(f => !f.status && !api.blocks(f, k) && !(f.vol.sub));
    const base = { sleep: 45, freeze: 45, stun: api.speed(foe) > api.speed(u) ? 38 : 26, burn: foe.raw.pow > foe.raw.ene ? 38 : 18, curse: foe.raw.ene > foe.raw.pow ? 38 : 18, bleed: 32 }[k] || 20;
    v += open.length * base * W.statusMove * ((mv.m.accuracy || 100) / 100);
  }
  if (fx.confuseFoes) v += foes.filter(f => !(f.vol.confuse > 0)).length * 18;
  if (fx.hazard) {
    const h = B.sides[1 - u.side.i].hazards, left = B.sides[1 - u.side.i].mons.filter(x => !x.fainted).length;
    const set = fx.hazard === 'spikes' ? h.spikes >= 3 : h[fx.hazard];
    v += set || left < 2 ? 0 : 12 + 6 * left;
  }
  if (fx.screen) v += u.side.screens[fx.screen] ? 0 : W.screen;
  // speed control: in duos it's worth what it does for the whole side, not just the user
  const mySpd = B.duos ? sideSpeed(B, api, u.side) : api.speed(u), foeSpd = B.duos ? sideSpeed(B, api, foe.side) : api.speed(foe);
  if (fx.tailwind) v += u.side.tailwind ? 0 : mySpd < foeSpd ? (B.duos ? W.tailwind : 28) : 8;
  if (fx.field) {
    const f = fx.field, cur = B.field;
    if (f.trickRoom) v += cur?.trickRoom ? (mySpd > foeSpd ? 25 : -20) : mySpd < foeSpd ? (B.duos ? W.trickRoom : 32) : -10;
    else if (f.boostType) v += cur?.boostType === f.boostType ? 0 : u.moves.some(x => x.m.type === f.boostType && x.m.cat !== 'Status') ? 22 : 4;
    else if (f.foeSlow) v += cur?.foeSlow ? 0 : api.speed(u) < api.speed(foe) ? 26 : 6;
    else if (f.gravity) v += cur?.gravity ? 0 : a.atk.some(w => w.gravity) ? 35 : 5;
    else v += cur ? 0 : 10;
    if (f.sideHeal) v += 6;
  }
  if (fx.protect) {
    v += (u.vol.protectChain || 0) && !fx.protect.repeat && !a.protectAlways ? -10 : W.protect;
    if (foe.vol.charging || foe.status === 'bleed' || foe.status === 'burn' || foe.vol.seed || foe.vol.bind) v += 15;
    if (a.endTurn.some(o => o.op === 'heal')) v += 6;
    if (u.vol.countdown) v += 0;
    if (fx.heal) v += (1 - hp) * 40;
    // duos: both foes can hit it hard this turn, or the ally can land a knockout while it waits
    if (B.duos && !((u.vol.protectChain || 0) && !fx.protect.repeat && !a.protectAlways)) {
      const incoming = foes.reduce((n, f) => n + bestHit(api, f, u) * u.maxhp / Math.max(1, u.hp), 0);
      if (incoming >= 1 && threat < 1) v += 16;
      const al = api.allyOf(u);
      if (al && foes.some(f => bestHit(api, al, f) * f.maxhp >= f.hp)) v += 5;
    }
  }
  if (fx.endure) v += hp > 0.9 ? 2 : 4;
  if (fx.substitute) v += !u.vol.sub && hp > 0.55 ? (threat > 0.5 ? 4 : 18) : -10;
  if (fx.taunt) v += foe.moves.some(x => x.m.cat === 'Status') && !(foe.vol.taunt > 0) ? 12 : 1;
  if (fx.encore) v += foe.vol.lastMove && foe.moves.find(x => x.id === foe.vol.lastMove)?.m.cat === 'Status' ? 22 : 2;
  if (fx.forceSwitch) v += STATS.reduce((n, k) => n + Math.max(0, foe.boosts[k]), 0) * 8 + (B.sides[foe.side.i].hazards.spikes || B.sides[foe.side.i].hazards.rocks ? 8 : 2);
  if (fx.haze) v += foes.reduce((n, f) => n + STATS.reduce((s, k) => s + Math.max(0, f.boosts[k]), 0), 0) * 8 - STATS.reduce((s, k) => s + Math.max(0, u.boosts[k]), 0) * 8;
  if (fx.painSplit) v += Math.max(0, (foe.hp - u.hp) / 2 / u.maxhp * 100);
  if (fx.wish) v += (1 - hp) * 50;
  if (fx.aquaRing) v += u.vol.aquaRing ? -5 : 10;
  if (fx.revive) v += u.side.mons.some(x => x.fainted && !x.once.revivedByMove) ? 40 : -5;
  if (fx.countdown) v += foe.vol.countdown || api.blocks(foe, 'countdown') ? -5 : 30;
  if (fx.trap) v += api.blocks(foe, 'trap') || foe.vol.trapped ? 1 : 8;
  if (fx.yawn) v += foe.status ? 0 : 20;
  if (fx.seed) v += foe.vol.seed ? 0 : 20;
  if (fx.steal) v += STATS.reduce((n, k) => n + Math.max(0, foe.boosts[k]), 0) * 12;
  if (fx.clearFoeBoosts) v += STATS.reduce((n, k) => n + Math.max(0, foe.boosts[k]), 0) * 9;
  if (fx.extraTurn) v += 30;
  if (fx.metronome) v += 15;
  if (fx.switchOut) v += B.sides[u.side.i].mons.some(x => !x.fainted && !u.side.active.includes(x)) ? (threat > 0.6 ? 18 : 4) : -10;
  if (fx.helpingHand || fx.followMe) v += B.duos ? 14 : 0;
  if (fx.charged) v += u.moves.some(x => x.m.type === 'Lightning' && x.m.cat !== 'Status') ? 10 : 2;
  if (fx.lockOn) v += 3;
  if (fx.destinyBond) v += hp < 0.3 && api.speed(u) > api.speed(foe) ? 30 : 0;
  if (fx.selfDmg && hp <= fx.selfDmg + 0.05) v = -20;
  if (v === 0) v = 3;
  return v;
}

function attackValue(B, api, u, mv, t, foesN) {
  const fx = mv.m.fx;
  const a = api.abOf(u);
  if (fx.firstTurn && u.t.turnsIn > 0) return -50;
  let d;
  if (fx.counter) {
    const fb = Math.max(...t.moves.filter(x => x.pp > 0 && x.m.cat === (fx.counter.cat || x.m.cat)).map(x => estDamage(api, t, x, u)), 0);
    d = fb * u.maxhp < u.hp ? fb * u.maxhp * fx.counter.mult / t.maxhp * 0.6 : 0;
  } else d = estDamage(api, u, mv, t);
  if (fx.delayed) d *= 0.6;
  if (fx.charge) d *= fx.charge.invuln ? 0.7 : 0.55;
  if (fx.sucker) d *= 0.65;
  const share = Math.min(d, t.hp / t.maxhp);
  let v = share * 100;
  const ko = d >= t.hp / t.maxhp;
  if (ko) {
    v += W.ko;
    if (api.effPriority(u, mv) > 0 && api.speed(u) < api.speed(t)) v += W.koPriority;
  }
  if (d === 0) return -30;
  // side effects worth something
  if (fx.status && !t.status && !ko) v += (fx.status.p || 0) * W.statusChance;
  if (fx.flinch && !ko && api.speed(u) > api.speed(t)) v += fx.flinch * W.flinch;
  if (fx.firstTurn && fx.flinch) v += 20;
  for (const b of fx.boosts || []) {
    const n = Object.values(b.stats).reduce((s, x) => s + x, 0);
    if (b.who === 'self') v += n * (n > 0 ? 5 : ko ? 1 : 3) * b.p;
    if (b.who === 'foe' || b.who === 'foes') v += -n * 4 * b.p;
  }
  if (fx.recoil) v -= fx.recoil * Math.min(d * t.maxhp, t.hp) / u.maxhp * W.recoil;
  if (fx.selfDmg) v -= fx.selfDmg * 70;
  if (fx.recharge && !ko) v -= W.recharge * fx.recharge;
  if (fx.selfConfuse) v -= 12;
  if (fx.switchOut) v += 3;
  if (fx.drain || a.drain) v += (fx.drain || 0.25) * share * 30;
  if (foesN > 1 && fx.spread) v *= 0.85;
  return v;
}

// Duos targeting: lean toward the foe that threatens this side most, and toward a knockout the ally
// can finish this turn. Worked out once per foe, since it doesn't depend on the move.
function duosTargets(api, u, foes) {
  const mine = api.actives(u.side), al = api.allyOf(u);
  return new Map(foes.map(t => [t, {
    threat: Math.min(1.2, Math.max(...mine.map(x => bestHit(api, t, x) * x.maxhp / Math.max(1, x.hp)))) * W.threat,
    ally: al ? bestHit(api, al, t) : 0,
  }]));
}
function duosTargetBonus(api, u, mv, t, info) {
  const left = t.hp / t.maxhp, d = estDamage(api, u, mv, t);
  return info.threat + (info.ally && d < left && d + info.ally >= left ? W.allyFinish : 0);
}

// A side forced to play an archetype (side.plan, from a meta chain's archetype round) puts its plan up first.
function planBonus(B, m, mv) {
  const plan = m.side.plan && archetypeById(m.side.plan)?.plan;
  return plan && plan(mv.m.fx, B, m.side) ? 45 : 0;
}

// Every option for m this turn with its score (noise included), best first. A forced move, a switch or
// "nothing usable" comes back as the only option.
export function options(B, m, api) {
  const r = B.r;
  const forced = m.vol.recharge > 0 || m.vol.charging || m.vol.rampage;
  if (forced) {
    const id = m.vol.charging || m.vol.rampage?.id;
    const i = id ? m.moves.findIndex(x => x.id === id) : 0;
    return [{ type: 'move', slot: Math.max(0, i), score: 0 }];
  }
  const foes = api.foesOf(m);
  const list = [];
  let tInfo = null;
  const consider = (act, score) => { list.push({ ...act, score: score * (1 - W.noise / 2 + r() * W.noise) + r() }); };
  m.moves.forEach((mv, i) => {
    if (!usable(m, mv, i)) return;
    if (mv.m.cat === 'Status') return consider({ type: 'move', slot: i, target: foes[0] }, (statusValue(B, api, m, mv, foes) + (B.duos && foes.length ? duosSupportValue(B, api, m, mv, foes) : 0)) * W.statusScale + planBonus(B, m, mv));
    const fx = mv.m.fx;
    if (B.duos && (fx.spread || api.abOf(m).spreadType === mv.m.type)) {
      let v = 0;
      for (const f of foes) v += attackValue(B, api, m, mv, f, foes.length) * 0.75;
      if (fx.spread === 'all') { const al = api.allyOf(m); if (al && !al.fainted) v -= estDamage(api, m, mv, al) * 120; }
      return consider({ type: 'move', slot: i, target: foes[0] }, v);
    }
    for (const f of foes) {
      let v = attackValue(B, api, m, mv, f, foes.length);
      if (B.duos && v > 0) v += duosTargetBonus(api, m, mv, f, (tInfo || (tInfo = duosTargets(api, m, foes))).get(f));
      consider({ type: 'move', slot: i, target: f }, v);
    }
  });
  if (!list.length) {
    // nothing usable: use whatever still has PP, or the first move
    const i = Math.max(0, m.moves.findIndex(x => x.pp > 0));
    return [{ type: 'move', slot: i, target: foes[0], score: 0 }];
  }
  list.sort((x, y) => y.score - x.score);
  const best = list[0];
  // switching
  const bench = api.bench(m.side);
  if (bench.length && foes.length && api.canSwitch(m) && m.t.turnsIn >= 1) {
    const here = Math.min(...foes.map(f => matchup(api, m, f)));
    let pick = null, pickV = -9;
    for (const b of bench) { const v = Math.min(...foes.map(f => matchup(api, b, f))) - 0.12; if (v > pickV) { pickV = v; pick = b; } }
    const doomed = m.vol.countdown && m.vol.countdown - B.turn <= 1;
    // a lost matchup: the foes knock it out this turn, it does little back, and someone on the bench does well here
    const hits = foes.map(f => bestHit(api, f, m) * m.maxhp / Math.max(1, m.hp));
    const lost = here < W.switchBad && pickV > 0 && (Math.max(...hits) >= 1 || (foes.length > 1 && hits[0] + hits[1] >= 1));
    // a Choice item locked into a move that does little here is a good reason to switch
    const stuck = m.vol.choice && best.score < 25;
    if (pick && (doomed || lost || (here < W.switchBad && pickV > here + W.switchGain && r() < W.switchP) || (stuck && pickV > here + 0.2 && r() < 0.8))) return [{ type: 'switch', to: pick, score: best.score }];
  }
  return list;
}

// How many of each character's best options the side looks at together in doubles.
const JOINT = 4;
// What two moves on one side do together that their own scores miss. A hit on a foe the partner's hit
// already knocks out goes to the other foe instead, often with the wrong move; two hits that only knock
// out together are worth a knockout; and a doubled side move (two Tailwinds, two of the same screen,
// Helping Hand next to a partner that isn't attacking) does nothing the second time.
function pairValue(api, m1, a1, m2, a2) {
  if (a1.type === 'switch' || a2.type === 'switch') return a1.type === a2.type && a1.to === a2.to ? -1e6 : 0;
  const mv1 = m1.moves[a1.slot], mv2 = m2.moves[a2.slot];
  if (!mv1 || !mv2) return 0;
  const f1 = mv1.m.fx, f2 = mv2.m.fx, hit1 = mv1.m.cat !== 'Status', hit2 = mv2.m.cat !== 'Status';
  let v = 0;
  if (f1.helpingHand && !hit2) v -= a1.score;
  if (f2.helpingHand && !hit1) v -= a2.score;
  if ((f1.tailwind && f2.tailwind) || (f1.field && f2.field) || (f1.screen && f1.screen === f2.screen) || (f1.followMe && f2.followMe)) v -= Math.min(a1.score, a2.score);
  const t = a1.target;
  if (hit1 && hit2 && t && t === a2.target && !f1.spread && !f2.spread && !api.abOf(m1).spreadType && !api.abOf(m2).spreadType) {
    const left = t.hp / t.maxhp, d1 = estDamage(api, m1, mv1, t), d2 = estDamage(api, m2, mv2, t);
    if (d1 >= left || d2 >= left) v -= Math.min(a1.score, a2.score) * W.overkill;
    else if (d1 + d2 >= left) v += W.combo;
  }
  return v;
}

// In doubles, while both sides choose (api.cache is set), the first character asked plans the whole side:
// the best pair from each one's top options, scored together, kept for the partner's turn to ask.
export function chooseAction(B, m, api) {
  if (!B.duos || !api.cache) return options(B, m, api)[0];
  const P = m.side.jointPlan;
  if (P && P.turn === B.turn && P.acts.has(m)) return P.acts.get(m);
  const team = api.actives(m.side);
  if (team.length < 2) return options(B, m, api)[0];
  const [L1, L2] = team.map(x => options(B, x, api).slice(0, JOINT));
  let best = null, bv = -Infinity;
  for (const a1 of L1) for (const a2 of L2) {
    const v = a1.score + a2.score + pairValue(api, team[0], a1, team[1], a2);
    if (v > bv) { bv = v; best = [a1, a2]; }
  }
  m.side.jointPlan = { turn: B.turn, acts: new Map([[team[0], best[0]], [team[1], best[1]]]) };
  return m.side.jointPlan.acts.get(m);
}

export function chooseReplacement(B, side, options, api) {
  const foes = api.actives(B.sides[1 - side.i]);
  if (!foes.length) return options[0];
  let pick = options[0], pv = -99;
  for (const b of options) {
    const v = Math.min(...foes.map(f => matchup(api, b, f))) + B.r() * 0.1;
    if (v > pv) { pv = v; pick = b; }
  }
  return pick;
}
