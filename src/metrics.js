'use strict';

// Token analytics over the local transcripts.
//
// Every assistant turn in a transcript carries the exact token accounting for
// that request:
//
//   "usage": { "input_tokens": 2, "output_tokens": 1164,
//              "cache_creation_input_tokens": 42422, "cache_read_input_tokens": 0 }
//
// Summing those per day / project / model gives a picture of how the plan is
// actually being spent — including cache efficiency, which is the number that
// moves the needle most and which nothing surfaces today.
//
// Deliberately no monetary values: prices change and a stale table would print
// confident wrong numbers. Tokens, ratios and rates are exact and never rot.
//
// Scanning every transcript is expensive, so results are cached per file keyed
// on (mtime, size): a file that hasn't changed is never re-read. The first run
// pays for the history, every run after that only reads what moved. The scan is
// chunked across ticks of the event loop so the extension host never blocks.
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');

const CACHE_PATH = path.join(CLAUDE_DIR, 'cursor-claude-control', 'metrics-cache.json');
// Bump whenever the per-file record shape changes, so stale entries are dropped
// instead of silently serving a field the current code no longer produces.
const CACHE_VERSION = 2;
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const DEFAULT_DAYS = 30;
const BATCH_SIZE = 6; // files parsed per event-loop tick
const MAX_FILE_BYTES = 24 * 1024 * 1024; // skip pathological transcripts

// --- pure aggregation helpers -------------------------------------------------

function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, turns: 0 };
}

function addInto(target, src) {
  target.input += src.input || 0;
  target.output += src.output || 0;
  target.cacheRead += src.cacheRead || 0;
  target.cacheCreate += src.cacheCreate || 0;
  target.turns += src.turns || 0;
  return target;
}

// Local calendar day of an ISO timestamp — "today" must mean the user's today,
// not UTC's, or the most recent bar is wrong for anyone west of Greenwich.
function dayKey(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Total tokens that passed through the model, however they were billed.
function totalTokens(b) {
  return (b.input || 0) + (b.output || 0) + (b.cacheRead || 0) + (b.cacheCreate || 0);
}

// Share of the prompt that was served from cache rather than re-sent. High is
// good: it is the difference between re-reading the conversation and replaying it.
function cacheHitRate(b) {
  const promptSide = (b.input || 0) + (b.cacheRead || 0) + (b.cacheCreate || 0);
  return promptSide ? (b.cacheRead || 0) / promptSide : 0;
}

// Turns Claude Code writes for its own bookkeeping rather than for the user.
// They carry a usage block but no real model, and counting them would inflate
// the model split with a name nobody recognises.
const SYNTHETIC_MODELS = new Set(['<synthetic>', 'unknown', '']);

// Pure: parses one transcript into per-day, per-model buckets.
// Also recovers the real working directory: every entry carries `cwd`, which is
// the only way back to the true project name — the directory Claude Code encodes
// the path into is lossy ("allium-web" and "allium/web" collapse the same way).
function scanTranscript(text) {
  const days = {};
  const models = {};
  let cwd = '';
  if (!text) return { days, models, cwd };
  for (const ln of text.split('\n')) {
    if (!ln) continue;
    // Cheap pre-filter: only assistant turns carry usage, and JSON.parse on
    // every line of a multi-megabyte transcript is the whole cost of this scan.
    if (ln.indexOf('"usage"') === -1) continue;
    let o;
    try {
      o = JSON.parse(ln);
    } catch (e) {
      continue;
    }
    if (!o || o.type !== 'assistant') continue;
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    const u = o.message && o.message.usage;
    if (!u) continue;
    const m = (o.message && o.message.model) || '';
    if (SYNTHETIC_MODELS.has(m)) continue;
    const point = {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheCreate: u.cache_creation_input_tokens || 0,
      turns: 1,
    };
    const k = dayKey(o.timestamp);
    if (k) addInto((days[k] = days[k] || emptyBucket()), point);
    addInto((models[m] = models[m] || emptyBucket()), point);
  }
  return { days, models, cwd };
}

// Pure: folds per-file results into the report the panel renders.
// `files` is [{ project, days, models }]; `sinceDay` clips the window.
function aggregate(files, sinceDay) {
  const days = {};
  const models = {};
  const projects = {};
  const total = emptyBucket();
  for (const f of files || []) {
    let projectTotal = null;
    for (const [k, b] of Object.entries(f.days || {})) {
      if (sinceDay && k < sinceDay) continue;
      addInto((days[k] = days[k] || emptyBucket()), b);
      addInto(total, b);
      projectTotal = addInto(projectTotal || emptyBucket(), b);
    }
    if (projectTotal) {
      addInto((projects[f.project] = projects[f.project] || emptyBucket()), projectTotal);
      // Model split is per file, not per day, so it is only attributed when the
      // file contributed at all to the window.
      for (const [m, b] of Object.entries(f.models || {})) {
        addInto((models[m] = models[m] || emptyBucket()), b);
      }
    }
  }
  const toSorted = (obj) =>
    Object.entries(obj)
      .map(([name, b]) => ({ name, ...b, total: totalTokens(b) }))
      .sort((a, b) => b.total - a.total);
  return {
    total: { ...total, total: totalTokens(total), cacheHitRate: cacheHitRate(total) },
    days: Object.entries(days)
      .map(([day, b]) => ({ day, ...b, total: totalTokens(b) }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    projects: toSorted(projects),
    models: toSorted(models),
  };
}

// Pure: fills gaps so a sparse history still renders as a continuous calendar.
function fillDays(series, days, todayKey) {
  const have = new Map((series || []).map((d) => [d.day, d]));
  const out = [];
  const base = new Date(todayKey + 'T12:00:00'); // midday: immune to DST shifts
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    const k = dayKey(d.toISOString());
    out.push(have.get(k) || { day: k, ...emptyBucket(), total: 0 });
  }
  return out;
}

// Pure: how fast the plan window is filling, and when it runs out.
//
// `history` is the usage series we already keep ([{ t, s, w }] — 5h and 7d
// utilization over time). Only the trailing run since the last reset counts: a
// window rolling over drops utilization to near zero, and averaging across that
// discontinuity would report a nonsensical rate.
//
// `resetsAtMs` is when the window rolls over. A projection past that point is
// not just useless, it is wrong — the window empties before it can fill — so we
// report `resetsFirst` instead of a time.
//
// Returns { ratePerHour, minutesLeft, resetsFirst, sampleMinutes } or null when
// there isn't enough of a signal to say anything honest.
function burnRate(history, key, current, now, resetsAtMs) {
  const pts = (history || []).filter((p) => p && p[key] != null && p.t);
  if (pts.length < 3) return null;
  // Walk back from the newest point while the series is non-decreasing.
  let start = pts.length - 1;
  while (start > 0 && pts[start - 1][key] <= pts[start][key]) start--;
  const run = pts.slice(start);
  if (run.length < 3) return null;
  const first = run[0];
  const last = run[run.length - 1];
  const hours = (last.t - first.t) / 3600000;
  if (hours < 0.05) return null; // under 3 minutes of signal — too noisy
  const ratePerHour = (last[key] - first[key]) / hours;
  const cur = current == null ? last[key] : current;
  const stale = ((now || Date.now()) - last.t) / 60000;
  if (stale > 30) return null; // the series went cold; don't project from it
  let minutesLeft = ratePerHour > 0.05 ? ((100 - cur) / ratePerHour) * 60 : null;
  if (minutesLeft != null && minutesLeft < 0) minutesLeft = null;
  const untilReset = resetsAtMs ? (resetsAtMs - (now || Date.now())) / 60000 : null;
  const resetsFirst = minutesLeft != null && untilReset != null && untilReset > 0 && minutesLeft > untilReset;
  return {
    ratePerHour,
    minutesLeft: resetsFirst ? null : minutesLeft == null ? null : Math.round(minutesLeft),
    resetsFirst,
    sampleMinutes: Math.round(hours * 60),
  };
}

// --- cached, chunked collection ----------------------------------------------

function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (j && j.version === CACHE_VERSION && j.files) return j;
  } catch (e) {
    /* no cache yet, or from an older layout */
  }
  return { version: CACHE_VERSION, files: {} };
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    const tmp = CACHE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, CACHE_PATH);
  } catch (e) {
    /* the cache is an optimization; losing it only costs a rescan */
  }
}

// Claude Code's directory name is the cwd with non-alphanumerics replaced by '-',
// which is lossy — we can't recover the real path. The trailing segment is a good
// display name, and it's what the user recognises.
function projectNameFromDir(dirName) {
  const parts = String(dirName).split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : dirName;
}

// Every transcript worth considering for the window, newest first.
function listCandidates(sinceMs) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(full);
      } catch (e) {
        continue;
      }
      // A transcript last written before the window opened cannot contain a turn
      // inside it, so it never needs reading.
      if (st.mtimeMs < sinceMs) continue;
      if (st.size > MAX_FILE_BYTES) continue;
      out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size, project: projectNameFromDir(d.name) });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

let _running = false;
// Callers that arrive mid-scan wait for the run in flight rather than being
// dropped — dropping one leaves the panel showing "reading transcripts…" with
// nothing on its way to replace it.
let _waiting = [];

// Collects the report, reading only what changed since last time.
// cb(report) is called once, on the next tick at the earliest. `report` carries
// `scanned` (files parsed this run) so the UI can say the first run took work.
function collect(opts, cb) {
  opts = opts || {};
  const days = opts.days || DEFAULT_DAYS;
  const now = opts.now || Date.now();
  const sinceMs = now - days * 86400000;
  const sinceDay = dayKey(new Date(sinceMs).toISOString());
  const today = dayKey(new Date(now).toISOString());

  if (_running) {
    _waiting.push(cb);
    return;
  }
  _running = true;

  const cache = readCache();
  const candidates = listCandidates(sinceMs);
  // Prefer the real cwd recorded inside the transcript over the lossy directory
  // name; fall back to the directory when a transcript has no assistant turn.
  const label = (rec, fallback) =>
    rec && rec.cwd ? path.basename(rec.cwd) || fallback : fallback;

  const results = [];
  const todo = [];
  for (const c of candidates) {
    const hit = cache.files[c.file];
    if (hit && hit.mtimeMs === c.mtimeMs && hit.size === c.size) {
      results.push({ project: label(hit, c.project), days: hit.days, models: hit.models });
    } else {
      todo.push(c);
    }
  }

  let scanned = 0;
  const finish = () => {
    _running = false;
    const queued = _waiting;
    _waiting = [];
    // Forget entries for transcripts that no longer exist or fell out of the
    // window, so the cache tracks the working set instead of growing forever.
    const keep = new Set(candidates.map((c) => c.file));
    for (const k of Object.keys(cache.files)) if (!keep.has(k)) delete cache.files[k];
    writeCache(cache);
    const report = aggregate(results, sinceDay);
    report.series = fillDays(report.days, Math.min(days, 30), today);
    report.scanned = scanned;
    report.files = candidates.length;
    report.days_ = days;
    cb(report);
    for (const w of queued) w(report);
  };

  const step = () => {
    const batch = todo.splice(0, BATCH_SIZE);
    if (!batch.length) return finish();
    for (const c of batch) {
      let parsed = { days: {}, models: {}, cwd: '' };
      try {
        parsed = scanTranscript(fs.readFileSync(c.file, 'utf8'));
        scanned++;
      } catch (e) {
        /* unreadable transcript — count it as empty rather than failing the run */
      }
      cache.files[c.file] = { mtimeMs: c.mtimeMs, size: c.size, ...parsed };
      results.push({ project: label(parsed, c.project), days: parsed.days, models: parsed.models });
    }
    setTimeout(step, 0); // yield: keep the extension host responsive
  };
  setTimeout(step, 0);
}

module.exports = {
  collect,
  CACHE_PATH,
  // exported for unit tests
  scanTranscript,
  aggregate,
  fillDays,
  burnRate,
  cacheHitRate,
  totalTokens,
  dayKey,
  emptyBucket,
  projectNameFromDir,
};
