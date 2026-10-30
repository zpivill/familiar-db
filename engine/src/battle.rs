// The battle engine, a line-by-line port of sim/battle.js. Same rules, same order of random draws, so the
// same seed and teams give the same battle as the JS engine. When battle.js changes, change this to match
// (tests/compare.mjs plays both and checks).

use crate::data::*;
use crate::rules::*;
use crate::ai;

pub type MonId = usize;
pub const NONE: i32 = i32::MIN / 4; // "undefined" for turn numbers, which JS compares with ===

// ---- random numbers: mulberry32, as rng() in battle.js ----
#[derive(Clone)]
pub struct Rng { a: u32 }
impl Rng {
    pub fn new(seed: f64) -> Rng { Rng { a: (seed as i64 as u64 & 0xffff_ffff) as u32 } }
    #[inline]
    pub fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6D2B79F5);
        let mut t = self.a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    pub fn int(&mut self, lo: i32, hi: i32) -> i32 { lo + (self.next() * (hi - lo + 1) as f64).floor() as i32 }
    pub fn pick_i(&mut self, n: usize) -> usize { (self.next() * n as f64).floor() as usize }
}
// JS `seed >>> 0` for a seed that may be any non-negative number below 2^53
pub fn rng(seed: f64) -> Rng { Rng { a: (seed.rem_euclid(4294967296.0)) as u32 } }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Item { pub id: u8, pub ty: Option<Type> }
pub fn item_id(s: &str) -> u8 { ITEM_IDS.iter().position(|x| *x == s).unwrap_or_else(|| panic!("unknown item {s}")) as u8 }
pub const I_LAST_THREAD: u8 = 0; pub const I_GAUNTLET: u8 = 1; pub const I_SEAL: u8 = 2; pub const I_SANDALS: u8 = 3; pub const I_OVERDRIVE: u8 = 4;
pub const I_BENTO: u8 = 5; pub const I_RICE: u8 = 6; pub const I_COAT: u8 = 7; pub const I_WARD: u8 = 8; pub const I_EMBLEM: u8 = 9; pub const I_CLOAK: u8 = 10;
pub const I_AMULET: u8 = 11; pub const I_INCENSE: u8 = 12; pub const I_PANACEA: u8 = 13; pub const I_POLICY: u8 = 14; pub const I_ARMOR: u8 = 15;
pub const I_SCROLL: u8 = 16; pub const I_ANCHOR: u8 = 17;
impl Item {
    pub fn choice(&self) -> Option<usize> { match self.id { I_GAUNTLET => Some(POW), I_SEAL => Some(ENE), I_SANDALS => Some(SPE), _ => None } }
    pub fn key(&self) -> String { match self.ty { Some(t) => format!("{}:{}", ITEM_IDS[self.id as usize], TYPES[t as usize]), None => ITEM_IDS[self.id as usize].to_string() } }
    pub fn parse(s: &str) -> Item { let mut p = s.split(':'); let id = item_id(p.next().unwrap()); Item { id, ty: p.next().map(type_id) } }
}

// A character as it goes into battle: built by batch.rs (makeBuild + trainTeam).
#[derive(Clone, Debug)]
pub struct Build {
    pub e: usize,
    pub moves: Vec<(usize, Flags)>,   // move index and the flags of this character's name for it
    pub ability: usize,               // id in data.abilities
    pub ability_name: String,
    pub evs: Option<[f64; 6]>,        // vit pow grd ene wil spe
    pub ivs: Option<[f64; 6]>,
    pub nature: Option<Nature>,
    pub item: Option<Item>,
    pub preset: Option<&'static str>,
}

#[derive(Clone, Copy, Debug)]
pub struct MoveSlot { pub mv: usize, pub flags: Flags, pub pp: i32, pub sig: bool, pub from_metronome: bool }

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum St { Burn, Freeze, Stun, Bleed, Curse, Sleep }
pub fn st_of(s: &str) -> Option<St> { Some(match s { "burn" => St::Burn, "freeze" => St::Freeze, "stun" => St::Stun, "bleed" => St::Bleed, "curse" => St::Curse, "sleep" => St::Sleep, _ => return None }) }
fn st_name(s: St) -> &'static str { match s { St::Burn => "burn", St::Freeze => "freeze", St::Stun => "stun", St::Bleed => "bleed", St::Curse => "curse", St::Sleep => "sleep" } }

#[derive(Clone, Default, Debug)]
pub struct MoveTrack { pub uses: f64, pub hits: f64, pub dmg: f64, pub kos: f64, pub crits: f64, pub misses: f64, pub sup: f64 }
#[derive(Clone, Default, Debug)]
pub struct Track { pub dmg: f64, pub taken: f64, pub kos: f64, pub turns: f64, pub entries: f64, pub turns_in: i32, pub moves: Vec<(usize, MoveTrack)> }

#[derive(Clone, Copy, Debug)]
pub struct BindV { pub left: i32, pub frac: f64, pub by: MonId }
#[derive(Clone, Copy, Debug)]
pub struct SeedV { pub frac: f64, pub by: MonId }

#[derive(Clone, Debug)]
pub struct Vol {
    pub entry_turn: i32, pub suppressed: i32, pub trapped: i32, pub bind: Option<BindV>, pub rampage: Option<(usize, i32)>,
    pub charging: Option<usize>, pub recharge: i32, pub lose_turn: bool, pub flinch: bool, pub confuse: i32, pub wake_confuse: bool,
    pub encore: Option<(i32, usize)>, pub choice: Option<usize>, pub last_move: Option<usize>, pub prev_move: Option<usize>,
    pub streak: i32, pub fury_n: i32, pub style_n: i32, pub used_energy_turn: i32, pub acted_turn: i32, pub invuln: bool,
    pub charged: bool, pub senkai: bool, pub lock_on: i32, pub lock_crit: bool, pub lock_crit_next: bool, pub self_chip: f64,
    pub eject_now: bool, pub protect: Option<Protect>, pub protect_turn: i32, pub protect_chain: i32, pub endure: i32,
    pub follow_me: i32, pub helped: bool, pub sub: f64, pub flash_fire: bool, pub one_hit: bool,
    pub took_phys: f64, pub took_ene: f64, pub took_turn: i32, pub punched: Vec<usize>, pub hit_keys: Vec<usize>, pub adapted: Vec<Type>,
    pub destiny_bond: bool, pub taunt: i32, pub seed: Option<SeedV>, pub slow_turn: i32, pub decay: f64, pub countdown: i32,
    pub yawn: i32, pub aqua_ring: bool, pub extra_turn: i32, pub kakuja: bool, pub transformed: bool, pub alt_next: Option<Type>,
    pub moved_turn: i32, pub last_attack_turn: i32, pub planned_attack: bool,
}
impl Default for Vol {
    fn default() -> Vol {
        Vol { entry_turn: NONE, suppressed: 0, trapped: 0, bind: None, rampage: None, charging: None, recharge: 0, lose_turn: false, flinch: false,
            confuse: 0, wake_confuse: false, encore: None, choice: None, last_move: None, prev_move: None, streak: 0, fury_n: 0, style_n: 0,
            used_energy_turn: NONE, acted_turn: NONE, invuln: false, charged: false, senkai: false, lock_on: 0, lock_crit: false, lock_crit_next: false,
            self_chip: 0.0, eject_now: false, protect: None, protect_turn: NONE, protect_chain: 0, endure: NONE, follow_me: 0, helped: false,
            sub: 0.0, flash_fire: false, one_hit: false, took_phys: 0.0, took_ene: 0.0, took_turn: NONE, punched: vec![], hit_keys: vec![],
            adapted: vec![], destiny_bond: false, taunt: 0, seed: None, slow_turn: NONE, decay: 0.0, countdown: 0, yawn: 0, aqua_ring: false,
            extra_turn: 0, kakuja: false, transformed: false, alt_next: None, moved_turn: NONE, last_attack_turn: NONE, planned_attack: false }
    }
}

#[derive(Clone, Default, Debug)]
pub struct Once {
    pub dodge_entry: bool, pub disguise_entry: bool, pub quick_drawn: bool, pub hit_taken: bool, pub no_heal: bool, pub th: u64,
    pub wimped: bool, pub revived: bool, pub revived_by_move: bool, pub read: bool, pub domain: bool, pub concealed: bool, pub no_recoil: bool,
    pub cryptid: bool, pub multiscale: bool, pub disguise: bool, pub contract: bool, pub survived: bool, pub pdodge: bool, pub dodge: bool,
    pub the_world: bool, pub bullet: bool,
}

#[derive(Clone, Debug)]
pub struct Mon {
    pub e: usize, pub side: usize, pub level: f64, pub types: Vec<Type>, pub maxhp: f64, pub hp: f64, pub raw: [f64; 5],
    pub item: Option<Item>, pub item_used: bool, pub ability: usize, pub base_ability: usize, pub moves: Vec<MoveSlot>,
    pub status: Option<St>, pub status_turns: i32, pub bleed_n: i32, pub boosts: [i32; 5], pub vol: Vol, pub once: Once,
    pub pending: Option<Boosts>, pub fainted: bool, pub t: Track, pub once_done: Vec<(usize, usize)>,
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Hazards { pub rocks: i32, pub spikes: i32, pub web: i32, pub rainbow: i32 }
#[derive(Clone, Copy, Default, Debug)]
pub struct Screens { pub reflect: i32, pub light: i32, pub veil: i32 }
impl Screens { pub fn any(&self) -> bool { self.reflect != 0 || self.light != 0 || self.veil != 0 }
    pub fn get(&self, k: &str) -> i32 { match k { "reflect" => self.reflect, "light" => self.light, "veil" => self.veil, _ => 0 } }
    fn set(&mut self, k: &str, v: i32) { match k { "reflect" => self.reflect = v, "light" => self.light = v, "veil" => self.veil = v, _ => {} } } }
#[derive(Clone, Debug)]
pub struct Future { pub turn: i32, pub by: MonId, pub mv: MoveSlot, pub slot: i32, pub mult: f64 }
#[derive(Clone, Debug)]
pub struct Chip { pub frac: f64, pub turns: i32, pub by: MonId }

#[derive(Clone, Copy, Debug)]
pub enum Act { Move { slot: usize, target: Option<MonId> }, Switch { to: MonId } }
#[derive(Clone, Copy, Debug)]
pub struct Choice { pub act: Act, pub score: f64 }

#[derive(Clone, Debug)]
pub struct Side {
    pub i: usize, pub mons: Vec<MonId>, pub active: Vec<Option<MonId>>, pub hazards: Hazards, pub screens: Screens, pub tailwind: i32,
    pub wish: Option<(i32, f64)>, pub chip: Option<Chip>, pub drain: Option<Chip>, pub futures: Vec<Future>, pub faint_turn: i32,
    pub time_stop: i32, pub gift: Option<Gift>, pub plan: Option<usize>, pub baton: Option<([i32; 5], f64)>, pub quick_guard: i32,
    pub wide_guard: i32, pub joint_plan: Option<(i32, [(MonId, Choice); 2])>,
}

#[derive(Clone, Debug)]
pub struct Field { pub fx: FieldFx, pub owner: usize, pub by: MonId }

pub struct BattleOpts { pub duos: bool, pub level: f64, pub turn_cap: i32, pub plans: [Option<usize>; 2] }

// What the engine asks opts.decide (battle.js): a replacement for side s from `options`, or mon m's action
// (extra: a second action the same turn). None leaves it to the AI.
pub enum Ask<'x> { Replace { s: usize, options: &'x [MonId] }, Action { m: MonId, extra: bool } }
pub type Decide<'a> = Box<dyn FnMut(&mut Battle<'a>, Ask) -> Option<Act> + 'a>;

pub struct Battle<'a> {
    pub d: &'a Data, pub r: Rng, pub duos: bool, pub turn: i32, pub field: Option<Field>, pub over: bool, pub winner: i32,
    pub sides: [Side; 2], pub mons: Vec<Mon>,
    pub cache: Option<Vec<f64>>,   // the AI's damage estimates while both sides choose (api.cache)
    pub turn_cap: i32,
    pub w: &'static ai::Weights,   // the AI's weights (the v1 bot swaps in its own)
    pub decide: Option<Decide<'a>>,
}

const OWN_STATUS: [(St, Type); 4] = [(St::Burn, 0), (St::Freeze, 2), (St::Stun, 5), (St::Bleed, 13)];

impl<'a> Battle<'a> {
    // ---- reading the state (the AI's api too) ----
    #[inline] pub fn ab_of(&self, m: MonId) -> &'a Ability { let d = self.d; let x = &self.mons[m]; if x.vol.suppressed > 0 { &d.abilities[NO_AB] } else { &d.abilities[x.ability] } }
    #[inline] pub fn ab_id(&self, m: MonId) -> usize { let x = &self.mons[m]; if x.vol.suppressed > 0 { NO_AB } else { x.ability } }
    pub fn mv(&self, ms: &MoveSlot) -> &'a Move { &self.d.moves[ms.mv] }
    // A defender's ability, unless the attacker or move ignores abilities.
    pub fn def_ab(&self, t: MonId, u: Option<MonId>, mv: Option<&MoveSlot>) -> &'a Ability {
        if let Some(u) = u {
            let ua = self.ab_of(u);
            if ua.mold_breaker || mv.map_or(false, |m| self.mv(m).fx.ignore_ability) || (mv.map_or(false, |m| m.sig) && ua.sig_bypass) { return &self.d.abilities[NO_AB]; }
        }
        self.ab_of(t)
    }
    #[inline] pub fn pct(&self, m: MonId) -> f64 { self.mons[m].hp / self.mons[m].maxhp }
    #[inline] pub fn blocks(&self, m: MonId, k: &str) -> bool { self.ab_of(m).blocks(k) }
    #[inline] fn held(&self, m: MonId, id: u8) -> bool { let x = &self.mons[m]; matches!(x.item, Some(i) if i.id == id) && !x.item_used }
    fn use_item(&mut self, m: MonId) { self.mons[m].item_used = true; }
    #[inline] pub fn foe_side(&self, s: usize) -> usize { 1 - s }
    pub fn alive(&self, s: usize) -> Vec<MonId> { self.sides[s].mons.iter().copied().filter(|&m| !self.mons[m].fainted).collect() }
    pub fn alive_n(&self, s: usize) -> usize { self.sides[s].mons.iter().filter(|&&m| !self.mons[m].fainted).count() }
    pub fn is_active(&self, m: MonId) -> bool { self.sides[self.mons[m].side].active.contains(&Some(m)) }
    pub fn bench(&self, s: usize) -> Vec<MonId> { let sd = &self.sides[s]; sd.mons.iter().copied().filter(|&m| !self.mons[m].fainted && !sd.active.contains(&Some(m))).collect() }
    pub fn bench_n(&self, s: usize) -> usize { let sd = &self.sides[s]; sd.mons.iter().filter(|&&m| !self.mons[m].fainted && !sd.active.contains(&Some(m))).count() }
    pub fn actives(&self, s: usize) -> Vec<MonId> { self.sides[s].active.iter().filter_map(|x| *x).filter(|&m| !self.mons[m].fainted).collect() }
    pub fn foes_of(&self, m: MonId) -> Vec<MonId> { self.actives(1 - self.mons[m].side) }
    pub fn ally_of(&self, m: MonId) -> Option<MonId> { self.actives(self.mons[m].side).into_iter().find(|&x| x != m) }

    // ---- stats ----
    // no_boost: a foe with Target Lock ignores raised Speed when working out who moves first.
    pub fn speed(&self, m: MonId, no_boost: bool) -> f64 {
        let a = self.ab_of(m); let x = &self.mons[m];
        let mut s = x.raw[SPE] * a.stat_mult.as_ref().and_then(|t| t.spe).unwrap_or(1.0) * stage_mult(if no_boost { x.boosts[SPE].min(0) } else { x.boosts[SPE] });
        if x.item.and_then(|i| i.choice()) == Some(SPE) { s *= CHOICE; }
        if x.status == Some(St::Stun) { s *= STUN_SPEED; }
        if self.sides[x.side].tailwind > 0 { s *= 2.0; }
        if let Some(f) = &self.field { if f.fx.foe_slow && f.owner != x.side { s *= 0.5; } }
        if a.sandevistan != 0 && x.t.turns_in != NONE && x.t.turns_in < a.sandevistan { s *= 2.0; }
        if a.low_battery && self.pct(m) < 0.25 { s *= 2.0; }
        if a.slow_start && !x.once.hit_taken { s *= 0.8; }
        s
    }
    fn stat_mods(&self, m: MonId, k: usize) -> f64 {
        let a = self.ab_of(m); let x = &self.mons[m];
        let mut v = a.stat_mult.as_ref().and_then(|t| t.get(k)).unwrap_or(1.0);
        if a.slow_start && !x.once.hit_taken { v *= 0.8; }
        if x.item.and_then(|i| i.choice()) == Some(k) { v *= CHOICE; }
        if k == WIL && matches!(x.item, Some(i) if i.id == I_COAT) { v *= VEST; }
        if k == POW {
            if a.eyepatch { v *= if self.pct(m) < 0.5 { 1.5 } else { 0.8 }; }
            if a.guts && x.status.is_some() { v *= 1.5; }
            if a.sleep_fighter && x.status == Some(St::Sleep) { v *= 1.5; }
        }
        v
    }

    // ---- stat stages ----
    pub fn boost(&mut self, m: MonId, stats: &[(usize, i32)], src: Option<MonId>, intimidate: bool) -> bool {
        if self.mons[m].fainted { return false; }
        let a = self.ab_of(m);
        let by_foe = src.map_or(false, |s| self.mons[s].side != self.mons[m].side);
        let (mut changed, mut dropped) = (false, false);
        for &(k0, v0) in stats {
            let mut k = k0; let mut v = v0;
            if k == HIGHEST { let raw = self.mons[m].raw; k = (0..5).fold(POW, |b, s| if raw[s] > raw[b] { s } else { b }); }
            if a.contrary { v = -v; }
            if v < 0 && by_foe && matches!(self.mons[m].item, Some(i) if i.id == I_AMULET) { continue; }
            if v < 0 && by_foe && (a.blocks("drops") || a.blocks(["drop:pow", "drop:grd", "drop:ene", "drop:wil", "drop:spe"][k]) || (intimidate && a.blocks("intimidate"))) { continue; }
            let before = self.mons[m].boosts[k];
            self.mons[m].boosts[k] = (before + v).clamp(-6, 6);
            if self.mons[m].boosts[k] != before { changed = true; if v < 0 { dropped = true; } }
        }
        if dropped && by_foe { if let Some(df) = &a.defiant { let k = ["pow", "grd", "ene", "wil", "spe"].iter().position(|s| s == df).unwrap(); self.boost(m, &[(k, 2)], Some(m), false); } }
        changed
    }

    // ---- healing and damage ----
    pub fn heal(&mut self, m: MonId, amount: f64, from_move: bool) -> f64 {
        if self.mons[m].fainted || self.mons[m].once.no_heal { return 0.0; }
        let mut a = amount.floor();
        if from_move { let hm = self.ab_of(m).heal_mult; if hm != 0.0 { a = (a * hm).floor(); } }
        let x = &mut self.mons[m];
        let h = (x.maxhp - x.hp).min(a.max(0.0));
        x.hp += h;
        h
    }
    // Direct damage that is not an attack: recoil, chip, hazards.
    pub fn hurt(&mut self, m: MonId, amount: f64, by: Option<MonId>) {
        if self.mons[m].fainted || !(amount > 0.0) { return; }
        let x = &mut self.mons[m];
        let d = x.hp.min(amount.floor().max(1.0));
        x.hp -= d; x.t.taken += d;
        self.after_hp(m, by);
        if self.mons[m].hp <= 0.0 { self.faint(m, by); }
    }
    // One-time triggers that fire when Vitality crosses a line.
    fn after_hp(&mut self, m: MonId, _by: Option<MonId>) {
        if self.mons[m].fainted || self.mons[m].hp <= 0.0 { return; }
        let a = self.ab_of(m);
        if self.held(m, I_RICE) && self.pct(m) < SITRUS_BELOW { self.use_item(m); let mh = self.mons[m].maxhp; self.heal(m, mh * SITRUS, false); }
        for (i, th) in a.threshold.iter().enumerate() {
            if self.mons[m].once.th & (1 << i) != 0 || self.pct(m) >= th.below { continue; }
            self.mons[m].once.th |= 1 << i;
            for op in &th.ops {
                let mh = self.mons[m].maxhp;
                match op.op.as_str() {
                    "boost" => { self.boost(m, op.stats.as_deref().unwrap_or(&[]), Some(m), false); }
                    "heal" => { self.heal(m, mh * op.frac, false); }
                    "cure" => self.mons[m].status = None,
                    "confuse" => { self.confuse(m, Some(m)); }
                    "kakuja" => self.mons[m].vol.kakuja = true,
                    "sub" => if self.mons[m].vol.sub == 0.0 { self.mons[m].vol.sub = (mh * op.frac).floor(); },
                    "foes" => for f in self.foes_of(m) { self.boost(f, op.stats.as_deref().unwrap_or(&[]), Some(m), false); },
                    "teamHeal" => for x in self.alive(self.mons[m].side) { let xh = self.mons[x].maxhp; self.heal(x, xh * op.frac, false); },
                    "noHeal" => self.mons[m].once.no_heal = true,
                    _ => {}
                }
            }
        }
        if a.wimp_out != 0.0 && self.pct(m) < a.wimp_out && !self.mons[m].once.wimped && self.bench_n(self.mons[m].side) > 0 { self.mons[m].once.wimped = true; self.mons[m].vol.eject_now = true; }
    }

    fn faint(&mut self, m: MonId, by: Option<MonId>) {
        if self.mons[m].fainted { return; }
        let a = self.ab_of(m);
        if a.revive_once != 0.0 && !self.mons[m].once.revived { self.mons[m].once.revived = true; self.mons[m].hp = (self.mons[m].maxhp * a.revive_once).floor(); return; }
        self.mons[m].hp = 0.0; self.mons[m].fainted = true;
        let ms = self.mons[m].side;
        self.sides[ms].faint_turn = self.turn;
        if let Some(by) = by { if by != m && !self.mons[by].fainted {
            self.mons[by].t.kos += 1.0;
            let ba = self.ab_of(by);
            for op in &ba.ko {
                if op.one_hit && !self.mons[m].vol.one_hit { continue; }
                match op.op.as_str() {
                    "boost" => { self.boost(by, op.stats.as_deref().unwrap_or(&[]), Some(by), false); }
                    "heal" => { let mh = self.mons[by].maxhp; self.heal(by, mh * op.frac, false); }
                    "foes" => for f in self.foes_of(by) { self.boost(f, op.stats.as_deref().unwrap_or(&[]), Some(by), false); },
                    "steal-ability" => { self.mons[by].ability = self.ab_id(m); }
                    _ => {}
                }
            }
            for x in self.actives(self.mons[by].side) { if x != by { if let Some(s) = &self.ab_of(x).ally_ko { self.boost(x, s, Some(x), false); } } }
            for op in &a.faint { if op.op == "aftermath" { let mh = self.mons[by].maxhp; self.hurt(by, mh * op.frac, Some(m)); } }
            if self.mons[m].vol.destiny_bond { self.mons[by].hp = 0.0; self.faint(by, Some(m)); }
        } }
        for op in &a.faint {
            if op.op == "requiem" {
                for x in self.alive(ms) { self.add_pending(x, &[(0, 1), (1, 1), (2, 1), (3, 1), (4, 1)]); }
                for f in self.foes_of(m) { self.boost(f, &[(0, -1), (1, -1), (2, -1), (3, -1), (4, -1)], Some(m), false); }
            }
            if op.op == "nextBoost" { self.sides[ms].gift = Some(Gift { heal: 0.0, stats: op.stats.clone() }); }
        }
        for x in self.alive(ms) {
            for op in &self.ab_of(x).ally_faint {
                if op.op == "boost" { self.add_pending(x, op.stats.as_deref().unwrap_or(&[])); }
                if op.op == "heal" { let mh = self.mons[x].maxhp; self.heal(x, mh * op.frac, false); }
            }
        }
    }
    // A boost for a teammate: now if it is in battle, otherwise when it next comes in.
    fn add_pending(&mut self, m: MonId, stats: &[(usize, i32)]) {
        if self.is_active(m) { self.boost(m, stats, Some(m), false); return; }
        let p = self.mons[m].pending.get_or_insert_with(Vec::new);
        for &(k, v) in stats { if let Some(e) = p.iter_mut().find(|e| e.0 == k) { e.1 += v; } else { p.push((k, v)); } }
    }

    // ---- status ----
    // kind: a status name, 'tri' or 'confuse'
    fn inflict(&mut self, t: MonId, kind: &str, src: Option<MonId>, mv: Option<&MoveSlot>, turns: Option<i32>, wake_confuse: bool) -> bool {
        if self.mons[t].fainted { return false; }
        let kind = if kind == "tri" { ["burn", "freeze", "stun"][self.r.pick_i(3)] } else { kind };
        if kind == "confuse" { return self.confuse(t, src); }
        let st = match st_of(kind) { Some(s) => s, None => return false };
        let a = if src.is_some() && src != Some(t) { self.def_ab(t, src, mv) } else { self.ab_of(t) };
        if self.mons[t].status.is_some() || a.blocks(kind) || a.blocks("status") || (a.comatose && a.blocks("status")) { return false; }
        if let Some(mv) = mv { if src != Some(t) && self.mons[t].vol.sub != 0.0 && !self.mv(mv).fx.breaks_sub { return false; } }
        if OWN_TYPE_STATUS_IMMUNE { if let Some(&(_, ty)) = OWN_STATUS.iter().find(|x| x.0 == st) { if self.mons[t].types.contains(&ty) { return false; } } }
        if st == St::Sleep && self.field.as_ref().map_or(false, |f| f.fx.no_sleep) { return false; }
        if st == St::Sleep && mv.map_or(false, |m| m.flags.sound) && a.blocks("soundSleep") { return false; }
        self.mons[t].status = Some(st);
        self.mons[t].status_turns = if st == St::Sleep { if self.ab_of(t).early_bird { 1 } else { self.r.int(SLEEP_TURNS[0], SLEEP_TURNS[1]) } } else if st == St::Freeze { turns.filter(|&x| x != 0).unwrap_or(FREEZE_MAX) } else { 0 };
        self.mons[t].bleed_n = 0;
        if wake_confuse { self.mons[t].vol.wake_confuse = true; }
        if st == St::Sleep { if let Some(s) = src { if s != t { let sh = self.ab_of(s).sleep_heal; if sh != 0.0 { let mh = self.mons[s].maxhp; self.heal(s, mh * sh, false); } } } }
        if self.held(t, I_PANACEA) { self.use_item(t); self.mons[t].status = None; self.mons[t].status_turns = 0; }
        true
    }
    fn confuse(&mut self, t: MonId, src: Option<MonId>) -> bool {
        if self.mons[t].fainted || self.mons[t].vol.confuse > 0 { return false; }
        if self.blocks(t, "confuse") && src != Some(t) { return false; }
        self.mons[t].vol.confuse = self.r.int(CONFUSE_TURNS[0], CONFUSE_TURNS[1]);
        if self.held(t, I_PANACEA) { self.use_item(t); self.mons[t].vol.confuse = 0; }
        true
    }

    // ---- switching ----
    pub fn can_switch(&self, m: MonId) -> bool {
        if self.blocks(m, "trap") { return true; }
        let v = &self.mons[m].vol;
        if v.trapped > 0 || v.bind.is_some() || v.rampage.is_some() || v.charging.is_some() { return false; }
        for f in self.foes_of(m) {
            let fa = self.ab_of(f);
            if let Some(t) = fa.magnet_pull { if self.mons[m].types.contains(&t) { return false; } }
            if fa.low_trap != 0.0 && self.pct(m) < fa.low_trap { return false; }
        }
        true
    }
    fn switch_out(&mut self, m: MonId, baton: bool, keep_bleed: bool) -> usize {
        let s = self.mons[m].side; let a = self.ab_of(m);
        if a.regenerator != 0.0 && !self.mons[m].fainted { let mh = self.mons[m].maxhp; self.heal(m, mh * a.regenerator, false); }
        if let Some(g) = &a.switch_gift { if !self.mons[m].fainted { self.sides[s].gift = Some(g.clone()); } }
        if baton { self.sides[s].baton = Some((self.mons[m].boosts, self.mons[m].vol.sub)); }
        let d = self.d;
        let x = &mut self.mons[m];
        if !keep_bleed { x.bleed_n = 0; }
        x.vol = Vol::default(); x.ability = x.base_ability; x.types = d.entrants[x.e].types.clone();
        x.boosts = [0; 5];
        let slot = self.sides[s].active.iter().position(|a| *a == Some(m)).unwrap();
        self.sides[s].active[slot] = None;
        slot
    }
    fn switch_in(&mut self, m: MonId, slot: usize, how: &str) {
        let s = self.mons[m].side;
        self.sides[s].active[slot] = Some(m);
        { let t = self.turn; let x = &mut self.mons[m]; x.vol = Vol { entry_turn: t, ..Vol::default() }; x.t.entries += 1.0; x.t.turns_in = 0;
          x.once.dodge_entry = false; x.once.disguise_entry = false; x.once.quick_drawn = false; }
        if let Some((b, sub)) = self.sides[s].baton.take() { self.mons[m].boosts = b; if sub != 0.0 { self.mons[m].vol.sub = sub; } }
        if let Some(p) = self.mons[m].pending.take() { self.boost(m, &p, Some(m), false); }
        if let Some(g) = self.sides[s].gift.take() {
            if g.heal != 0.0 { let mh = self.mons[m].maxhp; self.heal(m, mh * g.heal, false); }
            if let Some(st) = &g.stats { self.boost(m, st, Some(m), false); }
        }
        let a = self.ab_of(m);
        if !a.blocks("hazards") {
            let grounded = !a.immune.iter().any(|x| x.r#type == Some(4)) || self.field.as_ref().map_or(false, |f| f.fx.gravity);
            let hz = self.sides[s].hazards; let mh = self.mons[m].maxhp;
            if hz.rocks != 0 { let e = type_eff(4, &self.mons[m].types); self.hurt(m, mh / 8.0 * e, None); }
            if hz.rainbow != 0 && !self.mons[m].fainted { let e = type_eff(1, &self.mons[m].types); self.hurt(m, mh / 8.0 * e, None); }
            if hz.spikes != 0 && grounded && !self.mons[m].fainted { self.hurt(m, mh * [0.0, 1.0 / 8.0, 1.0 / 6.0, 1.0 / 4.0][hz.spikes as usize], None); }
            if hz.web != 0 && grounded && !self.mons[m].fainted { let f = self.foes_of(m).first().copied(); self.boost(m, &[(SPE, -1)], f, false); }
        }
        if let Some(f) = &self.field { if f.fx.entry_chip != 0.0 && f.owner != s && !self.mons[m].fainted { let c = f.fx.entry_chip; let mh = self.mons[m].maxhp; self.hurt(m, mh * c, None); } }
        if self.mons[m].fainted { return; }
        if how == "pivot" && a.motion_sickness { self.confuse(m, Some(m)); }
        self.entry_ability(m);
    }
    fn entry_ability(&mut self, m: MonId) {
        let aid = self.ab_id(m);
        let a = &self.d.abilities[aid];
        for (oi, op) in a.entry.iter().enumerate() {
            if op.once { if self.mons[m].once_done.contains(&(aid, oi)) { continue; } self.mons[m].once_done.push((aid, oi)); }
            let foes: Vec<MonId> = self.foes_of(m).into_iter().filter(|&f| op.only_type.map_or(true, |t| self.mons[f].types.contains(&t))).collect();
            let st = op.stats.as_deref().unwrap_or(&[]);
            match op.op.as_str() {
                "foes" => for &f in &foes { self.boost(f, st, Some(m), op.intimidate); },
                "self" => if op.if_foe_type.map_or(true, |t| self.foes_of(m).iter().any(|&f| self.mons[f].types.contains(&t))) { self.boost(m, st, Some(m), false); },
                "ally" => if let Some(al) = self.ally_of(m) { if !self.ab_of(al).loner { self.boost(al, st, Some(m), false); } },
                "allyHeal" => if let Some(al) = self.ally_of(m) { let mh = self.mons[al].maxhp; self.heal(al, mh * op.frac, false); },
                "sub" => if self.mons[m].vol.sub == 0.0 { self.mons[m].vol.sub = (self.mons[m].maxhp * op.frac).floor(); },
                "field" => self.set_field(op.field.as_ref().unwrap(), m),
                "confuse" => for &f in &foes { if self.r.next() < op.p { self.confuse(f, Some(m)); } },
                "trap" => for &f in &foes { if !self.blocks(f, "trap") { self.mons[f].vol.trapped = self.mons[f].vol.trapped.max(op.turns + 1); } },
                "psychUp" => if let Some(&f) = foes.first() { for k in 0..5 { if self.mons[f].boosts[k] > 0 { self.mons[m].boosts[k] = self.mons[f].boosts[k]; } } },
                "download" => if let Some(&f) = foes.first() {
                    let x = &self.mons[f];
                    let up = if x.raw[GRD] * stage_mult(x.boosts[GRD]) < x.raw[WIL] * stage_mult(x.boosts[WIL]) { POW } else { ENE };
                    self.boost(m, &[(up, 1)], Some(m), false);
                },
                "trace" => if let Some(&f) = foes.first() {
                    self.mons[m].ability = self.ab_id(f);
                    let na = &self.d.abilities[self.mons[m].ability];
                    if !na.entry.is_empty() && !na.entry.iter().any(|o| o.op == "trace") { self.entry_ability(m); }
                },
                "imposter" => if let Some(&f) = foes.first() { self.transform(m, f, false); },
                "drainField" => { let s = self.mons[m].side; self.sides[s].drain = Some(Chip { frac: op.frac, turns: op.turns, by: m }); }
                "clearFoeSide" => { let fs = 1 - self.mons[m].side; self.sides[fs].screens = Screens::default(); self.sides[fs].tailwind = 0; }
                "theWorld" => if !self.mons[m].once.the_world { self.mons[m].once.the_world = true; let fs = 1 - self.mons[m].side; self.sides[fs].time_stop = self.turn + 1; },
                "encore" => if let Some(&f) = foes.first() { if let Some(lm) = self.mons[f].vol.last_move { if !self.blocks(f, "encore") { self.mons[f].vol.encore = Some((3, lm)); } } },
                "wake" => for &f in &foes { if self.mons[f].status == Some(St::Sleep) { self.mons[f].status = None; } },
                _ => {}
            }
        }
        if self.duos { if let Some(p) = &a.pair {
            if let Some(al) = self.ally_of(m) { if self.d.entrants[self.mons[al].e].char_name == p.name {
                if p.speed != 0 { self.boost(m, &[(SPE, 1)], Some(m), false); self.boost(al, &[(SPE, 1)], Some(m), false); }
                if p.pow != 0 { self.boost(m, &[(POW, 1)], Some(m), false); }
            } }
        } }
    }
    fn transform(&mut self, m: MonId, f: MonId, with_ability: bool) {
        let (types, raw, boosts) = (self.mons[f].types.clone(), self.mons[f].raw, self.mons[f].boosts);
        let moves: Vec<MoveSlot> = self.mons[f].moves.iter().map(|x| MoveSlot { pp: x.pp.min(5), ..*x }).collect();
        let fab = self.ab_id(f);
        let x = &mut self.mons[m];
        x.types = types; x.raw = raw; x.boosts = boosts; x.moves = moves;
        if with_ability { x.ability = fab; }
        x.vol.transformed = true;
    }
    // Bring in the next character after a knockout, a pivot or a forced switch.
    fn bring_in(&mut self, s: usize, slot: usize, how: &str, pick_random: bool) -> bool {
        let options = self.bench(s);
        if options.is_empty() { return false; }
        let next = if pick_random { options[self.r.pick_i(options.len())] } else {
            match self.ask(Ask::Replace { s, options: &options }) { Some(Act::Switch { to }) => to, _ => ai::choose_replacement(self, s, &options) }
        };
        self.switch_in(next, slot, how);
        true
    }
    fn ask(&mut self, q: Ask) -> Option<Act> {
        let mut f = self.decide.take()?;
        let a = f(self, q);
        self.decide = Some(f);
        a
    }
    fn action(&mut self, m: MonId, extra: bool) -> Act { match self.ask(Ask::Action { m, extra }) { Some(a) => a, None => ai::choose_action(self, m).act } }
    fn set_field(&mut self, f: &FieldFx, by: MonId) {
        let mut fx = f.clone();
        if matches!(self.mons[by].item, Some(i) if i.id == I_ANCHOR) { fx.turns = ANCHOR_TURNS; }
        self.field = Some(Field { fx, owner: self.mons[by].side, by });
    }

    // ---- damage ----
    pub fn move_type(&self, u: MonId, mv: &MoveSlot, t: Option<MonId>) -> Type {
        let m = self.mv(mv);
        if let Some(t) = t { if m.fx.best_type || (mv.sig && self.ab_of(u).best_type_sig) {
            let tt = &self.mons[t].types;
            return (0..15u8).fold(m.ty, |b, x| if type_eff(x, tt) > type_eff(b, tt) { x } else { b });
        } }
        m.ty
    }
    pub fn effectiveness(&self, u: MonId, mv: &MoveSlot, t: MonId, ty: Type, cryptid_check: bool) -> f64 {
        let fx = &self.mv(mv).fx;
        let ua = self.ab_of(u); let ta = self.def_ab(t, Some(u), Some(mv));
        let one = [ty];
        let types: &[Type] = match &fx.dual_type { Some(v) => v, None => &one };
        let mut e = 1.0;
        for &tyx in types { for &d in &self.mons[t].types {
            let mut x = eff1(tyx, d);
            if fx.super_vs.as_ref().map_or(false, |v| v.contains(&d)) { x = 2.0; }
            if ua.scrappy && x == 0.0 && d == 8 { x = 1.0; }
            if let Some(p) = &ua.pierce { if tyx == p[0] && d == p[1] && x < 1.0 { x = 1.0; } }
            e *= x;
        } }
        if ta.unweak == Some(ty) && e > 1.0 { e = 1.0; }
        if cryptid_check && ta.cryptid && !self.mons[t].once.cryptid { e = if e == 0.0 { 0.0 } else { 1.0 }; }
        e
    }
    // The power after per-move rules (stored power, reversal, ramping moves...).
    pub fn base_power(&self, u: MonId, mv: &MoveSlot, t: Option<MonId>) -> f64 {
        let m = self.mv(mv); let x = &self.mons[u];
        let mut p = m.power;
        match m.fx.power.as_deref() {
            Some("stored") => p += 20.0 * x.boosts.iter().map(|&b| b.max(0)).sum::<i32>() as f64,
            Some("hex") => if t.map_or(false, |t| self.mons[t].status.is_some()) { p *= 2.0; },
            Some("fury") => p = (160.0f64).min(p * crate::jsmath::pow(2.0, x.vol.fury_n.min(2) as f64)),
            Some("flux") => p = (200.0f64).min(p + 50.0 * if x.vol.last_move == Some(mv.mv) { x.vol.streak as f64 } else { 0.0 }),
            Some("reversal") => { let q = self.pct(u); p = if q > 0.7 { 20.0 } else if q > 0.35 { 40.0 } else if q > 0.2 { 80.0 } else if q > 0.1 { 100.0 } else if q > 0.04 { 150.0 } else { 200.0 }; }
            Some("avenge") => if self.sides[x.side].faint_turn == self.turn - 1 { p *= 2.0; },
            Some("avenge15") => if self.sides[x.side].faint_turn == self.turn - 1 { p *= 1.5; },
            Some("vsEnergy") => if t.map_or(false, |t| self.mons[t].vol.used_energy_turn == self.turn) { p *= 2.0; },
            _ => {}
        }
        p
    }

    // Damage of one hit. With est set, returns the average roll with no crit, for the AI.
    pub fn calc(&mut self, u: MonId, t: MonId, mv: &MoveSlot, crit: bool, spread: bool, est: bool, eff_in: Option<f64>, power_in: Option<f64>) -> f64 {
        let m = self.mv(mv); let fx = &m.fx;
        match fx.fixed.as_deref() { Some("level") => return self.mons[u].level, Some("halfhp") => return (self.mons[t].hp / 2.0).floor().max(1.0), _ => {} }
        let ty = self.move_type(u, mv, Some(t));
        let eff = eff_in.unwrap_or_else(|| self.effectiveness(u, mv, t, ty, !est));
        if eff == 0.0 { return 0.0; }
        let ua = self.ab_of(u); let ta = self.def_ab(t, Some(u), Some(mv));
        let phys = m.cat == Cat::Physical;
        // attack
        let mut akey = if phys { POW } else { ENE };
        let attacker = if fx.foul_play { t } else { u };
        if phys && ua.speed_as_power { akey = SPE; }
        let mut a_stage = self.mons[attacker].boosts[akey];
        if ta.unaware || (crit && a_stage < 0) { a_stage = 0; }
        let a_ = self.mons[attacker].raw[akey] * stage_mult(a_stage) * self.stat_mods(attacker, if akey == SPE { POW } else { akey });
        // defence
        let dkey = if phys || fx.psyshock { GRD } else { WIL };
        let mut d_stage = self.mons[t].boosts[dkey];
        if ua.unaware || fx.ignore_boosts.as_deref() == Some("all") { d_stage = 0; }
        if (fx.ignore_boosts.as_deref() == Some("def") || ua.ignore_def_boosts) && d_stage > 0 { d_stage = 0; }
        if crit && d_stage > 0 { d_stage = 0; }
        let domain = ua.instant_domain && mv.flags.contact && !self.mons[u].once.domain;
        if domain { d_stage = d_stage.min(0); }
        let mut dd = self.mons[t].raw[dkey] * stage_mult(d_stage) * self.stat_mods(t, dkey);
        if dkey == GRD && self.field.as_ref().map_or(false, |f| f.fx.snow) && self.mons[t].types.contains(&2) { dd *= 1.5; }
        if dkey == WIL && self.mons[t].status == Some(St::Curse) { dd *= CURSE_WILL; }
        if domain { dd = dd.min(self.mons[t].raw[dkey]) * 0.5; }
        dd = dd.max(1.0);
        let power = power_in.unwrap_or_else(|| self.base_power(u, mv, Some(t)));
        // ability power modifiers
        let mut md = 1.0;
        for w in &ua.atk { if self.atk_applies(w, u, t, mv, ty, power) { md *= w.mult; } }
        let uv = &self.mons[u].vol;
        if ty == 0 && uv.flash_fire { md *= 1.5; }
        if let Some(rp) = &ua.ramp { if ty == rp.r#type { let ti = self.mons[u].t.turns_in; md *= rp.max.min(1.0 + rp.step * if ti == NONE { 0.0 } else { ti as f64 }); } }
        if let Some((_, _, x)) = ua.alt { if uv.alt_next == Some(ty) { md *= x; } }
        if ua.stylish { md *= (1.5f64).min(1.0 + 0.1 * uv.style_n as f64); }
        if uv.charged && ty == 5 { md *= 2.0; }
        if uv.senkai && power > 0.0 { md *= 2.0; }
        if uv.helped { md *= 1.5; }
        if self.duos {
            if let Some(al) = self.ally_of(u) {
                let aa = self.ab_of(al);
                if aa.battery != 0.0 && m.cat == Cat::Energy { md *= aa.battery; }
                if let Some(p) = &ua.pair { if p.mult != 0.0 && self.d.entrants[self.mons[al].e].char_name == p.name { md *= p.mult; } }
                if let Some(p) = &aa.pair { if p.mult != 0.0 && p.name == self.d.entrants[self.mons[u].e].char_name && p.name.contains("Toriko") { md *= p.mult; } }
            }
        }
        if let Some(f) = &self.field { if f.fx.boost_type == Some(ty) { md *= FIELD_BOOST; } }
        if let Some(i) = self.mons[u].item { if i.id == I_EMBLEM && i.ty == Some(ty) { md *= EMBLEM; } if i.id == I_OVERDRIVE { md *= LIFE_ORB; } }
        // base damage
        let lvl = self.mons[u].level;
        let mut dmg = ((((2.0 * lvl / 5.0 + 2.0).floor() * power * a_ / dd).floor()) / 50.0).floor() + 2.0;
        if spread { dmg *= SPREAD; }
        if crit { dmg *= if ua.crit_mult != 0.0 { ua.crit_mult } else { CRIT_MULT }; }
        dmg *= if est { (RANDOM[0] + RANDOM[1]) / 2.0 } else { RANDOM[0] + self.r.next() * (RANDOM[1] - RANDOM[0]) };
        let own = match &fx.dual_type { Some(v) => v.iter().any(|x| self.mons[u].types.contains(x)), None => self.mons[u].types.contains(&ty) };
        if own { dmg *= STAB; } else if ua.off_stab != 0.0 { dmg *= ua.off_stab; }
        dmg *= eff;
        if phys && self.mons[u].status == Some(St::Burn) && !ua.guts { dmg *= BURN_PHYSICAL; }
        if !phys && self.mons[u].status == Some(St::Curse) { dmg *= CURSE_ENERGY; }
        let ts = self.sides[self.mons[t].side].screens;
        if !crit && !fx.breaks_screens && ((phys && ts.reflect != 0) || (!phys && ts.light != 0) || ts.veil != 0) { dmg *= if self.duos { SCREEN_DUOS } else { SCREEN_SINGLES }; }
        dmg *= md;
        // defender ability
        for w in &ta.def { if self.def_applies(w, t, mv, ty, eff) { dmg *= w.mult; } }
        if ta.multiscale.on() && !self.mons[t].once.multiscale && (ta.multiscale == Tag::On || ta.multiscale.is(cat_str(m.cat))) { dmg *= 0.5; }
        if ta.adaptive && self.mons[t].vol.adapted.contains(&ty) { dmg *= 0.5; }
        if self.duos { if let Some(al) = self.ally_of(t) { let g = self.ab_of(al).ally_guard; if g != 0.0 { dmg *= g; } } }
        if eff > 1.0 && self.held(t, I_WARD) && self.mons[t].item.unwrap().ty == Some(ty) { dmg *= WARD; if !est { self.use_item(t); } }
        dmg.floor().max(1.0)
    }
    fn atk_applies(&self, w: &AtkW, u: MonId, t: MonId, mv: &MoveSlot, ty: Type, power: f64) -> bool {
        let m = self.mv(mv); let (uu, tt) = (&self.mons[u], &self.mons[t]);
        if let Some(wt) = &w.r#type { if wt == "own" { if !uu.types.contains(&ty) { return false; } } else if type_id(wt) != ty { return false; } }
        if let Some(l) = w.low_hp { if l != 0.0 && self.pct(u) >= l { return false; } }
        if let Some(c) = w.cat { if c != m.cat { return false; } }
        if let Some(f) = &w.flag { if f == "punchkick" { if !(mv.flags.punch || mv.flags.kick) { return false; } } else if !mv.flags.get(f) { return false; } }
        if w.contact && !mv.flags.contact { return false; }
        if w.max_power != 0.0 && !(power > 0.0 && power <= w.max_power) { return false; }
        if w.recoil && m.fx.recoil == 0.0 { return false; }
        if w.priority && !(m.priority > 0.0) { return false; }
        if let Some(s) = &w.size { if m.size.as_deref() != Some(s.as_str()) { return false; } }
        if w.not_sig && mv.sig { return false; }
        if let Some(vt) = &w.vs_types { if !tt.types.iter().any(|x| vt.contains(x)) { return false; } }
        if w.vs_villain && !self.d.entrants[tt.e].villain { return false; }
        if w.vs_low_hp != 0.0 && self.pct(t) >= w.vs_low_hp { return false; }
        if w.vs_boosted && !tt.boosts.iter().any(|&b| b > 0) { return false; }
        if w.vs_hit_before && !uu.vol.hit_keys.contains(&tt.e) { return false; }
        if w.vs_caster && !(tt.raw[ENE] > tt.raw[POW]) { return false; }
        if w.target_not_moved && tt.vol.moved_turn == self.turn { return false; }
        if w.moved_after && tt.vol.moved_turn != self.turn { return false; }
        if w.first_once.is_some() && uu.once.concealed { return false; }
        if w.gravity && !self.field.as_ref().map_or(false, |f| f.fx.gravity) { return false; }
        if w.tailwind && !(self.sides[uu.side].tailwind > 0) { return false; }
        if w.duos && !self.duos { return false; }
        true
    }
    fn def_applies(&self, w: &DefW, t: MonId, mv: &MoveSlot, ty: Type, eff: f64) -> bool {
        let m = self.mv(mv);
        if let Some(x) = w.r#type { if x != ty { return false; } }
        if let Some(x) = w.not_type { if x == ty { return false; } }
        if let Some(c) = w.cat { if c != m.cat { return false; } }
        if w.contact && !mv.flags.contact { return false; }
        if w.super_eff && !(eff > 1.0) { return false; }
        if w.low_hp != 0.0 && self.pct(t) >= w.low_hp { return false; }
        if w.full_hp && self.mons[t].hp < self.mons[t].maxhp { return false; }
        true
    }
    fn crit_stage(&self, u: MonId, mv: &MoveSlot, t: MonId) -> i32 {
        let ua = self.ab_of(u); let m = self.mv(mv);
        if self.blocks(t, "crit") && !(ua.mold_breaker || m.fx.ignore_ability) { return -1; }
        if m.fx.always_crit || self.mons[u].vol.lock_crit { return 3; }
        if m.fx.crit_below_half && self.pct(t) < 0.5 { return 3; }
        if ua.one_punch && !self.mons[u].vol.punched.contains(&self.mons[t].e) { return 3; }
        let mut s = m.fx.crit;
        if let Some(c) = &ua.crit {
            if c.r#type.map_or(true, |x| x == m.ty) && c.flag.as_ref().map_or(true, |f| mv.flags.get(f)) && (c.low_hp == 0.0 || self.pct(u) < c.low_hp) { s += c.stage; }
        }
        if self.ab_of(t).bad_luck { s += 1; }
        s
    }

    fn track(&mut self, m: MonId, mv: usize) -> &mut MoveTrack {
        let t = &mut self.mons[m].t.moves;
        let i = match t.iter().position(|x| x.0 == mv) { Some(i) => i, None => { t.push((mv, MoveTrack::default())); t.len() - 1 } };
        &mut t[i].1
    }

    // ---- using a move ----
    fn use_move(&mut self, u: MonId, slot_idx: usize, target_hint: Option<MonId>) {
        if self.mons[u].fainted || !self.is_active(u) { return; }
        let a = self.ab_of(u);
        let turn = self.turn;
        self.mons[u].vol.acted_turn = turn;
        // can it act?
        if self.mons[u].vol.recharge > 0 { self.mons[u].vol.recharge -= 1; return; }
        if self.sides[self.mons[u].side].time_stop == turn { return; }
        if self.mons[u].vol.lose_turn { self.mons[u].vol.lose_turn = false; return; }
        if a.truant_first && !self.mons[u].once.read { self.mons[u].once.read = true; return; }
        if self.mons[u].status == Some(St::Sleep) && !a.comatose && !a.sleep_fighter {
            self.mons[u].status_turns -= 1;
            if self.mons[u].status_turns > 0 { return; }
            self.mons[u].status = None;
            if self.mons[u].vol.wake_confuse { self.mons[u].vol.wake_confuse = false; self.confuse(u, Some(u)); }
        }
        if self.mons[u].status == Some(St::Freeze) {
            self.mons[u].status_turns -= 1;
            if self.mons[u].status_turns > 0 && self.r.next() >= FREEZE_THAW { return; }
            self.mons[u].status = None;
        }
        if self.mons[u].status == Some(St::Stun) && self.r.next() < STUN_SKIP { return; }
        if self.mons[u].vol.flinch { self.mons[u].vol.flinch = false; if !self.blocks(u, "flinch") { return; } }
        if a.narcolepsy != 0.0 && self.r.next() < a.narcolepsy { let mh = self.mons[u].maxhp; self.heal(u, mh / 8.0, false); return; }
        if a.low_battery && self.pct(u) < 0.25 && self.r.next() < 0.33 { self.hurt_self_confused(u); return; }
        if self.mons[u].vol.confuse > 0 {
            self.mons[u].vol.confuse -= 1;
            if self.mons[u].vol.confuse == 0 {} else if self.r.next() < CONFUSE_SELF { self.hurt_self_confused(u); return; }
        }
        // which move
        let rampaging = self.mons[u].vol.rampage.is_some();
        let x = &self.mons[u];
        let find = |id: usize| x.moves.iter().position(|s| s.mv == id);
        let mut slot = if slot_idx < x.moves.len() { Some(slot_idx) } else { None };
        if let Some((id, _)) = x.vol.rampage { slot = find(id).or(slot); }
        if let Some(id) = x.vol.charging { slot = find(id).or(slot); }
        if let Some((_, id)) = x.vol.encore { if x.vol.charging.is_none() && x.vol.rampage.is_none() { slot = find(id).or(slot); } }
        if let Some(id) = x.vol.choice { if x.vol.encore.is_none() { if let Some(l) = find(id) { if x.moves[l].pp > 0 { slot = Some(l); } } } }
        let slot = match slot { Some(s) => s, None => return };
        let mut mv = self.mons[u].moves[slot];
        if self.mv(&mv).cat == Cat::Status && matches!(self.mons[u].item, Some(i) if i.id == I_COAT) { return; }
        if self.mv(&mv).fx.metronome {
            let d = self.d;
            let pool: Vec<usize> = (0..d.moves.len()).filter(|&i| { let m = &d.moves[i]; !m.is_sig && !m.fx.metronome && m.id != "protect" }).collect();
            self.mons[u].moves[slot].pp -= 1;
            let pick = pool[self.r.pick_i(pool.len())];
            mv = MoveSlot { mv: pick, flags: metronome_flags(d, pick), pp: 1, sig: false, from_metronome: true };
        }
        let m = self.mv(&mv); let fx = &m.fx;
        let is_status = m.cat == Cat::Status;
        if is_status && a.mimic_chest != 0.0 && self.r.next() < a.mimic_chest { return; }
        if self.mons[u].vol.charging.is_none() && !rampaging && !mv.from_metronome { self.mons[u].moves[slot].pp -= 1; }
        self.track(u, mv.mv).uses += 1.0;
        // streaks
        let v = &mut self.mons[u].vol;
        v.streak = if v.last_move == Some(mv.mv) { v.streak + 1 } else { 0 };
        if v.last_move != Some(mv.mv) { v.fury_n = 0; }
        if a.stylish { v.style_n = if v.last_move.is_some() && v.last_move != Some(mv.mv) { v.style_n + 1 } else { 0 }; }
        v.last_move = Some(mv.mv);
        if self.mons[u].item.and_then(|i| i.choice()).is_some() && !mv.from_metronome && self.mons[u].vol.choice.is_none() { self.mons[u].vol.choice = Some(mv.mv); }
        if m.cat == Cat::Energy { self.mons[u].vol.used_energy_turn = turn; }
        if a.protean && self.mons[u].vol.charging.is_none() { self.mons[u].types = vec![m.ty]; }
        // failure rules
        if fx.first_turn && self.mons[u].t.turns_in > 0 { return; }
        if fx.no_repeat && self.mons[u].vol.prev_move == Some(mv.mv) { self.mons[u].vol.prev_move = None; return; }
        self.mons[u].vol.prev_move = Some(mv.mv);
        if fx.nothing { return; }
        // two-turn moves
        if let Some(ch) = &fx.charge { if self.mons[u].vol.charging.is_none() {
            self.mons[u].vol.charging = Some(mv.mv);
            if ch.invuln { self.mons[u].vol.invuln = true; }
            if let Some(b) = &ch.boost { self.boost(u, b, Some(u), false); }
            return;
        } }
        if self.mons[u].vol.charging.is_some() { self.mons[u].vol.charging = None; self.mons[u].vol.invuln = false; }
        // rampage
        if let Some(rp) = fx.rampage {
            if self.mons[u].vol.rampage.is_none() { let left = self.r.int(rp[0], rp[1]) - 1; self.mons[u].vol.rampage = Some((mv.mv, left)); }
            else {
                let r = self.mons[u].vol.rampage.as_mut().unwrap(); r.1 -= 1;
                if r.1 <= 0 { self.mons[u].vol.rampage = None; if fx.self_confuse { self.confuse(u, Some(u)); } }
            }
        }
        // targets
        let targets = self.pick_targets(u, &mv, target_hint);
        if is_status { self.status_move(u, &mv, &targets); } else { self.attack(u, &mv, &targets); }
        // after the move
        if fx.charged { self.mons[u].vol.charged = true; } else if !is_status && m.ty == 5 { self.mons[u].vol.charged = false; }
        if !is_status && self.mons[u].vol.senkai { self.mons[u].vol.senkai = false; }
        if fx.lock_on.on() { self.mons[u].vol.lock_on = 2; if fx.lock_on.is("crit") { self.mons[u].vol.lock_crit_next = true; } }
        if let Some(am) = &a.after_move { if m.ty == am.r#type { self.boost(u, &am.stats, Some(u), false); } }
        if let Some((x, y, _)) = a.alt { let cur = self.mons[u].vol.alt_next; self.mons[u].vol.alt_next = if m.ty == x { Some(y) } else if m.ty == y { Some(x) } else { cur }; }
        if a.heavy_chip != 0.0 && m.size.as_deref() == Some("heavy") { let mh = self.mons[u].maxhp; self.hurt(u, mh * a.heavy_chip, None); }
        if fx.recharge != 0 && !self.mons[u].fainted { self.mons[u].vol.recharge = fx.recharge; }
        if fx.self_confuse && fx.rampage.is_none() { self.confuse(u, Some(u)); }
        if fx.self_chip != 0.0 { self.mons[u].vol.self_chip = fx.self_chip; }
        if fx.no_recoil { self.mons[u].once.no_recoil = true; }
        if !self.mons[u].fainted && (fx.switch_out || (a.explode_out && m.id == "explosion-megumin")) { self.pivot(u, fx.baton_pass); }
        if !self.mons[u].fainted && self.mons[u].vol.eject_now { self.mons[u].vol.eject_now = false; self.pivot(u, false); }
    }
    fn hurt_self_confused(&mut self, u: MonId) {
        let x = &self.mons[u];
        let d = (((((2.0 * x.level / 5.0 + 2.0).floor() * CONFUSE_POWER * x.raw[POW] * stage_mult(x.boosts[POW]) / (x.raw[GRD] * stage_mult(x.boosts[GRD])).max(1.0)).floor()) / 50.0).floor() + 2.0).max(1.0);
        self.hurt(u, d, None);
    }
    fn pivot(&mut self, u: MonId, baton: bool) {
        let s = self.mons[u].side;
        if self.bench_n(s) == 0 { return; }
        let slot = self.switch_out(u, baton, false);
        self.bring_in(s, slot, "pivot", false);
    }
    fn pick_targets(&mut self, u: MonId, mv: &MoveSlot, hint: Option<MonId>) -> Vec<MonId> {
        let m = self.mv(mv); let fx = &m.fx; let foes = self.foes_of(u);
        let bs = fx.boosts.as_deref().unwrap_or(&[]);
        let selfish = m.cat == Cat::Status && fx.status.is_none() && fx.encore == 0 && fx.taunt == 0 && !fx.force_switch && fx.trap == 0 && !fx.confuse_foes
            && fx.countdown.is_none() && !fx.pain_split && !fx.steal && fx.clear_foe_boosts.is_none() && fx.seed == 0.0 && !bs.iter().any(|b| b.who == "foe" || b.who == "foes")
            && fx.soak.is_none() && !fx.yawn;
        if selfish { return vec![u]; }
        let mut spread: Option<&str> = fx.spread.as_deref()
            .or(if self.ab_of(u).spread_type == Some(m.ty) { Some("foes") } else { None })
            .or(if fx.status.as_ref().and_then(|s| s.who.as_deref()) == Some("foes") { Some("foes") } else { None })
            .or(if bs.iter().any(|b| b.who == "foes") && m.cat == Cat::Status { Some("foes") } else { None });
        if fx.countdown.as_ref().map_or(false, |c| c.who == "foes") || fx.confuse_foes { spread = Some("foes"); }
        if spread == Some("all") { let mut v = foes.clone(); if let Some(al) = self.ally_of(u) { v.push(al); } return v; }
        if spread == Some("foes") { return foes; }
        // single target: a foe using Follow Me draws it
        let drawer = foes.iter().copied().find(|&f| self.mons[f].vol.follow_me != 0);
        let mut t = drawer.or(if hint.map_or(false, |h| foes.contains(&h)) { hint } else { foes.first().copied() });
        let lost = self.ab_of(u).lost;
        if lost != 0.0 && self.r.next() < lost { let mut all = foes.clone(); if let Some(al) = self.ally_of(u) { all.push(al); } let i = self.r.pick_i(all.len()); t = all.get(i).copied(); }
        match t { Some(t) => vec![t], None => vec![] }
    }

    // Accuracy, protection, dodges. Returns false when the move doesn't connect with t.
    fn connects(&mut self, u: MonId, mv: &MoveSlot, t: MonId, n_targets: usize) -> bool {
        let m = self.mv(mv); let fx = &m.fx; let ua = self.ab_of(u); let ta = self.def_ab(t, Some(u), Some(mv));
        if t == u { return true; }
        let prio = self.eff_priority(u, Some(mv)) > 0.0;
        let (us, ts) = (self.mons[u].side, self.mons[t].side);
        if let Some(pr) = self.mons[t].vol.protect.clone() { if !fx.breaks_protect && !(ua.heavy_bypass && (m.size.as_deref() == Some("heavy") || mv.sig)) && !(ua.sig_bypass && mv.sig) {
            if mv.flags.contact {
                if pr.contact_chip != 0.0 { let mh = self.mons[u].maxhp; self.hurt(u, mh * pr.contact_chip, Some(t)); }
                if pr.contact_pow != 0 { self.boost(u, &[(POW, pr.contact_pow)], Some(t), false); }
                let tab = self.ab_of(t);
                if tab.spiky_shield != 0.0 { let mh = self.mons[u].maxhp; self.hurt(u, mh * tab.spiky_shield, Some(t)); }
                if tab.royal_guard != 0.0 { let d = self.calc(u, t, mv, false, false, true, None, None); self.hurt(u, d * tab.royal_guard, Some(t)); }
            }
            return false;
        } }
        if prio && self.sides[ts].quick_guard == self.turn { return false; }
        if n_targets > 1 && ts != us && self.sides[ts].wide_guard == self.turn { return false; }
        if prio && self.field.as_ref().map_or(false, |f| f.fx.no_priority) && ts != us { return false; }
        if prio && ts != us && ta.blocks("priority") { return false; }
        if prio && ts != us && ta.priority_dodge_once && !self.mons[t].once.pdodge { self.mons[t].once.pdodge = true; return false; }
        if self.mons[t].vol.invuln && !ua.hits_invuln && !(ua.never_miss == Tag::On) { return false; }
        if let Some(dg) = &ta.dodge { if ts != us && (!dg.contact || mv.flags.contact) {
            let o = &mut self.mons[t].once;
            if dg.reset { if !o.dodge_entry { o.dodge_entry = true; return false; } } else if !o.dodge { o.dodge = true; return false; }
        } }
        if m.cat == Cat::Status && ta.status_dodge != 0.0 && ts != us && self.r.next() < ta.status_dodge { return false; }
        if m.cat == Cat::Status && ts != us && self.mons[t].vol.sub != 0.0 && !fx.breaks_sub && !ua.infiltrator && (fx.status.is_some() || fx.boosts.is_some()) { return false; }
        // accuracy
        let acc = match m.accuracy { None => return true, Some(a) => a };
        if fx.never_miss || self.mons[u].vol.lock_on > 0 || ua.never_miss == Tag::On || ua.never_miss.is(cat_str(m.cat)) || ua.never_miss.is(TYPES[m.ty as usize]) || (ua.never_miss.is("sound") && mv.flags.sound) { return true; }
        if ua.instant_domain && mv.flags.contact && !self.mons[u].once.domain { return true; }
        let mut p = acc / 100.0 * if ua.acc_mult != 0.0 { ua.acc_mult } else { 1.0 };
        if self.field.as_ref().map_or(false, |f| f.fx.gravity) { p *= 5.0 / 3.0; }
        if self.r.next() < p { return true; }
        self.track(u, mv.mv).misses += 1.0;
        if fx.miss_dmg != 0.0 { let mh = self.mons[u].maxhp; self.hurt(u, mh * fx.miss_dmg, None); }
        false
    }
    // Ability immunities (Flash Fire, Levitate...). True when the hit is absorbed.
    fn absorbs(&mut self, u: MonId, mv: &MoveSlot, t: MonId) -> bool {
        if t == u { return false; }
        let ta = self.def_ab(t, Some(u), Some(mv));
        let ty = self.move_type(u, mv, Some(t)); let m = self.mv(mv);
        for im in &ta.immune {
            if im.r#type == Some(ty) || im.cat == Some(m.cat) || im.flag.as_ref().map_or(false, |f| mv.flags.get(f)) {
                if im.heal != 0.0 { let mh = self.mons[t].maxhp; self.heal(t, mh * im.heal, false); }
                if let Some(b) = &im.boost { self.boost(t, b, Some(t), false); }
                if im.flash_fire { self.mons[t].vol.flash_fire = true; }
                return true;
            }
        }
        false
    }

    fn attack(&mut self, u: MonId, mv: &MoveSlot, targets: &[MonId]) {
        let m = self.mv(mv); let fx = &m.fx; let ua = self.ab_of(u);
        let turn = self.turn;
        if fx.sucker {
            let t = targets.first().copied();
            if t.map_or(true, |t| self.mons[t].vol.acted_turn == turn || !self.mons[t].vol.planned_attack) { return; }
        }
        if fx.clear_foe_boosts.as_deref() == Some("before") { for &t in targets { for k in 0..5 { if self.mons[t].boosts[k] > 0 { self.mons[t].boosts[k] = 0; } } } }
        if fx.breaks_screens { for &t in targets { let s = self.mons[t].side; self.sides[s].screens = Screens::default(); } }
        if fx.clear_field { self.field = None; }
        if fx.haze { for s in 0..2 { for x in self.actives(s) { self.mons[x].boosts = [0; 5]; } } }
        if let Some(dl) = &fx.delayed {
            if let Some(&t) = targets.first() { let s = self.mons[t].side; let slot = self.sides[s].active.iter().position(|a| *a == Some(t)).map_or(-1, |x| x as i32);
                self.sides[s].futures.push(Future { turn: turn + dl.turns, by: u, mv: *mv, slot, mult: 0.0 }); }
            return;
        }
        let spread = targets.len() > 1;
        let (mut total_dealt, mut any_hit) = (0.0, false);
        for &t in targets {
            if self.mons[t].fainted { continue; }
            if let Some(ct) = &fx.counter {
                let v = &self.mons[u].vol;
                let took = match ct.cat { Some(Cat::Physical) => v.took_phys, Some(Cat::Energy) => v.took_ene, _ => v.took_phys + v.took_ene };
                if took == 0.0 || v.took_turn != turn { return; }
                if !self.connects(u, mv, t, 1) { continue; }
                self.deal_damage(u, t, mv, (took * ct.mult).floor(), false, spread, true);
                any_hit = true; continue;
            }
            if !self.connects(u, mv, t, targets.len()) { continue; }
            if self.absorbs(u, mv, t) { continue; }
            let ty = self.move_type(u, mv, Some(t));
            let eff = self.effectiveness(u, mv, t, ty, true);
            if eff == 0.0 { continue; }
            // hit count
            let mut n = 1;
            if let Some(h) = fx.hits { n = if ua.skill_link { h[1] } else if h[0] == h[1] { h[0] } else { self.roll_hits(h) }; }
            let parental = ua.parental.as_ref().map_or(false, |p| if p.flag == "contact" { mv.flags.contact } else { mv.flags.get(&p.flag) }) && n == 1 && !spread;
            let (mut dealt, mut hits, mut crits) = (0.0, 0, 0);
            let total = if parental { 2 } else { n };
            let mut h = 0;
            while h < total && !self.mons[t].fainted && !self.mons[u].fainted {
                let cs = self.crit_stage(u, mv, t);
                let crit = cs >= 0 && self.r.next() < CRIT_CHANCE[cs.min(3) as usize];
                let mut d = self.calc(u, t, mv, crit, spread, false, Some(eff), None);
                if parental && h == 1 { d = (d * ua.parental.as_ref().unwrap().mult).floor().max(1.0); }
                if crit { crits += 1; }
                let res = self.deal_damage(u, t, mv, d, crit, spread, h == total - 1);
                dealt += res; hits += 1;
                if crit { if let Some(b) = &ua.crit_boost { self.boost(u, b, Some(u), false); } }
                if crit && ua.crit_splash != 0.0 { for f in self.foes_of(u) { let mh = self.mons[f].maxhp; self.hurt(f, mh * ua.crit_splash, Some(u)); } }
                if crit && self.ab_of(t).anger_point && !self.mons[t].fainted { self.mons[t].boosts[POW] = 6; }
                if fx.status.as_ref().map_or(false, |s| s.each) { self.secondary_status(u, t, mv, 1.0); }
                h += 1;
            }
            if hits == 0 { continue; }
            any_hit = true;
            total_dealt += dealt;
            { let tr = self.track(u, mv.mv); tr.hits += hits as f64; tr.dmg += dealt; tr.crits += crits as f64; if eff > 1.0 { tr.sup += 1.0; } }
            let te = self.mons[t].e;
            if ua.one_punch { let p = &mut self.mons[u].vol.punched; if !p.contains(&te) { p.push(te); } }
            { let p = &mut self.mons[u].vol.hit_keys; if !p.contains(&te) { p.push(te); } }
            self.mons[t].once.cryptid = true;
            if eff > 1.0 && self.def_ab(t, Some(u), Some(mv)).adaptive { self.mons[t].vol.adapted.push(ty); }
            if eff < 1.0 && ua.gloom { self.boost(u, &[(SPE, -1)], Some(u), false); }
            if self.mons[t].fainted { self.track(u, mv.mv).kos += 1.0; if fx.ko_heal != 0.0 { let mh = self.mons[u].maxhp; self.heal(u, mh * fx.ko_heal, false); } continue; }
            // secondary effects on the target (a Hooded Cloak blocks the chance-based ones)
            let cloak = matches!(self.mons[t].item, Some(i) if i.id == I_CLOAK);
            let grace = if cloak { 0.0 } else if ua.serene_grace == Tag::On || ua.serene_grace.is(TYPES[m.ty as usize]) { 2.0 } else { 1.0 };
            if fx.status.as_ref().map_or(false, |s| !s.each) { self.secondary_status(u, t, mv, grace); }
            if fx.flinch != 0.0 && self.mons[t].vol.acted_turn != turn && self.r.next() < fx.flinch * grace { self.mons[t].vol.flinch = true; }
            if fx.time_stop != 0.0 && self.r.next() < fx.time_stop * grace { self.mons[t].vol.lose_turn = true; }
            for b in fx.boosts.as_deref().unwrap_or(&[]) { if (b.who == "foe" || b.who == "foes") && !cloak && self.r.next() < b.p * if b.p < 1.0 { grace } else { 1.0 } { self.boost(t, &b.stats, Some(u), false); } }
            if fx.clear_foe_boosts.as_deref() == Some("after") { for k in 0..5 { if self.mons[t].boosts[k] > 0 { self.mons[t].boosts[k] = 0; } } }
            if fx.suppress != 0 { self.mons[t].vol.suppressed = fx.suppress; }
            if fx.trap != 0 && !self.blocks(t, "trap") { self.mons[t].vol.trapped = fx.trap; }
            if let Some(bd) = &fx.bind { if !self.blocks(t, "trap") { let left = self.r.int(bd.turns[0], bd.turns[1]); self.mons[t].vol.bind = Some(BindV { left, frac: bd.frac, by: u }); } }
            if fx.seed != 0.0 { self.mons[t].vol.seed = Some(SeedV { frac: fx.seed, by: u }); }
            if fx.slow_next { self.mons[t].vol.slow_turn = turn + 1; }
            let tside = self.mons[t].side;
            if fx.force_switch && !self.blocks(t, "forceOut") && self.bench_n(tside) > 0 { let slot = self.switch_out(t, false, false); self.bring_in(tside, slot, "forced", true); }
            if fx.echo != 0.0 { let slot = self.sides[tside].active.iter().position(|a| *a == Some(t)).map_or(-1, |x| x as i32); self.sides[tside].futures.push(Future { turn: turn + 1, by: u, mv: *mv, slot, mult: fx.echo }); }
            if let Some(sc) = &fx.side_chip { let fs = 1 - self.mons[u].side; self.sides[fs].chip = Some(Chip { frac: sc.frac, turns: sc.turns, by: u }); }
            for dh in &ua.deal_hit {
                if dh.contact && !mv.flags.contact { continue; }
                if let Some(c) = dh.cat { if c != m.cat { continue; } }
                if dh.p != 0.0 && self.r.next() >= dh.p { continue; }
                if let Some(s) = &dh.status { self.inflict(t, s, Some(u), Some(mv), None, false); }
                if dh.suppress != 0 { self.mons[t].vol.suppressed = dh.suppress; }
                if dh.decay != 0.0 { self.mons[t].vol.decay = dh.decay; }
                if dh.trap != 0 && !self.blocks(t, "trap") { self.mons[t].vol.trapped = dh.trap; }
            }
            if ua.cat_burglar { if let Some(k) = (0..5).find(|&x| self.mons[t].boosts[x] > 0) { self.mons[t].boosts[k] -= 1; self.boost(u, &[(k, 1)], Some(u), false); } }
            if ua.transform_on_hit && mv.flags.contact && !self.mons[u].vol.transformed { self.transform(u, t, ua.transform_ability); }
            if self.def_ab(t, Some(u), Some(mv)).eject_super && eff > 1.0 && self.bench_n(tside) > 0 && !self.mons[t].fainted { let slot = self.switch_out(t, false, false); self.bring_in(tside, slot, "eject", false); }
            if self.mons[t].vol.eject_now && !self.mons[t].fainted { self.mons[t].vol.eject_now = false; let slot = self.switch_out(t, false, false); self.bring_in(tside, slot, "eject", false); }
        }
        if fx.power.as_deref() == Some("fury") { self.mons[u].vol.fury_n = if any_hit { self.mons[u].vol.fury_n + 1 } else { 0 }; }
        if ua.instant_domain && mv.flags.contact { self.mons[u].once.domain = true; }
        if m.cat == Cat::Energy && ua.atk.iter().any(|w| w.first_once.is_some()) { self.mons[u].once.concealed = true; }
        if self.mons[u].vol.lock_on > 0 { self.mons[u].vol.lock_on = 0; self.mons[u].vol.lock_crit = false; }
        if self.mons[u].vol.lock_crit_next { let v = &mut self.mons[u].vol; v.lock_crit = true; v.lock_crit_next = false; v.lock_on = 1; }
        if !any_hit { return; }
        // effects on the user
        if fx.drain != 0.0 || ua.drain.is_some() {
            let mut f = fx.drain;
            if let Some(dr) = &ua.drain { if dr.r#type.map_or(true, |x| x == m.ty) && (!dr.contact || mv.flags.contact) { f += dr.frac; } }
            if f != 0.0 { self.heal(u, total_dealt * f, false); }
        }
        if fx.recoil != 0.0 && !self.mons[u].once.no_recoil { self.hurt(u, total_dealt * fx.recoil, None); }
        if matches!(self.mons[u].item, Some(i) if i.id == I_OVERDRIVE) && !self.mons[u].fainted { let mh = self.mons[u].maxhp; self.hurt(u, mh * LIFE_ORB_COST, None); }
        if ua.deal_recoil != 0.0 && m.cat == Cat::Energy { self.hurt(u, total_dealt * ua.deal_recoil, None); }
        if fx.self_dmg != 0.0 && !self.mons[u].fainted { let mh = self.mons[u].maxhp; self.hurt(u, mh * fx.self_dmg, None); }
        for b in fx.boosts.as_deref().unwrap_or(&[]) { if (b.who == "self" || b.who == "team") && self.r.next() < b.p {
            if b.who == "team" { for x in self.actives(self.mons[u].side) { self.boost(x, &b.stats, Some(u), false); } } else { self.boost(u, &b.stats, Some(u), false); }
        } }
        for b in fx.boosts.as_deref().unwrap_or(&[]) { if b.who == "incoming" { let s = self.mons[u].side; self.sides[s].gift = Some(Gift { heal: 0.0, stats: Some(b.stats.clone()) }); } }
        if let Some(f) = &fx.field { self.set_field(f, u); }
        if fx.clear_hazards.as_deref() == Some("foe") { let fs = 1 - self.mons[u].side; self.sides[fs].hazards = Hazards::default(); self.sides[fs].screens = Screens::default(); }
        if fx.clear_hazards.as_deref() == Some("own") { let s = self.mons[u].side; self.sides[s].hazards = Hazards::default(); }
    }
    fn roll_hits(&mut self, h: [i32; 2]) -> i32 {
        if h[0] == 2 && h[1] == 5 { let x = self.r.next(); return if x < 0.35 { 2 } else if x < 0.7 { 3 } else if x < 0.85 { 4 } else { 5 }; }
        self.r.int(h[0], h[1])
    }
    fn secondary_status(&mut self, u: MonId, t: MonId, mv: &MoveSlot, grace: f64) {
        let m = self.mv(mv);
        let s = match &m.fx.status { Some(s) => s, None => return };
        if self.mons[t].fainted || matches!(self.mons[t].item, Some(i) if i.id == I_CLOAK) { return; }
        if self.r.next() < (1.0f64).min(s.p * if s.p < 1.0 { grace } else { 1.0 }) { self.inflict(t, &s.kind, Some(u), Some(mv), s.turns, m.fx.wake_confuse); }
    }

    // Applies one hit: decoy, disguise, Endure/Sturdy, then the damage and every on-hit reaction.
    fn deal_damage(&mut self, u: MonId, t: MonId, mv: &MoveSlot, d0: f64, _crit: bool, _spread: bool, _last: bool) -> f64 {
        let m = self.mv(mv);
        let ta = self.def_ab(t, Some(u), Some(mv));
        let mut d = d0;
        let turn = self.turn;
        if self.mons[t].vol.sub != 0.0 && t != u && !m.fx.breaks_sub && !self.ab_of(u).infiltrator && !(self.ab_of(u).sig_bypass && mv.sig) && !mv.flags.sound {
            let x = self.mons[t].vol.sub.min(d);
            self.mons[t].vol.sub -= x;
            if self.mons[t].vol.sub <= 0.0 { self.mons[t].vol.sub = 0.0; }
            return 0.0;
        }
        match ta.disguise.as_deref() {
            Some("once") if !self.mons[t].once.disguise => { self.mons[t].once.disguise = true; return 0.0; }
            Some("entry") if !self.mons[t].once.disguise_entry => { self.mons[t].once.disguise_entry = true; return 0.0; }
            _ => {}
        }
        if ta.multiscale.on() { self.mons[t].once.multiscale = true; }
        let full = self.mons[t].hp == self.mons[t].maxhp;
        if d >= self.mons[t].hp {
            if ta.disguise.as_deref() == Some("koOnce") && !self.mons[t].once.contract { self.mons[t].once.contract = true; return 0.0; }
            if self.mons[t].vol.endure == turn { d = self.mons[t].hp - 1.0; }
            else if ta.sturdy && full { d = self.mons[t].hp - 1.0; if let Some(b) = &ta.sturdy_boost { self.boost(t, b, Some(t), false); } }
            else if ta.survive_once && !self.mons[t].once.survived { self.mons[t].once.survived = true; d = self.mons[t].hp - 1.0; if ta.survive_switch { self.mons[t].vol.eject_now = true; } }
            else if full && self.held(t, I_LAST_THREAD) { d = self.mons[t].hp - 1.0; self.use_item(t); }
        }
        d = d.min(self.mons[t].hp).max(0.0);
        if d == self.mons[t].hp && full { self.mons[t].vol.one_hit = true; }
        self.mons[t].hp -= d;
        self.mons[u].t.dmg += d; self.mons[t].t.taken += d;
        // what Counter-style moves hit back with this turn
        { let v = &mut self.mons[t].vol; if v.took_turn != turn { v.took_phys = 0.0; v.took_ene = 0.0; v.took_turn = turn; }
          if m.cat == Cat::Physical { v.took_phys += d; } else { v.took_ene += d; } }
        self.mons[t].once.hit_taken = true;
        { let ta2 = self.ab_of(t); if ta2.slow_start { if let Some(b) = &ta2.slow_start_boost { if !self.mons[t].once.bullet { self.mons[t].once.bullet = true; self.boost(t, b, Some(t), false); } } } }
        if self.mons[t].status == Some(St::Freeze) && m.ty == 0 && self.mons[t].hp > 0.0 { self.mons[t].status = None; }
        if self.mons[t].hp <= 0.0 { self.faint(t, Some(u)); if !self.mons[t].fainted { return d; } }
        else { self.after_hp(t, Some(u)); }
        // reactions to being hit
        if u != t && self.mons[t].side != self.mons[u].side {
            let ty = m.ty;
            for h in &ta.hit_by {
                if h.contact && !mv.flags.contact { continue; }
                if let Some(c) = h.cat { if c != m.cat { continue; } }
                if let Some(ts) = &h.types { if !ts.contains(&ty) { continue; } }
                if h.super_eff && !(self.effectiveness(u, mv, t, ty, false) > 1.0) { continue; }
                if let Some(at) = h.attacker_type { if !self.mons[u].types.contains(&at) { continue; } }
                if let Some(p) = h.p { if p < 1.0 && self.r.next() >= p { continue; } }
                if h.self_ { if !self.mons[t].fainted { self.boost(t, h.stats.as_deref().unwrap_or(&[]), Some(t), false); } continue; }
                if let Some(s) = &h.status { self.inflict(u, s, Some(t), None, None, false); }
                if h.chip != 0.0 { let mh = self.mons[u].maxhp; self.hurt(u, mh * h.chip, Some(t)); }
                if let Some(st) = &h.stats { self.boost(u, st, Some(t), false); }
            }
            if let Some(b) = &ta.bounce { if m.cat == b.cat && self.r.next() < b.p { self.hurt(u, d * b.frac, Some(t)); } }
            if matches!(self.mons[t].item, Some(i) if i.id == I_ARMOR) && mv.flags.contact && !self.mons[u].fainted { let mh = self.mons[u].maxhp; self.hurt(u, mh * HELMET, Some(t)); }
            if !self.mons[t].fainted && self.held(t, I_POLICY) && self.effectiveness(u, mv, t, ty, false) > 1.0 { self.use_item(t); self.boost(t, &[(POW, POLICY), (ENE, POLICY)], Some(t), false); }
            if !self.mons[t].fainted && self.held(t, I_SCROLL) && self.bench_n(self.mons[t].side) > 0 { self.use_item(t); self.mons[t].vol.eject_now = true; }
        }
        d
    }

    fn status_move(&mut self, u: MonId, mv: &MoveSlot, targets: &[MonId]) {
        let m = self.mv(mv); let fx = &m.fx; let ua = self.ab_of(u);
        let turn = self.turn; let us = self.mons[u].side;
        if fx.duos_only && !self.duos { return; }
        if let Some(pr) = &fx.protect {
            let chain = self.mons[u].vol.protect_chain;
            if chain > 0 && !pr.repeat && !ua.protect_always && self.r.next() >= 1.0 / crate::jsmath::pow(3.0, chain as f64) { self.mons[u].vol.protect_chain = 0; return; }
            let v = &mut self.mons[u].vol; v.protect = Some(pr.clone()); v.protect_turn = turn; v.protect_chain = chain + 1;
            if fx.heal != 0.0 { let mh = self.mons[u].maxhp; self.heal(u, mh * fx.heal, true); }
            return;
        }
        if fx.endure {
            let chain = self.mons[u].vol.protect_chain;
            if chain > 0 && self.r.next() >= 1.0 / crate::jsmath::pow(3.0, chain as f64) { self.mons[u].vol.protect_chain = 0; return; }
            self.mons[u].vol.endure = turn; self.mons[u].vol.protect_chain = chain + 1; return;
        }
        if fx.quick_guard { self.sides[us].quick_guard = turn; return; }
        if fx.wide_guard { self.sides[us].wide_guard = turn; return; }
        if fx.follow_me { self.mons[u].vol.follow_me = turn; }
        if fx.helping_hand { if let Some(al) = self.ally_of(u) { self.mons[al].vol.helped = true; } }
        if fx.substitute != 0.0 {
            if self.mons[u].vol.sub != 0.0 || self.mons[u].hp <= self.mons[u].maxhp * fx.substitute { return; }
            let mh = self.mons[u].maxhp; self.hurt(u, mh * fx.substitute, None); self.mons[u].vol.sub = (mh * fx.substitute).floor();
        }
        if fx.self_dmg != 0.0 {
            if self.mons[u].hp <= self.mons[u].maxhp * fx.self_dmg { return; }
            let mh = self.mons[u].maxhp; self.hurt(u, mh * fx.self_dmg, None);
        }
        // heals
        if fx.heal != 0.0 || fx.cure.on() {
            let who: Vec<MonId> = match fx.heal_who.as_deref() { Some("team") => self.actives(us), Some("ally") => vec![self.ally_of(u).unwrap_or(u)], _ => vec![u] };
            for x in who {
                if fx.heal != 0.0 { let mh = self.mons[x].maxhp; self.heal(x, mh * fx.heal, true); }
                if fx.cure.is("team") { for y in self.alive(us) { self.mons[y].status = None; } } else if fx.cure.on() { self.mons[x].status = None; }
                if ua.deadly_cooking && x != u { self.inflict(x, "bleed", Some(u), None, None, false); }
            }
            if fx.rest_sleep { self.mons[u].status = Some(St::Sleep); self.mons[u].status_turns = 3; }
            if let Some(b) = &ua.heal_boost { self.boost(u, b, Some(u), false); }
            if ua.senkaimaru && fx.heal != 0.0 { self.mons[u].vol.senkai = true; }
        }
        if fx.wish != 0.0 { self.sides[us].wish = Some((turn + 1, self.mons[u].maxhp * fx.wish)); }
        if fx.aqua_ring { self.mons[u].vol.aqua_ring = true; }
        if fx.revive != 0.0 {
            if let Some(&down) = self.sides[us].mons.iter().find(|&&x| self.mons[x].fainted && !self.mons[x].once.revived_by_move) {
                let x = &mut self.mons[down]; x.fainted = false; x.hp = (x.maxhp * fx.revive).floor(); x.once.revived_by_move = true;
            }
        }
        if let Some(sc) = &fx.screen { let v = if matches!(self.mons[u].item, Some(i) if i.id == I_ANCHOR) { ANCHOR_TURNS } else { 5 }; self.sides[us].screens.set(sc, v); }
        if fx.tailwind != 0 { self.sides[us].tailwind = fx.tailwind + ua.long_tailwind; }
        if let Some(hz) = &fx.hazard {
            let h = &mut self.sides[1 - us].hazards;
            match hz.as_str() { "spikes" => h.spikes = (h.spikes + 1).min(3), "rocks" => h.rocks = 1, "web" => h.web = 1, "rainbow" => h.rainbow = 1, _ => {} }
        }
        if fx.clear_hazards.as_deref() == Some("both") { for s in 0..2 { self.sides[s].hazards = Hazards::default(); self.sides[s].screens = Screens::default(); } }
        if fx.clear_hazards.as_deref() == Some("own") { self.sides[us].hazards = Hazards::default(); }
        if fx.haze { for s in 0..2 { for x in self.actives(s) { self.mons[x].boosts = [0; 5]; } } }
        if fx.clear_field { self.field = None; }
        if let Some(f) = &fx.field { self.set_field(f, u); }
        if fx.extra_turn { self.mons[u].vol.extra_turn = turn + 1; }
        if fx.charged { self.mons[u].vol.charged = true; }
        // self and team boosts
        for b in fx.boosts.as_deref().unwrap_or(&[]) {
            match b.who.as_str() {
                "self" => { self.boost(u, &b.stats, Some(u), false); }
                "team" => for x in self.actives(us) { if x == u || !self.ab_of(x).loner { self.boost(x, &b.stats, Some(u), false); } },
                "ally" => { let al = self.ally_of(u).unwrap_or(u); if !self.ab_of(al).loner { self.boost(al, &b.stats, Some(u), false); } }
                "incoming" => self.sides[us].gift = Some(Gift { heal: 0.0, stats: Some(b.stats.clone()) }),
                _ => {}
            }
        }
        // moves aimed at foes
        for &t in targets {
            if t == u || self.mons[t].side == us { continue; }
            if !self.connects(u, mv, t, 1) { continue; }
            let ta = self.def_ab(t, Some(u), Some(mv));
            if let Some(st) = &fx.status { if self.r.next() < st.p {
                if mv.flags.sound && ta.immune.iter().any(|x| x.flag.as_deref() == Some("sound")) { continue; }
                if st.kind == "stun" && ta.immune.iter().any(|x| x.r#type == Some(5)) { continue; }
                self.inflict(t, &st.kind, Some(u), Some(mv), st.turns, fx.wake_confuse);
            } }
            if fx.confuse_foes { self.confuse(t, Some(u)); }
            for b in fx.boosts.as_deref().unwrap_or(&[]) { if b.who == "foe" || b.who == "foes" {
                let pw = b.stats.iter().find(|x| x.0 == POW).map(|x| x.1);
                if pw.map_or(false, |p| p < 0) && m.id == "charm" && ta.blocks("charm") { continue; }
                self.boost(t, &b.stats, Some(u), false);
            } }
            if fx.encore != 0 { if let Some(lm) = self.mons[t].vol.last_move { if !ta.blocks("encore") { self.mons[t].vol.encore = Some((fx.encore, lm)); } } }
            if fx.taunt != 0 && !ta.blocks("taunt") { self.mons[t].vol.taunt = fx.taunt; }
            if fx.trap != 0 && !ta.blocks("trap") { self.mons[t].vol.trapped = fx.trap; }
            let ts = self.mons[t].side;
            if fx.force_switch && !ta.blocks("forceOut") && self.bench_n(ts) > 0 { let slot = self.switch_out(t, false, false); self.bring_in(ts, slot, "forced", true); }
            if fx.yawn && self.mons[t].status.is_none() { self.mons[t].vol.yawn = turn + 1; }
            if fx.pain_split { let avg = ((self.mons[u].hp + self.mons[t].hp) / 2.0).floor(); self.mons[u].hp = self.mons[u].maxhp.min(avg); self.mons[t].hp = self.mons[t].maxhp.min(avg); self.after_hp(t, Some(u)); }
            if fx.steal { for k in 0..5 { if self.mons[t].boosts[k] > 0 { self.mons[u].boosts[k] = (self.mons[u].boosts[k] + self.mons[t].boosts[k]).min(6); self.mons[t].boosts[k] = 0; } } }
            if fx.clear_foe_boosts.is_some() { for k in 0..5 { if self.mons[t].boosts[k] > 0 { self.mons[t].boosts[k] = 0; } } }
            if fx.seed != 0.0 { self.mons[t].vol.seed = Some(SeedV { frac: fx.seed, by: u }); }
            if let Some(s) = fx.soak { self.mons[t].types = vec![s]; }
            if let Some(c) = &fx.countdown { if !ta.blocks("countdown") && !(m.id == "death-note" && self.d.entrants[self.mons[t].e].gag) { self.mons[t].vol.countdown = turn + c.turns; } }
        }
        if fx.destiny_bond { self.mons[u].vol.destiny_bond = true; }
    }

    // ---- turn order ----
    pub fn eff_priority(&self, m: MonId, mv: Option<&MoveSlot>) -> f64 {
        let mv = match mv { Some(x) => x, None => return 0.0 };
        let a = self.ab_of(m); let mm = self.mv(mv);
        let mut p = mm.priority;
        if a.prankster && mm.cat == Cat::Status { p += 1.0; }
        if a.quick_draw.on() && !self.mons[m].once.quick_drawn && (a.quick_draw == Tag::On || a.quick_draw.is(cat_str(mm.cat))) { p += 0.5; }
        if a.pivot_priority && mm.fx.switch_out { p += 1.0; }
        if a.go_last { p -= 0.5; }
        p
    }

    // ---- end of turn ----
    fn end_turn(&mut self) {
        let turn = self.turn;
        for s in 0..2 {
            // delayed hits
            let fut = std::mem::take(&mut self.sides[s].futures);
            let mut keep = vec![];
            for f in fut {
                if f.turn != turn { keep.push(f); continue; }
                let t = if f.slot >= 0 { self.sides[s].active.get(f.slot as usize).copied().flatten() } else { None }.or_else(|| self.actives(s).first().copied());
                if let Some(t) = t { if !self.mons[t].fainted && !self.blocks(t, "delayed") {
                    let d = self.calc(f.by, t, &f.mv, false, false, false, None, None) * if f.mult != 0.0 { f.mult } else { 1.0 };
                    self.deal_damage(f.by, t, &f.mv, d.floor(), false, false, true);
                    self.track(f.by, f.mv.mv).dmg += d.floor();
                } }
            }
            // keep futures pushed while landing these (none can be: a delayed hit doesn't make new ones), then the rest
            let mut added = std::mem::take(&mut self.sides[s].futures);
            keep.append(&mut added);
            self.sides[s].futures = keep;
            if let Some((wt, amt)) = self.sides[s].wish { if wt == turn { for m in self.actives(s) { self.heal(m, amt, false); } self.sides[s].wish = None; } }
        }
        if let Some(f) = &self.field { if f.fx.side_heal != 0.0 { let (o, sh) = (f.owner, f.fx.side_heal); for m in self.actives(o) { let mh = self.mons[m].maxhp; self.heal(m, mh * sh, false); } } }
        for s in 0..2 {
            if let Some(c) = self.sides[s].chip.clone() {
                for m in self.actives(s) { let mh = self.mons[m].maxhp; self.hurt(m, mh * c.frac, Some(c.by)); }
                let ch = self.sides[s].chip.as_mut().unwrap(); ch.turns -= 1; if ch.turns <= 0 { self.sides[s].chip = None; }
            }
            if let Some(fd) = self.sides[1 - s].drain.clone() { if !self.mons[fd.by].fainted {
                let mut got = 0.0;
                for m in self.actives(s) { let before = self.mons[m].hp; let mh = self.mons[m].maxhp; self.hurt(m, mh * fd.frac, Some(fd.by)); got += before - self.mons[m].hp; }
                self.heal(fd.by, got, false);
            } }
        }
        for s in 0..2 { if let Some(dr) = self.sides[s].drain.as_mut() { dr.turns -= 1; if dr.turns <= 0 { self.sides[s].drain = None; } } }
        let mut all = self.actives(0); all.extend(self.actives(1));
        for m in all {
            if self.mons[m].fainted { continue; }
            let a = self.ab_of(m);
            self.mons[m].t.turns_in += 1; self.mons[m].t.turns += 1.0;
            let mh = self.mons[m].maxhp;
            if self.field.as_ref().map_or(false, |f| f.fx.snow) && !self.mons[m].types.contains(&2) { self.hurt(m, mh / 16.0, None); }
            if let Some(b) = self.mons[m].vol.bind { self.hurt(m, mh * b.frac, Some(b.by)); if let Some(bb) = self.mons[m].vol.bind.as_mut() { bb.left -= 1; if bb.left <= 0 { self.mons[m].vol.bind = None; } } }
            if let Some(sd) = self.mons[m].vol.seed { if !self.mons[m].fainted { let before = self.mons[m].hp; self.hurt(m, mh * sd.frac, Some(sd.by)); if !self.mons[sd.by].fainted { let g = before - self.mons[m].hp; self.heal(sd.by, g, false); } } }
            if self.mons[m].vol.decay != 0.0 && !self.mons[m].fainted { let dc = self.mons[m].vol.decay; self.hurt(m, mh * dc, None); }
            if self.mons[m].fainted { continue; }
            if self.mons[m].status == Some(St::Burn) { self.hurt(m, mh * BURN_CHIP, None); }
            if self.mons[m].status == Some(St::Bleed) {
                self.mons[m].bleed_n += 1;
                if a.poison_heal != 0.0 { self.heal(m, mh * a.poison_heal, false); } else { let n = self.mons[m].bleed_n as f64; self.hurt(m, mh * BLEED_STEP * n, None); }
            }
            if self.mons[m].fainted { continue; }
            if self.mons[m].vol.aqua_ring { self.heal(m, mh / 16.0, false); }
            if matches!(self.mons[m].item, Some(i) if i.id == I_BENTO) { self.heal(m, mh * LEFTOVERS, false); }
            for op in &a.end_turn {
                match op.op.as_str() {
                    "heal" => if op.low_hp.map_or(true, |l| l == 0.0 || self.pct(m) < l) && (!op.asleep || self.mons[m].status == Some(St::Sleep)) { self.heal(m, mh * op.frac, false); },
                    "boost" => if !op.if_no_attack || self.mons[m].vol.last_attack_turn != turn { self.boost(m, op.stats.as_deref().unwrap_or(&[]), Some(m), false); },
                    "chip" => self.hurt(m, mh * op.frac, None),
                    "every3" => if self.mons[m].t.turns_in % 3 == 0 { self.boost(m, op.stats.as_deref().unwrap_or(&[]), Some(m), false); },
                    "moody" => { let up = self.r.pick_i(5); let rest: Vec<usize> = (0..5).filter(|&k| k != up).collect(); let dn = rest[self.r.pick_i(4)]; self.boost(m, &[(up, 2), (dn, -1)], Some(m), false); }
                    "drunk" => if self.r.next() < op.p { self.confuse(m, Some(m)); self.boost(m, &[(POW, 1)], Some(m), false); },
                    "poke" => { let fs = self.foes_of(m); if !fs.is_empty() { let f = fs[self.r.pick_i(fs.len())]; let fh = self.mons[f].maxhp; self.hurt(f, fh * op.frac, Some(m)); } else { self.r.pick_i(0); } }
                    "badDreams" => for f in self.foes_of(m) { if self.mons[f].status == Some(St::Sleep) { let fh = self.mons[f].maxhp; self.hurt(f, fh * op.frac, Some(m)); } },
                    _ => {}
                }
            }
            if let Some(tm) = &a.timed { if self.mons[m].t.turns_in == tm.turn { self.boost(m, &tm.stats, Some(m), false); } }
            if self.mons[m].vol.self_chip != 0.0 { let c = self.mons[m].vol.self_chip; self.hurt(m, mh * c, None); }
            if self.mons[m].vol.kakuja { self.hurt(m, mh / 16.0, None); }
            if self.duos && a.atk.iter().any(|w| w.duos) { if let Some(al) = self.ally_of(m) { let ah = self.mons[al].maxhp; self.hurt(al, ah / 16.0, None); } }
            if self.duos && a.healer != 0.0 { if let Some(al) = self.ally_of(m) { if self.mons[al].status.is_some() && self.r.next() < a.healer { self.mons[al].status = None; } } }
            if self.mons[m].fainted { continue; }
            if self.mons[m].vol.countdown == turn { self.mons[m].hp = 0.0; let f = self.foes_of(m).first().copied(); self.faint(m, f); continue; }
            if self.mons[m].vol.yawn == turn { self.mons[m].vol.yawn = 0; self.inflict(m, "sleep", None, None, None, false); }
            // timers
            let v = &mut self.mons[m].vol;
            if v.trapped > 0 { v.trapped -= 1; }
            if v.taunt > 0 { v.taunt -= 1; }
            if let Some(e) = v.encore.as_mut() { e.0 -= 1; if e.0 <= 0 { v.encore = None; } }
            if v.suppressed > 0 { v.suppressed -= 1; }
            if v.lock_on > 0 { v.lock_on -= 1; }
            v.protect = None; v.follow_me = 0; v.helped = false;
            if v.protect_turn != turn { v.protect_chain = 0; }
            if v.acted_turn == turn { self.mons[m].once.quick_drawn = true; }
        }
        for s in 0..2 {
            let sc = &mut self.sides[s].screens;
            for x in [&mut sc.reflect, &mut sc.light, &mut sc.veil] { if *x != 0 { *x -= 1; } }
            if self.sides[s].tailwind > 0 { self.sides[s].tailwind -= 1; }
        }
        if let Some(f) = self.field.as_mut() { f.fx.turns -= 1; if f.fx.turns <= 0 { self.field = None; } }
    }
}

pub fn cat_str(c: Cat) -> &'static str { match c { Cat::Physical => "Physical", Cat::Energy => "Energy", Cat::Status => "Status" } }
fn metronome_flags(d: &Data, mv: usize) -> Flags { d.moves[mv].flags }

fn make_mon(d: &Data, b: &Build, level: f64, side: usize) -> Mon {
    let e = &d.entrants[b.e];
    let st = e.stats.as_ref().unwrap();
    let ev = b.evs.unwrap_or([0.0; 6]); let iv = b.ivs.unwrap_or([IV; 6]);
    let nat = b.nature.unwrap_or_default();
    let mut raw = [0.0; 5];
    for k in 0..5 { raw[k] = battle_stat(st.get(k), level, false, ev[k + 1], iv[k + 1], nat.mult(k)); }
    let maxhp = battle_stat(st.vit, level, true, ev[0], iv[0], 1.0);
    Mon {
        e: b.e, side, level, types: e.types.clone(), maxhp, hp: maxhp, raw, item: b.item, item_used: false,
        ability: b.ability, base_ability: b.ability,
        moves: b.moves.iter().map(|&(id, flags)| { let m = &d.moves[id]; MoveSlot { mv: id, flags, pp: m.pp, sig: m.signature, from_metronome: false } }).collect(),
        status: None, status_turns: 0, bleed_n: 0, boosts: [0; 5], vol: Vol::default(), once: Once::default(), pending: None, fainted: false,
        t: Track { turns_in: NONE, ..Track::default() }, once_done: vec![],
    }
}

pub fn run_battle<'a>(d: &'a Data, teams: [&[Build]; 2], r: Rng, o: &BattleOpts) -> Battle<'a> { run_battle_with(d, teams, r, o, None) }
pub fn run_battle_with<'a>(d: &'a Data, teams: [&[Build]; 2], r: Rng, o: &BattleOpts, decide: Option<Decide<'a>>) -> Battle<'a> {
    let mut mons = vec![];
    let mut sides: Vec<Side> = vec![];
    for (i, team) in teams.iter().enumerate() {
        let ids: Vec<MonId> = team.iter().map(|b| { mons.push(make_mon(d, b, o.level, i)); mons.len() - 1 }).collect();
        sides.push(Side { i, mons: ids, active: vec![], hazards: Hazards::default(), screens: Screens::default(), tailwind: 0, wish: None, chip: None, drain: None,
            futures: vec![], faint_turn: -9, time_stop: -1, gift: None, plan: o.plans[i], baton: None, quick_guard: NONE, wide_guard: NONE, joint_plan: None });
    }
    let s1 = sides.pop().unwrap(); let s0 = sides.pop().unwrap();
    let mut b = Battle { d, r, duos: o.duos, turn: 0, field: None, over: false, winner: -1, sides: [s0, s1], mons, cache: None, turn_cap: o.turn_cap, w: &ai::W, decide };
    let slots = if o.duos { 2 } else { 1 };
    for s in 0..2 {
        b.sides[s].active = vec![None; slots];
        for k in 0..slots { if let Some(&m) = b.sides[s].mons.get(k) { b.sides[s].active[k] = Some(m); let x = &mut b.mons[m]; x.vol = Vol { entry_turn: 0, ..Vol::default() }; x.t.entries += 1.0; x.t.turns_in = 0; } }
    }
    // Entry abilities of the leads, faster first.
    let mut leads = b.actives(0); leads.extend(b.actives(1));
    let spd: Vec<f64> = leads.iter().map(|&m| b.speed(m, false)).collect();
    let mut order: Vec<usize> = (0..leads.len()).collect();
    order.sort_by(|&x, &y| js_cmp(spd[y] - spd[x]));
    for i in order { b.entry_ability(leads[i]); }

    let n_cache = b.mons.len() * 8 * b.mons.len();
    while !b.over {
        b.turn += 1;
        if b.turn > b.turn_cap { b.over = true; b.winner = -1; break; }
        for s in 0..2 { for m in b.actives(s) { if b.held(m, I_INCENSE) && (b.mons[m].vol.taunt > 0 || b.mons[m].vol.encore.is_some()) {
            b.use_item(m); b.mons[m].vol.taunt = 0; b.mons[m].vol.encore = None;
        } } }
        b.cache = Some(vec![f64::NAN; n_cache]);
        let mut acts: Vec<(MonId, Act, f64, f64, f64)> = vec![]; // mon, act, pri, spd, tie
        for s in 0..2 { for m in b.actives(s) {
            let act = b.action(m, false);
            if let Act::Move { slot, .. } = act { b.mons[m].vol.planned_attack = b.mons[m].moves.get(slot).map_or(true, |x| d.moves[x.mv].cat != Cat::Status); }
            acts.push((m, act, 0.0, 0.0, 0.0));
        } }
        b.cache = None;
        for a in acts.iter_mut() {
            let m = a.0;
            a.2 = match a.1 { Act::Switch { .. } => 10.0, Act::Move { slot, .. } => { let ms = b.mons[m].moves.get(slot).copied(); b.eff_priority(m, ms.as_ref()) } };
            let tl = b.foes_of(m).iter().any(|&f| b.ab_of(f).target_lock);
            a.3 = b.speed(m, tl); a.4 = b.r.next();
            if b.mons[m].vol.slow_turn == b.turn { a.2 -= 9.0; }
        }
        let tr = if b.field.as_ref().map_or(false, |f| f.fx.trick_room) { -1.0 } else { 1.0 };
        acts.sort_by(|x, y| { let p = y.2 - x.2; if p != 0.0 { return js_cmp(p); } let s = tr * (y.3 - x.3); if s != 0.0 { return js_cmp(s); } js_cmp(y.4 - x.4) });
        for &(m, act, _, _, _) in &acts {
            if b.mons[m].fainted || !b.is_active(m) { continue; }
            match act {
                Act::Switch { to } => {
                    if b.mons[to].fainted || b.is_active(to) { continue; }
                    let slot = b.switch_out(m, false, false);
                    b.switch_in(to, slot, "switch");
                    continue;
                }
                Act::Move { slot, target } => {
                    let target = target.filter(|&t| !b.mons[t].fainted);
                    b.use_move(m, slot, target);
                    b.mons[m].vol.moved_turn = b.turn;
                    if b.mons[m].moves.get(slot).map_or(true, |x| d.moves[x.mv].cat != Cat::Status) { b.mons[m].vol.last_attack_turn = b.turn; }
                    if b.mons[m].vol.extra_turn == b.turn && !b.mons[m].fainted && b.is_active(m) {
                        b.mons[m].vol.extra_turn = 0;
                        let again = b.action(m, true);
                        if let Act::Move { slot, target } = again { b.use_move(m, slot, target); }
                    }
                }
            }
            if b.alive_n(0) == 0 || b.alive_n(1) == 0 { break; }
        }
        b.end_turn();
        let left = [b.alive_n(0), b.alive_n(1)];
        if left[0] == 0 || left[1] == 0 { b.over = true; b.winner = if left[0] > 0 { 0 } else if left[1] > 0 { 1 } else { -1 }; break; }
        // replace knocked-out characters
        for s in 0..2 { for k in 0..slots {
            let m = b.sides[s].active[k];
            if m.map_or(true, |m| b.mons[m].fainted) && b.bench_n(s) > 0 { b.sides[s].active[k] = None; b.bring_in(s, k, "faint", false); }
        } }
        let left2 = [b.alive_n(0), b.alive_n(1)];
        if left2[0] == 0 || left2[1] == 0 { b.over = true; b.winner = if left2[0] > 0 { 0 } else if left2[1] > 0 { 1 } else { -1 }; }
    }
    b
}

// a JS sort comparator's result as an Ordering
#[inline] pub fn js_cmp(x: f64) -> std::cmp::Ordering { if x < 0.0 { std::cmp::Ordering::Less } else if x > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal } }
#[allow(dead_code)] fn _unused() { let _ = st_name; }
