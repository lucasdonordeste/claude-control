'use strict';

// What a session actually did to the files it touched.
//
// src/session.js knows *which* files a session wrote (it reads the tool calls out
// of the transcript); this turns that list into "+42 −7" per file and feeds the
// native VS Code diff viewer.
//
// The numbers come from git rather than from replaying the transcript's
// old_string/new_string pairs: the diff viewer, per-line revert and rename
// detection all come free, and no intermediate file state has to be rebuilt.
// The trade is that a file you edited yourself shows your changes too, and that
// everything disappears once you commit — both are surfaced in the UI rather
// than hidden.

const fs = require('fs');
const path = require('path');

const GIT_TIMEOUT_MS = 3000;
// A session can touch a lot of files; git handles that fine but the argv does
// not grow without limit. Well beyond any realistic session.
const MAX_PATHS = 400;

// execFile with a constant argv and no shell: a file path from a transcript is
// untrusted input and must never reach a command line. stderr is muted because
// "not a repository" is an expected answer here, not an error to report.
function git(cwd, args) {
  try {
    return require('child_process').execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    return null;
  }
}

function isRepo(cwd) {
  return !!(cwd && git(cwd, ['rev-parse', '--git-dir']));
}

// Pure: `git diff --numstat` output -> one record per file.
//
//   42\t7\tsrc/a.ts          a normal edit
//   -\t-\tlogo.png           binary; git reports no line counts
//   3\t0\told.ts => new.ts   a rename (with -M, which we do not pass, but the
//                            shape is accepted so a configured diff.renames
//                            cannot produce a bogus path)
function parseNumstat(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [a, r] = parts;
    // A rename arrives as "old => new"; the current path is what we can open.
    let p = parts.slice(2).join('\t');
    const arrow = p.indexOf(' => ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    if (!p) continue;
    const binary = a === '-' || r === '-';
    out.push({
      path: p,
      added: binary ? 0 : Number(a) || 0,
      removed: binary ? 0 : Number(r) || 0,
      binary,
      untracked: false,
    });
  }
  return out;
}

// Lines in a file we are about to report as wholly added. Binary detection is
// the cheap, standard one: a NUL byte in the first block.
function countLines(abs) {
  try {
    const buf = fs.readFileSync(abs);
    if (buf.includes(0, 0, Math.min(buf.length, 8000))) return { binary: true, lines: 0 };
    if (!buf.length) return { binary: false, lines: 0 };
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    // A last line without a trailing newline still counts.
    if (buf[buf.length - 1] !== 10) n++;
    return { binary: false, lines: n };
  } catch (e) {
    return null;
  }
}

// Repo-relative, forward-slashed — the form git speaks.
function relFor(cwd, abs) {
  const r = path.relative(cwd, abs);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null; // outside the repo
  return r.split(path.sep).join('/');
}

// The session's files, annotated with what changed in each.
//
// `absPaths` is what session.editedFiles() returned. Returns null when `cwd` is
// not a git repository — the caller falls back to plain "open the file", rather
// than promising a diff it cannot produce.
function changedFiles(cwd, absPaths) {
  if (!isRepo(cwd)) return null;

  const rels = [];
  const byRel = new Map();
  for (const abs of (absPaths || []).slice(0, MAX_PATHS)) {
    const rel = relFor(cwd, abs);
    if (!rel || byRel.has(rel)) continue;
    byRel.set(rel, abs);
    rels.push(rel);
  }
  if (!rels.length) return [];

  const found = new Map();
  // Tracked, uncommitted changes.
  const numstat = git(cwd, ['diff', '--numstat', 'HEAD', '--', ...rels]);
  if (numstat != null) {
    for (const r of parseNumstat(numstat)) found.set(r.path, r);
  }

  // Files the session *created* are untracked, so `git diff HEAD` says nothing
  // about them — and an agent left alone mostly creates files. Without this the
  // feature would be blind to its main case.
  const others = git(cwd, ['ls-files', '--others', '--exclude-standard', '--', ...rels]);
  if (others != null) {
    for (const line of others.split('\n')) {
      const rel = line.trim();
      if (!rel || found.has(rel)) continue;
      const abs = byRel.get(rel) || path.join(cwd, rel);
      const c = countLines(abs);
      if (!c) continue;
      found.set(rel, {
        path: rel,
        added: c.lines,
        removed: 0,
        binary: c.binary,
        untracked: true,
      });
    }
  }

  return rels.filter((r) => found.has(r)).map((r) => ({ ...found.get(r), abs: byRel.get(r) }));
}

// The committed side of the diff. null when the file is untracked (nothing to
// compare against) or unreadable.
function showHead(cwd, rel) {
  return git(cwd, ['show', 'HEAD:' + rel]);
}

module.exports = { parseNumstat, changedFiles, isRepo, showHead, relFor, MAX_PATHS };
