'use strict';

// Reads the active Claude Code session transcript to surface the model in use
// and how much of the context window it currently occupies. Claude Code stores
// one JSONL transcript per conversation under
//   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// where each assistant turn carries `message.model` and `message.usage`. The
// running context size is the prompt size of the latest turn:
//   input_tokens + cache_read_input_tokens + cache_creation_input_tokens
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');

// Standard window; sessions that exceed it are on the 1M-token context.
const CONTEXT_WINDOW = 200000;
const LARGE_WINDOW = 1000000;
const TAIL_BYTES = 1024 * 1024; // read only the tail of the (possibly large) transcript
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000; // a transcript touched within this counts as "active"
const MAX_SESSIONS = 3; // cap how many sessions we surface at once

// We can't read the window size directly, but a prompt only fits if the window
// is at least that big — so once a session has crossed 200k we know it's 1M.
function pickWindow(maxTokens) {
  return maxTokens > CONTEXT_WINDOW ? LARGE_WINDOW : CONTEXT_WINDOW;
}

// The `[1m]` marker in ~/.claude.json is unreliable (e.g. opus-4-8 is 1M with no
// suffix), so we learn each model's real window from observed usage: once a model
// is seen above 200k it must be 1M, and we remember that for its smaller sessions
// too. Persisted next to the usage history; failures are non-fatal.
const MODEL_WINDOWS_PATH = path.join(CLAUDE_DIR, 'cursor-claude-control', 'model-windows.json');
function readModelWindows() {
  try {
    return JSON.parse(fs.readFileSync(MODEL_WINDOWS_PATH, 'utf8')) || {};
  } catch (e) {
    return {};
  }
}
function recordModelWindow(modelId, observedMax) {
  if (!modelId) return;
  const w = pickWindow(observedMax || 0);
  const cur = readModelWindows();
  if ((cur[modelId] || 0) < w) {
    cur[modelId] = w;
    try {
      fs.mkdirSync(path.dirname(MODEL_WINDOWS_PATH), { recursive: true });
      fs.writeFileSync(MODEL_WINDOWS_PATH, JSON.stringify(cur));
    } catch (e) {
      /* best-effort */
    }
  }
}
// Real window for a model: the largest of this session's own usage and anything
// we've ever learned for that model (never below the 200k standard).
function modelWindow(modelId, observedMax) {
  return Math.max(pickWindow(observedMax || 0), readModelWindows()[modelId] || 0, CONTEXT_WINDOW);
}

// 'claude-opus-4-8' -> 'Opus 4.8'; 'claude-haiku-4-5-20251001' -> 'Haiku 4.5'.
function prettyModel(id) {
  if (!id || typeof id !== 'string') return '';
  const m = id.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2] + '.' + m[3];
  return id.replace(/^claude-/, '');
}

// Prompt tokens of a single turn = how much of the context window it fills.
function contextTokens(usage) {
  if (!usage) return 0;
  return (
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  );
}

// Pure: scan JSONL text from the end. Reports the latest assistant turn's model,
// tier and context tokens, and auto-detects the window from the largest prompt
// seen in the scanned range. Returns { model, modelId, tier, tokens, window } or null.
function latestSessionInfo(text) {
  if (!text) return null;
  const lines = text.split('\n');
  let latest = null;
  let maxTokens = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let o;
    try {
      o = JSON.parse(ln);
    } catch (e) {
      continue; // partial first line from a tail read, or a non-JSON line
    }
    const msg = o && o.message;
    if (o && o.type === 'assistant' && msg && msg.usage) {
      const tok = contextTokens(msg.usage);
      if (tok > maxTokens) maxTokens = tok;
      if (!latest) {
        latest = {
          model: prettyModel(msg.model),
          modelId: msg.model || '',
          tier: msg.usage.service_tier || '',
          tokens: tok,
          slug: o.slug || '',
          branch: o.gitBranch || '',
          sessionId: o.sessionId || '',
        };
      }
    }
  }
  if (!latest) return null;
  const maxSeen = Math.max(maxTokens, latest.tokens);
  return { ...latest, maxSeen, window: pickWindow(maxSeen) };
}

// Claude Code encodes a workspace path into a directory name by replacing every
// non-alphanumeric character with '-' (e.g. /a/b_c -> -a-b-c).
function encodeProjectDir(root) {
  return String(root).replace(/[^a-zA-Z0-9]/g, '-');
}

function readTail(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// How many live Claude Code sessions are connected for these roots. Each IDE-
// connected session keeps a lock at ~/.claude/ide/<port>.lock listing its
// workspaceFolders; the lock disappears when the session closes. This is what
// lets us drop a gauge the moment a session is closed (rather than waiting for
// its transcript to age out). Returns 0 when nothing is connected (e.g. Claude
// Code running in an external terminal) — callers then fall back to mtime.
function liveSessionCount(roots) {
  const dir = path.join(CLAUDE_DIR, 'ide');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.lock'));
  } catch (e) {
    return 0;
  }
  const wanted = new Set((roots || []).map((r) => path.resolve(r)));
  let n = 0;
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if ((j.workspaceFolders || []).some((w) => wanted.has(path.resolve(w)))) n++;
    } catch (e) {
      /* ignore unreadable/locked files */
    }
  }
  return n;
}

// All transcript files across the given workspace roots, with their mtimes.
function listTranscripts(roots) {
  const out = [];
  for (const root of roots || []) {
    const dir = path.join(CLAUDE_DIR, 'projects', encodeProjectDir(root));
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (e) {
      continue; // no transcripts for this root
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(full);
      } catch (e) {
        continue;
      }
      out.push({ file: full, mtime: st.mtimeMs });
    }
  }
  return out;
}

// The recently-active sessions for the roots, newest first, capped at maxN.
// "Active" = a transcript written within windowMs; if none qualify we still
// return the single most recent so the panel isn't empty. Returns
// { sessions: [{ ...info, mtime }], total }.
function recentSessions(roots, opts) {
  opts = opts || {};
  const maxN = opts.maxN || MAX_SESSIONS;
  const windowMs = opts.windowMs || ACTIVE_WINDOW_MS;
  const now = opts.now || Date.now();
  const all = listTranscripts(roots).sort((a, b) => b.mtime - a.mtime);
  const live = typeof opts.live === 'number' ? opts.live : liveSessionCount(roots);
  let picked;
  if (live > 0) {
    // Locks tell us exactly how many sessions are alive — show only those (the
    // most recently active), so a closed session drops as soon as its lock goes.
    picked = all.slice(0, Math.min(maxN, live));
  } else {
    // No locks (e.g. external terminal): best-effort by recency.
    picked = all.filter((x) => now - x.mtime <= windowMs).slice(0, maxN);
    if (!picked.length && all.length) picked = [all[0]]; // fallback to the last known
  }
  const sessions = [];
  for (const p of picked) {
    let info = null;
    try {
      info = latestSessionInfo(readTail(p.file, TAIL_BYTES));
    } catch (e) {
      info = null;
    }
    if (!info) continue;
    recordModelWindow(info.modelId, info.maxSeen); // learn this model's real window
    const window = modelWindow(info.modelId, info.maxSeen); // apply the learned/real window
    sessions.push({ ...info, window, mtime: p.mtime });
  }
  return { sessions, total: all.length };
}

module.exports = {
  prettyModel,
  contextTokens,
  pickWindow,
  latestSessionInfo,
  encodeProjectDir,
  liveSessionCount,
  listTranscripts,
  recentSessions,
  CONTEXT_WINDOW,
  MAX_SESSIONS,
};
