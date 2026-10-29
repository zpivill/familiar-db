// Checks of single rules: node sim/test/mechanics.mjs  (exits non-zero on a failure)
import fs from 'fs';
import { prepare, runBattle, rng } from '../battle.js';
import { typeEff, RULES, battleStat, natureMult } from '../rules.js';
import { trainTeam, cleanStat } from '../builds.js';
import { makeBuild } from '../batch.js';

const root = new URL('../../', import.meta.url);
const data = prepare(JSON.parse(fs.readFileSync(new URL('data/characters.json', root))), JSON.parse(fs.readFileSync(new URL('data/moves.json', root))).moves);
let fails = 0;
const ok = (cond, what, extra = '') => { if (!cond) { fails++; console.log('FAIL', what, extra); } else console.log('ok  ', what); };
const ent = key => data.entrants.find(e => e.key === key);
// A build with exactly these moves (by id) and this ability name.
const build = (key, moveIds, ability) => {
  const e = ent(key);
  const ab = e.abilities.find(a => a.name === ability) || { name: 'None', ab: e.abilities[0].ab, none: true };
  const learn = moveIds.map(id => e.learn.find(l => l.id === id) || { id, as: data.moves.get(id).name, flags: { contact: data.moves.get(id).category === 'Physical' } });
  return { e, moves: learn, ability: ab.none ? { name: 'None', ab: { ...ab.ab, atk: [], def: [], immune: [], entry: [], hitBy: [], dealHit: [], endTurn: [], threshold: [], ko: [], allyFaint: [], faint: [], block: new Set(), unsupported: [] } } : ab };
};
const battle = (a, b, seed = 1, extra = {}) => runBattle(data, [a, b], { rng: rng(seed), log: true, ...extra });
const logHas = (B, re) => B.log.some(l => re.test(l));

ok(typeEff('Lightning', ['Earth']) === 0, 'Earth is immune to Lightning');
ok(typeEff('Neutral', ['Spirit']) === 0, 'Spirit is immune to Neutral');
ok(typeEff('Water', ['Fire', 'Earth']) === 4, 'Water does 4x to Fire/Earth');
ok(typeEff('Fire', ['Water']) === 0.5, 'Water resists Fire');

// Flash Fire style immunity: Natsu's Fire Dragon Slayer heals instead of taking Fire damage.
{
  const natsu = data.entrants.find(e => e.cid === 'natsu' && e.final);
  const fireUser = data.entrants.find(e => e.final && e.types.includes('Fire') && e.cid !== 'natsu');
  const fireMove = fireUser.learn.find(l => data.moves.get(l.id).type === 'Fire' && data.moves.get(l.id).category !== 'Status');
  const B = battle([build(fireUser.key, [fireMove.id])], [build(natsu.key, ['protect'], 'Fire Dragon Slayer')], 3);
  ok(logHas(B, /is immune/), 'Fire Dragon Slayer absorbs Fire moves');
}

// Sturdy: a full-Vitality character survives a one-hit KO.
{
  const sturdy = data.entrants.find(e => e.final && !e.types.includes('Spirit') && e.abilities.some(a => a.ab.sturdy));
  const a = sturdy.abilities.find(x => x.ab.sturdy).name;
  const hitter = ent('saitama');
  const B = battle([build(hitter.key, ['serious-punch'])], [build(sturdy.key, ['splash'], a)], 5);
  ok(logHas(B, /hangs on/), `Sturdy (${a}) leaves its holder at 1`, B.log.slice(0, 8).join(' / '));
}

// Protect blocks a hit.
{
  const u = data.entrants.find(e => e.final && e.learn.some(l => l.id === 'protect'));
  const B = battle([build('saitama', ['mega-punch'])], [build(u.key, ['protect'])], 2);
  ok(logHas(B, /protects itself/), 'Protect blocks a move');
}

// Burn halves Physical damage: compare the same hit with and without a burn.
{
  const u = build('saitama', ['mega-punch']), t = build('saitama', ['splash']);
  const B = runBattle(data, [[u], [t]], { rng: rng(1) });
  const api = B.api, [m] = B.sides[0].mons, [d] = B.sides[1].mons;
  d.hp = d.maxhp; m.status = null;
  const plain = api.calc(m, d, m.moves[0], { est: true });
  m.status = 'burn';
  const burned = api.calc(m, d, m.moves[0], { est: true });
  ok(Math.abs(burned / plain - RULES.burn.physical) < 0.02, 'Burn halves Physical damage', `${plain} -> ${burned}`);
}

// Stealth Rock style hazards hurt on switching in.
{
  const setter = data.entrants.find(e => e.final && e.learn.some(l => l.id === 'stealth-rock'));
  const B = battle([build(setter.key, ['stealth-rock']), build('saitama', ['splash'])], [build('tanjiro/3', ['splash']), build('gojo', ['splash']), build('dio', ['splash'])], 4, { log: true });
  ok(B.sides[1].hazards.rocks === 1, 'Stealth Rock lands on the foe side');
}

// Death Note: knocks out at the end of the third turn.
{
  const light = data.entrants.find(e => e.cid === 'light-yagami' && e.final);
  const B = battle([build(light.key, ['death-note', 'protect'])], [build('tanjiro/3', ['splash'])], 7);
  ok(logHas(B, /countdown ends/), 'Death Note countdown knocks out');
}

// A spread move in duos hits both foes.
{
  const u = data.entrants.find(e => e.final && e.learn.some(l => l.id === 'earthquake'));
  const B = runBattle(data, [[build(u.key, ['earthquake']), build('saitama', ['splash'])], [build('tanjiro/3', ['splash']), build('gojo', ['splash'])]], { rng: rng(9), log: true, format: 'duos' });
  const t1 = B.log.findIndex(l => /uses .*/.test(l) && l.includes(u.name));
  const after = B.log.slice(t1, t1 + 8).filter(l => / takes /.test(l)).length;
  ok(after >= 2, 'Spread move hits more than one target in duos', B.log.slice(t1, t1 + 8).join(' / '));
}

// Trick Room: the slower side moves first while it is up.
{
  const tr = data.entrants.find(e => e.final && e.learn.some(l => l.id === 'trick-room'));
  const B = battle([build(tr.key, ['trick-room', 'tackle'])], [build('tanjiro/3', ['tackle'])], 11);
  ok(logHas(B, /Field set by .*trickRoom/), 'Trick Room sets the field');
}

// Every move and every ability is understood by the effect reader, apart from the listed ones.
{
  const un = [...data.moves.values()].filter(m => m.fx.unsupported.length).map(m => m.id);
  ok(un.length <= 3, 'Unsupported move effects stay at 3 or fewer', un.join(', '));
  const ua = data.entrants.flatMap(e => e.abilities.filter(a => a.ab.unsupported.length).map(a => a.name));
  ok(ua.length === 0, 'Every ability has rules', ua.join(', '));
}

// "The first time he enters battle" abilities fire once per battle, not on every switch-in.
{
  const aizen = data.entrants.find(e => e.final && e.abilities.some(a => a.name === 'Kyoka Suigetsu'));
  const op = aizen.abilities.find(a => a.name === 'Kyoka Suigetsu').ab.entry[0];
  ok(op && op.op === 'confuse' && op.once, 'Kyoka Suigetsu confuses foes only the first time Aizen enters');
}

// ---- training and held items ----
{
  ok(battleStat(100, 50, false, 32, 31, natureMult('pow-spe', 'pow')) === 167, 'Lv50: base 100 with 32 EV points and a +10% nature is 167');
  ok(battleStat(100, 50, false, 0, 0, 1) < battleStat(100, 50, false, 0, 31, 1), 'A 0 IV gives a lower stat than 31');
  ok(battleStat(100, 50, true, 32, 31) === battleStat(100, 50, true, 0, 31) + 32, 'Each Vitality EV point is +1 at Lv50');
  const ev = cleanStat('evs', { vit: 40, pow: 32, spe: 32 });
  ok(ev.vit === 32 && ev.pow === 32 && ev.spe === 2, 'EV overrides are capped at 32 a stat and 66 in all', JSON.stringify(ev));
}
const target = () => data.entrants.find(e => e.final && !e.types.includes('Spirit') && e.stats.vit < 80 && !e.abilities.some(a => a.ab.sturdy));
{
  const t = target();
  const B = battle([build('saitama', ['serious-punch'])], [{ ...build(t.key, ['splash']), item: 'last-thread' }], 5, { level: 50 });
  ok(logHas(B, /hangs on by its Last Thread/), 'Last Thread survives a one-hit knockout at full Vitality');
}
{
  const t = target();
  const B = battle([{ ...build('saitama', ['serious-punch', 'splash']), item: 'iron-gauntlet' }], [build(t.key, ['splash'])], 6, { level: 50 });
  ok(!logHas(B, /\(A\) uses Splash/), 'Iron Gauntlet locks the user into its first move');
}
{
  const wall = data.entrants.find(e => e.final && e.learn.some(l => l.id === 'protect'));
  const B = battle([{ ...build(wall.key, ['protect']), item: 'bento-box' }], [build('saitama', ['serious-punch'])], 7, { level: 50, format: 'singles' });
  ok(B.sides[0].mons[0].item?.id === 'bento-box', 'Held items reach the battler');
}
{
  // Ward Charm halves the first super effective hit of its type
  const t = data.entrants.find(e => e.final && e.types.length === 1 && e.types[0] === 'Fire' && !e.abilities.some(a => a.ab.sturdy));
  const atk = data.entrants.find(e => e.final && e.learn.some(l => { const m = data.moves.get(l.id); return m.type === 'Water' && m.category !== 'Status' && m.power >= 60 && !m.fx.hits; }));
  const mv = atk.learn.find(l => { const m = data.moves.get(l.id); return m.type === 'Water' && m.category !== 'Status' && m.power >= 60 && !m.fx.hits; });
  const first = B => +(B.log.find(l => /\(B\) takes/.test(l))?.match(/takes (\d+)/)?.[1] || 0);
  const plain = battle([build(atk.key, [mv.id])], [build(t.key, ['splash'])], 9, { level: 50 });
  const warded = battle([build(atk.key, [mv.id])], [{ ...build(t.key, ['splash']), item: 'ward-charm:Water' }], 9, { level: 50 });
  ok(logHas(warded, /Ward Charm/) && first(warded) < first(plain) * 0.6, 'Water Ward Charm halves a super effective Water hit', `${first(plain)} vs ${first(warded)}`);
}
{
  // AI-trained teams: everyone gets a nature and 66 EV points, and no item repeats on a team
  const r = rng(11);
  const team = data.entrants.filter(e => e.final && e.sig).slice(0, 10).map(e => makeBuild(data, e, r, { level: 50 }));
  trainTeam(data, team, r, { training: 'ai', items: 'ai' });
  ok(team.every(b => b.nature && Object.values(b.evs).reduce((a, x) => a + x, 0) === 66), 'AI training gives every build a nature and 66 EV points');
  ok(new Set(team.map(b => b.item)).size === team.length && team.every(b => b.item), 'AI items: one each, no repeats on a team', team.map(b => b.item).join(', '));
  const ov = trainTeam(data, [makeBuild(data, team[0].e, r, { level: 50 })], r, { training: 'ai', items: 'ai', overrides: { [team[0].e.key]: { nature: 'grd-spe', item: 'bento-box' } } });
  ok(ov[0].nature === 'grd-spe' && ov[0].item === 'bento-box', 'Page overrides replace the AI pick');
}

if (fails) { console.log(fails, 'failed'); process.exit(1); }
console.log('all passed');
