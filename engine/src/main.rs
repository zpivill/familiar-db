// Fast battle sim, a port of sim/ with the same results for the same seed and worker count.
//   familiar-sim [count] [duel|team|duos|comp] [seed]  with the flags of sim/cli.mjs:
//   --trained --level=50 --size=4 --draft --bring=10 --hp=3 --forms=all --workers=4 --search=best|meta --arch --ban=2 --json=out.json
//   familiar-sim batch [count] [format] [seed] ...  one single-thread batch, totals as JSON (for tests/parity.mjs)
// Reads data.json (written by `node sim/export.mjs`) from beside the program or the current folder, or --data=path.
#![allow(dead_code)]
mod ai;
mod batch;
mod battle;
mod builds;
mod data;
mod draft;
mod jsmath;
mod rules;
mod search;
use std::collections::HashMap;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut args: Vec<&str> = argv.iter().filter(|a| !a.starts_with("--")).map(|s| s.as_str()).collect();
    let flag = |n: &str| argv.iter().find_map(|a| a.strip_prefix(&format!("--{n}=")).map(|s| s.to_string()).or_else(|| (a == &format!("--{n}")).then(|| "true".to_string())));
    let single = args.first() == Some(&"batch");
    if single { args.remove(0); }
    // data.json next to the program (the Windows download), else in the current folder
    let beside = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("data.json"))).filter(|p| p.exists());
    let d = data::Data::load(&flag("data").unwrap_or_else(|| beside.map_or("data.json".into(), |p| p.to_string_lossy().into_owned())));
    if let Some(h) = flag("hp") { rules::set_hp_scale(h.parse().unwrap()); }
    let count: usize = args.first().unwrap_or(&"1000").parse().unwrap();
    let format = batch::Format::parse(args.get(1).unwrap_or(&"duel"));
    let seed: f64 = args.get(2).unwrap_or(&"1").parse().unwrap();
    let num = |n: &str| flag(n).map(|v| v.parse::<f64>().unwrap());
    let o = batch::Opts::new(format, count, seed, flag("draft").is_some(), num("bring").map_or(8, |b| b as usize), flag("trained").is_some(), num("level"), num("size").map(|s| s as usize), flag("forms").as_deref() == Some("all"));
    if single {
        let mut s = batch::Stats::default();
        batch::run_batch(&d, &o, &mut s, &mut HashMap::new());
        println!("{}", serde_json::to_string(&s).unwrap());
        return;
    }
    let workers = num("workers").map_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()), |w| (w as usize).max(1));
    let mode = flag("search");
    let mut ctx = search::Ctx::new(&d, o, workers, count, seed, flag("arch").is_some(), num("ban").map_or(0, |b| b as usize));
    let t0 = std::time::Instant::now();
    let mut best = None;
    match mode.as_deref() {
        Some("meta") => search::meta_chain(&mut ctx, count),
        Some("best") => best = Some(search::search_teams(&mut ctx, count, None, None, vec![], None)),
        Some(m) => panic!("--search={m} is only in the JS sim (node sim/cli.mjs)"),
        None => { ctx.send(count, None, 0); }
    }
    let ms = t0.elapsed().as_millis();
    let s = &ctx.stats;
    let name = |k: &str| d.ent_idx.get(k).map_or(k.to_string(), |&e| d.entrants[e].name.clone());
    let names = |ks: &[String]| ks.iter().map(|k| name(k)).collect::<Vec<_>>().join(", ");
    println!("{} battles in {} ms on {} workers ({:.3} ms each), avg {:.1} turns, {} draws", s.battles, ms, workers, ms as f64 / s.battles, s.turns / s.battles, s.draws);
    if mode.as_deref() == Some("meta") {
        for t in &ctx.chain.teams { println!("{:<14} {:.0}% ({})  {}", t.arch_name.as_deref().unwrap_or("meta"), t.wr * 100.0, t.g, names(&t.keys)); }
    } else if let Some(b) = &best {
        for r in b.rows.iter().take(8) { println!("{:.0}% ({})  {}", r.wr * 100.0, r.g, names(&r.keys)); }
    } else {
        let mut rows: Vec<(&String, f64, f64)> = s.ent.iter().map(|(k, v)| (k, v.w / v.g, v.g)).collect();
        rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        let fmt = |r: &[(&String, f64, f64)]| r.iter().map(|r| format!("{} {:.0}% ({})", r.0, r.1 * 100.0, r.2)).collect::<Vec<_>>().join(", ");
        println!("top {}", fmt(&rows[..12.min(rows.len())]));
        println!("bottom {}", fmt(&rows[rows.len().saturating_sub(12)..]));
    }
    if let Some(f) = flag("json") {
        let out = serde_json::json!({ "args": argv, "ms": ms, "stats": s, "chain": (mode.as_deref() == Some("meta")).then_some(&ctx.chain), "best": best.as_ref().map(|b| &b.rows[..32.min(b.rows.len())]) });
        std::fs::write(f, serde_json::to_string(&out).unwrap()).unwrap();
    }
}
