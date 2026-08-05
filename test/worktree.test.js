const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseWorktrees,
  contestedDirs,
  worktreeOf,
  listWorktrees,
  checkoutDirs,
  scopeRoots,
  realDir,
} = require('../src/worktree');

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

test('checkoutDirs: every checkout, and never the bare repository', () => {
  const list = parseWorktrees(
    'worktree /repo.git\nbare\n\n' + 'worktree /wt/a\nHEAD abc\ndetached\n\n' + 'worktree /wt/b\nHEAD def\n'
  );
  assert.deepEqual(checkoutDirs(list), ['/wt/a', '/wt/b']);
  assert.deepEqual(checkoutDirs(null), []);
});

// The bug this exists for: with "only the open project" on, a session running in
// a worktree of the very project you have open was filtered out as somebody
// else's, because the scope compared directory paths and a worktree is by
// definition a different directory.
test('scopeRoots: a worktree of the open project is in the open project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccscope-'));
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  run(dir, 'init', '-q');
  run(dir, 'config', 'user.email', 't@t.t');
  run(dir, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  run(dir, 'add', '-A');
  run(dir, 'commit', '-qm', 'init');
  const wt = path.join(dir, '..', path.basename(dir) + '-feat');
  run(dir, 'worktree', 'add', '-q', '-b', 'feat', wt);

  // `now` is passed so each call is a cache miss: two readings of the same
  // repository seconds apart must not be answered from a stale entry.
  const scope = scopeRoots([dir], 1);
  const dirs = new Set(scope.map(realDir));
  assert.ok(dirs.has(realDir(dir)), 'the folder you opened');
  assert.ok(dirs.has(realDir(wt)), 'and its worktree');
  // Workspace folders first, so position still ranks the open folder highest.
  assert.equal(realDir(scope[0]), realDir(dir));

  // An unrelated repository stays out of it.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ccother-'));
  run(other, 'init', '-q');
  assert.equal(new Set(scopeRoots([dir], 2).map(realDir)).has(realDir(other)), false);

  fs.rmSync(wt, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test('scopeRoots: no folders, no git, no duplicates', () => {
  assert.deepEqual(scopeRoots([], 3), []);
  assert.deepEqual(scopeRoots(null, 3), []);
  // A directory that is not a repository contributes only itself.
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ccplain-'));
  assert.deepEqual(scopeRoots([plain, plain], 4), [plain]);
  fs.rmSync(plain, { recursive: true, force: true });
});

test('worktreeOf: null outside a repository, and listing is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccnowt-'));
  assert.equal(worktreeOf(dir), null);
  assert.deepEqual(listWorktrees(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
