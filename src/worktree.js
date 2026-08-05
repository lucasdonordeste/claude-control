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

const path = require('path');

const GIT_TIMEOUT_MS = 3000;

// Resolve through the real path: /var vs /private/var on macOS would otherwise
// make two names for one directory compare as different places.
function realDir(p) {
  // Empty in, empty out: resolving '' would quietly yield the process's own
  // working directory, and a record with no directory belongs to no project.
  if (!p) return '';
  try {
    return require('fs').realpathSync(p);
  } catch (e) {
    return path.resolve(p); // a directory that is gone still has a name
  }
}

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
  const real = realDir(cwd);
  const idx = list.findIndex((w) => realDir(w.path) === real);
  if (idx === -1) return null;
  return { ...list[idx], linked: idx > 0, total: list.length };
}

// Pure: every checkout in a `git worktree list` reading. A bare repository has
// no working tree, so nothing can be running in it.
function checkoutDirs(list) {
  return (list || []).filter((w) => w && !w.bare && w.path).map((w) => w.path);
}

const _dirsCache = new Map();

function checkoutDirsCached(cwd, now) {
  const t = now || Date.now();
  const hit = _dirsCache.get(cwd);
  if (hit && t - hit.at < CACHE_MS) return hit.data;
  const data = checkoutDirs(listWorktrees(cwd)).map(realDir);
  _dirsCache.set(cwd, { at: t, data });
  if (_dirsCache.size > 64) {
    for (const [k, v] of _dirsCache) if (t - v.at > CACHE_MS) _dirsCache.delete(k);
  }
  return data;
}

// Every directory that counts as "the open project": the workspace folders
// themselves, followed by every other checkout of the same repositories.
//
// A session running in a worktree of the project you have open *is* in that
// project — same repository, another branch — and one session per worktree is
// the whole reason worktrees are used here. Matching the raw path meant the
// scope switch hid exactly those, which is the one case it should not.
//
// Workspace folders come first so the caller can keep using position as rank:
// the folder you opened still sorts ahead of its worktrees.
function scopeRoots(roots, now) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const key = realDir(p);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  for (const r of roots || []) if (r) add(r);
  for (const r of roots || []) {
    if (!r) continue;
    try {
      for (const d of checkoutDirsCached(r, now)) add(d);
    } catch (e) {
      /* a directory git cannot read simply contributes no worktrees */
    }
  }
  return out;
}

module.exports = {
  parseWorktrees,
  listWorktrees,
  contestedDirs,
  worktreeOf,
  worktreeOfCached,
  checkoutDirs,
  scopeRoots,
  realDir,
};
