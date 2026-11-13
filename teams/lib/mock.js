// Nachbau der wenigen GitHub-Schnittstellen, die natively benutzt. Nur zum Testen ohne echtes Konto: node server.js --mock
// Ablauf eines Konflikts testen: POST /mock/touch?repo=northwind/handbook&path=onboarding/first-week.md ändert die Datei „von jemand anderem“.
import crypto from 'node:crypto';

const sha = s => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0${s}`).digest('hex');
const now = () => new Date().toISOString();
const ORG = 'northwind';
const ME = { login: 'mia', id: 1, avatar_url: '/mock/ava/mia.svg?v=1' };
const people = [ME, { login: 'jonas', id: 2, avatar_url: '/mock/ava/jonas.svg?v=1' }, { login: 'leo', id: 3, avatar_url: '/mock/ava/leo.svg?v=1' }];
const P = { pull: { pull: true }, push: { pull: true, push: true }, admin: { pull: true, push: true, admin: true } };

const repos = {
  [ORG + '/handbook']: { perm: 'admin', files: {
    'README.md': '# Handbook\n\nWhat everyone at Northwind needs to know. As of 13 Nov 2026.\n\n- [First week](onboarding/first-week.md)\n- [Requesting leave](processes/leave.md)\n',
    'onboarding/first-week.md': '# First week\n\nEverything new people need in their first five days at Northwind. Owner: Mia. As of 13 Nov 2026.\n\n## Monday\n\n- Pick up your laptop at the front desk\n- Set up your accounts, see [Tools](tools.md)\n- Lunch with the whole team at 12:30\n\n## Your first week at a glance\n\n| Day | Focus | With |\n| --- | --- | --- |\n| Monday | Accounts and tour | Mia |\n| Tuesday | Product deep dive | Jonas |\n| Wednesday | Shadow a customer call | Leo |\n| Thursday | First small task | your team |\n| Friday | Retro and questions | Mia |\n\n## Good to know\n\nHow leave works is in [Requesting leave](../processes/leave.md). Expenses are explained in [Expenses](../processes/expenses.md).\n',
    'onboarding/tools.md': '# Tools\n\nThe tools we use every day.\n\n| Tool | For |\n| --- | --- |\n| natively | Knowledge |\n| Claude | Writing and search |\n',
    'processes/leave.md': '# Requesting leave\n\nLeave is entered two weeks ahead.\n\n| Step | Who |\n| --- | --- |\n| Request | you |\n| Approve | team lead |\n',
    'processes/expenses.md': '# Expenses\n\nReceipts go to finance by the 5th of the month.\n' },
    collab: { mia: 'admin', jonas: 'push', leo: 'pull' }, teams: [{ name: 'Everyone', slug: 'everyone', permission: 'pull' }, { name: 'Marketing', slug: 'marketing', permission: 'push' }] },
  [ORG + '/marketing']: { perm: 'admin', files: {
    'README.md': '# Marketing\n\nCampaigns, copy and design.\n',
    'campaigns/autumn.md': '# Autumn campaign\n\nGoal: **500 new sign-ups** by the end of November.\n',
    'brand/voice.md': '# Brand voice\n\nCalm, clear, friendly.\n' },
    collab: { mia: 'admin', jonas: 'push' }, teams: [{ name: 'Marketing', slug: 'marketing', permission: 'push' }] },
  [ORG + '/legal']: { perm: 'admin', files: {}, collab: { mia: 'admin' }, teams: [] },
  [ORG + '/leadership']: { perm: 'pull', files: { 'README.md': '# Leadership\n\nOnly for the leadership team.\n', 'finance/plan-2027.md': '# Plan 2027\n\nDraft.\n' }, collab: { mia: 'admin' }, teams: [{ name: 'Leadership', slug: 'leadership', permission: 'admin' }] }
};
const invites = {};
const issues = { [ORG + '/handbook']: [{ number: 1, title: '[Zugriff] leo: Edit in marketing', body: '<!-- natively:{"user":"leo","area":"marketing","role":"push","reason":"I take over the newsletter in December."} -->', state: 'open', user: { login: 'leo' }, html_url: '#' }] };
const org = { base: 'none', members: ['mia', 'jonas', 'leo'], invites: [{ id: 99, login: 'sara', email: null }], teams: [{ id: 11, name: 'Everyone', slug: 'everyone', members: ['mia', 'jonas', 'leo'] }, { id: 12, name: 'Marketing', slug: 'marketing', members: ['jonas'] }, { id: 13, name: 'Leadership', slug: 'leadership', members: ['mia'] }] };
let inviteId = 100;
// Git-Modell: Commits mit vollständigem Dateistand, Branch-Head pro Repo, Blobs nach Git-SHA
const shas = {}, trees = {}, commits = {};
const hash = x => crypto.createHash('sha1').update(x).digest('hex');
const treeSha = files => { const t = hash('tree' + JSON.stringify(Object.entries(files).sort())); trees[t] = { ...files }; return t; };
let tick = 0;
function mkCommit(full, files, parents, author, message, date) {
  for (const c of Object.values(files)) shas[sha(c)] = c;
  const t = treeSha(files);
  const c = { sha: hash(full + t + parents.join() + author + message + (tick++)), tree: t, files: { ...files }, parents, author, message, date: new Date(date || Date.now()).toISOString() };
  commits[c.sha] = c;
  return c.sha;
}
for (const [full, r] of Object.entries(repos)) { r.head = mkCommit(full, r.files, [], 'jonas', 'Start', Date.now() - 61 * 86400000); delete r.files; Object.defineProperty(r, 'files', { get() { return commits[r.head].files; } }); }
/* Großer Verlauf zum Testen: viele Änderungen von mehreren Personen und Claude über 60 Tage, die jüngsten heute */
(function seedHistory() {
  let x = 7; const rnd = n => { x = (x * 48271) % 2147483647; return x % n; };
  const lines = ['Updated for the new quarter', 'Clarified who approves', 'Added a short example', 'Fixed a typo', 'Linked the new form', 'Shortened the intro', 'Added the Friday retro', 'Moved the deadline to the 10th', 'Added contact for questions', 'Removed an outdated step'];
  const plan = [[ORG + '/handbook', 150], [ORG + '/marketing', 60], [ORG + '/leadership', 12]];
  for (const [full, n] of plan) {
    const r = repos[full];
    for (let i = 0; i < n; i++) {
      const age = Math.round((n - i) / n * 60 * 86400000 * (0.98 - 0.97 * (i === n - 1 ? 1 : 0)));   // gleichmäßig über 60 Tage
      const when = i >= n - 4 ? Date.now() - (n - i) * 25 * 60000 : Date.now() - age - 3600000;
      const paths = Object.keys(r.files), path = paths[rnd(paths.length)];
      const who = ['mia', 'jonas', 'leo', 'claude'][rnd(4)];
      const L = r.files[path].split('\n'), line = '- ' + lines[rnd(lines.length)] + ' (' + (i + 1) + ')';
      if (L.length > 14 && rnd(2)) L.splice(L.length - 2, 1, line); else L.splice(L.length - 1, 0, line);
      const name = path.split('/').pop();
      const msg = who === 'claude' ? `Update ${name}\n\nCo-Authored-By: Claude <noreply@anthropic.com>` : `${who} hat ${name} bearbeitet (natively)`;
      r.head = mkCommit(full, { ...r.files, [path]: L.join('\n') }, [r.head], who === 'claude' ? 'mia' : who, msg, when);
    }
  }
})();
export const state = { offline: false };
const at = (r, ref) => commits[ref] ? commits[ref] : commits[r.head];

function repoJson(full) {
  const [owner, name] = full.split('/');
  return { full_name: full, name, node_id: 'R_' + full, owner: { login: owner, type: 'Organization' }, private: true, default_branch: 'main', pushed_at: now(),
    html_url: 'https://github.com/' + full, permissions: P[repos[full].perm] };
}
const avatarOf = login => (people.find(p => p.login === login) || {}).avatar_url;
const commitJson = (full, c) => ({ sha: c.sha, html_url: 'https://github.com/' + full + '/commit/' + c.sha, author: { login: c.author, avatar_url: avatarOf(c.author) }, commit: { author: { name: c.author, date: c.date }, message: c.message }, parents: c.parents.map(sha => ({ sha })) });
function patchOf(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n'), out = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { out.push(' ' + A[i]); i++; j++; }
    else if (j < B.length && !A.slice(i).includes(B[j])) out.push('+' + B[j++]);
    else out.push('-' + A[i++]);
  }
  return '@@ -1,' + A.length + ' +1,' + B.length + ' @@\n' + out.join('\n');
}
function changedPaths(c) {
  const before = c.parents[0] ? commits[c.parents[0]].files : {};
  const keys = new Set([...Object.keys(before), ...Object.keys(c.files)]);
  return [...keys].filter(k => before[k] !== c.files[k]);
}

export async function mock(req, res, path, body) {
  const json = (s, v) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(v === undefined ? '' : JSON.stringify(v)); };
  const u = new URL(path, 'http://x');
  const p = decodeURIComponent(u.pathname);
  const m = req.method;
  let x;
  if (state.offline) { res.destroy(); return; }
  if ((req.headers.authorization || '') === 'Bearer expired') return json(401, { message: 'Bad credentials' });
  // Organisation (Admin → Organisation, Zugriffsanfragen)
  const O = org;
  if (p === '/user/memberships/orgs/' + ORG) return json(200, { role: 'admin' });
  if (p === '/orgs/' + ORG) return json(200, { login: ORG, default_repository_permission: O.base });
  if (p === '/orgs/' + ORG + '/members') return json(200, people.filter(pp => O.members.includes(pp.login) && (u.searchParams.get('role') !== 'admin' || pp.login === 'mia')));
  if (p === '/orgs/' + ORG + '/invitations' && m === 'GET') return json(200, O.invites);
  if (p === '/orgs/' + ORG + '/invitations' && m === 'POST') { O.invites.push({ id: inviteId++, login: body.email ? null : 'neu-' + body.invitee_id, email: body.email || null }); return json(201, {}); }
  if ((x = p.match(/^\/orgs\/[^/]+\/invitations\/(\d+)$/))) { O.invites = O.invites.filter(i => i.id !== +x[1]); return json(204); }
  if (p === '/orgs/' + ORG + '/teams') return json(200, O.teams.map(({ members, ...t }) => t));
  if ((x = p.match(/^\/orgs\/[^/]+\/teams\/([^/]+)\/members$/))) return json(200, people.filter(pp => O.teams.find(t => t.slug === x[1]).members.includes(pp.login)));
  if ((x = p.match(/^\/orgs\/[^/]+\/teams\/([^/]+)\/memberships\/([^/]+)$/))) { const t = O.teams.find(tt => tt.slug === x[1]); t.members = t.members.filter(l => l !== x[2]); if (m === 'PUT') t.members.push(x[2]); return json(m === 'PUT' ? 200 : 204, {}); }
  if ((x = p.match(/^\/orgs\/[^/]+\/memberships\/([^/]+)$/)) && m === 'DELETE') { O.members = O.members.filter(l => l !== x[1]); O.teams.forEach(t => t.members = t.members.filter(l => l !== x[1])); return json(204); }
  if (p === '/orgs/' + ORG + '/outside_collaborators') return json(200, []);
  if ((x = p.match(/^\/users\/([^/]+)$/))) return json(200, { login: x[1], id: 4242 });
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/))) {
    const list = (issues[x[1]] ||= []);
    if (m === 'POST') { list.push({ number: list.length + 1, title: body.title, body: body.body, state: 'open', user: { login: ME.login }, html_url: '#' }); return json(201, {}); }
    return json(200, list.filter(i => i.state === 'open'));
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/))) return json(201, {});
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/)) && m === 'PATCH') { const i = (issues[x[1]] || []).find(ii => ii.number === +x[2]); if (i) i.state = body.state; return json(200, {}); }
  if (p === '/user') return json(200, ME);
  if (p === '/user/installations') return json(200, { installations: process.env.MOCK_EMPTY ? [] : [{ id: 1, account: { login: ORG, type: 'Organization' } }] });
  if (p === '/user/installations/1/repositories') return json(200, { total_count: 3, repositories: Object.keys(repos).map(repoJson) });
  if (p === '/graphql') {
    const q = body.query || '';
    if (q.includes('updateRefs')) {
      const full = body.variables.id.slice(2), r = repos[full], up = body.variables.u[0];
      if (!r || r.head !== up.beforeOid || !commits[up.afterOid]) return json(200, { errors: [{ message: 'Ref has moved' }] });
      r.head = up.afterOid; return json(200, { data: { updateRefs: { clientMutationId: null } } });
    }
    const own = q.match(/owner:"([^"]+)",name:"([^"]+)"/), full = own && own[1] + '/' + own[2], out = {};
    for (const mm of q.matchAll(/(f\d+):history\(first:1,path:("(?:[^"\\]|\\.)*")\)/g)) {
      const path = JSON.parse(mm[2]); let c = commits[repos[full].head];
      while (c && !changedPaths(c).includes(path)) c = commits[c.parents[0]];
      if (c) out[mm[1]] = { nodes: [{ committedDate: c.date, author: { name: c.author, user: { login: c.author } } }] };
    }
    return json(200, { data: { repository: { object: out } } });
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/(.+)$/))) {
    const r = repos[x[1]]; if (!r) return json(404, { message: 'Not Found' });
    const etag = `"${r.head}"`;
    res.setHeader('etag', etag);
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
    return json(200, { ref: 'refs/heads/' + x[2], object: { sha: r.head, type: 'commit' } });
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/trees$/)) && m === 'POST') {
    const files = { ...(trees[body.base_tree] || {}) };
    for (const e of body.tree) { if (e.sha === null) delete files[e.path]; else if (e.content != null) { files[e.path] = e.content; shas[sha(e.content)] = e.content; } else files[e.path] = shas[e.sha]; }
    return json(201, { sha: treeSha(files) });
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/trees\/(\w+)$/))) {
    const r = repos[x[1]]; if (!r) return json(404, { message: 'Not Found' });
    const files = commits[x[2]] ? commits[x[2]].files : trees[x[2]] || commits[r.head].files;
    return json(200, { tree: Object.entries(files).map(([path, c]) => ({ path, type: 'blob', sha: sha(c), size: Buffer.byteLength(c) })) });
  }
  if ((x = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/blobs$/)) && m === 'POST') { const c = Buffer.from(body.content, 'base64').toString('utf8'); shas[sha(c)] = c; return json(201, { sha: sha(c) }); }
  if ((x = p.match(/^\/repos\/[^/]+\/[^/]+\/git\/blobs\/(\w+)$/))) return shas[x[1]] != null ? json(200, { content: Buffer.from(shas[x[1]]).toString('base64'), encoding: 'base64' }) : json(404, { message: 'Not Found' });
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/commits$/)) && m === 'POST') {
    const c = mkCommit(x[1], trees[body.tree], body.parents, ME.login, body.message);
    return json(201, { sha: c });
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/commits\/(\w+)$/))) { const c = commits[x[2]]; return c ? json(200, { sha: c.sha, tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })) }) : json(404, { message: 'Not Found' }); }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/))) {
    const r = repos[x[1]]; if (!r) return json(404, { message: 'Not Found' });
    if (m === 'GET') { const c = at(r, u.searchParams.get('ref')).files[x[2]]; return c == null ? json(404, { message: 'Not Found' }) : json(200, { sha: sha(c), content: Buffer.from(c).toString('base64') }); }
    if (m === 'PUT') {
      if (r.perm === 'pull') return json(403, { message: 'Resource not accessible by integration' });
      const cur = r.files[x[2]];
      if (cur != null && body.sha !== sha(cur)) return json(409, { message: `${x[2]} does not match ${body.sha}` });
      const c = Buffer.from(body.content, 'base64').toString('utf8');
      const parent = r.head;
      r.head = mkCommit(x[1], { ...r.files, [x[2]]: c }, [parent], ME.login, body.message);
      return json(200, { content: { sha: sha(c), path: x[2] }, commit: { sha: r.head, parents: [{ sha: parent }], html_url: 'https://github.com/' + x[1] + '/commit/' + r.head } });
    }
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/commits$/))) {
    const r = repos[x[1]]; if (!r) return json(404, { message: 'Not Found' });
    const q = k => u.searchParams.get(k), path = q('path'), n = +(q('per_page') || 30), page = +(q('page') || 1);
    const since = q('since') ? Date.parse(q('since')) : -Infinity, until = q('until') ? Date.parse(q('until')) : Infinity, author = q('author');
    const all = [];
    for (let c = commits[q('sha') && commits[q('sha')] ? q('sha') : r.head]; c; c = commits[c.parents[0]]) {
      const t = Date.parse(c.date);
      if (t < since || t > until || (path && !changedPaths(c).includes(path)) || (author && c.author !== author)) continue;
      all.push(commitJson(x[1], c));
    }
    return json(200, all.slice((page - 1) * n, page * n));
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/commits\/(\w+)$/))) {
    const c = commits[x[2]]; if (!c) return json(404, { message: 'Not Found' });
    const before = c.parents[0] ? commits[c.parents[0]].files : {};
    return json(200, { ...commitJson(x[1], c), files: changedPaths(c).map(filename => {
      const patch = patchOf(before[filename], c.files[filename]);
      return { filename, sha: c.files[filename] == null ? null : sha(c.files[filename]), status: before[filename] == null ? 'added' : c.files[filename] == null ? 'removed' : 'modified', additions: (patch.match(/^\+/gm) || []).length, deletions: (patch.match(/^-/gm) || []).length, patch };
    }) });
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/collaborators$/))) {
    const r = repos[x[1]]; if (r.perm === 'pull') return json(403, { message: 'Must have push access to view repository collaborators.' });
    return json(200, Object.entries(r.collab).map(([login, role]) => ({ ...people.find(pp => pp.login === login), role_name: { pull: 'read', push: 'write', admin: 'admin' }[role], permissions: P[role] })));
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)$/))) {
    const r = repos[x[1]];
    if (m === 'DELETE') { delete r.collab[x[2]]; return json(204); }
    if (m === 'PUT') {
      if (r.collab[x[2]]) { r.collab[x[2]] = body.permission; return json(204); }
      (invites[x[1]] ||= []).push({ id: inviteId++, invitee: { login: x[2] }, permissions: { pull: 'read', push: 'write', admin: 'admin' }[body.permission] });
      return json(201, {});
    }
  }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/invitations$/))) return json(200, invites[x[1]] || []);
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/invitations\/(\d+)$/))) { invites[x[1]] = (invites[x[1]] || []).filter(i => i.id !== +x[2]); return json(204); }
  if ((x = p.match(/^\/repos\/([^/]+\/[^/]+)\/teams$/))) return json(200, repos[x[1]].teams);
  if ((x = p.match(/^\/orgs\/[^/]+\/teams\/([^/]+)\/repos\/([^/]+\/[^/]+)$/))) { const tm = repos[x[2]].teams.find(t => t.slug === x[1]); if (tm) tm.permission = body.permission; return json(204); }
  if ((x = p.match(/^\/orgs\/([^/]+)\/repos$/)) && m === 'POST') {
    const full = x[1] + '/' + body.name;
    const r = repos[full] = { perm: 'admin', collab: { mia: 'admin' }, teams: [] };
    r.head = mkCommit(full, {}, [], ME.login, 'Start'); Object.defineProperty(r, 'files', { get() { return commits[r.head].files; } });
    return json(201, repoJson(full));
  }
  json(404, { message: 'Not Found (mock): ' + m + ' ' + p });
}

export function touch(u) {
  const full = u.searchParams.get('repo'), r = repos[full], path = u.searchParams.get('path');
  if (!r || r.files[path] == null) return false;
  const c = r.files[path] + '\n' + (u.searchParams.get('text') || 'Geändert von jonas.') + '\n';
  r.head = mkCommit(full, { ...r.files, [path]: c }, [r.head], 'jonas', 'jonas hat ' + path.split('/').pop() + ' bearbeitet');
  return true;
}
export function removeFile(u) {
  const full = u.searchParams.get('repo'), r = repos[full], path = u.searchParams.get('path');
  if (!r || r.files[path] == null) return false;
  const files = { ...r.files }; delete files[path];
  r.head = mkCommit(full, files, [r.head], 'jonas', 'jonas hat ' + path.split('/').pop() + ' gelöscht');
  return true;
}
/* Für Tests: Stand eines Repos (Anzahl Versionen, Inhalt einer Datei) */
export function inspect(u) {
  const r = repos[u.searchParams.get('repo')], path = u.searchParams.get('path');
  const list = [];
  for (let c = commits[r.head]; c; c = commits[c.parents[0]]) list.push({ by: c.author, msg: c.message, files: changedPaths(c) });
  return { head: r.head, versions: list.length, history: list.slice(0, 8), content: path ? r.files[path] : undefined };
}
