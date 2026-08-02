'use strict';

// The subagent tree of a session.
//
// When a session delegates work, Claude Code writes each subagent's own
// transcript next to the parent's, in a directory named after the session:
//
//   projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.jsonl
//   projects/<encoded-cwd>/<session-id>/subagents/agent-<id>.meta.json
//
// The meta file is what makes the tree cheap to build — it already carries the
// depth and the parent link:
//
//   { "agentType": "general-purpose",
//     "description": "Maquete: módulo elevador final",
//     "toolUseId": "toolu_01VXKHwhLwN8JUb2w23T1YqV",   // the call that spawned it
//     "spawnDepth": 1 }
//
// `toolUseId` points at the `tool_use` block in whichever transcript spawned the
// agent — the session's for depth 1, another agent's for deeper ones. That gives
// us exact parentage.
//
// Liveness comes from the agent's own transcript, NOT from the parent's
// tool_result. Since 2.1 subagents are backgrounded by default, so the spawning
// call is answered the instant the agent launches ("agent launched successfully")
// and keeps that result for the whole run — treating it as completion marks every
// background agent finished the moment it starts. The honest signal is the last
// assistant entry the agent itself wrote: `stop_reason: "end_turn"` means it
// returned its answer; anything else means it is still going.
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');
const { encodeProjectDir, contextTokens, prettyModel, toolActivity } = require('./session');

// Agent transcripts are much smaller than session ones; this tail is usually the
// whole file, which is what lets us collect their spawn ids for parentage.
const AGENT_TAIL_BYTES = 256 * 1024;
// Safety net only, for an agent killed mid-run: it never writes a closing turn,
// so without this it would read as running forever. Generous on purpose — a
// single reasoning turn at high effort routinely writes nothing for minutes, and
// calling a working agent "done" is a worse error than showing a dead one as
// running for a while longer.
const AGENT_IDLE_MS = 15 * 60 * 1000;
const MAX_AGENTS = 200; // hard cap so a runaway workflow can't stall the panel

function subagentsDir(cwd, sessionId) {
  return path.join(CLAUDE_DIR, 'projects', encodeProjectDir(cwd), sessionId, 'subagents');
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

// Pure: one backward pass over an agent transcript tail.
// Returns { tokens, model, modelId, lastTool, lastActivityAt, spawnedIds, finished }.
// `spawnedIds` are the tool_use ids of delegations *this* agent made, which is
// how its own children find it as their parent.
function scanAgentTranscript(text) {
  const out = {
    tokens: 0,
    model: '',
    modelId: '',
    lastTool: null,
    lastActivityAt: 0,
    spawnedIds: [],
    finished: false,
  };
  if (!text) return out;
  const lines = text.split('\n');
  const answered = new Set();
  let sawAssistant = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let o;
    try {
      o = JSON.parse(ln);
    } catch (e) {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    if (!out.lastActivityAt && o.timestamp) {
      const ts = Date.parse(o.timestamp);
      if (ts) out.lastActivityAt = ts;
    }
    const msg = o.message;
    const content = msg && msg.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'tool_result' && b.tool_use_id) {
          answered.add(b.tool_use_id);
        } else if (b.type === 'tool_use') {
          if (b.id) out.spawnedIds.push(b.id);
          if (!out.lastTool) {
            out.lastTool = {
              name: String(b.name || ''),
              ...toolActivity(b.name, b.input),
              running: !answered.has(b.id),
            };
          }
        }
      }
    }
    // The newest assistant entry decides whether the agent has returned.
    if (o.type === 'assistant' && !sawAssistant) {
      sawAssistant = true;
      out.finished = msg ? msg.stop_reason === 'end_turn' : false;
    }
    if (o.type === 'assistant' && msg && msg.usage && !out.modelId) {
      out.tokens = contextTokens(msg.usage);
      out.modelId = msg.model || '';
      out.model = prettyModel(msg.model);
    }
  }
  return out;
}

// Pure: orders a flat agent list into a depth-first tree.
//
// Each agent knows the tool call that spawned it (`toolUseId`); each agent also
// knows which calls it made (`spawnedIds`). Matching one against the other gives
// the parent. Agents whose parent we cannot see — the session's own direct
// children, or a parent whose spawn call fell outside the scanned tail — hang off
// the root in start order, using `spawnDepth` for their indentation so they still
// read as nested.
function buildTree(agents) {
  const bySpawnId = new Map();
  for (const a of agents) {
    for (const id of a.spawnedIds || []) bySpawnId.set(id, a.id);
  }
  const children = new Map(); // parentId (or '' for root) -> [agent]
  for (const a of agents) {
    const parent = (a.toolUseId && bySpawnId.get(a.toolUseId)) || '';
    a.parentId = parent === a.id ? '' : parent;
    if (!children.has(a.parentId)) children.set(a.parentId, []);
    children.get(a.parentId).push(a);
  }
  for (const list of children.values()) {
    list.sort((x, y) => (x.startedAt || 0) - (y.startedAt || 0));
  }
  const out = [];
  const seen = new Set();
  const walk = (parentId, depth) => {
    for (const a of children.get(parentId) || []) {
      if (seen.has(a.id)) continue; // defensive: a cycle would otherwise hang us
      seen.add(a.id);
      out.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk('', 0);
  // Anything unreachable (its parent formed a cycle, or is missing) still shows,
  // indented by the depth Claude Code recorded.
  for (const a of agents) {
    if (!seen.has(a.id)) out.push({ ...a, depth: Math.max(0, (a.spawnDepth || 1) - 1) });
  }
  return out;
}

// The subagents of one session, as a depth-first ordered list with a `depth` for
// indentation. `answeredIds` comes from the parent session's transcript scan and
// decides which agents have already returned.
function listAgents(cwd, sessionId, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const dir = subagentsDir(cwd, sessionId);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return []; // this session never delegated
  }
  const metas = entries.filter((f) => f.endsWith('.meta.json')).slice(0, MAX_AGENTS);
  const agents = [];
  for (const mf of metas) {
    const id = mf.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, mf), 'utf8'));
    } catch (e) {
      continue;
    }
    const tf = path.join(dir, `agent-${id}.jsonl`);
    let st = null;
    try {
      st = fs.statSync(tf);
    } catch (e) {
      /* meta written before the transcript — still worth showing */
    }
    const scan = st ? scanAgentFile(tf, st) : scanAgentTranscript('');
    const toolUseId = String(meta.toolUseId || '');
    const lastAt = scan.lastActivityAt || (st ? st.mtimeMs : 0);
    // Finished when it wrote its closing turn, or when it has gone quiet long
    // enough that it is not coming back.
    const done = scan.finished || now - lastAt > AGENT_IDLE_MS;
    agents.push({
      id,
      agentType: String(meta.agentType || 'agent'),
      description: String(meta.description || ''),
      toolUseId,
      spawnDepth: Number(meta.spawnDepth) || 1,
      spawnedIds: scan.spawnedIds,
      startedAt: st ? st.birthtimeMs || st.mtimeMs : 0,
      lastActivityAt: lastAt,
      tokens: scan.tokens,
      model: scan.model,
      activity: scan.lastTool,
      running: !done,
      path: tf,
    });
  }
  return buildTree(agents);
}

// A finished subagent's transcript never changes again, and a session can
// accumulate hundreds of them. Keying the parse on (mtime, size) means the whole
// history costs one stat() per agent per refresh instead of a quarter-megabyte
// read — without it, the poll would re-parse every agent a long session ever ran.
const _scanCache = new Map(); // file -> { mtimeMs, size, scan }
const SCAN_CACHE_MAX = 512;

function scanAgentFile(file, st) {
  const hit = _scanCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.scan;
  let scan;
  try {
    scan = scanAgentTranscript(readTail(file, AGENT_TAIL_BYTES));
  } catch (e) {
    scan = scanAgentTranscript('');
  }
  if (_scanCache.size >= SCAN_CACHE_MAX) _scanCache.delete(_scanCache.keys().next().value);
  _scanCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, scan });
  return scan;
}

// How many subagents of this session are still working — the number the status
// bar shows next to the session.
function runningCount(agents) {
  return (agents || []).filter((a) => a.running).length;
}

module.exports = {
  subagentsDir,
  listAgents,
  runningCount,
  // exported for unit tests
  scanAgentTranscript,
  buildTree,
  AGENT_IDLE_MS,
};
