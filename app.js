const TYPES = ['Fire', 'Water', 'Ice', 'Wind', 'Earth', 'Lightning', 'Light', 'Dark',
  'Spirit', 'Cosmic', 'Time', 'Tech', 'Beast', 'Blood', 'Neutral'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const REPO = 'zpivill/familiar-db', FILE = 'data/characters.json';

// Two ways to save: serve.py on this computer, or straight to GitHub with a teammate's token.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
let token = null;
try { token = localStorage.getItem('gh-token'); } catch {}
const canEdit = () => LOCAL || !!token;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = i => '#' + String(i + 1).padStart(3, '0');
const badge = t => `<span class="type" style="--t:var(--${t})">${t}</span>`;
const dlg = $('#detail');

let roster = [];
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
    number: e => [e.i, e.j],
    name: e => [(e.s.name || e.c.name).toLowerCase()],
    type: e => [TYPES.indexOf(e.s.types[0]), TYPES.indexOf(e.s.types[1] ?? ''), e.i, e.j],
    villain: e => [e.c.villain ? 0 : 1, e.i, e.j],
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
  return `<article class="card" data-id="${esc(c.id)}">
    ${slot(s, c.id, j)}
    <span class="num">${num(i)}</span>
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
      <span class="num">${num(i)}</span>
      <input name="name" value="${esc(c.name)}" placeholder="Name"${dis}>
      <input name="anime" value="${esc(c.anime)}" placeholder="Anime"${dis}>
      <label class="check"><input type="checkbox" name="villain"${c.villain ? ' checked' : ''}${dis}> Villain</label>
      <label class="check"><input type="checkbox" name="gag"${c.gag ? ' checked' : ''}${dis}> Gag</label>
    </div>
    <div class="stages">${c.stages.map((s, j) => `
      <div class="stage" data-j="${j}">
        ${c.stages.length > 1 ? `<span class="arrow">Form ${j + 1}</span>` : ''}
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
  if (cardEl) openDetail(cardEl.dataset.id);
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
    commit('Delete ' + c.name, data => { data.splice(data.findIndex(d => d.id === id), 1); });
  }
});

dlg.addEventListener('change', e => {
  const id = openId, el = e.target, stage = el.closest('.stage'), j = stage && +stage.dataset.j;
  let edit;
  if (el.name === 'name' || el.name === 'anime') { const v = el.value.trim(); edit = c => { c[el.name] = v; }; }
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
  }).then(() => { if (find(roster, id)) openDetail(id); });
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
['#search', '#kind', '#side', '#sort', '#evos'].forEach(s => $(s).addEventListener('input', render));
$('#clear').addEventListener('click', () => {
  picked.clear();
  document.querySelectorAll('#types .on').forEach(b => b.classList.remove('on'));
  $('#search').value = '';
  $('#kind').value = $('#side').value = 'all';
  render();
});

function load() {
  latest().then(({ data }) => { roster = data; render(); })
    .catch(() => alert('Could not load the roster from GitHub. Try signing out and in again.'));
}
load();
