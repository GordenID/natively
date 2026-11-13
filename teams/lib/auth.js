// Anmelden mit GitHub (GitHub App, Nutzer-Zugang). Speichert nichts: Der Zugang geht direkt in den Browser der Person.
// Läuft lokal (teams/server.js) und später unverändert als Vercel-Funktion (teams/api/auth/*.js).
// Braucht: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_APP_SLUG (lokal aus teams/app.local.json).
import crypto from 'node:crypto';

const env = () => ({ id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET, slug: process.env.GITHUB_APP_SLUG });
const origin = req => {
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket && req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
};
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const safeBack = b => (typeof b === 'string' && /^\/[\w\-./]*$/.test(b) && !b.startsWith('//')) ? b : '/';
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ 'cache-control': 'no-store', ...headers })) res.setHeader(k, v);
  res.end(body);
}
const redirect = (res, url, headers = {}) => send(res, 302, '', { location: url, ...headers });
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 10000) break; }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
async function exchange(params) {
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env().id, client_secret: env().secret, ...params })
  });
  return r.json();
}

export function login(req, res) {
  const { id } = env();
  if (!id) return redirect(res, '/?gh_error=' + encodeURIComponent('GitHub App fehlt'));
  const url = new URL(req.url, 'http://x');
  const state = crypto.randomBytes(16).toString('hex');
  const back = safeBack(url.searchParams.get('back'));
  const secure = origin(req).startsWith('https') ? '; Secure' : '';
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', id);
  gh.searchParams.set('redirect_uri', origin(req) + '/api/auth/callback');
  gh.searchParams.set('state', state);
  redirect(res, gh.toString(), { 'set-cookie': `gh_state=${state}.${encodeURIComponent(back)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}` });
}

export async function callback(req, res) {
  const url = new URL(req.url, 'http://x');
  const [state, backRaw] = (cookies(req).gh_state || '').split('.');
  const back = safeBack(decodeURIComponent(backRaw || '/'));
  const clear = { 'set-cookie': 'gh_state=; Path=/; Max-Age=0' };
  if (url.searchParams.get('error')) return redirect(res, back + '?gh_error=' + encodeURIComponent(url.searchParams.get('error_description') || url.searchParams.get('error')), clear);
  const code = url.searchParams.get('code');
  // Ohne state kommt man direkt nach der Installation der App hierher: einfach neu anmelden
  if (!code) return redirect(res, back, clear);
  if (!state || state !== url.searchParams.get('state')) return redirect(res, '/api/auth/login?back=' + encodeURIComponent(back), clear);
  const j = await exchange({ code, redirect_uri: origin(req) + '/api/auth/callback' }).catch(e => ({ error_description: e.message }));
  if (!j.access_token) return redirect(res, back + '?gh_error=' + encodeURIComponent(j.error_description || j.error || 'Anmeldung fehlgeschlagen'), clear);
  const store = JSON.stringify({ token: j.access_token, refresh: j.refresh_token || null, exp: j.expires_in ? Date.now() + j.expires_in * 1000 : 0 }).replace(/</g, '\\u003c');
  // Der Zugang landet nur im Browser (localStorage), nicht auf einem Server
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>natively</title><script>localStorage.setItem('natively:gh', ${JSON.stringify(store)});localStorage.removeItem('natively:gh:blobs');location.replace(${JSON.stringify(back)});</script>`,
    { 'content-type': 'text/html; charset=utf-8', ...clear });
}

export async function refresh(req, res) {
  if (req.method !== 'POST') return send(res, 405, '');
  // Nur Anfragen von der eigenen Seite (Schutz vor Aufrufen fremder Websites)
  const from = req.headers.origin || '';
  if (from && from !== origin(req)) return send(res, 403, '{}', { 'content-type': 'application/json' });
  const { refresh_token } = await readJson(req);
  if (!refresh_token) return send(res, 400, '{}', { 'content-type': 'application/json' });
  const j = await exchange({ grant_type: 'refresh_token', refresh_token }).catch(() => ({}));
  send(res, j.access_token ? 200 : 401, JSON.stringify(j.access_token ? { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in } : {}), { 'content-type': 'application/json' });
}

export function config(req, res) {
  const { id, slug } = env();
  send(res, 200, JSON.stringify({ configured: !!id, installUrl: slug ? `https://github.com/apps/${slug}/installations/new` : null }), { 'content-type': 'application/json' });
}
