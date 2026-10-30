// Port of sim/search.js (Strongest teams and the Meta chain) and the worker split of sim/cli.mjs.
use crate::batch::*;
use crate::battle::{rng, Build, Rng};
use crate::data::Data;
use crate::jsmath::{pow, round};
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashMap;

fn margin(p: f64, n: f64) -> f64 { if n == 0.0 { return 1.0; } let q = (p * n + 1.0) / (n + 2.0); 1.96 * (q * (1.0 - q) / n).sqrt() }

#[derive(Serialize, Clone)]
pub struct Row { pub k: String, pub keys: Vec<String>, pub g: f64, pub w: f64, pub wr: f64, pub sure: f64 }
pub fn team_rows(full: &IndexMap<String, Gw>) -> Vec<Row> {
    let mut rows: Vec<Row> = full.iter().map(|(k, v)| { let wr = v.w / v.g; Row { k: k.clone(), keys: k.split('+').map(String::from).collect(), g: v.g, w: v.w, wr, sure: wr - margin(wr, v.g) } }).collect();
    rows.sort_by(|a, b| b.sure.partial_cmp(&a.sure).unwrap());
    rows
}

#[derive(Default)]
pub struct Res { pub full: IndexMap<String, Gw>, pub h2h: IndexMap<String, Gw>, pub detail: IndexMap<String, Detail>, pub pick: IndexMap<String, TeamPick> }
pub struct Found { pub rows: Vec<Row>, pub detail: IndexMap<String, Detail>, pub pick: IndexMap<String, TeamPick> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetaTeam {
    pub keys: Vec<String>, pub wr: f64, pub g: f64,
    #[serde(skip_serializing_if = "Option::is_none")] pub vs_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub banned: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")] pub arch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub arch_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pick: Option<TeamPick>,
}
#[derive(Serialize, Default)]
pub struct Chain { pub teams: Vec<MetaTeam>, pub detail: IndexMap<String, Detail>, pub h2h: IndexMap<String, Gw>, pub round: usize, pub rounds: usize, pub archs: usize, pub matrix: bool }

pub struct Field { pub vs: Vec<Vec<String>>, pub weights: Vec<f64> }

pub struct Ctx<'a> {
    pub d: &'a Data, pub base: Opts, pub workers: usize, caches: Vec<HashMap<String, Vec<Build>>>,
    pub stats: Stats, pub done: usize, pub target: usize, pub r: Rng, pub arch: bool, pub ban: usize, pub chain: Chain,
}
impl<'a> Ctx<'a> {
    pub fn new(d: &'a Data, base: Opts, workers: usize, target: usize, seed: f64, arch: bool, ban: usize) -> Ctx<'a> {
        Ctx { d, base, workers, caches: vec![HashMap::new(); workers], stats: Stats::default(), done: 0, target, r: rng(seed), arch, ban, chain: Chain::default() }
    }
    fn seed(&mut self) -> f64 { (self.r.next() * 1e9).floor() }
    // split `total` battles over the workers, each starting at a different ladder team, like cli.mjs; merged in worker order
    pub fn send(&mut self, total: usize, ladder: Option<Ladder>, ladder_size: usize) -> Res {
        let n = self.workers; let base = self.seed();
        let opts: Vec<Opts> = (0..n).map(|i| Opts { count: total / n + usize::from(i < total % n), seed: base + (i * 7919) as f64, ladder: ladder.clone(), offset: i * ladder_size / n, ..self.base.clone() }).collect();
        let d = self.d;
        let out: Vec<Stats> = std::thread::scope(|s| {
            let hs: Vec<_> = self.caches.iter_mut().zip(&opts).map(|(c, o)| s.spawn(move || { let mut st = Stats::default(); run_batch(d, o, &mut st, c); st })).collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let mut res = Res::default();
        for st in &out {
            self.stats.add(st); self.done += st.battles as usize;
            add_wins(&mut res.full, &st.full); add_wins(&mut res.h2h, &st.h2h); add_detail(&mut res.detail, &st.detail); add_picks(&mut res.pick, &st.team_pick);
        }
        res
    }
}

const FINAL_TEAMS: usize = 32;
pub fn search_plan(total: usize) -> Vec<usize> {
    let t = total as f64;
    let gens = (round(t / 8000.0) + 2.0).min(14.0).max(3.0) as usize;
    let first = round(t * 0.2); let mid = ((t - first - round(t * 0.25)) / (gens - 2) as f64).floor();
    (0..gens).map(|i| (if i == 0 { first } else if i < gens - 1 { mid } else { t - first - mid * (gens - 2) as f64 }) as usize).collect()
}
fn pick_rates(pick: &IndexMap<String, TeamPick>, rows: &[Row]) -> HashMap<String, HashMap<String, f64>> {
    let mut out = HashMap::new();
    for r in rows { if let Some(p) = pick.get(&r.k) { if p.g != 0.0 { out.insert(r.k.clone(), r.keys.iter().map(|x| (x.clone(), p.pick.get(x).copied().unwrap_or(0.0) / p.g)).collect()); } } }
    out
}

pub fn search_teams(ctx: &mut Ctx, total: usize, field: Option<&Field>, start: Option<Vec<Vec<String>>>, ban: Vec<String>, archetype: Option<String>) -> Found {
    let plan = search_plan(total);
    let vs = Ladder { vs: field.map(|f| f.vs.clone()), vs_weights: field.map(|f| f.weights.clone()), ban, archetype, ..Default::default() };
    let first = round(plan[0] as f64 * 2.0 / 60.0).min(400.0).max(40.0) as usize;
    let n_start = start.as_ref().map_or(0, |s| s.len());
    let l = Ladder { fresh: first, variants: usize::from(start.is_some()), top: start.unwrap_or_default(), seed: ctx.seed(), ..vs.clone() };
    let mut res = ctx.send(plan[0], Some(l), first + n_start * 2);
    for gen in 1..plan.len() {
        let prev = team_rows(&res.full); let battles = plan[gen]; let last = gen == plan.len() - 1;
        let weights: HashMap<String, f64> = ctx.stats.ent.iter().map(|(k, v)| (k.clone(), pow((v.w / v.g).max(0.02), 3.0))).collect();
        let seed = ctx.seed();
        let top = |n: usize| prev.iter().take(n).map(|r| r.keys.clone()).collect::<Vec<_>>();
        let (ladder, size) = if last {
            let t = top(FINAL_TEAMS); let n = t.len();
            (Ladder { top: t, detail: true, seed, ..vs.clone() }, n)
        } else {
            let pop = round(battles as f64 * 2.0 / 80.0).min(160.0).max(30.0); let keep = round(pop / 5.0) as usize;
            (Ladder { top: top(keep), variants: 2, crosses: keep, fresh: keep, weights: Some(weights), seed, picks: Some(pick_rates(&res.pick, &prev[..keep.min(prev.len())])), ..vs.clone() }, keep * 5)
        };
        res = ctx.send(battles, Some(ladder), size);
    }
    Found { rows: team_rows(&res.full), detail: res.detail, pick: res.pick }
}

// Meta chain: the strongest team, then counters to the chain, archetype rounds, and a final round robin (see search.js).
pub fn meta_chain(ctx: &mut Ctx, total: usize) {
    let archs: Vec<(String, String)> = if ctx.arch && ctx.base.format == Format::Comp { ctx.d.archetypes.iter().map(|a| (a.id.clone(), a.name.clone())).collect() } else { vec![] };
    let t = total as f64;
    let rounds = round(t / 20000.0).min(5.0).max(2.0) as usize;
    let first_budget = round(t * if archs.is_empty() { 0.4 } else { 0.3 }) as usize; let matrix = round(t * 0.1) as usize;
    let arch_each = if archs.is_empty() { 0 } else { (t * 0.3 / archs.len() as f64).floor() as usize };
    let each = (total - first_budget - matrix - arch_each * archs.len()) / rounds;
    ctx.chain.rounds = rounds + 1; ctx.chain.archs = archs.len();
    let mut res = search_teams(ctx, first_budget, None, None, vec![], None);
    let r0 = &res.rows[0];
    ctx.chain.teams.push(MetaTeam { keys: r0.keys.clone(), wr: r0.wr, g: r0.g, vs_field: Some("the strongest teams found".into()), banned: None, arch: None, arch_name: None, pick: res.pick.get(&r0.k).cloned() });
    add_detail(&mut ctx.chain.detail, &res.detail);
    for k in 1..=rounds {
        ctx.chain.round = k;
        let prev_keys: Vec<String> = ctx.chain.teams.iter().map(|t| t.keys.join("+")).collect();
        let n = ctx.chain.teams.len();
        let weights: Vec<f64> = (0..n).map(|i| if i == n - 1 { if n == 1 { 1.0 } else { 0.6 } } else { 0.4 / (n - 1) as f64 }).collect();
        let mut picks: IndexMap<String, usize> = IndexMap::new();
        for t in &ctx.chain.teams { for x in &t.keys { *picks.entry(x.clone()).or_insert(0) += 1; } }
        let wr = |x: &str| ctx.stats.ent.get(x).map_or(0.0, |v| v.w / v.g);
        let mut order: Vec<&String> = picks.keys().collect();
        order.sort_by(|a, b| { let p = picks[*b] as f64 - picks[*a] as f64; (if p != 0.0 { p } else { wr(b) - wr(a) }).partial_cmp(&0.0).unwrap() });
        let ban: Vec<String> = order.into_iter().take(ctx.ban).cloned().collect();
        let start: Vec<Vec<String>> = res.rows.iter().filter(|r| !prev_keys.contains(&r.k) && !r.keys.iter().any(|x| ban.contains(x))).take(8).map(|r| r.keys.clone()).collect();
        let field = Field { vs: ctx.chain.teams.iter().map(|t| t.keys.clone()).collect(), weights };
        res = search_teams(ctx, each, Some(&field), Some(start), ban.clone(), None);
        let best = res.rows.iter().find(|r| !prev_keys.contains(&r.k)).unwrap_or(&res.rows[0]);
        ctx.chain.teams.push(MetaTeam { keys: best.keys.clone(), wr: best.wr, g: best.g, vs_field: None, banned: Some(ban), arch: None, arch_name: None, pick: res.pick.get(&best.k).cloned() });
        add_detail(&mut ctx.chain.detail, &res.detail);
    }
    let meta: Vec<Vec<String>> = ctx.chain.teams.iter().map(|t| t.keys.clone()).collect();
    let meta_keys: Vec<String> = meta.iter().map(|t| t.join("+")).collect();
    for (id, name) in &archs {
        let field = Field { vs: meta.clone(), weights: vec![1.0; meta.len()] };
        res = search_teams(ctx, arch_each, Some(&field), None, vec![], Some(id.clone()));
        let Some(best) = res.rows.iter().find(|r| !meta_keys.contains(&r.k) && !ctx.chain.teams.iter().any(|t| t.keys.join("+") == r.k)) else { continue };
        ctx.chain.teams.push(MetaTeam { keys: best.keys.clone(), wr: best.wr, g: best.g, vs_field: None, banned: None, arch: Some(id.clone()), arch_name: Some(name.clone()), pick: res.pick.get(&best.k).cloned() });
        add_detail(&mut ctx.chain.detail, &res.detail);
    }
    ctx.chain.round = rounds + 1; ctx.chain.matrix = true;
    let sorted = |k: &[String]| { let mut k = k.to_vec(); k.sort(); k.join("+") };
    let forced: HashMap<String, String> = ctx.chain.teams.iter().filter_map(|t| t.arch.as_ref().map(|a| (sorted(&t.keys), a.clone()))).collect();
    let top: Vec<Vec<String>> = ctx.chain.teams.iter().map(|t| t.keys.clone()).collect();
    let n = top.len(); let seed = ctx.seed();
    let res = ctx.send(ctx.target.saturating_sub(ctx.done), Some(Ladder { top, forced: Some(forced), h2h: true, detail: true, seed, ..Default::default() }), n);
    add_wins(&mut ctx.chain.h2h, &res.h2h); add_detail(&mut ctx.chain.detail, &res.detail);
    for t in &mut ctx.chain.teams { if let Some(p) = res.pick.get(&t.keys.join("+")) { if p.g != 0.0 { t.pick = Some(p.clone()); } } }
}
