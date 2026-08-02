'use strict';

// Reads Claude Code session transcripts to surface what each session is doing.
//
// Claude Code stores one JSONL transcript per conversation under
//   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// Assistant turns carry `message.model` and `message.usage`; the running context
// size is the prompt size of the latest turn:
//   input_tokens + cache_read_input_tokens + cache_creation_input_tokens
//
// Interleaved with the conversation are single-purpose records that Claude Code
// appends as state changes, and which give us the session's human-readable state
// for free:
//   {"type":"ai-title","aiTitle":"…"}          — the generated session title
//   {"type":"permission-mode","permissionMode":"auto"|"plan"|"manual"|…}
//   {"type":"mode","mode":"normal"|"plan"|…}
//   {"type":"last-prompt","lastPrompt":"…"}    — what the user last asked
//
// Which sessions exist and whether they are running comes from src/registry.js;
// this module answers "what is inside session X".
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');
const registry = require('./registry');

// Standard window; sessions that exceed it are on the 1M-token context.
const CONTEXT_WINDOW = 200000;
const LARGE_WINDOW = 1000000;
// Tail size for a transcript read. Large enough to hold several turns (so the
// pending-question and last-tool scans are reliable), small enough that
// re-reading it every few seconds stays cheap — an *active* session rewrites its
// transcript constantly, so this is the one read the mtime cache below cannot
// save us from. Under-reading only costs window auto-detection accuracy, which
// is persisted per model anyway.
const TAIL_BYTES = 256 * 1024;
const ACTIVE_WINDOW_MS = 6 * 60 * 60 * 1000; // fallback when the registry is unavailable
const MAX_SESSIONS = 8; // cap how many sessions we surface at once

// Tools whose whole purpose is to hand control back to the user. A `tool_use` of
// one of these with no matching `tool_result` means the session is blocked
// waiting for an answer — that is what powers "waiting for you".
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
// How many recent tool calls the expanded card shows.
const RECENT_TOOLS = 6;

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
  const m = id.match(/(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2] + '.' + m[3];
  const single = id.match(/(opus|sonnet|haiku|fable)-(\d+)(?!\d)/i);
  if (single) return single[1][0].toUpperCase() + single[1].slice(1).toLowerCase() + ' ' + single[2];
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

// Pure: turns a tool call into a short "what it's doing right now" descriptor.
// `verb` is an i18n key suffix (activity.<verb>) so the UI stays localized, and
// `target` is the concrete file/command, already shortened for a narrow sidebar.
function toolActivity(name, input) {
  const i = input || {};
  const base = (p) => (typeof p === 'string' ? p.split('/').filter(Boolean).pop() || p : '');
  // Commands and queries are frequently multi-line; the activity line is a
  // single row, so collapse whitespace before truncating or the tail of a
  // heredoc ends up rendered as the "current activity".
  const one = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return { verb: 'editing', target: base(i.file_path) };
    case 'Read':
      return { verb: 'reading', target: base(i.file_path) };
    case 'Bash':
      return { verb: 'running', target: one(i.command, 60) };
    case 'Grep':
      return { verb: 'searching', target: one(i.pattern, 40) };
    case 'Glob':
      return { verb: 'searching', target: one(i.pattern, 40) };
    case 'WebSearch':
      return { verb: 'browsing', target: one(i.query, 40) };
    case 'WebFetch':
      return { verb: 'browsing', target: one(i.url, 50) };
    case 'Agent':
    case 'Task':
      return { verb: 'delegating', target: one(i.description || i.subagent_type, 40) };
    case 'Workflow':
      return { verb: 'orchestrating', target: one(i.name, 40) };
    case 'AskUserQuestion':
    case 'ExitPlanMode':
      return { verb: 'asking', target: '' };
    default:
      if (typeof name === 'string' && name.startsWith('mcp__')) {
        return { verb: 'calling', target: name.split('__').slice(1).join(' · ').slice(0, 40) };
      }
      return { verb: 'working', target: typeof name === 'string' ? name : '' };
  }
}

// Pure: one backward pass over JSONL text, collecting everything the panel needs.
//
// Scanning backwards means the newest record of each kind wins and we can stop
// caring about the rest. It also makes the pending-question check trivial: a
// `tool_result` always follows its `tool_use` in file order, so going backwards
// we have already seen every result by the time we reach the call it answers.
//
// Returns { model, modelId, tier, tokens, window, … } or null when the tail has
// no assistant turn with usage (a brand-new or non-conversation transcript).
function latestSessionInfo(text) {
  if (!text) return null;
  const lines = text.split('\n');
  let latest = null;
  let maxTokens = 0;
  let aiTitle = '';
  let permissionMode = '';
  let mode = '';
  let lastPrompt = '';
  let lastActivityAt = 0;
  let lastTool = null;
  let pendingAsk = null;
  // A short trail of what the session just did. The single latest call answers
  // "what is it doing"; the trail answers "what is it working through", which is
  // the question you actually have when watching a session you are not driving.
  const recentTools = [];
  const answered = new Set(); // tool_use ids that already have a tool_result

  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let o;
    try {
      o = JSON.parse(ln);
    } catch (e) {
      continue; // partial first line from a tail read, or a non-JSON line
    }
    if (!o || typeof o !== 'object') continue;

    const entryAt = o.timestamp ? Date.parse(o.timestamp) || 0 : 0;
    if (!lastActivityAt && entryAt) lastActivityAt = entryAt;

    // Single-purpose state records — newest wins, so only take the first seen.
    if (o.type === 'ai-title' && !aiTitle) {
      aiTitle = String(o.aiTitle || '');
      continue;
    }
    if (o.type === 'permission-mode' && !permissionMode) {
      permissionMode = String(o.permissionMode || '');
      continue;
    }
    if (o.type === 'mode' && !mode) {
      mode = String(o.mode || '');
      continue;
    }
    if (o.type === 'last-prompt' && !lastPrompt) {
      lastPrompt = String(o.lastPrompt || '');
      continue;
    }

    const msg = o.message;
    const content = msg && msg.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_result' && b.tool_use_id) {
          answered.add(b.tool_use_id);
        } else if (b.type === 'tool_use') {
          const call = {
            name: String(b.name || ''),
            ...toolActivity(b.name, b.input),
            running: !answered.has(b.id),
            at: entryAt,
          };
          if (!lastTool) lastTool = call;
          if (recentTools.length < RECENT_TOOLS) recentTools.push(call);
          if (!pendingAsk && ASK_TOOLS.has(b.name) && !answered.has(b.id)) {
            pendingAsk = { tool: String(b.name), question: askQuestionText(b.name, b.input) };
          }
        }
      }
    }

    if (o.type === 'assistant' && msg && msg.usage) {
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
          effort: o.effort || '',
          version: o.version || '',
        };
      }
    }
  }
  if (!latest) return null;
  const maxSeen = Math.max(maxTokens, latest.tokens);
  return {
    ...latest,
    aiTitle,
    permissionMode,
    mode,
    lastPrompt,
    lastActivityAt,
    lastTool,
    recentTools,
    pendingAsk,
    // Every tool call in the scanned tail that already has a result. src/agents.js
    // uses this to tell a finished subagent from a running one: the Agent/Task
    // call that spawned it gets its `tool_result` the moment the subagent returns.
    answeredIds: [...answered],
    maxSeen,
    window: pickWindow(maxSeen),
  };
}

// Pure: best-effort one-line summary of what the session is asking.
function askQuestionText(tool, input) {
  const i = input || {};
  if (tool === 'ExitPlanMode') return '';
  const qs = Array.isArray(i.questions) ? i.questions : [];
  if (qs.length && qs[0] && qs[0].question) {
    return String(qs[0].question) + (qs.length > 1 ? ` (+${qs.length - 1})` : '');
  }
  return '';
}

// Claude Code encodes a workspace path into a directory name by replacing every
// non-alphanumeric character with '-' (e.g. /a/b_c -> -a-b-c).
function encodeProjectDir(root) {
  return String(root).replace(/[^a-zA-Z0-9]/g, '-');
}

function transcriptPath(cwd, sessionId) {
  return path.join(CLAUDE_DIR, 'projects', encodeProjectDir(cwd), sessionId + '.jsonl');
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

// Parsing a transcript tail is the single most expensive thing we do per tick,
// and a transcript only changes when its session writes a turn. Key the parse on
// (mtime, size) so an idle session costs one stat() instead of a 512 KB read and
// a JSON.parse per line.
const _tailCache = new Map(); // file -> { mtimeMs, size, info }
const TAIL_CACHE_MAX = 64;

function readSessionInfo(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch (e) {
    _tailCache.delete(file);
    return null;
  }
  const hit = _tailCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.info;
  let info = null;
  try {
    info = latestSessionInfo(readTail(file, TAIL_BYTES));
  } catch (e) {
    info = null;
  }
  // Bounded LRU-ish: drop the oldest insertion once we exceed the cap.
  if (_tailCache.size >= TAIL_CACHE_MAX) {
    _tailCache.delete(_tailCache.keys().next().value);
  }
  _tailCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

// The session's live to-do list (~/.claude/tasks/<sessionId>/*.json). Each item
// carries a status and an `activeForm` describing what's being done right now.
// Returns { total, done, doing, items } or null. Tiny files — cheap per tick.
function tasksForSession(sessionId) {
  if (!sessionId) return null;
  const dir = path.join(CLAUDE_DIR, 'tasks', sessionId);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return null;
  }
  const items = [];
  for (const f of entries) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try {
      items.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch (e) {
      /* skip unreadable item */
    }
  }
  if (!items.length) return null;
  const done = items.filter((i) => i.status === 'completed').length;
  const active = items.find((i) => i.status === 'in_progress');
  return {
    total: items.length,
    done,
    doing: active ? active.activeForm || active.subject || '' : '',
    items: items.map((i) => ({
      subject: String(i.subject || i.activeForm || ''),
      status: String(i.status || 'pending'),
    })),
  };
}

// All transcript files across the given workspace roots, with their mtimes.
// Only used as the fallback path when the session registry is unavailable.
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
      out.push({ file: full, mtime: st.mtimeMs, cwd: root });
    }
  }
  return out;
}

// Pure: merges a registry entry with what we parsed out of its transcript into
// the single shape the panel and the status bar both consume.
function composeSession(entry, info, tasks, window) {
  const waiting = !!(info && info.pendingAsk);
  return {
    // identity
    sessionId: entry.sessionId,
    pid: entry.pid,
    cwd: entry.cwd,
    project: path.basename(entry.cwd) || entry.cwd,
    name: entry.name,
    kind: entry.kind || '',
    title: (info && info.aiTitle) || entry.name || (info && info.slug) || '',
    slug: (info && info.slug) || '',
    branch: (info && info.branch) || '',
    // state
    alive: entry.alive,
    status: waiting ? 'waiting' : entry.status,
    waiting,
    question: (info && info.pendingAsk && info.pendingAsk.question) || '',
    askTool: (info && info.pendingAsk && info.pendingAsk.tool) || '',
    activity: (info && info.lastTool) || null,
    recent: (info && info.recentTools) || [],
    permissionMode: (info && info.permissionMode) || '',
    mode: (info && info.mode) || '',
    lastPrompt: (info && info.lastPrompt) || '',
    // model / context
    model: (info && info.model) || '',
    modelId: (info && info.modelId) || '',
    tier: (info && info.tier) || '',
    effort: (info && info.effort) || '',
    tokens: (info && info.tokens) || 0,
    window: window || CONTEXT_WINDOW,
    // time
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    lastActivityAt: (info && info.lastActivityAt) || entry.updatedAt,
    version: entry.version || (info && info.version) || '',
    tasks: tasks || null,
  };
}

// Every live Claude Code session on the machine, richest-first.
//
// `roots` are the open workspace folders — they do not filter the result (the
// panel wants to show sessions in other projects too), they only decide sort
// order via registry.groupByProject.
function allSessions(roots, opts) {
  opts = opts || {};
  const entries = opts.entries || registry.liveSessions({ now: opts.now });
  const out = [];
  for (const e of entries) {
    const info = readSessionInfo(transcriptPath(e.cwd, e.sessionId));
    if (info) recordModelWindow(info.modelId, info.maxSeen);
    const window = info ? modelWindow(info.modelId, info.maxSeen) : CONTEXT_WINDOW;
    out.push(composeSession(e, info, tasksForSession(e.sessionId), window));
  }
  return out;
}

// The sessions to surface for the open workspace, newest first, capped at maxN.
//
// Primary path: the registry (exact, machine-wide, knows liveness and status).
// Fallback: recency over the transcripts of the open roots, for setups where the
// registry is missing (older Claude Code) — this is the pre-1.0 behaviour.
// Returns { sessions, total, others } where `others` counts live sessions that
// belong to a different project.
function recentSessions(roots, opts) {
  opts = opts || {};
  const maxN = opts.maxN || MAX_SESSIONS;
  const now = opts.now || Date.now();
  const wanted = new Set((roots || []).map((r) => path.resolve(r)));

  const live = opts.entries || registry.liveSessions({ now });
  if (live.length) {
    const mine = live.filter((e) => wanted.has(path.resolve(e.cwd)));
    const sessions = allSessions(roots, { entries: mine.slice(0, maxN) });
    return { sessions, total: mine.length, others: live.length - mine.length };
  }

  // --- fallback: no registry, infer from transcript recency ---
  const windowMs = opts.windowMs || ACTIVE_WINDOW_MS;
  const all = listTranscripts(roots).sort((a, b) => b.mtime - a.mtime);
  let picked = all.filter((x) => now - x.mtime <= windowMs).slice(0, maxN);
  if (!picked.length && all.length) picked = [all[0]];
  const sessions = [];
  for (const p of picked) {
    const info = readSessionInfo(p.file);
    if (!info) continue;
    recordModelWindow(info.modelId, info.maxSeen);
    const entry = {
      sessionId: info.sessionId || path.basename(p.file, '.jsonl'),
      pid: 0,
      cwd: p.cwd,
      name: '',
      status: 'idle',
      version: info.version || '',
      startedAt: 0,
      updatedAt: p.mtime,
      alive: true,
    };
    sessions.push(
      composeSession(
        entry,
        info,
        tasksForSession(entry.sessionId),
        modelWindow(info.modelId, info.maxSeen)
      )
    );
  }
  return { sessions, total: all.length, others: 0 };
}

module.exports = {
  prettyModel,
  contextTokens,
  pickWindow,
  latestSessionInfo,
  encodeProjectDir,
  transcriptPath,
  readSessionInfo,
  tasksForSession,
  listTranscripts,
  recentSessions,
  allSessions,
  CONTEXT_WINDOW,
  MAX_SESSIONS,
  // exported for unit tests
  toolActivity,
  composeSession,
  askQuestionText,
};
