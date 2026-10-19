import { config } from './config.js';
import {
  GROUPS, PROJECT_TYPES, clientFolderName, extOf, prefixFor, buildName, nextNumber, typeToken, clientToken,
} from './names.js';

const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const LOG_KEY = 'sdh-sorter-log';
const ROOT_NAME = 'SDH Project Photos';
const NEW = '__new';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  be: null,
  user: null,
  cwd: [],
  folders: [],
  files: [],
  selected: new Set(),
  anchor: null,
  staged: new Map(), // file id -> { file, a }
  mode: 'finished',
  clientId: '',
  newName: '',
  newAddr: '',
  version: 'web',
  type: PROJECT_TYPES[0],
  otherType: '',
  conId: '',
  conNew: '',
  hoverCat: null,
  clients: [],
  targets: [],
  busy: false,
};
let cards = new Map();

function say(msg) { $('#status').textContent = msg; }

/* ---------- log (for undo) ---------- */
function readLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}
function writeLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 20))); } catch { /* storage blocked: undo just won't survive a reload */ }
}
let memoryLog = null;
const getLog = () => memoryLog ?? readLog();
const setLog = (log) => { memoryLog = log; writeLog(log); };

/* ---------- start up ---------- */
async function boot() {
  $('#signinBtn').addEventListener('click', onSignIn);
  if (!demo && !config.CLIENT_ID) {
    $('#setupNote').hidden = false;
    $('#signinBtn').disabled = true;
  }
  if (demo) {
    $('#demoBanner').hidden = false;
    await onSignIn();
  }
}

async function onSignIn() {
  $('#signinError').hidden = true;
  try {
    state.be = demo
      ? (await import('./mock.js')).createMockBackend()
      : (await import('./drive.js')).createDriveBackend();
    state.user = await state.be.signIn();
    $('#signin').hidden = true;
    $('#app').hidden = false;
    $('#who').textContent = state.user.email;
    await loadLists();
    renderPanel();
    await openPath(await pathTo(config.START_FOLDER_ID));
    refreshUndo();
  } catch (e) {
    $('#signin').hidden = false;
    $('#app').hidden = true;
    const el = $('#signinError');
    el.textContent = e.message;
    el.hidden = false;
  }
}

async function loadLists() {
  const root = await state.be.listFolder(config.ROOT_FOLDER_ID);
  const isClient = (f) => !config.NOT_CLIENTS.includes(f.name) && !f.name.startsWith(config.NOT_CLIENT_PREFIX);
  const names = new Set(root.folders.filter(isClient).map((f) => f.name));
  const printsId = root.folders.find((f) => f.name === config.PRINTS_NAME)?.id;
  if (printsId) (await state.be.listFolder(printsId)).folders.filter(isClient).forEach((f) => names.add(f.name));
  state.clients = [...names].sort((a, b) => a.localeCompare(b));
  const unfinishedId = await state.be.findChild(config.ROOT_FOLDER_ID, config.UNFINISHED_NAME);
  state.targets = unfinishedId ? (await state.be.listFolder(unfinishedId)).folders : [];
}

async function pathTo(id) {
  const chain = [];
  let cur = id;
  for (let i = 0; i < 8 && cur; i += 1) {
    const info = await state.be.folderInfo(cur);
    chain.unshift({ id: info.id, name: info.name });
    if (info.id === config.ROOT_FOLDER_ID) break;
    cur = info.parent;
  }
  return chain;
}

/* ---------- browsing ---------- */
async function openPath(cwd) {
  state.cwd = cwd;
  await loadFolder();
}

async function loadFolder() {
  const here = state.cwd[state.cwd.length - 1];
  $('#grid').innerHTML = '<p class="empty">Loading photos…</p>';
  try {
    const { folders, files } = await state.be.listFolder(here.id);
    state.folders = folders;
    state.files = files;
  } catch (e) {
    $('#grid').innerHTML = `<p class="empty error">${esc(e.message)}</p>`;
    return;
  }
  state.selected.clear();
  state.anchor = null;
  state.version = state.cwd.some((c) => /print/i.test(c.name)) ? 'print' : 'web';
  renderCrumbs();
  renderGrid();
  syncAll();
}

function renderCrumbs() {
  $('#crumbs').innerHTML = state.cwd
    .map((c, i) => {
      const last = i === state.cwd.length - 1;
      return `${i ? '<span class="sep" aria-hidden="true">/</span>' : ''}<button type="button" data-i="${i}"${last ? ' aria-current="page"' : ''}>${esc(c.name)}</button>`;
    })
    .join('');
  const kids = state.folders;
  $('#subfolders').innerHTML = kids.length
    ? kids.map((f) => `<button type="button" data-id="${esc(f.id)}">${esc(f.name)}</button>`).join('')
    : '';
}

function renderGrid() {
  const grid = $('#grid');
  const pickMode = !state.files.length && state.folders.length > 0;
  $('#subfolders').classList.toggle('off', pickMode);
  if (!state.files.length) {
    grid.innerHTML = pickMode
      ? `<div class="pick"><h2>Pick a folder to sort</h2><p>No photos right here. Choose a folder below to open it.</p><div class="pickgrid">${state.folders.map((f) => `<button type="button" data-id="${esc(f.id)}">${esc(f.name)}</button>`).join('')}</div></div>`
      : '<p class="empty">No photos in this folder.</p>';
    cards = new Map();
    return;
  }
  grid.innerHTML = state.files.map((f) => `
    <button type="button" class="photo" data-id="${esc(f.id)}" aria-pressed="false">
      ${f.thumb
    ? `<img src="${esc(f.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="nothumb">${esc(extOf(f.name).toUpperCase() || 'FILE')}</span>`}
      <span class="check" aria-hidden="true"></span>
      <span class="fname">${esc(f.name)}</span>
      <span class="tag" hidden></span>
    </button>`).join('');
  cards = new Map([...grid.children].map((el) => [el.dataset.id, el]));
  state.files.forEach((f) => updateCard(f.id));
}

function labelOf(a) {
  if (a.kind === 'unknown') return 'Unknown';
  if (a.kind === 'construction') return `Construction`;
  return `${a.root ? 'Print · ' : ''}${a.cat.folder}`;
}

function updateCard(id) {
  const el = cards.get(id);
  if (!el) return;
  const sel = state.selected.has(id);
  el.classList.toggle('sel', sel);
  el.setAttribute('aria-pressed', String(sel));
  const s = state.staged.get(id);
  el.classList.toggle('done', !!s);
  if (s) el.dataset.kind = s.a.kind; else delete el.dataset.kind;
  const tag = $('.tag', el);
  tag.hidden = !s;
  tag.textContent = s ? labelOf(s.a) : '';
}

function refreshSelection() {
  cards.forEach((_, id) => updateCard(id));
  syncAll();
}

/* ---------- panel ---------- */
function renderPanel() {
  const modes = [['finished', 'Finished home'], ['construction', 'Construction'], ['unknown', 'Unknown']];
  let body = '';
  if (state.mode === 'finished') {
    body = `
      <div class="field">
        <span class="lbl" id="verLbl">Version</span>
        <div class="chips" role="group" aria-labelledby="verLbl">
          <button type="button" data-version="web" aria-pressed="false">Standard</button>
          <button type="button" data-version="print" aria-pressed="false">Print (high quality)</button>
        </div>
      </div>
      <div class="field">
        <label for="clientSel">Client-house</label>
        <select id="clientSel">
          <option value="">Choose a client-house…</option>
          ${state.clients.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          <option value="${NEW}">New client-house…</option>
        </select>
      </div>
      <div class="two" id="newClient" hidden>
        <input id="newName" placeholder="Client name" aria-label="Client name" autocomplete="off">
        <input id="newAddr" placeholder="Address" aria-label="Address" autocomplete="off">
      </div>
      <div class="field">
        <span class="lbl" id="typeLbl">Project type</span>
        <div class="chips" role="group" aria-labelledby="typeLbl">
          ${[...PROJECT_TYPES, 'Other'].map((t) => `<button type="button" data-type="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}
        </div>
        <input id="otherType" placeholder="Project type, like Guest House" aria-label="Project type" hidden autocomplete="off">
      </div>
      ${Object.entries(GROUPS).map(([group, cats]) => `
        <div class="catgroup">
          <h3>${group}</h3>
          <div class="cats">
            ${cats.map((c) => `<button type="button" data-group="${group}" data-folder="${esc(c.folder)}">${esc(c.folder)}</button>`).join('')}
          </div>
        </div>`).join('')}
      <p class="hint" id="hint"></p>`;
  } else if (state.mode === 'construction') {
    body = `
      <div class="field">
        <label for="conSel">Project folder in ${esc(config.UNFINISHED_NAME)}</label>
        <select id="conSel">
          <option value="">Choose a project…</option>
          ${state.targets.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
          <option value="${NEW}">New project folder…</option>
        </select>
        <input id="conNew" placeholder="Client – Address" aria-label="New project folder name" hidden autocomplete="off">
      </div>
      <p class="hint">Construction photos keep their current file names.</p>
      <button type="button" class="primary" id="conGo">Send to ${esc(config.UNFINISHED_NAME)}</button>`;
  } else {
    body = `
      <p class="hint">Not sure where these belong? Mark them unknown. They stay where they are and nothing gets renamed or moved.</p>
      <button type="button" class="primary" id="unkGo">Mark as unknown</button>`;
  }

  $('#panel').innerHTML = `
    <div class="count" id="count"></div>
    <div class="receipt" id="receipt" aria-live="polite"></div>
    <div class="seg" role="group" aria-label="Kind of photo">
      ${modes.map(([m, t]) => `<button type="button" data-mode="${m}" aria-pressed="${state.mode === m}">${t}</button>`).join('')}
    </div>
    ${body}
    <button type="button" class="ghost" id="unlabel" hidden>Remove label from selected</button>`;

  if (state.mode === 'finished') {
    $('#clientSel').value = state.clientId;
    $('#newName').value = state.newName;
    $('#newAddr').value = state.newAddr;
    $('#otherType').value = state.otherType;
  } else if (state.mode === 'construction') {
    $('#conSel').value = state.conId;
    $('#conNew').value = state.conNew;
  }
  syncPanel();
}

function clientFolder() {
  if (state.clientId === NEW) {
    return state.newName.trim() && state.newAddr.trim() ? clientFolderName(state.newName, state.newAddr) : null;
  }
  return state.clientId || null;
}

function projectType() {
  if (state.type === 'Other') return state.otherType.trim() || null;
  return state.type;
}

function conTarget() {
  if (state.conId === NEW) return state.conNew.trim() || null;
  return state.targets.find((t) => t.id === state.conId)?.name || null;
}

function syncPanel() {
  const n = state.selected.size;
  const count = $('#count');
  if (!count) return;
  count.textContent = n ? `${n} photo${n === 1 ? '' : 's'} selected` : 'Select photos to label them';

  const anyStaged = [...state.selected].some((id) => state.staged.has(id));
  $('#unlabel').hidden = !anyStaged;

  if (state.mode === 'finished') {
    $('#newClient').hidden = state.clientId !== NEW;
    $('#otherType').hidden = state.type !== 'Other';
    document.querySelectorAll('[data-version]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.version === state.version)));
    document.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
    const ready = !!clientFolder() && !!projectType();
    document.querySelectorAll('[data-folder]').forEach((b) => { b.disabled = !n || !ready; });
    $('#hint').textContent = !clientFolder()
      ? 'Pick the client-house first.'
      : !projectType()
        ? 'Pick the project type.'
        : !n ? 'Select photos, then tap the room.' : '';
  } else if (state.mode === 'construction') {
    $('#conNew').hidden = state.conId !== NEW;
    $('#conGo').disabled = !n || !conTarget();
  } else {
    $('#unkGo').disabled = !n;
  }
  renderReceipt();
}

function firstSelectedExt() {
  const f = state.files.find((x) => state.selected.has(x.id));
  return (f && extOf(f.name)) || 'jpg';
}

function renderReceipt() {
  const el = $('#receipt');
  if (!el) return;
  const part = (t) => `<span>${esc(t)}</span>`;
  const gap = (t) => `<span class="gap">${esc(t)}</span>`;
  const sep = '<span class="sep" aria-hidden="true">›</span>';
  if (state.mode === 'finished') {
    const cf = clientFolder();
    const type = projectType();
    const hov = state.hoverCat;
    const segs = [part(ROOT_NAME), ...(state.version === 'print' ? [part(config.PRINTS_NAME)] : []), cf ? part(cf) : gap('client-house')];
    if (cf) segs.push(type ? part(type) : gap('project type'));
    if (cf && type) segs.push(hov ? part(hov.group) : gap('room'));
    if (cf && type && hov) segs.push(part(hov.cat.folder));
    let name = '';
    if (cf && type && hov) {
      name = `<div class="fname-out">${esc(buildName(prefixFor(cf, type, hov.cat.token), 1, firstSelectedExt()).replace(/_01\./, '_##.'))}</div>`;
    }
    el.innerHTML = `<div class="path">${segs.join(sep)}</div>${name}`;
  } else if (state.mode === 'construction') {
    const t = conTarget();
    el.innerHTML = `<div class="path">${[part(ROOT_NAME), part(config.UNFINISHED_NAME), t ? part(t) : gap('project folder')].join(sep)}</div>
      <div class="fname-out">Names stay as they are</div>`;
  } else {
    el.innerHTML = '<div class="path"><span class="gap">Stays in this folder</span></div>';
  }
}

function syncStaged() {
  const bar = $('#stagedBar');
  const all = [...state.staged.values()];
  const moving = all.filter((s) => s.a.kind !== 'unknown').length;
  const unk = all.length - moving;
  bar.hidden = !moving;
  $('#stagedText').textContent = `${moving} photo${moving === 1 ? '' : 's'} labeled${unk ? `, ${unk} unknown` : ''}`;
}

function syncAll() {
  const sel = state.selected.size;
  $('#folderCount').textContent = `${state.files.length} photo${state.files.length === 1 ? '' : 's'} here${sel ? `, ${sel} selected` : ''}`;
  syncPanel();
  syncStaged();
}

/* ---------- labeling ---------- */
function stage(a) {
  const picked = state.files.filter((f) => state.selected.has(f.id));
  if (!picked.length) return;
  picked.forEach((f) => state.staged.set(f.id, { file: f, a }));
  state.selected.clear();
  state.anchor = null;
  cards.forEach((_, id) => updateCard(id));
  syncAll();
  say(`${picked.length} photo${picked.length === 1 ? '' : 's'} labeled ${labelOf(a)}.`);
}

function onCategory(group, folder) {
  const cat = GROUPS[group].find((c) => c.folder === folder);
  const cf = clientFolder();
  const type = projectType();
  if (!cf || !type) return;
  stage({
    kind: 'finished',
    root: state.version === 'print' ? config.PRINTS_NAME : null,
    clientFolder: cf,
    type,
    group,
    cat,
  });
}

/* ---------- review and move ---------- */
async function buildPlan() {
  const dirCache = new Map();
  async function dirNames(path) {
    const key = path.join('\u0001');
    if (dirCache.has(key)) return dirCache.get(key);
    let id = config.ROOT_FOLDER_ID;
    for (const seg of path) {
      if (!id) break;
      id = await state.be.findChild(id, seg);
    }
    const names = id ? (await state.be.listFolder(id)).files.map((f) => f.name) : [];
    dirCache.set(key, names);
    return names;
  }
  const counters = new Map();
  const items = [];
  let unknown = 0;
  for (const { file, a } of state.staged.values()) {
    if (a.kind === 'unknown') { unknown += 1; continue; }
    if (a.kind === 'construction') {
      items.push({ id: file.id, from: file.parent, oldName: file.name, newName: file.name, path: [config.UNFINISHED_NAME, a.target] });
      continue;
    }
    const path = [...(a.root ? [a.root] : []), a.clientFolder, a.type, a.group, a.cat.folder];
    const prefix = prefixFor(a.clientFolder, a.type, a.cat.token);
    const key = path.join('\u0001');
    const n = counters.get(key) ?? nextNumber(await dirNames(path), prefix);
    counters.set(key, n + 1);
    items.push({ id: file.id, from: file.parent, oldName: file.name, newName: buildName(prefix, n, extOf(file.name)), path });
  }
  return { items, unknown };
}

let plan = null;

async function openReview() {
  if (state.busy) return;
  const dlg = $('#review');
  $('#rvList').innerHTML = '';
  $('#rvProgress').textContent = 'Checking what is already in the folders…';
  $('#rvProgress').className = 'rv-progress';
  $('#rvApply').hidden = true;
  $('#rvCancel').textContent = 'Back';
  $('#rvSummary').textContent = '';
  if (!dlg.open) dlg.showModal();
  try {
    plan = await buildPlan();
  } catch (e) {
    $('#rvProgress').textContent = e.message;
    $('#rvProgress').className = 'rv-progress bad';
    return;
  }
  const groups = new Map();
  plan.items.forEach((it) => {
    const k = [ROOT_NAME, ...it.path].join(' › ');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  });
  $('#rvList').innerHTML = [...groups].map(([k, its]) => `
    <section class="rv-group">
      <h3>${esc(k)} <span class="muted">(${its.length})</span></h3>
      <ul>${its.map((it) => `<li><span>${esc(it.oldName)}</span><span>${esc(it.newName)}</span></li>`).join('')}</ul>
    </section>`).join('');
  const n = plan.items.length;
  $('#rvSummary').textContent = `${n} photo${n === 1 ? '' : 's'} will move. Missing folders are created. You can undo the batch afterward.`;
  $('#rvProgress').textContent = '';
  $('#rvApply').textContent = `Move ${n} photo${n === 1 ? '' : 's'}`;
  $('#rvApply').hidden = !n;
}

async function applyPlan() {
  if (!plan || state.busy) return;
  state.busy = true;
  $('#rvApply').hidden = true;
  $('#rvCancel').hidden = true;
  const prog = $('#rvProgress');
  prog.className = 'rv-progress';
  const done = [];
  const failed = [];
  try {
    prog.textContent = 'Creating folders…';
    const dest = new Map();
    for (const it of plan.items) {
      const key = it.path.join('\u0001');
      if (dest.has(key)) continue;
      let id = config.ROOT_FOLDER_ID;
      for (const seg of it.path) id = await state.be.ensureFolder(id, seg);
      dest.set(key, id);
    }
    const queue = [...plan.items];
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        const to = dest.get(it.path.join('\u0001'));
        try {
          await state.be.moveFile(it.id, it.from, to, it.newName);
          done.push({ ...it, to });
        } catch (e) {
          failed.push({ ...it, error: e.message });
        }
        prog.textContent = `Moving photos: ${done.length + failed.length} of ${plan.items.length}…`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) {
    failed.push({ oldName: 'folders', error: e.message });
  }

  if (done.length) {
    const log = getLog();
    log.unshift({
      time: new Date().toISOString(),
      user: state.user.email,
      moves: done.map(({ id, oldName, newName, from, to }) => ({ id, oldName, newName, from, to })),
    });
    setLog(log);
    const movedIds = new Set(done.map((d) => d.id));
    movedIds.forEach((id) => state.staged.delete(id));
    state.files = state.files.filter((f) => !movedIds.has(f.id));
    state.selected.clear();
    renderGrid();
    await loadLists();
    renderPanel();
    syncAll();
    refreshUndo();
  }
  state.busy = false;
  plan = null;
  $('#rvCancel').hidden = false;
  $('#rvCancel').textContent = 'Close';
  if (failed.length) {
    prog.className = 'rv-progress bad';
    prog.textContent = `${done.length} moved. ${failed.length} did not move: ${failed[0].error}. Those photos are still labeled, so you can try again.`;
  } else {
    prog.textContent = `Done. ${done.length} photo${done.length === 1 ? '' : 's'} moved and renamed.`;
  }
  say(prog.textContent);
}

/* ---------- undo ---------- */
function refreshUndo() {
  const b = getLog()[0];
  const btn = $('#undoBtn');
  btn.disabled = !b;
  btn.textContent = b ? `Undo last batch (${b.moves.length})` : 'Undo last batch';
}

async function undoLast() {
  const log = getLog();
  const b = log[0];
  if (!b || state.busy) return;
  const when = new Date(b.time).toLocaleString();
  if (!window.confirm(`Put ${b.moves.length} photos back where they were and restore their old names? (Batch from ${when}.)`)) return;
  state.busy = true;
  $('#undoBtn').disabled = true;
  let bad = 0;
  for (const m of b.moves) {
    try { await state.be.moveFile(m.id, m.to, m.from, m.oldName); } catch { bad += 1; }
  }
  state.busy = false;
  setLog(log.slice(1));
  await loadLists();
  renderPanel();
  await loadFolder();
  refreshUndo();
  say(bad ? `Undo finished. ${bad} photos could not be moved back.` : `Undo finished. ${b.moves.length} photos are back.`);
}

/* ---------- events ---------- */
function wire() {
  $('#grid').addEventListener('click', (e) => {
    const el = e.target.closest('.photo');
    if (!el) return;
    const id = el.dataset.id;
    if (e.shiftKey && state.anchor) {
      const ids = state.files.map((f) => f.id);
      const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
      ids.slice(a, b + 1).forEach((i) => state.selected.add(i));
    } else {
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      state.anchor = id;
    }
    refreshSelection();
  });

  $('#selAll').addEventListener('click', () => {
    const open = state.files.filter((f) => !state.staged.has(f.id));
    (open.length ? open : state.files).forEach((f) => state.selected.add(f.id));
    refreshSelection();
  });
  $('#selNone').addEventListener('click', () => { state.selected.clear(); refreshSelection(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#review').open && state.selected.size) { state.selected.clear(); refreshSelection(); }
  });

  $('#crumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) openPath(state.cwd.slice(0, Number(b.dataset.i) + 1));
  });
  $('#grid').addEventListener('click', (e) => {
    const b = e.target.closest('.pickgrid button[data-id]');
    if (b) openPath([...state.cwd, { id: b.dataset.id, name: b.textContent }]);
  });
  $('#subfolders').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) openPath([...state.cwd, { id: b.dataset.id, name: b.textContent }]);
  });

  const panel = $('#panel');
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.mode) { state.mode = t.dataset.mode; state.hoverCat = null; renderPanel(); return; }
    if (t.dataset.version) { state.version = t.dataset.version; syncPanel(); return; }
    if (t.dataset.type) { state.type = t.dataset.type; syncPanel(); return; }
    if (t.dataset.folder) { onCategory(t.dataset.group, t.dataset.folder); return; }
    if (t.id === 'conGo') { stage({ kind: 'construction', target: conTarget() }); return; }
    if (t.id === 'unkGo') { stage({ kind: 'unknown' }); return; }
    if (t.id === 'unlabel') {
      state.selected.forEach((id) => state.staged.delete(id));
      refreshSelection();
    }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'clientSel') state.clientId = e.target.value;
    if (e.target.id === 'conSel') state.conId = e.target.value;
    syncPanel();
  });
  panel.addEventListener('input', (e) => {
    const map = { newName: 'newName', newAddr: 'newAddr', otherType: 'otherType', conNew: 'conNew' };
    if (map[e.target.id]) { state[map[e.target.id]] = e.target.value; syncPanel(); }
  });
  const hover = (e) => {
    const b = e.target.closest?.('[data-folder]');
    state.hoverCat = b && !b.disabled ? { group: b.dataset.group, cat: GROUPS[b.dataset.group].find((c) => c.folder === b.dataset.folder) } : null;
    renderReceipt();
  };
  panel.addEventListener('mouseover', hover);
  panel.addEventListener('focusin', hover);
  panel.addEventListener('mouseleave', () => { state.hoverCat = null; renderReceipt(); });

  $('#reviewBtn').addEventListener('click', openReview);
  $('#rvApply').addEventListener('click', applyPlan);
  $('#rvCancel').addEventListener('click', () => $('#review').close());
  $('#review').addEventListener('cancel', (e) => { if (state.busy) e.preventDefault(); });
  $('#undoBtn').addEventListener('click', undoLast);

  window.addEventListener('beforeunload', (e) => {
    if (state.staged.size && !state.busy) { e.preventDefault(); e.returnValue = ''; }
  });
}

// Exposed so the tests can reach the demo backend.
window.__sorter = { state, clientToken, typeToken };

wire();
boot();
