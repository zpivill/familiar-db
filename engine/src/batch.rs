// Many battles with running totals: a port of sim/batch.js (runBatch, ladderTeams, the draft step and the
// stats it records) and the archetype helpers from sim/archetypes.js. The stats come out with the same
// names and shape as the JS ones, so the page and sim/bench.mjs can read them.

use crate::battle::*;
use crate::builds::*;
use crate::data::*;
use crate::draft::*;
use crate::jsmath::pow;
use crate::rules::*;
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Format { Duel, Team, Duos, Comp }
impl Format { pub fn parse(s: &str) -> Format { match s { "duel" => Format::Duel, "team" => Format::Team, "duos" => Format::Duos, "comp" => Format::Comp, _ => panic!("unknown format {s}") } } }

#[derive(Clone, Default, Debug)]
pub struct Ladder {
    pub top: Vec<Vec<String>>, pub fresh: usize, pub variants: usize, pub crosses: usize,
    pub weights: Option<HashMap<String, f64>>, pub seed: f64,
    pub picks: Option<HashMap<String, HashMap<String, f64>>>,
    pub vs: Option<Vec<Vec<String>>>, pub vs_weights: Option<Vec<f64>>,
    pub forced: Option<HashMap<String, String>>, pub archetype: Option<String>,
    pub ban: Vec<String>, pub detail: bool, pub h2h: bool,
}

// The run's settings after withFormat().
#[derive(Clone, Debug)]
pub struct Opts {
    pub format: Format, pub count: usize, pub seed: f64, pub draft: bool, pub bring: usize, pub team_size: usize,
    pub level: f64, pub learn_level: f64, pub training: bool, pub items: bool, pub turn_cap: i32, pub draw_score: f64,
    pub legend_cap: Option<usize>, pub pick_legend_cap: usize, pub forms_all: bool, pub movesets: Movesets,
    pub ladder: Option<Ladder>, pub offset: usize,
}
impl Opts {
    // opts as the CLI gives them, then withFormat() and teamSize()
    pub fn new(format: Format, count: usize, seed: f64, draft: bool, bring: usize, trained: bool, level: Option<f64>, size: Option<usize>, forms_all: bool) -> Opts {
        let comp = format == Format::Comp;
        let bring = if [8, 10].contains(&bring) { bring } else { COMP_BRING };
        let team_size = match format { Format::Duel => 1, Format::Comp => if draft { bring } else { COMP_TEAM }, Format::Duos => size.unwrap_or(4).max(2), Format::Team => size.unwrap_or(3).max(1) };
        let lv = if comp { COMP_LEVEL } else { level.unwrap_or(LEVEL) };
        Opts { format, count, seed, draft: comp && draft, bring, team_size, level: lv, learn_level: if comp { 100.0 } else { lv },
            training: comp || trained, items: comp || trained, turn_cap: if comp { COMP_TURN_CAP } else { TURN_CAP }, draw_score: if comp { COMP_DRAW } else { 0.5 },
            legend_cap: if comp { Some(if draft { bring_legend_cap(bring) } else { COMP_LEGEND_CAP }) } else { None },
            pick_legend_cap: COMP_LEGEND_CAP, forms_all, movesets: Movesets::Smart, ladder: None, offset: 0 }
    }
    fn duos(&self) -> bool { matches!(self.format, Format::Duos | Format::Comp) }
}

fn is_leg(d: &Data, e: usize) -> bool { let r = &d.entrants[e].rarity; r == "legendary" || r == "mythical" }
fn legal(d: &Data, t: &[usize], e: usize, o: &Opts) -> bool {
    match o.legend_cap { None | Some(0) => true, Some(c) => !is_leg(d, e) || t.iter().filter(|&&x| is_leg(d, x)).count() < c }
}
pub fn team_key(d: &Data, t: &[usize]) -> String { let mut k: Vec<&str> = t.iter().map(|&e| d.entrants[e].key.as_str()).collect(); k.sort(); k.join("+") }

pub fn entrant_pool(d: &Data, o: &Opts) -> Vec<usize> {
    let ban: Vec<&String> = o.ladder.as_ref().map_or(vec![], |l| l.ban.iter().collect());
    (0..d.entrants.len()).filter(|&i| { let e = &d.entrants[i]; (o.forms_all || e.r#final) && e.stats.is_some() && e.sig.is_some() && !ban.contains(&&e.key) }).collect()
}

// ---- archetypes ----
pub const BRING_SETTERS: usize = 1; pub const BRING_ABUSERS: usize = 3;
pub const PICK_SETTERS: usize = 1; pub const PICK_ABUSERS: usize = 2;
pub fn arch_idx(d: &Data, id: &str) -> usize { d.archetypes.iter().position(|a| a.id == id).unwrap_or_else(|| panic!("unknown archetype {id}")) }
pub fn fits(d: &Data, keys: &[usize], a: &ArchRoster, ns: usize, na: usize, cap: Option<usize>) -> bool {
    let plain = |ks: &[usize]| {
        let s: Vec<usize> = ks.iter().copied().filter(|&k| a.setters.contains_key(&d.entrants[k].key)).collect();
        let ab: Vec<usize> = ks.iter().copied().filter(|&k| a.abusers.contains_key(&d.entrants[k].key)).collect();
        if s.len() < ns || ab.len() < na { return false; }
        let mut u = s.clone(); for x in ab { if !u.contains(&x) { u.push(x); } }
        u.len() >= ns + na
    };
    match cap {
        None => plain(keys),
        Some(c) if c >= keys.len() => plain(keys),
        Some(c) => {
            let rest: Vec<usize> = keys.iter().copied().filter(|&k| !is_leg(d, k)).collect();
            let legs: Vec<usize> = keys.iter().copied().filter(|&k| is_leg(d, k)).collect();
            plain(&rest) || (c >= 1 && legs.iter().any(|&l| { let mut v = rest.clone(); v.push(l); plain(&v) }))
        }
    }
}
fn forced(a: &ArchRoster, key: &str) -> Option<(Vec<String>, Option<String>)> {
    let s = a.setters.get(key); let ab = a.abusers.get(key);
    if s.is_none() && ab.is_none() { return None; }
    let moves: Vec<String> = [s.and_then(|x| x.r#move.clone()), ab.and_then(|x| x.r#move.clone())].into_iter().flatten().collect();
    let ability = s.and_then(|x| x.ability.clone()).or(ab.and_then(|x| x.ability.clone()));
    Some((moves, ability))
}

// ---- stats ----
#[derive(Serialize, Default, Clone)]
pub struct Gw { pub g: f64, pub w: f64 }
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntS { pub g: f64, pub w: f64, pub kos: f64, pub dmg: f64, pub taken: f64, pub turns: f64, pub faint: f64, pub lead: f64, pub lead_w: f64 }
#[derive(Serialize, Default, Clone)]
pub struct ItemS { pub g: f64, pub w: f64, pub used: f64 }
#[derive(Serialize, Default, Clone)]
pub struct MoveS { pub eq: f64, pub w: f64, pub uses: f64, pub hits: f64, pub dmg: f64, pub kos: f64, pub crits: f64, pub misses: f64, pub sup: f64 }
#[derive(Serialize, Default, Clone)]
pub struct MoveByS { pub eq: f64, pub w: f64, pub uses: f64, pub dmg: f64, pub kos: f64 }
#[derive(Serialize, Default, Clone)]
pub struct BringS { pub b: f64, pub p: f64, pub pw: f64, pub lead: f64 }
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamPick { pub g: f64, pub w: f64, pub turns: f64, pub pick: IndexMap<String, f64>, pub lead: IndexMap<String, f64>, pub pick_w: IndexMap<String, f64> }
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Detail { pub g: f64, pub w: f64, pub win_turns: f64, pub kos: IndexMap<String, f64>, pub dmg: IndexMap<String, f64>, pub r#use: IndexMap<String, f64> }
const MOVE_KINDS: [&str; 6] = ["attack", "setup", "heal", "status", "protect", "support"];
impl Default for Detail { fn default() -> Detail { Detail { g: 0.0, w: 0.0, win_turns: 0.0, kos: IndexMap::new(), dmg: IndexMap::new(), r#use: MOVE_KINDS.iter().map(|k| (k.to_string(), 0.0)).collect() } } }
#[derive(Serialize, Default, Clone)]
pub struct DraftS { pub g: f64, pub overlap: f64, pub exact: f64 }

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub battles: f64, pub draws: f64, pub turns: f64,
    pub ent: IndexMap<String, EntS>, pub abil: IndexMap<String, Gw>, pub r#move: IndexMap<String, MoveS>, pub move_by: IndexMap<String, MoveByS>,
    pub combo: IndexMap<String, Gw>, pub pairs: IndexMap<String, Gw>, pub vs: IndexMap<String, Gw>, pub full: IndexMap<String, Gw>,
    pub detail: IndexMap<String, Detail>, pub h2h: IndexMap<String, Gw>, pub item: IndexMap<String, ItemS>, pub nature: IndexMap<String, Gw>,
    pub bring: IndexMap<String, BringS>, pub core: IndexMap<String, Gw>, pub lead_pair: IndexMap<String, Gw>, pub vs_char: IndexMap<String, Gw>,
    pub turn_hist: IndexMap<String, f64>, pub team_pick: IndexMap<String, TeamPick>, pub draft: DraftS, pub faster: Gw, pub lead: Gw,
}
fn gw<'m>(m: &'m mut IndexMap<String, Gw>, k: String) -> &'m mut Gw { m.entry(k).or_default() }
fn addm(m: &mut IndexMap<String, f64>, k: &str, v: f64) { *m.entry(k.to_string()).or_insert(0.0) += v; }
macro_rules! merge_map { ($t:expr, $s:expr, $($f:ident),+) => { for (k, v) in $s { let x = $t.entry(k.clone()).or_default(); $( x.$f += v.$f; )+ } }; }
pub fn add_wins(t: &mut IndexMap<String, Gw>, s: &IndexMap<String, Gw>) { merge_map!(t, s, g, w); }
pub fn add_detail(t: &mut IndexMap<String, Detail>, s: &IndexMap<String, Detail>) {
    for (k, v) in s { let x = t.entry(k.clone()).or_default(); x.g += v.g; x.w += v.w; x.win_turns += v.win_turns;
        for (a, b) in &v.kos { addm(&mut x.kos, a, *b); } for (a, b) in &v.dmg { addm(&mut x.dmg, a, *b); } for (a, b) in &v.r#use { addm(&mut x.r#use, a, *b); } }
}
pub fn add_picks(t: &mut IndexMap<String, TeamPick>, s: &IndexMap<String, TeamPick>) {
    for (k, v) in s { let x = t.entry(k.clone()).or_default(); x.g += v.g; x.w += v.w; x.turns += v.turns;
        for (a, b) in &v.pick { addm(&mut x.pick, a, *b); } for (a, b) in &v.lead { addm(&mut x.lead, a, *b); } for (a, b) in &v.pick_w { addm(&mut x.pick_w, a, *b); } }
}
impl Stats {
    // T += S, as the JS deep add does
    pub fn add(&mut self, s: &Stats) {
        self.battles += s.battles; self.draws += s.draws; self.turns += s.turns;
        merge_map!(self.ent, &s.ent, g, w, kos, dmg, taken, turns, faint, lead, lead_w);
        for (t, src) in [(&mut self.abil, &s.abil), (&mut self.combo, &s.combo), (&mut self.pairs, &s.pairs), (&mut self.vs, &s.vs), (&mut self.full, &s.full),
            (&mut self.h2h, &s.h2h), (&mut self.nature, &s.nature), (&mut self.core, &s.core), (&mut self.lead_pair, &s.lead_pair), (&mut self.vs_char, &s.vs_char)] { merge_map!(t, src, g, w); }
        merge_map!(self.r#move, &s.r#move, eq, w, uses, hits, dmg, kos, crits, misses, sup);
        merge_map!(self.move_by, &s.move_by, eq, w, uses, dmg, kos);
        merge_map!(self.item, &s.item, g, w, used);
        merge_map!(self.bring, &s.bring, b, p, pw, lead);
        for (k, v) in &s.turn_hist { addm(&mut self.turn_hist, k, *v); }
        add_detail(&mut self.detail, &s.detail);
        add_picks(&mut self.team_pick, &s.team_pick);
        self.draft.g += s.draft.g; self.draft.overlap += s.draft.overlap; self.draft.exact += s.draft.exact;
        self.faster.g += s.faster.g; self.faster.w += s.faster.w; self.lead.g += s.lead.g; self.lead.w += s.lead.w;
    }
}

fn move_kind(m: &Move) -> &'static str {
    if m.cat != Cat::Status { return "attack"; }
    let fx = &m.fx;
    if fx.boosts.as_ref().map_or(false, |bs| bs.iter().any(|b| b.who == "self" && b.stats.iter().any(|&(_, v)| v > 0))) { return "setup"; }
    if fx.heal != 0.0 { return "heal"; }
    if fx.status.is_some() { return "status"; }
    if fx.protect.is_some() || fx.substitute != 0.0 { return "protect"; }
    "support"
}
fn record_detail(s: &mut Stats, d: &Data, b: &Battle, si: usize, key: &str, o: &Opts) {
    let x = s.detail.entry(key.to_string()).or_default();
    let won = b.winner == si as i32;
    x.g += 1.0; x.w += if won { 1.0 } else if b.winner < 0 { o.draw_score } else { 0.0 };
    if won { x.win_turns += b.turn as f64; }
    for &m in &b.sides[si].mons {
        let mm = &b.mons[m]; let k = &d.entrants[mm.e].key;
        addm(&mut x.kos, k, mm.t.kos); addm(&mut x.dmg, k, mm.t.dmg / mm.maxhp);
        for (id, t) in &mm.t.moves { addm(&mut x.r#use, move_kind(&d.moves[*id]), t.uses); }
    }
}

fn record(s: &mut Stats, d: &Data, b: &Battle, builds: [&[Build]; 2], o: &Opts) {
    s.battles += 1.0; s.turns += b.turn as f64;
    addm(&mut s.turn_hist, &b.turn.to_string(), 1.0);
    if b.winner < 0 { s.draws += 1.0; }
    for si in 0..2 {
        let won = if b.winner == si as i32 { 1.0 } else { 0.0 }; let half = if b.winner < 0 { o.draw_score } else { 0.0 };
        let leads = if b.duos { 2 } else { 1 };
        let w = if won != 0.0 { won } else { half };
        for (k, &m) in b.sides[si].mons.iter().enumerate() {
            let bd = &builds[si][k]; let mm = &b.mons[m]; let key = &d.entrants[mm.e].key;
            let e = s.ent.entry(key.clone()).or_default();
            e.g += 1.0; e.w += w; e.kos += mm.t.kos; e.dmg += mm.t.dmg / mm.maxhp; e.taken += mm.t.taken / mm.maxhp; e.turns += mm.t.turns; e.faint += if mm.fainted { 1.0 } else { 0.0 };
            if k < leads { e.lead += 1.0; e.lead_w += w; }
            let a = gw(&mut s.abil, format!("{key}|{}", bd.ability_name)); a.g += 1.0; a.w += w;
            if let Some(it) = bd.item { let i = s.item.entry(format!("{key}|{}", it.key())).or_default(); i.g += 1.0; i.w += w; i.used += if mm.item_used { 1.0 } else { 0.0 }; }
            if let Some(n) = bd.nature { let x = gw(&mut s.nature, format!("{key}|{}|{}", n.name(), bd.preset.unwrap_or(""))); x.g += 1.0; x.w += w; }
            for &(id, _) in &bd.moves {
                let mid = &d.moves[id].id;
                let ms = s.r#move.entry(mid.clone()).or_default();
                ms.eq += 1.0; ms.w += w;
                let t = mm.t.moves.iter().find(|x| x.0 == id).map(|x| &x.1);
                if let Some(t) = t { ms.uses += t.uses; ms.hits += t.hits; ms.dmg += t.dmg; ms.kos += t.kos; ms.crits += t.crits; ms.misses += t.misses; ms.sup += t.sup; }
                let mb = s.move_by.entry(format!("{key}|{mid}")).or_default();
                mb.eq += 1.0; mb.w += w; mb.uses += t.map_or(0.0, |t| t.uses); mb.dmg += t.map_or(0.0, |t| t.dmg); mb.kos += t.map_or(0.0, |t| t.kos);
            }
            let types: Vec<&str> = d.entrants[mm.e].types.iter().map(|&t| TYPES[t as usize]).collect();
            let c = gw(&mut s.combo, types.join("/")); c.g += 1.0; c.w += w;
        }
        let ms = &b.sides[si].mons;
        if ms.len() > 1 {
            let mut keys: Vec<&str> = ms.iter().map(|&m| d.entrants[b.mons[m].e].key.as_str()).collect(); keys.sort();
            for i in 0..keys.len() { for j in i + 1..keys.len() { let p = gw(&mut s.pairs, format!("{}+{}", keys[i], keys[j])); p.g += 1.0; p.w += w; } }
        }
    }
    if b.sides[0].mons.len() == 1 && b.sides[1].mons.len() == 1 {
        let (a, bb) = (&b.mons[b.sides[0].mons[0]], &b.mons[b.sides[1].mons[0]]);
        let (ka, kb) = (&d.entrants[a.e].key, &d.entrants[bb.e].key);
        let (x, y, xw) = if ka < kb { (ka, kb, b.winner == 0) } else { (kb, ka, b.winner == 1) };
        let v = gw(&mut s.vs, format!("{x}>{y}")); v.g += 1.0; v.w += if b.winner < 0 { 0.5 } else if xw { 1.0 } else { 0.0 };
        let (sa, sb) = (a.raw[SPE], bb.raw[SPE]);
        if sa != sb && b.winner >= 0 { s.faster.g += 1.0; s.faster.w += if (sa > sb) == (b.winner == 0) { 1.0 } else { 0.0 }; }
    }
}

pub struct DraftOut { pub six: [Vec<Build>; 2], pub drafts: [Draft; 2] }
fn run_draft(d: &Data, sides: &[Vec<usize>; 2], builds: &[Vec<Build>; 2], r: &mut Rng, o: &Opts, arch: &[Option<usize>; 2], cache: &mut HashMap<String, Vec<Build>>) -> DraftOut {
    let mut guess = |t: &[usize]| -> Vec<Build> {
        let k = team_key(d, t);
        if let Some(g) = cache.get(&k) { return g.clone(); }
        if cache.len() > 400 { cache.clear(); }
        let g = guess_builds(d, t, o.learn_level, o.duos());
        cache.insert(k, g.clone()); g
    };
    let must = |s: usize| arch[s].map(|a| { let a = &d.archetypes[a];
        Must { setters: builds[s].iter().enumerate().filter(|(_, b)| a.setters.contains_key(&d.entrants[b.e].key)).map(|x| x.0).collect(),
               abusers: builds[s].iter().enumerate().filter(|(_, b)| a.abusers.contains_key(&d.entrants[b.e].key)).map(|x| x.0).collect(),
               need_setters: PICK_SETTERS, need_abusers: PICK_ABUSERS } });
    let g1 = guess(&sides[1]);
    let d0 = draft_side(d, &builds[0], &g1, o.level, o.pick_legend_cap, must(0).as_ref(), r);
    let g0 = guess(&sides[0]);
    let d1 = draft_side(d, &builds[1], &g0, o.level, o.pick_legend_cap, must(1).as_ref(), r);
    let six = [d0.order.iter().map(|&i| builds[0][i].clone()).collect(), d1.order.iter().map(|&i| builds[1][i].clone()).collect()];
    DraftOut { six, drafts: [d0, d1] }
}
fn record_draft(s: &mut Stats, d: &Data, b: &Battle, builds: &[Vec<Build>; 2], dr: &DraftOut, o: &Opts) {
    for si in 0..2 {
        let dd = &dr.drafts[si];
        let w = if b.winner == si as i32 { 1.0 } else if b.winner < 0 { o.draw_score } else { 0.0 };
        for (i, bd) in builds[si].iter().enumerate() {
            let k = dd.order.iter().position(|&x| x == i);
            let x = s.bring.entry(d.entrants[bd.e].key.clone()).or_default();
            x.b += 1.0;
            if let Some(k) = k { x.p += 1.0; x.pw += w; if k < 2 { x.lead += 1.0; } }
        }
        let key = |i: usize| d.entrants[builds[si][i].e].key.as_str();
        let pair = |x: usize, y: usize| { let mut v = [key(x), key(y)]; v.sort(); format!("{}+{}", v[0], v[1]) };
        for c in &dd.cores { let k = format!("{}|{}", if c.by { format!("{}>{}", key(c.a), key(c.b)) } else { pair(c.a, c.b) }, c.kind); let g = gw(&mut s.core, k); g.g += 1.0; g.w += w; }
        let l = gw(&mut s.lead_pair, pair(dd.order[0], dd.order[1])); l.g += 1.0; l.w += w;
        for &i in &dd.order { for &j in &dr.drafts[1 - si].order {
            let v = gw(&mut s.vs_char, format!("{}>{}", key(i), d.entrants[builds[1 - si][j].e].key)); v.g += 1.0; v.w += w;
        } }
        let (ov, ex) = prediction_hit(&dd.predicted, &dr.drafts[1 - si].order);
        s.draft.g += 1.0; s.draft.overlap += ov; s.draft.exact += if ex { 1.0 } else { 0.0 };
    }
}

// Whole teams for team ranking, as ladderTeams() in batch.js. Every thread builds the same list from the same seed.
pub fn ladder_teams(d: &Data, o: &Opts) -> Vec<Vec<usize>> {
    let l = o.ladder.as_ref().unwrap();
    let mut r = rng(l.seed); let size = o.team_size;
    let pool = entrant_pool(d, o);
    let w = &l.weights;
    let mut cum: Option<Vec<f64>> = None;
    let mut pick = |r: &mut Rng| -> usize {
        if w.is_none() || r.next() < 1.0 / 3.0 { return pool[r.pick_i(pool.len())]; }
        let c = cum.get_or_insert_with(|| { let mut t = 0.0; pool.iter().map(|&e| { t += *w.as_ref().unwrap().get(&d.entrants[e].key).unwrap_or(&0.05); t }).collect() });
        let x = r.next() * c[c.len() - 1];
        let (mut lo, mut hi) = (0usize, c.len() - 1);
        while lo < hi { let m = (lo + hi) >> 1; if c[m] < x { lo = m + 1; } else { hi = m; } }
        pool[lo]
    };
    let mut fill = |mut t: Vec<usize>, r: &mut Rng| -> Option<Vec<usize>> {
        let mut used: Vec<&str> = t.iter().map(|&e| d.entrants[e].cid.as_str()).collect();
        let mut guard = 0;
        while t.len() < size && guard < 500 {
            let e = pick(r);
            if !used.contains(&d.entrants[e].cid.as_str()) && legal(d, &t, e, o) { used.push(d.entrants[e].cid.as_str()); t.push(e); }
            guard += 1;
        }
        if t.len() == size { Some(t) } else { None }
    };
    let a = l.archetype.as_ref().map(|id| &d.archetypes[arch_idx(d, id)]);
    let a_set: Vec<usize> = a.map_or(vec![], |a| pool.iter().copied().filter(|&e| a.setters.contains_key(&d.entrants[e].key)).collect());
    let a_ab: Vec<usize> = a.map_or(vec![], |a| pool.iter().copied().filter(|&e| a.abusers.contains_key(&d.entrants[e].key)).collect());
    let cap6 = Some(o.pick_legend_cap).filter(|_| o.format == Format::Comp && o.draft);
    let ok = |t: &[usize]| { let a = a.unwrap(); fits(d, t, a, BRING_SETTERS, BRING_ABUSERS, None) && fits(d, t, a, PICK_SETTERS, PICK_ABUSERS, cap6) };
    let repair = |t: Option<Vec<usize>>, r: &mut Rng| -> Option<Vec<usize>> {
        let ar = match a { None => return t, Some(x) => x };
        let mut t = t?;
        let role = |e: usize| ar.setters.contains_key(&d.entrants[e].key) || ar.abusers.contains_key(&d.entrants[e].key);
        let mut guard = 0;
        while guard < 40 && !ok(&t) {
            let n_s = t.iter().filter(|&&e| ar.setters.contains_key(&d.entrants[e].key)).count();
            let (src, gone): (Vec<usize>, Option<usize>);
            if fits(d, &t, ar, BRING_SETTERS, BRING_ABUSERS, None) {
                let n_sn = t.iter().filter(|&&e| ar.setters.contains_key(&d.entrants[e].key) && !is_leg(d, e)).count();
                src = (if n_sn < PICK_SETTERS { &a_set } else { &a_ab }).iter().copied().filter(|&e| !is_leg(d, e)).collect();
                let cand: Vec<usize> = t.iter().copied().filter(|&e| role(e) && is_leg(d, e)).chain(t.iter().copied().filter(|&e| !role(e))).collect();
                let i = r.pick_i(cand.len()); gone = cand.get(i).copied();
            } else {
                src = if n_s < BRING_SETTERS { a_set.clone() } else { a_ab.clone() };
                let spare: Vec<usize> = t.iter().copied().filter(|&e| !role(e)).collect();
                if !spare.is_empty() { gone = Some(spare[r.pick_i(spare.len())]); }
                else { let c: Vec<usize> = t.iter().copied().filter(|&e| !(n_s <= BRING_SETTERS && ar.setters.contains_key(&d.entrants[e].key))).collect(); let i = r.pick_i(c.len()); gone = c.get(i).copied(); }
            }
            let gone = match gone { Some(g) if !src.is_empty() => g, _ => return None };
            let rest: Vec<usize> = t.iter().copied().filter(|&e| e != gone).collect();
            let used: Vec<&str> = rest.iter().map(|&e| d.entrants[e].cid.as_str()).collect();
            let o2: Vec<usize> = src.iter().copied().filter(|&e| !used.contains(&d.entrants[e].cid.as_str()) && legal(d, &rest, e, o)).collect();
            if o2.is_empty() { return None; }
            let mut nt = rest; nt.push(o2[r.pick_i(o2.len())]); t = nt;
            guard += 1;
        }
        if ok(&t) { Some(t) } else { None }
    };
    let mut out: Vec<Vec<usize>> = vec![]; let mut seen: HashSet<String> = HashSet::new();
    let mut add = |t: Option<Vec<usize>>, r: &mut Rng, out: &mut Vec<Vec<usize>>| -> bool {
        let t = repair(t, r);
        if let Some(t) = t { let k = team_key(d, &t); if !seen.contains(&k) { seen.insert(k); out.push(t); return true; } }
        false
    };
    let ban: Vec<&String> = l.ban.iter().collect();
    let top: Vec<Vec<usize>> = l.top.iter().map(|ks| ks.iter().filter_map(|k| d.ent_idx.get(k).copied()).collect::<Vec<usize>>())
        .filter(|t: &Vec<usize>| t.len() == size && !t.iter().any(|&e| ban.contains(&&d.entrants[e].key))).collect();
    for t in &top { add(Some(t.clone()), &mut r, &mut out); }
    for t in &top {
        let swappable = t.clone();
        let mut v = 0;
        while v < l.variants && !swappable.is_empty() {
            let rate = l.picks.as_ref().and_then(|p| p.get(&team_key(d, t)));
            for _ in 0..10 {
                let gone = match rate {
                    Some(rate) => { let w: Vec<f64> = swappable.iter().map(|&e| pow(1.0 - *rate.get(&d.entrants[e].key).unwrap_or(&0.5), 2.0) + 0.05).collect();
                        let mut x = r.next() * w.iter().fold(0.0, |a, b| a + b); let mut i = 0; while i < swappable.len() - 1 && { x -= w[i]; x > 0.0 } { i += 1; } swappable[i] }
                    None => swappable[r.pick_i(swappable.len())],
                };
                let f = fill(t.iter().copied().filter(|&e| e != gone).collect(), &mut r);
                if add(f, &mut r, &mut out) { break; }
            }
            v += 1;
        }
    }
    let (mut c, mut tries) = (0, 0);
    while c < l.crosses && top.len() > 1 && tries < l.crosses * 10 {
        tries += 1;
        let (ai, bi) = (r.pick_i(top.len()), r.pick_i(top.len()));
        if ai == bi { continue; }
        let mut mix: Vec<usize> = vec![];
        for &e in top[ai].iter().chain(top[bi].iter()) { if !mix.iter().any(|&x| d.entrants[x].cid == d.entrants[e].cid) { mix.push(e); } }
        let mut t: Vec<usize> = vec![];
        let mut rest = mix;
        while t.len() < size && !rest.is_empty() { let i = (r.next() * rest.len() as f64).floor() as usize; let e = rest.remove(i); if legal(d, &t, e, o) { t.push(e); } }
        let f = fill(t, &mut r);
        if add(f, &mut r, &mut out) { c += 1; }
    }
    let want = out.len() + l.fresh;
    let mut tries = 0;
    while out.len() < want && tries < l.fresh * 20 { let f = fill(vec![], &mut r); add(f, &mut r, &mut out); tries += 1; }
    if out.len() < 2 { panic!("Not enough characters to make teams. Pick more tiers or a smaller team size."); }
    out
}

// Runs o.count battles into s. cache: guessed builds per brought team, kept between batches of one thread.
pub fn run_batch(d: &Data, o: &Opts, s: &mut Stats, cache: &mut HashMap<String, Vec<Build>>) {
    let mut r = rng(if o.seed != 0.0 { o.seed } else { 1.0 });
    let pool = entrant_pool(d, o);
    if pool.len() < 2 { panic!("Pick at least two characters."); }
    let size = o.team_size;
    let ladder = o.ladder.as_ref().map(|_| ladder_teams(d, o));
    if ladder.as_ref().map_or(false, |l| l.is_empty()) { return; }
    let lo = o.ladder.as_ref();
    let vs: Option<Vec<Vec<usize>>> = lo.and_then(|l| l.vs.as_ref()).map(|v| v.iter().map(|ks| ks.iter().filter_map(|k| d.ent_idx.get(k).copied()).collect::<Vec<usize>>()).filter(|t: &Vec<usize>| t.len() == size).collect());
    let vs_w: Option<Vec<f64>> = vs.as_ref().map(|v| lo.unwrap().vs_weights.clone().unwrap_or_else(|| vec![1.0; v.len()]));
    let bo = BattleOpts { duos: o.duos(), level: o.level, turn_cap: o.turn_cap, plans: [None, None] };
    for n in 0..o.count {
        let mut used: Vec<usize> = vec![];
        let team = |r: &mut Rng, used: &mut Vec<usize>| -> Vec<usize> {
            let mut t = vec![]; let mut guard = 0;
            while t.len() < size && { guard += 1; guard - 1 < 500 } {
                let e = pool[r.pick_i(pool.len())];
                let cid = d.entrants[e].ci;
                if used.contains(&cid) || !legal(d, &t, e, o) { continue; }
                used.push(cid); t.push(e);
            }
            t
        };
        let mut sides: [Vec<usize>; 2];
        let mut scored: Vec<usize> = vec![0, 1];
        if let Some(lad) = &ladder {
            let a = (n + o.offset) % lad.len();
            if let Some(vs) = &vs {
                let w = vs_w.as_ref().unwrap();
                let mut x = r.next() * w.iter().fold(0.0, |a, b| a + b); let mut i = 0;
                while i < vs.len() - 1 && { x -= w[i]; x > 0.0 } { i += 1; }
                sides = [lad[a].clone(), vs[i].clone()]; scored = vec![0];
            } else {
                let j = (a + 1 + (r.next() * (lad.len() - 1) as f64).floor() as usize) % lad.len();
                sides = [lad[a].clone(), lad[j].clone()];
            }
        } else {
            let t0 = team(&mut r, &mut used); let t1 = team(&mut r, &mut used);
            if t1.len() < size || t0.len() < size { continue; }
            sides = [t0, t1];
        }
        let mut ladder_side = 0;
        if r.next() < 0.5 { sides.swap(0, 1); scored = scored.iter().map(|&i| 1 - i).collect(); ladder_side = 1; }
        let arch_ids: [Option<usize>; 2] = [0, 1].map(|i| {
            let l = match lo { Some(l) => l, None => return None };
            if let Some(f) = l.forced.as_ref().and_then(|f| f.get(&team_key(d, &sides[i]))) { return Some(arch_idx(d, f)); }
            match &l.archetype { Some(a) if vs.is_none() || i == ladder_side => Some(arch_idx(d, a)), _ => None }
        });
        let mut builds: [Vec<Build>; 2] = [vec![], vec![]];
        for i in 0..2 {
            let mut bs: Vec<Build> = sides[i].iter().map(|&e| {
                let f = arch_ids[i].and_then(|a| forced(&d.archetypes[a], &d.entrants[e].key));
                let empty: Vec<String> = vec![];
                let (fm, fa) = match &f { Some((m, a)) => (m.as_slice(), a.as_deref()), None => (empty.as_slice(), None) };
                make_build(d, e, &mut r, &BuildOpts { level: o.learn_level, movesets: o.movesets, duos: o.duos(), force_moves: fm, force_ability: fa })
            }).collect();
            train_team(d, &mut bs, &mut r, o.training, o.items);
            builds[i] = bs;
        }
        let dr = if o.draft { Some(run_draft(d, &sides, &builds, &mut r, o, &arch_ids, cache)) } else { None };
        let bo = BattleOpts { plans: arch_ids, ..bo };
        let fight: [&[Build]; 2] = match &dr { Some(x) => [&x.six[0], &x.six[1]], None => [&builds[0], &builds[1]] };
        let b = run_battle(d, fight, r.clone(), &bo);
        r = b.r.clone();
        record(s, d, &b, fight, o);
        if let Some(x) = &dr { record_draft(s, d, &b, &builds, x, o); }
        if let (Some(_), Some(l)) = (&ladder, lo) {
            for &si in &scored {
                let k = team_key(d, &sides[si]);
                let w = if b.winner == si as i32 { 1.0 } else if b.winner < 0 { o.draw_score } else { 0.0 };
                let f = gw(&mut s.full, k.clone()); f.g += 1.0; f.w += w;
                if let Some(x) = &dr {
                    let p = s.team_pick.entry(k.clone()).or_default();
                    p.g += 1.0; p.w += w; p.turns += b.turn as f64;
                    for (j, &i) in x.drafts[si].order.iter().enumerate() {
                        let key = &d.entrants[sides[si][i]].key;
                        addm(&mut p.pick, key, 1.0); addm(&mut p.pick_w, key, w); if j < 2 { addm(&mut p.lead, key, 1.0); }
                    }
                }
                if l.detail { record_detail(s, d, &b, si, &k, o); }
                if l.h2h { let h = gw(&mut s.h2h, format!("{k}|{}", team_key(d, &sides[1 - si]))); h.g += 1.0; h.w += w; }
            }
        }
    }
}
