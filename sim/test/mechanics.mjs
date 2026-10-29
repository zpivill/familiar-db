// Checks of single rules: node sim/test/mechanics.mjs  (exits non-zero on a failure)
import fs from 'fs';
import { prepare, runBattle, rng } from '../battle.js';
import { typeEff, RULES, battleStat, natureMult } from '../rules.js';
import { trainTeam, cleanStat } from '../builds.js';
import { makeBuild, runBatch, watchBattle } from '../batch.js';
import { draftSide, guessBuilds } from '../draft.js';
import { metaSummary } from '../meta.js';

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

// ---- competitive doubles ----
{
  const w = watchBattle(data, { format: 'comp', seed: 21 });
  const legends = seed => watchBattle(data, { format: 'comp', seed }).teams.map(t => t.filter(m => ['legendary', 'mythical'].includes(data.entrants.find(e => e.key === m.key).rarity)).length);
  ok([21, 22, 23, 24, 25].every(sd => legends(sd).every(n => n <= 1)), 'Competitive teams have at most 1 legendary or mythical');
  ok(w.teams.every(t => t.length === 6 && t.every(m => m.item && m.nature)), 'Competitive doubles: 6 a side, every character trained and holding an item');
  ok(w.turns <= 51, 'Competitive doubles ends by turn 50', String(w.turns));
  const S = runBatch(data, { format: 'comp', count: 30, seed: 4 });
  const games = Object.values(S.ent).reduce((n, e) => n + e.g, 0), wins = Object.values(S.ent).reduce((n, e) => n + e.w, 0);
  ok(games === S.battles * 12 && Math.abs(wins - (S.battles - S.draws) * 6) < 1e-9, 'A competitive draw counts as a non-win for both sides');
  const late = data.entrants.find(e => e.final && e.sig && e.learn.some(l => l.lv > 50));
  const lateIds = new Set(late.learn.filter(l => l.lv > 50).map(l => l.id)), r2 = rng(3);
  const picked = Array.from({ length: 60 }, () => makeBuild(data, late, r2, { level: 50, learnLevel: 100, movesets: 'random' })).some(b => b.moves.some(l => lateIds.has(l.id)));
  ok(picked, 'Builds scaled to Lv50 still pick moves learned after Lv50');
  const cap = runBattle(data, [[build('saitama', ['splash'])], [build('saitama', ['splash'])]], { rng: rng(1), turnCap: 50 });
  ok(cap.winner === -1 && cap.turn === 51, 'A battle still going at the turn limit is a draw', String(cap.turn));
}

// ---- the draft ----
{
  const LEG = e => ['legendary', 'mythical'].includes(e.rarity);
  const fin = data.entrants.filter(e => e.final && e.sig);
  const legs = fin.filter(LEG), regs = fin.filter(e => !LEG(e));
  const r = rng(31);
  const bring = ents => trainTeam(data, ents.map(e => makeBuild(data, e, r, { level: 50, learnLevel: 100 })), r, { training: 'ai', items: 'ai' });
  const mine = bring([...legs.slice(0, 2), ...regs.slice(0, 8)]);
  const fiveLeg = [...legs.slice(2, 7), ...regs.slice(8, 13)];
  const theirs = guessBuilds(data, fiveLeg, makeBuild, { level: 50, learnLevel: 100 });
  const d = draftSide(data, mine, theirs, { level: 50, pickLegendCap: 1 }, rng(2));
  ok(d.order.length === 6 && new Set(d.order).size === 6 && d.order.every(i => i >= 0 && i < 10), 'The draft picks 6 different characters from the 10');
  ok(d.order.filter(i => LEG(mine[i].e)).length <= 1, 'The draft picks at most 1 legendary or mythical');
  ok(d.predicted.length && d.predicted.every(x => [5, 6, 7, 8, 9].every(i => x.team.includes(i))), 'Against 5 legendaries, every predicted 6 holds all 5 of their others');
  ok(['Reading their 10', 'Prediction', 'My 6'].every(h => d.log.some(l => l.includes(h))) && d.log.some(l => /certain picks/.test(l)), 'The reasoning log explains the read, the prediction and the picks', d.log[0]);
  const S = runBatch(data, { format: 'comp', draft: true, count: 12, seed: 8 });
  ok(S.draft.g === S.battles * 2 && Object.values(S.bring).reduce((n, b) => n + b.b, 0) === S.battles * 20, 'Draft runs record every brought character and both predictions');
  const w8 = watchBattle(data, { format: 'comp', draft: true, bring: 8, seed: 3 });
  ok(w8.drafts.every(x => x.bring.length === 8) && w8.teams.every(t => t.length === 6), 'Bring 8, pick 6 works');
  const w = watchBattle(data, { format: 'comp', draft: true, seed: 5 });
  ok(w.drafts.every(x => x.bring.filter(b => LEG(b)).length <= 5), 'A brought 10 holds at most 5 legendaries or mythicals');
  ok(Object.keys(S.leadPair).length && Object.values(S.leadPair).reduce((n, v) => n + v.g, 0) === S.battles * 2, 'Draft runs record both opening pairs of every battle');
  ok(Object.keys(S.core).every(k => /^[^|]+([>+])[^|]+\|\w+$/.test(k)), 'Cores are recorded as enabler>partner or a+b with their kind', Object.keys(S.core)[0]);
}

// meta summary: categories from hand-made totals
{
  const byKey = new Map([['a', { name: 'A' }], ['b', { name: 'B' }], ['c', { name: 'C' }], ['d', { name: 'D' }], ['l', { name: 'L', rarity: 'legendary' }]]);
  const S = {
    bring: { a: { b: 40, p: 40, pw: 22, lead: 10 }, b: { b: 40, p: 30, pw: 12, lead: 5 }, c: { b: 40, p: 10, pw: 4, lead: 1 }, d: { b: 40, p: 35, pw: 20, lead: 5 }, l: { b: 30, p: 20, pw: 12, lead: 4 } },
    core: { 'a>b|tailwind': { g: 12, w: 9 }, 'a>d|tailwind': { g: 10, w: 6 }, 'a>l|tailwind': { g: 8, w: 5 }, 'c>b|redirect': { g: 8, w: 7 }, 'b+d|cover': { g: 10, w: 5 } },
    leadPair: { 'a+b': { g: 12, w: 8 } },
    vsChar: { 'c>d': { g: 10, w: 9 }, 'b>a': { g: 10, w: 5 } },
    item: { 'a|calm-incense': { g: 30, w: 16 } }, nature: { 'a|spe-pow|support': { g: 30, w: 16 } },
  };
  const m = metaSummary(S, { byKey, minGames: 8 });
  ok(m.cores.find(c => c.keys.join('+') === 'a+b')?.label === 'Tailwind' && m.cores.every((c, i) => !i || m.cores[i - 1].sure >= c.sure), 'Cores carry their kind, surest first', m.cores);
  ok(m.general.length === 1 && m.general[0].key === 'a' && m.general[0].partners === 3, 'A support with 3 partners that wins is a general support', m.general);
  ok(m.specific.some(x => x.key === 'c' && x.top.key === 'b'), 'A support that wins far more with one partner is a specific support', m.specific);
  ok(m.answers.length === 1 && m.answers[0].key === 'c' && m.answers[0].vs === 'd', 'A rarely picked character that beats a popular one is an answer', m.answers);
  ok(m.legends[0].key === 'l' && m.legends[0].core?.with === 'a', 'Legendaries show their pick rate and core', m.legends);
  ok(m.builds[0].item.id === 'calm-incense' && m.builds[0].nature.id.preset === 'support', 'Common builds show the most used item and nature');
  ok(!m.hasTeams && /## Cores/.test(m.markdown) && /\| A \+ B \| Tailwind \|/.test(m.markdown), 'The summary renders as Markdown');
  const t = metaSummary(S, { byKey, minGames: 8, teams: [{ keys: ['a', 'b', 'd'], wr: 0.6, g: 20 }] });
  ok(t.best[0].cores.some(c => c.keys.join('+') === 'a+b'), 'Best teams list the cores inside them');
}

if (fails) { console.log(fails, 'failed'); process.exit(1); }
console.log('all passed');
