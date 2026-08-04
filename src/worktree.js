'use strict';

// Git worktrees, and the collision they exist to prevent.
//
// Running several sessions at once is the normal way to use Claude Code, and the
// most reported friction is two of them writing to the same checkout: one moves
// a file the other is mid-edit on, or they fight over the branch. A worktree per
// session is the community's answer — a separate directory on its own branch,
// sharing one .git.
//
// This module does two things: report which worktree a session's directory is
// (so the panel can say "detached on feature/x" rather than just a path), and
// name the collision when two live sessions share one directory. It never
// creates or removes anything: Claude Code has its own worktree support, and a
// panel that silently rearranged your checkouts would be a worse product.

const GIT_TIMEOUT_MS = 3000;

function git(cwd, args) {
  try {
    return require('child_process').execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    return null;
  }
}

// Pure: `git worktree list --porcelain` -> one record per worktree.
//
// Records are separated by blank lines and each begins with `worktree <path>`.
// `branch refs/heads/x` is absent when the checkout is detached, and `bare`
// marks a bare repo, which has no working tree to collide over at all.
function parseWorktrees(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9), branch: '', head: '', bare: false, detached: false };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
  }
  return out;
}

function listWorktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  return out == null ? [] : parseWorktrees(out);
}

// Pure: which live sessions are sharing a working directory?
//
// Returns a Set of the directories with more than one live session in them. Dead
// sessions are ignored — a directory is only contested while two processes are
// actually running in it. Keyed by the raw cwd string, which is what the
// registry gives us and what the panel already groups by.
function contestedDirs(sessions) {
  const seen = new Map();
  for (const s of sessions || []) {
    if (!s || !s.cwd || s.alive === false) continue;
    seen.set(s.cwd, (seen.get(s.cwd) || 0) + 1);
  }
  const out = new Set();
  for (const [dir, n] of seen) if (n > 1) out.add(dir);
  return out;
}

// collectLive() runs every few seconds over every session, and this shells out
// to git; without a cache a handful of parallel sessions would mean a process
// per session per tick. Worktrees are created and removed by hand, so half a
// minute of staleness costs nothing.
const CACHE_MS = 30000;
const _wtCache = new Map();

function worktreeOfCached(cwd, now) {
  const t = now || Date.now();
  const hit = _wtCache.get(cwd);
  if (hit && t - hit.at < CACHE_MS) return hit.data;
  const data = worktreeOf(cwd);
  _wtCache.set(cwd, { at: t, data });
  // The map is keyed by directory and directories are few, but a long-lived
  // window that visits many projects should not grow it forever.
  if (_wtCache.size > 64) {
    for (const [k, v] of _wtCache) if (t - v.at > CACHE_MS) _wtCache.delete(k);
  }
  return data;
}

// Is this directory a linked worktree rather than the repository's main one?
// `git worktree list` always reports the main worktree first, so anything else
// is linked. Returns null when the directory is not a repository at all.
function worktreeOf(cwd) {
  const list = listWorktrees(cwd);
  if (!list.length) return null;
  // Resolve through the real path: /var vs /private/var on macOS would otherwise
  // make a worktree look unknown to itself.
  let real = cwd;
  try {
    real = require('fs').realpathSync(cwd);
  } catch (e) {
    /* keep the original */
  }
  const norm = (p) => {
    try {
      return require('fs').realpathSync(p);
    } catch (e) {
      return p;
    }
  };
  const idx = list.findIndex((w) => norm(w.path) === real);
  if (idx === -1) return null;
  return { ...list[idx], linked: idx > 0, total: list.length };
}

module.exports = { parseWorktrees, listWorktrees, contestedDirs, worktreeOf, worktreeOfCached };
