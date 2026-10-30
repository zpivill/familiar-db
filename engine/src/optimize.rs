// Build search: for each character, the ability, moveset, training preset and held item that win most, found
// by trying one choice at a time (coordinate descent) in battles against a fixed field of opponent teams
// (a saved meta chain's teams). Every candidate of one character plays the same battles (same teammates,
// opponents, seats and luck), so differences between candidates aren't drowned by the luck of the draw.
// The result is a build book (--builds) that makeBuild then uses instead of random moves and abilities.
use crate::batch::*;
use crate::battle::*;
use crate::builds::*;
use crate::data::*;
use crate::rules::{battle_stat, Nature, EV_MAX, EV_TOTAL, ITEM_IDS};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// a build as saved in the book
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Spec { pub moves: Vec<String>, pub ability: String, pub preset: String, pub nature: String, pub evs: [f64; 6], pub ivs: [f64; 6], pub item: Option<String> }
pub fn spec_of(d: &Data, b: &Build) -> Spec {
    let sig = d.entrants[b.e].sig.as_ref().map(|s| s.id.as_str());
    Spec {
        moves: b.moves.iter().map(|&(m, _)| d.moves[m].id.clone()).filter(|m| Some(m.as_str()) != sig).collect(),
        ability: b.ability_name.clone(), preset: b.preset.unwrap_or("").into(), nature: b.nature.unwrap_or_default().name(),
        evs: b.evs.unwrap(), ivs: b.ivs.unwrap(), item: b.item.map(|i| i.key()),
    }
}
pub fn build_of(d: &Data, e: usize, s: &Spec) -> Build {
    let ent = &d.entrants[e];
    let learn = |id: &str| ent.learn.iter().find(|l| l.id == id).unwrap_or_else(|| panic!("{} can't learn {id}", ent.key));
    let mut moves: Vec<(usize, Flags)> = s.moves.iter().map(|m| (d.mv(m), learn(m).flags)).collect();
    if let Some(sg) = &ent.sig { moves.push((d.mv(&sg.id), sg.flags)); }
    let k = ent.abilities.iter().position(|a| a.name == s.ability).unwrap_or_else(|| panic!("{} has no ability {}", ent.key, s.ability));
    let st = |n: &str| STATS.iter().position(|x| *x == n).unwrap();
    let nature = if s.nature == "neutral" { Nature(None) } else { let (u, dn) = s.nature.split_once('-').unwrap(); Nature(Some((st(u), st(dn)))) };
    Build { e, moves, ability: d.ent_abs[e][k], ability_name: s.ability.clone(), evs: Some(s.evs), ivs: Some(s.ivs), nature: Some(nature),
        item: s.item.as_deref().map(Item::parse), preset: PRESET_NAMES.iter().copied().find(|p| *p == s.preset) }
}

#[derive(Serialize, Deserialize, Default)]
pub struct Entry {
    pub builds: Vec<Spec>,
    pub base: f64, pub best: f64,        // win rate of the plain auto build and of the best build, on the search battles
    pub gain: f64,                        // best minus base on fresh battles (the honest number)
    pub tried: IndexMap<String, IndexMap<String, f64>>,   // each choice's win rate in its last pass: ability, moves, preset, item
}
pub fn load_book(d: &mut Data, path: &str) {
    let book: IndexMap<String, Entry> = serde_json::from_str(&std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"))).unwrap();
    for (k, en) in book { if let Some(&e) = d.ent_idx.get(&k) { let bs: Vec<Build> = en.builds.iter().map(|s| build_of(d, e, s)).collect(); d.book.entry(e).or_default().extend(bs); } }
}

pub struct Field { pub teams: Vec<(Vec<usize>, Option<usize>)> }   // opponent teams and their forced archetype

// Win rate of `cand` (entrant cand.e) over n battles: it joins each meta team in turn, against a random field team.
fn eval(d: &Data, o: &Opts, cand: &Build, field: &Field, from: usize, n: usize, seed: f64, cache: &mut HashMap<String, Vec<Build>>) -> f64 {
    let e = cand.e;
    let bo0 = BattleOpts { duos: o.duos(), level: o.level, turn_cap: o.turn_cap, plans: [None, None] };
    let mut tot = 0.0;
    for i in from..from + n {
        let mut r = rng(seed + (i * 7919) as f64);
        // the candidate joins a meta team in place of a random member (or keeps its own spot), against another field team
        let homes: Vec<&Vec<usize>> = field.teams.iter().filter(|t| t.1.is_none()).map(|t| &t.0).collect();
        let home = homes[i % homes.len()];
        let mut t: Vec<usize> = home.clone();
        match t.iter().position(|&x| d.entrants[x].ci == d.entrants[e].ci) {
            Some(j) => { t.remove(j); }
            None => {
                // a member whose spot keeps the team legal (a legendary, if the legendary cap is full)
                let ok: Vec<usize> = (0..t.len()).filter(|&j| { let mut u = t.clone(); u.remove(j); legal(d, &u, e, o) }).collect();
                t.remove(if ok.is_empty() { r.pick_i(t.len()) } else { ok[r.pick_i(ok.len())] });
            }
        }
        t.insert(0, e);
        let (ot, oa) = &field.teams[r.pick_i(field.teams.len())];
        let me = if r.next() < 0.5 { 0 } else { 1 };
        let mut sides: [Vec<usize>; 2] = [t, ot.clone()];
        let mut arch: [Option<usize>; 2] = [None, *oa];
        if me == 1 { sides.swap(0, 1); arch.swap(0, 1); }
        let mut builds: [Vec<Build>; 2] = [vec![], vec![]];
        for s in 0..2 {
            let mut bs: Vec<Build> = sides[s].iter().enumerate().map(|(j, &x)| {
                if s == me && j == 0 { return cand.clone(); }
                let f = arch[s].and_then(|a| forced(&d.archetypes[a], &d.entrants[x].key));
                let empty: Vec<String> = vec![];
                let (fm, fa) = match &f { Some((m, a)) => (m.as_slice(), a.as_deref()), None => (empty.as_slice(), None) };
                make_build(d, x, &mut r, &BuildOpts { level: o.learn_level, movesets: o.movesets, duos: o.duos(), force_moves: fm, force_ability: fa })
            }).collect();
            train_team(d, &mut bs, &mut r, o.training, o.items);
            builds[s] = bs;
        }
        let dr = if o.draft { Some(run_draft(d, &sides, &builds, &mut r, o, &arch, cache)) } else { None };
        let fight: [&[Build]; 2] = match &dr { Some(x) => [&x.six[0], &x.six[1]], None => [&builds[0], &builds[1]] };
        let b = run_battle(d, fight, r.clone(), &BattleOpts { plans: arch, ..bo0 });
        tot += if b.winner == me as i32 { 1.0 } else if b.winner < 0 { o.draw_score } else { 0.0 };
    }
    tot / n as f64
}

// The choices to try for one character.
fn trained(d: &Data, mut b: Build, preset: &'static str) -> Build { let k = kit(d, &b); train_preset(d, &mut b, &[k.clone()], &k, preset); b }
fn movesets(d: &Data, e: usize, o: &Opts, n: usize) -> Vec<Vec<(usize, Flags)>> {
    // the sets makeBuild draws most often, most common first
    let mut count: IndexMap<Vec<usize>, (usize, Vec<(usize, Flags)>)> = IndexMap::new();
    // a forced ability keeps makeBuild from returning the book's build
    let bo = BuildOpts { level: o.learn_level, movesets: o.movesets, duos: o.duos(), force_moves: &[], force_ability: Some("") };
    for i in 0..200 {
        let b = make_build(d, e, &mut rng(1e6 + i as f64), &bo);
        let mut k: Vec<usize> = b.moves.iter().map(|m| m.0).collect(); k.sort();
        count.entry(k).or_insert((0, b.moves.clone())).0 += 1;
    }
    let mut v: Vec<(usize, Vec<(usize, Flags)>)> = count.into_values().collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().take(n).map(|x| x.1).collect()
}
fn items(d: &Data, b: &Build) -> Vec<Option<Item>> {
    let mut out: Vec<Option<Item>> = vec![None];
    for (i, id) in ITEM_IDS.iter().enumerate() { if *id != "type-emblem" && *id != "ward-charm" { out.push(Some(Item { id: i as u8, ty: None })); } }
    // typed items: the ones the item handout would consider (own attack types, worst weakness)
    for (it, _) in item_scores(d, b, &kit(d, b)) { if it.ty.is_some() && !out.contains(&Some(it)) { out.push(Some(it)); } }
    out
}

pub struct Opt { pub battles: usize, pub passes: usize, pub seed: f64 }

// the plain build: a moveset, the first ability, auto training and item as if alone
fn auto_build(d: &Data, e: usize, moves: Vec<(usize, Flags)>) -> Build {
    let abs = &d.ent_abs[e];
    let mut v = vec![Build { e, moves, ability: abs.first().copied().unwrap_or(NO_AB), ability_name: d.entrants[e].abilities.first().map_or("None".into(), |a| a.name.clone()), evs: None, ivs: None, nature: None, item: None, preset: None }];
    train_team(d, &mut v, &mut rng(1.0), true, true);
    v.remove(0)
}
fn speed_of(d: &Data, b: &Build, level: f64) -> f64 {
    battle_stat(d.entrants[b.e].stats.as_ref().unwrap().spe, level, false, b.evs.unwrap()[5], b.ivs.unwrap()[5], b.nature.unwrap_or_default().mult(SPE))
}
// The field's characters and their Speed as they usually play (their book build, else the plain build).
pub fn threats(d: &Data, o: &Opts, field: &Field) -> Vec<(String, f64)> {
    let mut out: Vec<(usize, String, f64)> = vec![];
    for (t, _) in &field.teams { for &x in t {
        if out.iter().any(|y| y.0 == x) { continue; }
        let b = d.book.get(&x).map(|v| v[0].clone()).unwrap_or_else(|| auto_build(d, x, movesets(d, x, o, 1).remove(0)));
        out.push((x, d.entrants[x].name.clone(), speed_of(d, &b, o.level)));
    } }
    out.into_iter().map(|x| (x.1, x.2)).collect()
}
// Speed creep: the fewest Speed EVs that outspeed each threat (keeping the nature unless it lowers Speed, else
// +Speed), the attack stat at the cap and the rest in Vitality. One option per distinct spread.
fn speed_spreads(d: &Data, cur: &Build, threats: &[(String, f64)], level: f64) -> Vec<(String, Build)> {
    let st = d.entrants[cur.e].stats.as_ref().unwrap(); let k = kit(d, cur);
    let low = if k.uses_other { if st.grd <= st.wil { GRD } else { WIL } } else { k.other };
    let keep = cur.nature.unwrap_or_default();
    let natures = [if keep.mult(SPE) < 1.0 { Nature(None) } else { keep }, Nature(Some((SPE, low)))];
    let mut out: Vec<(String, Build)> = vec![];
    let mut sorted: Vec<&(String, f64)> = threats.iter().collect();
    sorted.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    for (name, spd) in sorted {
        'n: for nat in natures {
            for ev in 0..=EV_MAX {
                if battle_stat(st.spe, level, false, ev as f64, 31.0, nat.mult(SPE)) <= *spd { continue; }
                let mut evs = [0.0; 6]; evs[5] = ev as f64; evs[k.atk + 1] = EV_MAX as f64; evs[0] = (EV_TOTAL - EV_MAX - ev).min(EV_MAX) as f64;
                let mut b = cur.clone(); b.evs = Some(evs); b.nature = Some(nat); let mut iv = cur.ivs.unwrap(); iv[5] = 31.0; b.ivs = Some(iv); b.preset = Some("speed");
                if !out.iter().any(|x| x.1.evs == b.evs && x.1.nature == b.nature) { out.push((format!("outspeeds {name} ({ev} Spe, {})", nat.name()), b)); }
                break 'n;
            }
        }
    }
    out
}

// Coordinate descent for one character. Returns its book entry.
pub fn optimize_one(d: &Data, o: &Opts, e: usize, field: &Field, threats: &[(String, f64)], p: &Opt, cache: &mut HashMap<String, Vec<Build>>) -> Entry {
    let sets = movesets(d, e, o, 6);
    let abs = d.ent_abs[e].clone();
    let base0 = auto_build(d, e, sets[0].clone());
    let seed = p.seed + e as f64 * 1e5;
    let base = eval(d, o, &base0, field, 0, p.battles, seed, cache);
    let (mut cur, mut cur_v) = (base0.clone(), base);
    let mut tried: IndexMap<String, IndexMap<String, f64>> = IndexMap::new();
    for _ in 0..p.passes {
        // ability
        let mut opts: Vec<(String, Build)> = abs.iter().enumerate().map(|(k, &a)| { let mut b = cur.clone(); b.ability = a; b.ability_name = d.entrants[e].abilities[k].name.clone(); (b.ability_name.clone(), b) }).collect();
        pick(d, o, field, p, seed, cache, &mut cur, &mut cur_v, &mut opts, "ability", &mut tried);
        // moveset (training follows the moves' attack stat)
        let preset = cur.preset.unwrap_or("fast");
        let mut opts: Vec<(String, Build)> = sets.iter().map(|m| { let mut b = cur.clone(); b.moves = m.clone(); let b = trained(d, b, preset);
            (b.moves.iter().map(|x| d.moves[x.0].name.clone()).collect::<Vec<_>>().join(", "), b) }).collect();
        pick(d, o, field, p, seed, cache, &mut cur, &mut cur_v, &mut opts, "moves", &mut tried);
        let mut opts: Vec<(String, Build)> = PRESET_NAMES.iter().map(|&pr| (pr.to_string(), trained(d, cur.clone(), pr))).collect();
        pick(d, o, field, p, seed, cache, &mut cur, &mut cur_v, &mut opts, "preset", &mut tried);
        if cur.preset != Some("trickRoom") {
            let mut opts: Vec<(String, Build)> = vec![("keep".into(), cur.clone())];
            opts.extend(speed_spreads(d, &cur, threats, o.level));
            pick(d, o, field, p, seed, cache, &mut cur, &mut cur_v, &mut opts, "speed", &mut tried);
        }
        let mut opts: Vec<(String, Build)> = items(d, &cur).into_iter().map(|it| { let mut b = cur.clone(); b.item = it; (it.map_or("none".into(), |i| i.key()), b) }).collect();
        pick(d, o, field, p, seed, cache, &mut cur, &mut cur_v, &mut opts, "item", &mut tried);
    }
    // the honest gain: base and best on battles the search never saw
    let fresh = seed + 5e4;
    let gain = eval(d, o, &cur, field, 0, p.battles, fresh, cache) - eval(d, o, &base0, field, 0, p.battles, fresh, cache);
    Entry { builds: vec![spec_of(d, &cur)], base, best: cur_v, gain, tried }
}
// One choice at a time by successive halving: every option plays a quarter of the battles, the better half plays
// the next quarter on top, and so on, so the leaders end up on all `p.battles` (the same battles for all).
#[allow(clippy::too_many_arguments)]
fn pick(d: &Data, o: &Opts, field: &Field, p: &Opt, seed: f64, cache: &mut HashMap<String, Vec<Build>>, cur: &mut Build, cur_v: &mut f64,
        opts: &mut Vec<(String, Build)>, dim: &str, tried: &mut IndexMap<String, IndexMap<String, f64>>) {
    let block = (p.battles / 4).max(1);
    let mut alive: Vec<(String, Build, f64)> = opts.drain(..).map(|(n, b)| (n, b, 0.0)).collect();
    let mut t: IndexMap<String, f64> = IndexMap::new();
    let mut from = 0;
    loop {
        for a in alive.iter_mut() { a.2 += eval(d, o, &a.1, field, from, block, seed, cache) * block as f64; }
        from += block;
        alive.sort_by(|x, y| y.2.partial_cmp(&x.2).unwrap());
        if alive.len() == 1 || from + block > p.battles { break; }
        let keep = (alive.len() + 1) / 2;
        for a in alive.drain(keep..) { t.insert(a.0, a.2 / from as f64); }
    }
    for a in &alive { t.insert(a.0.clone(), a.2 / from as f64); }
    t.sort_by(|_, x, _, y| y.partial_cmp(x).unwrap());
    let best = alive.swap_remove(0);
    *cur = best.1; *cur_v = best.2 / from as f64;
    tried.insert(dim.into(), t);
}

// Every entrant of the pool, split over `workers` threads; the book in pool order.
pub fn optimize_all(d: &Data, o: &Opts, field: &Field, p: &Opt, workers: usize, only: &[usize]) -> IndexMap<String, Entry> {
    let ents: Vec<usize> = if only.is_empty() { entrant_pool(d, o) } else { only.to_vec() };
    let threats = threats(d, o, field);
    let done = std::sync::atomic::AtomicUsize::new(0);
    let mut out: Vec<(usize, Entry)> = std::thread::scope(|s| {
        let hs: Vec<_> = (0..workers).map(|w| { let (ents, done, threats) = (&ents, &done, &threats); s.spawn(move || {
            let mut cache = HashMap::new(); let mut res = vec![];
            for (i, &e) in ents.iter().enumerate() { if i % workers == w {
                res.push((i, optimize_one(d, o, e, field, &threats, p, &mut cache)));
                let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if n % 10 == 0 { eprintln!("{n} of {} characters", ents.len()); }
            } }
            res
        }) }).collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    });
    out.sort_by_key(|x| x.0);
    out.into_iter().map(|(i, en)| (d.entrants[ents[i]].key.clone(), en)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn book_round_trip_and_speed_spreads() {
        let d = Data::load("data.json");
        let o = Opts::new(Format::Comp, 0, 1.0, true, 8, false, None, None, true);
        for e in entrant_pool(&d, &o).into_iter().step_by(17) {
            let b = auto_build(&d, e, movesets(&d, e, &o, 1).remove(0));
            assert_eq!(spec_of(&d, &build_of(&d, e, &spec_of(&d, &b))), spec_of(&d, &b));
            let th = vec![("x".to_string(), speed_of(&d, &b, o.level))];
            for (_, s) in speed_spreads(&d, &b, &th, o.level) {
                assert!(speed_of(&d, &s, o.level) > th[0].1);
                assert!(s.evs.unwrap().iter().sum::<f64>() <= EV_TOTAL as f64 && s.evs.unwrap().iter().all(|&v| v <= EV_MAX as f64));
            }
        }
    }
}
