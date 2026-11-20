// Test harness: runs the real client/github.js (a browser script) inside a node:vm context,
// with a minimal fake browser around it. Every fetch goes in-process to lib/mock.js (the fake GitHub).
// Each call to start() gets a fresh mock (own repos, commits) and a fresh client. No dependencies.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = fs.readFileSync(path.join(here, '../client/github.js'), 'utf8');
const I18N = fs.readFileSync(path.join(here, '../../ui/i18n.js'), 'utf8');   // loaded before github.js, as on the page
const MOCK = path.join(here, '../lib/mock.js');
let instance = 0;

/* A tiny in-memory Storage (localStorage / sessionStorage) */
function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), get length() { return m.size; }, _map: m };
}

/* Fake element: enough for status(), dialog() and conflict() */
function element(log) {
  const el = { className: '', innerHTML: '', id: '', style: {}, dataset: {}, isConnected: true, parentElement: null, children: [], _listeners: {},
    classList: { add: c => { el.className += ' ' + c; }, remove() {}, contains: c => el.className.split(/\s+/).includes(c) },
    addEventListener: (t, fn) => { (el._listeners[t] ||= []).push(fn); },
    removeEventListener() {}, appendChild: c => { el.children.push(c); c.parentElement = el; return c; },
    remove: () => { el.isConnected = false; const i = log.indexOf(el); if (i >= 0) log.splice(i, 1); },
    querySelector: () => null, querySelectorAll: () => [], focus() {}, setAttribute() {}, getAttribute: () => null, closest: () => null };
  return el;
}

export async function start({ lang = 'en', storage: init = {} } = {}) {
  const mod = await import(MOCK + '?i=' + (++instance));   // fresh mock state per test
  const timers = new Set(), intervals = new Set();
  let inflight = 0;
  const calls = [];                                          // every request the client made: { method, path, body }
  const toasts = [], dialogs = [];

  /* fetch → mock(req, res, path, body), same shape as server.js does it */
  async function fetchImpl(url, opt = {}) {
    inflight++;
    try {
      const u = new URL(url, 'http://localhost');
      if (!u.pathname.startsWith('/mock/api')) return response(404, {}, '{}');
      const p = url.slice(url.indexOf('/mock/api') + '/mock/api'.length);
      const method = opt.method || 'GET';
      const body = opt.body ? JSON.parse(opt.body) : {};
      calls.push({ method, path: p, body });
      const headers = {}; for (const [k, v] of Object.entries(opt.headers || {})) headers[k.toLowerCase()] = v;
      const out = await new Promise((resolve, reject) => {
        const h = {};
        const res = { statusCode: 200, setHeader: (k, v) => { h[k.toLowerCase()] = v; }, end: s => resolve({ status: res.statusCode, headers: h, text: s || '' }), destroy: () => reject(new TypeError('Failed to fetch')) };
        Promise.resolve(mod.mock({ method, headers }, res, p, body)).catch(reject);
      });
      return response(out.status, out.headers, out.text);
    } finally { inflight--; }
  }
  function response(status, headers, text) {
    return { status, ok: status >= 200 && status < 300, statusText: String(status), headers: { get: k => headers[k.toLowerCase()] ?? null },
      json: async () => JSON.parse(text), text: async () => text };
  }

  const overlays = [];
  const listeners = {};
  const document = {
    hidden: false,
    documentElement: { lang },
    body: { appendChild: el => { overlays.push(el); dialogs.push(el); el.parentElement = document.body; return el; } },
    getElementById: () => null,
    querySelector: sel => (sel.includes('gh-ov') ? overlays.find(o => o.isConnected && sel.split('.').filter(Boolean).every(c => o.className.split(/\s+/).includes(c))) || null : null),
    querySelectorAll: () => [],
    createElement: () => element(overlays),
    addEventListener: (t, fn) => { (listeners['doc:' + t] ||= []).push(fn); },
  };

  /* The part of app.js (window.natively) that github.js talks to */
  let files = [], current = null;
  const ui = {
    files: () => files,
    curFile: () => files.find(f => f.id === current) || null,
    curTab: () => ({ file: current }),
    apply(ch) {   // like app.js: index the given objects in place (sets name) and keep them
      const index = f => { f.name = f.path[f.path.length - 1]; return f; };
      if (ch.full) files = ch.full.files.map(index);
      const ups = ch.upserts || [], upAbs = new Set(ups.map(u => u.abs));
      files = files.filter(f => !(ch.removes || []).includes(f.abs) || upAbs.has(f.abs));
      for (const u of ups) { index(u); const i = files.findIndex(f => f.abs === u.abs); if (i >= 0) files[i] = u; else files.push(u); }
    },
    toast: m => toasts.push(m), render() {}, openFile: id => { current = id; }, openView() {},
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    URL, URLSearchParams, TextEncoder, TextDecoder, Intl, crypto: globalThis.crypto, atob, btoa, Promise, Uint8Array,
    setTimeout: (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); t.unref(); timers.add(t); return t; },
    clearTimeout: t => { clearTimeout(t); timers.delete(t); },
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref(); intervals.add(t); return t; },
    clearInterval: t => { clearInterval(t); intervals.delete(t); },
    fetch: fetchImpl,
    localStorage: storage({ 'natively:gh': JSON.stringify({ token: 'mock' }), 'natively:gh:welcomed': '1', ...init }),
    sessionStorage: storage(),
    location: { search: '', pathname: '/', href: '/' },
    history: { replaceState() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    document,
    icon: () => '',
    addEventListener: (t, fn) => { (listeners['win:' + t] ||= []).push(fn); },
    open() {},
  };
  ctx.window = ctx;
  ctx.NATIVELY_API = '/mock/api';
  ctx.natively = ui;
  vm.createContext(ctx);
  vm.runInContext(I18N + `\nsetLang(${JSON.stringify(lang)}); window.t = t;`, ctx, { filename: 'ui/i18n.js' });
  vm.runInContext(CLIENT, ctx, { filename: 'client/github.js' });
  const gh = ctx.nativelyGitHub;

  /* Wait until the client is idle: no request in flight and no save running, for a few turns of the event loop */
  async function settle() {
    for (let calm = 0, n = 0; calm < 5 && n < 5000; n++) {
      await new Promise(r => setImmediate(r));
      const busy = inflight > 0 || Object.values(gh.dirty).some(d => d.saving);
      calm = busy ? 0 : calm + 1;
    }
  }
  /* Load everything (like the app does on start) and hand the file list to the fake UI */
  async function scan() {
    const d = JSON.parse(await gh.cmd('scan'));
    ui.apply({ full: d });
    await settle();
    return d;
  }
  const id = (repo, p) => 'gh-' + repo + '|' + p;
  const file = fid => files.find(f => f.id === fid);
  /* Type into a file: what setDraft() does after an edit (draft + base + known sha) */
  function edit(fid, text) {
    const f = file(fid);
    const d = gh.dirty[fid] || { base: f.content, sha: f.sha };
    d.draft = text; d.ts = Date.now(); gh.dirty[fid] = d;
    f.content = text;
  }
  async function save() { gh.saveNow(); await settle(); }
  /* Click a button in the open conflict dialog */
  async function choose(action) {
    const ov = overlays.find(o => o.isConnected && o.className.includes('conflict'));
    if (!ov) throw new Error('no conflict dialog open');
    for (const fn of ov._listeners.click || []) fn({ target: { closest: () => ({ dataset: { d: action } }) } });
    await settle();
  }
  /* Wait for a condition that depends on the client's own timers (e.g. the 500 ms save after restoring a draft) */
  async function waitFor(cond, ms = 5000) {
    const end = Date.now() + ms;
    while (!cond()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(r => setTimeout(r, 20)); }
    await settle();
  }
  /* Fire a window event the client listens to, e.g. 'online' or 'focus' */
  async function fire(type) { for (const fn of listeners['win:' + type] || []) fn({ type }); await settle(); }
  function stop() { for (const t of timers) clearTimeout(t); for (const t of intervals) clearInterval(t); timers.clear(); intervals.clear(); }

  return {
    gh, mock: mod, calls, toasts, ui, ctx, id, file, edit, save, scan, settle, choose, stop, waitFor, fire,
    storage: k => JSON.parse(ctx.localStorage.getItem(k) || 'null'),
    open: fid => { current = fid; },
    conflictDialog: () => overlays.find(o => o.isConnected && o.className.includes('conflict')) || null,
    /* State of a repo in the fake GitHub: { head, versions, history, content } */
    repo: (repo, p) => mod.inspect(new URL('http://x/?' + new URLSearchParams({ repo, ...(p ? { path: p } : {}) }))),
    /* Someone else (jonas) changes or deletes the file on GitHub */
    touch: (repo, p, text) => mod.touch(new URL('http://x/?' + new URLSearchParams({ repo, path: p, ...(text ? { text } : {}) }))),
    removeRemote: (repo, p) => mod.removeFile(new URL('http://x/?' + new URLSearchParams({ repo, path: p }))),
    offline: on => { mod.state.offline = on; },
  };
}
