// The fake GitHub itself must refuse unsafe writes, otherwise the other tests would prove nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fresh = () => import('../lib/mock.js?m=' + Math.random());
async function call(m, method, path, body = {}) {
  return new Promise((resolve, reject) => {
    const h = {};
    const res = { statusCode: 200, setHeader: (k, v) => { h[k] = v; }, end: s => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null }), destroy: () => reject(new Error('offline')) };
    m.mock({ method, headers: {} }, res, path, body);
  });
}
const b64 = s => Buffer.from(s).toString('base64');
const FILE = '/repos/northwind/handbook/contents/processes/leave.md';

test('contents PUT with an outdated sha is refused with 409', async () => {
  const m = await fresh();
  const cur = await call(m, 'GET', FILE);
  m.touch(new URL('http://x/?repo=northwind/handbook&path=processes/leave.md'));
  const r = await call(m, 'PUT', FILE, { message: 'x', content: b64('mine'), sha: cur.json.sha, branch: 'main' });
  assert.equal(r.status, 409);
});

test('contents PUT with the current sha writes a new version', async () => {
  const m = await fresh();
  const cur = await call(m, 'GET', FILE);
  const r = await call(m, 'PUT', FILE, { message: 'x', content: b64('mine'), sha: cur.json.sha, branch: 'main' });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from((await call(m, 'GET', FILE)).json.content, 'base64').toString(), 'mine');
});

test('contents PUT in a read-only area is refused with 403', async () => {
  const m = await fresh();
  const r = await call(m, 'PUT', '/repos/northwind/leadership/contents/README.md', { message: 'x', content: b64('x'), sha: 'x' });
  assert.equal(r.status, 403);
});

test('updateRefs only moves the branch from the expected commit', async () => {
  const m = await fresh();
  const head = (await call(m, 'GET', '/repos/northwind/handbook/git/ref/heads/main')).json.object.sha;
  const c = await call(m, 'POST', '/repos/northwind/handbook/git/commits', { message: 'x', tree: (await call(m, 'GET', '/repos/northwind/handbook/git/commits/' + head)).json.tree.sha, parents: [head] });
  const q = 'mutation{updateRefs}';
  const wrong = await call(m, 'POST', '/graphql', { query: q, variables: { id: 'R_northwind/handbook', u: [{ beforeOid: 'deadbeef', afterOid: c.json.sha }] } });
  assert.match(wrong.json.errors[0].message, /moved/);
  const right = await call(m, 'POST', '/graphql', { query: q, variables: { id: 'R_northwind/handbook', u: [{ beforeOid: head, afterOid: c.json.sha }] } });
  assert.equal(right.json.errors, undefined);
});
