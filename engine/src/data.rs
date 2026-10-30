// The game data as the engine reads it: engine/data.json, written by sim/export.mjs from data/ (move
// effects and abilities already turned into rules by sim/compile.js). Every field compile.js can write is
// listed here, and an unknown one stops the load, so a new rule in compile.js can't be silently skipped.

use serde::{Deserialize, Deserializer};
use std::collections::HashMap;

pub const TYPES: [&str; 15] = ["Fire", "Water", "Ice", "Wind", "Earth", "Lightning", "Light", "Dark", "Spirit", "Cosmic", "Time", "Tech", "Beast", "Blood", "Neutral"];
pub type Type = u8;
pub fn type_id(s: &str) -> Type { TYPES.iter().position(|t| *t == s).unwrap_or_else(|| panic!("unknown type {s}")) as Type }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Cat { Physical, Energy, Status }
pub fn cat_of(s: &str) -> Cat { match s { "Physical" => Cat::Physical, "Energy" => Cat::Energy, "Status" => Cat::Status, _ => panic!("unknown category {s}") } }

// stat indices: pow grd ene wil spe, and 5 = "highest" (the user's highest stat)
pub const STATS: [&str; 5] = ["pow", "grd", "ene", "wil", "spe"];
pub const POW: usize = 0; pub const GRD: usize = 1; pub const ENE: usize = 2; pub const WIL: usize = 3; pub const SPE: usize = 4; pub const HIGHEST: usize = 5;
pub type Boosts = Vec<(usize, i32)>;

fn stat_idx(k: &str) -> usize { match k { "pow" => 0, "grd" => 1, "ene" => 2, "wil" => 3, "spe" => 4, "highest" => 5, _ => panic!("unknown stat {k}") } }
fn de_boosts<'de, D: Deserializer<'de>>(d: D) -> Result<Boosts, D::Error> {
    let m: serde_json::Map<String, serde_json::Value> = Deserialize::deserialize(d)?;
    Ok(m.iter().map(|(k, v)| (stat_idx(k), v.as_f64().unwrap() as i32)).collect())
}
fn de_boosts_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Boosts>, D::Error> {
    let v: Option<serde_json::Map<String, serde_json::Value>> = Deserialize::deserialize(d)?;
    Ok(v.map(|m| m.iter().map(|(k, v)| (stat_idx(k), v.as_f64().unwrap() as i32)).collect()))
}
fn de_type<'de, D: Deserializer<'de>>(d: D) -> Result<Type, D::Error> { let s: String = Deserialize::deserialize(d)?; Ok(type_id(&s)) }
fn de_type_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Type>, D::Error> { let s: Option<String> = Deserialize::deserialize(d)?; Ok(s.map(|s| type_id(&s))) }
fn de_types<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Type>, D::Error> { let s: Vec<String> = Deserialize::deserialize(d)?; Ok(s.iter().map(|s| type_id(s)).collect()) }
fn de_types_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<Type>>, D::Error> { let s: Option<Vec<String>> = Deserialize::deserialize(d)?; Ok(s.map(|v| v.iter().map(|s| type_id(s)).collect())) }
fn de_cat<'de, D: Deserializer<'de>>(d: D) -> Result<Cat, D::Error> { let s: String = Deserialize::deserialize(d)?; Ok(cat_of(&s)) }
fn de_cat_opt<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Cat>, D::Error> { let s: Option<String> = Deserialize::deserialize(d)?; Ok(s.map(|s| cat_of(&s))) }

// A field that is either true or a name (compile.js writes `true` or e.g. 'Energy').
#[derive(Clone, Debug, PartialEq, Default)]
pub enum Tag { #[default] Off, On, Name(String) }
impl<'de> Deserialize<'de> for Tag {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Tag, D::Error> {
        let v: serde_json::Value = Deserialize::deserialize(d)?;
        Ok(match v { serde_json::Value::Bool(true) => Tag::On, serde_json::Value::Bool(false) | serde_json::Value::Null => Tag::Off, serde_json::Value::String(s) => Tag::Name(s), x => panic!("bad tag {x}") })
    }
}
impl Tag {
    pub fn on(&self) -> bool { !matches!(self, Tag::Off) }
    pub fn is(&self, s: &str) -> bool { matches!(self, Tag::Name(n) if n == s) }
}

#[derive(Deserialize, Clone, Copy, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Flags {
    #[serde(default)] pub contact: bool, #[serde(default)] pub punch: bool, #[serde(default)] pub kick: bool,
    #[serde(default)] pub slice: bool, #[serde(default)] pub sound: bool, #[serde(default)] pub shot: bool,
    #[serde(default)] pub dance: bool, #[serde(default)] pub head: bool, #[serde(default)] pub heal: bool,
}
impl Flags {
    pub fn get(&self, k: &str) -> bool {
        match k { "contact" => self.contact, "punch" => self.punch, "kick" => self.kick, "slice" => self.slice, "sound" => self.sound,
            "shot" => self.shot, "dance" => self.dance, "head" => self.head, "heal" => self.heal, _ => false }
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Counter { pub mult: f64, #[serde(default, deserialize_with = "de_cat_opt")] pub cat: Option<Cat> }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct BoostFx { pub who: String, #[serde(deserialize_with = "de_boosts")] pub stats: Boosts, pub p: f64 }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Protect { #[serde(default)] pub contact_chip: f64, #[serde(default)] pub contact_pow: i32, #[serde(default)] pub repeat: bool }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Bind { pub frac: f64, pub turns: [i32; 2] }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct StatusFx { pub kind: String, pub p: f64, #[serde(default)] pub each: bool, #[serde(default)] pub who: Option<String>, #[serde(default)] pub turns: Option<i32> }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Charge { #[serde(default)] pub invuln: bool, #[serde(default, deserialize_with = "de_boosts_opt")] pub boost: Option<Boosts> }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FieldFx {
    pub turns: i32,
    #[serde(default, deserialize_with = "de_type_opt")] pub boost_type: Option<Type>,
    #[serde(default)] pub no_priority: bool, #[serde(default)] pub no_sleep: bool, #[serde(default)] pub trick_room: bool,
    #[serde(default)] pub foe_slow: bool, #[serde(default)] pub side_heal: f64, #[serde(default)] pub entry_chip: f64,
    #[serde(default)] pub gravity: bool, #[serde(default)] pub snow: bool,
}
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Delayed { pub turns: i32, pub mult: f64 }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Countdown { pub turns: i32, pub who: String }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct SideChip { pub frac: f64, pub turns: i32 }

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Fx {
    #[serde(default)] pub hits: Option<[i32; 2]>,
    #[serde(default)] pub flinch: f64,
    #[serde(default)] pub fixed: Option<String>,
    #[serde(default)] pub counter: Option<Counter>,
    #[serde(default)] pub recoil: f64,
    #[serde(default)] pub boosts: Option<Vec<BoostFx>>,
    #[serde(default)] pub protect: Option<Protect>,
    #[serde(default)] pub endure: bool,
    #[serde(default)] pub substitute: f64,
    #[serde(default)] pub heal: f64,
    #[serde(default)] pub heal_who: Option<String>,
    #[serde(default)] pub helping_hand: bool,
    #[serde(default)] pub follow_me: bool,
    #[serde(default)] pub encore: i32,
    #[serde(default)] pub force_switch: bool,
    #[serde(default)] pub bind: Option<Bind>,
    #[serde(default)] pub crit: i32,
    #[serde(default)] pub status: Option<StatusFx>,
    #[serde(default)] pub never_miss: bool,
    #[serde(default)] pub switch_out: bool,
    #[serde(default)] pub charge: Option<Charge>,
    #[serde(default)] pub power: Option<String>,
    #[serde(default)] pub sucker: bool,
    #[serde(default)] pub foul_play: bool,
    #[serde(default)] pub wish: f64,
    #[serde(default)] pub screen: Option<String>,
    #[serde(default)] pub cure: Tag,
    #[serde(default)] pub spread: Option<String>,
    #[serde(default)] pub hazard: Option<String>,
    #[serde(default)] pub field: Option<FieldFx>,
    #[serde(default)] pub psyshock: bool,
    #[serde(default, deserialize_with = "de_types_opt")] pub dual_type: Option<Vec<Type>>,
    #[serde(default)] pub self_dmg: f64,
    #[serde(default)] pub rampage: Option<[i32; 2]>,
    #[serde(default)] pub self_confuse: bool,
    #[serde(default)] pub no_recoil: bool,
    #[serde(default)] pub clear_foe_boosts: Option<String>,
    #[serde(default)] pub ignore_ability: bool,
    #[serde(default)] pub ignore_boosts: Option<String>,
    #[serde(default)] pub recharge: i32,
    #[serde(default)] pub nothing: bool,
    #[serde(default)] pub first_turn: bool,
    #[serde(default)] pub clear_hazards: Option<String>,
    #[serde(default)] pub yawn: bool,
    #[serde(default)] pub baton_pass: bool,
    #[serde(default)] pub metronome: bool,
    #[serde(default)] pub rest_sleep: bool,
    #[serde(default)] pub aqua_ring: bool,
    #[serde(default, deserialize_with = "de_type_opt")] pub soak: Option<Type>,
    #[serde(default, deserialize_with = "de_types_opt")] pub super_vs: Option<Vec<Type>>,
    #[serde(default)] pub haze: bool,
    #[serde(default)] pub tailwind: i32,
    #[serde(default)] pub charged: bool,
    #[serde(default)] pub drain: f64,
    #[serde(default)] pub taunt: i32,
    #[serde(default)] pub breaks_protect: bool,
    #[serde(default)] pub destiny_bond: bool,
    #[serde(default)] pub pain_split: bool,
    #[serde(default)] pub delayed: Option<Delayed>,
    #[serde(default)] pub quick_guard: bool,
    #[serde(default)] pub wide_guard: bool,
    #[serde(default)] pub duos_only: bool,
    #[serde(default)] pub lock_on: Tag,
    #[serde(default)] pub breaks_screens: bool,
    #[serde(default)] pub miss_dmg: f64,
    #[serde(default)] pub flinch_last: bool,
    #[serde(default)] pub revive: f64,
    #[serde(default)] pub trap: i32,
    #[serde(default)] pub no_repeat: bool,
    #[serde(default)] pub always_crit: bool,
    #[serde(default)] pub crit_below_half: bool,
    #[serde(default)] pub steal: bool,
    #[serde(default)] pub extra_turn: bool,
    #[serde(default)] pub flinch_if_first: bool,
    #[serde(default)] pub self_chip: f64,
    #[serde(default)] pub wake_confuse: bool,
    #[serde(default)] pub clear_field: bool,
    #[serde(default)] pub ko_heal: f64,
    #[serde(default)] pub countdown: Option<Countdown>,
    #[serde(default)] pub best_type: bool,
    #[serde(default)] pub time_stop: f64,
    #[serde(default)] pub confuse_foes: bool,
    #[serde(default)] pub breaks_sub: bool,
    #[serde(default)] pub slow_next: bool,
    #[serde(default)] pub suppress: i32,
    #[serde(default)] pub echo: f64,
    #[serde(default)] pub seed: f64,
    #[serde(default)] pub side_chip: Option<SideChip>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Move {
    pub id: String, pub name: String,
    #[serde(rename = "type", deserialize_with = "de_type")] pub ty: Type,
    #[serde(deserialize_with = "de_cat")] pub cat: Cat,
    pub size: Option<String>, pub power: f64, pub accuracy: Option<f64>, pub pp: i32, pub priority: f64,
    pub signature: bool,   // m.signature === true, as battle.js reads it (the data holds the string 'true', so this is false)
    #[serde(rename = "isSig")] pub is_sig: bool,   // !!m.signature, as the Metronome pool reads it
    pub flags: Flags,   // moveFlags(move, []), for a Metronome pick
    pub fx: Fx,
}

// ---- abilities ----
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AtkW {
    pub mult: f64,
    #[serde(default)] pub r#type: Option<String>,   // a type name or 'own'
    #[serde(default)] pub low_hp: Option<f64>,
    #[serde(default, deserialize_with = "de_cat_opt")] pub cat: Option<Cat>,
    #[serde(default)] pub flag: Option<String>,
    #[serde(default)] pub contact: bool,
    #[serde(default)] pub max_power: f64,
    #[serde(default)] pub recoil: bool,
    #[serde(default)] pub priority: bool,
    #[serde(default)] pub size: Option<String>,
    #[serde(default)] pub not_sig: bool,
    #[serde(default, deserialize_with = "de_types_opt")] pub vs_types: Option<Vec<Type>>,
    #[serde(default)] pub vs_villain: bool,
    #[serde(default)] pub vs_low_hp: f64,
    #[serde(default)] pub vs_boosted: bool,
    #[serde(default)] pub vs_hit_before: bool,
    #[serde(default)] pub vs_caster: bool,
    #[serde(default)] pub target_not_moved: bool,
    #[serde(default)] pub moved_after: bool,
    #[serde(default)] pub first_once: Option<String>,
    #[serde(default)] pub gravity: bool,
    #[serde(default)] pub tailwind: bool,
    #[serde(default)] pub duos: bool,
}
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DefW {
    pub mult: f64,
    #[serde(default, deserialize_with = "de_type_opt")] pub r#type: Option<Type>,
    #[serde(default, deserialize_with = "de_type_opt")] pub not_type: Option<Type>,
    #[serde(default, deserialize_with = "de_cat_opt")] pub cat: Option<Cat>,
    #[serde(default)] pub contact: bool,
    #[serde(default)] pub super_eff: bool,
    #[serde(default)] pub low_hp: f64,
    #[serde(default)] pub full_hp: bool,
}
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Immune {
    #[serde(default, deserialize_with = "de_type_opt")] pub r#type: Option<Type>,
    #[serde(default, deserialize_with = "de_cat_opt")] pub cat: Option<Cat>,
    #[serde(default)] pub flag: Option<String>,
    #[serde(default)] pub heal: f64,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub boost: Option<Boosts>,
    #[serde(default)] pub flash_fire: bool,
}
// One op of an ability's entry / threshold / ko / faint / allyFaint / endTurn list.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Op {
    pub op: String,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub stats: Option<Boosts>,
    #[serde(default)] pub frac: f64,
    #[serde(default)] pub field: Option<FieldFx>,
    #[serde(default)] pub turns: i32,
    #[serde(default)] pub intimidate: bool,
    #[serde(default)] pub once: bool,
    #[serde(default, deserialize_with = "de_type_opt")] pub if_foe_type: Option<Type>,
    #[serde(default, deserialize_with = "de_type_opt")] pub only_type: Option<Type>,
    #[serde(default)] pub p: f64,
    #[serde(default)] pub one_hit: bool,
    #[serde(default)] pub if_no_attack: bool,
    #[serde(default)] pub low_hp: Option<f64>,
    #[serde(default)] pub asleep: bool,
}
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HitBy {
    #[serde(default)] pub contact: bool,
    #[serde(default, deserialize_with = "de_cat_opt")] pub cat: Option<Cat>,
    #[serde(default, deserialize_with = "de_types_opt")] pub types: Option<Vec<Type>>,
    #[serde(default)] pub super_eff: bool,
    #[serde(default, deserialize_with = "de_type_opt")] pub attacker_type: Option<Type>,
    #[serde(default)] pub p: Option<f64>,
    #[serde(rename = "self", default)] pub self_: bool,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub stats: Option<Boosts>,
    #[serde(default)] pub status: Option<String>,
    #[serde(default)] pub chip: f64,
}
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DealHit {
    #[serde(default)] pub contact: bool,
    #[serde(default, deserialize_with = "de_cat_opt")] pub cat: Option<Cat>,
    #[serde(default)] pub p: f64,
    #[serde(default)] pub status: Option<String>,
    #[serde(default)] pub suppress: i32,
    #[serde(default)] pub decay: f64,
    #[serde(default)] pub trap: i32,
}
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Threshold { pub below: f64, pub ops: Vec<Op>, #[serde(default)] pub always: bool }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Pair { pub name: String, #[serde(default)] pub mult: f64, #[serde(default)] pub speed: i32, #[serde(default)] pub pow: i32 }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CritAb { pub stage: i32, #[serde(default, deserialize_with = "de_type_opt")] pub r#type: Option<Type>, #[serde(default)] pub low_hp: f64, #[serde(default)] pub flag: Option<String> }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct DodgeAb { pub contact: bool, pub reset: bool }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct DrainAb { pub frac: f64, #[serde(default, deserialize_with = "de_type_opt")] pub r#type: Option<Type>, #[serde(default)] pub contact: bool }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Gift { #[serde(default)] pub heal: f64, #[serde(default, deserialize_with = "de_boosts_opt")] pub stats: Option<Boosts> }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct StatMult { #[serde(default)] pub pow: Option<f64>, #[serde(default)] pub grd: Option<f64>, #[serde(default)] pub ene: Option<f64>, #[serde(default)] pub wil: Option<f64>, #[serde(default)] pub spe: Option<f64> }
impl StatMult { pub fn get(&self, k: usize) -> Option<f64> { [self.pow, self.grd, self.ene, self.wil, self.spe][k] } }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Bounce { #[serde(deserialize_with = "de_cat")] pub cat: Cat, pub p: f64, pub frac: f64 }
impl Default for Cat { fn default() -> Cat { Cat::Status } }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Parental { pub flag: String, pub mult: f64 }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Timed { pub turn: i32, #[serde(deserialize_with = "de_boosts")] pub stats: Boosts }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Ramp { #[serde(deserialize_with = "de_type")] pub r#type: Type, pub step: f64, pub max: f64 }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct AfterMove { #[serde(deserialize_with = "de_type")] pub r#type: Type, #[serde(deserialize_with = "de_boosts")] pub stats: Boosts }

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Ability {
    #[serde(default)] pub name: String,
    #[serde(default)] pub atk: Vec<AtkW>, #[serde(default)] pub def: Vec<DefW>, #[serde(default)] pub immune: Vec<Immune>,
    #[serde(default)] pub entry: Vec<Op>, #[serde(default)] pub hit_by: Vec<HitBy>, #[serde(default)] pub deal_hit: Vec<DealHit>,
    #[serde(default)] pub end_turn: Vec<Op>, #[serde(default)] pub threshold: Vec<Threshold>, #[serde(default)] pub ko: Vec<Op>,
    #[serde(default)] pub ally_faint: Vec<Op>, #[serde(default)] pub faint: Vec<Op>, #[serde(default)] pub block: Vec<String>,
    #[serde(default)] pub never_miss: Tag,
    #[serde(default)] pub alternate: Option<(String, String, f64)>,
    #[serde(default)] pub motion_sickness: bool,
    #[serde(default)] pub crit_mult: f64,
    #[serde(default)] pub pair: Option<Pair>,
    #[serde(default)] pub explode_out: bool,
    #[serde(default)] pub narcolepsy: f64,
    #[serde(default)] pub crit: Option<CritAb>,
    #[serde(default)] pub survive_once: bool,
    #[serde(default)] pub unaware: bool,
    #[serde(default, deserialize_with = "de_types_opt")] pub pierce: Option<Vec<Type>>,
    #[serde(default)] pub bad_luck: bool,
    #[serde(default)] pub prankster: bool,
    #[serde(default)] pub loner: bool,
    #[serde(default)] pub dodge: Option<DodgeAb>,
    #[serde(default)] pub rain_speed: bool,
    #[serde(default)] pub cryptid: bool,
    #[serde(default)] pub ally_guard: f64,
    #[serde(default)] pub comatose: bool,
    #[serde(default)] pub mold_breaker: bool,
    #[serde(default)] pub defiant: Option<String>,
    #[serde(default)] pub serene_grace: Tag,
    #[serde(default)] pub healer: f64,
    #[serde(default)] pub cat_burglar: bool,
    #[serde(default)] pub long_tailwind: i32,
    #[serde(default)] pub sleep_heal: f64,
    #[serde(default)] pub quick_draw: Tag,
    #[serde(default)] pub heavy_chip: f64,
    #[serde(default)] pub gloom: bool,
    #[serde(default)] pub battery: f64,
    #[serde(default)] pub drain: Option<DrainAb>,
    #[serde(default)] pub sleep_fighter: bool,
    #[serde(default, deserialize_with = "de_type_opt")] pub magnet_pull: Option<Type>,
    #[serde(default)] pub eject_super: bool,
    #[serde(default)] pub wimp_out: f64,
    #[serde(default)] pub sturdy: bool,
    #[serde(default)] pub illusion: bool,
    #[serde(default)] pub pivot_priority: bool,
    #[serde(default)] pub mimic_chest: f64,
    #[serde(default)] pub best_type_sig: bool,
    #[serde(default)] pub one_punch: bool,
    #[serde(default)] pub acc_mult: f64,
    #[serde(default, deserialize_with = "de_type_opt")] pub spread_type: Option<Type>,
    #[serde(default)] pub priority_dodge_once: bool,
    #[serde(default)] pub regenerator: f64,
    #[serde(default)] pub mimic: bool,
    #[serde(default)] pub sandevistan: i32,
    #[serde(default)] pub disguise: Option<String>,
    #[serde(default)] pub survive_switch: bool,
    #[serde(default)] pub skill_link: bool,
    #[serde(default)] pub target_lock: bool,
    #[serde(default)] pub deal_recoil: f64,
    #[serde(default)] pub guts: bool,
    #[serde(default)] pub low_battery: bool,
    #[serde(default)] pub contrary: bool,
    #[serde(default)] pub dancer: bool,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub heal_boost: Option<Boosts>,
    #[serde(default)] pub protean: bool,
    #[serde(default)] pub heal_mult: f64,
    #[serde(default)] pub speed_as_power: bool,
    #[serde(default)] pub entry_follow_me: bool,
    #[serde(default)] pub transform_on_hit: bool,
    #[serde(default)] pub transform_ability: bool,
    #[serde(default)] pub stylish: bool,
    #[serde(default)] pub royal_guard: f64,
    #[serde(default)] pub switch_gift: Option<Gift>,
    #[serde(default)] pub stat_mult: Option<StatMult>,
    #[serde(default)] pub spiky_shield: f64,
    #[serde(default)] pub anger_point: bool,
    #[serde(default)] pub natural_reset: bool,
    #[serde(default)] pub off_stab: f64,
    #[serde(default)] pub slow_start: bool,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub slow_start_boost: Option<Boosts>,
    #[serde(default)] pub bounce: Option<Bounce>,
    #[serde(default)] pub poison_heal: f64,
    #[serde(default)] pub multiscale: Tag,
    #[serde(default)] pub scrappy: bool,
    #[serde(default)] pub ignore_def_boosts: bool,
    #[serde(default)] pub parental: Option<Parental>,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub crit_boost: Option<Boosts>,
    #[serde(default)] pub infiltrator: bool,
    #[serde(default, deserialize_with = "de_boosts_opt")] pub sturdy_boost: Option<Boosts>,
    #[serde(default)] pub status_dodge: f64,
    #[serde(default)] pub lost: f64,
    #[serde(default)] pub early_bird: bool,
    #[serde(default)] pub truant_first: bool,
    #[serde(default)] pub timed: Option<Timed>,
    #[serde(default)] pub eyepatch: bool,
    #[serde(default)] pub heavy_bypass: bool,
    #[serde(default)] pub ramp: Option<Ramp>,
    #[serde(default)] pub after_move: Option<AfterMove>,
    #[serde(default, deserialize_with = "de_type_opt")] pub unweak: Option<Type>,
    #[serde(default)] pub hits_invuln: bool,
    #[serde(default)] pub crit_splash: f64,
    #[serde(default)] pub protect_always: bool,
    #[serde(default)] pub deadly_cooking: bool,
    #[serde(default)] pub adaptive: bool,
    #[serde(default)] pub go_last: bool,
    #[serde(default)] pub revive_once: f64,
    #[serde(default)] pub low_trap: f64,
    #[serde(default)] pub sig_bypass: bool,
    #[serde(default)] pub instant_domain: bool,
    #[serde(default, rename = "allyKO", deserialize_with = "de_boosts_opt")] pub ally_ko: Option<Boosts>,
    #[serde(default)] pub senkaimaru: bool,
    // filled in after loading
    #[serde(skip)] pub block_set: u32,
    #[serde(skip)] pub alt: Option<(Type, Type, f64)>,
}
// ability.block as bits, for a quick blocks() check
pub const BLOCKS: [&str; 27] = ["flinch", "trap", "bleed", "status", "crit", "priority", "delayed", "burn", "freeze", "curse", "confuse", "sleep",
    "taunt", "encore", "charm", "forceOut", "drop:spe", "intimidate", "drops", "drop:grd", "drop:wil", "drop:pow", "soundSleep", "hazards", "countdown", "fakeout", "stun"];
pub fn block_bit(k: &str) -> u32 { match BLOCKS.iter().position(|b| *b == k) { Some(i) => 1 << i, None => 1 << 30 } }
impl Ability {
    pub fn blocks(&self, k: &str) -> bool { self.block_set & block_bit(k) != 0 }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct EntAbility { pub name: String, pub ab: Ability }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct Learn { pub id: String, #[serde(default)] pub lv: f64, #[serde(rename = "as")] pub as_: String, pub flags: Flags }
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct BaseStats { pub vit: f64, pub pow: f64, pub grd: f64, pub ene: f64, pub wil: f64, pub spe: f64 }
impl BaseStats { pub fn get(&self, k: usize) -> f64 { [self.pow, self.grd, self.ene, self.wil, self.spe][k] } }

#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Entrant {
    pub key: String, pub cid: String, pub ci: usize, pub j: usize, pub r#final: bool, pub name: String, pub char_name: String,
    pub rarity: String, pub villain: bool, pub gag: bool,
    #[serde(deserialize_with = "de_types")] pub types: Vec<Type>,
    pub stats: Option<BaseStats>, pub total: f64,
    pub sig: Option<Learn>,
    pub learn: Vec<Learn>, pub abilities: Vec<EntAbility>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(deny_unknown_fields)]
pub struct Carry { #[serde(default)] pub r#move: Option<String>, #[serde(default)] pub ability: Option<String> }
#[derive(Deserialize, Clone, Debug)]
#[serde(deny_unknown_fields)]
pub struct ArchRoster { pub id: String, pub name: String, pub setters: HashMap<String, Carry>, pub abusers: HashMap<String, Carry> }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Data {
    pub source: String,
    pub moves: Vec<Move>,
    pub entrants: Vec<Entrant>,
    pub archetypes: Vec<ArchRoster>,
    #[serde(skip)] pub move_idx: HashMap<String, usize>,
    #[serde(skip)] pub ent_idx: HashMap<String, usize>,
    #[serde(skip)] pub abilities: Vec<Ability>,           // every ability, NO_AB first
    #[serde(skip)] pub ent_abs: Vec<Vec<usize>>,         // entrant -> its abilities' ids in `abilities`
}
pub const NO_AB: usize = 0;

impl Data {
    pub fn load(path: &str) -> Data {
        let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("can't read {path}: {e}. Run  node sim/export.mjs  first."));
        let mut d: Data = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
        d.move_idx = d.moves.iter().enumerate().map(|(i, m)| (m.id.clone(), i)).collect();
        d.ent_idx = d.entrants.iter().enumerate().map(|(i, e)| (e.key.clone(), i)).collect();
        let fix = |a: &mut Ability| {
            a.block_set = a.block.iter().fold(0, |n, k| n | block_bit(k));
            a.alt = a.alternate.as_ref().map(|(x, y, m)| (type_id(x), type_id(y), *m));
        };
        let mut none = Ability { name: "None".into(), ..Default::default() };
        fix(&mut none);
        d.abilities.push(none);
        for e in &mut d.entrants {
            let mut ids = vec![];
            for a in &mut e.abilities { fix(&mut a.ab); ids.push(d.abilities.len()); d.abilities.push(a.ab.clone()); }
            d.ent_abs.push(ids);
        }
        d
    }
    pub fn mv(&self, id: &str) -> usize { self.move_idx[id] }
}
