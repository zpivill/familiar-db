// The battle AI: a quick one-turn lookahead that scores every legal move and switch with simple
// heuristics, plus a little noise so the same matchup doesn't always play out the same way.
// Both sides use the same AI with full knowledge, so differences in results come from the characters.

const STATS = ['pow', 'grd', 'ene', 'wil', 'spe'];
const NOISE = 0.3;

const avgHits = (fx, ab) => !fx.hits ? 1 : ab.skillLink ? fx.hits[1] : fx.hits[0] === 2 && fx.hits[1] === 5 ? 3.1 : (fx.hits[0] + fx.hits[1]) / 2;

function immune(api, u, mv, t) {
  const ta = api.defAb(t, u, mv), type = api.moveType(u, mv, t);
  return ta.immune.some(im => (im.type && im.type === type) || (im.cat && im.cat === mv.m.cat) || (im.flag && mv.flags[im.flag]));
}

// Expected damage of a move as a share of the target's max Vitality (can exceed 1).
export function estDamage(api, u, mv, t) {
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
    for (const b of fx.boosts) {
      if (b.who === 'self' || b.who === 'team' || b.who === 'ally') {
        for (const [k, n] of Object.entries(b.stats)) {
          const kk = k === 'highest' ? main : k;
          const cur = u.boosts[kk] || 0;
          const w = kk === main ? 16 : kk === 'spe' ? 12 : kk === 'pow' || kk === 'ene' ? 3 : 8;
          v += n * w * (cur >= 4 ? 0 : cur >= 2 ? 0.5 : 1) * (a.contrary ? -1 : 1);
        }
      } else if (b.who === 'foe' || b.who === 'foes') {
        for (const [k, n] of Object.entries(b.stats)) v += -n * 7 * (foe.boosts[k] <= -4 ? 0 : 1);
      }
    }
    v *= threat > 0.6 ? 0.25 : threat > 0.35 ? 0.6 : 1;
    if (hp < 0.5) v *= 0.5;
  }
  if (fx.heal) {
    const miss = 1 - hp;
    v += miss < 0.25 ? 0 : miss * 90 * (a.healMult || 1);
    if (fx.restSleep) v -= 15;
  }
  if (fx.cure && u.status) v += 20;
  if (fx.status) {
    const k = fx.status.kind;
    const open = foes.filter(f => !f.status && !api.blocks(f, k) && !(f.vol.sub));
    const base = { sleep: 45, freeze: 45, stun: api.speed(foe) > api.speed(u) ? 38 : 26, burn: foe.raw.pow > foe.raw.ene ? 38 : 18, curse: foe.raw.ene > foe.raw.pow ? 38 : 18, bleed: 32 }[k] || 20;
    v += open.length * base * ((mv.m.accuracy || 100) / 100);
  }
  if (fx.confuseFoes) v += foes.filter(f => !(f.vol.confuse > 0)).length * 18;
  if (fx.hazard) {
    const h = B.sides[1 - u.side.i].hazards, left = B.sides[1 - u.side.i].mons.filter(x => !x.fainted).length;
    const set = fx.hazard === 'spikes' ? h.spikes >= 3 : h[fx.hazard];
    v += set || left < 2 ? 0 : 12 + 6 * left;
  }
  if (fx.screen) v += u.side.screens[fx.screen] ? 0 : 20;
  // speed control: in duos it's worth what it does for the whole side, not just the user
  const mySpd = B.duos ? sideSpeed(B, api, u.side) : api.speed(u), foeSpd = B.duos ? sideSpeed(B, api, foe.side) : api.speed(foe);
  if (fx.tailwind) v += u.side.tailwind ? 0 : mySpd < foeSpd ? (B.duos ? 34 : 28) : 8;
  if (fx.field) {
    const f = fx.field, cur = B.field;
    if (f.trickRoom) v += cur?.trickRoom ? (mySpd > foeSpd ? 25 : -20) : mySpd < foeSpd ? (B.duos ? 38 : 32) : -10;
    else if (f.boostType) v += cur?.boostType === f.boostType ? 0 : u.moves.some(x => x.m.type === f.boostType && x.m.cat !== 'Status') ? 22 : 4;
    else if (f.foeSlow) v += cur?.foeSlow ? 0 : api.speed(u) < api.speed(foe) ? 26 : 6;
    else if (f.gravity) v += cur?.gravity ? 0 : a.atk.some(w => w.gravity) ? 35 : 5;
    else v += cur ? 0 : 10;
    if (f.sideHeal) v += 6;
  }
  if (fx.protect) {
    v += (u.vol.protectChain || 0) && !fx.protect.repeat && !a.protectAlways ? -10 : 6;
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
    v += 55;
    if (api.effPriority(u, mv) > 0 && api.speed(u) < api.speed(t)) v += 30;
  }
  if (d === 0) return -30;
  // side effects worth something
  if (fx.status && !t.status && !ko) v += (fx.status.p || 0) * 18;
  if (fx.flinch && !ko && api.speed(u) > api.speed(t)) v += fx.flinch * 14;
  if (fx.firstTurn && fx.flinch) v += 20;
  for (const b of fx.boosts || []) {
    const n = Object.values(b.stats).reduce((s, x) => s + x, 0);
    if (b.who === 'self') v += n * (n > 0 ? 5 : ko ? 1 : 3) * b.p;
    if (b.who === 'foe' || b.who === 'foes') v += -n * 4 * b.p;
  }
  if (fx.recoil) v -= fx.recoil * Math.min(d * t.maxhp, t.hp) / u.maxhp * 60;
  if (fx.selfDmg) v -= fx.selfDmg * 70;
  if (fx.recharge && !ko) v -= 25 * fx.recharge;
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
    threat: Math.min(1.2, Math.max(...mine.map(x => bestHit(api, t, x) * x.maxhp / Math.max(1, x.hp)))) * 12,
    ally: al ? bestHit(api, al, t) : 0,
  }]));
}
function duosTargetBonus(api, u, mv, t, info) {
  const left = t.hp / t.maxhp, d = estDamage(api, u, mv, t);
  return info.threat + (info.ally && d < left && d + info.ally >= left ? 15 : 0);
}

export function chooseAction(B, m, api) {
  const r = B.r;
  const forced = m.vol.recharge > 0 || m.vol.charging || m.vol.rampage;
  if (forced) {
    const id = m.vol.charging || m.vol.rampage?.id;
    const i = id ? m.moves.findIndex(x => x.id === id) : 0;
    return { type: 'move', slot: Math.max(0, i) };
  }
  const foes = api.foesOf(m);
  let best = { type: 'move', slot: 0, target: foes[0], score: -1e9 };
  let tInfo = null;
  const consider = (act, score) => { const s = score * (1 - NOISE / 2 + r() * NOISE) + r(); if (s > best.score) best = { ...act, score: s }; };
  m.moves.forEach((mv, i) => {
    if (!usable(m, mv, i)) return;
    if (mv.m.cat === 'Status') return consider({ type: 'move', slot: i, target: foes[0] }, statusValue(B, api, m, mv, foes));
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
  if (best.score < -1e8) {
    // nothing usable: use whatever still has PP, or the first move
    const i = Math.max(0, m.moves.findIndex(x => x.pp > 0));
    return { type: 'move', slot: i, target: foes[0] };
  }
  // switching
  const bench = api.bench(m.side);
  if (bench.length && foes.length && api.canSwitch(m) && m.t.turnsIn >= 1) {
    const here = Math.min(...foes.map(f => matchup(api, m, f)));
    let pick = null, pickV = -9;
    for (const b of bench) { const v = Math.min(...foes.map(f => matchup(api, b, f))) - 0.12; if (v > pickV) { pickV = v; pick = b; } }
    const doomed = m.vol.countdown && m.vol.countdown - B.turn <= 1;
    // a Choice item locked into a move that does little here is a good reason to switch
    const stuck = m.vol.choice && best.score < 25;
    if (pick && (doomed || (here < -0.45 && pickV > here + 0.5 && r() < 0.7) || (stuck && pickV > here + 0.2 && r() < 0.8))) return { type: 'switch', to: pick };
  }
  return best;
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
