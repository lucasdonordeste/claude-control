const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseNumstat, changedFiles, isRepo, relFor } = require('../src/gitdiff');

test('parseNumstat: a normal edit', () => {
  assert.deepEqual(parseNumstat('42\t7\tsrc/a.ts\n'), [
    { path: 'src/a.ts', added: 42, removed: 7, binary: false, untracked: false },
  ]);
});

test('parseNumstat: binary files report no counts, not zero changes', () => {
  // git prints "-" for both columns; reporting +0 −0 would read as "untouched".
  const [r] = parseNumstat('-\t-\tmedia/logo.png\n');
  assert.equal(r.binary, true);
  assert.equal(r.path, 'media/logo.png');
});

test('parseNumstat: a rename yields the path we can actually open', () => {
  const [r] = parseNumstat('3\t0\told.ts => new.ts\n');
  assert.equal(r.path, 'new.ts');
});

test('parseNumstat: junk is skipped rather than throwing', () => {
  assert.deepEqual(parseNumstat(''), []);
  assert.deepEqual(parseNumstat(null), []);
  assert.deepEqual(parseNumstat('garbage\nalso garbage\n'), []);
  // A path containing a tab survives, because we re-join everything after col 2.
  const [r] = parseNumstat('1\t1\tweird\tname.ts\n');
  assert.equal(r.path, 'weird\tname.ts');
});

test('relFor: a path outside the repo is refused', () => {
  assert.equal(relFor('/repo', '/repo/src/a.ts'), 'src/a.ts');
  assert.equal(relFor('/repo', '/etc/passwd'), null);
});

// --- against a real repository ------------------------------------------------

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgit-'));
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run('init', '-q');
  run('config', 'user.email', 't@t.t');
  run('config', 'user.name', 'T');
  run('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'tracked.ts'), 'one\ntwo\nthree\n');
  run('add', '-A');
  run('commit', '-qm', 'init');
  return { dir, run };
}

test('changedFiles: null outside a repository, so the caller can fall back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnogit-'));
  assert.equal(isRepo(dir), false);
  assert.equal(changedFiles(dir, [path.join(dir, 'x.ts')]), null);
});

test('changedFiles: counts an edit to a tracked file', () => {
  const { dir } = tmpRepo();
  const f = path.join(dir, 'tracked.ts');
  fs.writeFileSync(f, 'one\ntwo\nthree\nfour\n');
  const [r] = changedFiles(dir, [f]);
  assert.equal(r.path, 'tracked.ts');
  assert.equal(r.added, 1);
  assert.equal(r.removed, 0);
  assert.equal(r.untracked, false);
});

test('changedFiles: a file the session CREATED is reported, not missed', () => {
  // The whole point: an untracked file is invisible to `git diff HEAD`, and a
  // file the agent created is the most common thing you want to review.
  const { dir } = tmpRepo();
  const f = path.join(dir, 'created.ts');
  fs.writeFileSync(f, 'a\nb\nc\n');
  const [r] = changedFiles(dir, [f]);
  assert.equal(r.path, 'created.ts');
  assert.equal(r.untracked, true);
  assert.equal(r.added, 3);
});

test('changedFiles: a created file without a trailing newline still counts its last line', () => {
  const { dir } = tmpRepo();
  const f = path.join(dir, 'noeol.ts');
  fs.writeFileSync(f, 'a\nb');
  assert.equal(changedFiles(dir, [f])[0].added, 2);
});

test('changedFiles: untouched files are left out, committed work disappears', () => {
  const { dir, run } = tmpRepo();
  const f = path.join(dir, 'tracked.ts');
  // Nothing changed yet.
  assert.deepEqual(changedFiles(dir, [f]), []);
  // Change it, then commit it: the session's work is real but no longer pending.
  fs.writeFileSync(f, 'one\ntwo\nthree\nfour\n');
  assert.equal(changedFiles(dir, [f]).length, 1);
  run('add', '-A');
  run('commit', '-qm', 'work');
  assert.deepEqual(changedFiles(dir, [f]), []);
});

test('changedFiles: an ignored file is not reported as created', () => {
  // .gitignore'd build output is not something you reviewed and forgot.
  const { dir, run } = tmpRepo();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'out/\n');
  run('add', '-A');
  run('commit', '-qm', 'ignore');
  fs.mkdirSync(path.join(dir, 'out'));
  const f = path.join(dir, 'out', 'bundle.js');
  fs.writeFileSync(f, 'x\n');
  assert.deepEqual(changedFiles(dir, [f]), []);
});

test('changedFiles: a created binary file is flagged, not counted', () => {
  const { dir } = tmpRepo();
  const f = path.join(dir, 'blob.bin');
  fs.writeFileSync(f, Buffer.from([1, 2, 0, 3, 4]));
  const [r] = changedFiles(dir, [f]);
  assert.equal(r.binary, true);
  assert.equal(r.added, 0);
});

test('changedFiles: a path outside the repo is dropped, not queried', () => {
  const { dir } = tmpRepo();
  assert.deepEqual(changedFiles(dir, ['/etc/passwd']), []);
});
