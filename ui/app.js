/* natively · Oberfläche
   Daten kommen aus der Mac-App (Bridge.swift) über window.webkit.messageHandlers.native,
   oder im Browser vom lokalen Server (web/lib/server.js) über fetch und Server-Sent-Events.
   Aufbau: Zustand S → render*() schreibt HTML → ein Klick-Handler für alles (data-*-Attribute). */

const VERSION = '0.1';
const MAC = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
const WEB = !MAC && !!window.nativelyWeb;   // Browser mit lokalem natively-Server (npx natively-md)
const GH = !MAC && !WEB && !!window.nativelyGitHub;   // Team-Version: Dateien aus GitHub (teams/client/github.js)
const NATIVE = MAC || WEB || GH;
const PLATFORM = MAC ? 'darwin' : WEB ? window.nativelyWeb.platform : '';
async function webNative(cmd, arg){
  const res = await fetch('/api/cmd', { method:'POST', headers:{ 'content-type':'application/json', 'x-natively-token':window.nativelyWeb.token }, body:JSON.stringify({ cmd, arg: arg === undefined ? null : arg }) });
  if (!res.ok) throw new Error(t(res.status === 403 ? 'err.restarted' : 'err.server'));
  const out = await res.json();
  if (out.error) throw new Error(out.error);
  return out.value;
}
const native = (cmd, arg) => MAC
  ? window.webkit.messageHandlers.native.postMessage({ cmd, arg: arg === undefined ? null : arg })
  : WEB ? webNative(cmd, arg)
  : GH ? window.nativelyGitHub.cmd(cmd, arg === undefined ? null : arg)
  : Promise.reject(new Error(t('err.macOnly')));
/* Bilder aus lokalen Ordnern: im Browser über den Server, in der Mac-App direkt */
if (WEB) window.localFileURL = p => '/api/file?t=' + encodeURIComponent(window.nativelyWeb.token) + '&p=' + encodeURIComponent(p);
const fm = () => GH ? 'GitHub' : t(PLATFORM === 'darwin' ? 'fm.mac' : PLATFORM === 'win32' ? 'fm.win' : 'fm.other');
if (MAC) document.documentElement.classList.add('mac');
if (WEB) document.documentElement.classList.add('web');
if (GH) document.documentElement.classList.add('web', 'gh');
window.addEventListener('error', e => { native('log', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`).catch(() => {}); });
window.addEventListener('unhandledrejection', e => { native('log', 'Promise: ' + (e.reason && e.reason.message || e.reason)).catch(() => {}); });

const $ = (s, r = document) => r.querySelector(s);
const icon = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const DF = {};
const fmtDate = s => (DF[LANG] ||= new Intl.DateTimeFormat(LANG === 'de' ? 'de-DE' : 'en-US', { day:'numeric', month:'short', year:'numeric' })).format(new Date(s + 'T12:00:00'));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Einstellungen (in der App über UserDefaults gespeichert) ---------- */
let PREFS = {};
let saveTimer;
const store = {
  get(k, d){ return Object.prototype.hasOwnProperty.call(PREFS, k) ? PREFS[k] : d; },
  set(k, v){
    PREFS[k] = v;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const json = JSON.stringify(PREFS);
      if (NATIVE) native('prefs.set', json).catch(() => {});
      else try { localStorage.setItem('natively:prefs', json); } catch(e) {}
    }, 250);
  }
};
async function loadPrefs(){
  try { PREFS = JSON.parse(NATIVE ? await native('prefs.get') : (localStorage.getItem('natively:prefs') || '{}')) || {}; }
  catch(e) { PREFS = {}; }
}

/* ---------- Daten ---------- */
const EXTERN = { id:'extern', name:'Opened', icon:'file', root:'', abs:'', hidden:[], hiddenCount:0, virtual:true };
let SOURCES = [], FILES = [], HOME = '';
let srcById = { extern:EXTERN }, byId = {}, byAbs = {};

function joinPath(dir, rel){
  const parts = dir.split('/');
  for (const seg of rel.split('/')) { if (seg === '..') { if (parts.length > 1) parts.pop(); } else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/') || '/';
}
function resolveLink(from, href){
  if (!href) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) return { external:href };
  if (href.startsWith('#')) return { anchor:href.slice(1) };
  let p = href.replace(/^file:\/\//i, '').split('#')[0];
  try { p = decodeURIComponent(p); } catch(e) {}
  if (!p) return null;
  const abs = p.startsWith('/') ? p : p.startsWith('~/') ? HOME + p.slice(1) : joinPath(from.absDir, p);
  const file = byAbs[abs];
  if (file) return { file };
  if (/\.(md|markdown|mdown)$/i.test(abs)) return { missing:abs };
  return { local:abs };
}
function indexFile(f){
  f.name = f.path[f.path.length - 1];
  f.dir = f.path.slice(0, -1);
  f.absDir = f.abs.slice(0, f.abs.lastIndexOf('/')) || '/';
  const c = f.content || '';
  const m = c.match(/^#\s+(.+)$/m);
  f.title = m ? stripInline(m[1]).trim() : f.name.replace(/\.(md|markdown|mdown)$/i, '');
  f.lines = c.replace(/\r/g, '').split('\n');
  f.plain = f.lines.map(stripLine);
  f.low = f.plain.map(l => l.toLowerCase());
}
function relink(){
  byId = {}; byAbs = {};
  FILES.forEach(f => { byId[f.id] = f; byAbs[f.abs] = f; });
  FILES.forEach(f => {
    const out = new Set();
    const c = f.content || '';
    if (c.includes('](')) for (const m of c.matchAll(/\[[^\]]*\]\(([^)\s]+)/g)) { const r = resolveLink(f, m[1]); if (r && r.file && r.file.id !== f.id) out.add(r.file.id); }
    f.out = [...out];
    f.back = [];
  });
  FILES.forEach(f => f.out.forEach(id => byId[id].back.push(f.id)));
}
function setData(data){
  HOME = data.home || HOME;
  SOURCES = data.sources || [];
  nameSources();
  const extern = FILES.filter(f => f.src === 'extern' && !data.files.some(x => x.abs === f.abs));
  FILES = data.files.concat(extern);
  srcById = Object.fromEntries(SOURCES.concat([EXTERN]).map(s => [s.id, s]));
  FILES.forEach(indexFile);
  relink();
  if (!S.enabledInit) {
    const saved = store.get('disabled', []);
    S.enabled = new Set(SOURCES.map(s => s.id).filter(id => !saved.includes(id)));
    S.enabledInit = true;
  } else {
    const disabled = store.get('disabled', []);
    SOURCES.forEach(s => { if (!disabled.includes(s.id)) S.enabled.add(s.id); });
  }
  S.enabled.add('extern');
  SOURCES.forEach(s => { if (s.fixed) S.enabled.add(s.id); });   // z. B. die Übersicht der Team-Version: immer sichtbar
}
/* Name des Benutzerordners hängt von der Sprache ab */
function nameSources(){
  EXTERN.name = t('src.extern');
  SOURCES.forEach(s => { if (s.id === 'home' || s.id === 'mac') s.name = t(PLATFORM === 'darwin' || s.id === 'mac' ? 'src.home.mac' : PLATFORM === 'win32' ? 'src.home.win' : 'src.home'); });
}
const realSources = () => SOURCES.filter(s => !s.virtual);
const visibleFiles = () => FILES.filter(f => f.src !== 'extern' && S.enabled.has(f.src));
const tilde = p => HOME && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;

/* ---------- Zustand ---------- */
const app = $('#app');
const mqNav = matchMedia('(max-width: 1100px)');
const mqTree = matchMedia('(max-width: 820px)');
const S = {
  enabled: new Set(), enabledInit: false,
  collapsedSrc: new Set(), expanded: new Set(),
  tabs: [{ file:null, preview:false }], active: 0,
  pinned: new Set(), recent: [],
  hist: [null], hidx: 0,
  raw: false, wide: false, filter: '', hits: [], hitCount: 0,
  navOn: true, treeOn: true, loaded: false, isDefault: true,
  search: { open:false, q:'', titleOnly:false, src:'all', sort:'best', sel:0, results:[] }
};
function initState(){
  S.pinned = new Set(store.get('pinned', []));
  S.recent = store.get('recent', []);
  S.wide = store.get('wide', false);
  S.expanded = new Set(store.get('expanded', []));
  S.collapsedSrc = new Set(store.get('collapsedSrc', []));
  S.navOn = !mqNav.matches && store.get('navOn', true);
  S.treeOn = !mqTree.matches && store.get('treeOn', true);
  const tabs = store.get('tabs', null);
  if (Array.isArray(tabs) && tabs.length) { S.tabs = tabs.map(t => ({ file:t.file || null, dir:t.dir || null, view:GH && t.view || null, preview:!!t.preview })); S.active = Math.min(store.get('activeTab', 0), S.tabs.length - 1); }
  S.hist = [entryOf(S.tabs[S.active])]; S.hidx = 0;
}
/* Verlaufseinträge: "f:<id>" = Datei, "d:<quelle>:/<pfad>" = Ordner-Übersicht, "" = Start */
const entryOf = t => t.file ? 'f:' + t.file : t.dir ? 'd:' + t.dir : t.view ? 'v:' + t.view : '';
function saveSession(){
  store.set('tabs', S.tabs.map(t => ({ file:t.file, dir:t.dir || null, view:t.view || null, preview:t.preview })));
  store.set('activeTab', S.active);
}
const saveExpanded = () => { store.set('expanded', [...S.expanded]); store.set('collapsedSrc', [...S.collapsedSrc]); };
const curTab = () => S.tabs[S.active];
const curFile = () => { const t = curTab(); return t && t.file ? byId[t.file] || null : null; };
const curDir = () => { const t = curTab(); return t && !t.file && t.dir ? t.dir : null; };
/* Ordner-Schlüssel "quelle:/a/b" (Quelle selbst: "quelle:") */
function parseDir(key){
  const i = key.indexOf(':');
  return { src:key.slice(0, i), path:key.slice(i + 1).split('/').filter(Boolean) };
}
const underDir = (f, src, path) => f.src === src && path.every((seg, k) => f.dir[k] === seg);
function dirLabel(key){
  const { src, path } = parseDir(key);
  return path.length ? path[path.length - 1] : (srcById[src] ? srcById[src].name : src);
}
function dirAbs(key){
  const { src, path } = parseDir(key);
  if (!path.length) return srcById[src] ? srcById[src].abs : '';
  const f = FILES.find(x => underDir(x, src, path));
  if (!f) return '';
  const parts = f.absDir.split('/');
  return parts.slice(0, parts.length - (f.dir.length - path.length)).join('/');
}
function expandTo(f){
  for (let k = 1; k <= f.dir.length; k++) S.expanded.add(f.src + ':/' + f.dir.slice(0, k).join('/'));
  S.collapsedSrc.delete(f.src);
  saveExpanded();
}
const rel = f => f.src === 'extern' ? tilde(f.abs) : (srcById[f.src] ? srcById[f.src].name : f.src) + ' / ' + f.path.join(' / ');

/* ---------- Layout ---------- */
function applyLayout(){
  app.classList.toggle('nav-on', S.navOn);
  app.classList.toggle('tree-on', S.treeOn);
  $('#scrim').hidden = !((mqNav.matches && S.navOn) || (mqTree.matches && S.treeOn));
  queueDrag();
}
function setNav(on){ S.navOn = on; if (!mqNav.matches) store.set('navOn', on); applyLayout(); }
function setTree(on){ S.treeOn = on; if (!mqTree.matches) store.set('treeOn', on); applyLayout(); renderCrumbs(); }
mqNav.addEventListener('change', () => { S.navOn = mqNav.matches ? false : store.get('navOn', true); applyLayout(); });
mqTree.addEventListener('change', () => { S.treeOn = mqTree.matches ? false : store.get('treeOn', true); applyLayout(); renderCrumbs(); });

function makeResizer(el, cssVar, side, min, maxFn, key, def){
  const cur = () => parseFloat(getComputedStyle(app).getPropertyValue(cssVar)) || def;
  const clamp = w => Math.round(Math.max(min, Math.min(maxFn(), w)));
  const set = (w, save) => { const v = clamp(w); app.style.setProperty(cssVar, v + 'px'); if (save) store.set(key, v); };
  el._restore = () => { const saved = store.get(key, null); if (saved) app.style.setProperty(cssVar, saved + 'px'); };
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = cur();
    app.classList.add('resizing'); el.classList.add('drag');
    const move = ev => set(side === 'left' ? w0 + (ev.clientX - x0) : w0 - (ev.clientX - x0), false);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); app.classList.remove('resizing'); el.classList.remove('drag'); set(cur(), true); queueDrag(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => { set(def, true); queueDrag(); });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      set(cur() + (e.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1), true);
      queueDrag();
    }
  });
}
const navW = () => parseFloat(getComputedStyle(app).getPropertyValue('--nav-w')) || 248;
makeResizer($('#navResizer'), '--nav-w', 'left', 200, () => Math.min(380, innerWidth * .32), 'navW', 248);
makeResizer($('#treeResizer'), '--tree-w', 'right', 210, () => Math.min(560, innerWidth - (S.navOn && !mqNav.matches ? navW() : 0) - 380), 'treeW', 288);

/* Fenster an der oberen Leiste ziehen: Bereiche an die App melden */
let dragTimer;
function queueDrag(){ clearTimeout(dragTimer); dragTimer = setTimeout(reportDrag, 60); }
function reportDrag(){
  if (!MAC) return;
  const z = [], h = [];
  const add = (arr, el) => { const r = el.getBoundingClientRect(); if (r.width && r.height) arr.push([r.left, r.top, r.width, r.height]); };
  document.querySelectorAll('.topbar, .nav-top').forEach(el => { if (el.offsetParent !== null) add(z, el); });
  document.querySelectorAll('.topbar button, .topbar .tab, .nav-top button').forEach(el => add(h, el));
  if (!$('#search').hidden || !$('#tableOverlay').hidden || !$('#scrim').hidden) z.length = 0;
  native('drag', JSON.stringify({ z, h })).catch(() => {});
}
addEventListener('resize', () => { queueDrag(); closeMenu(); });

/* ---------- Navigation links ---------- */
function navFileBtn(id){
  const f = byId[id];
  const on = curFile() && curFile().id === id;
  return `<button class="nitem nfile${on ? ' on' : ''}" data-open="${esc(id)}" title="${esc(rel(f))}">${icon('file')}<span class="lbl">${esc(f.name)}</span></button>`;
}
function renderNav(){
  const ok = id => byId[id] && (byId[id].src === 'extern' || S.enabled.has(byId[id].src));
  const pins = [...S.pinned].filter(ok);
  $('#navPinned').innerHTML = pins.length ? `<div class="nsec-h">${t('nav.pinned')}</div>${pins.map(navFileBtn).join('')}` : '';
  const rec = S.recent.filter(id => ok(id) && !S.pinned.has(id)).slice(0, 8);
  $('#navRecent').innerHTML = rec.length ? `<div class="nsec-h">${t('nav.recent')}</div>${rec.map(navFileBtn).join('')}` : '';
  $('#navSources').classList.toggle('on', !curTab().file && !curTab().dir && !curTab().view);
  if (GH) window.nativelyGitHub.navState(curTab().view);
  const canBack = S.hidx > 0, canFwd = S.hidx < S.hist.length - 1;
  ['#navBack', '#topBack'].forEach(s => $(s).disabled = !canBack);
  ['#navFwd', '#topFwd'].forEach(s => $(s).disabled = !canFwd);
  $('#appVersion').textContent = VERSION;
}

/* ---------- Tabs ---------- */
const tabName = t => t.file ? (byId[t.file] ? byId[t.file].name : t.file.split('/').pop()) : t.dir ? dirLabel(t.dir) : t.view && GH ? window.nativelyGitHub.viewName(t.view) : window.t('start');
function renderTabs(){
  $('#tabs').innerHTML = S.tabs.map((t, i) => {
    const f = t.file ? byId[t.file] : null;
    const name = tabName(t);
    return `<div class="tab${i === S.active ? ' on' : ''}${t.preview ? ' preview' : ''}" role="tab" aria-selected="${i === S.active}" tabindex="0" data-tab="${i}" title="${esc(f ? tilde(f.abs) : name)}${t.preview ? window.t('tab.keep') : ''}">
      <span class="nm">${esc(name)}</span>
      <button class="x" data-close-tab="${i}" aria-label="${esc(window.t('tab.close', { name }))}">${icon('x')}</button></div>`;
  }).join('');
  const on = $('#tabs .tab.on');
  if (on) on.scrollIntoView({ block:'nearest', inline:'nearest' });
  if (MAC) native('title', tabName(curTab())).catch(() => {});
  else document.title = curTab().file || curTab().dir || curTab().view ? tabName(curTab()) + ' · natively' : 'natively';
  saveSession();
}

/* ---------- Pfadleiste ---------- */
function renderCrumbs(){
  const f = curFile();
  const dir = curDir();
  let crumbs;
  if (curTab().view && GH) {
    crumbs = `<span class="last">${esc(window.nativelyGitHub.viewName(curTab().view))}</span>`;
  } else if (dir) {
    const { src, path } = parseDir(dir);
    const s = srcById[src];
    const head = path.length
      ? `<button data-crumb="${esc(src + ':')}" title="${esc(s ? s.root : '')}">${esc(s ? s.name : src)}</button>`
      : `<span class="last">${esc(s ? s.name : src)}</span>`;
    const segs = path.map((d, k) => k < path.length - 1
      ? `<span class="sep">/</span><button class="mid" data-crumb="${esc(src + ':/' + path.slice(0, k + 1).join('/'))}">${esc(d)}</button>`
      : `<span class="sep">/</span><span class="last">${esc(d)}</span>`).join('');
    crumbs = head + segs;
  } else if (f && f.src !== 'extern') {
    const src = srcById[f.src];
    const segs = f.dir.map((d, k) => `<span class="sep">/</span><button class="${k < f.dir.length - 1 ? 'mid' : ''}" data-crumb="${esc(f.src + ':/' + f.dir.slice(0, k + 1).join('/'))}">${esc(d)}</button>`).join('');
    crumbs = `<button data-crumb="${esc(f.src + ':')}" title="${esc(src ? src.root : '')}">${esc(src ? src.name : f.src)}</button>${segs}<span class="sep">/</span><span class="last">${esc(f.name)}</span>`;
  } else if (f) {
    crumbs = `<span class="last" title="${esc(f.abs)}">${esc(tilde(f.abs))}</span>`;
  } else {
    crumbs = `<span class="last">${t(curTab().file ? 'crumb.notFound' : 'start')}</span>`;
  }
  const hit = S.hits.length && f && S.hitCount ? `<span class="hitpill">${S.hitCount} × ${LANG === 'de' ? '„' : '“'}${esc(S.hits.join(' '))}“<button data-act="clear-hits" aria-label="${t('hit.clear')}">${icon('x')}</button></span>` : '';
  $('#crumbbar').innerHTML = `<nav class="crumbs" aria-label="${t('crumb.path')}">${crumbs}</nav>${hit}
    <div class="tools">
      <button class="iconbtn${S.raw ? ' on' : ''}" data-act="raw" title="${t('tool.raw')}" aria-label="${t('tool.rawLabel')}" aria-pressed="${S.raw}" ${f ? '' : 'disabled'}>${icon('code')}</button>
      <button class="iconbtn" data-act="collapse-all" title="${t('tool.collapse')}" aria-label="${t('tool.collapse')}">${icon('collapse')}</button>
      <button class="iconbtn${S.treeOn ? ' on' : ''}" data-act="tree-toggle" title="${esc(t('tool.tree'))}" aria-label="${t('tool.treeLabel')}" aria-pressed="${S.treeOn}">${icon('list')}</button>
      <button class="iconbtn" data-act="more" title="${t('tool.more')}" aria-label="${t('tool.more')}" ${f || dir ? '' : 'disabled'}>${icon('more')}</button>
    </div>`;
}

/* ---------- Baum: Finder-Hierarchie, nur MD ---------- */
function buildTree(files){
  const root = { dirs:new Map(), files:[] };
  for (const f of files) {
    let n = root;
    for (const seg of f.dir) { if (!n.dirs.has(seg)) n.dirs.set(seg, { name:seg, dirs:new Map(), files:[] }); n = n.dirs.get(seg); }
    n.files.push(f);
  }
  return root;
}
const countFiles = n => n.files.length + [...n.dirs.values()].reduce((a, d) => a + countFiles(d), 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric:true, sensitivity:'base' });
function hlName(name){
  if (!S.filter) return esc(name);
  const re = new RegExp('(' + reEsc(esc(S.filter)) + ')', 'gi');
  return esc(name).replace(re, '<mark>$1</mark>');
}
function renderNode(node, src, keyPath, depth, html, force){
  const active = curFile();
  for (let d of [...node.dirs.values()].sort(byName)) {
    let label = d.name, key = keyPath + '/' + d.name;
    while (d.files.length === 0 && d.dirs.size === 1) { const c = [...d.dirs.values()][0]; label += ' / ' + c.name; key += '/' + c.name; d = c; }
    const k = src + ':' + key;
    const open = force || S.expanded.has(k);
    html.push(`<button class="row dir${curDir() === k ? ' active' : ''}" role="treeitem" aria-expanded="${open}" data-toggle="${esc(k)}" style="--d:${depth}" title="${esc(label)}">${icon('chev-right', 'chev')}<span class="lbl">${esc(label)}</span>${open ? '' : `<span class="count">${countFiles(d)}</span>`}</button>`);
    if (open) renderNode(d, src, key, depth + 1, html, force);
  }
  for (const f of node.files.slice().sort(byName)) {
    const on = active && active.id === f.id;
    html.push(`<button class="row file${on ? ' active' : ''}" role="treeitem" data-file="${esc(f.id)}" style="--d:${depth}" title="${esc(tilde(f.abs))}">${icon('file', 'fi')}<span class="lbl">${hlName(f.name)}</span>${f.cloud ? icon('cloud', 'fi') : ''}</button>`);
  }
}
function renderTree(){
  if (!S.loaded) { $('#treeList').innerHTML = `<div class="tree-empty">${icon('refresh', 'spinning')}<br>${t('tree.loading')}</div>`; $('#treeFoot').textContent = ''; return; }
  const q = S.filter.toLowerCase();
  const html = [];
  let total = 0;
  for (const src of realSources()) {
    if (!S.enabled.has(src.id)) continue;
    let files = FILES.filter(f => f.src === src.id);
    if (q) files = files.filter(f => f.path.join('/').toLowerCase().includes(q));
    if (!files.length && (q || (!src.custom && !src.denied))) continue;
    total += files.length;
    const open = !!q || !S.collapsedSrc.has(src.id);
    html.push(`<button class="row src${curDir() === src.id + ':' ? ' active' : ''}" role="treeitem" aria-expanded="${open}" data-toggle-src="${esc(src.id)}" title="${esc(src.root)}">${icon('chev-right', 'chev')}${icon(src.icon, 'si')}<span class="lbl">${esc(src.name)}</span><span class="count">${files.length}</span></button>`);
    if (open) {
      if (src.denied && !q) html.push(`<div class="hiddeninfo" style="--d:0">${t('tree.denied')}</div>`);
      renderNode(buildTree(files), src.id, '', 1, html, !!q);
      if (!q && src.hiddenCount) html.push(`<div class="hiddeninfo" style="--d:0" title="${t('tree.hiddenTitle')}&#10;${esc(src.hidden.join('\n'))}${src.hiddenCount > src.hidden.length ? '&#10;…' : ''}">${plural('tree.hidden', src.hiddenCount)}</div>`);
    }
  }
  $('#treeList').innerHTML = html.length ? html.join('') :
    (realSources().some(s => S.enabled.has(s.id))
      ? `<div class="tree-empty">${t('tree.noMatch', { q:esc(S.filter) })}</div>`
      : `<div class="tree-empty">${t('tree.noSource')}<br><button class="btn" data-act="sources">${t('tree.pickSources')}</button></div>`);
  const all = visibleFiles().length;
  const nSrc = realSources().filter(s => S.enabled.has(s.id)).length;
  $('#treeFoot').textContent = q ? t('tree.footFiltered', { n:total, files:plural('files', all) }) : t('tree.foot', { files:plural('files', all), sources:plural('sources', nSrc) });
}

/* ---------- Inhalt ---------- */
function renderWelcome(){
  if (!S.loaded) {
    $('#content').innerHTML = `<div class="scroller"><div class="notice">${icon('logo', 'big')}<h2>${t('welcome.loadingTitle')}</h2><p>${t(MAC ? 'welcome.loadingMac' : 'welcome.loadingWeb')}</p></div></div>`;
    return;
  }
  const counts = {};
  FILES.forEach(f => counts[f.src] = (counts[f.src] || 0) + 1);
  const total = visibleFiles().length;
  let rec = S.recent.filter(id => byId[id] && S.enabled.has(byId[id].src)).slice(0, 6);
  if (!rec.length) rec = visibleFiles().slice().sort((a, b) => b.ts - a.ts).slice(0, 6).map(f => f.id);
  const nSrc = realSources().filter(s => S.enabled.has(s.id)).length;
  $('#content').innerHTML = `<div class="scroller"><div class="welcome">
    <div class="w-head">
      <div class="w-mark">${icon('logo')}</div>
      <h1>${t('welcome.title')}</h1>
      <p>${t('welcome.lead', { fm:fm() })}</p>
    </div>
    ${setupCard()}
    <section class="card" aria-label="${t('sources.aria')}">
      <div class="card-h"><b>${t('sources.card')}</b><span>${plural('files', total)}</span></div>
      ${realSources().map(s => `<div class="srcrow${S.enabled.has(s.id) ? '' : ' off'}" role="button" tabindex="0" data-src-toggle="${esc(s.id)}" aria-pressed="${S.enabled.has(s.id)}">
        ${icon(s.icon, 'si')}<span class="txt"><span class="nm">${esc(s.name)}</span><span class="pth">${esc(s.root)}</span></span>
        <span class="count">${counts[s.id] || 0} MD</span>${s.custom ? `<button class="rm" data-remove-folder="${esc(s.abs)}" title="${t('sources.remove')}" aria-label="${esc(t('sources.removeLabel', { name:s.name }))}">${icon('x')}</button>` : ''}${icon('check', 'ck')}</div>`).join('')}
      <div class="src-actions">
        <button class="btn" data-act="add-folder">${icon('folder-plus')}${t('btn.addFolder')}</button>
        <button class="btn" data-act="rescan" id="rescanBtn">${icon('refresh')}${t('btn.rescan')}</button>
      </div>
    </section>
    ${rec.length ? `<section class="recent" aria-label="${t('recent.opened')}">
      <h2>${t(S.recent.length ? 'recent.opened' : 'recent.changed')}</h2>
      ${rec.map(id => { const f = byId[id]; return `<button class="rrow" data-open="${esc(id)}">${icon('file')}<span class="txt"><span class="nm">${esc(f.name)}</span><span class="pth">${esc(rel(f))}</span></span><time datetime="${f.mod}">${fmtDate(f.mod)}</time></button>`; }).join('')}
    </section>` : ''}
  </div></div>
  <div class="composer-wrap">
    <label class="composer">${icon('search')}<input id="welcomeInput" type="text" placeholder="${t('composer.placeholder')}" autocomplete="off" spellcheck="false"><kbd>⌘⇧M</kbd></label>
    <div class="composer-meta"><span>${plural('sources', nSrc)} · ${plural('files', total)}</span><span>${t('composer.hint')}</span></div>
  </div>`;
  $('#welcomeInput').addEventListener('input', e => { const v = e.target.value; e.target.value = ''; openSearch(v); });
}
/* Einrichten: erst Standard-App, dann Ordnerzugriff. Verschwindet, wenn beides erledigt ist. */
function setupCard(){
  if (GH) return window.nativelyGitHub.card();
  if (!MAC) return '';
  const denied = realSources().filter(s => s.denied);
  if (S.isDefault && !denied.length) return '';
  const step = (n, done, title, text, action) => `<div class="step${done ? ' done' : ''}">
      <span class="num">${done ? icon('check') : n}</span>
      <span class="txt"><span class="nm">${title}</span><span class="pth">${text}</span></span>${action}</div>`;
  return `<section class="card setup" aria-label="${t('setup.title')}">
    <div class="card-h"><b>${t('setup.title')}</b><span>${t('setup.done', { n:(S.isDefault ? 1 : 0) + (denied.length ? 0 : 1) })}</span></div>
    ${step(1, S.isDefault, t('setup.default'),
      t(S.isDefault ? 'setup.defaultOn' : 'setup.defaultOff'),
      S.isDefault ? '' : `<button class="btn primary" data-act="set-default">${t('setup.makeDefault')}</button>`)}
    ${step(2, !denied.length, t('setup.access'),
      denied.length ? t('setup.denied', { list:denied.map(s => esc(s.name)).join(', ') })
                    : t('setup.accessOk'),
      denied.length ? `<span class="acts"><button class="btn" data-act="open-privacy">${t('setup.openSettings')}</button><button class="btn" data-act="rescan">${t('setup.recheck')}</button></span>` : '')}
  </section>`;
}
function renderMissing(){
  const t = curTab();
  $('#content').innerHTML = `<div class="scroller"><div class="notice">${icon('file', 'big')}<h2>${window.t('missing.title')}</h2><p>${window.t('missing.text', { name:esc(t.file.split('|').pop()) })}</p><div class="btns"><button class="btn" data-act="close-current">${window.t('btn.closeTab')}</button></div></div></div>`;
}
/* Ordner-Übersicht: Unterordner und MD-Dateien eines Ordners (Klick in der Pfadleiste) */
function excerpt(f){
  const i = f.lines.findIndex((l, k) => f.plain[k] && !/^\s*(#|\||```|---)/.test(l));
  return i > -1 ? f.plain[i].slice(0, 160) : '';
}
function renderFolder(key){
  const { src, path } = parseDir(key);
  const s = srcById[src];
  const files = FILES.filter(f => underDir(f, src, path));
  if (!files.length) {
    $('#content').innerHTML = `<div class="scroller"><div class="notice">${icon('folder', 'big')}<h2>${t('folderMissing.title')}</h2><p>${t('folderMissing.text', { name:esc(dirLabel(key)) })}</p><div class="btns"><button class="btn" data-act="back">${t('btn.back')}</button></div></div></div>`;
    return;
  }
  const direct = files.filter(f => f.dir.length === path.length).sort(byName);
  const subs = new Map();
  files.filter(f => f.dir.length > path.length).forEach(f => {
    const name = f.dir[path.length];
    if (!subs.has(name)) subs.set(name, { name, files:[] });
    subs.get(name).files.push(f);
  });
  const subRows = [...subs.values()].sort(byName).map(sd => {
    // Ketten mit nur einem Unterordner zusammenfassen, wie im Baum
    let label = sd.name, segs = [...path, sd.name], list = sd.files;
    for (;;) {
      const here = list.filter(f => f.dir.length === segs.length);
      const next = new Set(list.filter(f => f.dir.length > segs.length).map(f => f.dir[segs.length]));
      if (here.length || next.size !== 1) break;
      const n = [...next][0]; label += ' / ' + n; segs = [...segs, n];
    }
    const newest = sd.files.reduce((a, f) => Math.max(a, f.ts), 0);
    return `<button class="rrow" data-dir="${esc(src + ':/' + segs.join('/'))}">${icon('folder')}<span class="txt"><span class="nm">${esc(label)}</span><span class="pth">${plural('files', sd.files.length)}</span></span><time>${fmtDate(new Date(newest * 1000).toISOString().slice(0, 10))}</time></button>`;
  }).join('');
  const fileRows = direct.map(f => `<button class="rrow" data-open="${esc(f.id)}">${icon('file')}<span class="txt"><span class="nm">${esc(f.title)}</span><span class="pth">${esc(f.name)}${excerpt(f) ? ' · ' + esc(excerpt(f)) : ''}</span></span><time datetime="${f.mod}">${fmtDate(f.mod)}</time></button>`).join('');
  $('#content').innerHTML = `<div class="scroller"><div class="welcome folder">
    <div class="w-head">
      <div class="w-mark">${icon(path.length ? 'folder' : (s ? s.icon : 'folder'))}</div>
      <h1>${esc(dirLabel(key))}</h1>
      <p>${subs.size ? t('folder.in', { files:plural('files', files.length), folders:plural('folders', subs.size) }) : plural('files', files.length)} · ${esc(tilde(dirAbs(key)))}</p>
    </div>
    ${subRows ? `<section class="recent" aria-label="${t('folder.folders')}"><h2>${t('folder.folders')}</h2>${subRows}</section>` : ''}
    ${fileRows ? `<section class="recent" aria-label="${t('folder.files')}"><h2>${t('folder.files')}</h2>${fileRows}</section>` : ''}
  </div></div>`;
}
function renderDoc(f, keepScroll){
  if (f.content == null) {
    const tooBig = !f.cloud && f.size > 1000000;
    $('#content').innerHTML = `<div class="scroller"><div class="notice">${icon(tooBig ? 'file' : 'cloud', 'big')}
      <h2>${t(tooBig ? 'doc.tooBig' : 'doc.cloud')}</h2>
      <p>${t(tooBig ? 'doc.tooBigText' : 'doc.cloudText')}</p>
      <div class="btns"><button class="btn" data-act="reveal">${icon('out')}${t('btn.reveal', { fm:fm() })}</button>${tooBig ? `<button class="btn" data-ext="${esc(f.abs)}">${t('btn.openDefault')}</button>` : ''}</div></div></div>`;
    if (f.cloud && NATIVE) native('download', f.abs).catch(() => {});
    S.heads = null;
    return;
  }
  const { html, heads } = renderMd(f.content, f);
  const back = f.back.filter(id => byId[id] && (byId[id].src === 'extern' || S.enabled.has(byId[id].src)));
  const chip = id => { const x = byId[id]; return `<button class="linkchip" data-open="${esc(id)}" title="${esc(tilde(x.abs))}">${icon('file')}${esc(x.name)}<small>${esc(x.dir[x.dir.length - 1] || (srcById[x.src] ? srcById[x.src].name : ''))}</small></button>`; };
  const backHtml = back.length ? `<section class="backlinks"><h4>${t('doc.backlinks')}</h4><div class="chips">${back.map(chip).join('')}</div></section>` : '';
  const rawHtml = `<pre class="raw">${f.lines.map(l => `<span class="ln">${esc(l)}</span>`).join('')}</pre>`;
  const mm = !S.raw && heads.length > 1 ? `<nav class="minimap" aria-label="${t('doc.outline')}">${heads.map((h, k) => `<span class="dash l${Math.min(h.lvl, 3)}" data-k="${k}"></span>`).join('')}
      <div class="mm-pop">${heads.map((h, k) => `<button class="l${Math.min(h.lvl, 3)}" data-jump="${esc(h.id)}" data-k="${k}">${esc(h.text)}</button>`).join('')}</div></nav>` : '';
  $('#content').innerHTML = `<div class="scroller" id="scroller"><article class="md${S.wide ? ' wide' : ''}" id="article">${S.raw ? rawHtml : html}${S.raw ? '' : backHtml}
    <footer class="docmeta"><span>${t('doc.modified', { d:fmtDate(f.mod) })}</span><span>${t('doc.lines', { n:f.lines.length })}</span><span>${esc(tilde(f.abs))}</span></footer></article></div>${mm}`;
  S.heads = heads;
  const sc = $('#scroller');
  sc.addEventListener('scroll', spy, { passive:true });
  S.hitCount = 0;
  if (S.hits.length && !S.raw) {
    S.hitCount = markTerms($('#article'), S.hits);
    const first = $('#article mark.hit');
    if (first && keepScroll == null) first.scrollIntoView({ block:'center' });
  }
  if (keepScroll != null) sc.scrollTop = keepScroll;
  spy();
  if (GH) window.nativelyGitHub.afterDoc(f);
}
function spy(){
  const sc = $('#scroller');
  if (!sc || !S.heads || !S.heads.length) return;
  const top = sc.getBoundingClientRect().top + 90;
  let k = 0;
  S.heads.forEach((h, i) => { const el = document.getElementById(h.id); if (el && el.getBoundingClientRect().top <= top) k = i; });
  document.querySelectorAll('.minimap [data-k]').forEach(el => el.classList.toggle('on', +el.dataset.k === k));
}
function markTerms(root, terms){
  const test = new RegExp(terms.map(reEsc).join('|'), 'i');
  const split = new RegExp('(' + terms.map(reEsc).join('|') + ')', 'gi');
  const nodes = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode:n => (n.parentElement.closest('code,pre,mark,.docmeta,.backlinks') || !test.test(n.nodeValue)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  while (w.nextNode()) nodes.push(w.currentNode);
  let count = 0;
  nodes.forEach(n => {
    const frag = document.createDocumentFragment();
    n.nodeValue.split(split).forEach((part, i) => {
      if (i % 2) { const m = document.createElement('mark'); m.className = 'hit'; m.textContent = part; frag.appendChild(m); count++; }
      else if (part) frag.appendChild(document.createTextNode(part));
    });
    n.parentNode.replaceChild(frag, n);
  });
  return count;
}
function renderContent(keepScroll){
  const t = curTab();
  const f = curFile();
  if (f) renderDoc(f, keepScroll);
  else if (t.file && S.loaded) { S.heads = null; renderMissing(); }
  else if (t.dir && S.loaded) { S.heads = null; renderFolder(t.dir); }
  else if (t.view && GH && S.loaded) { S.heads = null; window.nativelyGitHub.renderView(t.view, $('#content')); }
  else { S.heads = null; renderWelcome(); }
}
function render(opt = {}){
  renderTabs(); renderContent(opt.keepScroll); renderCrumbs(); renderTree(); renderNav(); queueDrag();
  if (S.search.open) renderSearch();
}

/* ---------- Öffnen, Tabs, Verlauf ---------- */
function pushHist(entry){ S.hist = S.hist.slice(0, S.hidx + 1); if (S.hist[S.hidx] !== entry) { S.hist.push(entry); S.hidx = S.hist.length - 1; } }
function closeDrawers(){ if (mqTree.matches) S.treeOn = false; if (mqNav.matches) S.navOn = false; applyLayout(); }
function openFile(id, opt = {}){
  const { newTab = false, pin = false, push = true, hits = [] } = opt;
  if (!byId[id]) return;
  const t = curTab();
  const ex = S.tabs.findIndex(x => x.file === id);
  if (ex > -1 && !newTab) { S.active = ex; if (pin) S.tabs[ex].preview = false; }
  else if (newTab || (t.file && !t.preview && byId[t.file])) { S.tabs.splice(S.active + 1, 0, { file:id, dir:null, view:null, preview:!pin }); S.active++; }
  else { t.file = id; t.dir = null; t.view = null; t.preview = !pin; }
  S.hits = hits;
  S.raw = false;
  S.recent = [id, ...S.recent.filter(x => x !== id)].slice(0, 20);
  store.set('recent', S.recent);
  expandTo(byId[id]);
  if (push) pushHist('f:' + id);
  closeDrawers();
  render();
  const sc = $('#scroller'); if (sc && !hits.length) sc.scrollTop = 0;
  const row = $('#treeList .row.active'); if (row) row.scrollIntoView({ block:'nearest' });
}
/* Ordner-Übersicht im aktuellen Tab öffnen (wie die Pfadleiste im Finder) */
function openDir(key, opt = {}){
  const { push = true } = opt;
  const t = curTab();
  t.file = null; t.dir = key; t.view = null; t.preview = false;
  S.hits = []; S.raw = false;
  const { src, path } = parseDir(key);
  S.collapsedSrc.delete(src);
  for (let k = 1; k <= path.length; k++) S.expanded.add(src + ':/' + path.slice(0, k).join('/'));
  saveExpanded();
  if (push) pushHist('d:' + key);
  closeDrawers();
  render();
  const sc = $('#scroller'); if (sc) sc.scrollTop = 0;
  const row = $('#treeList .row.active'); if (row) row.scrollIntoView({ block:'nearest' });
}
function newTab(){ S.tabs.splice(S.active + 1, 0, { file:null, dir:null, preview:false }); S.active++; S.hits = []; pushHist(''); closeDrawers(); render(); }
/* Eigene Ansicht im aktuellen Tab (Team-Version: Verlauf) */
function openView(view, opt = {}){
  const { push = true, newTab = false } = opt;
  const ex = S.tabs.findIndex(x => x.view === view);
  if (ex > -1) S.active = ex;
  else if (newTab || curTab().file || curTab().dir) { S.tabs.splice(S.active + 1, 0, { file:null, dir:null, view, preview:false }); S.active++; }
  else { const t = curTab(); t.view = view; t.preview = false; }
  S.hits = []; S.raw = false;
  if (push) pushHist('v:' + view);
  closeDrawers();
  render();
}
function showStart(){
  const t = curTab();
  if (t.file || t.dir || t.view) { const i = S.tabs.findIndex(x => !x.file && !x.dir && !x.view); if (i > -1) S.active = i; else { S.tabs.splice(S.active + 1, 0, { file:null, dir:null, preview:false }); S.active++; } }
  S.hits = []; pushHist(''); closeDrawers(); render();
}
function closeTab(i){
  S.tabs.splice(i, 1);
  if (!S.tabs.length) S.tabs.push({ file:null, preview:false });
  if (i < S.active || S.active >= S.tabs.length) S.active = Math.max(0, S.active - 1);
  S.hits = []; S.raw = false;
  render();
}
function goHist(d){
  const n = S.hidx + d;
  if (n < 0 || n >= S.hist.length) return;
  S.hidx = n;
  const entry = S.hist[n] || '';
  if (entry.startsWith('f:')) { if (byId[entry.slice(2)]) openFile(entry.slice(2), { push:false }); else goHist(d); }
  else if (entry.startsWith('d:')) openDir(entry.slice(2), { push:false });
  else if (entry.startsWith('v:') && GH) openView(entry.slice(2), { push:false });
  else { const t = curTab(); t.file = null; t.dir = null; t.view = null; t.preview = false; S.hits = []; render(); }
}

/* ---------- Suche (⌘⇧M) ---------- */
const sq = $('#sq');
function fillSourceSelect(){
  const sel = $('#sSrc');
  sel.innerHTML = `<option value="all">${t('search.all')}</option>` + realSources().filter(s => S.enabled.has(s.id)).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = srcById[S.search.src] ? S.search.src : 'all';
  S.search.src = sel.value;
}
const terms = () => S.search.q.toLowerCase().split(/\s+/).filter(Boolean);
function runSearch(){
  const { titleOnly, src, sort } = S.search;
  const T = terms();
  const pool = visibleFiles().filter(f => src === 'all' || f.src === src);
  if (!T.length) return pool.slice().sort((a, b) => b.ts - a.ts).slice(0, 15).map(f => ({ f, hits:0, lines:[], score:0 }));
  const res = [];
  for (const f of pool) {
    const title = (f.title + ' ' + f.name).toLowerCase();
    const pathS = f.path.join(' ').toLowerCase();
    let ok = true, score = 0, hits = 0;
    for (const t of T) {
      const inTitle = title.includes(t);
      if (titleOnly) { if (!inTitle) { ok = false; break; } score += 20; continue; }
      let c = 0;
      for (const l of f.low) { let p = l.indexOf(t); while (p > -1) { c++; p = l.indexOf(t, p + t.length); } }
      const inPath = pathS.includes(t);
      if (!inTitle && !c && !inPath) { ok = false; break; }
      score += (inTitle ? 20 : 0) + Math.min(c, 20) + (inPath ? 3 : 0);
      hits += c;
    }
    if (!ok) continue;
    const lines = [];
    if (!titleOnly) f.low.forEach((l, li) => { if (l && T.some(t => l.includes(t))) lines.push(li); });
    res.push({ f, score, hits, lines });
  }
  res.sort(sort === 'recent' ? (a, b) => b.f.ts - a.f.ts : (a, b) => b.score - a.score || b.f.ts - a.f.ts);
  return res.slice(0, 200);
}
function hl(text, T){
  if (!T.length) return esc(text);
  const re = new RegExp('(' + T.map(t => reEsc(esc(t))).join('|') + ')', 'gi');
  return esc(text).replace(re, '<mark>$1</mark>');
}
function snippet(f, r, T){
  const idx = r.lines.find(i => !/^\s*#/.test(f.lines[i])) ?? r.lines[0];
  if (idx == null) return esc((f.plain.filter(Boolean)[1] || '').slice(0, 180));
  const ln = f.plain[idx], low = f.low[idx];
  const pos = Math.min(...T.map(t => { const p = low.indexOf(t); return p < 0 ? Infinity : p; }));
  const start = Math.max(0, (isFinite(pos) ? pos : 0) - 60);
  return (start > 0 ? '… ' : '') + hl(ln.slice(start, start + 200), T);
}
function renderSearch(){
  const T = terms();
  const R = S.search.results = runSearch();
  if (S.search.sel >= R.length) S.search.sel = Math.max(0, R.length - 1);
  $('#chipTitle').setAttribute('aria-pressed', S.search.titleOnly);
  $('#sCount').innerHTML = T.length
    ? `<span>${plural('search.files', R.length)}</span><span>${plural('search.hits', R.reduce((a, r) => a + r.hits, 0))}</span>`
    : `<span>${t('search.recent')}</span><span>${plural('files', visibleFiles().length)}</span>`;
  $('#sList').innerHTML = R.length ? R.map((r, i) => `<button class="s-item${i === S.search.sel ? ' sel' : ''}" role="option" aria-selected="${i === S.search.sel}" data-hit="${i}">
      ${icon('file')}<span class="t"><span>${hl(r.f.title, T)}</span>${r.hits ? `<span class="badge">${r.hits}</span>` : ''}</span>
      <span class="m">${esc(rel(r.f))} · ${fmtDate(r.f.mod)}</span>
      <span class="sn">${snippet(r.f, r, T)}</span></button>`).join('')
    : `<div class="s-empty">${t('search.empty', { q:esc(S.search.q) })}${S.search.titleOnly ? '<br>' + t('search.titleOnlyOn') : ''}</div>`;
  renderPreview();
}
function renderPreview(){
  const r = S.search.results[S.search.sel];
  const P = $('#sPrev');
  if (!r) { P.innerHTML = `<div class="p-none">${t('search.noPreview')}</div>`; return; }
  const f = r.f, T = terms();
  const lines = r.lines.length ? r.lines.slice(0, 5).map(i => `<div class="p-line">${hl(f.plain[i].slice(0, 220), T)}</div>`).join('')
    : f.plain.filter(Boolean).slice(1, 4).map(l => `<div class="p-line">${esc(l.slice(0, 220))}</div>`).join('');
  const lk = ids => ids.filter(id => byId[id]).map(id => `<button data-open="${esc(id)}">${icon('file')}${esc(byId[id].name)}</button>`).join('') || `<span class="p-none">${t('search.none')}</span>`;
  P.innerHTML = `<div class="p-path">${esc(rel(f))}</div><h3>${hl(f.title, T)}</h3>
    <div class="p-meta">${t('doc.modified', { d:fmtDate(f.mod) })}${T.length && !S.search.titleOnly ? ` · ${plural('search.hits', r.hits)}` : ''}</div>
    <div><div class="p-label">${t(r.lines.length ? 'search.matches' : 'search.excerpt')}</div>${lines}</div>
    <div><div class="p-label">${t('search.linksTo')}</div><div class="p-links">${lk(f.out)}</div></div>
    <div><div class="p-label">${t('search.linkedFrom')}</div><div class="p-links">${lk(f.back)}</div></div>
    <div><button class="btn primary" data-hit-open="${S.search.sel}">${t('search.open')} ${icon('enter')}</button></div>`;
}
function openSearch(q){
  if (typeof q === 'string') S.search.q = q;
  S.search.sel = 0;
  fillSourceSelect();
  $('#search').hidden = false;
  S.search.open = true;
  sq.value = S.search.q;
  renderSearch();
  sq.focus();
  sq.setSelectionRange(sq.value.length, sq.value.length);
  queueDrag();
}
function closeSearch(){ $('#search').hidden = true; S.search.open = false; queueDrag(); }
function openHit(i, inNewTab){
  const r = S.search.results[i];
  if (!r) return;
  const T = S.search.titleOnly ? [] : terms();
  closeSearch();
  openFile(r.f.id, { newTab:inNewTab, hits:T });
}
sq.addEventListener('input', () => { S.search.q = sq.value; S.search.sel = 0; renderSearch(); });
sq.addEventListener('keydown', e => {
  const n = S.search.results.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); S.search.sel = Math.min(n - 1, S.search.sel + 1); renderSearch(); $('#sList .sel')?.scrollIntoView({ block:'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); S.search.sel = Math.max(0, S.search.sel - 1); renderSearch(); $('#sList .sel')?.scrollIntoView({ block:'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); openHit(S.search.sel, e.metaKey || e.ctrlKey); }
});
$('#sSrc').addEventListener('change', e => { S.search.src = e.target.value; renderSearch(); sq.focus(); });
$('#sSort').addEventListener('change', e => { S.search.sort = e.target.value; renderSearch(); sq.focus(); });
$('#sList').addEventListener('mousemove', e => {
  const b = e.target.closest('[data-hit]');
  if (b && +b.dataset.hit !== S.search.sel) {
    S.search.sel = +b.dataset.hit;
    document.querySelectorAll('#sList .s-item').forEach((el, i) => { el.classList.toggle('sel', i === S.search.sel); el.setAttribute('aria-selected', i === S.search.sel); });
    renderPreview();
  }
});
$('#search').addEventListener('mousedown', e => { if (e.target.id === 'search') closeSearch(); });

/* ---------- Menü, Hinweis, Tabelle ---------- */
let menuEl = null;
function closeMenu(){ if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(btn){
  closeMenu();
  const f = curFile();
  if (!f && !curDir()) return;
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('role', 'menu');
  const basic = `
    <button role="menuitem" data-act="copy-path">${icon('copy')}${t('menu.copyPath')}</button>
    <button role="menuitem" data-act="reveal">${icon('out')}${t('btn.reveal', { fm:fm() })}</button>`;
  menuEl.innerHTML = !f ? basic : basic + `
    <hr>
    <button role="menuitem" data-act="pin">${icon('pin')}${t(S.pinned.has(f.id) ? 'menu.unpin' : 'menu.pin')}</button>
    <button role="menuitem" data-act="wide">${icon('width')}${t(S.wide ? 'menu.narrow' : 'menu.wide')}</button>
    <button role="menuitem" data-act="raw">${icon('code')}${t(S.raw ? 'menu.formatted' : 'menu.raw')}</button>${GH ? window.nativelyGitHub.menu(f) : ''}`;
  document.body.appendChild(menuEl);
  const r = btn.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  menuEl.style.top = (r.bottom + 6) + 'px';
  menuEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menuEl.querySelector('button').focus();
}
let toastTimer;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3600);
}
function expandTable(btn){
  const wrap = btn.closest('.tablewrap');
  const f = curFile();
  $('#tTitle').textContent = t('table.title', { name:f ? f.name : '' });
  $('#tBody').innerHTML = `<div class="tablescroll">${wrap.querySelector('table').outerHTML}</div>`;
  $('#tableOverlay').hidden = false;
  $('#tableOverlay .iconbtn').focus();
  queueDrag();
}
$('#tableOverlay').addEventListener('mousedown', e => { if (e.target.id === 'tableOverlay') { $('#tableOverlay').hidden = true; queueDrag(); } });

async function withData(promise, message){
  try {
    const json = await promise;
    if (json) { setData(JSON.parse(json)); render(); if (message) toast(message()); }
  } catch(e) { toast(t('toast.failed', { msg:e.message })); }
}
async function refreshDefault(){
  if (!MAC) return;
  try { S.isDefault = !!(await native('isDefault')); } catch(e) {}
}

/* ---------- Aktionen ---------- */
function doAct(act, el){
  const f = curFile();
  switch (act) {
    case 'nav-toggle': setNav(!S.navOn); break;
    case 'lang': setLang(LANG === 'en' ? 'de' : 'en'); store.set('lang', LANG); applyStatic(); nameSources(); fillSourceSelect(); render(); break;
    case 'tree-toggle': setTree(!S.treeOn); break;
    case 'scrim': closeDrawers(); renderCrumbs(); break;
    case 'new-tab': newTab(); break;
    case 'close-tab': case 'close-current':
      if (S.tabs.length === 1 && !curTab().file && !curTab().dir && !curTab().view) { if (MAC && act === 'close-tab') native('closeWindow'); }
      else closeTab(S.active);
      break;
    case 'sources': showStart(); break;
    case 'search': closeDrawers(); S.search.open ? closeSearch() : openSearch(''); break;
    case 'filter': if (!S.treeOn) setTree(true); $('#treeFilter').focus(); $('#treeFilter').select(); break;
    case 'close-search': closeSearch(); break;
    case 'title-only': S.search.titleOnly = !S.search.titleOnly; renderSearch(); sq.focus(); break;
    case 'back': goHist(-1); break;
    case 'fwd': goHist(1); break;
    case 'raw': closeMenu(); if (f) { S.raw = !S.raw; renderContent(); renderCrumbs(); } break;
    case 'collapse-all': S.expanded.clear(); if (f) expandTo(f); saveExpanded(); renderTree(); break;
    case 'more': menuEl ? closeMenu() : openMenu(el); break;
    case 'copy-path': {
      closeMenu();
      const p = f ? f.abs : curDir() ? dirAbs(curDir()) : '';
      if (p) {
        if (MAC) native('copy', p).then(() => toast(t('toast.copied')));
        else if (WEB || GH) (navigator.clipboard ? navigator.clipboard.writeText(p) : Promise.reject()).catch(() => native('copy', p)).then(() => toast(t('toast.copied')), () => toast(p));
        else toast(p);
      }
      break;
    }
    case 'reveal': {
      closeMenu();
      const p = f ? f.abs : curDir() ? dirAbs(curDir()) : '';
      if (p && NATIVE) native('reveal', p);
      break;
    }
    case 'pin':
      closeMenu();
      if (f) { S.pinned.has(f.id) ? S.pinned.delete(f.id) : S.pinned.add(f.id); store.set('pinned', [...S.pinned]); renderNav(); toast(t(S.pinned.has(f.id) ? 'toast.pinned' : 'toast.unpinned')); }
      break;
    case 'wide': { closeMenu(); S.wide = !S.wide; store.set('wide', S.wide); const a = $('#article'); if (a) a.classList.toggle('wide', S.wide); break; }
    case 'expand-table': expandTable(el); break;
    case 'close-table': $('#tableOverlay').hidden = true; queueDrag(); break;
    case 'clear-hits': S.hits = []; renderContent(); renderCrumbs(); break;
    case 'add-folder': {
      if (GH) { window.nativelyGitHub.newArea(); break; }
      if (!WEB) { withData(native('addFolder'), () => t('toast.folderAdded')); break; }
      // Im Browser gibt es keinen Ordner-Dialog mit echtem Pfad: Pfad eintippen oder einfügen
      const p = prompt(t('prompt.folder', { ex:PLATFORM === 'win32' ? 'C:\\Users\\name\\Notes' : '~/Notes', fm:fm() }), '');
      if (p && p.trim()) withData(native('addFolder', p.trim()), () => t('toast.folderAdded'));
      break;
    }
    case 'rescan': {
      const b = $('#rescanBtn'); if (b) b.classList.add('spinning');
      withData(native('rescan'), () => t('toast.scanned', { sources:plural('sources', realSources().length), files:plural('files', visibleFiles().length) }));
      break;
    }
    case 'set-default':
      native('setDefault').then(async msg => { toast(msg); await refreshDefault(); if (!curTab().file) renderWelcome(); }).catch(e => toast(e.message));
      break;
    case 'open': native('openPanel').catch(() => {}); break;
    case 'open-privacy': native('openURL', 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders').catch(() => {}); break;
  }
}

document.addEventListener('click', e => {
  if (menuEl && !e.target.closest('.menu') && !e.target.closest('[data-act="more"]')) closeMenu();
  const el = e.target.closest('[data-open],[data-file],[data-toggle],[data-toggle-src],[data-close-tab],[data-tab],[data-act],[data-src-toggle],[data-remove-folder],[data-crumb],[data-dir],[data-hit],[data-hit-open],[data-jump],[data-ext],[data-url]');
  if (!el) return;
  const d = el.dataset;
  if (el.tagName === 'A') e.preventDefault();
  if (d.closeTab !== undefined) { e.stopPropagation(); closeTab(+d.closeTab); return; }
  if (d.removeFolder) { e.stopPropagation(); withData(native('removeFolder', d.removeFolder), () => t('toast.folderRemoved')); return; }
  if (d.open) { if (S.search.open) closeSearch(); openFile(d.open, { newTab:e.metaKey || e.ctrlKey }); return; }
  if (d.file) { openFile(d.file, { newTab:e.metaKey || e.ctrlKey }); return; }
  if (d.ext) { native('openExternal', d.ext).catch(() => toast(d.ext)); return; }
  if (d.url) { if (!safeExternal(d.url)) return; if (NATIVE) native('openURL', d.url); else window.open(d.url, '_blank', 'noopener'); return; }
  if (d.hitOpen !== undefined) { openHit(+d.hitOpen, e.metaKey || e.ctrlKey); return; }
  if (d.hit !== undefined) { openHit(+d.hit, e.metaKey || e.ctrlKey); return; }
  if (d.toggle) { S.expanded.has(d.toggle) ? S.expanded.delete(d.toggle) : S.expanded.add(d.toggle); saveExpanded(); renderTree(); return; }
  if (d.toggleSrc) { S.collapsedSrc.has(d.toggleSrc) ? S.collapsedSrc.delete(d.toggleSrc) : S.collapsedSrc.add(d.toggleSrc); saveExpanded(); renderTree(); return; }
  if (d.tab !== undefined) { S.active = +d.tab; S.hits = []; S.raw = false; pushHist(entryOf(curTab())); render(); return; }
  if (d.dir) { openDir(d.dir); return; }
  if (d.srcToggle) {
    const id = d.srcToggle;
    if (srcById[id] && srcById[id].fixed) return;
    S.enabled.has(id) ? S.enabled.delete(id) : S.enabled.add(id);
    store.set('disabled', realSources().map(s => s.id).filter(x => !S.enabled.has(x)));
    render(); return;
  }
  if (d.crumb) { openDir(d.crumb); return; }
  if (d.jump) { const t = document.getElementById(d.jump); if (t) t.scrollIntoView({ behavior:reduceMotion() ? 'auto' : 'smooth', block:'start' }); return; }
  if (d.act) doAct(d.act, el);
});
document.addEventListener('dblclick', e => {
  const row = e.target.closest('[data-file]');
  if (row) { openFile(row.dataset.file, { pin:true }); return; }
  // Doppelklick auf einen Ordner im Baum: Ordner-Übersicht öffnen (der erste Klick hat ihn schon umgeschaltet)
  const dirRow = e.target.closest('#treeList [data-toggle],#treeList [data-toggle-src]');
  if (dirRow) {
    const key = dirRow.dataset.toggle || dirRow.dataset.toggleSrc + ':';
    if (dirRow.dataset.toggle) S.expanded.add(key); else S.collapsedSrc.delete(dirRow.dataset.toggleSrc);
    openDir(key);
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) { S.tabs[+tab.dataset.tab].preview = false; renderTabs(); }
});
document.addEventListener('keydown', e => {
  const tab = e.target.closest && e.target.closest('[data-tab],[data-src-toggle]');
  if (tab && (e.key === 'Enter' || e.key === ' ') && e.target === tab) { e.preventDefault(); tab.click(); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (!MAC && mod && e.shiftKey && (e.code === 'KeyM')) { e.preventDefault(); doAct('search'); return; }
  if ((WEB || GH) && mod && !e.shiftKey) {
    // Kürzel, die sonst das Menü der Mac-App liefert (⌘T und ⌘W gehören im Browser dem Browser)
    const k = e.code;
    if (k === 'Backslash') { e.preventDefault(); doAct(e.altKey ? 'tree-toggle' : 'nav-toggle'); return; }
    if (k === 'BracketLeft') { e.preventDefault(); doAct('back'); return; }
    if (k === 'BracketRight') { e.preventDefault(); doAct('fwd'); return; }
    if (e.altKey && k === 'KeyU') { e.preventDefault(); doAct('raw'); return; }
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing && !S.search.open) { e.preventDefault(); openSearch(''); return; }
  if (e.key === 'Escape') {
    if (!$('#tableOverlay').hidden) { $('#tableOverlay').hidden = true; queueDrag(); }
    else if (menuEl) closeMenu();
    else if (S.search.open) closeSearch();
    else if (!$('#scrim').hidden) { closeDrawers(); renderCrumbs(); }
  }
});
$('#treeFilter').addEventListener('input', e => {
  const v = e.target.value;
  if (v.startsWith('?')) { e.target.value = ''; S.filter = ''; renderTree(); openSearch(v.slice(1).trim()); return; }
  S.filter = v.trim(); renderTree();
});
$('#treeFilter').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const first = $('#treeList .row.file'); if (first) first.click(); }
  if (e.key === 'Escape') { e.target.value = ''; S.filter = ''; renderTree(); e.stopPropagation(); e.target.blur(); }
});

/* ---------- Schnittstelle für die Mac-App ---------- */
window.natively = {
  apply(change){
    if (!change) return;
    const sc = $('#scroller');
    const keep = sc ? sc.scrollTop : null;
    if (change.full) setData(change.full);
    else {
      const rem = new Set(change.removes || []);
      const ups = change.upserts || [];
      const upAbs = new Set(ups.map(u => u.abs));
      FILES = FILES.filter(f => !rem.has(f.abs) || upAbs.has(f.abs));
      for (const u of ups) {
        indexFile(u);
        const i = FILES.findIndex(f => f.abs === u.abs);
        if (i > -1) FILES[i] = u; else FILES.push(u);
      }
      relink();
    }
    render({ keepScroll:keep });
  },
  command(c){ doAct(c, null); },
  openPath(abs, info){
    let f = byAbs[abs];
    if (!f && info) { info.src = 'extern'; info.id = 'extern|' + abs; indexFile(info); FILES.push(info); relink(); f = info; }
    if (f) openFile(f.id, { pin:true });
    else toast(t('toast.openFailed'));
  },
  /* Ordner-Übersicht für einen Ordnerpfad (npx natively-md ordner/) */
  openFolder(key, abs){
    if (FILES.some(f => key.endsWith(':') ? f.src === key.slice(0, -1) : underDir(f, parseDir(key).src, parseDir(key).path))) openDir(key);
    else toast(t('toast.noMd', { path:tilde(abs || key) }));
  },
  /* für die Team-Version (github.js) */
  curFile, render, renderContent, openFile, openView, curTab, isRaw: () => S.raw, files: () => FILES,
  setFullscreen(on){ document.documentElement.classList.toggle('fs', !!on); queueDrag(); },
  toast,
  reportDrag
};

/* Standard-App kann sich im Finder ändern: beim Zurückkehren ins Fenster neu prüfen */
window.addEventListener('focus', async () => {
  if (!MAC || !S.loaded) return;
  const before = S.isDefault;
  await refreshDefault();
  if (before !== S.isDefault && !curTab().file && !curTab().dir) renderWelcome();
});

/* ---------- Start ---------- */
async function boot(){
  await loadPrefs();
  // Englisch ist Standard, die eigene Mac-App bleibt auf Deutsch, bis jemand umschaltet
  setLang(store.get('lang', MAC || GH ? 'de' : 'en'));
  applyStatic();
  initState();
  $('#navResizer')._restore();
  $('#treeResizer')._restore();
  applyLayout();
  render();
  if (NATIVE) {
    try { const json = await native('scan'); if (json) setData(JSON.parse(json)); }
    catch(e) { toast(t('toast.scanFailed', { msg:e.message })); }
    await refreshDefault();
  }
  if (WEB) {
    // Offene Tabs mit Dateien außerhalb der Quellen wiederherstellen
    for (const tab of S.tabs) {
      if (!tab.file || !tab.file.startsWith('extern|') || byId[tab.file]) continue;
      try {
        const info = JSON.parse(await native('info', tab.file.slice(7)) || 'null');
        if (info) { info.src = 'extern'; info.id = tab.file; indexFile(info); FILES.push(info); }
      } catch(e) {}
    }
    relink();
  }
  S.loaded = true;
  const f = curFile();
  if (f) expandTo(f);
  S.hist = [entryOf(curTab())]; S.hidx = 0;
  render();
  if (NATIVE) native('ready').catch(() => {});
  if (WEB) connectEvents();
}
/* Browser: Änderungen und „Datei öffnen“ kommen als Server-Sent-Events vom lokalen Server */
let eventFails = 0;
function connectEvents(){
  const es = new EventSource('/api/events?t=' + encodeURIComponent(window.nativelyWeb.token));
  es.addEventListener('open', () => { eventFails = 0; });
  es.addEventListener('change', e => window.natively.apply(JSON.parse(e.data)));
  es.addEventListener('show', e => {
    for (const it of JSON.parse(e.data)) {
      if (it.type === 'file') window.natively.openPath(it.abs, it.info);
      else if (it.type === 'dir') window.natively.openFolder(it.key, it.abs);
      else toast(t('toast.notFound', { path:tilde(it.abs) }));
    }
    window.focus();
  });
  es.onerror = async () => {
    // natively neu gestartet (neuer Schlüssel): Seite neu laden. Läuft es nicht mehr: Hinweis und weiter versuchen.
    try { const r = await fetch('/api/ping?t=' + encodeURIComponent(window.nativelyWeb.token)); if (r.status === 403) { location.reload(); return; } } catch(e) {}
    if (++eventFails === 3) toast(t('toast.stopped'));
    if (es.readyState === EventSource.CLOSED) setTimeout(connectEvents, 2000);
  };
}
boot();
