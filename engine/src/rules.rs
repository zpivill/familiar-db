// The numbers from sim/rules.js. Keep them in step with that file: the JS page and this engine must agree.

use crate::data::{Type, TYPES};
use std::sync::atomic::{AtomicU64, Ordering};

// RULES.hpScale is the one rule the CLI changes (--hp); the rest are fixed.
static HP_SCALE: AtomicU64 = AtomicU64::new(0x3FF0000000000000); // 1.0
pub fn hp_scale() -> f64 { f64::from_bits(HP_SCALE.load(Ordering::Relaxed)) }
pub fn set_hp_scale(x: f64) { HP_SCALE.store(x.to_bits(), Ordering::Relaxed) }

pub const LEVEL: f64 = 100.0;
pub const IV: f64 = 31.0;
pub const STAB: f64 = 1.5;
pub const CRIT_MULT: f64 = 1.5;
pub const CRIT_CHANCE: [f64; 4] = [1.0 / 24.0, 1.0 / 8.0, 1.0 / 2.0, 1.0];
pub const RANDOM: [f64; 2] = [0.85, 1.0];
pub const SPREAD: f64 = 0.75;
pub const SCREEN_SINGLES: f64 = 0.5;
pub const SCREEN_DUOS: f64 = 2.0 / 3.0;
pub const FIELD_BOOST: f64 = 1.3;
pub const TURN_CAP: i32 = 100;
pub const BURN_PHYSICAL: f64 = 0.5; pub const BURN_CHIP: f64 = 1.0 / 16.0;
pub const FREEZE_THAW: f64 = 0.25; pub const FREEZE_MAX: i32 = 3;
pub const STUN_SKIP: f64 = 0.25; pub const STUN_SPEED: f64 = 0.5;
pub const BLEED_STEP: f64 = 1.0 / 16.0;
pub const CURSE_ENERGY: f64 = 0.5; pub const CURSE_WILL: f64 = 0.75;
pub const SLEEP_TURNS: [i32; 2] = [1, 3];
pub const CONFUSE_TURNS: [i32; 2] = [2, 5]; pub const CONFUSE_SELF: f64 = 1.0 / 3.0; pub const CONFUSE_POWER: f64 = 40.0;
pub const OWN_TYPE_STATUS_IMMUNE: bool = true;

pub const COMP_TEAM: usize = 6; pub const COMP_LEVEL: f64 = 50.0; pub const COMP_TURN_CAP: i32 = 50; pub const COMP_DRAW: f64 = 0.0;
pub const COMP_LEGEND_CAP: usize = 1; pub const COMP_BRING: usize = 8; pub const COMP_BRING_LEGEND_CAP: usize = 5;
pub fn bring_legend_cap(bring: usize) -> usize { COMP_BRING_LEGEND_CAP.min(bring - (COMP_TEAM - COMP_LEGEND_CAP)) }

pub const EV_TOTAL: i32 = 66; pub const EV_MAX: i32 = 32; pub const NATURE: f64 = 0.1; pub const IV_MAX: i32 = 31;

// items: ids as in rules.js ITEMS
pub const ITEM_IDS: [&str; 18] = ["last-thread", "iron-gauntlet", "focus-seal", "swift-sandals", "overdrive-core", "bento-box", "rice-ball", "battle-coat",
    "ward-charm", "type-emblem", "hooded-cloak", "clear-amulet", "calm-incense", "panacea-leaf", "counterstrike-policy", "spiked-armor", "escape-scroll", "field-anchor"];
pub const CHOICE: f64 = 1.5; pub const LIFE_ORB: f64 = 1.3; pub const LIFE_ORB_COST: f64 = 1.0 / 10.0; pub const LEFTOVERS: f64 = 1.0 / 16.0;
pub const SITRUS: f64 = 1.0 / 4.0; pub const SITRUS_BELOW: f64 = 0.5; pub const VEST: f64 = 1.5; pub const WARD: f64 = 0.5; pub const EMBLEM: f64 = 1.2;
pub const POLICY: i32 = 2; pub const HELMET: f64 = 1.0 / 6.0; pub const ANCHOR_TURNS: i32 = 8;

// The type chart: CHART[attack][defend].
fn names(xs: &[&str]) -> Vec<usize> { xs.iter().map(|s| TYPES.iter().position(|t| t == s).unwrap()).collect() }
pub struct Chart(pub [[f64; 15]; 15]);
pub fn chart() -> Chart {
    let sup: [&[&str]; 15] = [&["Ice", "Beast", "Tech"], &["Fire", "Earth", "Tech"], &["Wind", "Earth", "Beast"], &["Dark", "Earth"], &["Fire", "Lightning"],
        &["Water", "Wind", "Tech"], &["Dark", "Spirit", "Blood"], &["Light", "Time", "Spirit"], &["Neutral", "Dark", "Blood"], &["Light", "Spirit"],
        &["Cosmic", "Lightning"], &["Ice", "Beast"], &["Wind", "Blood"], &["Water", "Time"], &[]];
    let res: [&[&str]; 15] = [&["Ice", "Tech"], &["Fire", "Ice"], &["Water", "Wind"], &["Earth", "Dark"], &["Fire", "Beast"], &["Wind", "Light"],
        &["Fire", "Spirit"], &["Cosmic", "Blood"], &["Blood", "Beast"], &["Light", "Fire", "Ice"], &["Neutral", "Tech"], &["Ice", "Wind", "Neutral"],
        &["Earth", "Water", "Dark"], &["Fire", "Dark"], &[]];
    let mut imm: [Vec<usize>; 15] = Default::default();
    imm[4] = names(&["Lightning"]); imm[8] = names(&["Neutral"]); imm[9] = names(&["Earth"]); imm[11] = names(&["Blood"]);
    let mut c = [[1.0; 15]; 15];
    for a in 0..15 { for d in 0..15 {
        c[a][d] = if imm[d].contains(&a) { 0.0 } else if names(sup[a]).contains(&d) { 2.0 } else if names(res[d]).contains(&a) { 0.5 } else { 1.0 };
    } }
    Chart(c)
}
thread_local! { static CH: Chart = chart(); }
pub fn eff1(a: Type, d: Type) -> f64 { CH.with(|c| c.0[a as usize][d as usize]) }
pub fn type_eff(a: Type, defs: &[Type]) -> f64 { defs.iter().fold(1.0, |m, &d| m * eff1(a, d)) }

pub fn battle_stat(base: f64, level: f64, hp: bool, ev: f64, iv: f64, nat: f64) -> f64 {
    let bonus = (ev * level / 50.0).floor();
    if hp { ((((2.0 * base + iv) * level / 100.0).floor()) * hp_scale()).floor() + level + 10.0 + bonus }
    else { (((((2.0 * base + iv) * level / 100.0).floor()) + 5.0 + bonus) * nat).floor() }
}
pub fn stage_mult(n: i32) -> f64 { if n >= 0 { (2 + n) as f64 / 2.0 } else { 2.0 / (2 - n) as f64 } }

// natures: 0 = neutral, else (raised, lowered) stat indices 0..4 (pow grd ene wil spe)
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Nature(pub Option<(usize, usize)>);
impl Nature {
    pub fn mult(&self, k: usize) -> f64 { match self.0 { None => 1.0, Some((u, d)) => if k == u { 1.0 + NATURE } else if k == d { 1.0 - NATURE } else { 1.0 } } }
    pub fn name(&self) -> String { match self.0 { None => "neutral".into(), Some((u, d)) => format!("{}-{}", crate::data::STATS[u], crate::data::STATS[d]) } }
}
