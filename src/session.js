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

// Reference window shown in the Usage tab (Claude Code's standard window).
const CONTEXT_WINDOW = 200000;
const TAIL_BYTES = 1024 * 1024; // read only the tail of the (possibly large) transcript

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

// Pure: scan JSONL text from the end for the latest assistant turn with usage.
// Returns { model, modelId, tokens } or null.
function latestSessionInfo(text) {
  if (!text) return null;
  const lines = text.split('\n');
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
      return { model: prettyModel(msg.model), modelId: msg.model || '', tokens: contextTokens(msg.usage) };
    }
  }
  return null;
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

// Find the most recently modified transcript across the given workspace roots
// and return its latest session info, or null when there's no session for them.
function sessionForRoots(roots) {
  let best = null;
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
      if (!best || st.mtimeMs > best.mtime) best = { file: full, mtime: st.mtimeMs };
    }
  }
  if (!best) return null;
  try {
    const info = latestSessionInfo(readTail(best.file, TAIL_BYTES));
    return info ? { ...info, window: CONTEXT_WINDOW } : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  prettyModel,
  contextTokens,
  latestSessionInfo,
  encodeProjectDir,
  sessionForRoots,
  CONTEXT_WINDOW,
};
