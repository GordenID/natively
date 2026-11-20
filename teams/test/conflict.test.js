// Conflict detection in client/github.js: natively never overwrites someone else's change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './harness.js';

const REPO = 'northwind/handbook', PATH = 'processes/leave.md';

async function setup(t) {
  const app = await start();
  t.after(app.stop);
  await app.scan();
  const id = app.id(REPO, PATH);
  app.open(id);
  return { app, id };
}
const backups = app => app.storage('natively:gh:backup') || [];

test('someone else changed the file: nothing is overwritten, the draft is kept, a warning names them', async t => {
  const { app, id } = await setup(t);
  app.touch(REPO, PATH, 'Jonas added this.');
  const before = app.repo(REPO, PATH);
  app.edit(id, 'my version\n');
  await app.save();
  const after = app.repo(REPO, PATH);
  assert.equal(after.versions, before.versions, 'no new version');
  assert.equal(after.content, before.content, "jonas' text untouched");
  const d = app.gh.dirty[id];
  assert.equal(d.conflict, true);
  assert.equal(d.state, 'conflict');
  assert.equal(d.draft, 'my version\n', 'own text kept');
  const ov = app.conflictDialog();
  assert.ok(ov, 'conflict dialog shown');
  assert.match(ov.innerHTML, /jonas changed “leave\.md”/);
  assert.match(ov.innerHTML, /data-d="load"/);
  assert.match(ov.innerHTML, /data-d="mine"/);
  assert.ok(!app.calls.some(c => c.method === 'PUT'), 'the save was stopped before writing');
});

test('a conflict also stops the session shortcut (replace own version) from overwriting', async t => {
  const { app, id } = await setup(t);
  app.edit(id, 'mine 1\n');
  await app.save();
  app.touch(REPO, PATH, 'Jonas added this.');   // same file, client has not synced
  app.edit(id, 'mine 2\n');
  await app.save();
  assert.match(app.repo(REPO, PATH).content, /Jonas added this\./);
  assert.equal(app.repo(REPO).history[0].by, 'jonas');
  assert.equal(app.gh.dirty[id].conflict, true);
});

test('while in conflict, further saves do nothing until the person decides', async t => {
  const { app, id } = await setup(t);
  app.touch(REPO, PATH);
  app.edit(id, 'mine\n');
  await app.save();
  const v = app.repo(REPO).versions, n = app.calls.length;
  app.edit(id, 'mine, more\n');
  await app.save();
  await app.fire('online');
  assert.equal(app.repo(REPO).versions, v);
  assert.equal(app.calls.filter((c, i) => i >= n && c.method !== 'GET').length, 0, 'no write requests');
});

test('"Load new version": shows their text, keeps mine as a backup, writes nothing', async t => {
  const { app, id } = await setup(t);
  app.touch(REPO, PATH, 'Jonas added this.');
  const theirs = app.repo(REPO, PATH);
  app.edit(id, 'my version\n');
  await app.save();
  await app.choose('load');
  assert.equal(app.file(id).content, theirs.content);
  assert.equal(app.gh.dirty[id], undefined);
  assert.equal(backups(app)[0].text, 'my version\n');
  assert.equal(backups(app)[0].id, id);
  assert.equal(app.repo(REPO).versions, theirs.versions);
  // Editing again now builds on their version without a conflict
  app.edit(id, theirs.content + 'And mine on top.\n');
  await app.save();
  assert.equal(app.repo(REPO, PATH).content, theirs.content + 'And mine on top.\n');
  assert.deepEqual(app.repo(REPO).history.slice(0, 2).map(x => x.by), ['mia', 'jonas']);
});

test('"Keep mine": saves my text as a new version on top, their version stays in the history', async t => {
  const { app, id } = await setup(t);
  app.touch(REPO, PATH, 'Jonas added this.');
  const theirs = app.repo(REPO, PATH);
  app.edit(id, 'my version\n');
  await app.save();
  await app.choose('mine');
  const after = app.repo(REPO, PATH);
  assert.equal(after.content, 'my version\n');
  assert.equal(after.versions, theirs.versions + 1);
  assert.deepEqual(after.history.slice(0, 2).map(x => x.by), ['mia', 'jonas']);
  assert.equal(app.gh.dirty[id], undefined);
});

test('"Keep mine" is still safe if a third change arrives meanwhile', async t => {
  const { app, id } = await setup(t);
  app.touch(REPO, PATH, 'Jonas 1.');
  app.edit(id, 'my version\n');
  await app.save();
  app.touch(REPO, PATH, 'Jonas 2.');            // arrives while the dialog is open
  await app.choose('mine');
  assert.match(app.repo(REPO, PATH).content, /Jonas 2\./, 'not overwritten');
  assert.equal(app.gh.dirty[id].conflict, true, 'asks again');
  assert.equal(app.gh.dirty[id].draft, 'my version\n');
});

test('the file was deleted meanwhile: no silent re-create, the person can restore it or drop the draft', async t => {
  const { app, id } = await setup(t);
  app.removeRemote(REPO, PATH);
  app.edit(id, 'my version\n');
  await app.save();
  assert.equal(app.repo(REPO, PATH).content, undefined, 'still deleted');
  assert.equal(app.gh.dirty[id].conflict, true);
  const ov = app.conflictDialog();
  assert.match(ov.innerHTML, /data-d="recreate"/);
  assert.match(ov.innerHTML, /data-d="drop"/);
  await app.choose('recreate');
  assert.equal(app.repo(REPO, PATH).content, 'my version\n');
  assert.equal(app.gh.dirty[id], undefined);
});

test('the file was deleted meanwhile: "Discard mine" removes it and keeps a backup', async t => {
  const { app, id } = await setup(t);
  app.removeRemote(REPO, PATH);
  const v = app.repo(REPO).versions;
  app.edit(id, 'my version\n');
  await app.save();
  await app.choose('drop');
  assert.equal(app.file(id), undefined, 'gone from the tree');
  assert.equal(app.gh.dirty[id], undefined);
  assert.equal(backups(app)[0].text, 'my version\n');
  assert.equal(app.repo(REPO).versions, v);
});

test('sync: a change by someone else to an unsaved file is flagged as conflict before any save', async t => {
  const { app, id } = await setup(t);
  app.edit(id, 'typing …\n');                     // not saved yet
  app.touch(REPO, PATH, 'Jonas added this.');
  await app.gh.poll();
  await app.settle();
  assert.equal(app.gh.dirty[id].conflict, true);
  assert.ok(app.conflictDialog());
  await app.save();
  assert.match(app.repo(REPO, PATH).content, /Jonas added this\./);
});

test('sync: a change by someone else to a file I am not editing just shows up, with a note', async t => {
  const { app, id } = await setup(t);
  app.touch(REPO, PATH, 'Jonas added this.');
  await app.gh.poll();
  await app.settle();
  assert.match(app.file(id).content, /Jonas added this\./);
  assert.equal(app.gh.dirty[id], undefined);
  assert.ok(app.toasts.some(m => /leave\.md/.test(m) && /jonas/.test(m)), 'toast names file and person');
  assert.equal(app.conflictDialog(), null);
});

test('sync: if the new remote text equals my draft, there is no conflict', async t => {
  const { app, id } = await setup(t);
  const same = app.file(id).content + '\nGeändert von jonas.\n';
  app.edit(id, same);
  app.touch(REPO, PATH);                           // jonas makes the very same change
  await app.gh.poll();
  await app.settle();
  assert.equal(app.gh.dirty[id], undefined);
  assert.equal(app.conflictDialog(), null);
});

test('a draft from a closed tab that is based on an old version is not saved over the new one', async t => {
  const probe = await start();
  await probe.scan();
  const id = probe.id(REPO, PATH), oldSha = probe.file(id).sha;
  probe.stop();
  const app = await start({ storage: { 'natively:gh:drafts': JSON.stringify({ [id + '#deadtab']: { id, draft: 'old draft\n', sha: oldSha, ts: Date.now(), owner: 'mia' } }) } });
  t.after(app.stop);
  app.touch(REPO, PATH, 'Jonas added this.');     // the file moved on after the tab closed
  await app.scan();
  assert.equal(app.gh.dirty[id].conflict, true);
  assert.equal(app.gh.dirty[id].draft, 'old draft\n');
  await new Promise(r => setTimeout(r, 700));      // longer than the restore save delay
  await app.settle();
  assert.match(app.repo(REPO, PATH).content, /Jonas added this\./);
});
