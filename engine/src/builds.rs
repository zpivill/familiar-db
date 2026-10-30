// Movesets, training and held items: ports of makeBuild/rateMove (sim/batch.js), sim/builds.js and
// guessBuilds (sim/draft.js), drawing random numbers in the same order as the JS.

use crate::battle::{Build, Item, Rng, rng, I_WARD, I_EMBLEM};
use crate::data::*;
use crate::jsmath::pow;
use crate::rules::*;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Movesets { Smart, Random }

pub struct BuildOpts<'a> {
    pub level: f64,                 // opts.learnLevel || opts.level || RULES.level
    pub movesets: Movesets,
    pub duos: bool,                 // format duos or comp: partner moves are worth carrying
    pub force_moves: &'a [String],
    pub force_ability: Option<&'a str>,
}

fn avg_hits_plain(fx: &Fx) -> f64 { match fx.hits { None => 1.0, Some(h) => if h[0] == 2 && h[1] == 5 { 3.1 } else { (h[0] + h[1]) as f64 / 2.0 } } }

// How useful a move looks on paper for this character, to pick sensible movesets.
fn rate_move(d: &Data, e: &Entrant, l: &Learn, duos: bool) -> f64 {
    let m = &d.moves[d.mv(&l.id)]; let fx = &m.fx;
    if fx.wide_guard || fx.follow_me || fx.helping_hand { return if duos { 35.0 } else { 0.5 }; }
    if fx.duos_only || fx.nothing { return 0.5; }
    if m.cat == Cat::Status {
        if fx.boosts.as_ref().map_or(false, |bs| bs.iter().any(|b| b.who == "self" && b.stats.iter().any(|&(_, v)| v > 0))) { return 55.0; }
        if fx.heal != 0.0 { return 50.0; }
        if fx.status.is_some() { return 45.0; }
        if fx.protect.is_some() || fx.substitute != 0.0 || fx.hazard.is_some() || fx.screen.is_some() || fx.field.is_some() || fx.tailwind != 0 { return 35.0; }
        return 20.0;
    }
    let st = e.stats.as_ref().unwrap();
    let atk = if m.cat == Cat::Physical { st.pow } else { st.ene };
    let best = st.pow.max(st.ene);
    let power = if fx.fixed.is_some() { 80.0 } else if fx.power.as_deref() == Some("reversal") { 70.0 } else if m.power != 0.0 { m.power } else { 60.0 };
    let mut v = power * avg_hits_plain(fx) * (m.accuracy.unwrap_or(100.0) / 100.0) * (if e.types.contains(&m.ty) { 1.5 } else { 1.0 }) * pow(atk / best, 1.5);
    if fx.recharge != 0 || fx.charge.is_some() { v *= 0.6; }
    if fx.self_dmg != 0.0 { v *= 1.0 - fx.self_dmg; }
    if m.priority > 0.0 { v *= 1.15; }
    v
}

pub fn make_build(d: &Data, ei: usize, r: &mut Rng, o: &BuildOpts) -> Build {
    // a build book (--builds) replaces the random moveset and ability, unless an archetype forces them
    if let Some(bs) = d.book.get(&ei).filter(|_| o.force_moves.is_empty() && o.force_ability.is_none()) {
        return bs[if bs.len() > 1 { r.pick_i(bs.len()) } else { 0 }].clone();
    }
    let e = &d.entrants[ei];
    let sig = e.sig.as_ref().map(|s| s.id.as_str());
    let must = |id: &str| o.force_moves.iter().any(|x| x == id);
    let mut pool: Vec<&Learn> = e.learn.iter().filter(|l| l.lv <= o.level && Some(l.id.as_str()) != sig && !must(&l.id)).collect();
    let mut picks: Vec<&Learn> = e.learn.iter().enumerate()
        .filter(|(i, l)| must(&l.id) && Some(l.id.as_str()) != sig && e.learn.iter().position(|x| x.id == l.id) == Some(*i)).map(|x| x.1).take(4).collect();
    if o.movesets == Movesets::Random {
        while picks.len() < 4 && !pool.is_empty() { let i = (r.next() * pool.len() as f64).floor() as usize; picks.push(pool.remove(i)); }
    } else {
        let mut rated: Vec<(&Learn, f64, &Move)> = pool.iter().map(|l| (*l, rate_move(d, e, l, o.duos), &d.moves[d.mv(&l.id)])).collect();
        let mut types: Vec<Type> = vec![]; let (mut c_atk, mut c_st) = (0, 0);
        for l in &picks { let m = &d.moves[d.mv(&l.id)]; if m.cat == Cat::Status { c_st += 1; } else { c_atk += 1; if !types.contains(&m.ty) { types.push(m.ty); } } }
        while picks.len() < 4 && !rated.is_empty() {
            let w: Vec<f64> = rated.iter().map(|x| {
                let mut v = x.1; let st = x.2.cat == Cat::Status;
                if !st && types.contains(&x.2.ty) { v *= 0.45; }
                if st && c_st >= 2 { v *= 0.2; }
                if !st && c_atk == 0 { v *= 1.5; }
                pow(if 0.1 > v { 0.1 } else { v }, 1.6)
            }).collect();
            let mut t = r.next() * w.iter().fold(0.0, |s, x| s + x);
            let mut k = 0;
            while k < w.len() - 1 && { t -= w[k]; t > 0.0 } { k += 1; }
            let x = rated.remove(k);
            picks.push(x.0);
            if x.2.cat == Cat::Status { c_st += 1; } else { c_atk += 1; if !types.contains(&x.2.ty) { types.push(x.2.ty); } }
        }
    }
    let mut moves: Vec<(usize, Flags)> = picks.iter().map(|l| (d.mv(&l.id), l.flags)).collect();
    if let Some(s) = &e.sig { moves.push((d.mv(&s.id), s.flags)); }
    let abs = &d.ent_abs[ei];
    let pick = |r: &mut Rng| -> usize { if abs.is_empty() { r.next(); usize::MAX } else { abs[(r.next() * abs.len() as f64).floor() as usize] } };
    let ab = match o.force_ability {
        Some(w) => match e.abilities.iter().position(|a| a.name == w) { Some(i) => abs[i], None => pick(r) },
        None => pick(r),
    };
    let (ability, name) = if ab == usize::MAX { (NO_AB, "None".to_string()) } else { (ab, d.abilities[ab].name.clone()) };
    // the entrant's own ability name (data.abilities copies keep the compiled name, which matches)
    let name = if ab != usize::MAX { e.abilities[abs.iter().position(|&x| x == ab).unwrap()].name.clone() } else { name };
    Build { e: ei, moves, ability, ability_name: name, evs: None, ivs: None, nature: None, item: None, preset: None }
}

// ---- builds.js ----
#[derive(Clone, Debug)]
pub struct Kit {
    pub atk: usize, pub other: usize, pub uses_other: bool, pub status: usize, pub attacks: usize, pub setup: bool, pub heal: bool,
    pub protect: bool, pub trick_room: bool, pub tailwind: bool, pub redirect: bool, pub screens: bool, pub field: bool,
    pub contact_phys: bool, pub foul_play: bool, pub stab: Vec<Type>,
}
pub fn kit(d: &Data, b: &Build) -> Kit {
    let ms: Vec<&Move> = b.moves.iter().map(|&(id, _)| &d.moves[id]).collect();
    let st = d.entrants[b.e].stats.as_ref().unwrap();
    let phys: Vec<&&Move> = ms.iter().filter(|m| m.cat == Cat::Physical).collect();
    let ene: Vec<&&Move> = ms.iter().filter(|m| m.cat == Cat::Energy).collect();
    let weight = |l: &[&&Move]| l.iter().fold(0.0, |n, m| n + if m.power != 0.0 { m.power } else { 60.0 });
    let atk = if weight(&phys) * st.pow >= weight(&ene) * st.ene { POW } else { ENE };
    let status = ms.iter().filter(|m| m.cat == Cat::Status).count();
    let ab = &d.abilities[b.ability];
    let any = |f: &dyn Fn(&Fx) -> bool| ms.iter().any(|m| f(&m.fx));
    let mut stab: Vec<Type> = vec![];
    for m in phys.iter().chain(ene.iter()) { if d.entrants[b.e].types.contains(&m.ty) && !stab.contains(&m.ty) { stab.push(m.ty); } }
    Kit {
        atk, other: if atk == POW { ENE } else { POW },
        uses_other: if atk == POW { !ene.is_empty() } else { !phys.is_empty() },
        status, attacks: phys.len() + ene.len(),
        setup: any(&|f| f.boosts.as_ref().map_or(false, |bs| bs.iter().any(|x| x.who == "self" && x.stats.iter().any(|&(_, v)| v > 0)))) && status > 0,
        heal: any(&|f| f.heal != 0.0), protect: any(&|f| f.protect.is_some()), trick_room: any(&|f| f.field.as_ref().map_or(false, |x| x.trick_room)),
        tailwind: any(&|f| f.tailwind != 0), redirect: any(&|f| f.follow_me || f.helping_hand), screens: any(&|f| f.screen.is_some()),
        field: any(&|f| f.field.as_ref().map_or(false, |x| !x.trick_room)) || ab.entry.iter().any(|o| o.op == "field"),
        contact_phys: !phys.is_empty(), foul_play: any(&|f| f.foul_play), stab,
    }
}

const PRESETS: [(&str, &[(&str, f64)]); 6] = [
    ("fast", &[("atk", 32.0), ("spe", 32.0), ("vit", 2.0)]), ("bulky", &[("vit", 32.0), ("atk", 32.0), ("spe", 2.0)]),
    ("trickRoom", &[("vit", 32.0), ("atk", 32.0), ("grd", 1.0), ("wil", 1.0)]), ("wallPhys", &[("vit", 32.0), ("grd", 32.0), ("wil", 2.0)]),
    ("wallEne", &[("vit", 32.0), ("wil", 32.0), ("grd", 2.0)]), ("support", &[("vit", 32.0), ("grd", 17.0), ("wil", 17.0)]),
];
fn bulk(st: &BaseStats) -> f64 { st.vit + st.grd + st.wil }
// stat name -> index in [vit pow grd ene wil spe]
fn six(k: &str) -> usize { match k { "vit" => 0, "pow" => 1, "grd" => 2, "ene" => 3, "wil" => 4, "spe" => 5, _ => panic!("{k}") } }

pub const PRESET_NAMES: [&str; 6] = ["fast", "bulky", "trickRoom", "wallPhys", "wallEne", "support"];
fn auto_training(d: &Data, b: &mut Build, kits: &[Kit], k: &Kit) {
    let st = d.entrants[b.e].stats.as_ref().unwrap();
    let tr_team = kits.iter().any(|x| x.trick_room); let tw_team = kits.iter().any(|x| x.tailwind);
    let best_def = if st.grd >= st.wil { GRD } else { WIL };
    let preset: &'static str = if (k.status >= 2 && (k.redirect || k.tailwind || k.trick_room || k.screens)) || k.attacks <= 1 { "support" }
        else if st.pow.max(st.ene) + 10.0 < st.grd.max(st.wil) && (k.heal || k.protect) && k.attacks <= 2 { if best_def == GRD { "wallPhys" } else { "wallEne" } }
        else if tr_team && st.spe <= 70.0 { "trickRoom" }
        else if tw_team || st.spe < 75.0 { "bulky" }
        else { "fast" };
    train_preset(d, b, kits, k, preset);
}
// EVs, nature and IVs of one preset, as autoTraining gives them
pub fn train_preset(d: &Data, b: &mut Build, kits: &[Kit], k: &Kit, preset: &'static str) {
    let st = d.entrants[b.e].stats.as_ref().unwrap();
    let tr_team = kits.iter().any(|x| x.trick_room);
    let mut evs = [0.0; 6];
    for &(s, v) in PRESETS.iter().find(|p| p.0 == preset).unwrap().1 { let i = if s == "atk" { k.atk + 1 } else { six(s) }; evs[i] += v; }
    let low = if k.uses_other { if st.grd <= st.wil { GRD } else { WIL } } else { k.other };
    let (up, dn) = match preset {
        "fast" => (SPE, low), "bulky" => (k.atk, low), "trickRoom" => (k.atk, SPE), "wallPhys" => (GRD, low), "wallEne" => (WIL, low),
        _ => (if st.grd <= st.wil { GRD } else { WIL }, if k.uses_other || k.attacks == 0 { SPE } else { k.other }),
    };
    let nature = if up == dn { Nature(None) } else { Nature(Some((up, dn))) };
    let mut ivs = [31.0; 6];
    if preset == "trickRoom" || (preset == "support" && tr_team && k.trick_room) { ivs[5] = 0.0; }
    if k.other == POW && !k.uses_other && !kits.iter().any(|x| x.foul_play) { ivs[1] = 0.0; }
    b.preset = Some(preset); b.evs = Some(evs); b.nature = Some(nature); b.ivs = Some(ivs);
}

pub fn item_scores(d: &Data, b: &Build, k: &Kit) -> Vec<(Item, f64)> {
    let st = d.entrants[b.e].stats.as_ref().unwrap();
    let pure = k.status == 0; let fastish = st.spe >= 70.0 && st.spe <= 105.0; let frail = bulk(st) < 190.0;
    let p = b.preset.unwrap_or("");
    let mut out = vec![];
    let mut add = |id: &str, ty: Option<Type>, v: f64| { if v > 0.0 { out.push((Item { id: crate::battle::item_id(id), ty }, v)); } };
    add("iron-gauntlet", None, if pure && k.atk == POW { 30.0 } else { 0.0 });
    add("focus-seal", None, if pure && k.atk == ENE { 30.0 } else { 0.0 });
    add("swift-sandals", None, if pure && fastish && p != "trickRoom" { 27.0 } else { 0.0 });
    add("overdrive-core", None, if k.status <= 1 && k.attacks >= 3 { 24.0 } else { 0.0 });
    add("last-thread", None, if frail { 18.0 + if k.tailwind || k.trick_room { 10.0 } else { 0.0 } } else { 0.0 });
    add("bento-box", None, if p.starts_with("wall") || p == "support" { 22.0 + if k.protect { 4.0 } else { 0.0 } } else { 8.0 });
    add("rice-ball", None, 14.0 + if bulk(st) >= 230.0 { 5.0 } else { 0.0 });
    add("battle-coat", None, if pure && st.wil < 110.0 { 22.0 } else { 0.0 });
    add("hooded-cloak", None, if p == "support" { 14.0 } else { 4.0 });
    add("clear-amulet", None, if k.atk == POW && k.attacks >= 2 { 12.0 } else { 0.0 });
    add("calm-incense", None, if k.redirect || k.tailwind || k.trick_room || k.screens { 18.0 } else { 0.0 });
    add("panacea-leaf", None, if k.setup { 20.0 } else { 9.0 });
    add("counterstrike-policy", None, if bulk(st) >= 220.0 && (k.setup || k.attacks >= 3) { 16.0 } else { 0.0 });
    add("spiked-armor", None, if p == "wallPhys" { 20.0 } else { 3.0 });
    add("escape-scroll", None, if p == "support" { 10.0 } else { 2.0 });
    add("field-anchor", None, if k.field || k.screens { 24.0 } else { 0.0 });
    for &t in &k.stab { add("type-emblem", Some(t), if k.status <= 1 { 18.0 } else { 10.0 }); }
    let (mut worst, mut we) = (None, 1.0);
    let types = &d.entrants[b.e].types;
    for t in 0..15u8 { let e = type_eff(t, types); if e > we { we = e; worst = Some(t); } }
    if let Some(w) = worst { add("ward-charm", Some(w), if we >= 4.0 { 22.0 } else { 13.0 }); }
    let _ = (I_WARD, I_EMBLEM);
    out
}

// Gives every build of one team its training and item (training 'ai' and items 'ai', as in every format that trains).
pub fn train_team(d: &Data, builds: &mut [Build], r: &mut Rng, train: bool, items: bool) {
    if !train && !items { return; }
    let kits: Vec<Kit> = builds.iter().map(|b| kit(d, b)).collect();
    // builds from a build book come trained and with their item; a second copy of an item in one team goes back to the handout
    if train { for (i, b) in builds.iter_mut().enumerate() { if b.evs.is_none() { auto_training(d, b, &kits, &kits[i]); } } }
    if items {
        let mut fixed: Vec<Item> = vec![];
        for b in builds.iter_mut() { if let Some(it) = b.item { if fixed.contains(&it) { b.item = None; } else { fixed.push(it); } } }
        let mut cand: Vec<(usize, Item, f64)> = vec![];
        for (i, b) in builds.iter().enumerate() { if b.item.is_none() { for (id, v) in item_scores(d, b, &kits[i]) { cand.push((i, id, v + r.next() * 4.0)); } } }
        cand.sort_by(|x, y| crate::battle::js_cmp(y.2 - x.2));
        let mut taken: Vec<Item> = fixed;
        for (i, id, _) in cand { if builds[i].item.is_none() && !taken.contains(&id) { builds[i].item = Some(id); taken.push(id); } }
    }
}

fn hash(s: &str) -> u32 { let mut h: u32 = 2166136261; for c in s.encode_utf16() { h = (h ^ c as u32).wrapping_mul(16777619); } h }

// The AI's guess of a bring it can only see the characters of (draft.js guessBuilds).
pub fn guess_builds(d: &Data, ents: &[usize], level: f64, duos: bool) -> Vec<Build> {
    let mut bs: Vec<Build> = ents.iter().map(|&e| make_build(d, e, &mut rng(hash(&d.entrants[e].key) as f64), &BuildOpts { level, movesets: Movesets::Smart, duos, force_moves: &[], force_ability: None })).collect();
    let keys: Vec<&str> = ents.iter().map(|&e| d.entrants[e].key.as_str()).collect();
    train_team(d, &mut bs, &mut rng(hash(&keys.join("+")) as f64), true, true);
    bs
}
