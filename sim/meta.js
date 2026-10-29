// The meta summary for Competitive doubles runs with the draft: how the meta is shaped, from the run's
// running totals. Pure functions, used by the Simulator page's Meta tab and by the tests.
//
// S: merged run stats (bring, core, leadPair, vsChar, nature, item, ...).
// ctx: { byKey: Map(key -> { name, rarity }), teams: [{ keys, wr, g }] from a team search (optional),
//        minGames, title, fmt: { item, nature, preset } name functions for the Markdown }.

const LEGEND = new Set(['legendary', 'mythical']);
export const CORE_KINDS = {
  tailwind: 'Tailwind', trickRoom: 'Trick Room', redirect: 'Redirection + setup', helping: 'Helping Hand',
  field: 'Field', screens: 'Screens + setup', cover: 'Type cover',
};

// 95% margin of a win rate, smoothed like the rest of the page.
const margin = (p, n) => { if (!n) return 1; const q = (p * n + 1) / (n + 2); return 1.96 * Math.sqrt(q * (1 - q) / n); };
const sure = (w, g) => g ? w / g - margin(w / g, g) : -1;

export function metaSummary(S, ctx) {
  const name = k => ctx.byKey.get(k)?.name || k;
  const min = Math.max(5, ctx.minGames || 5);
  const bring = S.bring || {};
  const picked = k => bring[k]?.p || 0;
  const pickedWr = k => bring[k]?.p ? bring[k].pw / bring[k].p : 0.5;

  // cores: pairs the draft picked together because they work together, by kind
  // keys are enabler>partner|kind (Tailwind setter, redirector...) or a+b|cover
  const pairs = {}, enables = {};
  for (const [k, v] of Object.entries(S.core || {})) {
    const [pk, kind] = k.split('|');
    const keys = pk.split(/[>+]/), pair = [...keys].sort().join('+');
    const P = pairs[pair] || (pairs[pair] = { pair, keys: pair.split('+'), g: 0, w: 0, kinds: {} });
    P.g += v.g; P.w += v.w; P.kinds[kind] = (P.kinds[kind] || 0) + v.g;
    if (pk.includes('>')) { const E = enables[keys[0]] || (enables[keys[0]] = {}), e = E[keys[1]] || (E[keys[1]] = { g: 0, w: 0 }); e.g += v.g; e.w += v.w; }
  }
  // a core needs at least 1 in 1,000 drafts behind it, so a lucky pair from a handful of games can't top a big run
  const coreMin = Math.max(min, Math.round((S.draft?.g || 0) / 1000));
  // with a team search, how often the best teams' drafts actually picked both members (teams[i].pick from the
  // run): cores the top teams really play go first
  const teams = (ctx.teams || []).slice(0, 32);
  const rate = (t, k) => t.pick?.g ? (t.pick.pick[k] || 0) / t.pick.g : null;
  const together = keys => {
    let best = null;
    teams.forEach((t, i) => {
      if (!keys.every(k => t.keys.includes(k))) return;
      const r = Math.min(...keys.map(k => rate(t, k) ?? 0));
      if (!best || r > best.rate) best = { team: i, rate: r };
    });
    return best;
  };
  const hasPicks = teams.some(t => t.pick?.g);
  const cores = Object.values(pairs).filter(p => p.g >= coreMin).map(p => {
    const kind = Object.entries(p.kinds).sort((a, b) => b[1] - a[1])[0][0];
    const wr = p.w / p.g, inTeam = hasPicks ? together(p.keys) : null;
    return { ...p, kind, label: CORE_KINDS[kind] || kind, wr, sure: sure(p.w, p.g), lift: wr - (pickedWr(p.keys[0]) + pickedWr(p.keys[1])) / 2, inTeam: inTeam && inTeam.rate >= 0.5 ? inTeam : null };
  }).sort((a, b) => (b.inTeam ? 1 : 0) - (a.inTeam ? 1 : 0) || b.sure - a.sure);

  // supports: characters that enable cores (set Tailwind or Trick Room, redirect, Helping Hand, fields, screens)
  // general: fits many partners and wins anyway; specific: wins far more with one partner than usual
  const minPair = Math.max(4, Math.round(min / 2));
  const supports = Object.entries(enables).filter(([k]) => picked(k) >= min).map(([key, E]) => {
    const ps = Object.entries(E).filter(x => x[1].g >= minPair).map(([k, e]) => ({ key: k, g: e.g, wr: e.w / e.g, sure: sure(e.w, e.g) })).sort((a, b) => b.sure - a.sure);
    const wr = pickedWr(key);
    return { key, picks: picked(key), wr, partners: Object.values(E).filter(e => e.g >= 3).length, top: ps[0] || null, gap: ps[0] ? ps[0].wr - wr : 0 };
  });
  const general = supports.filter(s => s.partners >= 3 && s.wr >= 0.5).sort((a, b) => b.partners * b.wr - a.partners * a.wr);
  const specific = supports.filter(s => s.top && s.top.wr >= 0.6 && s.gap >= 0.12).sort((a, b) => b.gap - a.gap);

  // answers: rarely picked characters that beat a popular one far more often than they usually win
  const pickCounts = Object.keys(bring).map(k => picked(k)).sort((a, b) => a - b);
  const median = pickCounts[Math.floor(pickCounts.length / 2)] || 0;
  const popular = Object.keys(bring).sort((a, b) => picked(b) - picked(a)).slice(0, 8);
  const vs = S.vsChar || {}, minVs = Math.max(4, Math.round(min / 2));
  const answers = [];
  for (const y of popular) {
    const found = [];
    for (const [k, v] of Object.entries(vs)) {
      const [x, yy] = k.split('>');
      if (yy !== y || v.g < minVs || picked(x) > median) continue;
      const wr = v.w / v.g, gap = wr - pickedWr(x);
      if (wr >= 0.55 && gap >= 0.12) found.push({ key: x, vs: y, g: v.g, wr, gap });
    }
    answers.push(...found.sort((a, b) => b.gap - a.gap).slice(0, 2));
  }

  // legendaries and mythicals: how often they make the 6 when brought, and the core they lead
  const legends = Object.entries(bring).filter(([k, v]) => LEGEND.has(ctx.byKey.get(k)?.rarity) && v.b >= min).map(([key, v]) => {
    const c = cores.find(x => x.keys.includes(key));
    return { key, b: v.b, rate: v.p / v.b, wr: v.p ? v.pw / v.p : NaN, core: c ? { with: c.keys.find(x => x !== key), label: c.label } : null };
  }).sort((a, b) => b.rate - a.rate);

  // openers
  const openers = Object.entries(S.leadPair || {}).filter(([, v]) => v.g >= min).map(([k, v]) => ({ keys: k.split('+'), g: v.g, wr: v.w / v.g, sure: sure(v.w, v.g) })).sort((a, b) => b.sure - a.sure);

  // builds: the most used item and nature for the most picked characters
  const most = (obj, key, split) => {
    let best = null;
    for (const [k, v] of Object.entries(obj || {})) { const parts = k.split('|'); if (parts[0] !== key) continue; if (!best || v.g > best.g) best = { id: split(parts), g: v.g, wr: v.w / v.g }; }
    return best;
  };
  const builds = Object.keys(bring).sort((a, b) => picked(b) - picked(a)).slice(0, 20).map(key => ({
    key, item: most(S.item, key, p => p[1]), nature: most(S.nature, key, p => ({ nature: p[1], preset: p[2] })),
  }));

  // best and niche teams, from a team search
  const inTeams = {};
  teams.forEach(t => t.keys.forEach(k => { inTeams[k] = (inTeams[k] || 0) + 1; }));
  // a best team's cores and core members are the ones its draft actually picks (half the games or more)
  const plays = (t, k) => rate(t, k) == null || rate(t, k) >= 0.5;
  const best = teams.slice(0, 5).map(t => ({ ...t, plays: t.keys.filter(k => plays(t, k)), bench: t.keys.filter(k => !plays(t, k)),
    cores: cores.filter(c => c.keys.every(k => t.keys.includes(k) && plays(t, k))).slice(0, 3) }));
  const niche = teams.slice(5).filter(t => t.wr >= 0.55 && t.keys.filter(k => (inTeams[k] || 0) <= 2).length >= 3).slice(0, 5)
    .map(t => ({ ...t, rare: t.keys.filter(k => (inTeams[k] || 0) <= 2) }));

  const out = { hasPicks, cores: cores.slice(0, 15), general: general.slice(0, 10), specific: specific.slice(0, 10), answers: answers.slice(0, 16), legends, openers: openers.slice(0, 10), builds, best, niche, hasTeams: teams.length > 0 };
  out.lead = leadLines(out, name);
  out.markdown = toMarkdown(out, name, ctx);
  return out;
}

const list = xs => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
const pct = x => Math.round(x * 100) + '%';

// A few plain sentences on the shape of the meta.
function leadLines(m, name) {
  const L = [];
  if (m.cores.length) {
    const kinds = {};
    m.cores.slice(0, 8).forEach(c => { kinds[c.label] = (kinds[c.label] || 0) + 1; });
    const top = m.cores[0];
    const where = top.inTeam ? ` and picked together in ${pct(top.inTeam.rate)} of top team ${top.inTeam.team + 1}'s drafts` : '';
    L.push(`The strongest core is ${name(top.keys[0])} + ${name(top.keys[1])} (${top.label}), winning ${pct(top.wr)} of ${top.g} games together${where}. The top cores are mostly ${list(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`))}.`);
  } else L.push('No core was picked together often enough yet. More battles, or a team search, will show them.');
  if (m.general.length) L.push(`General supports that fit many cores: ${list(m.general.slice(0, 3).map(s => `${name(s.key)} (${s.partners} partners)`))}.`);
  if (m.specific.length) L.push(`Specific supports: ${list(m.specific.slice(0, 3).map(s => `${name(s.key)} with ${name(s.top.key)} (${pct(s.top.wr)})`))}.`);
  if (m.answers.length) L.push(`Niche answers: ${list(m.answers.slice(0, 3).map(a => `${name(a.key)} beats ${name(a.vs)} (${pct(a.wr)}, +${Math.round(a.gap * 100)} over its usual)`))}.`);
  if (m.legends.length) L.push(`${name(m.legends[0].key)} is the legendary or mythical picked most often when brought (${pct(m.legends[0].rate)}).`);
  if (m.openers.length) L.push(`Best opening pair: ${name(m.openers[0].keys[0])} + ${name(m.openers[0].keys[1])} (${pct(m.openers[0].wr)} over ${m.openers[0].g} games).`);
  return L;
}

function toMarkdown(m, name, ctx) {
  const L = [`# Meta summary`, '', ctx.title || '', '', ...m.lead.map(x => `- ${x}`), ''];
  const table = (head, rows) => { if (!rows.length) return ['_None yet._', '']; return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`), '']; };
  L.push('## Best teams', '', ...(m.hasTeams ? table(['Team (brought)', 'Win %', 'Games', 'Rarely picked', 'Cores'], m.best.map(t => [t.plays.map(name).join(', '), pct(t.wr), t.g, t.bench.map(name).join(', ') || '—', t.cores.map(c => `${name(c.keys[0])} + ${name(c.keys[1])} (${c.label})`).join('; ')])) : ['_Run with Team search to rank whole teams._', '']));
  L.push('## Cores', '', ...table(['Core', 'Kind', 'Games', 'Win %', 'Vs. members alone', ...(m.hasPicks ? ['Picked together by a top team'] : [])], m.cores.map(c => [`${name(c.keys[0])} + ${name(c.keys[1])}`, c.label, c.g, pct(c.wr), `${c.lift >= 0 ? '+' : ''}${Math.round(c.lift * 100)}`, ...(m.hasPicks ? [c.inTeam ? `Team ${c.inTeam.team + 1}, ${pct(c.inTeam.rate)}` : '—'] : [])])));
  L.push('## General supports', '', ...table(['Support', 'Core partners', 'Picked', 'Win % when picked'], m.general.map(s => [name(s.key), s.partners, s.picks, pct(s.wr)])));
  L.push('## Specific supports', '', ...table(['Support', 'Best with', 'Games together', 'Win % together', 'Win % usually'], m.specific.map(s => [name(s.key), name(s.top.key), s.top.g, pct(s.top.wr), pct(s.wr)])));
  L.push('## Niche teams', '', ...(m.hasTeams ? table(['Team (brought)', 'Win %', 'Rare picks'], m.niche.map(t => [t.keys.map(name).join(', '), pct(t.wr), t.rare.map(name).join(', ')])) : ['_Run with Team search to find niche teams._', '']));
  L.push('## Answers (niche counters)', '', ...table(['Answer', 'Against', 'Games', 'Win %', 'Over its usual'], m.answers.map(a => [name(a.key), name(a.vs), a.g, pct(a.wr), `+${Math.round(a.gap * 100)}`])));
  L.push('## Legendaries and mythicals', '', ...table(['Character', 'Brought', 'Picked when brought', 'Win % when picked', 'Core'], m.legends.map(l => [name(l.key), l.b, pct(l.rate), isFinite(l.wr) ? pct(l.wr) : '—', l.core ? `with ${name(l.core.with)} (${l.core.label})` : '—'])));
  L.push('## Openers', '', ...table(['Opening pair', 'Games', 'Win %'], m.openers.map(o => [`${name(o.keys[0])} + ${name(o.keys[1])}`, o.g, pct(o.wr)])));
  const f = ctx.fmt || {}, fmt = (fn, x) => x == null ? '—' : fn ? fn(x) : x;
  L.push('## Common builds', '', ...table(['Character', 'Item', 'Nature', 'EV preset'], m.builds.filter(b => b.item || b.nature).map(b => [name(b.key), fmt(f.item, b.item?.id), fmt(f.nature, b.nature?.id.nature), fmt(f.preset, b.nature?.id.preset)])));
  return L.join('\n');
}
