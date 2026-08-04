const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseWorktrees, contestedDirs, worktreeOf, listWorktrees } = require('../src/worktree');

test('parseWorktrees: the main worktree on a branch', () => {
  const [w] = parseWorktrees('worktree /repo\nHEAD abc123\nbranch refs/heads/main\n');
  assert.equal(w.path, '/repo');
  assert.equal(w.branch, 'main');
  assert.equal(w.detached, false);
  assert.equal(w.bare, false);
});

test('parseWorktrees: detached and bare are distinguished', () => {
  const list = parseWorktrees(
    'worktree /repo\nbare\n\n' +
      'worktree /wt/a\nHEAD abc\ndetached\n\n' +
      'worktree /wt/b\nHEAD def\nbranch refs/heads/feature/x\n'
  );
  assert.equal(list.length, 3);
  assert.equal(list[0].bare, true);
  assert.equal(list[1].detached, true);
  assert.equal(list[1].branch, '');
  // A slash in the branch name survives the refs/heads/ strip.
  assert.equal(list[2].branch, 'feature/x');
});

test('parseWorktrees: junk yields nothing rather than throwing', () => {
  assert.deepEqual(parseWorktrees(''), []);
  assert.deepEqual(parseWorktrees(null), []);
  // Fields before any `worktree` line have no record to attach to.
  assert.deepEqual(parseWorktrees('branch refs/heads/x\nHEAD abc\n'), []);
});

test('contestedDirs: two live sessions in one directory is the collision', () => {
  const dirs = contestedDirs([
    { cwd: '/a', alive: true },
    { cwd: '/a', alive: true },
    { cwd: '/b', alive: true },
  ]);
  assert.deepEqual([...dirs], ['/a']);
});

test('contestedDirs: a dead session does not contest anything', () => {
  // The directory is only contested while two processes are actually running.
  const dirs = contestedDirs([
    { cwd: '/a', alive: true },
    { cwd: '/a', alive: false },
  ]);
  assert.equal(dirs.size, 0);
});

test('contestedDirs: sessions without a directory are ignored', () => {
  assert.equal(contestedDirs([{ alive: true }, { cwd: '', alive: true }]).size, 0);
  assert.equal(contestedDirs(null).size, 0);
  assert.equal(contestedDirs([]).size, 0);
});

// --- against a real repository ------------------------------------------------

test('worktreeOf: tells the main worktree from a linked one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccwt-'));
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  run(dir, 'init', '-q');
  run(dir, 'config', 'user.email', 't@t.t');
  run(dir, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'init');

  const main = worktreeOf(dir);
  assert.equal(main.linked, false);
  assert.equal(main.total, 1);

  const wt = path.join(dir, '..', path.basename(dir) + '-feat');
  run(dir, 'worktree', 'add', '-q', '-b', 'feat', wt);
  const linked = worktreeOf(wt);
  assert.equal(linked.linked, true, 'a second worktree is linked, not main');
  assert.equal(linked.branch, 'feat');
  assert.equal(linked.total, 2);
  // And the main one now knows it has company.
  assert.equal(worktreeOf(dir).total, 2);

  fs.rmSync(wt, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('worktreeOf: null outside a repository, and listing is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnowt-'));
  assert.equal(worktreeOf(dir), null);
  assert.deepEqual(listWorktrees(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
