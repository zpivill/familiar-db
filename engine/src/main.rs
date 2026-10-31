// Fast battle sim, a port of sim/ with the same results for the same seed and worker count.
//   familiar-sim [count] [duel|team|duos|comp] [seed]  with the flags of sim/cli.mjs:
//   --trained --level=50 --size=4 --draft --bring=10 --hp=3 --forms=all --workers=4 --search=best|meta --arch --ban=2 --json=out.json
//   --hidden (each battle AI sees the foes' builds only as it guessed them, as in the draft)
//   --ai=search --iters=128 (both sides play with the search AI), --recheck=meta.json (its final round robin with the search AI)
//   --optimize=meta.json[,more.json] [--per=200 --passes=2 --only=a,b] (build search against their teams, book to --json),
//   --builds=book.json[,more.json] (play with a book; several books give each character all their builds, picked at random)
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
mod mcts;
mod optimize;
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
    let mut d = data::Data::load(&flag("data").unwrap_or_else(|| beside.map_or("data.json".into(), |p| p.to_string_lossy().into_owned())));
    if let Some(h) = flag("hp") { rules::set_hp_scale(h.parse().unwrap()); }
    if let Some(f) = flag("builds") { for f in f.split(',') { optimize::load_book(&mut d, f); } }
    let d = d;
    let count: usize = args.first().unwrap_or(&"1000").parse().unwrap();
    let format = batch::Format::parse(args.get(1).unwrap_or(&"duel"));
    let seed: f64 = args.get(2).unwrap_or(&"1").parse().unwrap();
    let num = |n: &str| flag(n).map(|v| v.parse::<f64>().unwrap());
    let mut o = batch::Opts::new(format, count, seed, flag("draft").is_some(), num("bring").map_or(8, |b| b as usize), flag("trained").is_some(), num("level"), num("size").map(|s| s as usize), flag("forms").as_deref() == Some("all"));
    o.hidden = flag("hidden").is_some();
    if flag("ai").as_deref() == Some("search") || flag("recheck").is_some() { o.search_ai = Some(num("iters").map_or(128, |i| i as usize)); }
    if single {
        let mut s = batch::Stats::default();
        batch::run_batch(&d, &o, &mut s, &mut HashMap::new());
        println!("{}", serde_json::to_string(&s).unwrap());
        return;
    }
    let workers0 = num("workers").map_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()), |w| (w as usize).max(1));
    if let Some(f) = flag("optimize") {
        // build search against a saved meta chain's teams (archetype teams keep their plan); writes the build book to --json
        // several files (a,b,c): the teams of all of them, each team once
        let mut teams: Vec<(Vec<usize>, Option<usize>)> = vec![];
        for f in f.split(',') {
            let c: serde_json::Value = serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(f).unwrap()).unwrap()["chain"].clone();
            for t in c["teams"].as_array().unwrap() {
                let keys: Vec<String> = serde_json::from_value(t["keys"].clone()).unwrap();
                let x = (keys.iter().map(|k| d.ent_idx[k]).collect::<Vec<_>>(), t["arch"].as_str().map(|a| batch::arch_idx(&d, a)));
                if !teams.contains(&x) { teams.push(x); }
            }
        }
        let only: Vec<usize> = flag("only").map_or(vec![], |s| s.split(',').map(|k| d.ent_idx[k]).collect());
        let p = optimize::Opt { battles: num("per").map_or(200, |x| x as usize), passes: num("passes").map_or(2, |x| x as usize), seed };
        let t0 = std::time::Instant::now();
        let book = optimize::optimize_all(&d, &o, &optimize::Field { teams }, &p, workers0, &only);
        let mut rows: Vec<(&String, &optimize::Entry)> = book.iter().collect();
        rows.sort_by(|a, b| b.1.gain.partial_cmp(&a.1.gain).unwrap());
        println!("{} characters in {} s; biggest gains (fresh battles):", book.len(), t0.elapsed().as_secs());
        for (k, en) in rows.iter().take(15) { let b = &en.builds[0]; println!("{:+5.1}  {:<28} {} | {} | {} | {}", en.gain * 100.0, name_of(&d, k), b.ability, b.preset, b.item.as_deref().unwrap_or("none"), b.moves.join(", ")); }
        let avg = book.values().map(|e| e.gain).sum::<f64>() / book.len() as f64;
        println!("average gain {:+.1} points", avg * 100.0);
        if let Some(j) = flag("json") { std::fs::write(j, serde_json::to_string_pretty(&book).unwrap()).unwrap(); }
        return;
    }
    let workers = num("workers").map_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()), |w| (w as usize).max(1));
    let mode = flag("search");
    let mut ctx = search::Ctx::new(&d, o, workers, count, seed, flag("arch").is_some(), num("ban").map_or(0, |b| b as usize));
    let t0 = std::time::Instant::now();
    let mut best = None;
    // --recheck=meta.json: replay a saved meta chain's final round robin with the search AI on both sides
    let recheck: Option<serde_json::Value> = flag("recheck").map(|f| serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(f).unwrap()).unwrap()["chain"].clone());
    let mut rechecked = None;
    if let Some(c) = &recheck {
        let teams = c["teams"].as_array().unwrap();
        let keys: Vec<Vec<String>> = teams.iter().map(|t| serde_json::from_value(t["keys"].clone()).unwrap()).collect();
        let forced: HashMap<String, String> = teams.iter().filter_map(|t| t["arch"].as_str().map(|a| { let mut k: Vec<String> = serde_json::from_value(t["keys"].clone()).unwrap(); k.sort(); (k.join("+"), a.to_string()) })).collect();
        let n = keys.len(); let seed = ctx.seed();
        rechecked = Some(ctx.send(count, Some(batch::Ladder { top: keys, forced: Some(forced), h2h: true, seed, ..Default::default() }), n).h2h);
    } else {
    match mode.as_deref() {
        Some("meta") => search::meta_chain(&mut ctx, count),
        Some("best") => best = Some(search::search_teams(&mut ctx, count, None, None, vec![], None)),
        Some(m) => panic!("--search={m} is only in the JS sim (node sim/cli.mjs)"),
        None => { ctx.send(count, None, 0); }
    }
    }
    let ms = t0.elapsed().as_millis();
    let s = &ctx.stats;
    let name = |k: &str| d.ent_idx.get(k).map_or(k.to_string(), |&e| d.entrants[e].name.clone());
    let names = |ks: &[String]| ks.iter().map(|k| name(k)).collect::<Vec<_>>().join(", ");
    println!("{} battles in {} ms on {} workers ({:.3} ms each), avg {:.1} turns, {} draws", s.battles, ms, workers, ms as f64 / s.battles, s.turns / s.battles, s.draws);
    // a team's win rate over a round robin's head-to-head table (keys 'team|opponent')
    let rr = |h: &dyn Fn(&str) -> Option<(f64, f64)>, keys: Vec<String>, k: &str| { let (mut g, mut w) = (0.0, 0.0); for hk in keys { if hk.split('|').next() == Some(k) { if let Some((gg, ww)) = h(&hk) { g += gg; w += ww; } } } (if g > 0.0 { w / g } else { f64::NAN }, g) };
    if let (Some(c), Some(out)) = (&recheck, &rechecked) {
        println!("team                 fast AI   search AI (games)");
        let old = c["h2h"].as_object().unwrap();
        for t in c["teams"].as_array().unwrap() {
            let mut ks: Vec<String> = serde_json::from_value(t["keys"].clone()).unwrap(); let names_ = names(&ks); ks.sort(); let k = ks.join("+");
            let (f, _) = rr(&|hk| old.get(hk).map(|v| (v["g"].as_f64().unwrap(), v["w"].as_f64().unwrap())), old.keys().cloned().collect(), &k);
            let (sr, g) = rr(&|hk| out.get(hk).map(|v| (v.g, v.w)), out.keys().cloned().collect(), &k);
            println!("{:<20} {:>4.0}%   {:>4.0}% ({})  {}", t["archName"].as_str().unwrap_or("meta"), 100.0 * f, 100.0 * sr, g, names_);
        }
    } else if mode.as_deref() == Some("meta") {
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
        let out = serde_json::json!({ "args": argv, "ms": ms, "stats": s, "chain": (mode.as_deref() == Some("meta")).then_some(&ctx.chain), "best": best.as_ref().map(|b| &b.rows[..32.min(b.rows.len())]), "recheck": rechecked });
        std::fs::write(f, serde_json::to_string(&out).unwrap()).unwrap();
    }
}
fn name_of(d: &data::Data, k: &str) -> String { d.ent_idx.get(k).map_or(k.to_string(), |&e| d.entrants[e].name.clone()) }
