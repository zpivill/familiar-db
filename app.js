const TYPES = ['Fire', 'Water', 'Ice', 'Wind', 'Earth', 'Lightning', 'Light', 'Dark',
  'Spirit', 'Cosmic', 'Time', 'Tech', 'Beast', 'Blood', 'Neutral'];
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
// Editing only works through serve.py on this computer; the hosted site is read-only.
const EDIT = ['localhost', '127.0.0.1'].includes(location.hostname);
document.body.classList.toggle('editing', EDIT);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = i => '#' + String(i + 1).padStart(3, '0');
const badge = t => `<span class="type" style="--t:var(--${t})">${t}</span>`;
const dlg = $('#detail');

let roster = [];
const picked = new Set();  // type chips that are on
let selected = null;       // {i, j}: the picture slot the next paste goes into
let openI = null;          // character shown in the dialog

fetch('data/characters.json', { cache: 'no-store' }).then(r => r.json()).then(d => { roster = d; render(); });

function save() {
  return fetch('api/characters', { method: 'PUT', body: JSON.stringify(roster, null, 2) })
    .then(r => { if (!r.ok) throw r; })
    .catch(() => alert('Could not save. Is serve.py running?'));
}

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

function slot(s, i, j) {
  const sel = selected && selected.i === i && selected.j === j ? ' selected' : '';
  const empty = EDIT ? 'Click, then Ctrl+V<br>to paste a picture' : 'No picture yet';
  return `<div class="slot${sel}" data-slot="${i}-${j}">${s.image ? `<img src="${esc(s.image)}" alt="">` : empty}</div>`;
}

function card({ c, s, i, j }) {
  const forms = !$('#evos').checked && c.stages.length > 1 ? `<span class="forms">${c.stages.length} forms</span>` : '';
  return `<article class="card" data-i="${i}">
    ${slot(s, i, j)}
    <span class="num">${num(i)}</span>
    <span class="name">${esc(s.name || c.name)}</span>
    <span class="anime">${esc(c.anime)}</span>
    <div class="tags">${s.types.map(badge).join('')}${c.villain ? '<span class="badge villain">Villain</span>' : ''}${c.gag ? '<span class="badge gag">Gag</span>' : ''}</div>
    ${forms}
  </article>`;
}

function render() {
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
  const c = roster[openI], dis = EDIT ? '' : ' disabled';
  dlg.innerHTML = `
    <div class="dhead">
      <span class="num">${num(openI)}</span>
      <input name="name" value="${esc(c.name)}" placeholder="Name"${dis}>
      <input name="anime" value="${esc(c.anime)}" placeholder="Anime"${dis}>
      <label class="check"><input type="checkbox" name="villain"${c.villain ? ' checked' : ''}${dis}> Villain</label>
      <label class="check"><input type="checkbox" name="gag"${c.gag ? ' checked' : ''}${dis}> Gag</label>
    </div>
    <div class="stages">${c.stages.map((s, j) => `
      <div class="stage" data-j="${j}">
        ${c.stages.length > 1 ? `<span class="arrow">Form ${j + 1}</span>` : ''}
        ${slot(s, openI, j)}
        <input name="stage" value="${esc(s.name)}" placeholder="${esc(c.name)}"${dis}>
        <div class="tags">${EDIT ? typeSelect(s.types[0], 0) + typeSelect(s.types[1], 1) : s.types.map(badge).join('')}</div>
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

function openDetail(i) {
  openI = i;
  renderDetail();
  if (!dlg.open) dlg.showModal();
}

function markSelected() {
  document.querySelectorAll('.slot.selected').forEach(el => el.classList.remove('selected'));
  if (selected) document.querySelectorAll(`[data-slot="${selected.i}-${selected.j}"]`).forEach(el => el.classList.add('selected'));
}

// ---- pictures ----

async function setImage(i, j, file) {
  const ext = EXT[file.type];
  if (!ext) return alert('Use a PNG, JPG, WebP or GIF picture.');
  const name = `${roster[i].id}-${Date.now().toString(36)}.${ext}`;
  const r = await fetch('api/images/' + name, { method: 'PUT', body: file }).catch(() => null);
  if (!r?.ok) return alert('Could not save the picture. Is serve.py running?');
  // shortcut: a replaced picture's old file stays in images/; delete it by hand if it matters.
  roster[i].stages[j].image = 'images/' + name;
  await save();
  render();
}

document.addEventListener('paste', e => {
  const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
  if (!EDIT || !selected || !file) return;
  e.preventDefault();
  setImage(selected.i, selected.j, file);
});

document.addEventListener('dragover', e => {
  const el = e.target.closest?.('.slot');
  if (!EDIT || !el) return;
  e.preventDefault();
  el.classList.add('drop');
});
document.addEventListener('dragleave', e => e.target.closest?.('.slot')?.classList.remove('drop'));
document.addEventListener('drop', e => {
  const el = e.target.closest?.('.slot');
  if (!EDIT || !el) return;
  e.preventDefault();
  const [i, j] = el.dataset.slot.split('-').map(Number);
  const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) setImage(i, j, file);
});

// ---- clicks and edits ----

document.addEventListener('click', e => {
  const el = e.target.closest('.slot');
  if (el && EDIT) {
    const [i, j] = el.dataset.slot.split('-').map(Number);
    selected = { i, j };
    return markSelected();
  }
  const cardEl = e.target.closest('.card');
  if (cardEl) openDetail(+cardEl.dataset.i);
});

dlg.addEventListener('click', e => {
  const act = e.target.dataset.act, c = roster[openI];
  if (!act) return;
  if (act === 'close') return dlg.close();
  if (act === 'add-stage') c.stages.push({ name: '', types: [...c.stages.at(-1).types], image: '' });
  if (act === 'remove-stage') {
    if (c.stages.length === 1) return alert('A character needs at least one form.');
    if (!confirm('Remove this form?')) return;
    c.stages.splice(+e.target.closest('.stage').dataset.j, 1);
    selected = null;
  }
  if (act === 'delete') {
    if (!confirm(`Delete ${c.name}?`)) return;
    roster.splice(openI, 1);
    dlg.close();
  }
  save();
  render();
});

dlg.addEventListener('change', e => {
  const c = roster[openI], el = e.target, stage = el.closest('.stage'), j = stage && +stage.dataset.j;
  if (el.name === 'name' || el.name === 'anime') c[el.name] = el.value.trim();
  else if (el.type === 'checkbox') c[el.name] = el.checked;
  else if (el.name === 'stage') c.stages[j].name = el.value.trim();
  else if (el.name.startsWith('type')) {
    const [a, b] = stage.querySelectorAll('select');
    c.stages[j].types = [...new Set([a.value, b.value].filter(Boolean))];
  }
  save();
  render();
});

dlg.addEventListener('close', () => { openI = null; selected = null; });

$('#add').addEventListener('click', () => {
  roster.push({ id: 'c' + Date.now().toString(36), name: 'New character', anime: '', villain: false, gag: false,
    stages: [{ name: '', types: ['Neutral'], image: '' }] });
  save();
  render();
  openDetail(roster.length - 1);
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
