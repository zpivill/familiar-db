// The battle AI, a port of sim/ai.js (weights W as tuned on 2026-10-29). Same scores and the same random
// draws in the same order as the JS AI, so battles match.

use crate::battle::*;
use crate::data::*;
use crate::rules::{stage_mult, HELMET, POLICY, LIFE_ORB_COST};

#[derive(Debug)]
pub struct Weights {
    pub noise: f64, pub ko: f64, pub ko_priority: f64, pub status_chance: f64, pub flinch: f64, pub recoil: f64, pub recharge: f64,
    pub threat: f64, pub ally_finish: f64, pub hh_ko: f64, pub speed_flip: f64, pub protect_save: f64, pub protect_ally: f64,
    pub wide_guard: f64, pub follow_setup: f64, pub follow_save: f64, pub setup: f64, pub heal: f64, pub status_move: f64,
    pub tailwind: f64, pub trick_room: f64, pub screen: f64, pub protect: f64, pub status_scale: f64, pub switch_bad: f64,
    pub switch_gain: f64, pub switch_p: f64, pub overkill: f64, pub combo: f64, pub predict_protect: f64,
    pub switch_spread: f64, pub switch_next: f64, pub switch_cost: f64, pub switch_ko: f64,
}
pub const W: Weights = Weights {
    noise: 0.166, ko: 73.7, ko_priority: 32.7, status_chance: 8.03, flinch: 8.38, recoil: 39.2, recharge: 26.7,
    threat: 11.3, ally_finish: 16.0, hh_ko: 10.7, speed_flip: 27.1, protect_save: 310.0, protect_ally: 29.0, wide_guard: 0.321,
    follow_setup: 40.6, follow_save: 81.2, setup: 1.78, heal: 85.9, status_move: 0.934, tailwind: 56.6, trick_room: 57.5,
    screen: 29.9, protect: 6.0, status_scale: 1.47, switch_bad: -0.369, switch_gain: 1.43, switch_p: 0.696, overkill: 0.389, combo: 15.2,
    predict_protect: 0.8, switch_spread: 0.6, switch_next: 1.0, switch_cost: 40.0, switch_ko: 73.7,
};

fn max_of(xs: impl Iterator<Item = f64>) -> f64 { xs.fold(f64::NEG_INFINITY, |a, b| if b > a { b } else { a }) }
fn min_of(xs: impl Iterator<Item = f64>) -> f64 { xs.fold(f64::INFINITY, |a, b| if b < a { b } else { a }) }
// Math.max(a, b) and Math.min(a, b) for two numbers (no NaNs here)
#[inline] fn mx(a: f64, b: f64) -> f64 { if b > a { b } else { a } }
#[inline] fn mn(a: f64, b: f64) -> f64 { if b < a { b } else { a } }

fn avg_hits(fx: &Fx, ab: &Ability) -> f64 {
    match fx.hits { None => 1.0, Some(h) => if ab.skill_link { h[1] as f64 } else if h[0] == 2 && h[1] == 5 { 3.1 } else { (h[0] + h[1]) as f64 / 2.0 } }
}
fn immune(b: &Battle, u: MonId, mv: &MoveSlot, t: MonId) -> bool {
    let ta = b.def_ab(t, Some(u), Some(mv)); let ty = b.move_type(u, mv, Some(t)); let m = b.mv(mv);
    ta.immune.iter().any(|im| im.r#type == Some(ty) || im.cat == Some(m.cat) || im.flag.as_ref().map_or(false, |f| mv.flags.get(f)))
}

// Expected damage of u's move in `slot` on t, as a share of t's max Vitality (can exceed 1), cached while both sides choose.
pub fn est_damage(b: &mut Battle, u: MonId, slot: usize, t: MonId) -> f64 {
    let n = b.mons.len();
    let key = (u * 8 + slot) * n + t;
    if let Some(c) = &b.cache { let v = c[key]; if !v.is_nan() { return v; } }
    let v = est_damage_now(b, u, slot, t);
    if let Some(c) = &mut b.cache { c[key] = v; }
    v
}
fn est_damage_now(b: &mut Battle, u: MonId, slot: usize, t: MonId) -> f64 {
    let mv = b.mons[u].moves[slot];
    let m = b.mv(&mv); let fx = &m.fx;
    if m.cat == Cat::Status || fx.counter.is_some() || fx.nothing { return 0.0; }
    if immune(b, u, &mv, t) { return 0.0; }
    let ty = b.move_type(u, &mv, Some(t));
    if b.effectiveness(u, &mv, t, ty, false) == 0.0 && fx.fixed.is_none() { return 0.0; }
    let ua = b.ab_of(u);
    let d = b.calc(u, t, &mv, false, false, true, None, None) * avg_hits(fx, ua);
    let acc = if m.accuracy.is_none() || fx.never_miss || ua.never_miss == Tag::On { 1.0 } else { m.accuracy.unwrap() / 100.0 * if ua.acc_mult != 0.0 { ua.acc_mult } else { 1.0 } };
    d * acc / b.mons[t].maxhp
}

pub fn usable(b: &Battle, m: MonId, slot: usize) -> bool {
    let x = &b.mons[m]; let mv = &x.moves[slot]; let mm = b.mv(mv);
    if mv.pp <= 0 { return false; }
    if x.vol.taunt > 0 && mm.cat == Cat::Status { return false; }
    if let Some((_, id)) = x.vol.encore { if mv.mv != id { return false; } }
    if mm.fx.no_repeat && x.vol.prev_move == Some(mv.mv) { return false; }
    if let Some(c) = x.vol.choice { if mv.mv != c && x.moves.iter().any(|y| y.mv == c && y.pp > 0) { return false; } }
    if mm.cat == Cat::Status && matches!(x.item, Some(i) if i.id == I_COAT) { return false; }
    true
}

// est_damage for knockout checks (ai.js hitDamage): a target at full Vitality with an unused Last Thread (or Sturdy)
// hangs on at 1 against a single hit. Not for the v1 bot, which predates it.
fn hit_damage(b: &mut Battle, u: MonId, slot: usize, t: MonId) -> f64 {
    let d = est_damage(b, u, slot, t);
    let (th, tm) = (b.mons[t].hp, b.mons[t].maxhp);
    let mv = b.mons[u].moves[slot];
    if v1(b) || d < th / tm || th < tm || b.mv(&mv).fx.hits.is_some() { return d; }
    if b.held(t, I_LAST_THREAD) || b.def_ab(t, Some(u), Some(&mv)).sturdy { (th - 1.0) / tm } else { d }
}
fn has(b: &Battle, m: MonId, id: u8) -> bool { matches!(b.mons[m].item, Some(i) if i.id == id) }

fn best_hit(b: &mut Battle, u: MonId, t: MonId) -> f64 {
    let mut best = 0.0;
    for s in 0..b.mons[u].moves.len() { if b.mons[u].moves[s].pp > 0 { best = mx(best, hit_damage(b, u, s, t)); } }
    best
}
// Whether u has a move that knocks f out before f moves (priority, or faster; Trick Room reverses Speed), as ai.js koFirst.
// shortcut: ignores f's own priority moves, fine while few characters carry both.
fn ko_first(b: &mut Battle, u: MonId, f: MonId) -> bool {
    let (su, sf) = (b.speed(u, false), b.speed(f, false));
    let first = su != sf && (su > sf) != b.field.as_ref().map_or(false, |x| x.fx.trick_room);
    let left = mx(1.0, b.mons[f].hp) / b.mons[f].maxhp;
    for s in 0..b.mons[u].moves.len() {
        if b.mons[u].moves[s].pp > 0 && hit_damage(b, u, s, f) >= left && (first || { let mv = b.mons[u].moves[s]; b.eff_priority(u, Some(&mv)) > 0.0 }) { return true; }
    }
    false
}
// How well a character does against a foe: what it deals minus what it takes, with Speed as a tiebreak.
fn matchup(b: &mut Battle, m: MonId, f: MonId) -> f64 {
    let deal = mn(1.2, best_hit(b, m, f) * b.mons[f].maxhp / mx(1.0, b.mons[f].hp));
    let take = mn(1.2, best_hit(b, f, m) * b.mons[m].maxhp / mx(1.0, b.mons[m].hp));
    let faster = if b.speed(m, false) > b.speed(f, false) { 0.15 } else { -0.05 };
    deal - take + faster
}
fn avg(xs: &[f64]) -> f64 { if xs.is_empty() { 0.0 } else { xs.iter().fold(0.0, |n, x| n + x) / xs.len() as f64 } }
fn side_speed(b: &Battle, s: usize) -> f64 {
    let on = b.actives(s); let back = b.bench(s);
    if on.is_empty() { return 0.0; }
    let ons: Vec<f64> = on.iter().map(|&m| b.speed(m, false)).collect();
    let backs: Vec<f64> = back.iter().map(|&m| b.mons[m].raw[SPE]).collect();
    avg(&ons) * 0.7 + (if !back.is_empty() { avg(&backs) } else { avg(&ons) }) * 0.3
}

fn duos_support_value(b: &mut Battle, u: MonId, slot: usize, foes: &[MonId], pred: Option<&Pred>) -> f64 {
    let mv = b.mons[u].moves[slot]; let fx = &b.mv(&mv).fx; let a = b.ab_of(u);
    let ally = b.ally_of(u).filter(|&al| !b.mons[al].fainted);
    let left = |b: &Battle, f: MonId| mx(1.0, b.mons[f].hp) / b.mons[f].maxhp;
    let mut v = 0.0;
    if fx.helping_hand { if let Some(al) = ally {
        let mut best = 0.0;
        for &f in foes {
            let h = best_hit(b, al, f); let l = left(b, f);
            best = mx(best, mn(h * 0.5, l) * 100.0 + if h < l && h * 1.5 >= l { b.w.hh_ko } else { 0.0 });
        }
        v += best;
    } }
    let us = b.mons[u].side;
    let mut mine: Vec<(MonId, f64)> = b.actives(us).into_iter().map(|m| (m, 1.0)).collect();
    mine.extend(b.bench(us).into_iter().map(|m| (m, 0.5)));
    let flips = |b: &Battle, mult: f64, reverse: bool| {
        let mut n = 0.0;
        for &(m, w) in &mine { for &f in foes {
            let (sm, sf) = (b.speed(m, false), b.speed(f, false));
            let now = sm > sf; let after = if reverse { sm < sf } else { sm * mult > sf };
            n += (if after && !now { 1.0 } else if !after && now { -1.0 } else { 0.0 }) * w;
        } }
        n
    };
    if fx.tailwind != 0 && b.sides[us].tailwind == 0 { v += mx(0.0, flips(b, 2.0, false)) * b.w.speed_flip; }
    if fx.field.as_ref().map_or(false, |f| f.trick_room) && !b.field.as_ref().map_or(false, |f| f.fx.trick_room) { v += mx(0.0, flips(b, 1.0, true)) * b.w.speed_flip; }
    let chained = b.mons[u].vol.protect_chain != 0 && !fx.protect.as_ref().map_or(false, |p| p.repeat) && !a.protect_always;
    if fx.protect.is_some() && !chained {
        // a foe it can knock out before that foe moves is no threat: hitting it beats protecting from it
        let mut hits: Vec<f64> = vec![];
        // a foe expected to Protect or use a status move this turn (pred) won't hit it either
        for &f in foes { if v1(b) || (!ko_first(b, u, f) && pred_of(pred, f).map_or(true, |x| x.2)) { hits.push(best_hit(b, f, u)); } }
        let one = hits.iter().fold(0.0, |n: f64, &x| mx(n, x)); let both = hits.iter().fold(0.0, |n, x| n + x);
        let lu = left(b, u);
        if one >= lu || (foes.len() > 1 && both >= lu) {
            v += b.w.protect_save;
            if let Some(al) = ally {
                let mut k = false;
                for &f in foes { if best_hit(b, al, f) >= left(b, f) { k = true; break; } }
                v += b.w.protect_ally + if k { 15.0 } else { 0.0 };
            }
        }
    }
    if fx.wide_guard {
        let mine = b.actives(us);
        for &f in foes {
            let mut best = 0.0;
            for fs in 0..b.mons[f].moves.len() {
                let fm = b.mons[f].moves[fs]; let fmm = b.mv(&fm);
                if fm.pp <= 0 || fmm.cat == Cat::Status || !(fmm.fx.spread.is_some() || b.ab_of(f).spread_type == Some(fmm.ty)) { continue; }
                let mut s = 0.0;
                for &m in &mine { let e = est_damage(b, f, fs, m); s += mn(e * 0.75, left(b, m)); }
                best = mx(best, s);
            }
            v += best * 100.0 * b.w.wide_guard;
        }
    }
    if fx.follow_me { if let Some(al) = ally {
        let d = b.d;
        let x = &b.mons[al];
        let ally_setup = x.moves.iter().any(|s| { let m = &d.moves[s.mv]; s.pp > 0 && m.cat == Cat::Status && m.fx.boosts.as_ref().map_or(false, |bs| bs.iter().any(|bb| bb.who == "self" && bb.stats.iter().any(|&(_, n)| n >= 2))) });
        let main = if x.raw[POW] >= x.raw[ENE] { POW } else { ENE };
        if ally_setup && x.boosts[main] < 2 { v += b.w.follow_setup; }
        let mut ally_risk = f64::NEG_INFINITY; let mut my_risk = f64::NEG_INFINITY;
        for &f in foes { let r = best_hit(b, f, al) / left(b, al); ally_risk = mx(ally_risk, r); }
        for &f in foes { let r = best_hit(b, f, u) / left(b, u); my_risk = mx(my_risk, r); }
        if ally_risk >= 1.0 && my_risk < 1.0 { v += b.w.follow_save; }
    } }
    v
}

// Turns of attacking a setup move buys before the user is knocked out, at most 3.
fn setup_turns(b: &mut Battle, u: MonId, foes: &[MonId]) -> f64 {
    let mut hits: Vec<f64> = foes.iter().map(|&f| best_hit(b, f, u)).collect();
    hits.sort_by(|x, y| js_cmp(y - x));
    let per = hits.first().copied().unwrap_or(0.0) + hits.get(1).copied().unwrap_or(0.0) * 0.5;
    let left = b.mons[u].hp / b.mons[u].maxhp;
    let mut turns = if per > 0.0 { left / per - 1.0 } else { 3.0 };
    let al = if b.duos { b.ally_of(u) } else { None };
    if let Some(al) = al { if !b.mons[al].fainted && b.mons[al].moves.iter().any(|x| b.mv(x).fx.follow_me && x.pp > 0) { turns += 1.0; } }
    if b.sides[b.mons[u].side].screens.any() { turns += 1.0; }
    if foes.iter().all(|&f| b.speed(u, false) > b.speed(f, false)) { turns += 0.5; }
    mx(0.0, mn(3.0, turns))
}

fn status_value(b: &mut Battle, u: MonId, slot: usize, foes: &[MonId]) -> f64 {
    let d = b.d;
    let mv = b.mons[u].moves[slot]; let m = &d.moves[mv.mv]; let fx = &m.fx; let a = b.ab_of(u);
    let foe = match foes.first() { Some(&f) => f, None => return 0.0 };
    let mut threat = f64::NEG_INFINITY;
    for &f in foes { let x = best_hit(b, f, u) * b.mons[u].maxhp / mx(1.0, b.mons[u].hp); threat = mx(threat, x); }
    let hp = b.pct(u);
    let mut v = 0.0;
    if fx.duos_only && !b.duos { return -5.0; }
    if fx.nothing { return -5.0; }
    let us = b.mons[u].side;
    if let Some(bs) = &fx.boosts {
        let main = if b.mons[u].moves.iter().any(|x| d.moves[x.mv].cat == Cat::Physical) && b.mons[u].raw[POW] >= b.mons[u].raw[ENE] { POW } else { ENE };
        let mut other = 0.0;
        let turns = setup_turns(b, u, foes);
        for bb in bs {
            if bb.who == "self" || bb.who == "team" || bb.who == "ally" {
                for &(k, n) in &bb.stats {
                    let kk = if k == HIGHEST { main } else { k };
                    let cur = b.mons[u].boosts[kk];
                    if kk == main && bb.who == "self" && !a.contrary {
                        let mut best = f64::NEG_INFINITY;
                        for &f in foes { let h = mn(best_hit(b, u, f), 1.0); best = mx(best, h); }
                        let gain = stage_mult((cur + n).min(6)) / stage_mult(cur) - 1.0;
                        v += best * 100.0 * gain * turns * b.w.setup * bb.p;
                        continue;
                    }
                    let w = if kk == main { 16.0 } else if kk == SPE { 12.0 } else if kk == POW || kk == ENE { 3.0 } else { 8.0 };
                    other += n as f64 * w * (if cur >= 4 { 0.0 } else if cur >= 2 { 0.5 } else { 1.0 }) * if a.contrary { -1.0 } else { 1.0 };
                }
            } else if bb.who == "foe" || bb.who == "foes" {
                for &(k, n) in &bb.stats { let low = (k < 5 && b.mons[foe].boosts[k] <= -4) || (!v1(b) && n < 0 && has(b, foe, I_AMULET)); other += -(n as f64) * 7.0 * if low { 0.0 } else { 1.0 }; }
            }
        }
        other *= if threat > 0.6 { 0.25 } else if threat > 0.35 { 0.6 } else { 1.0 };
        if hp < 0.5 { other *= 0.5; }
        v += other;
    }
    if fx.heal != 0.0 {
        let miss = 1.0 - hp;
        v += if miss < 0.25 { 0.0 } else { miss * b.w.heal * if a.heal_mult != 0.0 { a.heal_mult } else { 1.0 } };
        if fx.rest_sleep { v -= 15.0; }
    }
    if fx.cure.on() && b.mons[u].status.is_some() { v += 20.0; }
    if let Some(st) = &fx.status {
        let k = st.kind.as_str();
        let open = foes.iter().filter(|&&f| b.mons[f].status.is_none() && !b.blocks(f, k) && b.mons[f].vol.sub == 0.0 && !(!v1(b) && b.held(f, I_PANACEA))).count();
        let fo = &b.mons[foe];
        let base = match k { "sleep" => 45.0, "freeze" => 45.0, "stun" => if b.speed(foe, false) > b.speed(u, false) { 38.0 } else { 26.0 },
            "burn" => if fo.raw[POW] > fo.raw[ENE] { 38.0 } else { 18.0 }, "curse" => if fo.raw[ENE] > fo.raw[POW] { 38.0 } else { 18.0 }, "bleed" => 32.0, _ => 20.0 };
        v += open as f64 * base * b.w.status_move * (m.accuracy.filter(|&x| x != 0.0).unwrap_or(100.0) / 100.0);
    }
    if fx.confuse_foes { v += foes.iter().filter(|&&f| !(b.mons[f].vol.confuse > 0)).count() as f64 * 18.0; }
    if let Some(hz) = &fx.hazard {
        let h = b.sides[1 - us].hazards; let left = b.alive_n(1 - us);
        let set = match hz.as_str() { "spikes" => h.spikes >= 3, "rocks" => h.rocks != 0, "web" => h.web != 0, "rainbow" => h.rainbow != 0, _ => false };
        v += if set || left < 2 { 0.0 } else { 12.0 + 6.0 * left as f64 };
    }
    if let Some(sc) = &fx.screen { v += if b.sides[us].screens.get(sc) != 0 { 0.0 } else { b.w.screen }; }
    let my_spd = if b.duos { side_speed(b, us) } else { b.speed(u, false) };
    let foe_spd = if b.duos { side_speed(b, b.mons[foe].side) } else { b.speed(foe, false) };
    if fx.tailwind != 0 { v += if b.sides[us].tailwind != 0 { 0.0 } else if my_spd < foe_spd { if b.duos { b.w.tailwind } else { 28.0 } } else { 8.0 }; }
    if let Some(f) = &fx.field {
        let cur = b.field.as_ref().map(|x| &x.fx);
        if f.trick_room { v += if cur.map_or(false, |c| c.trick_room) { if my_spd > foe_spd { 25.0 } else { -20.0 } } else if my_spd < foe_spd { if b.duos { b.w.trick_room } else { 32.0 } } else { -10.0 }; }
        else if let Some(bt) = f.boost_type { v += if cur.and_then(|c| c.boost_type) == Some(bt) { 0.0 } else if b.mons[u].moves.iter().any(|x| d.moves[x.mv].ty == bt && d.moves[x.mv].cat != Cat::Status) { 22.0 } else { 4.0 }; }
        else if f.foe_slow { v += if cur.map_or(false, |c| c.foe_slow) { 0.0 } else if b.speed(u, false) < b.speed(foe, false) { 26.0 } else { 6.0 }; }
        else if f.gravity { v += if cur.map_or(false, |c| c.gravity) { 0.0 } else if a.atk.iter().any(|w| w.gravity) { 35.0 } else { 5.0 }; }
        else { v += if cur.is_some() { 0.0 } else { 10.0 }; }
        if f.side_heal != 0.0 { v += 6.0; }
    }
    if let Some(pr) = &fx.protect {
        let chained = b.mons[u].vol.protect_chain != 0 && !pr.repeat && !a.protect_always;
        v += if chained { -10.0 } else { b.w.protect };
        let fv = &b.mons[foe];
        if fv.vol.charging.is_some() || fv.status == Some(St::Bleed) || fv.status == Some(St::Burn) || fv.vol.seed.is_some() || fv.vol.bind.is_some() { v += 15.0; }
        if a.end_turn.iter().any(|o| o.op == "heal") { v += 6.0; }
        if fx.heal != 0.0 { v += (1.0 - hp) * 40.0; }
        if b.duos && !chained {
            let mut incoming = 0.0;
            for &f in foes { incoming += best_hit(b, f, u) * b.mons[u].maxhp / mx(1.0, b.mons[u].hp); }
            if incoming >= 1.0 && threat < 1.0 { v += 16.0; }
            if let Some(al) = b.ally_of(u) {
                let mut k = false;
                for &f in foes { if best_hit(b, al, f) * b.mons[f].maxhp >= b.mons[f].hp { k = true; break; } }
                if k { v += 5.0; }
            }
        }
    }
    if fx.endure { v += if hp > 0.9 { 2.0 } else { 4.0 }; }
    if fx.substitute != 0.0 { v += if b.mons[u].vol.sub == 0.0 && hp > 0.55 { if threat > 0.5 { 4.0 } else { 18.0 } } else { -10.0 }; }
    let incense = !v1(b) && b.held(foe, I_INCENSE);
    let fo = &b.mons[foe];
    if fx.taunt != 0 { v += if fo.moves.iter().any(|x| d.moves[x.mv].cat == Cat::Status) && !(fo.vol.taunt > 0) && !incense { 12.0 } else { 1.0 }; }
    if fx.encore != 0 { v += if fo.vol.last_move.map_or(false, |lm| fo.moves.iter().find(|x| x.mv == lm).map_or(false, |x| d.moves[x.mv].cat == Cat::Status)) && !incense { 22.0 } else { 2.0 }; }
    let pos = |bo: &[i32; 5]| bo.iter().map(|&x| x.max(0)).sum::<i32>() as f64;
    if fx.force_switch { let hz = b.sides[fo.side].hazards; v += pos(&fo.boosts) * 8.0 + if hz.spikes != 0 || hz.rocks != 0 { 8.0 } else { 2.0 }; }
    if fx.haze { v += foes.iter().fold(0.0, |n, &f| n + pos(&b.mons[f].boosts)) * 8.0 - pos(&b.mons[u].boosts) * 8.0; }
    if fx.pain_split { v += mx(0.0, (fo.hp - b.mons[u].hp) / 2.0 / b.mons[u].maxhp * 100.0); }
    if fx.wish != 0.0 { v += (1.0 - hp) * 50.0; }
    if fx.aqua_ring { v += if b.mons[u].vol.aqua_ring { -5.0 } else { 10.0 }; }
    if fx.revive != 0.0 { v += if b.sides[us].mons.iter().any(|&x| b.mons[x].fainted && !b.mons[x].once.revived_by_move) { 40.0 } else { -5.0 }; }
    if fx.countdown.is_some() { v += if fo.vol.countdown != 0 || b.blocks(foe, "countdown") { -5.0 } else { 30.0 }; }
    if fx.trap != 0 { v += if b.blocks(foe, "trap") || fo.vol.trapped != 0 { 1.0 } else { 8.0 }; }
    if fx.yawn { v += if fo.status.is_some() { 0.0 } else { 20.0 }; }
    if fx.seed != 0.0 { v += if fo.vol.seed.is_some() { 0.0 } else { 20.0 }; }
    if fx.steal { v += pos(&fo.boosts) * 12.0; }
    if fx.clear_foe_boosts.is_some() { v += pos(&fo.boosts) * 9.0; }
    if fx.extra_turn { v += 30.0; }
    if fx.metronome { v += 15.0; }
    if fx.switch_out { v += if b.bench_n(us) > 0 { if threat > 0.6 { 18.0 } else { 4.0 } } else { -10.0 }; }
    if fx.helping_hand || fx.follow_me { v += if b.duos { 14.0 } else { 0.0 }; }
    if fx.charged { v += if b.mons[u].moves.iter().any(|x| d.moves[x.mv].ty == 5 && d.moves[x.mv].cat != Cat::Status) { 10.0 } else { 2.0 }; }
    if fx.lock_on.on() { v += 3.0; }
    if fx.destiny_bond { v += if hp < 0.3 && b.speed(u, false) > b.speed(foe, false) { 30.0 } else { 0.0 }; }
    if fx.self_dmg != 0.0 && hp <= fx.self_dmg + 0.05 { v = -20.0; }
    if v == 0.0 { v = 3.0; }
    v
}

fn attack_value(b: &mut Battle, u: MonId, slot: usize, t: MonId, foes_n: usize) -> f64 {
    let d_ = b.d;
    let mv = b.mons[u].moves[slot]; let m = &d_.moves[mv.mv]; let fx = &m.fx; let a = b.ab_of(u);
    if fx.first_turn && b.mons[u].t.turns_in > 0 { return -50.0; }
    let mut d;
    if let Some(ct) = &fx.counter {
        let mut fb = 0.0;
        let mut vals = vec![];
        for s in 0..b.mons[t].moves.len() {
            let x = b.mons[t].moves[s]; let xc = d_.moves[x.mv].cat;
            if x.pp > 0 && xc == ct.cat.unwrap_or(xc) { vals.push(est_damage(b, t, s, u)); }
        }
        for v in vals { fb = mx(fb, v); }
        let (um, uh, tm) = (b.mons[u].maxhp, b.mons[u].hp, b.mons[t].maxhp);
        d = if fb * um < uh { fb * um * ct.mult / tm * 0.6 } else { 0.0 };
    } else { d = hit_damage(b, u, slot, t); }
    if fx.delayed.is_some() { d *= 0.6; }
    if let Some(ch) = &fx.charge { d *= if ch.invuln { 0.7 } else { 0.55 }; }
    if fx.sucker { d *= 0.65; }
    let (th, tm) = (b.mons[t].hp, b.mons[t].maxhp);
    let share = mn(d, th / tm);
    let mut v = share * 100.0;
    let ko = d >= th / tm;
    if ko {
        v += b.w.ko;
        if b.eff_priority(u, Some(&mv)) > 0.0 && b.speed(u, false) < b.speed(t, false) { v += b.w.ko_priority; }
    }
    if d == 0.0 { return -30.0; }
    // side effects (ai.js): blocked by a Hooded Cloak, a status cured by a Panacea Leaf, drops stopped by a Clear Amulet
    let new = !v1(b);
    let cloak = new && has(b, t, I_CLOAK);
    if let Some(st) = &fx.status { if b.mons[t].status.is_none() && !ko && !cloak && !(new && b.held(t, I_PANACEA)) { v += st.p * b.w.status_chance; } }
    if fx.flinch != 0.0 && !ko && !cloak && b.speed(u, false) > b.speed(t, false) { v += fx.flinch * b.w.flinch; }
    if fx.first_turn && fx.flinch != 0.0 && !cloak { v += 20.0; }
    for bb in fx.boosts.as_deref().unwrap_or(&[]) {
        let n = bb.stats.iter().fold(0.0, |s, &(_, x)| s + x as f64);
        if bb.who == "self" { v += n * (if n > 0.0 { 5.0 } else if ko { 1.0 } else { 3.0 }) * bb.p; }
        if (bb.who == "foe" || bb.who == "foes") && !cloak && !(new && n < 0.0 && has(b, t, I_AMULET)) { v += -n * 4.0 * bb.p; }
    }
    if new {
        if mv.flags.contact && has(b, t, I_ARMOR) { v -= HELMET * b.w.recoil; }
        if !ko && b.held(t, I_POLICY) { let ty = b.move_type(u, &mv, Some(t)); if b.effectiveness(u, &mv, t, ty, false) > 1.0 { v -= 2.0 * POLICY as f64 * 4.0; } }
        if has(b, u, I_OVERDRIVE) { v -= LIFE_ORB_COST * b.w.recoil; }
    }
    if fx.recoil != 0.0 { v -= fx.recoil * mn(d * tm, th) / b.mons[u].maxhp * b.w.recoil; }
    if fx.self_dmg != 0.0 { v -= fx.self_dmg * 70.0; }
    if fx.recharge != 0 && !ko { v -= b.w.recharge * fx.recharge as f64; }
    if fx.self_confuse { v -= 12.0; }
    if fx.switch_out { v += 3.0; }
    if fx.drain != 0.0 || a.drain.is_some() { v += (if fx.drain != 0.0 { fx.drain } else { 0.25 }) * share * 30.0; }
    if foes_n > 1 && fx.spread.is_some() { v *= 0.85; }
    v
}

// Duos targeting: per foe, the threat it poses to this side and what the ally's best hit on it is.
fn duos_targets(b: &mut Battle, u: MonId, foes: &[MonId]) -> Vec<(MonId, f64, f64)> {
    let mine = b.actives(b.mons[u].side); let al = b.ally_of(u);
    let mut out = vec![];
    for &t in foes {
        let mut th = f64::NEG_INFINITY;
        for &x in &mine { let v = best_hit(b, t, x) * b.mons[x].maxhp / mx(1.0, b.mons[x].hp); th = mx(th, v); }
        let ally = match al { Some(al) => best_hit(b, al, t), None => 0.0 };
        out.push((t, mn(1.2, th) * b.w.threat, ally));
    }
    out
}
fn duos_target_bonus(b: &mut Battle, u: MonId, slot: usize, t: MonId, info: (f64, f64)) -> f64 {
    let left = b.mons[t].hp / b.mons[t].maxhp; let d = hit_damage(b, u, slot, t);
    info.0 + if info.1 != 0.0 && d < left && d + info.1 >= left { b.w.ally_finish } else { 0.0 }
}

// A side forced to play an archetype puts its plan up first (archetypes.js plan()).
fn plan_bonus(b: &Battle, m: MonId, slot: usize) -> f64 {
    let s = b.mons[m].side;
    let p = match b.sides[s].plan { Some(p) => p, None => return 0.0 };
    let fx = &b.mv(&b.mons[m].moves[slot]).fx;
    let cur = b.field.as_ref().map(|f| &f.fx);
    let field_plan = |ty: &str| { let t = type_id(ty); fx.field.as_ref().and_then(|f| f.boost_type) == Some(t) && cur.and_then(|c| c.boost_type) != Some(t) };
    let on = match b.d.archetypes[p].id.as_str() {
        "tailwind" => fx.tailwind != 0 && b.sides[s].tailwind == 0,
        "trickRoom" => fx.field.as_ref().map_or(false, |f| f.trick_room) && !cur.map_or(false, |c| c.trick_room),
        "fire" => field_plan("Fire"), "water" => field_plan("Water"), "lightning" => field_plan("Lightning"),
        "snow" => fx.field.as_ref().map_or(false, |f| f.snow) && !cur.map_or(false, |c| c.snow),
        "redirect" => fx.follow_me,
        "screens" => fx.screen.as_ref().map_or(false, |sc| b.sides[s].screens.get(sc) == 0),
        "gravity" => fx.field.as_ref().map_or(false, |f| f.gravity) && !cur.map_or(false, |c| c.gravity),
        "spread" => fx.helping_hand,
        _ => false,
    };
    if on { 45.0 } else { 0.0 }
}

// Every option for m this turn with its score (noise included), best first.
// The frozen v1 AI (sim/bots/ai-v1.js): the same scoring with its hand-set numbers, and no joint side plan.
pub static W_V1: Weights = Weights {
    noise: 0.3, ko: 55.0, ko_priority: 30.0, status_chance: 18.0, flinch: 14.0, recoil: 60.0, recharge: 25.0,
    threat: 12.0, ally_finish: 15.0, hh_ko: 45.0, speed_flip: 18.0, protect_save: 40.0, protect_ally: 10.0, wide_guard: 0.5,
    follow_setup: 35.0, follow_save: 45.0, setup: 0.8, heal: 90.0, status_move: 1.0, tailwind: 34.0, trick_room: 38.0,
    screen: 20.0, protect: 6.0, status_scale: 1.0, switch_bad: -0.45, switch_gain: 0.5, switch_p: 0.7, overkill: 0.0, combo: 0.0, predict_protect: 0.0,
    switch_spread: 0.0, switch_next: 0.0, switch_cost: 0.0, switch_ko: 0.0,
};
// The 2026-10-31 Protect and lost-matchup rules came after v1 (ai-v1.js doesn't have them).
fn v1(b: &Battle) -> bool { std::ptr::eq(b.w, &W_V1) }
pub fn v1_action(b: &mut Battle, m: MonId) -> Choice { let keep = b.w; b.w = &W_V1; let c = options(b, m)[0]; b.w = keep; c }
// the greedy bot (sim/bots/baselines.js): the hardest-hitting attack into the best target, never a status move or a switch
pub fn greedy_action(b: &mut Battle, m: MonId) -> Option<Act> {
    let foes = b.foes_of(m); let (mut best, mut bv) = (None, -1.0);
    for i in 0..b.mons[m].moves.len() {
        let mv = b.mv(&b.mons[m].moves[i]);
        if !usable(b, m, i) || mv.cat == Cat::Status { continue; }
        for &f in &foes { let v = est_damage(b, m, i, f) * if mv.fx.spread.is_some() { foes.len() as f64 * 0.75 } else { 1.0 }; if v > bv { bv = v; best = Some(Act::Move { slot: i, target: Some(f) }); } }
    }
    best
}

pub fn options(b: &mut Battle, m: MonId) -> Vec<Choice> { options_q(b, m, false) }

// Each foe's expected action this turn (ai.js predict): (foe, protects, attacks).
pub type Pred = Vec<(MonId, bool, bool)>;
fn pred_of(p: Option<&Pred>, f: MonId) -> Option<(MonId, bool, bool)> { p.and_then(|p| p.iter().find(|x| x.0 == f).copied()) }
fn predict(b: &mut Battle, s: usize) -> Pred {
    if let Some((t, p)) = &b.sides[s].pred { if *t == b.turn { return p.clone(); } }
    let mut map = vec![];
    for f in b.actives(1 - s) {
        let o = options_q(b, f, true)[0];
        let (pr, at) = match o.act { Act::Move { slot, .. } => match b.mons[f].moves.get(slot) { Some(ms) => { let mm = b.mv(ms); (mm.fx.protect.is_some(), mm.cat != Cat::Status) } None => (false, false) }, _ => (false, false) };
        map.push((f, pr, at));
    }
    b.sides[s].pred = Some((b.turn, map.clone()));
    map
}
// ai.js slotParts: (take, ko, deal) for x in this slot
fn slot_parts(b: &mut Battle, x: MonId, foes: &[MonId], pred: Option<&Pred>) -> (f64, bool, f64) {
    let w = if foes.len() > 1 { b.w.switch_spread } else { 1.0 }; let left = b.mons[x].hp / b.mons[x].maxhp;
    let mut hit = 0.0;
    for &f in foes { hit += if pred_of(pred, f).map_or(false, |p| !p.2) { 0.0 } else { best_hit(b, f, x) * w }; }
    let mut deal: f64 = 0.0;
    for &f in foes { for i in 0..b.mons[x].moves.len() { if usable(b, x, i) {
        let d = mn(1.0, hit_damage(b, x, i, f) * b.mons[f].maxhp / mx(1.0, b.mons[f].hp)); deal = mx(deal, d);
    } } }
    (mn(hit, left), hit >= left, deal)
}
fn switch_value(b: &Battle, x: (f64, bool, f64), y: (f64, bool, f64)) -> f64 {
    let save = b.w.switch_ko;
    100.0 * (x.0 - y.0) + (if x.1 && !y.1 { save } else if !x.1 && y.1 { -save } else { 0.0 }) + b.w.switch_next * 100.0 * (y.2 - x.2)
}
fn through_protect(b: &Battle, u: MonId, slot: usize) -> bool {
    let ms = b.mons[u].moves[slot]; let m = b.mv(&ms); let a = b.ab_of(u);
    m.fx.breaks_protect || (a.heavy_bypass && (m.size.as_deref() == Some("heavy") || ms.sig)) || (a.sig_bypass && ms.sig)
}

// quiet: the plain scores, no noise, no switching and no prediction (used to predict a foe).
pub fn options_q(b: &mut Battle, m: MonId, quiet: bool) -> Vec<Choice> {
    let x = &b.mons[m];
    if x.vol.recharge > 0 || x.vol.charging.is_some() || x.vol.rampage.is_some() {
        let id = x.vol.charging.or(x.vol.rampage.map(|r| r.0));
        let i = match id { Some(id) => x.moves.iter().position(|s| s.mv == id).unwrap_or(0), None => 0 };
        return vec![Choice { act: Act::Move { slot: i, target: None }, score: 0.0 }];
    }
    let foes = b.foes_of(m);
    let mut list: Vec<Choice> = vec![];
    let mut t_info: Option<Vec<(MonId, f64, f64)>> = None;
    let consider = |b: &mut Battle, list: &mut Vec<Choice>, act: Act, score: f64| {
        if quiet { list.push(Choice { act, score }); return; }
        let r1 = b.r.next(); let r2 = b.r.next();
        list.push(Choice { act, score: score * (1.0 - b.w.noise / 2.0 + r1 * b.w.noise) + r2 });
    };
    let pred = if !quiet && b.duos && b.cache.is_some() && !v1(b) { Some(predict(b, b.mons[m].side)) } else { None };
    // an attack into a foe expected to Protect is mostly wasted
    let guard = |b: &Battle, i: usize, f: MonId, v: f64| if v > 0.0 && pred_of(pred.as_ref(), f).map_or(false, |x| x.1) && !through_protect(b, m, i) { v * (1.0 - b.w.predict_protect) } else { v };
    for i in 0..b.mons[m].moves.len() {
        if !usable(b, m, i) { continue; }
        let mv = b.mons[m].moves[i]; let mm = b.mv(&mv);
        if mm.cat == Cat::Status {
            let sv = status_value(b, m, i, &foes);
            let ds = if b.duos && !foes.is_empty() { duos_support_value(b, m, i, &foes, pred.as_ref()) } else { 0.0 };
            let v = (sv + ds) * b.w.status_scale + plan_bonus(b, m, i);
            consider(b, &mut list, Act::Move { slot: i, target: foes.first().copied() }, v);
            continue;
        }
        let fx = &mm.fx;
        if b.duos && (fx.spread.is_some() || b.ab_of(m).spread_type == Some(mm.ty)) {
            let mut v = 0.0;
            for &f in &foes { let x = attack_value(b, m, i, f, foes.len()) * 0.75; v += guard(b, i, f, x); }
            if fx.spread.as_deref() == Some("all") { if let Some(al) = b.ally_of(m) { if !b.mons[al].fainted { v -= est_damage(b, m, i, al) * 120.0; } } }
            consider(b, &mut list, Act::Move { slot: i, target: foes.first().copied() }, v);
            continue;
        }
        for &f in &foes {
            let mut v = attack_value(b, m, i, f, foes.len());
            if b.duos && v > 0.0 {
                if t_info.is_none() { t_info = Some(duos_targets(b, m, &foes)); }
                let info = t_info.as_ref().unwrap().iter().find(|x| x.0 == f).map(|x| (x.1, x.2)).unwrap();
                v += duos_target_bonus(b, m, i, f, info);
            }
            let v = guard(b, i, f, v);
            consider(b, &mut list, Act::Move { slot: i, target: Some(f) }, v);
        }
    }
    if list.is_empty() {
        let i = b.mons[m].moves.iter().position(|x| x.pp > 0).unwrap_or(0);
        return vec![Choice { act: Act::Move { slot: i, target: foes.first().copied() }, score: 0.0 }];
    }
    let s = b.mons[m].side;
    let bench = b.bench(s);
    // switching scored on the moves' scale (ai.js, gap #8); v1 keeps its rule below
    if !v1(b) {
        if !quiet && !bench.is_empty() && !foes.is_empty() && b.can_switch(m) && b.mons[m].t.turns_in >= 1 {
            let stay = slot_parts(b, m, &foes, pred.as_ref());
            let (mut pick, mut pv) = (bench[0], f64::NEG_INFINITY);
            for &bb in &bench { let p = slot_parts(b, bb, &foes, pred.as_ref()); let v = switch_value(b, stay, p); if v > pv { pv = v; pick = bb; } }
            let x = &b.mons[m];
            let doomed = x.vol.countdown != 0 && x.vol.countdown - b.turn <= 1;
            let v = pv - b.w.switch_cost + if doomed { 200.0 } else { 0.0 };
            consider(b, &mut list, Act::Switch { to: pick }, v);
        }
        list.sort_by(|x, y| js_cmp(y.score - x.score));
        return list;
    }
    list.sort_by(|x, y| js_cmp(y.score - x.score));
    let best = list[0];
    if !quiet && !bench.is_empty() && !foes.is_empty() && b.can_switch(m) && b.mons[m].t.turns_in >= 1 {
        let mut here = f64::INFINITY;
        for &f in &foes { let v = matchup(b, m, f); here = mn(here, v); }
        let (mut pick, mut pick_v) = (None, -9.0);
        for &bb in &bench {
            let mut v = f64::INFINITY;
            for &f in &foes { let x = matchup(b, bb, f); v = mn(v, x); }
            let v = v - 0.12;
            if v > pick_v { pick_v = v; pick = Some(bb); }
        }
        let x = &b.mons[m];
        let doomed = x.vol.countdown != 0 && x.vol.countdown - b.turn <= 1;
        let stuck = x.vol.choice.is_some() && best.score < 25.0;
        // a lost matchup: the foes knock it out this turn, it does little back, and someone on the bench does well here
        let mut hits: Vec<f64> = vec![];
        for &f in &foes { let h = best_hit(b, f, m) * b.mons[m].maxhp / mx(1.0, b.mons[m].hp); hits.push(h); }
        let lost = !v1(b) && here < b.w.switch_bad && pick_v > 0.0 && (hits.iter().fold(f64::NEG_INFINITY, |n: f64, &x| mx(n, x)) >= 1.0 || (foes.len() > 1 && hits[0] + hits[1] >= 1.0));
        if let Some(p) = pick {
            let go = doomed || lost
                || (here < b.w.switch_bad && pick_v > here + b.w.switch_gain && b.r.next() < b.w.switch_p)
                || (stuck && pick_v > here + 0.2 && b.r.next() < 0.8);
            if go { return vec![Choice { act: Act::Switch { to: p }, score: best.score }]; }
        }
    }
    list
}

const JOINT: usize = 4;
fn pair_value(b: &mut Battle, m1: MonId, a1: &Choice, m2: MonId, a2: &Choice) -> f64 {
    let (s1, t1, s2, t2) = match (a1.act, a2.act) {
        (Act::Move { slot: s1, target: t1 }, Act::Move { slot: s2, target: t2 }) => (s1, t1, s2, t2),
        (Act::Switch { to: x }, Act::Switch { to: y }) => return if x == y { -1e6 } else { 0.0 },
        _ => return 0.0,
    };
    let (mv1, mv2) = match (b.mons[m1].moves.get(s1).copied(), b.mons[m2].moves.get(s2).copied()) { (Some(x), Some(y)) => (x, y), _ => return 0.0 };
    let (k1, k2) = (b.mv(&mv1), b.mv(&mv2));
    let (f1, f2) = (&k1.fx, &k2.fx);
    let (hit1, hit2) = (k1.cat != Cat::Status, k2.cat != Cat::Status);
    let mut v = 0.0;
    if f1.helping_hand && !hit2 { v -= a1.score; }
    if f2.helping_hand && !hit1 { v -= a2.score; }
    if (f1.tailwind != 0 && f2.tailwind != 0) || (f1.field.is_some() && f2.field.is_some()) || (f1.screen.is_some() && f1.screen == f2.screen) || (f1.follow_me && f2.follow_me) { v -= mn(a1.score, a2.score); }
    if let Some(t) = t1 { if hit1 && hit2 && Some(t) == t2 && f1.spread.is_none() && f2.spread.is_none() && b.ab_of(m1).spread_type.is_none() && b.ab_of(m2).spread_type.is_none() {
        let left = b.mons[t].hp / b.mons[t].maxhp; let d1 = hit_damage(b, m1, s1, t); let d2 = hit_damage(b, m2, s2, t);
        if d1 >= left || d2 >= left { v -= mn(a1.score, a2.score) * b.w.overkill; } else if d1 + d2 >= left { v += b.w.combo; }
    } }
    v
}

// In doubles, while both sides choose, the first character asked plans the whole side.
pub fn choose_action(b: &mut Battle, m: MonId) -> Choice {
    if !b.duos || b.cache.is_none() { return options(b, m)[0]; }
    let s = b.mons[m].side;
    if let Some((turn, acts)) = &b.sides[s].joint_plan { if *turn == b.turn { if let Some(a) = acts.iter().find(|x| x.0 == m) { return a.1; } } }
    let team = b.actives(s);
    if team.len() < 2 { return options(b, m)[0]; }
    let mut l1 = options(b, team[0]); l1.truncate(JOINT);
    let mut l2 = options(b, team[1]); l2.truncate(JOINT);
    let mut best = (l1[0], l2[0]); let mut bv = f64::NEG_INFINITY;
    for a1 in &l1 { for a2 in &l2 {
        let v = a1.score + a2.score + pair_value(b, team[0], a1, team[1], a2);
        if v > bv { bv = v; best = (*a1, *a2); }
    } }
    b.sides[s].joint_plan = Some((b.turn, [(team[0], best.0), (team[1], best.1)]));
    if team[0] == m { best.0 } else { best.1 }
}

pub fn choose_replacement(b: &mut Battle, s: usize, options: &[MonId]) -> MonId {
    let foes = b.actives(1 - s);
    if foes.is_empty() { return options[0]; }
    let (mut pick, mut pv) = (options[0], -99.0);
    for &o in options {
        let mut v = f64::INFINITY;
        for &f in &foes { let x = matchup(b, o, f); v = mn(v, x); }
        let v = v + b.r.next() * 0.1;
        if v > pv { pv = v; pick = o; }
    }
    pick
}
#[allow(dead_code)] fn _u() { let _ = (max_of(std::iter::empty()), min_of(std::iter::empty())); }
