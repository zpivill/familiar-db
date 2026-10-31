// The search AI, a port of sim/mcts.js: each turn it tries the k best options of each of its characters (plus a
// switch) as pairs, plays the rest of the battle out with new luck many times, picking which pair to try next
// by UCB1, and keeps the pair it tried most. Playouts replay the battle from its seed with every choice made
// so far, then branch, so all choices for both sides are made here with separate random numbers.
use crate::ai::{choose_action, choose_replacement, greedy_action, options, v1_action};
use crate::battle::*;
use crate::data::Data;
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq)]
pub enum Bot { Mirror, V1, Greedy }
// the current AI 2 times in 3, the frozen v1 otherwise (as sim/mcts.js; greedy was dropped 2026-10-31)
const STYLES: [Bot; 3] = [Bot::Mirror, Bot::Mirror, Bot::V1];
impl Bot {
    // an action for the decide hook, None leaves it to the current AI (bots/baselines.js)
    fn action(self, b: &mut Battle, m: MonId) -> Option<Act> {
        match self { Bot::Mirror => None, Bot::V1 => Some(v1_action(b, m).act), Bot::Greedy => greedy_action(b, m) }
    }
}

// a choice stored by position (side, slot in the team), so it replays in another copy of the battle
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Enc { Switch(usize), Move { slot: usize, ts: i32, t: i32 } }
fn idx(b: &Battle, m: MonId) -> usize { b.sides[b.mons[m].side].mons.iter().position(|&x| x == m).unwrap() }
fn enc(b: &Battle, a: Act) -> Enc {
    match a {
        Act::Switch { to } => Enc::Switch(idx(b, to)),
        Act::Move { slot, target } => match target { Some(t) => Enc::Move { slot, ts: b.mons[t].side as i32, t: idx(b, t) as i32 }, None => Enc::Move { slot, ts: -1, t: -1 } },
    }
}
fn dec(b: &Battle, m: MonId, a: Enc) -> Act {
    match a {
        Enc::Switch(k) => Act::Switch { to: b.sides[b.mons[m].side].mons[k] },
        Enc::Move { slot, ts, t } => Act::Move { slot, target: (t >= 0).then(|| b.sides[ts as usize].mons[t as usize]) },
    }
}
fn slot_of(e: Enc) -> usize { match e { Enc::Switch(k) => k, _ => unreachable!() } }
// run f with the battle's random numbers swapped for r, so an AI's noise doesn't touch the battle's luck
fn with_rng<T>(b: &mut Battle, r: &mut Rng, f: impl FnOnce(&mut Battle) -> T) -> T {
    std::mem::swap(&mut b.r, r); let x = f(b); std::mem::swap(&mut b.r, r); x
}

#[derive(Clone, Copy)]
struct Fixed<'a> { d: &'a Data, teams: [&'a [Build]; 2], bo: &'a BattleOpts, seed: f64 }

// One playout: replay the first `upto` choices, then side `me` plays `pair` on turn t and the fast AI after it,
// and the foe plays `style` throughout. Win (1) or not (0), plus a little for the Vitality lead.
fn playout(f: &Fixed, rec: &[Enc], upto: usize, t: i32, me: usize, pair: &[(usize, Enc)], style: Bot, luck: f64) -> f64 {
    let mut i = 0; let mut branched = false;
    let decide: Decide = Box::new(move |b: &mut Battle, q: Ask| {
        if i < upto {
            let e = rec[i]; i += 1;
            return Some(match q { Ask::Replace { s, .. } => Act::Switch { to: b.sides[s].mons[slot_of(e)] }, Ask::Action { m, .. } => dec(b, m, e) });
        }
        if !branched { branched = true; b.r = rng(luck); }
        match q {
            Ask::Replace { .. } => None,   // v1 picks replacements like the current AI, so every style can leave it to the engine
            Ask::Action { m, extra } => {
                if b.mons[m].side != me { return style.action(b, m); }
                if b.turn != t || extra { return None; }
                let k = idx(b, m);
                pair.iter().find(|p| p.0 == k).map(|p| dec(b, m, p.1))
            }
        }
    });
    let b = run_battle_with(f.d, f.teams, rng(f.seed), f.bo, Some(decide));
    let hp = |s: usize| b.sides[s].mons.iter().fold(0.0, |n, &m| n + if b.mons[m].fainted { 0.0 } else { b.mons[m].hp / b.mons[m].maxhp }) / b.sides[s].mons.len() as f64;
    (if b.winner == me as i32 { 1.0 } else { 0.0 }) + 0.1 * (hp(me) - hp(1 - me))
}

// The pair for this turn: candidates per character, then UCB1 over the pairs.
fn think(f: &Fixed, rec: &[Enc], upto: usize, b: &mut Battle, me: usize, iters: usize, k: usize, search: &mut Rng) -> Vec<(usize, Enc)> {
    let team = b.actives(me);
    let mut lists: Vec<Vec<Enc>> = vec![];
    for &m in &team {
        let mut opts: Vec<Act> = with_rng(b, search, |b| options(b, m)).into_iter().take(k).map(|c| c.act).collect();
        let bench = b.bench(me);
        if !matches!(opts.first(), Some(Act::Switch { .. })) && !bench.is_empty() && b.can_switch(m) && b.mons[m].t.turns_in >= 1 {
            let to = with_rng(b, search, |b| choose_replacement(b, me, &bench));
            opts.push(Act::Switch { to });
        }
        lists.push(opts.into_iter().map(|a| enc(b, a)).collect());
    }
    let mut pairs: Vec<Vec<Enc>> = lists[0].iter().map(|&a| vec![a]).collect();
    if lists.len() > 1 {
        pairs = pairs.iter().flat_map(|p| lists[1].iter().filter(|&&x| !(matches!((x, p[0]), (Enc::Switch(a), Enc::Switch(c)) if a == c))).map(move |&x| vec![p[0], x])).collect();
    }
    if pairs.is_empty() { pairs = vec![vec![lists[0][0]]]; }   // both can only switch to the same one: the partner falls back to the fast AI
    let slots: Vec<usize> = team.iter().map(|&m| idx(b, m)).collect();
    let as_map = |p: &Vec<Enc>| p.iter().enumerate().map(|(j, &a)| (slots[j], a)).collect::<Vec<_>>();
    if pairs.len() == 1 { return as_map(&pairs[0]); }
    let (mut n, mut s) = (vec![0.0f64; pairs.len()], vec![0.0f64; pairs.len()]);
    for it in 0..iters.max(pairs.len()) {
        let j = match n.iter().position(|&x| x == 0.0) {
            Some(j) => j,
            None => {
                let ln = libm::log(it as f64); let (mut j, mut bv) = (0, -1.0);
                for x in 0..pairs.len() { let v = s[x] / n[x] + 0.5 * (ln / n[x]).sqrt(); if v > bv { bv = v; j = x; } }
                j
            }
        };
        n[j] += 1.0;
        let style = STYLES[(search.next() * 3.0).floor() as usize]; let luck = (search.next() * 1e9).floor();
        s[j] += playout(f, rec, upto, b.turn, me, &as_map(&pairs[j]), style, luck);
    }
    let mut best = 0;
    for x in 0..pairs.len() { if n[x] > n[best] || (n[x] == n[best] && s[x] > s[best]) { best = x; } }
    as_map(&pairs[best])
}

pub struct Searched<'a> { pub b: Battle<'a>, pub seed: f64, pub choices: Vec<Enc> }

// One battle with the sides in `searching` run by the search and the other by `foe`. r is the batch's rng
// (bo.rng in JS): one draw from it seeds everything.
pub fn play_search<'a>(d: &'a Data, teams: [&'a [Build]; 2], r: &mut Rng, bo: &'a BattleOpts, searching: &[usize], foe: Bot, iters: usize, k: usize) -> Searched<'a> {
    let seed = (r.next() * 1e9).floor();
    let f = Fixed { d, teams, bo, seed };
    let (mut mine, mut theirs, mut search) = (rng(seed + 1.0), rng(seed + 2.0), rng(seed + 3.0));
    let rec = std::rc::Rc::new(std::cell::RefCell::new(Vec::<Enc>::new()));
    let mut turn_start: HashMap<i32, usize> = HashMap::new();
    let mut plan: [Option<(i32, Vec<(usize, Enc)>)>; 2] = [None, None];
    let searching = searching.to_vec();
    let rec2 = rec.clone();
    let decide: Decide = Box::new(move |b: &mut Battle, q: Ask| {
        let act = match q {
            Ask::Replace { s, options: opts } => {
                let pick = if searching.contains(&s) { with_rng(b, &mut mine, |b| choose_replacement(b, s, opts)) } else { with_rng(b, &mut theirs, |b| choose_replacement(b, s, opts)) };
                rec2.borrow_mut().push(Enc::Switch(idx(b, pick)));
                return Some(Act::Switch { to: pick });
            }
            Ask::Action { m, extra } => {
                turn_start.entry(b.turn).or_insert(rec2.borrow().len());
                let si = b.mons[m].side;
                if !searching.contains(&si) { with_rng(b, &mut theirs, |b| foe.action(b, m).unwrap_or_else(|| choose_action(b, m).act)) }
                else if extra { with_rng(b, &mut mine, |b| choose_action(b, m).act) }
                else {
                    if plan[si].as_ref().map_or(true, |p| p.0 != b.turn) {
                        let acts = think(&f, &rec2.borrow(), turn_start[&b.turn], b, si, iters, k, &mut search);
                        plan[si] = Some((b.turn, acts));
                    }
                    let k = idx(b, m);
                    match plan[si].as_ref().unwrap().1.iter().find(|p| p.0 == k) { Some(p) => dec(b, m, p.1), None => with_rng(b, &mut mine, |b| choose_action(b, m).act) }
                }
            }
        };
        rec2.borrow_mut().push(enc(b, act));
        Some(act)
    });
    let b = run_battle_with(d, teams, rng(seed), bo, Some(decide));
    let mut b = b; b.decide = None;
    let choices = rec.borrow().clone();
    Searched { b, seed, choices }
}

// Replays a searched battle from its seed and choices: should end exactly as the original did.
pub fn replay<'a>(d: &'a Data, teams: [&'a [Build]; 2], bo: &'a BattleOpts, seed: f64, choices: &'a [Enc]) -> Battle<'a> {
    let mut i = 0;
    run_battle_with(d, teams, rng(seed), bo, Some(Box::new(move |b: &mut Battle, q: Ask| {
        let e = choices[i]; i += 1;
        Some(match q { Ask::Replace { s, .. } => Act::Switch { to: b.sides[s].mons[slot_of(e)] }, Ask::Action { m, .. } => dec(b, m, e) })
    })))
}
