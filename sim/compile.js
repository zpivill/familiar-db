// Turns the plain-English move effects (data/moves.json) and ability texts (data/characters.json)
// into rules the battle engine can run. Each sentence is read by a set of patterns; a sentence no
// pattern understands is kept in `unsupported`, and the Simulator page lists those, so the team can
// see exactly which effects are not simulated yet and how often they came up.

const STAT = { Power: 'pow', Guard: 'grd', Energy: 'ene', Will: 'wil', Speed: 'spe' };
const ALL = ['pow', 'grd', 'ene', 'wil', 'spe'];
const STATUS = { Burn: 'burn', Burned: 'burn', Burns: 'burn', Freeze: 'freeze', Frozen: 'freeze', Freezes: 'freeze',
  Stun: 'stun', Stuns: 'stun', Stunned: 'stun', Bleed: 'bleed', Bled: 'bleed', Curse: 'curse', Cursed: 'curse', Curses: 'curse',
  Sleep: 'sleep', asleep: 'sleep', Confuse: 'confuse', Confused: 'confuse' };
const FRAC = { half: 1 / 2, quarter: 1 / 4 };
const frac = s => s in FRAC ? FRAC[s] : s.includes('/') ? s.split('/')[0] / s.split('/')[1] : +s;
const sentences = t => (t || '').replace(/\(gag\)/g, '').split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
// A sentence with none of these words is flavour ("Barely any water comes out.") and needs no rule.
const MECHANIC = /\b(Vitality|Power|Guard|Energy|Will|Speed|damage|moves?|immune|Immune|heal|heals|switch|turns?|hits?|Hits|critical|miss|stats?|foes?|ally|first|priority|faint|knock|Burn|Freeze|Stun|Bleed|Curse|Sleep|Confuse|asleep|Taunt|Protect|\dx)\b/;

// Move shape flags the data does not store, read from the generic name and each character's name for it.
const NONCONTACT = new Set(['earthquake', 'bulldoze', 'rock-slide', 'rock-throw', 'rock-tomb', 'stone-edge', 'magnet-bomb',
  'gunk-shot', 'the-rumbling', 'gura-gura-quake', 'thousand-hands', 'stealth-rock', 'icicle-crash', 'shadow-army-march',
  'tengai-shinsei', 'arcs-of-justice', 'bazooka', 'air-cannon', 'black-blood-whips', 'decay-wave', 'malevolent-shrine']);
const FLAG_WORDS = {
  punch: /punch|fist|smash|jab|gun\b|gatling|rush|knuckle|hammer|jet pistol|impact/i,
  kick: /kick|leg|jambe|step|shoot|stomp|dropkick/i,
  slice: /slash|cut|blade|sword|claw|scissor|shell|giri|edge|katana|fang|form|reaver|saber|sabre|excalibur|getsuga|onigiri|oni giri|wire|zanpakuto|scar|whip/i,
  sound: /voice|sing|boomburst|guitar|sound|song|flute|roar|howl|growl|bass|drum|tempo|shout/i,
  shot: /ball|beam|shot|bomb|cannon|gun\b|blast|bullet|missile|spear|arrow|meteor|throw|rocket|wave|pulse/i,
  dance: /dance|step/i,
  head: /head|headbutt|zen/i,
  heal: null,
};

const statsIn = s => {
  // "Power and Energy by 1", "Speed by 2 and Power by 1", "+1 Power and +1 Energy", "all his stats"
  const out = {};
  if (/\ball (?:the user's |his |her |its |their )?stats\b|\bAll the user's stats\b/i.test(s)) {
    const n = +(s.match(/by (\d)/)?.[1] ?? 1);
    ALL.forEach(k => { out[k] = n; });
    return out;
  }
  for (const m of s.matchAll(/((?:Power|Guard|Energy|Will|Speed)(?:(?:, | and )(?:Power|Guard|Energy|Will|Speed))*) (?:by|rises? by|drops? by) (\d)/g)) {
    m[1].split(/, | and /).forEach(k => { out[STAT[k]] = +m[2]; });
  }
  for (const m of s.matchAll(/\+(\d) (Power|Guard|Energy|Will|Speed)/g)) out[STAT[m[2]]] = +m[1];
  for (const m of s.matchAll(/((?:Power|Guard|Energy|Will|Speed)(?: and (?:Power|Guard|Energy|Will|Speed))*) of (?:the user and its ally|every foe) by (\d)/g)) {
    m[1].split(' and ').forEach(k => { out[STAT[k]] = +m[2]; });
  }
  for (const m of s.matchAll(/(Power|Guard|Energy|Will|Speed) (?:\+|rises by |rise by )?\+?(\d)\b/g)) if (!(STAT[m[1]] in out)) out[STAT[m[1]]] = +m[2];
  if (/to the maximum/.test(s)) for (const m of s.matchAll(/(Power|Guard|Energy|Will|Speed) to the maximum/g)) out[STAT[m[1]]] = 12;
  if (/drops? to the minimum/.test(s)) for (const m of s.matchAll(/(Power|Guard|Energy|Will|Speed) drops? to the minimum/g)) out[STAT[m[1]]] = 12;
  return out;
};
const neg = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, -v]));
const has = o => Object.keys(o).length > 0;

// ---------------- moves ----------------

export function moveFlags(m, names = []) {
  const text = [m.name, ...names].join(' | ');
  const f = { contact: m.category === 'Physical' && !NONCONTACT.has(m.id) };
  for (const [k, re] of Object.entries(FLAG_WORDS)) if (re && re.test(text)) f[k] = true;
  if (/A sound move/.test(m.effect || '')) f.sound = true;
  if (m.category !== 'Physical') { f.punch = f.kick = false; }
  return f;
}

export function compileMove(m) {
  const fx = { unsupported: [] };
  const spread = () => fx.spread;
  for (const s of sentences(m.effect)) {
    let ok = false;
    const hit = () => { ok = true; };
    // flavour and notes the engine needs no rule for
    if (/^Goes (first|last)|Ends a wild battle|reveals the target foe's moves|Doesn't even stand up|Can't miss during a time stop|damage lands at the end of the turn|He loses his clothes|Barely any water|The user can't switch out next turn|^A sound move\.?$/.test(s)) hit();
    if (/Does nothing at all/.test(s)) { fx.nothing = true; hit(); }
    // hit count
    let mm;
    if ((mm = s.match(/Hits (\d)–(\d) times/))) { fx.hits = [+mm[1], +mm[2]]; hit(); }
    else if ((mm = s.match(/Hits (\d+) times/))) { fx.hits = [+mm[1], +mm[1]]; hit(); }
    else if (/Hits twice/.test(s)) { fx.hits = [2, 2]; hit(); }
    // targets
    if (/Duos: hits both foes|Hits both foes in duos|Hits all foes|Traps every foe/.test(s)) { fx.spread = 'foes'; hit(); }
    if (/Hits everyone else on the field|Duos: hits everyone else/.test(s)) { fx.spread = 'all'; hit(); }
    // accuracy / crits / protect
    if (/Never misses|can't miss/i.test(s) && !/next (move|attack)|during a time stop/.test(s)) { fx.neverMiss = true; hit(); }
    if (/High chance of a critical hit/.test(s)) { fx.crit = 1; hit(); }
    if (/^Always a critical hit\.?$/.test(s)) { fx.alwaysCrit = true; hit(); }
    if (/Always a critical hit if the target is below half/.test(s)) { fx.critBelowHalf = true; hit(); }
    if (/through Protect|Can't be stopped by Protect|Ignores Protect|ability and Protect|Breaks Protect/i.test(s)) { fx.breaksProtect = true; hit(); }
    if (/through Substitute|Protect and Substitute/.test(s)) { fx.breaksSub = true; hit(); }
    if (/Breaks .*(Light Screen|Reflect)/.test(s)) { fx.breaksScreens = true; hit(); }
    if (/[Ii]gnores the target's ability|ignores the target's ability/.test(s)) { fx.ignoreAbility = true; hit(); }
    if (/[Ii]gnores the target's (ability and )?stat changes|Ignores the target's stat changes/.test(s)) { fx.ignoreBoosts = 'all'; hit(); }
    if (/ignores the target's Guard boosts|Ignores the target's Guard boosts|ability and stat boosts/.test(s)) { fx.ignoreBoosts = fx.ignoreBoosts || (/stat boosts/.test(s) ? 'all' : 'def'); if (/ability/.test(s)) fx.ignoreAbility = true; hit(); }
    // damage shape
    if ((mm = s.match(/takes (\d\/\d) of the damage(?: dealt)? as recoil/))) { fx.recoil = frac(mm[1]); hit(); }
    if ((mm = s.match(/user loses (half|\d\/\d+)(?: of)? its max Vitality(?!\s+to)/)) && !/If it misses/.test(s) && !/each turn/.test(s)) { fx.selfDmg = frac(mm[1]); hit(); }
    if ((mm = s.match(/If it misses, the user loses (half|\d\/\d)/))) { fx.missDmg = frac(mm[1]); hit(); }
    if ((mm = s.match(/(?:user )?heals? (?:the user )?(3\/4|half|1\/\d) (?:of )?the damage/i))) { fx.drain = frac(mm[1]); hit(); }
    if (/Halves the target's current Vitality/.test(s)) { fx.fixed = 'halfhp'; hit(); }
    if (/damage equal to the user's level/.test(s)) { fx.fixed = 'level'; hit(); }
    if ((mm = s.match(/Hits back for (double|1\.5x) the (Physical |Energy )?damage/))) { fx.counter = { mult: mm[1] === 'double' ? 2 : 1.5, cat: mm[2]?.trim() || null }; hit(); }
    if (/Uses the target's Power instead/.test(s)) { fx.foulPlay = true; hit(); }
    if (/against the target's Guard instead of its Will/.test(s)) { fx.psyshock = true; hit(); }
    if ((mm = s.match(/Hits as (\w+) and (\w+) at once/))) { fx.dualType = [mm[1], mm[2]]; hit(); }
    if ((mm = s.match(/Super[- ]effective against (\w+)(?: and (\w+))?/))) { fx.superVs = [mm[1], mm[2]].filter(Boolean); hit(); }
    if (/type becomes the one that hits the target hardest/.test(s)) { fx.bestType = true; hit(); }
    // power that changes
    if (/Power rises by 20 for every stat boost/.test(s)) { fx.power = 'stored'; hit(); }
    if (/Double power if the target has a status/.test(s)) { fx.power = 'hex'; hit(); }
    if (/Power doubles each turn it hits in a row/.test(s)) { fx.power = 'fury'; hit(); }
    if (/Power rises by 50 each turn it is used in a row/.test(s)) { fx.power = 'flux'; hit(); }
    if (/Resets if the user switches out/.test(s)) hit();
    if (/Power is higher the lower the user's Vitality/.test(s)) { fx.power = 'reversal'; hit(); }
    if (/Double power if an ally fainted last turn|Does 1.5x if an ally was knocked out last turn/.test(s)) { fx.power = /1.5x/.test(s) ? 'avenge15' : 'avenge'; hit(); }
    if (/Double damage if the target used an Energy move this turn/.test(s)) { fx.power = 'vsEnergy'; hit(); }
    // timing
    if (/Fails unless the target is about to attack/.test(s)) { fx.sucker = true; hit(); }
    if (/Only works on the user's first turn/.test(s)) { fx.firstTurn = true; hit(); }
    if (/Goes first and makes the target flinch/.test(s)) { fx.flinch = 1; hit(); }
    if (/Can't be used twice in a row/.test(s)) { fx.noRepeat = true; hit(); }
    if (/Rises out of reach on the first turn|Vanishes on the first turn/.test(s)) { fx.charge = { invuln: true }; if (/through Protect/.test(s)) fx.breaksProtect = true; hit(); }
    if (/Charges on the first turn|Charges for one turn first/.test(s)) { fx.charge = { boost: /raising Energy by 1/.test(s) ? { ene: 1 } : null }; hit(); }
    if (/Guard rises by 1 while charging/.test(s)) { fx.charge = { ...(fx.charge || {}), boost: { grd: 1 } }; hit(); }
    if (/must rest on the next turn|can't move next turn|must rest next turn/.test(s)) { fx.recharge = 1; hit(); }
    if (/must rest for 2 turns/.test(s)) { fx.recharge = 2; hit(); }
    if ((mm = s.match(/(?:rampages|attacks) for (\d)–(\d) turns/))) { fx.rampage = [+mm[1], +mm[2]]; hit(); }
    if (/Hits the target two turns later/.test(s)) { fx.delayed = { turns: 2, mult: 1 }; hit(); }
    if (/A second meteor falls next turn for half damage/.test(s)) { fx.echo = 0.5; hit(); }
    // secondary effects: status
    const st = s.match(/(\d+)% chance to (?:cause )?(Burn|Freeze|Stun|Confuse|Bleed|Curse)/);
    if (st && !/Burn, Freeze or Stun/.test(s)) { fx.status = { kind: STATUS[st[2]], p: st[1] / 100, each: /each/i.test(s), who: /foes|each/.test(s) && spread() ? 'foes' : 'foe' }; hit(); }
    if (/(\d+)% chance to Burn, Freeze or Stun/.test(s)) { fx.status = { kind: 'tri', p: 0.2 }; hit(); }
    if (/(\d+)% chance to Bleed/.test(s) && !fx.status) { fx.status = { kind: 'bleed', p: +s.match(/(\d+)%/)[1] / 100 }; hit(); }
    if ((mm = s.match(/^(Stuns|Burns|Curses|Freezes) the target|^Always (Burns|causes Bleed)|^Causes Bleed|Puts the target to Sleep|Puts every foe to Sleep/))) {
      const k = /Sleep/.test(s) ? 'sleep' : /Bleed/.test(s) ? 'bleed' : STATUS[mm[1] || mm[2]];
      fx.status = { kind: k, p: 1, who: /every foe/.test(s) ? 'foes' : 'foe' }; hit();
    }
    if (/When it wakes, it is Confused/.test(s)) { fx.wakeConfuse = true; hit(); }
    if (/Petrifies the target/.test(s)) { fx.status = { kind: 'freeze', p: 1, turns: 2 }; hit(); }
    if (/(The user becomes|then becomes) Confused/.test(s)) { fx.selfConfuse = true; hit(); }
    if (/All foes are Confused/.test(s)) { fx.confuseFoes = true; hit(); }
    if ((mm = s.match(/(\d+)% chance the target loses its next turn/))) { fx.timeStop = mm[1] / 100; hit(); }
    if ((mm = s.match(/(\d+)% chance to (?:make the target )?flinch|has a (\d+)% chance to make the target flinch/))) { fx.flinch = (mm[1] || mm[2]) / 100; hit(); }
    if (/It flinches if the user moved first/.test(s)) { fx.flinch = 1; fx.flinchIfFirst = true; hit(); }
    if (/sleeps? for 2 turns|then it Sleeps/.test(s)) { fx.restSleep = true; hit(); }
    // stat changes, clause by clause
    for (const c of s.split(/, then |, and |(?<!user) and (?=raises|lowers|heals|the user|its )|: /)) {
      const chance = c.match(/(\d+)% chance to (raise|lower)/);
      const up = /\b(Raises|raises|raise|rise|rises|maximum)\b|\+\d/.test(c), down = /\b(Lowers|lowers|lower|drop|drops|minimum)\b/.test(c);
      if (!up && !down) continue;
      if (/Speed of the user's team|Doubles the Speed/.test(c)) continue;
      let o = /highest stat/.test(c) ? { highest: 1 } : statsIn(c);
      if (!has(o)) continue;
      if (down && !up) o = neg(o);
      let who = 'self';
      if (/the user and its ally|user and its ally|for the user and its ally|all allies'|of the user and its ally/.test(c)) who = 'team';
      else if (/every foe|all foes|of every foe|\btheir\b/.test(c) && (spread() || /every foe|all foes/.test(c))) who = 'foes';
      else if (/\btheir\b/.test(c)) who = 'foes';
      else if (/^The target/.test(s) && /\bits\b/.test(c)) who = 'foe';
      else if (/ally that comes in|ally coming in/.test(c)) who = 'incoming';
      else if (/target's|the target|The target's|\bit\b can't/.test(c)) who = 'foe';
      else if (/Heals (the user or )?an ally/.test(s) && /its /.test(c)) who = /user or an ally/.test(s) ? 'self' : 'ally';
      const entry = { who, stats: o, p: chance ? chance[1] / 100 : 1 };
      if (/while charging/.test(c) || /^Power (rises|doubles|is)/.test(c) || /^Can target an ally/.test(s)) continue;
      if (/raising Energy by 1/.test(c)) continue;
      (fx.boosts = fx.boosts || []).push(entry);
      hit();
    }
    // healing and status moves
    if ((mm = s.match(/^Heals (?:the user or an ally by |an ally by |)(half|1\/\d)(?: of)? (?:the user's|its) max Vitality/))) { fx.heal = frac(mm[1]); fx.healWho = /an ally/.test(s) && !/user or/.test(s) ? 'ally' : 'self'; hit(); }
    if (/Heals the user fully|Fully heals the user/.test(s)) { fx.heal = 1; hit(); }
    if ((mm = s.match(/user and its ally heal (1\/\d)/))) { fx.heal = frac(mm[1]); fx.healWho = 'team'; fx.cure = true; hit(); }
    if ((mm = s.match(/and heals (1\/\d)/))) { fx.heal = frac(mm[1]); hit(); }
    if (/cures its status|are cured of status|Cures the status of every/.test(s)) { fx.cure = fx.cure || (/every/.test(s) ? 'team' : true); hit(); }
    if (/whoever is in the user's place heals half/.test(s)) { fx.wish = 0.5; hit(); }
    if (/heals 1\/16 of its max Vitality every turn/.test(s)) { fx.aquaRing = true; hit(); }
    if (/If it knocks out the target, the user heals half/.test(s)) { fx.koHeal = 0.5; hit(); }
    if (/Revives a fainted ally with half/.test(s)) { fx.revive = 0.5; hit(); }
    if (/If the user faints before its next move/.test(s)) { fx.destinyBond = true; hit(); }
    if (/share their current Vitality evenly/.test(s)) { fx.painSplit = true; hit(); }
    if ((mm = s.match(/loses (half) its max Vitality to raise/))) { fx.selfDmg = 0.5; hit(); }
    if (/Spends 1\/4 of max Vitality on a decoy/.test(s)) { fx.substitute = 0.25; hit(); }
    if (/^Blocks every move aimed at the user this turn|It can't be hit this turn/.test(s) || /melts into a puddle/.test(s)) {
      fx.protect = { contactChip: /contact attackers lose 1\/8/.test(s) ? 1 / 8 : 0, contactPow: /contact attackers lose 1 Power/.test(s) ? -1 : 0 };
      if (/heals 1\/4/.test(s)) fx.heal = 0.25;
      hit();
    }
    if (/Likely to fail if used twice in a row|^Stacks up to 3 times|^Stays until removed/.test(s)) hit();
    if (/Can be used twice in a row/.test(s)) { if (fx.protect) fx.protect.repeat = true; hit(); }
    if (/survives any hit this turn/.test(s)) { fx.endure = true; hit(); }
    if (/Blocks quick \(priority\) moves aimed at the user's team/.test(s)) { fx.quickGuard = true; hit(); }
    if (/Duos: the ally's move this turn does 1.5x/.test(s)) { fx.helpingHand = true; hit(); }
    if (/foes' single-target moves hit the user this turn|foes' moves must target her/.test(s)) { fx.followMe = true; hit(); }
    if (/Duos: the user and its ally swap places/.test(s)) { fx.duosOnly = true; hit(); }
    if (/The target must repeat its last move for 3 turns/.test(s)) { fx.encore = 3; hit(); }
    if (/can't use Status moves for 2 turns/.test(s)) { fx.taunt = 2; hit(); }
    if (/can only use attacking moves for 3 turns/.test(s)) { fx.taunt = 3; hit(); }
    if (/Forces the target to switch|forced to switch out/.test(s)) { fx.forceSwitch = true; hit(); }
    if (/The user switches out|then the user switches out/.test(s)) { fx.switchOut = true; hit(); }
    if (/passes its stat changes/.test(s)) { fx.batonPass = true; hit(); }
    if ((mm = s.match(/Traps the target for (\d)–(\d) turns and takes (1\/\d)|can't switch out and loses (1\/\d) of its max Vitality each turn for (\d)–(\d)|Traps every foe for (\d)–(\d) turns, taking (1\/\d)/))) {
      fx.bind = { frac: frac(mm[3] || mm[4] || mm[9]), turns: [+(mm[1] || mm[5] || mm[7]), +(mm[2] || mm[6] || mm[8])] }; hit();
    }
    if (/The user can still switch/.test(s)) hit();
    if (/falls asleep at the end of the next turn unless it switches out/.test(s)) { fx.yawn = true; hit(); }
    if ((mm = s.match(/loses (1\/\d) of its max Vitality each turn while it stays in/))) { fx.selfChip = frac(mm[1]); hit(); }
    if (/target (?:can't|is pulled under and can't) switch out(?! for)/.test(s) && !fx.bind) { fx.trap = (s.match(/for (\d) turns/) || [])[1] ? +s.match(/for (\d) turns/)[1] : 99; hit(); }
    if (/can't switch out for (\d) turns/.test(s)) { fx.trap = +s.match(/for (\d) turns/)[1]; hit(); }
    if (/moves last next turn/.test(s)) { fx.slowNext = true; hit(); }
    if (/user's next attack can't miss and always crits/.test(s)) { fx.lockOn = 'crit'; hit(); }
    if (/The user's next move can't miss/.test(s)) { fx.lockOn = true; hit(); }
    if (/The user's next Lightning move does 2x/.test(s)) { fx.charged = true; hit(); }
    if (/Removes all of the target's stat boosts before it hits|Removes the target's stat boosts/.test(s)) { fx.clearFoeBoosts = /before/.test(s) ? 'before' : 'after'; hit(); }
    if (/turns off its ability for 3 turns/.test(s)) { fx.suppress = 3; hit(); }
    if (/Changes the target's ability to Mutated/.test(s)) { fx.suppress = 99; hit(); }
    if (/target's stat boosts are removed/.test(s)) { fx.clearFoeBoosts = 'after'; hit(); }
    if (/Takes all of the target's stat boosts for the user/.test(s)) { fx.steal = true; hit(); }
    if (/Resets every stat change on the field|Removes all stat changes and field effects first/.test(s)) { fx.haze = true; if (/field effects/.test(s)) fx.clearField = true; hit(); }
    if (/Turns the target into a pure Water type/.test(s)) { fx.soak = 'Water'; hit(); }
    if (/Uses a random move/.test(s)) { fx.metronome = true; hit(); }
    if (/For the rest of the battle the user takes no recoil/.test(s)) { fx.noRecoil = true; hit(); }
    if (/knocked out at the end of the third turn unless/.test(s)) { fx.countdown = { turns: 3, who: /All foes/.test(s) ? 'foes' : 'foe' }; hit(); }
    if (/Doesn't work on gag characters/.test(s)) hit();
    if ((mm = s.match(/Plants buds: the target loses (1\/\d)/))) { fx.seed = frac(mm[1]); hit(); }
    if ((mm = s.match(/For 3 turns, foes lose (1\/\d)/))) { fx.sideChip = { frac: frac(mm[1]), turns: 3 }; hit(); }
    if (/Stops time: next turn the user gets two moves/.test(s)) { fx.extraTurn = true; hit(); }
    if (/Can target an ally/.test(s)) hit();
    // field effects (one at a time; a new one replaces the old)
    if ((mm = s.match(/^Field for 5 turns: (.*)/))) {
      const t = mm[1], f = { turns: 5 };
      const b = t.match(/(\w+) moves do 1.3x/); if (b) f.boostType = b[1];
      if (/quick \(priority\) moves can't hit/.test(t)) f.noPriority = true;
      if (/nobody on the field can fall asleep/.test(t)) f.noSleep = true;
      if (/slower characters move first/.test(t)) f.trickRoom = true;
      if (/every foe's Speed is halved/.test(t)) f.foeSlow = true;
      if (/user's side heals 1\/16/.test(t)) f.sideHeal = 1 / 16;
      if (/foes that switch in lose 1\/8/.test(t)) f.entryChip = 1 / 8;
      fx.field = f; hit();
    }
    if (/For 5 turns nobody can float or fly/.test(s)) { fx.field = { turns: 5, gravity: true }; hit(); }
    if (/Starts snow for 5 turns/.test(s)) { fx.field = { turns: 5, snow: true }; hit(); }
    if (/Ends any field|All field effects end|field effects first/.test(s)) { fx.clearField = true; hit(); }
    // side conditions
    if ((mm = s.match(/Halves (Energy|Physical|all) damage to the user's team for 5 turns/))) { fx.screen = mm[1] === 'all' ? 'veil' : mm[1] === 'Energy' ? 'light' : 'reflect'; hit(); }
    if (/Doubles the Speed of the user's team for 4 turns/.test(s)) { fx.tailwind = 4; hit(); }
    if (/^Hazard:/.test(s)) {
      fx.hazard = /loses 1 Speed/.test(s) ? 'web' : /Stacks up to 3/.test(m.effect) ? 'spikes' : /Water hits/.test(s) ? 'rainbow' : 'rocks'; hit();
    }
    if (/Clears hazards on the user's side/.test(s)) { fx.clearHazards = 'own'; hit(); }
    if (/Clears hazards and screens from both sides/.test(s)) { fx.clearHazards = 'both'; hit(); }
    if (/removes screens and hazards on their side/.test(s)) { fx.clearHazards = 'foe'; hit(); }
    if (/^Duos:/.test(s) && !ok) { fx.duosOnly = true; hit(); }
    if (!ok && MECHANIC.test(s)) fx.unsupported.push(s);
  }
  if (fx.hits && /The last hit has a (\d+)% chance/.test(m.effect || '')) fx.flinchLast = true;
  return fx;
}

// ---------------- abilities ----------------
// An ability becomes a bag of rules the engine checks at fixed moments (entry, before damage, after a
// hit, end of turn, on a knockout...). Text patterns are general on purpose: about 500 abilities
// share a few dozen effects under character-specific names.

const typeList = s => (s.match(/\b(Fire|Water|Ice|Wind|Earth|Lightning|Light|Dark|Spirit|Cosmic|Time|Tech|Beast|Blood|Neutral)\b/g) || []);
const below = s => { const m = s.match(/below (half|1\/\d)/i); return m ? frac(m[1]) : null; };
const mult = s => { const m = s.match(/(\d(?:\.\d+)?)x/) || s.match(/do (half|3\/4|double)/); return m ? (/^\d/.test(m[1]) ? +m[1] : { half: 0.5, '3/4': 0.75, double: 2 }[m[1]]) : null; };

export function compileAbility(a) {
  const ab = { name: a.name, atk: [], def: [], immune: [], entry: [], hitBy: [], dealHit: [], endTurn: [], threshold: [], ko: [], allyFaint: [], faint: [], block: new Set(), unsupported: [] };
  for (const s of sentences(a.text)) {
    let ok = false;
    const hit = () => { ok = true; };
    let mm;
    const low = below(s);
    // --- flavour / informational only ---
    if (/knows the foe's moves|learns their moves|reveals the foe's ability|foes always know his moves|knows the foe's strongest move|can't hide it/.test(s)) hit();
    if (/^(He|She|It|They) (smells|absorbs|makes|walks|flies|rides|lives|hears|saw|studies|runs|counts|panics|sits|sticks|kicks|takes their|knows every|is pulled|always comes|feels|doesn't|only)|^Nobody|^Everyone|^Only hits|^Simple dreams|^Rika|^Leon|^The armor|^Time accelerates|^Weed-pulling|^Don't call|^A green light|^Luck and money|^I need more|^They (are|start|lose|sit)|^His doctor|^Kazuma|^It's his|^Everything was|^The damage goes|^He has|^She will|^He will|^He retired|^Rare pair bonus|^He ate|^He steals|^Atsuya|^Her food|^Her drawings|^Reborn/.test(s)) hit();
    // --- attack multipliers ---
    const atkMult = (when) => { const x = mult(s); if (x) { ab.atk.push({ mult: x, ...when }); hit(); } };
    if (/while Tailwind/.test(s)) {}
    else if ((mm = s.match(/^(?:Below (?:half|1\/\d) Vitality, )?(?:his|her|its|Her|His|Its) (own-type|Fire|Water|Ice|Wind|Earth|Lightning|Light|Dark|Spirit|Cosmic|Time|Tech|Beast|Blood|Neutral) moves do (\d\.\d)x/))) {
      atkMult({ type: mm[1] === 'own-type' ? 'own' : mm[1], lowHp: low });
    } else if ((mm = s.match(/^Below (half|1\/\d) Vitality, (?:his|her) (own-type|Fire|Water|Ice|Wind|Earth|Lightning|Light|Dark|Spirit|Cosmic|Time|Tech|Beast|Blood|Neutral) moves do (\d\.\d)x/))) {
      atkMult({ type: mm[2] === 'own-type' ? 'own' : mm[2], lowHp: frac(mm[1]) });
    }
    if ((mm = s.match(/^(Sound|Punching(?: and kicking)?|Kicking|Slicing|Thrown and shot) moves.* do (\d\.\d)x/)) || (mm = s.match(/^(?:His|Her) (kick|punch|slicing) moves (?:do|have) (\d\.\d)x/))) {
      const k = mm[1].toLowerCase();
      atkMult({ flag: k.startsWith('sound') ? 'sound' : k.startsWith('punching and') ? 'punchkick' : k.startsWith('punch') ? 'punch' : k.startsWith('kick') ? 'kick' : k.startsWith('slic') ? 'slice' : 'shot' });
    }
    if (/^Punching moves do/.test(s) && !ok) atkMult({ flag: 'punch' });
    if ((mm = s.match(/^Moves with (\d+) power or less do (\d\.\d)x/))) { ab.atk.push({ mult: +mm[2], maxPower: +mm[1] }); hit(); }
    if (/^Moves with recoil do/.test(s)) atkMult({ recoil: true });
    if (/and his Speed rises by 1 once/.test(s)) ab.threshold.push({ below: low, ops: [{ op: 'boost', stats: { spe: 1 } }] });
    if (/he can't flinch/.test(s)) ab.block.add('flinch');
    if (/can hit foes that vanish/.test(s)) ab.hitsInvuln = true;
    if (/he can't be trapped/.test(s)) ab.block.add('trap');
    if (/and Blood moves do half damage to him/.test(s)) { ab.def.push({ mult: 0.5, type: 'Blood' }); ab.block.add('bleed'); hit(); }
    if (/he lands them more often/.test(s)) ab.crit = { stage: 1 };
    if (/^Headbutt-style moves do/.test(s)) atkMult({ flag: 'head' });
    if (/^Its Speed doubles in rain/.test(s)) { ab.rainSpeed = true; hit(); }  // nothing sets rain yet, so this never fires
    if (/^Once per foe|^On entry he learns the foe's moves/.test(s)) hit();
    if (/^After it \(Reborn's bullet\), his Power rises by 2/.test(s)) { ab.slowStartBoost = { pow: 2 }; hit(); }
    if (/quick \(priority\) moves do/.test(s)) atkMult({ priority: true });
    if (/heavy moves do 1.2x/.test(s)) { ab.atk.push({ mult: 1.2, size: 'heavy' }); ab.heavyChip = 1 / 16; hit(); }
    if (/^His physical moves that aren't his signature do/.test(s)) atkMult({ cat: 'Physical', notSig: true });
    if (/^His moves that aren't his signature do/.test(s)) atkMult({ notSig: true });
    if (/^His physical moves do 1.2x and have a 10% chance to Stun/.test(s)) { ab.atk.push({ mult: 1.2, cat: 'Physical' }); ab.dealHit.push({ cat: 'Physical', p: 0.1, status: 'stun' }); hit(); }
    if (/^(His|Her) Energy moves do 1.2x but (?:she|he) takes 1\/10/.test(s)) { ab.atk.push({ mult: 1.2, cat: 'Energy' }); ab.dealRecoil = 0.1; hit(); }
    if (/^His moves do 1.2x but he loses 1\/16/.test(s)) { ab.atk.push({ mult: 1.2 }); ab.endTurn.push({ op: 'chip', frac: 1 / 16 }); hit(); }
    if ((mm = s.match(/^(?:His|Her) moves do (\d\.\d)x against (?:a target that hasn't moved yet|foes (?:below half Vitality|with raised stats|she has already hit|whose Energy is higher than their Power)|villain foes|(\w+)(?:-| and )(?:type )?(?:foes|(\w+)(?:-type)? foes)|\w+- and \w+-type foes)/))) {
      const w = { mult: +mm[1] };
      if (/hasn't moved/.test(s)) w.targetNotMoved = true;
      else if (/below half/.test(s)) w.vsLowHp = 0.5;
      else if (/raised stats/.test(s)) w.vsBoosted = true;
      else if (/already hit/.test(s)) w.vsHitBefore = true;
      else if (/Energy is higher/.test(s)) w.vsCaster = true;
      else if (/villain/.test(s)) w.vsVillain = true;
      else w.vsTypes = typeList(s.split('against')[1]);
      ab.atk.push(w); hit();
    }
    if ((mm = s.match(/^His moves do 1.3x against Spirit and Dark foes/))) hit();
    if (/Duos: those foes target him/.test(s)) hit();
    if (/^If (?:he|she) moves after the target, (?:his|her) move does (\d\.\d)x/.test(s)) atkMult({ movedAfter: true });
    if (/first move each turn goes last but does 1.5x/.test(s)) { ab.atk.push({ mult: 1.5 }); ab.goLast = true; hit(); }
    if (/^Her first Energy move each battle does 1.5x/.test(s)) { ab.atk.push({ mult: 1.5, cat: 'Energy', firstOnce: 'concealed' }); hit(); }
    if (/^(His|Her) attacks do 2x but have half accuracy/.test(s)) { ab.atk.push({ mult: 2 }); ab.accMult = 0.5; hit(); }
    if (/^His moves do 1.5x while Gravity is active/.test(s)) atkMult({ gravity: true });
    if (/^(?:His|Her) Lightning moves do 1.3x while Tailwind/.test(s)) atkMult({ type: 'Lightning', tailwind: true });
    if (/^Moves he uses that are not his type still get a 1.2x/.test(s)) { ab.offStab = 1.2; hit(); }
    if (/^Each move different from the last one he used does 10% more/.test(s)) { ab.stylish = true; hit(); }
    if (/^His Fire moves get 10% stronger each turn he stays in/.test(s)) { ab.ramp = { type: 'Fire', step: 0.1, max: 1.5 }; hit(); }
    if (/^After he uses an Ice move his next Fire move does 1.3x/.test(s)) { ab.alternate = ['Ice', 'Fire', 1.3]; hit(); }
    if (/^Below half Vitality, her contact moves do 1.3x/.test(s)) { ab.atk.push({ mult: 1.3, contact: true, lowHp: 0.5 }); hit(); }
    if (/^Below 1\/4 Vitality, his moves do 2x but he becomes Confused/.test(s)) { ab.threshold.push({ below: 0.25, ops: [{ op: 'confuse' }], always: true }); ab.atk.push({ mult: 2, lowHp: 0.25 }); hit(); }
    if (/^Duos: (?:her|his) moves do 1.3x, but (?:her|his) ally loses/.test(s)) { ab.atk.push({ mult: 1.3, duos: true }); hit(); }
    if (/^Duos: (her|his) ally's Energy moves do 1.3x/.test(s)) { ab.battery = 1.3; hit(); }
    if (/^Duos: when .* is (his|her) ally, both of their attacks do 1.3x|Toriko's moves do 1.3x/.test(s)) { ab.pair = { name: s.match(/when (.+?) is (?:his|her) ally/)[1], mult: 1.3 }; hit(); }
    if (/^Duos: when (Asuna|Kirito) is (her|his) ally, both get \+1 Speed/.test(s)) { ab.pair = { name: s.match(/when (\w+)/)[1], speed: 1 }; hit(); }
    if (/^Duos: when Anya is her ally/.test(s)) { ab.pair = { name: 'Anya', pow: 1 }; hit(); }
    if (/His Earth moves hit all foes/.test(s)) { ab.spreadType = 'Earth'; hit(); }
    if (/His punches hit twice: the second hit does 1\/4|His contact moves hit twice: the second hit does 1\/4/.test(s)) { ab.parental = { flag: /punches/.test(s) ? 'punch' : 'contact', mult: 0.25 }; hit(); }
    if (/His signature becomes whatever type hits the target hardest/.test(s)) { ab.bestTypeSig = true; hit(); }
    if (/Her signature ignores Protect and Substitute/.test(s)) { ab.sigBypass = true; hit(); }
    if (/His heavy and signature moves hit through Protect/.test(s)) { ab.heavyBypass = true; hit(); }
    if (/His Physical attacks use his Speed instead of his Power/.test(s)) { ab.speedAsPower = true; hit(); }
    if (/^His moves can hit Spirit types and ignore the target's Guard boosts/.test(s)) { ab.scrappy = true; ab.ignoreDefBoosts = true; hit(); }
    if (/His Fire moves do normal damage to Water types instead of half/.test(s)) { ab.pierce = ['Fire', 'Water']; hit(); }
    // stat multipliers on the user
    if ((mm = s.match(/^His Power and Speed are 1.2x, but his Guard and Will are 0.8x/))) { ab.statMult = { pow: 1.2, spe: 1.2, grd: 0.8, wil: 0.8 }; hit(); }
    if (/^His Power is halved, but his status moves go first/.test(s)) { ab.statMult = { pow: 0.5 }; ab.prankster = true; hit(); }
    if (/^His Power is 0.8x until he drops below half Vitality, then 1.5x/.test(s)) { ab.eyepatch = true; hit(); }
    if (/While (?:she|he) has a status, (?:her|his) Power is 1.5x/.test(s)) { ab.guts = true; hit(); }
    if (/While asleep he still attacks, and his Power is 1.5x/.test(s)) { ab.sleepFighter = true; hit(); }
    if (/still uses moves while Asleep|Always counts as asleep but still acts/.test(s)) { ab.comatose = true; if (/no other status/.test(s)) ab.block.add('status'); hit(); }
    if (/Until he takes his first hit, his stats are 0.8x/.test(s)) { ab.slowStart = true; hit(); }
    if (/For his first 2 turns in battle, his Speed is doubled/.test(s)) { ab.sandevistan = 2; hit(); }
    if (/^Below 1\/4 Vitality, his Speed doubles but he may act Confused/.test(s)) { ab.lowBattery = true; hit(); }
    // --- crits and accuracy ---
    if (/moves never miss|moves can't miss|moves can't miss|his moves can't miss|Her Energy moves never miss|Wind moves never miss|Sound moves never miss/.test(s)) {
      ab.neverMiss = /Energy moves never miss/.test(s) ? 'Energy' : /Wind moves never miss/.test(s) ? 'Wind' : /Sound moves/.test(s) ? 'sound' : true; hit();
    }
    if (/can't have their accuracy lowered|accuracy can't be lowered/.test(s)) hit();
    if (/land critical hits more often|Lands critical hits more often/.test(s)) { ab.crit = /Fire moves/.test(s) ? { stage: 1, type: 'Fire' } : /Below half/.test(s) ? { stage: 1, lowHp: 0.5 } : { stage: 1 }; hit(); }
    if (/critical hit rate is raised by 2 stages/.test(s)) { ab.crit = { stage: 2 }; hit(); }
    if (/slicing moves have a high chance of a critical hit/.test(s)) { ab.crit = { stage: 1, flag: 'slice' }; hit(); }
    if ((mm = s.match(/[Cc]ritical hits do (\d(?:\.\d+)?)x/))) { ab.critMult = +mm[1]; if (/raise his Power by 1/.test(s)) ab.critBoost = { pow: 1 }; hit(); }
    if (/Critical hits do normal damage to her|can't be hit by critical hits/.test(s)) { ab.block.add('crit'); hit(); }
    if (/^His first hit on each foe is always a critical hit/.test(s)) { ab.onePunch = true; hit(); }
    if (/A critical hit on him raises his Power to the maximum/.test(s)) { ab.angerPoint = true; hit(); }
    if (/When he lands a critical hit, every foe loses 1\/8/.test(s)) { ab.critSplash = 1 / 8; hit(); }
    if (/Multi-hit moves always hit the most times/.test(s)) { ab.skillLink = true; hit(); }
    if (/(?:Her|His|Its) moves ignore the target's ability/.test(s)) { ab.moldBreaker = true; hit(); }
    if (/[Ii]gnores the (?:target's|foe's) stat changes when attacking and being attacked/.test(s)) { ab.unaware = true; hit(); }
    if (/He ignores the foe's Speed boosts when deciding who moves first/.test(s)) { ab.targetLock = true; hit(); }
    // --- priority ---
    if (/(?:Her|His) [Ss]tatus moves go first/.test(s)) { ab.prankster = true; hit(); }
    if ((mm = s.match(/(?:Her|His) first (Energy )?move each time (?:she|he) enters battle goes first/))) { ab.quickDraw = mm[1] ? 'Energy' : true; hit(); }
    if (/(?:His|Her) switching moves go first/.test(s)) { ab.pivotPriority = true; hit(); }
    if (/Quick \(priority\) moves aimed at him fail|moves that go first can't hit him/.test(s)) { ab.block.add('priority'); hit(); }
    if (/The first quick \(priority\) move aimed at him each battle fails|dodges the first quick \(priority\) move each battle/.test(s)) { ab.priorityDodgeOnce = true; hit(); }
    if (/Moves that hit a turn later can't hurt him/.test(s)) { ab.block.add('delayed'); hit(); }
    // --- damage taken ---
    if ((mm = s.match(/^(Water|Fire|Blood|Energy|Physical|Contact|Super-effective|Non-Spirit physical|Physical moves that aren't Earth-type) moves?(?: \(shots\))? (?:do|that aren't Earth-type do) (half|3\/4|0\.75x|double) damage|^(Physical|Energy|Contact|Super-effective) moves do (half|3\/4|0\.75x|\d\.\d+x)(?: damage)? to (?:him|her)/))) {
      const what = mm[1] || mm[3], x = { half: 0.5, '3/4': 0.75, '0.75x': 0.75, double: 2 }[mm[2] || mm[4]] ?? parseFloat(mm[2] || mm[4]);
      const w = { mult: x };
      if (/Non-Spirit/.test(what)) Object.assign(w, { cat: 'Physical', notType: 'Spirit' });
      else if (/aren't Earth-type/.test(s)) Object.assign(w, { cat: 'Physical', notType: 'Earth' });
      else if (/^Physical/.test(what)) w.cat = 'Physical';
      else if (/^Energy/.test(what)) w.cat = 'Energy';
      else if (/^Contact/.test(what)) w.contact = true;
      else if (/^Super/.test(what)) w.superEff = true;
      else w.type = what;
      ab.def.push(w); hit();
      if (/but Fire moves do double/.test(s)) ab.def.push({ mult: 2, type: 'Fire' });
      if (/and he can't be Bled/.test(s)) ab.block.add('bleed');
    }
    if ((mm = s.match(/^Super-effective hits do 0.75x to him, and his moves can't miss/))) { ab.def.push({ mult: 0.75, superEff: true }); ab.neverMiss = true; hit(); }
    if (/^Fire moves do 3\/4 damage to him/.test(s) || /and Fire moves do 3\/4 damage to him/.test(s)) { ab.def.push({ mult: 0.75, type: 'Fire' }); hit(); }
    if (/(?:He|She|It) takes 0.75x damage/.test(s)) { ab.def.push({ mult: 0.75 }); if (/ally moves can't affect him/.test(s)) ab.loner = true; if (/at full Vitality/.test(s)) ab.sturdy = true; hit(); }
    if (/He takes 1.25x damage, but his moves heal him 1\/4/.test(s)) { ab.def.push({ mult: 1.25 }); ab.drain = { frac: 0.25 }; hit(); }
    if (/^Below 1\/4 Vitality, she takes half damage/.test(s)) { ab.def.push({ mult: 0.5, lowHp: 0.25 }); hit(); }
    if (/Light moves do normal damage to her, never super effective/.test(s)) { ab.unweak = 'Light'; hit(); }
    if (/^The first (Physical )?hit (?:he|she|it) takes each battle does half damage|first hit taken each battle does half damage/.test(s)) { ab.multiscale = /Physical/.test(s) ? 'Physical' : true; hit(); }
    if (/^The first hit it takes each battle does neutral damage/.test(s)) { ab.cryptid = true; hit(); }
    if (/After a super-effective hit, he takes half damage from that type/.test(s)) { ab.adaptive = true; hit(); }
    if (/^The first (?:damaging move to hit him each time he enters battle is fully blocked|damaging hit each battle is taken|damaging hit he takes each battle hits a fake)/.test(s)) { ab.disguise = /each time he enters/.test(s) ? 'entry' : 'once'; hit(); }
    if (/^The first (move|attack|contact move|hit) aimed at (?:him|her|it) each (battle|time he enters battle) (?:misses|passes through)/.test(s)) {
      ab.dodge = { contact: /contact/.test(s), reset: /enters battle/.test(s) }; hit();
    }
    if (/^The first hit that would knock her out each battle does nothing/.test(s)) { ab.disguise = 'koOnce'; hit(); }
    // --- immunities ---
    if ((mm = s.match(/^Immune to (Fire|Water|Earth|Lightning|sound) moves/)) || (mm = s.match(/^(Water|Lightning|Energy) moves heal (?:her|him) (?:by )?1\/4 instead/))) {
      const what = mm[1] === 'sound' ? { flag: 'sound' } : mm[1] === 'Energy' ? { cat: 'Energy' } : { type: mm[1] };
      const t = a.text;
      const then = /heals? (?:him|her) 1\/4|heal (?:her|him) (?:by )?1\/4/.test(t) ? { heal: 0.25 } : /makes (?:his|her)(?: own)? Fire moves do 1.5x/.test(t) ? { flashFire: true }
        : /raises her Energy by 1/.test(t) ? { boost: { ene: 1 } } : {};
      ab.immune.push({ ...what, ...then }); hit();
      if (/and Sleep from sound/.test(s)) ab.block.add('soundSleep');
    }
    if (/^Being hit by one/.test(s)) hit();
    if (/^(Can't be|He can't be|She can't be|Immune to) (.*)/.test(s) || /^(?:He|She|It)? ?[Cc]an't (?:be|flinch)/.test(s) || /Immune to (Bleed|Confuse|Taunt)/.test(s)) {
      const t = s;
      const add = k => { ab.block.add(k); ok = true; };
      if (/Burned/.test(t)) add('burn'); if (/Frozen/.test(t)) add('freeze'); if (/Bleed|Bled/.test(t)) add('bleed');
      if (/Cursed/.test(t)) add('curse'); if (/Confuse/.test(t)) add('confuse'); if (/Sleep|asleep|put to Sleep/.test(t) && !/from sound/.test(t)) add('sleep');
      if (/flinch/.test(t)) add('flinch'); if (/Taunt/.test(t)) add('taunt'); if (/Encore/.test(t)) add('encore'); if (/Charm/.test(t)) add('charm');
      if (/trapped/.test(t)) add('trap'); if (/forced out/.test(t)) add('forceOut');
      if (/Speed can't be lowered/.test(t)) add('drop:spe');
      if (/Intimidate/.test(t)) add('intimidate');
      if (/stats can't be lowered/.test(t)) add('drops');
      if (/Power drops on entry/.test(t)) add('intimidate');
    }
    if (/^Immune to Taunt, Encore and Charm|Immune to Taunt, Charm/.test(s)) { ['taunt', 'encore', 'charm'].forEach(k => ab.block.add(k)); if (/Confuse/.test(s)) ab.block.add('confuse'); if (/Power drops on entry/.test(s)) ab.block.add('intimidate'); hit(); }
    if (/Immune to Confuse and Sleep/.test(s)) { ab.block.add('confuse'); ab.block.add('sleep'); hit(); }
    if (/Immune to Bleed/.test(s)) { ab.block.add('bleed'); hit(); }
    if (/(?:His|Her) (?:stats|Guard and Will|Power) can't be lowered/.test(s)) {
      if (/Guard and Will/.test(s)) { ab.block.add('drop:grd'); ab.block.add('drop:wil'); } else if (/his Power can't be lowered/.test(s)) ab.block.add('drop:pow'); else ab.block.add('drops');
      if (/can't be Confused|Confused, Cursed or Taunted/.test(s)) { ab.block.add('confuse'); if (/Cursed/.test(s)) { ab.block.add('curse'); ab.block.add('taunt'); } }
      if (/can't be forced out/.test(s)) ab.block.add('forceOut');
      if (/Intimidate doesn't affect him/.test(s)) ab.block.add('intimidate');
      hit();
    }
    if (/^(?:He|She|It) can't be forced (?:out|to switch out)|^Can't be forced out|can't be forced out/.test(s)) { ab.block.add('forceOut'); if (/trapped/.test(s)) ab.block.add('trap'); if (/Power can't be lowered/.test(s)) ab.block.add('drop:pow'); if (/heals 1\/16/.test(s)) ab.endTurn.push({ op: 'heal', frac: 1 / 16 }); hit(); }
    if (/^Can always switch out|^(?:He|She) can always switch out/.test(s)) { ab.block.add('trap'); hit(); }
    if (/Can't be trapped and his Speed can't be lowered/.test(s)) { ab.block.add('trap'); ab.block.add('drop:spe'); hit(); }
    if (/Charm and Intimidate don't affect him/.test(s)) { ab.block.add('charm'); ab.block.add('intimidate'); hit(); }
    if (/Taunt doesn't work on her/.test(s)) { ab.block.add('taunt'); hit(); }
    if (/Fake Out-style moves fail on her/.test(s)) { ab.block.add('fakeout'); hit(); }
    if (/Takes no damage from hazards/.test(s)) { ab.block.add('hazards'); hit(); }
    if (/Status moves aimed at him fail 30% of the time/.test(s)) { ab.statusDodge = 0.3; hit(); }
    if (/Moves that knock out after a countdown .* don't work on him/.test(s)) { ab.block.add('countdown'); hit(); }
    if (/Bleed heals him 1\/8 each turn instead/.test(s)) { ab.poisonHeal = 1 / 8; hit(); }
    if (/He wakes up from Sleep after one turn/.test(s)) { ab.earlyBird = true; hit(); }
    // --- reactions to being hit ---
    if ((mm = s.match(/^Foes that (?:hit|make contact with) (?:him|her|it)(?: with contact moves)? (?:have a (\d+)% chance to (?:be |)(Burned|Frozen|Confused|Bleed|Stunned)|lose (1\/\d) of their max Vitality|lose 1 Speed)/))) {
      const contact = /contact/.test(s);
      if (mm[2]) ab.hitBy.push({ contact, p: mm[1] / 100, status: STATUS[mm[2]] });
      else if (mm[3]) ab.hitBy.push({ contact, chip: frac(mm[3]) });
      else ab.hitBy.push({ contact, stats: { spe: -1 } });
      hit();
    }
    if (/^Foes that hit him with contact moves have a 30% chance to Bleed|^Foes that make contact with him have a 30% chance to Bleed/.test(s)) { ab.hitBy.push({ contact: true, p: 0.3, status: 'bleed' }); hit(); }
    if (/^Foes that hit him have their Will drop by 1/.test(s)) { ab.hitBy.push({ stats: { wil: -1 } }); hit(); }
    if (/^A foe that hits him with a Physical move loses 1 Speed/.test(s)) { ab.hitBy.push({ cat: 'Physical', stats: { spe: -1 } }); hit(); }
    if (/^Blood-type foes that hit him with contact moves become Confused/.test(s)) { ab.hitBy.push({ contact: true, attackerType: 'Blood', p: 1, status: 'confuse' }); hit(); }
    if (/contact attackers lose 1\/8 of their max Vitality/.test(s)) { ab.hitBy.push({ contact: true, chip: 1 / 8 }); hit(); }
    if ((mm = s.match(/^Each time (?:she|he) is hit, (?:(\d+)% chance )?(?:her|his) (Guard|Energy|Power) rises by 1(?: and his Guard drops by 1)?/))) {
      ab.hitBy.push({ self: true, p: mm[1] ? mm[1] / 100 : 1, stats: /Guard drops/.test(s) ? { pow: 1, grd: -1 } : { [STAT[mm[2]]]: 1 } }); hit();
    }
    if (/^His Guard rises by 1 each time a physical move hits him/.test(s)) { ab.hitBy.push({ self: true, cat: 'Physical', stats: { grd: 1 } }); hit(); }
    if ((mm = s.match(/^When hit by an? (?:(\w+) or (\w+)|(\w+)) move, (?:her|his) (Energy|Power) rises by 1/))) { ab.hitBy.push({ self: true, types: [mm[1], mm[2], mm[3]].filter(Boolean), stats: { [STAT[mm[4]]]: 1 } }); hit(); }
    if ((mm = s.match(/^(?:Each time a super-effective move hits him|When hit by a super-effective move), his (Power(?: and Energy)?) rises? by 1/))) { ab.hitBy.push({ self: true, superEff: true, stats: /Energy/.test(mm[1]) ? { pow: 1, ene: 1 } : { pow: 1 } }); hit(); }
    if (/^When hit by a super-effective move, he flees and switches out/.test(s)) { ab.ejectSuper = true; hit(); }
    if (/^When hit by an Energy move, 30% chance to bounce half the damage back/.test(s)) { ab.bounce = { cat: 'Energy', p: 0.3, frac: 0.5 }; hit(); }
    if (/His Protect-style moves also hit contact attackers back for half/.test(s)) { ab.royalGuard = 0.5; hit(); }
    if (/When he uses Protect, foes that made contact lose 1\/8/.test(s)) { ab.spikyShield = 1 / 8; hit(); }
    if (/Her Protect-style moves never fail when used in a row/.test(s)) { ab.protectAlways = true; hit(); }
    if (/When a foe resists his move, he sulks and loses 1 Speed/.test(s)) { ab.gloom = true; hit(); }
    // --- reactions to stat drops ---
    if ((mm = s.match(/^When a foe lowers (?:one of )?(?:her|his) stats?, (?:her|his) (Energy|Power) rises by 2/))) { ab.defiant = STAT[mm[1]]; hit(); }
    if (/Her stat changes are reversed/.test(s)) { ab.contrary = true; hit(); }
    if (/His lowered stats reset when he switches out/.test(s)) { ab.naturalReset = true; if (/can't be Bled/.test(s)) ab.block.add('bleed'); hit(); }
    // --- dealing hits ---
    if ((mm = s.match(/^(?:Her|His) contact moves have a (\d+)% chance to (Stun|Bleed|cause Bleed)/))) { ab.dealHit.push({ contact: true, p: mm[1] / 100, status: /Bleed/.test(mm[2]) ? 'bleed' : 'stun' }); hit(); }
    if ((mm = s.match(/^(?:His|Her)(?: (Earth|contact))? moves heal (?:him|her) (1\/\d) of the damage dealt/))) { ab.drain = { frac: frac(mm[2]), type: mm[1] === 'Earth' ? 'Earth' : null, contact: mm[1] === 'contact' }; hit(); }
    if (/^When she hits a foe that has stat boosts, she steals one/.test(s)) { ab.catBurglar = true; hit(); }
    if (/^Foes he hits with contact moves lose their ability for 3 turns|^His contact moves remove the target's ability for 3 turns/.test(s)) { ab.dealHit.push({ contact: true, suppress: 3 }); hit(); }
    if (/^Foes he hits with contact moves lose 1\/8 of their max Vitality each turn after/.test(s)) { ab.dealHit.push({ contact: true, decay: 1 / 8 }); hit(); }
    if (/^After he hits a foe with a contact move, it can't switch out/.test(s)) { ab.dealHit.push({ contact: true, trap: 99 }); hit(); }
    if (/^He hits through Substitute/.test(s) || /hits through Substitute/.test(s)) { ab.infiltrator = true; hit(); }
    if (/After using EXPLOSION! she switches out by herself/.test(s)) { ab.explodeOut = true; hit(); }
    // --- entry ---
    if ((mm = s.match(/^When (?:he|she|it) enters battle, foes' ((?:Power|Will|Speed|Energy)(?: and (?:Power|Will|Speed|Energy))?) drops? by 1/)) || (mm = s.match(/^When (?:he|she|it) enters battle, (?:her smug face )?lowers foes' (Will) by 1/))) {
      const o = {}; mm[1].split(' and ').forEach(k => { o[STAT[k]] = -1; });
      ab.entry.push({ op: 'foes', stats: o, intimidate: 'pow' in o });
      if (/Duos: his ally's Power rises by 1/.test(s)) ab.entry.push({ op: 'ally', stats: { pow: 1 } });
      if (/but so does his ally/.test(s)) ab.entry.push({ op: 'ally', stats: { wil: -1 } });
      if (/she learns their moves/.test(s)) {}
      hit();
    }
    if (/^When he gets nervous he grins/.test(s)) { ab.entry.push({ op: 'foes', stats: { wil: -1 } }, { op: 'ally', stats: { wil: -1 } }); hit(); }
    if (/^When (?:he|she) enters battle he yells/.test(s)) { ab.entry.push({ op: 'foes', stats: { wil: -1 } }); ab.entry.push({ op: 'wake' }); hit(); }
    if ((mm = s.match(/^(?:Her|His|Its) (Energy|Speed|Guard) rises by 1 when (?:she|he|it) enters battle|^(?:Her|His|Its) (Speed|Energy|Guard) rises by 1 when/))) { ab.entry.push({ op: 'self', stats: { [STAT[mm[1] || mm[2]]]: 1 } }); hit(); }
    if (/^When (?:he|she|it) enters battle, (?:an invisible clone|a clone|Igris|a transfigured human|he makes a clone)|^When he enters battle, he makes a clone/.test(s)) {
      ab.entry.push({ op: 'sub', frac: /1\/8/.test(s) ? 1 / 8 : 1 / 4 }); hit();
    }
    if ((mm = s.match(/^When (?:he|she) enters battle, (Fire|Water|Lightning|Time) moves do 1.3x for 5 turns/))) { ab.entry.push({ op: 'field', field: { turns: 5, boostType: mm[1] } }); hit(); }
    if (/^When he enters battle, it snows for 5 turns/.test(s)) { ab.entry.push({ op: 'field', field: { turns: 5, snow: true } }); hit(); }
    if (/^When (?:he|she) enters battle, (?:all foes are Confused|each foe has a 30% chance to be Confused)/.test(s)) { ab.entry.push({ op: 'confuse', p: /30%/.test(s) ? 0.3 : 1 }); hit(); }
    if (/^When he enters battle, foes can't switch out next turn|the foe in front of him can't switch out for 2 turns/.test(s)) { ab.entry.push({ op: 'trap', turns: /2 turns/.test(s) ? 2 : 1 }); hit(); }
    if (/^When he enters battle, Beast-type foes' Power drops by 1/.test(s)) { ab.entry.push({ op: 'foes', stats: { pow: -1 }, onlyType: 'Beast' }); ab.entry.push({ op: 'trap', turns: 1, onlyType: 'Beast' }); hit(); }
    if (/^When she enters battle she copies the foe's stat boosts/.test(s)) { ab.entry.push({ op: 'psychUp' }); hit(); }
    if (/^On entry, raises Power or Energy by 1, whichever hits/.test(s)) { ab.entry.push({ op: 'download' }); hit(); }
    if (/^When he enters battle he copies the foe's ability/.test(s)) { ab.entry.push({ op: 'trace' }); hit(); }
    if (/^When he enters battle he transforms into the foe/.test(s)) { ab.entry.push({ op: 'imposter' }); hit(); }
    if (/^When she enters battle, foes lose 1\/16 of their max Vitality each turn for 5 turns, and she heals/.test(s)) { ab.entry.push({ op: 'drainField', frac: 1 / 16, turns: 5 }); hit(); }
    if (/^When he enters battle, field effects on the foe's side end/.test(s)) { ab.entry.push({ op: 'clearFoeSide' }); hit(); }
    if (/^Once per battle, on his first turn, foes can't move/.test(s)) { ab.entry.push({ op: 'theWorld' }); hit(); }
    if (/^When he enters battle, the foe facing him must repeat its last move/.test(s)) { ab.entry.push({ op: 'encore' }); hit(); }
    if (/^When he enters battle, his allies' lowered stats reset/.test(s)) { ab.allyGuard = 0.75; hit(); }
    if ((mm = s.match(/^(?:Duos: )?(?:when (?:she|he) enters, )?(?:her|his) ally's ((?:Power|Guard|Energy|Will|Speed)(?: and (?:Power|Guard|Energy|Will|Speed))*) rises? by (\d)/))) {
      const o = {}; mm[1].split(' and ').forEach(k => { o[STAT[k]] = +mm[2]; }); ab.entry.push({ op: 'ally', stats: o }); hit();
    }
    if (/^Duos: when he enters, his ally heals 1\/8/.test(s)) { ab.entry.push({ op: 'allyHeal', frac: 1 / 8 }); hit(); }
    if (/He spends his first turn reading, but his Energy rises by 2/.test(s)) { ab.entry.push({ op: 'self', stats: { ene: 2 } }); ab.truantFirst = true; hit(); }
    if (/^When (?:he|she|it) enters battle, he gives a random held item/.test(s)) hit();
    if (/^If a Beast-type foe is in battle, his Speed rises by 2 and his Will drops by 2/.test(s)) { ab.entry.push({ op: 'self', stats: { spe: 2, wil: -2 }, ifFoeType: 'Beast' }); hit(); }
    if (/Tech-type foes can't switch out while she is in battle/.test(s)) { ab.magnetPull = 'Tech'; hit(); }
    if (/^Foes below half Vitality can't switch out/.test(s)) { ab.lowTrap = 0.5; hit(); }
    if (/^He looks like another member of his team|^Enters battle disguised as the last ally/.test(s)) { ab.illusion = true; hit(); }
    if (/^Becomes the type of the move he is about to use/.test(s)) { ab.protean = true; hit(); }
    if (/^After she hits a foe with a contact move, she transforms into it/.test(s)) { ab.transformOnHit = true; hit(); }
    if (/^When she transforms, she also copies the target's ability/.test(s)) { ab.transformAbility = true; hit(); }
    if (/^When anyone else uses a dance move, she copies it/.test(s)) { ab.dancer = true; hit(); }
    if (/^When a foe uses its signature move, he can use it once too|^When a foe uses a move on him, he can use that move too/.test(s)) { ab.mimic = true; hit(); }
    if (/^Duos: on his first turn in battle, foes' single-target moves hit him/.test(s)) { ab.entryFollowMe = true; hit(); }
    if (/^Duos: (?:his|her) ally takes (?:1\/4 less|0.75x) damage/.test(s)) { ab.allyGuard = 0.75; hit(); }
    if (/^Duos: each turn, 30% chance to cure (?:her|his) ally's status/.test(s)) { ab.healer = 0.3; hit(); }
    if (/^Duos:/.test(s) && !ok) { ab.duosOnly = true; hit(); }
    // --- end of turn ---
    if ((mm = s.match(/^(?:While below half Vitality, )?(?:He|She|It)? ?[Hh]eals (1\/\d+)(?: of (?:his|her|its) max Vitality)? each turn/))) {
      ab.endTurn.push({ op: 'heal', frac: frac(mm[1]), lowHp: /below half/.test(s) ? 0.5 : null }); hit();
      if (/every third turn his Guard drops by 1/.test(s)) ab.endTurn.push({ op: 'every3', stats: { grd: -1 } });
      if (/the first time he would be knocked out he survives/.test(s)) ab.surviveOnce = true;
    }
    if ((mm = s.match(/^While below half Vitality, he heals (1\/8) each turn/))) { ab.endTurn.push({ op: 'heal', frac: 1 / 8, lowHp: 0.5 }); hit(); }
    if (/^He heals 1\/8 each turn and can't be Bled/.test(s)) { ab.block.add('bleed'); hit(); }
    if (/^While asleep she heals another 1\/8/.test(s)) { ab.endTurn.push({ op: 'heal', frac: 1 / 8, asleep: true }); hit(); }
    if ((mm = s.match(/^(?:Her|His|Its) (Speed|Power) rises by 1 at the end of each turn/))) { ab.endTurn.push({ op: 'boost', stats: { [STAT[mm[1]]]: 1 } }); hit(); }
    if (/^Each turn, one random stat rises by 2 and another drops by 1/.test(s)) { ab.endTurn.push({ op: 'moody' }); hit(); }
    if (/^If he didn't attack this turn, his Guard rises by 1/.test(s)) { ab.endTurn.push({ op: 'boost', stats: { grd: 1 }, ifNoAttack: true }); hit(); }
    if (/^Its Power rises by 1 each turn it doesn't attack/.test(s)) { ab.endTurn.push({ op: 'boost', stats: { pow: 1 }, ifNoAttack: true }); hit(); }
    if (/^Each turn, 10% chance he falls asleep for that turn/.test(s)) { ab.narcolepsy = 0.1; hit(); }
    if (/^Each turn there is a 30% chance he gets Confused, and each time his Power rises by 1/.test(s)) { ab.endTurn.push({ op: 'drunk', p: 0.3 }); hit(); }
    if (/^At the end of each turn, his spirit helpers hit a random foe for 1\/16/.test(s)) { ab.endTurn.push({ op: 'poke', frac: 1 / 16 }); hit(); }
    if (/^Sleeping foes lose 1\/8 of their max Vitality each turn/.test(s)) { ab.endTurn.push({ op: 'badDreams', frac: 1 / 8 }); hit(); }
    if ((mm = s.match(/^After (?:his|her) (third|fourth|fifth) turn in battle, (?:his|her|all) (Power drops by 2|Power rises by 2|his stats rise by 1)/))) {
      const n = { third: 3, fourth: 4, fifth: 5 }[mm[1]];
      ab.timed = { turn: n, stats: /all his stats/.test(s) ? Object.fromEntries(ALL.map(k => [k, 1])) : { pow: /drops/.test(s) ? -2 : 2 } }; hit();
    }
    if (/^Duos: (her|his) moves do 1.3x, but/.test(s)) hit();
    // --- once-per-battle / threshold triggers ---
    if ((mm = s.match(/^(?:The first time (?:he|she|it) (?:drops|survives a hit that leaves him|survives) below (half|1\/\d) Vitality|Below (1\/\d|half) Vitality, (?:all )?(?:his|her) (?:stats|Power|Speed) rises?|Once per battle, when she drops below (1\/\d))(.*)/))) {
      const th = frac(mm[1] || mm[2] || mm[3]);
      const rest = s;
      const ops = [];
      let o = statsIn(rest.replace(/foes' \w+ drops by \d/, ''));
      if (/all (?:his|her) stats rise by (\d)/.test(rest)) { const n = +rest.match(/all (?:his|her) stats rise by (\d)/)[1]; o = Object.fromEntries(ALL.map(k => [k, n])); }
      if (/Guard drops by (\d)/.test(rest)) o.grd = -rest.match(/Guard drops by (\d)/)[1];
      if (/Power \+2, Guard -1/.test(rest)) o = { pow: 2, grd: -1 };
      if (/Power and Speed \+1/.test(rest)) o = { pow: 1, spe: 1 };
      if (has(o)) ops.push({ op: 'boost', stats: o });
      const hm = rest.match(/heals (1\/\d)/); if (hm) ops.push({ op: 'heal', frac: frac(hm[1]) });
      if (/cures his status/.test(rest)) ops.push({ op: 'cure' });
      if (/becomes Confused/.test(rest)) ops.push({ op: 'confuse' });
      if (/loses 1\/16 each turn/.test(rest)) ops.push({ op: 'kakuja' });
      if (/a clone appears/.test(rest)) ops.push({ op: 'sub', frac: 1 / 4 });
      if (/foes' Will drops by 1/.test(rest)) ops.push({ op: 'foes', stats: { wil: -1 } });
      if (/all allies heal 1\/4/.test(rest)) ops.push({ op: 'teamHeal', frac: 0.25 });
      if (/can't be healed/.test(rest)) ops.push({ op: 'noHeal' });
      if (ops.length) { ab.threshold.push({ below: th, ops }); hit(); }
    }
    if ((mm = s.match(/^Switches out by (?:her|him)self when (?:she|he) drops below half|^When he drops below 1\/4 Vitality, he switches out by himself/))) { ab.wimpOut = /1\/4/.test(s) ? 0.25 : 0.5; hit(); }
    if (/^(?:If (?:he|she|it) is at full Vitality|At full Vitality), (?:a hit that would knock (?:him|her|it) out leaves (?:him|her|it) at 1|he survives any single hit with at least 1)/.test(s)) { ab.sturdy = true; if (/Power rises by 1/.test(s)) ab.sturdyBoost = { pow: 1 }; hit(); }
    if (/^Once per battle, a hit that would knock (?:him|her) out (?:leaves|instead leaves)/.test(s) || /^The first time (?:he|she) would be knocked out, (?:he|she) survives/.test(s)) { ab.surviveOnce = true; if (/switches him out/.test(s)) ab.surviveSwitch = true; hit(); }
    if (/^The first time he is knocked out, he comes back with half/.test(s)) { ab.reviveOnce = 0.5; hit(); }
    // --- knockouts and faints ---
    if ((mm = s.match(/^When (?:he|she|his move|her move) knocks? out a foe(?: in one hit)?, (.*)|^(?:His|Her) Power rises by 1 each time (?:he|she) knocks out a foe/))) {
      const t = mm[1] || 'his Power rises by 1';
      const ops = [];
      const o = statsIn(t.replace(/drops by/, 'by'));
      if (/every foe's Speed drops by 1/.test(t)) ops.push({ op: 'foes', stats: { spe: -1 } });
      else if (/all foes' Will drops by 1/.test(t)) ops.push({ op: 'foes', stats: { wil: -1 } });
      else if (has(o)) ops.push({ op: 'boost', stats: /drops/.test(t) ? neg(o) : o, oneHit: /in one hit/.test(s) });
      const hm = t.match(/heals (1\/\d)/); if (hm) ops.push({ op: 'heal', frac: frac(hm[1]) });
      if (/gains its ability|takes its ability/.test(t)) ops.push({ op: 'steal-ability' });
      ab.ko.push(...ops); if (ops.length) hit();
    }
    if (/^When an ally knocks out a foe, his Power rises by 1/.test(s)) { ab.allyKO = { pow: 1 }; hit(); }
    if ((mm = s.match(/^When an ally (?:faints|is knocked out), (.*)/))) {
      const t = mm[1]; const ops = [];
      const o = statsIn(t); if (has(o)) ops.push({ op: 'boost', stats: o });
      const hm = t.match(/heals (half|1\/\d)/); if (hm) ops.push({ op: 'heal', frac: frac(hm[1]) });
      ab.allyFaint.push(...ops); if (ops.length) hit();
    }
    if (/^When (?:he|she) (?:is knocked out|faints)(?: from a hit)?, (?:the foe that did it|the attacker) loses 1\/4/.test(s)) { ab.faint.push({ op: 'aftermath', frac: 0.25 }); hit(); }
    if (/^When he is knocked out, all allies' stats rise by 1 and all foes' stats drop by 1/.test(s)) { ab.faint.push({ op: 'requiem' }); hit(); }
    if (/^When he faints, the ally that replaces him gets \+1 Power and \+1 Energy/.test(s)) { ab.faint.push({ op: 'nextBoost', stats: { pow: 1, ene: 1 } }); hit(); }
    // --- switching out ---
    if ((mm = s.match(/^(?:Heals|He heals|She heals) (1\/3)(?: of (?:his|her) max Vitality)? when (?:he|she) switches out/))) { ab.regenerator = 1 / 3; hit(); }
    if (/^When he switches out, the ally coming in heals 1\/8/.test(s)) { ab.switchGift = { heal: 1 / 8 }; hit(); }
    if (/^When he switches out, the ally coming in gets \+1 Speed/.test(s)) { ab.switchGift = { stats: { spe: 1 } }; hit(); }
    if (/^When an ally switches into its spot, that ally heals 1\/4/.test(s)) { ab.switchGift = { heal: 1 / 4 }; hit(); }
    // --- heal boosts and misc ---
    if ((mm = s.match(/^(?:Healing moves (?:he|she) uses heal|His healing moves heal|Healing moves and items heal him) (1\.\d)x/))) { ab.healMult = +mm[1]; hit(); }
    if (/^When she uses a healing move she also raises her Guard by 1/.test(s)) { ab.healBoost = { grd: 1 }; hit(); }
    if (/^After he heals with a move, his next attacking move does 2x/.test(s)) { ab.senkaimaru = true; hit(); }
    if (/^Each time he puts a foe to sleep, he heals 1\/8/.test(s)) { ab.sleepHeal = 1 / 8; hit(); }
    if (/^Healing moves she uses on allies also cause Bleed/.test(s)) { ab.deadlyCooking = true; hit(); }
    if (/^The chance of his moves' side effects is doubled|^Her Ice moves have double the usual chance to Freeze/.test(s)) { ab.sereneGrace = /Ice/.test(s) ? 'Ice' : true; hit(); }
    if (/^Her Tailwind lasts 2 more turns/.test(s)) { ab.longTailwind = 2; ab.neverMiss = 'Wind'; hit(); }
    if (/^Using a Fire move raises his Speed by 1/.test(s)) { ab.afterMove = { type: 'Fire', stats: { spe: 1 } }; hit(); }
    if (/^If he comes in from an ally's U-turn/.test(s)) { ab.motionSickness = true; hit(); }
    if (/^Each time she uses a Status move, 10% chance a treasure chest eats her/.test(s)) { ab.mimicChest = 0.1; hit(); }
    if (/^10% chance his move goes to a random target, or misses/.test(s)) { ab.lost = 0.1; hit(); }
    if (/^When he knocks out a foe in one hit, his Will drops by 1/.test(s)) hit();
    if (/^Foes land critical hits on her more often/.test(s)) { ab.badLuck = true; hit(); }
    if (/^His first contact move after entering can't miss and ignores Guard/.test(s)) { ab.instantDomain = true; hit(); }
    if (/^His Spirit moves do 1.3x, but he can't hide it/.test(s)) hit();
    if (/^If he moves after the target/.test(s)) hit();
    if (!ok && MECHANIC.test(s)) ab.unsupported.push(s);
  }
  for (const k of ['atk', 'def', 'immune', 'entry', 'hitBy', 'dealHit', 'endTurn', 'threshold', 'ko', 'allyFaint', 'faint']) {
    const seen = new Set();
    ab[k] = ab[k].filter(x => { const j = JSON.stringify(x); if (seen.has(j)) return false; seen.add(j); return true; });
  }
  return ab;
}
