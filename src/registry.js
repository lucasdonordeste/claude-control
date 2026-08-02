'use strict';

// Claude Code's live session registry.
//
// Every running Claude Code process writes ~/.claude/sessions/<pid>.json and
// keeps it updated while it runs:
//
//   { "pid": 45357, "sessionId": "8a81…", "cwd": "/path/to/project",
//     "startedAt": 1785705277265, "version": "2.1.220", "kind": "interactive",
//     "entrypoint": "cli", "name": "claude-control-35", "status": "busy",
//     "updatedAt": …, "statusUpdatedAt": … }
//
// This is a far better liveness signal than the IDE locks we used before:
// locks only exist for IDE-attached sessions (a session in an external terminal
// is invisible to them) and carry no state. The registry covers every session on
// the machine and tells us what each one is doing right now.
//
// The registry is the source of truth for *which* sessions exist; the transcript
// (src/session.js) remains the source for model/context, and src/agents.js for
// the subagent tree.
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');

const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

// A registry file whose process died but that was never cleaned up. We only
// trust `status` while the process is alive; beyond this age we drop the entry
// entirely even if the pid happens to have been recycled by another process.
const STALE_MS = 24 * 60 * 60 * 1000;

// Sending signal 0 tests for the process without touching it. ESRCH means "no
// such process"; EPERM means it exists but belongs to another user (alive).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

// Pure: normalizes one registry record. Returns null for anything unusable, so a
// half-written or foreign file can never reach the UI. `alive` is injected so
// this stays testable without spawning processes.
function normalizeEntry(raw, alive, now) {
  if (!raw || typeof raw !== 'object') return null;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : '';
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : '';
  if (!sessionId || !cwd) return null;
  const updatedAt = Number(raw.updatedAt) || Number(raw.startedAt) || 0;
  if (updatedAt && now - updatedAt > STALE_MS) return null;
  return {
    pid: Number(raw.pid) || 0,
    sessionId,
    cwd,
    name: typeof raw.name === 'string' ? raw.name : '',
    // `status` is only meaningful while the process is running.
    status: alive ? String(raw.status || 'idle') : 'ended',
    version: typeof raw.version === 'string' ? raw.version : '',
    kind: typeof raw.kind === 'string' ? raw.kind : '',
    entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : '',
    startedAt: Number(raw.startedAt) || 0,
    updatedAt,
    statusUpdatedAt: Number(raw.statusUpdatedAt) || updatedAt,
    alive: !!alive,
  };
}

// Every session the registry knows about, newest activity first. Dead entries
// are included (flagged `alive: false`) so callers can decide — the panel hides
// them, the "clean up" action removes their files.
function listSessions(opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const isAlive = opts.pidAlive || pidAlive;
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch (e) {
    return []; // no registry (very old Claude Code, or nothing has run yet)
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(SESSIONS_DIR, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      continue; // being written right now, or corrupt
    }
    const e = normalizeEntry(raw, isAlive(Number(raw && raw.pid)), now);
    if (e) out.push({ ...e, file: full });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Only the sessions whose process is still running.
function liveSessions(opts) {
  return listSessions(opts).filter((s) => s.alive);
}

// Registry files left behind by processes that are gone. Used by the "clean up"
// action; never removed automatically.
function staleSessionFiles(opts) {
  return listSessions(opts)
    .filter((s) => !s.alive)
    .map((s) => s.file);
}

// Pure: groups sessions by cwd, putting the open workspace roots first (in the
// order VS Code reports them) and everything else after, by recency.
function groupByProject(sessions, roots) {
  const order = new Map();
  (roots || []).forEach((r, i) => order.set(path.resolve(r), i));
  const groups = new Map();
  for (const s of sessions) {
    const key = path.resolve(s.cwd);
    if (!groups.has(key)) {
      groups.set(key, {
        root: s.cwd,
        name: path.basename(s.cwd) || s.cwd,
        isWorkspace: order.has(key),
        rank: order.has(key) ? order.get(key) : Infinity,
        sessions: [],
      });
    }
    groups.get(key).sessions.push(s);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const at = a.sessions[0] ? a.sessions[0].updatedAt : 0;
    const bt = b.sessions[0] ? b.sessions[0].updatedAt : 0;
    return bt - at;
  });
}

module.exports = {
  SESSIONS_DIR,
  pidAlive,
  listSessions,
  liveSessions,
  staleSessionFiles,
  // exported for unit tests
  normalizeEntry,
  groupByProject,
  STALE_MS,
};
