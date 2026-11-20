// Saving (autosave) in client/github.js against the fake GitHub in lib/mock.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { start } from './harness.js';

const gitSha = s => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0${s}`).digest('hex');
const REPO = 'northwind/handbook', PATH = 'processes/leave.md';

async function setup(t, opt) {
  const app = await start(opt);
  t.after(app.stop);
  await app.scan();
  const id = app.id(REPO, PATH);
  app.open(id);
  return { app, id };
}

test('saving an edit creates exactly one new version with the new text', async t => {
  const { app, id } = await setup(t);
  const before = app.repo(REPO).versions;
  const text = app.file(id).content + '\nBring your badge.\n';
  app.edit(id, text);
  await app.save();
  const after = app.repo(REPO, PATH);
  assert.equal(after.versions, before + 1);
  assert.equal(after.content, text);
  assert.equal(after.history[0].msg, 'mia edited leave.md (natively)');
  assert.deepEqual(after.history[0].files, [PATH]);
  assert.deepEqual(Object.keys(app.gh.dirty), [], 'nothing left unsaved');
});

test('the file keeps the new GitHub sha, so the next save is not a conflict', async t => {
  const { app, id } = await setup(t);
  app.edit(id, 'one\n');
  await app.save();
  assert.equal(app.file(id).sha, gitSha('one\n'));
  delete app.gh.sessions[id];                 // force the normal path (contents API with sha check)
  app.edit(id, 'two\n');
  await app.save();
  assert.equal(app.repo(REPO, PATH).content, 'two\n');
  assert.deepEqual(Object.keys(app.gh.dirty), []);
});

test('an editing session is one version: saving again soon replaces the own last version', async t => {
  const { app, id } = await setup(t);
  const before = app.repo(REPO).versions;
  app.edit(id, 'first draft\n');
  await app.save();
  const first = app.repo(REPO).head;
  app.edit(id, 'second draft\n');
  await app.save();
  app.edit(id, 'third draft\n');
  await app.save();
  const after = app.repo(REPO, PATH);
  assert.equal(after.versions, before + 1, 'still only one new version');
  assert.equal(after.content, 'third draft\n');
  assert.notEqual(after.head, first, 'the version was replaced, not left as it was');
  assert.ok(app.calls.some(c => c.path === '/graphql' && /updateRefs/.test(c.body.query)), 'replaced atomically via updateRefs');
});

test('after 5 minutes without saving, the next save is a new version', async t => {
  const { app, id } = await setup(t);
  const before = app.repo(REPO).versions;
  app.edit(id, 'morning\n');
  await app.save();
  app.gh.sessions[id].last -= 5 * 60 * 1000 + 1;
  app.edit(id, 'afternoon\n');
  await app.save();
  const after = app.repo(REPO, PATH);
  assert.equal(after.versions, before + 2);
  assert.equal(after.content, 'afternoon\n');
  assert.equal(app.repo(REPO).history[1].msg, 'mia edited leave.md (natively)');
});

test('a session never replaces a version when someone else saved in between (seen by the sync)', async t => {
  const { app, id } = await setup(t);
  app.edit(id, 'mine 1\n');
  await app.save();
  app.touch(REPO, 'processes/expenses.md', 'Jonas was here.');   // other file, same repo
  await app.gh.poll();
  await app.settle();
  app.edit(id, 'mine 2\n');
  await app.save();
  const h = app.repo(REPO).history;
  assert.equal(h[0].by, 'mia');
  assert.deepEqual(h[0].files, [PATH]);
  assert.equal(h[1].by, 'jonas', "jonas' version is kept");
  assert.equal(h[2].by, 'mia', 'own first version is kept too');
  assert.match(app.repo(REPO, 'processes/expenses.md').content, /Jonas was here\./);
  assert.equal(app.repo(REPO, PATH).content, 'mine 2\n');
});

test('a session never replaces a version when someone else saved in between (not yet seen)', async t => {
  const { app, id } = await setup(t);
  app.edit(id, 'mine 1\n');
  await app.save();
  app.touch(REPO, 'processes/expenses.md', 'Jonas was here.');   // no poll: the client does not know yet
  app.edit(id, 'mine 2\n');
  await app.save();
  const h = app.repo(REPO).history;
  assert.deepEqual(h.slice(0, 3).map(x => x.by), ['mia', 'jonas', 'mia']);
  assert.match(app.repo(REPO, 'processes/expenses.md').content, /Jonas was here\./, "jonas' change survives");
  assert.equal(app.repo(REPO, PATH).content, 'mine 2\n');
  assert.deepEqual(Object.keys(app.gh.dirty), []);
});

test('umlauts and emoji are saved byte for byte, and the locally computed sha matches GitHub', async t => {
  const { app, id } = await setup(t);
  const text = '# Urlaub beantragen\n\nGrüße aus Köln, straße – „Anführung“ 🚀\n';
  app.edit(id, text);
  await app.save();
  app.edit(id, text + 'Noch ein Satz für Jörg.\n');
  await app.save();                                   // session path: sha computed in the browser
  assert.equal(app.repo(REPO, PATH).content, text + 'Noch ein Satz für Jörg.\n');
  delete app.gh.sessions[id];
  app.edit(id, text + 'Ende.\n');
  await app.save();                                   // contents API checks our sha: must not be a conflict
  assert.equal(app.repo(REPO, PATH).content, text + 'Ende.\n');
  assert.deepEqual(Object.keys(app.gh.dirty), []);
});

test('offline: the draft stays and nothing is written; back online it saves', async t => {
  const { app, id } = await setup(t);
  const before = app.repo(REPO).versions;
  app.offline(true);
  app.edit(id, 'written on the train\n');
  await app.save();
  const d = app.gh.dirty[id];
  assert.ok(d, 'draft kept');
  assert.equal(d.state, 'retry');
  assert.equal(d.draft, 'written on the train\n');
  assert.equal(app.repo(REPO).versions, before);
  app.offline(false);
  await app.fire('online');
  assert.equal(app.repo(REPO, PATH).content, 'written on the train\n');
  assert.equal(app.repo(REPO).versions, before + 1);
  assert.deepEqual(Object.keys(app.gh.dirty), []);
});

test('a draft left in a closed tab is restored on start and saved', async t => {
  const app = await start();
  t.after(app.stop);
  const id = app.id(REPO, PATH);
  // Learn the current sha of the file, as the closed tab knew it
  const probe = await start();
  await probe.scan();
  const sha = probe.file(id).sha; probe.stop();
  app.ctx.localStorage.setItem('natively:gh:drafts', JSON.stringify({ [id + '#deadtab']: { id, draft: 'from a closed tab\n', sha, ts: Date.now(), owner: 'mia' } }));
  await app.scan();
  assert.ok(app.gh.dirty[id], 'restored as unsaved change');
  await app.waitFor(() => !app.gh.dirty[id]);
  assert.equal(app.repo(REPO, PATH).content, 'from a closed tab\n');
});

test('a draft of another account is left alone', async t => {
  const app = await start();
  t.after(app.stop);
  const id = app.id(REPO, PATH);
  app.ctx.localStorage.setItem('natively:gh:drafts', JSON.stringify({ [id + '#deadtab']: { id, draft: 'not mine\n', sha: 'x', ts: Date.now(), owner: 'jonas' } }));
  await app.scan();
  assert.equal(app.gh.dirty[id], undefined);
  assert.ok(app.storage('natively:gh:drafts')[id + '#deadtab'], 'still stored for its owner');
});
