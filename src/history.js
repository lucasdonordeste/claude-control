'use strict';

// Every prompt you have ever sent, searchable.
//
// Claude Code appends one line to ~/.claude/history.jsonl per submitted prompt:
//
//   { "display": "…the prompt text…", "pastedContents": {},
//     "timestamp": 1785705527289, "project": "/path/to/project",
//     "sessionId": "…" }
//
// That is a complete, cross-project index of everything you have asked, and
// nothing reads it — every search in this ecosystem is scoped to one transcript.
// "What was that thing I asked about the webhook retry, three weeks ago, in the
// other repo" is a question only this file can answer.
//
// Read on demand, never on the poll: it is a couple of megabytes and only the
// search command needs it.
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');

const HISTORY_PATH = path.join(CLAUDE_DIR, 'history.jsonl');
// Newest first, and stop well before the UI could ever show them all.
const MAX_ENTRIES = 5000;

// Pure: parses the newest `limit` entries, newest first.
function parse(text, limit) {
  const lines = text.split('\n');
  const out = [];
  const cap = limit || MAX_ENTRIES;
  for (let i = lines.length - 1; i >= 0 && out.length < cap; i--) {
    const ln = lines[i];
    if (!ln) continue;
    let o;
    try {
      o = JSON.parse(ln);
    } catch (e) {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const display = typeof o.display === 'string' ? o.display : '';
    if (!display.trim()) continue;
    out.push({
      text: display,
      at: Number(o.timestamp) || 0,
      project: typeof o.project === 'string' ? o.project : '',
      sessionId: typeof o.sessionId === 'string' ? o.sessionId : '',
    });
  }
  return out;
}

function read(opts) {
  opts = opts || {};
  let text;
  try {
    text = fs.readFileSync(opts.file || HISTORY_PATH, 'utf8');
  } catch (e) {
    return [];
  }
  return parse(text, opts.limit);
}

// Pure: ranks entries against a query.
//
// Deliberately not fuzzy — VS Code's QuickPick already fuzzy-matches whatever we
// hand it. This narrows the set first, so the picker is scoring hundreds of rows
// instead of thousands, and applies the one piece of ranking the picker cannot
// know: recency. A word matched near the start of a prompt is usually the topic;
// a recent prompt is usually the one being looked for.
function search(entries, query, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const q = String(query || '').trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const e of entries) {
    const hay = e.text.toLowerCase();
    if (terms.length && !terms.every((t) => hay.includes(t))) continue;
    let score = 0;
    for (const t of terms) {
      const at = hay.indexOf(t);
      score += 10;
      // Continuous rather than bucketed: a term six characters in really is a
      // better hit than the same term forty in, and bucketing made those tie.
      score += Math.max(0, 6 - at / 8);
      // A whole-word hit beats an incidental substring.
      if (new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(hay)) score += 4;
    }
    // Recency, decaying over a month. Capped well below the spread of the
    // positional term above, so it breaks ties between comparable matches and
    // cannot overturn one that is genuinely better — which is what the previous
    // weight of 8 did, letting yesterday's passing mention beat last month's
    // prompt that was actually about the thing.
    const days = Math.max(0, (now - e.at) / 86400000);
    score += Math.max(0, 2.5 - days / 12);
    scored.push({ ...e, score });
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at);
  return opts.limit ? scored.slice(0, opts.limit) : scored;
}

// Pure: collapses a prompt to one line for a picker row.
function oneLine(text, max) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

module.exports = {
  HISTORY_PATH,
  read,
  search,
  // exported for unit tests
  parse,
  oneLine,
  MAX_ENTRIES,
};
