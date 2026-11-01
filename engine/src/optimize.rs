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

// One team's builds for a team-aware search (gap #10): the team and each member's build so far.
pub type TeamCtx<'a> = Option<(&'a [usize], &'a HashMap<usize, Build>)>;

// Win rate of `cand` (entrant cand.e) over n battles: it joins each meta team in turn, against a random field team.
// With a team (team-aware search) it always plays in that team, next to the team's builds.
fn eval(d: &Data, o: &Opts, cand: &Build, field: &Field, from: usize, n: usize, seed: f64, cache: &mut HashMap<String, Vec<Build>>, team: TeamCtx) -> f64 {
    let e = cand.e;
    let bo0 = BattleOpts { duos: o.duos(), level: o.level, turn_cap: o.turn_cap, plans: [None, None], beliefs: None, assume: None };
    let mut tot = 0.0;
    for i in from..from + n {
        let mut r = rng(seed + (i * 7919) as f64);
        // the candidate joins a meta team in place of a random member (or keeps its own spot), against another field team
        let homes: Vec<&Vec<usize>> = field.teams.iter().filter(|t| t.1.is_none()).map(|t| &t.0).collect();
        let mut t: Vec<usize> = match team { Some((tm, _)) => tm.to_vec(), None => homes[i % homes.len()].clone() };
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
                if s == me { if let Some(b) = team.and_then(|(_, m)| m.get(&x)) { return b.clone(); } }
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
        // with --hidden the foes see the candidate as the build they'd expect (the book's, or the plain one), so a surprise build can pay off
        let b = run_battle(d, fight, r.clone(), &BattleOpts { plans: arch, beliefs: beliefs(d, o, &sides, fight, &dr), ..bo0 });
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
// The field's characters as they usually play (their book build, else the plain build), with their Speed and
// how many field teams carry them, most common first.
pub struct Threat { pub name: String, pub spd: f64, pub b: Build, pub n: usize }
pub fn threats(d: &Data, o: &Opts, field: &Field) -> Vec<Threat> {
    let mut out: Vec<Threat> = vec![];
    for (t, _) in &field.teams { for &x in t {
        if let Some(y) = out.iter_mut().find(|y| y.b.e == x) { y.n += 1; continue; }
        let b = d.book.get(&x).map(|v| v[0].clone()).unwrap_or_else(|| auto_build(d, x, movesets(d, x, o, 1).remove(0)));
        out.push(Threat { name: d.entrants[x].name.clone(), spd: speed_of(d, &b, o.level), b, n: 1 });
    } }
    out.sort_by(|a, b| b.n.cmp(&a.n));
    out
}
// Speed creep: the fewest Speed EVs that outspeed each threat (keeping the nature unless it lowers Speed, else
// +Speed), the attack stat at the cap and the rest in Vitality. One option per distinct spread.
fn speed_spreads(d: &Data, cur: &Build, threats: &[Threat], level: f64) -> Vec<(String, Build)> {
    let st = d.entrants[cur.e].stats.as_ref().unwrap(); let k = kit(d, cur);
    let low = if k.uses_other { if st.grd <= st.wil { GRD } else { WIL } } else { k.other };
    let keep = cur.nature.unwrap_or_default();
    let natures = [if keep.mult(SPE) < 1.0 { Nature(None) } else { keep }, Nature(Some((SPE, low)))];
    let mut out: Vec<(String, Build)> = vec![];
    let mut sorted: Vec<(&String, f64)> = threats.iter().map(|t| (&t.name, t.spd)).collect();
    sorted.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    for (name, spd) in sorted {
        'n: for nat in natures {
            for ev in 0..=EV_MAX {
                if battle_stat(st.spe, level, false, ev as f64, 31.0, nat.mult(SPE)) <= spd { continue; }
                let mut evs = [0.0; 6]; evs[5] = ev as f64; evs[k.atk + 1] = EV_MAX as f64; evs[0] = (EV_TOTAL - EV_MAX - ev).min(EV_MAX) as f64;
                let mut b = cur.clone(); b.evs = Some(evs); b.nature = Some(nat); let mut iv = cur.ivs.unwrap(); iv[5] = 31.0; b.ivs = Some(iv); b.preset = Some("speed");
                if !out.iter().any(|x| x.1.evs == b.evs && x.1.nature == b.nature) { out.push((format!("outspeeds {name} ({ev} Spe, {})", nat.name()), b)); }
                break 'n;
            }
        }
    }
    out
}

// The threat's best hit on b, as a share of b's Vitality (expected damage, no crit), and the defence it hits.
fn best_hit(d: &Data, o: &Opts, t: &Build, b: &Build) -> (f64, usize) {
    let bo = BattleOpts { duos: false, level: o.level, turn_cap: 0, plans: [None, None], beliefs: None, assume: None };   // cap 0: set up (entry abilities), no turns
    let mut x = run_battle_with(d, [std::slice::from_ref(t), std::slice::from_ref(b)], rng(1.0), &bo, None);
    let (mut best, mut key) = (0.0, GRD);
    for k in 0..x.mons[0].moves.len() {
        let v = crate::ai::est_damage(&mut x, 0, k, 1);
        if v > best { best = v; let m = &d.moves[x.mons[0].moves[k].mv]; key = if m.cat == Cat::Physical || m.fx.psyshock { GRD } else { WIL }; }
    }
    (best, key)
}
// Bulk: for each of the most common field characters whose best hit KOs b from full (or in two hits), the fewest
// Vitality plus defence EVs that survive one hit (or two), keeping the Speed EVs and nature, the attack stat on the rest (up to the cap),
// then the other defence.
const BULK_THREATS: usize = 15;
fn bulk_spreads(d: &Data, o: &Opts, cur: &Build, threats: &[Threat]) -> Vec<(String, Build)> {
    let k = kit(d, cur); let spe = cur.evs.unwrap()[5] as i32;
    let mut out: Vec<(String, Build)> = vec![];
    for t in threats.iter().filter(|t| t.b.e != cur.e).take(BULK_THREATS) {
        let (hit, def) = best_hit(d, o, &t.b, cur);
        for (need, what) in [(1.0, "a hit from "), (0.5, "two hits from ")] {
        if hit < need { continue; }
        let spread = |vit: i32, dv: i32| -> Option<Build> {
            let atk = (EV_TOTAL - spe - vit - dv).min(EV_MAX);
            if atk < 0 { return None; }
            let other = if def == GRD { WIL } else { GRD };
            let mut evs = [0.0; 6]; evs[5] = spe as f64; evs[0] = vit as f64; evs[def + 1] = dv as f64; evs[k.atk + 1] = atk as f64;
            evs[other + 1] = (EV_TOTAL - spe - vit - dv - atk).min(EV_MAX) as f64;   // what the capped attack leaves
            let mut b = cur.clone(); b.evs = Some(evs); Some(b)
        };
        'found: for tot in 0..=2 * EV_MAX {
            for vit in ((tot - EV_MAX).max(0)..=tot.min(EV_MAX)).rev() {   // Vitality first: it helps against every hit
                let Some(b) = spread(vit, tot - vit) else { continue };
                if best_hit(d, o, &t.b, &b).0 < need {
                    if !out.iter().any(|x| x.1.evs == b.evs) { out.push((format!("survives {what}{} ({vit} Vit, {} {})", t.name, tot - vit, STATS[def]), b)); }
                    break 'found;
                }
            }
        }
        }
    }
    out
}

// Coordinate descent for one character. Returns its book entry.
pub fn optimize_one(d: &Data, o: &Opts, e: usize, field: &Field, threats: &[Threat], p: &Opt, cache: &mut HashMap<String, Vec<Build>>, team: TeamCtx) -> Entry {
    let sets = movesets(d, e, o, 6);
    let abs = d.ent_abs[e].clone();
    // in a team, start from (and compare with) the member's build in that team so far
    let base0 = team.and_then(|(_, m)| m.get(&e).cloned()).unwrap_or_else(|| auto_build(d, e, sets[0].clone()));
    let seed = p.seed + e as f64 * 1e5;
    let base = eval(d, o, &base0, field, 0, p.battles, seed, cache, team);
    let (mut cur, mut cur_v) = (base0.clone(), base);
    let mut tried: IndexMap<String, IndexMap<String, f64>> = IndexMap::new();
    for _ in 0..p.passes {
        // ability
        let mut opts: Vec<(String, Build)> = abs.iter().enumerate().map(|(k, &a)| { let mut b = cur.clone(); b.ability = a; b.ability_name = d.entrants[e].abilities[k].name.clone(); (b.ability_name.clone(), b) }).collect();
        pick(d, o, field, p, seed, cache, team, &mut cur, &mut cur_v, &mut opts, "ability", &mut tried);
        // moveset (training follows the moves' attack stat)
        let preset = cur.preset.unwrap_or("fast");
        let mut opts: Vec<(String, Build)> = sets.iter().map(|m| { let mut b = cur.clone(); b.moves = m.clone();
            // a tuned "speed" spread is not a preset: keep it as it is
            let b = if PRESET_NAMES.contains(&preset) { trained(d, b, preset) } else { b };
            (b.moves.iter().map(|x| d.moves[x.0].name.clone()).collect::<Vec<_>>().join(", "), b) }).collect();
        pick(d, o, field, p, seed, cache, team, &mut cur, &mut cur_v, &mut opts, "moves", &mut tried);
        let mut opts: Vec<(String, Build)> = PRESET_NAMES.iter().map(|&pr| (pr.to_string(), trained(d, cur.clone(), pr))).collect();
        pick(d, o, field, p, seed, cache, team, &mut cur, &mut cur_v, &mut opts, "preset", &mut tried);
        if cur.preset != Some("trickRoom") {
            let mut opts: Vec<(String, Build)> = vec![("keep".into(), cur.clone())];
            opts.extend(speed_spreads(d, &cur, threats, o.level));
            pick(d, o, field, p, seed, cache, team, &mut cur, &mut cur_v, &mut opts, "speed", &mut tried);
        }
        let mut opts: Vec<(String, Build)> = vec![("keep".into(), cur.clone())];
        opts.extend(bulk_spreads(d, o, &cur, threats));
        if opts.len() > 1 { pick(d, o, field, p, seed, cache, team, &mut cur, &mut cur_v, &mut opts, "bulk", &mut tried); }
        let taken: Vec<u8> = team.map_or(vec![], |(t, m)| t.iter().filter(|&&x| x != e).filter_map(|x| m.get(x).and_then(|b| b.item).map(|i| i.id)).collect());
        let mut opts: Vec<(String, Build)> = items(d, &cur).into_iter().filter(|it| it.map_or(true, |i| !taken.contains(&i.id))).map(|it| { let mut b = cur.clone(); b.item = it; (it.map_or("none".into(), |i| i.key()), b) }).collect();
        pick(d, o, field, p, seed, cache, team, &mut cur, &mut cur_v, &mut opts, "item", &mut tried);
    }
    // the honest gain: base and best on battles the search never saw
    let fresh = seed + 5e4;
    let gain = eval(d, o, &cur, field, 0, p.battles, fresh, cache, team) - eval(d, o, &base0, field, 0, p.battles, fresh, cache, team);
    Entry { builds: vec![spec_of(d, &cur)], base, best: cur_v, gain, tried }
}
// One choice at a time by successive halving: every option plays a quarter of the battles, the better half plays
// the next quarter on top, and so on, so the leaders end up on all `p.battles` (the same battles for all).
#[allow(clippy::too_many_arguments)]
fn pick(d: &Data, o: &Opts, field: &Field, p: &Opt, seed: f64, cache: &mut HashMap<String, Vec<Build>>, team: TeamCtx, cur: &mut Build, cur_v: &mut f64,
        opts: &mut Vec<(String, Build)>, dim: &str, tried: &mut IndexMap<String, IndexMap<String, f64>>) {
    let block = (p.battles / 4).max(1);
    let mut alive: Vec<(String, Build, f64)> = opts.drain(..).map(|(n, b)| (n, b, 0.0)).collect();
    let mut t: IndexMap<String, f64> = IndexMap::new();
    let mut from = 0;
    loop {
        for a in alive.iter_mut() { a.2 += eval(d, o, &a.1, field, from, block, seed, cache, team) * block as f64; }
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
                res.push((i, optimize_one(d, o, e, field, &threats, p, &mut cache, None)));
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

// Team-aware build search (gap #10): each member of one team searched in that team, next to its teammates'
// current builds (the book's to start), one member after another (so items stay one per team), for `rounds`
// rounds. A round's builds are kept only if the team does better with them on fresh battles. Returns each
// member's last entry and the team's win rate with the starting and the kept builds, on other fresh battles.
pub fn optimize_team(d: &Data, o: &Opts, field: &Field, p: &Opt, team: &[usize], rounds: usize) -> (IndexMap<String, Entry>, f64, f64) {
    let threats = threats(d, o, field);
    let mut cache = HashMap::new();
    let mut mates: HashMap<usize, Build> = team.iter().map(|&x| (x, d.book.get(&x).map(|v| v[0].clone()).unwrap_or_else(|| auto_build(d, x, movesets(d, x, o, 1).remove(0))))).collect();
    let start = mates.clone();
    let lead = team[0];
    let score = |m: &HashMap<usize, Build>, seed: f64, cache: &mut HashMap<String, Vec<Build>>| eval(d, o, &m[&lead], field, 0, p.battles * 2, seed, cache, Some((team, m)));
    let mut kept_v = score(&mates, p.seed + 6e7, &mut cache);
    let mut out: IndexMap<String, Entry> = IndexMap::new();
    for _ in 0..rounds {
        let mut next = mates.clone();
        for &e in team {
            let en = optimize_one(d, o, e, field, &threats, p, &mut cache, Some((team, &next)));
            next.insert(e, build_of(d, e, &en.builds[0]));
            out.insert(d.entrants[e].key.clone(), en);
        }
        let v = score(&next, p.seed + 6e7, &mut cache);
        if v > kept_v { kept_v = v; mates = next; }
    }
    let fresh = p.seed + 7e7;
    let before = eval(d, o, &start[&lead], field, 0, p.battles * 4, fresh, &mut cache, Some((team, &start)));
    let after = eval(d, o, &mates[&lead], field, 0, p.battles * 4, fresh, &mut cache, Some((team, &mates)));
    for &e in team { if let Some(en) = out.get_mut(&d.entrants[e].key) { en.builds = vec![spec_of(d, &mates[&e])]; } }
    (out, before, after)
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
            let ok = |s: &Build| s.evs.unwrap().iter().sum::<f64>() <= EV_TOTAL as f64 && s.evs.unwrap().iter().all(|&v| v <= EV_MAX as f64);
            let th = vec![Threat { name: "x".into(), spd: speed_of(&d, &b, o.level), b: b.clone(), n: 1 }];
            for (_, s) in speed_spreads(&d, &b, &th, o.level) { assert!(speed_of(&d, &s, o.level) > th[0].spd && ok(&s)); }
            // every bulk spread survives its threat's best hit, which KOs the plain build
            for t in entrant_pool(&d, &o).into_iter().step_by(23) {
                let tb = auto_build(&d, t, movesets(&d, t, &o, 1).remove(0));
                let th = vec![Threat { name: "t".into(), spd: 0.0, b: tb.clone(), n: 1 }];
                for (n, s) in bulk_spreads(&d, &o, &b, &th) { let need = if n.contains("two hits") { 0.5 } else { 1.0 }; assert!(best_hit(&d, &o, &tb, &b).0 >= need && best_hit(&d, &o, &tb, &s).0 < need && ok(&s)); }
            }
        }
    }
}
