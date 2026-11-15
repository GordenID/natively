// natively Teams · lokaler Server zum Ausprobieren: liefert die Oberfläche aus ../ui plus client/github.js,
// die Anmelde-Funktion (lib/auth.js, später auf Vercel) und die einmalige Einrichtung der GitHub App (/setup).
//   node server.js          echte Daten von GitHub (nach /setup)
//   node server.js --mock   Testdaten, ohne GitHub-Konto
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as auth from './lib/auth.js';
import * as mcp from './lib/mcp.js';
import { mock, touch, inspect, removeFile, state as mockState } from './lib/mock.js';
import { buildPage } from './lib/page.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(here, '../ui');
const CLIENT = path.join(here, 'client');
const APP_FILE = path.join(here, 'app.local.json');   // Zugangsdaten der GitHub App, nie ins Git
const MOCK = process.argv.includes('--mock');
const PORT = Number(process.env.PORT) || (MOCK ? 4881 : 4880);
const BASE = `http://localhost:${PORT}`;
if (MOCK) { process.env.NATIVELY_GH_API = BASE + '/mock/api'; process.env.NATIVELY_MCP_MOCK = '1'; }   // Claude-Connector gegen die Testdaten
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

function loadApp() {
  try {
    const a = JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
    process.env.GITHUB_CLIENT_ID = a.client_id; process.env.GITHUB_CLIENT_SECRET = a.client_secret; process.env.GITHUB_APP_SLUG = a.slug;
    return a;
  } catch { return null; }
}
loadApp();

function page() {
  const pre = MOCK ? `<script>window.NATIVELY_API='/mock/api';if(!localStorage.getItem('natively:gh'))localStorage.setItem('natively:gh',JSON.stringify({token:'mock'}));
(function(){var q=new URLSearchParams(location.search),shot=q.get('shot');if(!shot)return;localStorage.setItem('natively:gh:welcomed','1');
localStorage.setItem('natively:gh:prefs',JSON.stringify({lang:q.get('lang')||'en',tabs:[{file:null,dir:null,preview:false}],activeTab:0,recent:['gh-northwind/handbook|onboarding/first-week.md','gh-northwind/marketing|campaigns/autumn.md','gh-northwind/handbook|processes/leave.md']}));
addEventListener('load',function(){setTimeout(function(){if(shot==='admin')nativelyGitHub.openAdmin('org:northwind');if(shot==='timeline'||shot==='table'){localStorage.setItem('natively:gh:tl',JSON.stringify({layout:shot==='table'?'table':'timeline'}));natively.openView('verlauf');setTimeout(function(){var it=[].slice.call(document.querySelectorAll('.tl-item')).filter(function(x){return /handbook/.test(x.innerText)})[1];if(shot==='timeline'&&it)it.click();if(shot==='table'){var b=document.querySelector('[data-tl-layout=table]');if(b)b.click();}},1500);}if(shot==='search'){natively.openFile('gh-northwind/handbook|onboarding/first-week.md',{pin:true});setTimeout(function(){openSearch('leave');},300);}
if(shot==='edit'){natively.openFile('gh-northwind/handbook|onboarding/first-week.md',{pin:true});setTimeout(function(){
var p=document.querySelector('#article p[data-l]');p.click();var ta=document.querySelector('.gh-blockedit');ta.value=ta.value.replace('first five days','first five days, from laptop to first task');
document.querySelector('.docmeta').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));setTimeout(function(){var ul=document.querySelector('#article ul[data-l]');ul.click();var t2=document.querySelector('.gh-blockedit');t2.value=t2.value+'\\n- Coffee with your buddy';t2.dispatchEvent(new Event('input'));},300);},500);}},1200);});})();</script>\n` : '';
  return buildPage(UI, pre);
}
function file(res, abs) {
  fs.readFile(abs, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', TYPES[path.extname(abs)] || 'application/octet-stream');
    res.setHeader('cache-control', 'no-store');
    res.end(buf);
  });
}
async function body(req) { let raw = ''; for await (const c of req) raw += c; try { return JSON.parse(raw || '{}'); } catch { return {}; } }

/* Einrichtung: GitHub App über ein „Manifest“ anlegen. Man klickt bei GitHub nur auf „Create“. */
function setupPage(res) {
  const manifest = {
    name: 'natively-' + crypto.randomBytes(2).toString('hex'),
    url: BASE, description: 'natively: Markdown-Wissen deines Teams aus GitHub lesen, suchen und bearbeiten.',
    redirect_url: BASE + '/setup/done', callback_urls: [BASE + '/api/auth/callback'], setup_url: BASE + '/', setup_on_update: true,
    public: true, request_oauth_on_install: false,
    default_permissions: { contents: 'write', metadata: 'read', administration: 'write', members: 'read' }
  };
  const has = loadApp();
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>natively einrichten</title>
<style>body{font:15px/1.6 -apple-system,system-ui,sans-serif;background:#1f1f1e;color:#e9e8e4;max-width:560px;margin:12vh auto;padding:0 16px}button{font:inherit;background:#e9e8e4;color:#1f1f1e;border:0;border-radius:8px;padding:8px 14px;cursor:pointer}code{background:#2a2a29;padding:2px 5px;border-radius:5px}a{color:#6fa8f3}</style>
<h1>natively · GitHub App einrichten</h1>
${has ? `<p>Schon eingerichtet: <code>${has.slug}</code>. <a href="https://github.com/apps/${has.slug}/installations/new">In einem Konto installieren</a> · <a href="/">Zu natively</a></p><hr>` : ''}
<p>Ein Klick legt bei GitHub die App „natively“ an. Auf der nächsten Seite bei GitHub nur auf <b>„Create GitHub App“</b> klicken. Danach wählst du, in welchem Konto und für welche Repos natively installiert wird.</p>
<form method="post" action="https://github.com/settings/apps/new?state=natively"><input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, '&#39;')}'><button>GitHub App anlegen</button></form>`);
}
async function setupDone(res, u) {
  const code = u.searchParams.get('code');
  const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json' } });
  const j = await r.json();
  if (!j.client_id) { res.statusCode = 500; return res.end('Einrichtung fehlgeschlagen: ' + (j.message || r.status)); }
  fs.writeFileSync(APP_FILE, JSON.stringify({ id: j.id, slug: j.slug, client_id: j.client_id, client_secret: j.client_secret, pem: j.pem, webhook_secret: j.webhook_secret, html_url: j.html_url }, null, 2), { mode: 0o600 });
  loadApp();
  console.log('GitHub App angelegt:', j.slug);
  res.statusCode = 302; res.setHeader('location', `https://github.com/apps/${j.slug}/installations/new`); res.end();
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  const p = u.pathname;
  try {
    if (p === '/' || p === '/index.html') { res.setHeader('content-type', TYPES['.html']); res.setHeader('cache-control', 'no-store'); return res.end(page()); }
    if (p === '/api/auth/login') return auth.login(req, res);
    if (p === '/api/auth/callback') return await (mcp.isMcpCallback(req) ? mcp.mcpCallback(req, res) : auth.callback(req, res));
    if (p === '/api/mcp' || p.startsWith('/api/mcp/') || p.startsWith('/.well-known/oauth-')) return await mcp.handle(req, res);
    if (p === '/api/auth/refresh' && MOCK) { const b = await body(req); res.setHeader('content-type', 'application/json'); if (b.refresh_token === 'good') return res.end(JSON.stringify({ access_token: 'mock', refresh_token: 'good', expires_in: 28800 })); res.statusCode = 401; return res.end('{}'); }
    if (p === '/api/auth/refresh') return await auth.refresh(req, res);
    if (p === '/api/auth/config') return auth.config(req, res);
    if (p === '/setup') return setupPage(res);
    if (p === '/setup/done') return await setupDone(res, u);
    if (MOCK && p.startsWith('/mock/api/')) return await mock(req, res, req.url.slice('/mock/api'.length), req.method === 'GET' ? {} : await body(req));
    if (MOCK && p.startsWith('/mock/ava/')) {   // neutrale Avatare für die Demo-Firma
      const n = path.basename(p, '.svg'), c = { mia: '#d97757', jonas: '#6fa8f3', leo: '#7bbf8a' }[n] || '#9b9a94';
      res.setHeader('content-type', 'image/svg+xml');
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${c}"/><text x="32" y="41" font-family="-apple-system,Helvetica,Arial" font-size="26" font-weight="600" fill="#fff" text-anchor="middle">${n[0].toUpperCase()}</text></svg>`);
    }
    if (MOCK && p === '/mock/touch') { res.end(String(touch(u))); return; }
    if (MOCK && p === '/mock/remove') { res.end(String(removeFile(u))); return; }
    if (MOCK && p === '/mock/inspect') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(inspect(u))); return; }
    if (MOCK && p === '/mock/offline') { mockState.offline = u.searchParams.get('on') === '1'; res.end(String(mockState.offline)); return; }
    const name = path.basename(p);
    if (p === '/favicon.ico' || /^\/icon-\d+\.png$/.test(p)) return file(res, path.resolve(here, '../design/web-icons', name));
    if (p === '/github.js' || p === '/github.css') return file(res, path.join(CLIENT, name));
    if (/^\/[\w.-]+\.(js|css|svg|png)$/.test(p)) return file(res, path.join(UI, name));
    res.statusCode = 404; res.end('not found');
  } catch (e) { console.error(e); res.statusCode = 500; res.end(String(e.message)); }
}).listen(PORT, '127.0.0.1', () => console.log(`natively Teams läuft: ${BASE}${MOCK ? ' (Testdaten)' : ''}`));
