const TYPES = ['Fire', 'Water', 'Ice', 'Wind', 'Earth', 'Lightning', 'Light', 'Dark',
  'Spirit', 'Cosmic', 'Time', 'Tech', 'Beast', 'Blood', 'Neutral'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
// Encounter tiers: where and when a character can be met. Team-only, never shown to players.
const RARITY = [['starter', 'Starter'], ['first-route', 'First route'], ['pre-mid', 'Pre-mid'], ['mid', 'Mid'],
  ['post-mid', 'Post-mid'], ['pseudo', 'Pseudo'], ['mythical', 'Mythical'], ['legendary', 'Legendary']];
const RARITY_NOTE = {
  starter: 'Picked at the start of the game. Never met in frays.',
  'first-route': 'The first route or two. Low ceiling, though a few have a niche build.',
  'pre-mid': 'Frays opened by the early cities.',
  mid: 'Frays in the middle cities.',
  'post-mid': 'Late routes before the Circle.',
  pseudo: 'Rare in late frays. Weak first form, slow to grow, final form rivals legendaries.',
  mythical: 'Special one-offs, weaker than legendaries. Most come after beating the game.',
  legendary: 'Legendary patches after beating the game. Strongest form only.',
};
// What "early" means for each tier that can have it.
const EARLY = { mythical: 'Can be found before the post-game', legendary: 'Very rare chance after post-mid' };
const rarityName = r => RARITY.find(x => x[0] === r)?.[1] ?? 'No tier yet';
const REPO = 'zpivill/familiar-db', FILE = 'data/characters.json';

// Two ways to save: serve.py on this computer, or straight to GitHub with a teammate's token.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
let token = null;
try { token = localStorage.getItem('gh-token'); } catch {}
const canEdit = () => LOCAL || !!token;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Every form has its own dex number. Characters are numbered tier by tier (Starter first, Legendary last, untiered at the end),
// in roster order within a tier, and an evolution gets the next number after its base form.
const tierRank = c => { const k = RARITY.findIndex(r => r[0] === c.rarity); return k < 0 ? RARITY.length : k; };
let dexCache = { sig: null, start: [] };
const dex = (i, j = 0) => {
  const sig = roster.map(c => (c.rarity || '') + c.stages.length).join();
  if (dexCache.sig !== sig) {
    const start = [];
    let n = 1;
    roster.map((c, k) => k).sort((a, b) => tierRank(roster[a]) - tierRank(roster[b]) || a - b)
      .forEach(k => { start[k] = n; n += roster[k].stages.length; });
    dexCache = { sig, start };
  }
  return dexCache.start[i] + j;
};
const num = (i, j = 0) => '#' + String(dex(i, j)).padStart(3, '0');
const numRange = i => num(i) + (roster[i].stages.length > 1 ? '–' + num(i, roster[i].stages.length - 1).slice(1) : '');
const badge = t => `<span class="type" style="--t:var(--${t})">${t}</span>`;
const dlg = $('#detail');

let roster = [];
let wiki = { pages: [] };  // Story, Gameplay, Lore and the other text pages, from data/wiki.json
let moves = [];            // generic and signature moves, from data/moves.json
const moveById = id => moves.find(m => m.id === id);
const picked = new Set();  // type chips that are on
let selected = null;       // {id, j}: the picture slot the next paste goes into
let openId = null;         // character shown in the dialog
const fresh = {};          // pictures uploaded this session, shown before the site redeploys

// ---- loading and saving ----

const toB64 = bytes => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));

function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path && '/' + path}`, {
    ...opts, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
}

// Latest roster plus the version it came from, so a save never overwrites a teammate's.
async function latest() {
  if (LOCAL || !token) {
    const r = await fetch(FILE, { cache: 'no-store' });
    return { data: await r.json() };
  }
  const r = await gh('contents/' + FILE);
  if (!r.ok) throw new Error('GitHub said ' + r.status);
  const j = await r.json();
  return { data: JSON.parse(fromB64(j.content)), sha: j.sha };
}

async function store(data, sha, message) {
  const body = JSON.stringify(data, null, 2) + '\n';
  if (LOCAL) return (await fetch('api/characters', { method: 'PUT', body })).ok;
  const r = await gh('contents/' + FILE, {
    method: 'PUT', body: JSON.stringify({ message, sha, content: toB64(new TextEncoder().encode(body)) }),
  });
  return r.ok;  // 409 means someone else saved first: the caller retries on their version
}

// Apply one edit to the newest roster and save it.
async function commit(message, edit) {
  try {
    for (let tries = 0; tries < 3; tries++) {
      const { data, sha } = await latest();
      if (edit(data) === false) return;
      if (await store(data, sha, message)) { roster = data; return render(); }
    }
  } catch {}
  alert(LOCAL ? 'Could not save. Is serve.py running?' : 'Could not save to GitHub. Check that you are signed in and added to the repo.');
}

async function uploadImage(path, file) {
  const content = toB64(new Uint8Array(await file.arrayBuffer()));
  if (LOCAL) return (await fetch('api/' + path, { method: 'PUT', body: file })).ok;
  return (await gh('contents/' + path, { method: 'PUT', body: JSON.stringify({ message: 'Add picture ' + path, content }) })).ok;
}

const imgSrc = path => fresh[path] || (LOCAL ? path : `https://raw.githubusercontent.com/${REPO}/main/${path}`);
const find = (data, id) => data.find(c => c.id === id);

// ---- filtering and sorting ----

function stageMatches(s) {
  const kind = $('#kind').value;
  if (kind === 'mono' && s.types.length !== 1) return false;
  if (kind === 'dual' && s.types.length !== 2) return false;
  return [...picked].every(t => s.types.includes(t));
}

function charMatches(c) {
  const side = $('#side').value, q = $('#search').value.trim().toLowerCase();
  if (side === 'heroes' && c.villain) return false;
  if (side === 'villains' && !c.villain) return false;
  if (side === 'gags' && !c.gag) return false;
  const rarity = $('#rarity').value;
  if (rarity !== 'all' && (c.rarity || '') !== rarity) return false;
  return !q || [c.name, c.anime, ...c.stages.map(s => s.name)].some(x => x.toLowerCase().includes(q));
}

function entries() {
  const out = [];
  roster.forEach((c, i) => {
    if (!charMatches(c)) return;
    const hits = c.stages.map((s, j) => ({ c, s, i, j })).filter(e => stageMatches(e.s));
    // Evolutions of the same character collapse into one card unless asked for.
    if ($('#evos').checked) out.push(...hits); else if (hits[0]) out.push(hits[0]);
  });
  const key = {
    number: e => [dex(e.i, e.j)],
    name: e => [(e.s.name || e.c.name).toLowerCase()],
    type: e => [TYPES.indexOf(e.s.types[0]), TYPES.indexOf(e.s.types[1] ?? ''), dex(e.i, e.j)],
    villain: e => [e.c.villain ? 0 : 1, dex(e.i, e.j)],
    rarity: e => [RARITY.findIndex(r => r[0] === e.c.rarity) >>> 0, dex(e.i, e.j)],
  }[$('#sort').value];
  const cmp = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1; return 0; };
  return out.sort((a, b) => cmp(key(a), key(b)));
}

// ---- rendering ----

function slot(s, id, j) {
  const sel = selected && selected.id === id && selected.j === j ? ' selected' : '';
  const empty = canEdit() ? 'Click, then Ctrl+V<br>to paste a picture' : 'No picture yet';
  return `<div class="slot${sel}" data-id="${esc(id)}" data-j="${j}">${s.image ? `<img src="${esc(imgSrc(s.image))}" alt="" loading="lazy">` : empty}</div>`;
}

function card({ c, s, i, j }) {
  const forms = !$('#evos').checked && c.stages.length > 1 ? `<span class="forms">${c.stages.length} forms</span>` : '';
  return `<article class="card" data-id="${esc(c.id)}" data-j="${j}">
    ${slot(s, c.id, j)}
    <span class="num">${num(i, j)}</span>
    <span class="name">${esc(s.name || c.name)}</span>
    <span class="anime">${esc(c.anime)}</span>
    <div class="tags">${s.types.map(badge).join('')}${c.villain ? '<span class="badge villain">Villain</span>' : ''}${c.gag ? '<span class="badge gag">Gag</span>' : ''}</div>
    ${forms}
  </article>`;
}

function render() {
  document.body.classList.toggle('editing', canEdit());
  $('#signin').hidden = LOCAL || !!token;
  $('#signout').hidden = LOCAL || !token;
  const list = entries();
  $('#grid').innerHTML = list.map(card).join('') || '<p class="hint">No characters match these filters.</p>';
  $('#count').textContent = `${roster.length} characters, ${list.length} shown`;
  if (dlg.open) renderDetail();
  route();
}

function typeSelect(value, n) {
  const none = n ? '<option value="">(no 2nd type)</option>' : '';
  return `<select name="type${n}">${none}${TYPES.map(t => `<option${t === value ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
}

function renderDetail() {
  const i = roster.findIndex(c => c.id === openId), c = roster[i];
  if (!c) return dlg.close();
  const ed = canEdit(), dis = ed ? '' : ' disabled';
  dlg.innerHTML = `
    <div class="dhead">
      <span class="num">${numRange(i)}</span>
      <input name="name" value="${esc(c.name)}" placeholder="Name"${dis}>
      <input name="anime" value="${esc(c.anime)}" placeholder="Anime"${dis}>
      <label class="check"><input type="checkbox" name="villain"${c.villain ? ' checked' : ''}${dis}> Villain</label>
      <label class="check"><input type="checkbox" name="gag"${c.gag ? ' checked' : ''}${dis}> Gag</label>
      <label>Tier <select name="rarity"${dis}><option value="">No tier yet</option>${RARITY.map(([r, l]) => `<option value="${r}"${r === c.rarity ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${EARLY[c.rarity] ? `<label class="check"><input type="checkbox" name="early"${c.early ? ' checked' : ''}${dis}> ${EARLY[c.rarity]}</label>` : ''}
    </div>
    <div class="stages">${c.stages.map((s, j) => `
      <div class="stage" data-j="${j}">
        ${c.stages.length > 1 ? `<span class="arrow">${num(i, j)} · Form ${j + 1}</span>` : ''}
        ${slot(s, c.id, j)}
        <input name="stage" value="${esc(s.name)}" placeholder="${esc(c.name)}"${dis}>
        <div class="tags">${ed ? typeSelect(s.types[0], 0) + typeSelect(s.types[1], 1) : s.types.map(badge).join('')}</div>
        <button type="button" class="edit-only danger" data-act="remove-stage">Remove this form</button>
      </div>`).join('')}
    </div>
    <div class="dfoot">
      <button type="button" class="edit-only" data-act="add-stage">+ Add evolution</button>
      <button type="button" class="edit-only danger" data-act="delete">Delete character</button>
      <span class="spacer"></span>
      <button type="button" data-act="close">Close</button>
    </div>`;
}

function openDetail(id) {
  openId = id;
  renderDetail();
  if (!dlg.open) dlg.showModal();
}

function markSelected() {
  document.querySelectorAll('.slot.selected').forEach(el => el.classList.remove('selected'));
  if (selected) document.querySelectorAll(`.slot[data-id="${CSS.escape(selected.id)}"][data-j="${selected.j}"]`).forEach(el => el.classList.add('selected'));
}

// ---- pictures ----

async function setImage(id, j, file) {
  const ext = EXT[file.type];
  if (!ext) return alert('Use a PNG, JPG, WebP or GIF picture.');
  const path = `images/${id}-${Date.now().toString(36)}.${ext}`;
  if (!await uploadImage(path, file).catch(() => false)) return alert('Could not save the picture.');
  fresh[path] = URL.createObjectURL(file);
  // shortcut: a replaced picture's old file stays in images/; delete it by hand if it matters.
  commit('Set picture for ' + id, data => { const c = find(data, id); if (!c?.stages[j]) return false; c.stages[j].image = path; });
}

document.addEventListener('paste', e => {
  const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
  if (!canEdit() || !selected || !file) return;
  e.preventDefault();
  setImage(selected.id, selected.j, file);
});

document.addEventListener('dragover', e => {
  const el = e.target.closest?.('.slot');
  if (!canEdit() || !el) return;
  e.preventDefault();
  el.classList.add('drop');
});
document.addEventListener('dragleave', e => e.target.closest?.('.slot')?.classList.remove('drop'));
document.addEventListener('drop', e => {
  const el = e.target.closest?.('.slot');
  if (!canEdit() || !el) return;
  e.preventDefault();
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) setImage(el.dataset.id, +el.dataset.j, file);
});

// ---- clicks and edits ----

document.addEventListener('click', e => {
  const el = e.target.closest('.slot');
  if (el && canEdit()) {
    selected = { id: el.dataset.id, j: +el.dataset.j };
    return markSelected();
  }
  const cardEl = e.target.closest('.card');
  if (cardEl) location.hash = charLink(find(roster, cardEl.dataset.id), +cardEl.dataset.j).slice(1);
});

dlg.addEventListener('click', e => {
  const act = e.target.dataset.act, id = openId, c = find(roster, id);
  if (!act) return;
  if (act === 'close') return dlg.close();
  if (act === 'add-stage') commit('Add evolution to ' + c.name, data => { const d = find(data, id); d.stages.push({ name: '', types: [...d.stages.at(-1).types], image: '' }); });
  if (act === 'remove-stage') {
    if (c.stages.length === 1) return alert('A character needs at least one form.');
    if (!confirm('Remove this form?')) return;
    const j = +e.target.closest('.stage').dataset.j;
    selected = null;
    commit('Remove a form from ' + c.name, data => { find(data, id).stages.splice(j, 1); });
  }
  if (act === 'delete') {
    if (!confirm(`Delete ${c.name}?`)) return;
    dlg.close();
    location.hash = 'roster';
    commit('Delete ' + c.name, data => { data.splice(data.findIndex(d => d.id === id), 1); });
  }
});

dlg.addEventListener('change', e => {
  const id = openId, el = e.target, stage = el.closest('.stage'), j = stage && +stage.dataset.j;
  let edit;
  if (el.name === 'name' || el.name === 'anime') { const v = el.value.trim(); edit = c => { c[el.name] = v; }; }
  else if (el.name === 'rarity') { const v = el.value; edit = c => { if (v) c.rarity = v; else delete c.rarity; if (!EARLY[v]) delete c.early; }; }
  else if (el.name === 'early') { const v = el.checked; edit = c => { if (v) c.early = true; else delete c.early; }; }
  else if (el.type === 'checkbox') { const v = el.checked; edit = c => { c[el.name] = v; }; }
  else if (el.name === 'stage') { const v = el.value.trim(); edit = c => { c.stages[j].name = v; }; }
  else if (el.name.startsWith('type')) {
    const [a, b] = stage.querySelectorAll('select');
    const types = [...new Set([a.value, b.value].filter(Boolean))];
    edit = c => { c.stages[j].types = types; };
  }
  if (edit) commit('Edit ' + find(roster, id).name, data => { const c = find(data, id); if (!c) return false; edit(c); });
});

dlg.addEventListener('close', () => { openId = null; selected = null; });

$('#add').addEventListener('click', () => {
  const id = 'c' + Date.now().toString(36);
  commit('Add a character', data => {
    data.push({ id, name: 'New character', anime: '', villain: false, gag: false, stages: [{ name: '', types: ['Neutral'], image: '' }] });
  }).then(() => { if (find(roster, id)) { location.hash = 'c/' + id; openDetail(id); } });
});

// ---- signing in (hosted site only) ----

$('#signin').addEventListener('click', async () => {
  const t = prompt('Paste your GitHub token. To make one, click the "How to edit" link next to this button.');
  if (!t) return;
  token = t.trim();
  const r = await gh('').catch(() => null);
  const repo = r?.ok ? await r.json() : null;
  if (!repo?.permissions?.push) {
    token = null;
    return alert('That token can\'t edit familiar-db. Check that the owner added you to the repo and that the token has the "public_repo" box ticked.');
  }
  try { localStorage.setItem('gh-token', token); } catch {}
  load();
});
$('#signout').addEventListener('click', () => {
  token = null;
  try { localStorage.removeItem('gh-token'); } catch {}
  render();
});

// ---- filters ----

$('#types').innerHTML = TYPES.map(t => `<button type="button" class="type" data-type="${t}" style="--t:var(--${t})">${t}</button>`).join('');
$('#types').addEventListener('click', e => {
  const t = e.target.dataset.type;
  if (!t) return;
  if (picked.has(t)) picked.delete(t);
  else {
    if (picked.size === 2) picked.delete([...picked][0]);  // two types = one exact dual combo
    picked.add(t);
  }
  e.currentTarget.querySelectorAll('.type').forEach(b => b.classList.toggle('on', picked.has(b.dataset.type)));
  render();
});
$('#rarity').innerHTML = '<option value="all">Every tier</option>' + RARITY.map(([r, l]) => `<option value="${r}">${l}</option>`).join('');
['#search', '#kind', '#side', '#rarity', '#sort', '#evos'].forEach(s => $(s).addEventListener('input', render));
$('#clear').addEventListener('click', () => {
  picked.clear();
  document.querySelectorAll('#types .on').forEach(b => b.classList.remove('on'));
  $('#search').value = '';
  $('#kind').value = $('#side').value = $('#rarity').value = 'all';
  render();
});

// ---- pages: home hub, roster tabs, wiki pages ----

// Every page has its own link: #home, #roster, #roster-types, #lore and so on.
const TABS = [
  ['roster', 'Characters'], ['roster-types', 'Types'], ['roster-anime', 'Anime'],
  ['roster-villains', 'Villains & gags'], ['roster-rarity', 'Rarity'], ['roster-stats', 'Stats'],
];
const PITCH = 'A Pokémon-style story RPG on near-future Earth, where anime characters have been re-imagined into the real world.';
const finalTypes = c => c.stages.at(-1).types;
const typeCount = t => roster.filter(c => finalTypes(c).includes(t)).length;
const animeList = () => {
  const m = new Map();
  roster.forEach(c => m.set(c.anime, (m.get(c.anime) || 0) + 1));
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

function route() {
  const id = location.hash.slice(1) || 'home';
  const page = wiki.pages.find(p => p.id === id);
  const tab = TABS.find(t => t[0] === id);
  // A character's page is #c/<id>, or #c/<id>/<form> for a later form.
  const [, cid, form] = id.match(/^c\/([^/]+)(?:\/(\d+))?$/) || [];
  const ci = cid ? roster.findIndex(c => c.id === cid) : -1;
  const where = tab ? 'roster' : page ? 'wiki' : ci >= 0 ? 'char' : id === 'moves' ? 'moves' : id === 'sim' ? 'sim' : 'home';
  ['home', 'roster', 'wiki', 'char', 'moves', 'sim'].forEach(p => { $('#' + p).hidden = p !== where; });
  $('#crumb').innerHTML = where === 'home' ? ''
    : where === 'char' ? `<a href="#home">Home</a> / <a href="#roster">Roster</a> / <span>${esc(roster[ci].name)}</span>`
    : `<a href="#home">Home</a> / <span>${esc(tab ? 'Roster' : page ? page.title : where === 'sim' ? 'Battle simulator' : 'Moves')}</span>`;
  if (where === 'home') renderHome();
  if (where === 'wiki') renderPage(page);
  if (where === 'roster') renderTab(id);
  if (where === 'moves') renderMoves();
  if (where === 'sim' && typeof renderSim === 'function') renderSim();
  if (where === 'char') renderChar(ci, Math.min(Math.max((+form || 1) - 1, 0), roster[ci].stages.length - 1));
}

// ---- character pages, laid out like a pokemondb entry ----

// Power and Guard are the physical side, Energy and Will the energy side (ki, chakra, cursed energy, magic).
const STATS = [['vit', 'Vitality'], ['pow', 'Power'], ['grd', 'Guard'], ['ene', 'Energy'], ['wil', 'Will'], ['spe', 'Speed']];
const STAT_MAX = 255;
const tbd = '<span class="tbd">TBD</span>';
const dash = v => v ?? '—';
// A learned move shows its anime name with the generic move in brackets, so its scale is obvious.
const moveName = (m, as) => as && as !== m.name ? `<b>${esc(as)}</b> <span class="hint">(${esc(m.name)})</span>` : `<b>${esc(m.name)}</b>`;
const moveCells = m => `<td>${badge(m.type)}</td><td>${m.category}</td>
  <td class="sv">${m.power ?? (m.category === 'Status' ? '—' : 'Varies')}</td><td class="sv">${m.accuracy ?? (m.category === 'Status' ? '—' : 'Never misses')}</td><td class="sv">${m.pp}</td>`;
const lvOrder = lv => lv === 'evo' ? 1.5 : lv;
// Every place a generic move is learned under another name: Map of move id -> [{as, c, j}].
function renames() {
  const out = new Map();
  roster.forEach(c => c.stages.forEach((s, j) => (s.learn || []).forEach(e => {
    if (!e.as) return;
    const list = out.get(e.move) || out.set(e.move, []).get(e.move);
    if (!list.some(x => x.as === e.as && x.c === c)) list.push({ as: e.as, c, j });
  })));
  return out;
}
const ROLE_NOTE = 'Hidden roles: what the team intends this character to be good at, for balancing. Never shown to players, and not a limit on how they can be played.';
const charLink = (c, j) => '#c/' + c.id + (j ? '/' + (j + 1) : '');

function renderChar(i, j) {
  const c = roster[i], s = c.stages[j];
  // Prev and next go by dex number, so they walk forms one by one like the dex does.
  const order = roster.flatMap((d, k) => d.stages.map((_, m) => [k, m])).sort((a, b) => dex(...a) - dex(...b));
  const at = order.findIndex(([k, m]) => k === i && m === j);
  const step = d => { const [k, m] = order[(at + d + order.length) % order.length]; const x = roster[k];
    return `<a href="${charLink(x, m)}">${d < 0 ? '← ' : ''}${num(k, m)} ${esc(x.stages[m].name || x.name)}${d > 0 ? ' →' : ''}</a>`; };

  const tabs = c.stages.length > 1 ? `<nav class="formtabs" aria-label="Forms">${c.stages.map((f, m) =>
    `<a href="${charLink(c, m)}"${m === j ? ' aria-current="page"' : ''}>${esc(f.name || c.name)}</a>`).join('')}</nav>` : '';

  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const tier = rarityName(c.rarity) + (c.early && EARLY[c.rarity] ? ` <span class="hint">(${EARLY[c.rarity].toLowerCase()})</span>` : '');
  const data = `<table class="vitals">
    ${row('Dex no.', `<b>${num(i, j)}</b>`)}
    ${row('Type', s.types.map(badge).join(' '))}
    ${row('Anime', esc(c.anime) || tbd)}
    ${row('Form', c.stages.length > 1 ? `${j + 1} of ${c.stages.length}` : 'Only form')}
    ${row('Side', [c.villain && '<span class="badge villain">Villain</span>', c.gag && '<span class="badge gag">Gag</span>'].filter(Boolean).join(' ') || 'Hero')}
    ${row('Encounter tier', tier + ' <span class="badge plan">Team only</span>')}
    ${row('Hidden roles', c.roles?.length ? `${c.roles.map(r => `<span class="badge role">${esc(r)}</span>`).join(' ')} <span class="badge plan" title="${esc(ROLE_NOTE)}">Team only</span>${c.roleNote ? `<br><span class="hint">${esc(c.roleNote)}</span>` : ''}` : tbd)}
  </table>`;

  // Abilities, moves and stats are placeholders until they are filled in data/characters.json.
  // A form can have its own abilities; otherwise it uses the character's.
  const abilities = s.abilities?.length ? s.abilities : c.abilities?.length ? c.abilities : [{}, { hidden: true }];
  const abil = `<table class="vitals">${abilities.map((a, k) =>
    row(a.hidden ? 'Hidden ability' : `Ability ${k + 1}`, a.name ? `<b>${esc(a.name)}</b>${a.text ? `<br><span class="hint">${esc(a.text)}</span>` : ''}${a.like ? `<br><small class="like">Works like ${esc(a.like)}</small>` : ''}` : tbd)).join('')}</table>`;

  const stats = s.stats || {};
  const known = STATS.every(([k]) => typeof stats[k] === 'number');
  const total = STATS.reduce((n, [k]) => n + (stats[k] || 0), 0);
  const statRows = STATS.map(([k, l]) => { const v = stats[k];
    return `<tr><th>${l}</th><td class="sv">${v ?? '—'}</td><td class="sb">${v ? `<em style="width:${v / STAT_MAX * 100}%"></em>` : ''}</td></tr>`; }).join('');
  const statTable = `<table class="basestats">${statRows}<tr class="total"><th>Total</th><td class="sv">${known ? total : '—'}</td><td></td></tr></table>`;

  // The signature is always equipped; the other four slots are picked from what this form learns by level.
  const sig = moveById(s.signature);
  const sigRow = sig ? `<tr class="sig"><td class="sv">—</td><td><b>${esc(sig.name)}</b> <span class="badge sigb">Signature</span>
      ${sig.effect ? `<br><span class="hint">${esc(sig.effect)}</span>` : ''}${sig.source ? `<br><small class="like">From: ${esc(sig.source)}</small>` : ''}</td>${moveCells(sig)}</tr>`
    : `<tr class="sig"><td class="sv">—</td><td>${tbd} <span class="badge sigb">Signature</span></td><td>—</td><td>—</td><td class="sv">—</td><td class="sv">—</td><td class="sv">—</td></tr>`;
  const learnRows = (s.learn || []).slice().sort((a, b) => lvOrder(a.lv) - lvOrder(b.lv)).map(e => {
    const m = moveById(e.move);
    if (!m) return '';
    const off = !s.types.includes(m.type) && m.type !== 'Neutral';
    return `<tr><td class="sv">${e.lv === 'evo' ? 'Evo.' : e.lv}</td><td>${moveName(m, e.as)}${off ? ` <span class="badge off" title="${esc(e.why || '')}">Off-type</span>` : ''}
      ${m.effect ? `<br><span class="hint">${esc(m.effect)}</span>` : ''}${off && e.why ? `<br><small class="like">${esc(e.why)}</small>` : ''}</td>${moveCells(m)}</tr>`;
  }).join('');

  const evo = c.stages.length > 1
    ? `<div class="evoline">${c.stages.map((f, m) => `${m ? '<span class="evoarrow" aria-hidden="true">→</span>' : ''}
        <a class="evo${m === j ? ' here' : ''}" href="${charLink(c, m)}">
          <span class="evopic">${f.image ? `<img src="${esc(imgSrc(f.image))}" alt="" loading="lazy">` : ''}</span>
          <span class="num">${num(i, m)}</span><b>${esc(f.name || c.name)}</b>
          <span class="tags">${f.types.map(badge).join('')}</span>
          ${f.level ? `<small class="hint">Evolves at Lv. ${f.level}</small>` : ''}${f.evolve ? `<small class="hint">${esc(f.evolve)}</small>` : ''}
        </a>`).join('')}</div>`
    : `<p class="hint">${esc(c.name)} does not evolve.</p>`;

  $('#char').innerHTML = `
    <nav class="prevnext">${step(-1)}<span class="spacer"></span>${step(1)}</nav>
    <div class="chead"><h1>${esc(s.name || c.name)}</h1>
      <button type="button" class="edit-only" data-edit-char="${esc(c.id)}">Edit character</button></div>
    ${tabs}
    <div class="ctop">
      <div class="cpic">${slot(s, c.id, j)}</div>
      <section><h2>Familiar data</h2>${data}</section>
      <section><h2>Abilities</h2>${abil}<p class="hint">Passive traits. Each caught copy has one of the first two, or rarely the hidden one.</p></section>
    </div>
    <section><h2>Base stats</h2>${statTable}
      <p class="hint">${known ? '' : 'No numbers yet. '}Bars are out of ${STAT_MAX}.</p></section>
    <section><h2>Evolution line</h2>${evo}</section>
    <section><h2>Moves</h2>
      <p class="hint">The signature is always equipped. The other four slots are picked from the moves below, learned by level (Evo. means on evolving into this form). See every move on the <a href="#moves">Moves page</a>.</p>
      <div class="scroll"><table class="moves"><thead><tr><th>Lv.</th><th>Move</th><th>Type</th><th>Category</th><th>Power</th><th>Acc.</th><th>PP</th></tr></thead>
      <tbody>${sigRow}${learnRows || `<tr><td></td><td colspan="6">${tbd}</td></tr>`}</tbody></table></div></section>`;
  markSelected();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-edit-char]');
  if (b) openDetail(b.dataset.editChar);
});

const written = p => p.sections.reduce((n, s) => n + s.items.filter(i => i.n).length, 0);

function renderHome() {
  const tile = (href, title, sub, meta) => `<a class="tile" href="#${href}"><strong>${esc(title)}</strong><span>${esc(sub)}</span><small>${esc(meta)}</small></a>`;
  const pages = wiki.pages.map(p => tile(p.id, p.title, p.blurb,
    p.soon ? 'Coming soon' : written(p) ? `${written(p)} entries` : 'Template, not written yet'));
  $('#home').innerHTML = `
    <p class="pitch">${PITCH}</p>
    <div class="tiles">
      ${tile('roster', 'Roster', 'Every familiar, their types, forms, villains and gags.', `${roster.length} characters`)}
      ${tile('moves', 'Moves', 'Every move: generic moves with each character\'s name for them, and signature moves.', `${moves.length} moves`)}
      ${tile('sim', 'Battle simulator', 'AI against AI in batches of thousands, with win rates per character, ability, move, type and team.', 'For balancing')}
      ${pages.join('')}
    </div>
    <p class="hint">Only settled things go on these pages. Ideas still being discussed stay in the game map.${wiki.updated ? ` Text pages last updated ${esc(wiki.updated)}.` : ''}</p>`;
}

function renderPage(p) {
  const slug = s => p.id + '-' + s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const body = p.soon ? `<p class="soon">${esc(p.soon)}</p>` : p.sections.map(s => `
    <section id="${slug(s)}"><h2>${esc(s.title)}</h2><dl>${s.items.map(i => `
      <div><dt>${esc(i.t)}${i.plan ? ' <span class="badge plan">Plan</span>' : ''}</dt>${i.n ? `<dd>${esc(i.n)}</dd>` : '<dd class="tbd">Not written yet</dd>'}</div>`).join('')}
    </dl></section>`).join('');
  const toc = p.sections.length > 1 ? `<nav class="toc" aria-label="On this page">${p.sections.map(s =>
    `<a href="#${p.id}" data-jump="${slug(s)}">${esc(s.title)}</a>`).join('')}</nav>` : '';
  $('#wiki').innerHTML = `<div class="article"><h1>${esc(p.title)}</h1><p class="lead">${esc(p.blurb)}</p>
    ${p.note ? `<p class="hint">${esc(p.note)}</p>` : ''}${body}</div>${toc}`;
}

function renderTab(id) {
  $('#tabs').innerHTML = TABS.map(([t, label]) => `<a href="#${t}"${t === id ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const chars = id === 'roster';
  $('#tab-characters').hidden = $('#grid').hidden = !chars;
  $('#tab-view').hidden = chars;
  if (chars) return;
  let html = '';
  if (id === 'roster-types') {
    html = `<p class="hint">Counts use each character's final form; dual types count for both. Click a type to see its characters.</p>
      <div class="typegrid">${TYPES.map(t => `<button type="button" data-show-type="${t}" style="--t:var(--${t})"><b>${t}</b>${typeCount(t)} characters</button>`).join('')}</div>`;
  }
  if (id === 'roster-anime') {
    const list = animeList();
    html = `<p class="hint">${list.length} shows. Click one to see its characters.</p>
      <div class="alist">${list.map(([a, n]) => `<button type="button" data-show-anime="${esc(a)}"><span>${esc(a)}</span><span>${n}</span></button>`).join('')}</div>`;
  }
  if (id === 'roster-villains') {
    const grid = f => roster.map((c, i) => ({ c, s: c.stages[0], i, j: 0 })).filter(e => f(e.c)).sort((a, b) => dex(a.i) - dex(b.i)).map(card).join('');
    html = `<h2>Villains <span class="hint">${roster.filter(c => c.villain).length}</span></h2><div class="grid">${grid(c => c.villain)}</div>
      <h2>Gag characters <span class="hint">${roster.filter(c => c.gag).length}</span></h2><div class="grid">${grid(c => c.gag)}</div>`;
  }
  if (id === 'roster-rarity') {
    const grid = cs => cs.map(c => ({ c, s: c.stages[0], i: roster.indexOf(c), j: 0 })).sort((a, b) => dex(a.i) - dex(b.i)).map(card).join('');
    const tiers = [...RARITY, ['', 'No tier yet']].map(([r, l]) => {
      const cs = roster.filter(c => (c.rarity || '') === r);
      if (!cs.length && !r) return '';
      const early = EARLY[r] ? cs.filter(c => c.early) : [];
      return `<h2>${l} <span class="hint">${cs.length}</span></h2><p class="hint">${esc(RARITY_NOTE[r] ?? 'Not sorted into a tier yet.')}</p>
        ${early.length ? `<p class="hint"><b>${EARLY[r]}:</b> ${early.map(c => esc(c.name)).join(', ')}.</p>` : ''}
        <div class="grid">${grid(cs)}</div>`;
    });
    html = `<p class="hint">Hidden encounter tiers: where and when each character can be met as the player progresses, like Pokémon's route tables. Players never see these. A tier is not a power rating.</p>${tiers.join('')}`;
  }
  if (id === 'roster-stats') {
    const forms = roster.reduce((n, c) => n + c.stages.length, 0);
    const dual = roster.filter(c => finalTypes(c).length === 2).length;
    const evo = roster.filter(c => c.stages.length > 1).length;
    const counts = TYPES.map(t => [t, typeCount(t)]).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...counts.map(x => x[1]));
    const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
    html = `<div class="stats">${stat(roster.length, 'characters')}${stat(forms, 'forms')}${stat(dual, 'end dual-type')}${stat(roster.length - dual, 'end mono-type')}${stat(evo, 'evolve')}${stat(animeList().length, 'shows')}</div>
      <h2>Characters per type</h2><p class="hint">Final forms; dual types count for both.</p>
      <div class="bars">${counts.map(([t, n]) => `<div><span>${t}</span><em style="--t:var(--${t});width:${n / max * 100}%"></em><span>${n}</span></div>`).join('')}</div>`;
  }
  $('#tab-view').innerHTML = html;
}

// ---- moves page ----

const SIZES = [['light', 'Light', 'Power 40–60, 20–30 uses, often a side effect.'], ['standard', 'Standard', 'Power 70–90, 10–15 uses.'],
  ['heavy', 'Heavy', 'Power 100–120, 5–8 uses, usually a drawback.'], ['status', 'Status', 'No damage.'], ['signature', 'Signature', 'Set per character, 1–5 uses.']];
const STATUSES = [['Burn', 'Fire', 'Lowers Power and takes a little Vitality each turn.'], ['Freeze', 'Ice', 'Can\'t act; thaws over a few turns.'],
  ['Stun', 'Lightning', 'May lose a turn; lowers Speed.'], ['Bleed', 'Blood', 'Takes damage each turn, growing every turn.'],
  ['Curse', 'Spirit, Dark', 'Lowers Energy and Will.'], ['Sleep', 'Mostly Neutral, Cosmic', 'Can\'t act for a few turns.'],
  ['Confuse', 'Time, Wind', 'May hit itself instead of attacking.']];
let moveType = '';

function renderMoves() {
  const names = renames();
  const sizeName = k => SIZES.find(x => x[0] === k)?.[1] ?? k;
  const shown = m => !moveType || m.type === moveType;
  const generic = moves.filter(m => !m.signature && shown(m));
  const sigs = moves.filter(m => m.signature && shown(m));
  const head = '<thead><tr><th>Move</th><th>Type</th><th>Category</th><th>Power</th><th>Acc.</th><th>PP</th></tr></thead>';
  const genRows = TYPES.map(t => generic.filter(m => m.type === t)).filter(l => l.length).map(list => list.map(m => {
    const as = names.get(m.id) || [];
    return `<tr><td><b>${esc(m.name)}</b> <span class="badge">${sizeName(m.size)}</span>${m.basic ? ' <span class="badge">Basic</span>' : ''}
      ${m.effect ? `<br><span class="hint">${esc(m.effect)}</span>` : ''}
      ${as.length ? `<div class="knownas">Known as: ${as.map(x => `<a href="${charLink(x.c, x.j)}">${esc(x.as)}</a> <span class="hint">(${esc(x.c.name)})</span>`).join(', ')}</div>` : ''}</td>${moveCells(m)}</tr>`;
  }).join('')).join('');
  const sigRows = sigs.map(m => {
    const c = find(roster, m.owner), f = c?.stages[m.form || 0];
    return `<tr class="sig"><td><b>${esc(m.name)}</b>${c ? ` <span class="hint">· <a href="${charLink(c, m.form || 0)}">${esc(f.name || c.name)}</a></span>` : ''}
      ${m.effect ? `<br><span class="hint">${esc(m.effect)}</span>` : ''}${m.source ? `<br><small class="like">From: ${esc(m.source)}</small>` : ''}</td>${moveCells(m)}</tr>`;
  }).join('');
  $('#moves').innerHTML = `<div class="article"><h1>Moves</h1>
    <p class="lead">Each character equips four moves learned by level, plus one signature that is always equipped.</p>
    <p class="hint">Characters use moves of their own types plus Neutral moves, and an off-type move only with a reason from their anime. Own-type moves do 1.5x. Generic moves are listed once under a plain name, with every character's name for them under "Known as". Basic moves can be learned without a new name.</p>
    <h2>Move sizes</h2><dl>${SIZES.map(([, l, n]) => `<div><dt>${l}</dt><dd>${n}</dd></div>`).join('')}</dl>
    <h2>Status effects</h2><dl>${STATUSES.map(([n, t, d]) => `<div><dt>${n} <span class="hint">${t}</span></dt><dd>${d}</dd></div>`).join('')}</dl>
    <label>Type <select id="movetype"><option value="">Every type</option>${TYPES.map(t => `<option${t === moveType ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <h2>Signature moves <span class="hint">${sigs.length}</span></h2>
    <div class="scroll"><table class="moves">${head}<tbody>${sigRows || '<tr><td colspan="6" class="tbd">None yet</td></tr>'}</tbody></table></div>
    <h2>Moves <span class="hint">${generic.length}</span></h2>
    <div class="scroll"><table class="moves">${head}<tbody>${genRows || '<tr><td colspan="6" class="tbd">None yet</td></tr>'}</tbody></table></div>
  </div>`;
}
document.addEventListener('change', e => { if (e.target.id === 'movetype') { moveType = e.target.value; renderMoves(); } });

// Types and Anime tabs hand off to the Characters tab with the filter set.
document.addEventListener('click', e => {
  const t = e.target.closest('[data-show-type]'), a = e.target.closest('[data-show-anime]'), j = e.target.closest('[data-jump]');
  if (j) { e.preventDefault(); return document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth' }); }
  if (!t && !a) return;
  $('#clear').click();
  if (t) { picked.add(t.dataset.showType); $('#types').querySelector(`[data-type="${t.dataset.showType}"]`).classList.add('on'); }
  if (a) $('#search').value = a.dataset.showAnime;
  render();
  location.hash = 'roster';
});
addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

function load() {
  latest().then(({ data }) => { roster = data; render(); })
    .catch(() => alert('Could not load the roster from GitHub. Try signing out and in again.'));
}
fetch('data/wiki.json', { cache: 'no-store' }).then(r => r.json()).then(w => { wiki = w; route(); }).catch(() => {});
fetch('data/moves.json', { cache: 'no-store' }).then(r => r.json()).then(m => { moves = m.moves; route(); }).catch(() => {});
load();
