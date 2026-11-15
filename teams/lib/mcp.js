// natively-Connector für Claude (MCP über HTTP, „Remote MCP“). Adresse: https://<domain>/api/mcp
// Claude meldet sich mit dem eigenen GitHub-Konto an und sieht nur, was die Person sehen darf.
// Wichtig: Alle Schreib-Werkzeuge speichern immer direkt auf dem Haupt-Branch des Bereichs und nur .md-Dateien.
// Claude kann damit keine Branches oder Pull Requests anlegen, Änderungen sind sofort in natively sichtbar.
//
// Speichert nichts (keine Datenbank): Anmelde-Codes und Zugänge sind mit einem Schlüssel aus GITHUB_CLIENT_SECRET
// verschlüsselt und liegen nur bei Claude. Läuft lokal (server.js) und als Vercel-Funktion (api/mcp.js).
import crypto from 'node:crypto';
import { origin, send, redirect, exchange } from './auth.js';

const API = () => process.env.NATIVELY_GH_API || 'https://api.github.com';
const MOCK = () => process.env.NATIVELY_MCP_MOCK === '1';
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/* ---------- Versiegeln: verschlüsselt und signiert, mit Ablaufzeit ---------- */
function key() {
  const secret = process.env.GITHUB_CLIENT_SECRET || (MOCK() ? 'mock' : '');
  if (!secret) throw new Error('GitHub App fehlt');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'natively', 'mcp-v1', 32));
}
function seal(kind, obj, ttlSec) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(kind));
  const body = Buffer.concat([c.update(JSON.stringify({ ...obj, x: ttlSec ? Date.now() + ttlSec * 1000 : 0 })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}
function unseal(kind, s) {
  try {
    const b = Buffer.from(String(s || ''), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAAD(Buffer.from(kind)); d.setAuthTag(b.subarray(12, 28));
    const o = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return o.x && o.x < Date.now() ? null : o;
  } catch { return null; }
}

/* ---------- Hilfen ---------- */
const json = (res, status, v, h = {}) => send(res, status, v === undefined ? '' : JSON.stringify(v), { 'content-type': 'application/json', ...CORS, ...h });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-expose-headers': 'www-authenticate, mcp-session-id', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS' };
async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!raw && req.readable !== false) for await (const c of req) { raw += c; if (raw.length > 2_000_000) break; }
  if (/x-www-form-urlencoded/.test(req.headers['content-type'] || '')) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}
const b64url = buf => Buffer.from(buf).toString('base64url');
// Nur Claude (claude.ai / claude.com) und Programme auf dem eigenen Rechner (Claude Code, Codex, Cursor) dürfen sich anmelden
function allowedRedirect(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:' && /^(claude\.ai|claude\.com)$/.test(x.hostname)) return true;
    if (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)) return true;
  } catch {}
  return false;
}
const withQuery = (u, q) => { const x = new URL(u); for (const [k, v] of Object.entries(q)) if (v != null) x.searchParams.set(k, v); return x.toString(); };

/* ---------- OAuth: Claude meldet die Person über GitHub an ---------- */
function metadata(req, res, kind) {
  const o = origin(req);
  if (kind === 'prm') return json(res, 200, { resource: o + '/api/mcp', authorization_servers: [o], bearer_methods_supported: ['header'], resource_name: 'natively' });
  json(res, 200, {
    issuer: o, authorization_endpoint: o + '/api/mcp/authorize', token_endpoint: o + '/api/mcp/token', registration_endpoint: o + '/api/mcp/register',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none']
  });
}
async function register(req, res) {
  const b = await body(req) || {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || !uris.every(allowedRedirect)) return json(res, 400, { error: 'invalid_redirect_uri', error_description: 'natively only accepts Claude and local apps.' });
  json(res, 201, {
    client_id: seal('client', { r: uris }), client_id_issued_at: Math.floor(Date.now() / 1000), client_name: String(b.client_name || 'Claude').slice(0, 80),
    redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']
  });
}
function authorize(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const client = unseal('client', q.get('client_id'));
  const r = q.get('redirect_uri') || (client && client.r.length === 1 ? client.r[0] : '');
  if (!client || !client.r.includes(r)) return send(res, 400, 'natively: unknown app or redirect address. Please add the connector again in Claude.', { 'content-type': 'text/plain; charset=utf-8' });
  const fail = (error, d) => redirect(res, withQuery(r, { error, error_description: d, state: q.get('state') }));
  if (q.get('response_type') !== 'code') return fail('unsupported_response_type');
  if (!q.get('code_challenge') || q.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'PKCE S256 required');
  const flow = { r, c: q.get('code_challenge'), s: q.get('state'), k: q.get('client_id') };
  if (MOCK()) return finish(res, flow, { access_token: 'mock' });
  if (!process.env.GITHUB_CLIENT_ID) return fail('server_error', 'GitHub App missing');
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', origin(req) + '/api/auth/callback');   // gleiche Adresse wie die Anmeldung in natively, nichts bei GitHub einzutragen
  gh.searchParams.set('state', 'mcp.' + seal('flow', flow, 600));
  redirect(res, gh.toString());
}
// GitHub kommt über /api/auth/callback zurück; state beginnt dann mit „mcp.“
export const isMcpCallback = req => (new URL(req.url, 'http://x').searchParams.get('state') || '').startsWith('mcp.');
export async function mcpCallback(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const flow = unseal('flow', q.get('state').slice(4));
  if (!flow) return send(res, 400, 'natively: sign-in took too long. Please try again in Claude.', { 'content-type': 'text/plain; charset=utf-8' });
  if (q.get('error')) return redirect(res, withQuery(flow.r, { error: 'access_denied', error_description: q.get('error_description'), state: flow.s }));
  const j = await exchange({ code: q.get('code'), redirect_uri: origin(req) + '/api/auth/callback' }).catch(e => ({ error_description: e.message }));
  if (!j.access_token) return redirect(res, withQuery(flow.r, { error: 'access_denied', error_description: j.error_description || 'GitHub sign-in failed', state: flow.s }));
  finish(res, flow, j);
}
function finish(res, flow, gh) {
  const code = seal('code', { t: gh.access_token, f: gh.refresh_token || null, e: gh.expires_in || 0, r: flow.r, c: flow.c, k: flow.k }, 300);
  redirect(res, withQuery(flow.r, { code, state: flow.s }));
}
function tokens(gh, k) {
  const life = gh.expires_in ? Number(gh.expires_in) : 30 * 86400;
  const out = { access_token: seal('at', { t: gh.access_token }, life), token_type: 'Bearer', expires_in: life };
  if (gh.refresh_token) out.refresh_token = seal('rt', { f: gh.refresh_token, k }, 180 * 86400);
  return out;
}
async function token(req, res) {
  const b = await body(req) || {};
  const bad = d => json(res, 400, { error: 'invalid_grant', error_description: d });
  if (b.grant_type === 'authorization_code') {
    const c = unseal('code', b.code);
    if (!c) return bad('Code expired or invalid');
    if (b.redirect_uri && b.redirect_uri !== c.r) return bad('redirect_uri does not match');
    if (b.client_id && b.client_id !== c.k) return bad('client_id does not match');
    if (!b.code_verifier || b64url(crypto.createHash('sha256').update(String(b.code_verifier)).digest()) !== c.c) return bad('PKCE check failed');
    return json(res, 200, tokens({ access_token: c.t, refresh_token: c.f, expires_in: c.e }, c.k));
  }
  if (b.grant_type === 'refresh_token') {
    const rt = unseal('rt', b.refresh_token);
    if (!rt) return bad('Refresh token expired or invalid');
    if (MOCK()) return json(res, 200, tokens({ access_token: 'mock' }, rt.k));
    const j = await exchange({ grant_type: 'refresh_token', refresh_token: rt.f }).catch(() => ({}));
    if (!j.access_token) return bad('GitHub refused the refresh');
    return json(res, 200, tokens(j, rt.k));
  }
  json(res, 400, { error: 'unsupported_grant_type' });
}

/* ---------- GitHub ---------- */
class ToolError extends Error {}
function github(tok) {
  async function gh(path, opt = {}) {
    const r = await fetch(API() + path, { method: opt.method || 'GET', body: opt.body ? JSON.stringify(opt.body) : undefined, headers: {
      accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'natively', authorization: 'Bearer ' + tok,
      ...(opt.body ? { 'content-type': 'application/json' } : {}) } });
    if (r.status === 401) { const e = new ToolError('GitHub sign-in expired.'); e.auth = true; throw e; }
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch {} const e = new ToolError(j.message || r.statusText); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
  let areas = null;
  async function all() {
    if (areas) return areas;
    const inst = await gh('/user/installations?per_page=100'), list = [];
    for (const i of inst.installations || []) for (let page = 1; page < 30; page++) {
      const j = await gh(`/user/installations/${i.id}/repositories?per_page=100&page=${page}`);
      list.push(...j.repositories); if (j.repositories.length < 100) break;
    }
    const seen = new Set();
    return (areas = list.filter(r => !seen.has(r.full_name) && seen.add(r.full_name)).sort((a, b) => a.full_name.localeCompare(b.full_name)));
  }
  return { gh, all };
}
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const MD = /\.(md|markdown)$/i;
const role = r => !r.permissions ? 'read' : r.permissions.admin ? 'admin' : r.permissions.push || r.permissions.maintain ? 'edit' : 'read';
const canWrite = r => role(r) !== 'read';
const fromB64 = s => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8');
const toB64 = s => Buffer.from(s, 'utf8').toString('base64');

/* ---------- Werkzeuge ---------- */
const prop = description => ({ type: 'string', description });
const tool = (name, title, description, properties, required, readOnly) => ({ name, title, description, inputSchema: { type: 'object', properties, required },
  annotations: { readOnlyHint: !!readOnly, destructiveHint: false, openWorldHint: false } });
const PATH = 'Path like owner/area/folder/file.md (the first two parts are the area).';
const SUMMARY = prop('One short sentence describing the change, shown in the natively history.');
export const TOOLS = [
  tool('areas', 'List areas', 'Lists the natively areas (GitHub repositories) this person can see, with their right: read, edit or admin.', {}, [], true),
  tool('rules', 'Read rules', "Returns the team's rules for knowledge files (regeln.md / rules.md of the areas). Read before creating or reorganizing files.",
    { area: prop('Optional area like owner/area. Empty = all areas.') }, [], true),
  tool('list', 'List files', 'Lists the Markdown files of an area, optionally only inside one folder.',
    { area: prop('Area like owner/area. Empty = all areas.'), folder: prop('Optional folder inside the area, e.g. onboarding') }, [], true),
  tool('search', 'Search', 'Full-text search across the Markdown files. All terms must occur. Returns matching files with their lines.',
    { query: prop('Search terms separated by spaces'), area: prop('Optional area like owner/area'), limit: { type: 'integer', description: 'Maximum number of files (default 15)' } }, ['query'], true),
  tool('read', 'Read file', 'Reads a Markdown file completely. Also returns its version, which "write" needs.', { path: prop(PATH) }, ['path'], true),
  tool('create', 'Create file', 'Creates a new Markdown file and saves it directly as a new version on the main branch. Fails if the file exists. Missing folders are created.',
    { path: prop(PATH), content: prop('Markdown content'), summary: SUMMARY }, ['path', 'content']),
  tool('edit', 'Edit file', 'Replaces one passage in a Markdown file and saves directly on the main branch. The passage must occur exactly once. Preferred way to change files.',
    { path: prop(PATH), old: prop('Current text, exact'), new: prop('New text'), summary: SUMMARY }, ['path', 'old', 'new']),
  tool('write', 'Replace file', 'Replaces the entire content of an existing Markdown file and saves directly on the main branch. Needs the version from "read"; refuses if someone changed the file since.',
    { path: prop(PATH), content: prop('New complete content'), version: prop('Version from "read"'), summary: SUMMARY }, ['path', 'content', 'version'])
];
const INSTRUCTIONS = `natively is this team's knowledge base: Markdown files in GitHub repositories, called areas.
- Use these natively tools for everything in natively, not a generic GitHub connector.
- Saving always happens directly on the area's main branch as a new version, so it shows up in natively right away. Never create branches or pull requests for knowledge files.
- Only Markdown files (.md). Paths look like owner/area/folder/file.md.
- Call "rules" before creating or reorganizing files and follow them. Search first: if a topic exists, extend that file instead of creating a new one.
- To change a file prefer "edit". "write" needs the version from "read".
- If saving reports that someone else changed the file, read it again and redo the change. Never overwrite other people's changes.
- Give every change a short "summary"; it appears in the natively history.
- After creating or changing files, end your answer with a clickable Markdown link to each file, using the "Open in natively" link the tool returned, e.g. [Onboarding](https://…/?open=…). Do not show only the path.`;

function split(p) {
  const parts = String(p || '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 3) throw new ToolError(`"${p}" is not a file path. ${PATH}`);
  if (parts.some(x => x === '..' || x === '.' || x.startsWith('.'))) throw new ToolError('Hidden folders and ".." are not allowed.');
  return { area: parts[0] + '/' + parts[1], file: parts.slice(2).join('/') };
}
async function areaOf(G, name) {
  const a = (await G.all()).find(r => r.full_name.toLowerCase() === String(name).toLowerCase());
  if (!a) throw new ToolError(`Area "${name}" not found or no access. Use "areas" to see all areas.`);
  return a;
}
async function treeOf(G, a) {
  const ref = await G.gh(`/repos/${a.full_name}/git/ref/heads/${encodeURIComponent(a.default_branch)}`);
  const t = await G.gh(`/repos/${a.full_name}/git/trees/${ref.object.sha}?recursive=1`);
  return (t.tree || []).filter(x => x.type === 'blob' && MD.test(x.path) && !x.path.split('/').some(s => s.startsWith('.')));
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i]).catch(() => null); } }));
  return out;
}
async function current(G, a, file) {
  try { const j = await G.gh(`/repos/${a.full_name}/contents/${encPath(file)}?ref=${encodeURIComponent(a.default_branch)}`); return { sha: j.sha, text: fromB64(j.content) }; }
  catch (e) { if (e.status === 404) return null; throw e; }
}
const message = (verb, file, summary) => `${summary ? String(summary).trim().slice(0, 200) : verb + ' ' + file.split('/').pop()}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
async function save(G, a, file, text, sha, summary, verb) {
  if (!canWrite(a)) throw new ToolError(`You may only read in ${a.full_name}. Ask an admin for edit rights.`);
  try {
    // Immer auf den Haupt-Branch des Bereichs: so ist die Änderung sofort in natively sichtbar
    await G.gh(`/repos/${a.full_name}/contents/${encPath(file)}`, { method: 'PUT', body: { message: message(verb, file, summary), content: toB64(text), branch: a.default_branch, ...(sha ? { sha } : {}) } });
  } catch (e) {
    if (e.status === 409 || (e.status === 422 && sha)) throw new ToolError(`Someone else changed ${file} just now. Read it again and redo your change.`);
    if (e.status === 422) throw new ToolError(`${file} already exists. Read it and use "edit" instead.`);
    if (e.status === 403 || e.status === 404) throw new ToolError(`No edit rights in ${a.full_name}.`);
    throw e;
  }
}

async function call(G, name, a, base) {
  const link = (r, file) => `\n\nOpen in natively: ${base}/?open=${[...r.full_name.split('/'), ...file.split('/')].map(encodeURIComponent).join('/')}`;
  const str = k => { const v = a[k]; if (typeof v !== 'string' || !v) throw new ToolError(`Missing parameter "${k}"`); return v; };
  switch (name) {
    case 'areas': {
      const list = await G.all();
      if (!list.length) return 'No areas yet. Install the natively GitHub App for your organisation first.';
      return list.map(r => `- **${r.full_name}** · ${role(r)}`).join('\n');
    }
    case 'rules': {
      const list = a.area ? [await areaOf(G, a.area)] : await G.all(), out = [];
      for (const r of list) for (const f of ['regeln.md', 'rules.md', 'REGELN.md', 'RULES.md']) {
        const c = await current(G, r, f).catch(() => null);
        if (c) { out.push(`## ${r.full_name}/${f}\n\n${c.text}`); break; }
      }
      return out.length ? out.join('\n\n---\n\n') : 'No rules file (regeln.md) in these areas. Keep one topic per file, start with "# Title", link files with relative Markdown links.';
    }
    case 'list': {
      const list = a.area ? [await areaOf(G, a.area)] : await G.all();
      const folder = String(a.folder || '').replace(/^\/+|\/+$/g, ''), out = [];
      for (const r of list) {
        const files = (await treeOf(G, r)).filter(x => !folder || x.path.startsWith(folder + '/'));
        out.push(`## ${r.full_name} (${role(r)})`, ...(files.length ? files.map(x => `- ${r.full_name}/${x.path}`) : ['- (no Markdown files)']), '');
      }
      return out.join('\n').trim();
    }
    case 'search': {
      const terms = str('query').toLowerCase().split(/\s+/).filter(Boolean), limit = Math.min(Number(a.limit) || 15, 50);
      const list = a.area ? [await areaOf(G, a.area)] : await G.all(), hits = [];
      for (const r of list) {
        const files = (await treeOf(G, r)).slice(0, 400);
        const texts = await pool(files, 8, x => G.gh(`/repos/${r.full_name}/git/blobs/${x.sha}`).then(b => fromB64(b.content)));
        files.forEach((x, i) => {
          const t = texts[i]; if (t == null) return;
          const low = (x.path + '\n' + t).toLowerCase();
          if (!terms.every(w => low.includes(w))) return;
          const lines = t.split('\n').map((l, n) => [n + 1, l]).filter(([, l]) => terms.some(w => l.toLowerCase().includes(w))).slice(0, 3);
          hits.push(`- **${r.full_name}/${x.path}**${lines.map(([n, l]) => `\n  ${n}: ${l.trim().slice(0, 160)}`).join('')}`);
        });
        if (hits.length >= limit) break;
      }
      return hits.length ? hits.slice(0, limit).join('\n') : `Nothing found for "${a.query}".`;
    }
    case 'read': {
      const p = split(str('path')), r = await areaOf(G, p.area), c = await current(G, r, p.file);
      if (!c) throw new ToolError(`File not found: ${str('path')}`);
      return `version: ${c.sha}${link(r, p.file)}\n\n${c.text}`;
    }
    case 'create': {
      const p = split(str('path'));
      if (!MD.test(p.file)) throw new ToolError('natively only stores Markdown files (.md).');
      const r = await areaOf(G, p.area);
      if (await current(G, r, p.file)) throw new ToolError(`${str('path')} already exists. Read it and use "edit" instead.`);
      await save(G, r, p.file, str('content'), null, a.summary, 'Create');
      return `Created ${r.full_name}/${p.file} on ${r.default_branch}. It is visible in natively now.${link(r, p.file)}`;
    }
    case 'edit': {
      const p = split(str('path')), r = await areaOf(G, p.area);
      if (!MD.test(p.file)) throw new ToolError('natively only changes Markdown files (.md).');
      const c = await current(G, r, p.file);
      if (!c) throw new ToolError(`File not found: ${str('path')}`);
      const old = str('old'), n = c.text.split(old).length - 1;
      if (n !== 1) throw new ToolError(n ? `The passage occurs ${n} times. Give more surrounding text.` : 'The passage was not found. Read the file again.');
      await save(G, r, p.file, c.text.replace(old, () => String(a.new ?? '')), c.sha, a.summary, 'Update');
      return `Saved ${r.full_name}/${p.file} on ${r.default_branch}. It is visible in natively now.${link(r, p.file)}`;
    }
    case 'write': {
      const p = split(str('path')), r = await areaOf(G, p.area);
      if (!MD.test(p.file)) throw new ToolError('natively only changes Markdown files (.md).');
      const c = await current(G, r, p.file);
      if (!c) throw new ToolError(`File not found: ${str('path')}. Use "create" for new files.`);
      if (c.sha !== str('version')) throw new ToolError(`Someone else changed ${p.file} since you read it. Read it again and redo your change.`);
      await save(G, r, p.file, str('content'), c.sha, a.summary, 'Update');
      return `Saved ${r.full_name}/${p.file} on ${r.default_branch}. It is visible in natively now.${link(r, p.file)}`;
    }
  }
  throw new ToolError(`Unknown tool: ${name}`);
}

/* ---------- MCP über HTTP (zustandslos, Antworten als JSON) ---------- */
function unauthorized(req, res) {
  json(res, 401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${origin(req)}/.well-known/oauth-protected-resource/api/mcp"` });
}
async function rpc(req, res) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const at = unseal('at', auth);
  if (!at) return unauthorized(req, res);
  const m = await body(req);
  if (!m || Array.isArray(m) || typeof m !== 'object') return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  if (m.id === undefined || m.id === null) return send(res, 202, '', CORS);   // Benachrichtigungen
  const reply = result => json(res, 200, { jsonrpc: '2.0', id: m.id, result });
  const fail = (code, message) => json(res, 200, { jsonrpc: '2.0', id: m.id, error: { code, message } });
  const p = m.params || {};
  switch (m.method) {
    case 'initialize': return reply({ protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'natively', title: 'natively', version: '1.0.0', websiteUrl: origin(req), icons: [{ src: origin(req) + '/icon-192.png', mimeType: 'image/png', sizes: ['192x192'] }, { src: origin(req) + '/favicon.svg', mimeType: 'image/svg+xml', sizes: ['any'] }] }, instructions: INSTRUCTIONS });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      try { return reply({ content: [{ type: 'text', text: await call(github(at.t), p.name, p.arguments || {}, origin(req)) }] }); }
      catch (e) {
        if (e.auth) return unauthorized(req, res);
        return reply({ content: [{ type: 'text', text: e instanceof ToolError ? e.message : 'Error: ' + e.message }], isError: true });
      }
    }
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
  }
  fail(-32601, 'Method not found: ' + m.method);
}

/* Ein Einstieg für alles: /api/mcp, /api/mcp/{authorize,token,register} und /.well-known/oauth-* */
export async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  const sub = u.searchParams.get('sub') || (u.pathname.match(/^\/api\/mcp\/(\w+)/) || [])[1] ||
    (u.pathname.startsWith('/.well-known/oauth-protected-resource') ? 'prm' : u.pathname.startsWith('/.well-known/oauth-authorization-server') ? 'asm' : '');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '', CORS);
    if (sub === 'prm' || sub === 'asm') return metadata(req, res, sub);
    if (sub === 'register' && req.method === 'POST') return await register(req, res);
    if (sub === 'authorize') return authorize(req, res);
    if (sub === 'token' && req.method === 'POST') return await token(req, res);
    if (!sub && req.method === 'POST') return await rpc(req, res);
    if (!sub) return json(res, 405, { error: 'Use POST' }, { allow: 'POST' });
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('mcp', e);
    json(res, 500, { error: 'server_error', error_description: e.message });
  }
}
