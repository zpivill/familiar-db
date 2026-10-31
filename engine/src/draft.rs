// The competitive draft, a port of sim/draft.js (without the reasoning log, which only the page shows).

use crate::battle::{Build, Rng, js_cmp, I_COAT, I_OVERDRIVE, I_EMBLEM};
use crate::builds::kit;
use crate::data::*;
use crate::jsmath::{exp, tanh};
use crate::rules::*;

const TEMP: f64 = 0.06;
const KEEP: usize = 24;
const RISK: f64 = 0.35;
fn legend(r: &str) -> bool { r == "legendary" || r == "mythical" }

fn stats_of(d: &Data, b: &Build, level: f64) -> [f64; 6] {
    let st = d.entrants[b.e].stats.as_ref().unwrap();
    let ev = b.evs.unwrap_or([0.0; 6]); let iv = b.ivs.unwrap_or([IV; 6]); let nat = b.nature.unwrap_or_default();
    let mut o = [0.0; 6];
    o[0] = battle_stat(st.vit, level, true, ev[0], iv[0], 1.0);
    for k in 0..5 { o[k + 1] = battle_stat(st.get(k), level, false, ev[k + 1], iv[k + 1], nat.mult(k)); }
    if let Some(i) = b.item { if let Some(c) = i.choice() { o[c + 1] *= 1.5; } if i.id == I_COAT { o[4] *= 1.5; } }
    if let Some(m) = &d.abilities[b.ability].stat_mult { for k in 0..5 { o[k + 1] *= m.get(k).unwrap_or(1.0); } }
    o
}
// a's stats once both have entered: its own entry boosts and the foe t's entry drops (Intimidate and the like)
fn on_entry(d: &Data, s: &[f64; 6], a: &Build, t: &Build) -> [f64; 6] {
    let (ta, tt) = (&d.entrants[a.e].types, &d.entrants[t.e].types);
    let mut st = [0i32; 5];
    let mut add = |o: &Op| for &(k, v) in o.stats.iter().flatten() { if k < 5 { st[k] += v; } };
    for o in &d.abilities[a.ability].entry { if o.op == "self" && o.if_foe_type.map_or(true, |x| tt.contains(&x)) { add(o); } }
    for o in &d.abilities[t.ability].entry { if o.op == "foes" && o.only_type.map_or(true, |x| ta.contains(&x)) { add(o); } }
    let mut out = *s;
    for k in 0..5 { if st[k] != 0 { out[k + 1] *= stage_mult(st[k].clamp(-6, 6)); } }
    out
}
fn avg_hits(fx: &Fx) -> f64 { match fx.hits { None => 1.0, Some(h) => if h[0] == 2 && h[1] == 5 { 3.1 } else { (h[0] + h[1]) as f64 / 2.0 } } }

fn best_hit(d: &Data, a: &Build, sa: &[f64; 6], t: &Build, sd: &[f64; 6], level: f64) -> f64 {
    let imm = &d.abilities[t.ability].immune;
    let mut best = 0.0;
    for &(id, _) in &a.moves {
        let m = &d.moves[id];
        if m.cat == Cat::Status || !(m.power > 0.0) || m.fx.counter.is_some() || m.fx.nothing { continue; }
        if imm.iter().any(|im| im.r#type == Some(m.ty) || im.cat == Some(m.cat)) { continue; }
        let eff = type_eff(m.ty, &d.entrants[t.e].types);
        if eff == 0.0 { continue; }
        let phys = m.cat == Cat::Physical;
        let (aa, dd) = if phys { (sa[1], sd[2]) } else { (sa[3], sd[4]) };
        let mut dmg = ((((2.0 * level / 5.0 + 2.0).floor() * m.power * aa / dd.max(1.0)).floor()) / 50.0 + 2.0) * 0.925;
        dmg *= (if d.entrants[a.e].types.contains(&m.ty) { STAB } else { 1.0 }) * eff * avg_hits(&m.fx) * (m.accuracy.unwrap_or(100.0) / 100.0);
        if m.fx.charge.is_some() || m.fx.recharge != 0 { dmg *= 0.6; }
        if let Some(i) = a.item { if i.id == I_OVERDRIVE { dmg *= 1.3; } if i.id == I_EMBLEM && i.ty == Some(m.ty) { dmg *= 1.2; } }
        let x = dmg / sd[0];
        if x > best { best = x; }
    }
    best
}

fn matchups(d: &Data, mine: &[Build], theirs: &[Build], level: f64) -> Vec<Vec<f64>> {
    let sm: Vec<[f64; 6]> = mine.iter().map(|b| stats_of(d, b, level)).collect();
    let st: Vec<[f64; 6]> = theirs.iter().map(|b| stats_of(d, b, level)).collect();
    mine.iter().enumerate().map(|(i, a)| theirs.iter().enumerate().map(|(j, t)| {
        let (sa, sd) = (on_entry(d, &sm[i], a, t), on_entry(d, &st[j], t, a));
        let deal = best_hit(d, a, &sa, t, &sd, level); let take = best_hit(d, t, &sd, a, &sa, level);
        let ta = if deal > 0.0 { (9.0f64).min((1.0 / deal).ceil()) } else { 12.0 };
        let tb = if take > 0.0 { (9.0f64).min((1.0 / take).ceil()) } else { 12.0 };
        let spd = if sa[5] > sd[5] { 0.5 } else if sa[5] < sd[5] { -0.5 } else { 0.0 };
        tanh(0.7 * (tb - ta + spd))
    }).collect()).collect()
}

#[derive(Clone)]
struct Roles { tailwind: bool, trick_room: bool, redirect: bool, setup: bool, screens: bool, stab: Vec<Type>,
    fake_out: bool, intimidate: bool, helping: bool, follow: bool, field_types: Vec<Type>, spe: f64, attacker: bool }
fn roles(d: &Data, b: &Build) -> Roles {
    let k = kit(d, b);
    let ms: Vec<&Move> = b.moves.iter().map(|&(id, _)| &d.moves[id]).collect();
    let ab = &d.abilities[b.ability];
    let mut ft: Vec<Type> = vec![];
    for t in ms.iter().filter_map(|m| m.fx.field.as_ref().and_then(|f| f.boost_type)).chain(ab.entry.iter().filter(|o| o.op == "field").filter_map(|o| o.field.as_ref().and_then(|f| f.boost_type))) { if !ft.contains(&t) { ft.push(t); } }
    Roles {
        tailwind: k.tailwind, trick_room: k.trick_room, redirect: k.redirect, setup: k.setup, screens: k.screens, stab: k.stab.clone(),
        fake_out: ms.iter().any(|m| m.fx.first_turn && m.fx.flinch != 0.0), intimidate: ab.entry.iter().any(|o| o.op == "foes" && o.intimidate),
        helping: ms.iter().any(|m| m.fx.helping_hand), follow: ms.iter().any(|m| m.fx.follow_me), field_types: ft,
        spe: d.entrants[b.e].stats.as_ref().unwrap().spe, attacker: k.attacks >= 2,
    }
}

#[derive(Clone, Default)]
pub struct Syn { pub v: f64, pub kinds: Vec<(&'static str, i32)> }
fn synergy(d: &Data, a: &Build, b: &Build, ra: &Roles, rb: &Roles) -> Syn {
    let mut s = Syn::default();
    let one = |rx: &Roles, ry: &Roles, by: i32, s: &mut Syn| {
        if rx.tailwind && ry.attacker && ry.spe >= 55.0 && ry.spe <= 105.0 { s.v += 0.5; s.kinds.push(("tailwind", by)); }
        if rx.trick_room && ry.attacker && ry.spe <= 60.0 { s.v += 0.6; s.kinds.push(("trickRoom", by)); }
        if (rx.follow || rx.redirect) && ry.setup { s.v += 0.45; s.kinds.push(("redirect", by)); }
        else if rx.helping && ry.attacker { s.v += 0.3; s.kinds.push(("helping", by)); }
        for t in &rx.field_types { if ry.stab.contains(t) { s.v += 0.5; s.kinds.push(("field", by)); break; } }
        if rx.screens && ry.setup { s.v += 0.3; s.kinds.push(("screens", by)); }
    };
    one(ra, rb, 0, &mut s); one(rb, ra, 1, &mut s);
    let (ta, tb) = (&d.entrants[a.e].types, &d.entrants[b.e].types);
    let mut cover = 0;
    for t in 0..15u8 { let (ea, eb) = (type_eff(t, ta), type_eff(t, tb)); if (ea > 1.0 && eb < 1.0) || (eb > 1.0 && ea < 1.0) { cover += 1; } }
    if cover >= 2 { s.v += (0.4f64).min(cover as f64 * 0.1); s.kinds.push(("cover", -1)); }
    s
}
fn lead_bonus(r: &Roles) -> f64 { (if r.fake_out { 0.15 } else { 0.0 }) + (if r.tailwind || r.trick_room { 0.15 } else { 0.0 }) + (if r.intimidate { 0.1 } else { 0.0 }) + (if r.follow || r.redirect { 0.1 } else { 0.0 }) }

fn sixes(rar: &[bool], size: usize, cap: usize) -> Vec<Vec<usize>> {
    let mut out = vec![]; let mut cur = vec![]; let n = rar.len();
    fn go(start: usize, leg: usize, n: usize, size: usize, cap: usize, rar: &[bool], cur: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if cur.len() == size { out.push(cur.clone()); return; }
        let mut i = start;
        while i + (size - cur.len()) <= n {
            let l = if rar[i] { 1 } else { 0 };
            if leg + l <= cap { cur.push(i); go(i + 1, leg + l, n, size, cap, rar, cur, out); cur.pop(); }
            i += 1;
        }
    }
    go(0, 0, n, size, cap, rar, &mut cur, &mut out);
    out
}

fn team_score(m: &[Vec<f64>], team: &[usize], foes: &[usize], syn: &[Vec<f64>]) -> f64 {
    let (mut cov, mut tw, mut ex, mut st) = (0.0, 0.0, 0.0, 0.0);
    for &f in foes { let mut best = -1.0; for &a in team { if m[a][f] > best { best = m[a][f]; } } cov += best * 1.0; tw += 1.0; }
    for &a in team { let (mut worst, mut sum) = (1.0, 0.0); for &f in foes { let x = m[a][f]; if x < worst { worst = x; } sum += x; } ex += worst; st += sum / foes.len() as f64; }
    let mut s = 0.0;
    for i in 0..team.len() { for j in i + 1..team.len() { s += syn[team[i]][team[j]]; } }
    let n = team.len() as f64;
    cov / tw + 0.4 * ex / n + 0.4 * st / n + 0.12 * s
}

struct Scorer { max_t: Vec<Vec<f64>>, min_r: Vec<Vec<f64>>, sum_r: Vec<Vec<f64>>, syn_t: Vec<f64> }
impl Scorer {
    fn new(m: &[Vec<f64>], rows: &[Vec<usize>], cols: &[Vec<usize>], syn: &[Vec<f64>]) -> Scorer {
        let n_col = m[0].len();
        let max_t = rows.iter().map(|t| { let mut a = vec![-1.0; n_col]; for &x in t { for f in 0..n_col { if m[x][f] > a[f] { a[f] = m[x][f]; } } } a }).collect();
        let min_r = m.iter().map(|row| cols.iter().map(|xs| { let mut v = 1.0; for &f in xs { if row[f] < v { v = row[f]; } } v }).collect()).collect();
        let sum_r = m.iter().map(|row| cols.iter().map(|xs| { let mut v = 0.0; for &f in xs { v += row[f]; } v }).collect()).collect();
        let syn_t = rows.iter().map(|t| { let mut n = 0.0; for i in 0..t.len() { for j in i + 1..t.len() { n += syn[t[i]][t[j]]; } } n }).collect();
        Scorer { max_t, min_r, sum_r, syn_t }
    }
    fn score(&self, rows: &[Vec<usize>], cols: &[Vec<usize>], ti: usize, xi: usize) -> f64 {
        let (t, x, mx) = (&rows[ti], &cols[xi], &self.max_t[ti]);
        let (mut cov, mut ex, mut st) = (0.0, 0.0, 0.0);
        for &f in x { cov += mx[f]; }
        for &a in t { ex += self.min_r[a][xi]; st += self.sum_r[a][xi]; }
        cov / x.len() as f64 + 0.4 * ex / t.len() as f64 + 0.4 * st / (t.len() * x.len()) as f64 + 0.12 * self.syn_t[ti]
    }
}

fn softmax(scores: &[f64], keep: usize) -> Vec<(usize, f64)> {
    let mut idx: Vec<usize> = (0..scores.len()).collect();
    idx.sort_by(|&a, &b| js_cmp(scores[b] - scores[a]));
    idx.truncate(keep);
    let top = scores[idx[0]];
    let w: Vec<f64> = idx.iter().map(|&i| exp((scores[i] - top) / TEMP)).collect();
    let tot = w.iter().fold(0.0, |a, b| a + b);
    idx.iter().enumerate().map(|(k, &i)| (i, w[k] / tot)).collect()
}

pub struct Must { pub setters: Vec<usize>, pub abusers: Vec<usize>, pub need_setters: usize, pub need_abusers: usize }
pub struct Core { pub a: usize, pub b: usize, pub kind: &'static str, pub by: bool }
pub struct Draft { pub order: Vec<usize>, pub cores: Vec<Core>, pub predicted: Vec<Vec<usize>> }

pub fn draft_side(d: &Data, mine: &[Build], theirs: &[Build], level: f64, cap: usize, must: Option<&Must>, r: &mut Rng) -> Draft {
    let size = COMP_TEAM;
    let ma = matchups(d, mine, theirs, level);
    let mb: Vec<Vec<f64>> = (0..theirs.len()).map(|j| (0..mine.len()).map(|i| -ma[i][j]).collect()).collect();
    let rm: Vec<Roles> = mine.iter().map(|b| roles(d, b)).collect();
    let rt: Vec<Roles> = theirs.iter().map(|b| roles(d, b)).collect();
    let syn_of = |bs: &[Build], rs: &[Roles]| -> Vec<Vec<Syn>> { (0..bs.len()).map(|i| (0..bs.len()).map(|j| if i == j { Syn::default() } else { synergy(d, &bs[i], &bs[j], &rs[i], &rs[j]) }).collect()).collect() };
    let sam = syn_of(mine, &rm); let sbm = syn_of(theirs, &rt);
    let sa: Vec<Vec<f64>> = sam.iter().map(|r| r.iter().map(|x| x.v).collect()).collect();
    let sb: Vec<Vec<f64>> = sbm.iter().map(|r| r.iter().map(|x| x.v).collect()).collect();
    let all_m: Vec<usize> = (0..mine.len()).collect(); let all_t: Vec<usize> = (0..theirs.len()).collect();
    let mut my_teams = sixes(&mine.iter().map(|b| legend(&d.entrants[b.e].rarity)).collect::<Vec<_>>(), size, cap);
    let their_teams = sixes(&theirs.iter().map(|b| legend(&d.entrants[b.e].rarity)).collect::<Vec<_>>(), size, cap);
    if let Some(mu) = must {
        let ok = |t: &Vec<usize>| {
            let s: Vec<usize> = t.iter().copied().filter(|i| mu.setters.contains(i)).collect();
            let a: Vec<usize> = t.iter().copied().filter(|i| mu.abusers.contains(i)).collect();
            let mut u = s.clone(); for x in &a { if !u.contains(x) { u.push(*x); } }
            s.len() >= mu.need_setters && a.len() >= mu.need_abusers && u.len() >= mu.need_setters + mu.need_abusers
        };
        let kept: Vec<Vec<usize>> = my_teams.iter().filter(|t| ok(t)).cloned().collect();
        if !kept.is_empty() { my_teams = kept; }
    }
    let p1 = softmax(&their_teams.iter().map(|t| team_score(&mb, t, &all_m, &sb)).collect::<Vec<_>>(), KEEP);
    let q1 = softmax(&my_teams.iter().map(|t| team_score(&ma, t, &all_t, &sa)).collect::<Vec<_>>(), KEEP);
    let mine_vs = Scorer::new(&ma, &my_teams, &their_teams, &sa);
    let theirs_vs = Scorer::new(&mb, &their_teams, &my_teams, &sb);
    let h2h = |ti: usize, xi: usize| mine_vs.score(&my_teams, &their_teams, ti, xi) - theirs_vs.score(&their_teams, &my_teams, xi, ti);
    let p2 = softmax(&(0..their_teams.len()).map(|xi| q1.iter().fold(0.0, |n, q| n - q.1 * h2h(q.0, xi))).collect::<Vec<_>>(), KEEP);
    // blend both levels, in Map insertion order
    let mut pred: Vec<(usize, f64)> = vec![];
    for &(i, p) in &p1 { match pred.iter_mut().find(|x| x.0 == i) { Some(x) => x.1 += 0.4 * p, None => pred.push((i, 0.0 + 0.4 * p)) } }
    for &(i, p) in &p2 { match pred.iter_mut().find(|x| x.0 == i) { Some(x) => x.1 += 0.6 * p, None => pred.push((i, 0.0 + 0.6 * p)) } }
    pred.sort_by(|a, b| js_cmp(b.1 - a.1));
    pred.truncate(KEEP);
    let tot = pred.iter().fold(0.0, |n, x| n + x.1);
    for x in pred.iter_mut() { x.1 /= tot; }
    let p = pred;
    let likely: Vec<usize> = p.iter().enumerate().filter(|(_, x)| x.1 >= 0.08).map(|(k, _)| k).take(3).collect();
    struct Sc { ti: usize, v: f64 }
    let mut scored: Vec<Sc> = (0..my_teams.len()).map(|ti| {
        let (mut ev, mut worst, mut worst_i) = (0.0, 9.0, -1i64);
        for (k, x) in p.iter().enumerate() {
            let v = h2h(ti, x.0);
            ev += x.1 * v;
            if likely.contains(&k) && v < worst { worst = v; worst_i = x.0 as i64; }
        }
        let w = if worst_i < 0 { ev } else { worst };
        Sc { ti, v: ev + RISK * (0.0f64).min(w) }
    }).collect();
    scored.sort_by(|a, b| js_cmp(b.v - a.v));
    let top = scored[0].v;
    let near: Vec<&Sc> = scored.iter().filter(|s| s.v >= top - 0.03).take(3).collect();
    let choice = near[(r.next() * near.len() as f64).floor() as usize];
    let six = my_teams[choice.ti].clone();

    let their_leads = |t: &[usize]| -> Vec<usize> {
        let (mut best, mut bv) = (vec![], -9.0);
        for i in 0..t.len() { for j in i + 1..t.len() {
            let v = team_score(&mb, &[t[i], t[j]], &all_m, &sb) + lead_bonus(&rt[t[i]]) + lead_bonus(&rt[t[j]]);
            if v > bv { bv = v; best = vec![t[i], t[j]]; }
        } }
        best
    };
    let lead_guess: Vec<(f64, Vec<usize>, &Vec<usize>)> = p.iter().take(6).map(|x| (x.1, their_leads(&their_teams[x.0]), &their_teams[x.0])).collect();
    let (mut lead, mut lv) = (vec![], -9.0);
    let setter_in = must.map_or(false, |mu| six.iter().any(|i| mu.setters.contains(i)));
    for i in 0..six.len() { for j in i + 1..six.len() {
        let pair = [six[i], six[j]];
        if setter_in && !pair.iter().any(|x| must.unwrap().setters.contains(x)) { continue; }
        let mut v = lead_bonus(&rm[six[i]]) + lead_bonus(&rm[six[j]]) + 0.3 * sa[six[i]][six[j]];
        for g in &lead_guess { v += g.0 * (0.6 * team_score(&ma, &pair, &g.1, &sa) + 0.4 * team_score(&ma, &pair, g.2, &sa)); }
        if v > lv { lv = v; lead = pair.to_vec(); }
    } }
    let mut weight = vec![0.0; theirs.len()];
    for x in &p { for &f in &their_teams[x.0] { weight[f] += x.1; } }
    let back_value = |a: usize| weight.iter().enumerate().fold(0.0, |n, (f, w)| n + w * ma[a][f]);
    let mut back: Vec<usize> = six.iter().copied().filter(|a| !lead.contains(a)).collect();
    let bvs: Vec<(usize, f64)> = back.iter().map(|&a| (a, back_value(a))).collect();
    back.sort_by(|&a, &b| { let va = bvs.iter().find(|x| x.0 == a).unwrap().1; let vb = bvs.iter().find(|x| x.0 == b).unwrap().1; js_cmp(vb - va) });
    let mut order = lead.clone(); order.extend(back);
    let mut cores = vec![];
    for x in 0..order.len() { for y in x + 1..order.len() {
        let c = &sam[order[x]][order[y]];
        if c.v >= 0.45 { let k = c.kinds[0]; cores.push(if k.1 == 1 { Core { a: order[y], b: order[x], kind: k.0, by: true } } else { Core { a: order[x], b: order[y], kind: k.0, by: k.1 == 0 } }); }
    } }
    Draft { order, cores, predicted: p.iter().take(3).map(|x| their_teams[x.0].clone()).collect() }
}

// Which of the 6 actually brought the AI predicted: (overlap share, exact)
pub fn prediction_hit(predicted: &[Vec<usize>], actual: &[usize]) -> (f64, bool) {
    let top: &[usize] = predicted.first().map(|v| v.as_slice()).unwrap_or(&[]);
    let hit = top.iter().filter(|i| actual.contains(i)).count();
    (hit as f64 / actual.len() as f64, hit == actual.len())
}
