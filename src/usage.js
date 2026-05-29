// Live plan usage (the same numbers as /usage): local token discovery + a cached
// HTTP client with backoff that never lets an error overwrite the last good value.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CLAUDE_DIR, fileExists } = require('./settings');

const USAGE_TTL_MS = 60000; // in-memory freshness; kept equal to the poll interval
const SHARED_CACHE_MAX_AGE_MS = 75000; // accept the statusline's cache if newer than this
const DEFAULT_BACKOFF_MS = 120000; // pause after a 429 that carries no retry-after
const REQUEST_TIMEOUT_MS = 4000;
const HISTORY_MAX_POINTS = 240; // ~4h at one point per 60s
const HISTORY_MERGE_MS = 45000; // coalesce points captured within this window

const HISTORY_PATH = path.join(CLAUDE_DIR, 'cursor-claude-control', 'usage-history.json');

// Cache file shared with Claude Code's own statusline (~/.claude/statusline.sh
// writes the same path under $TMPDIR, TTL ~60s). Reading it lets us piggyback on
// the statusline's fetch and almost never call the API ourselves — which is what
// keeps us under the endpoint's rate limit. The file holds only utilization
// numbers (never the token), and we treat whatever we read from it as untrusted.
const SHARED_CACHE = path.join(os.tmpdir(), 'claude_oauth_usage.json');

function readUsageHistory() {
  try {
    const j = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

// Pure: returns the new history array. Updates the last point if it is very
// recent (<45s), otherwise appends, and caps the series length.
function mergeHistory(hist, point, now) {
  const out = hist.slice();
  const last = out[out.length - 1];
  if (last && now - last.t < HISTORY_MERGE_MS) {
    out[out.length - 1] = { t: now, s: point.s, w: point.w };
  } else {
    out.push({ t: now, s: point.s, w: point.w });
  }
  while (out.length > HISTORY_MAX_POINTS) out.shift();
  return out;
}

function recordUsage(j, now) {
  try {
    const s = j.five_hour ? j.five_hour.utilization : null;
    const w = j.seven_day ? j.seven_day.utilization : null;
    if (s == null && w == null) return;
    const next = mergeHistory(readUsageHistory(), { s, w }, now);
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(next));
  } catch (e) {
    /* history is best-effort */
  }
}

function readSharedCache(maxAgeMs) {
  try {
    const st = fs.statSync(SHARED_CACHE);
    if (Date.now() - st.mtimeMs > maxAgeMs) return null;
    const j = JSON.parse(fs.readFileSync(SHARED_CACHE, 'utf8'));
    if (j && (j.five_hour || j.seven_day)) return j;
  } catch (e) {
    /* no shared cache available */
  }
  return null;
}
function writeSharedCache(j) {
  try {
    // O_EXCL on the temp file so we never clobber/follow a pre-existing path,
    // then an atomic rename so we don't race the statusline mid-write.
    const tmp = SHARED_CACHE + '.cc.tmp';
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      /* may not exist */
    }
    fs.writeFileSync(tmp, JSON.stringify(j), { flag: 'wx' });
    fs.renameSync(tmp, SHARED_CACHE);
  } catch (e) {
    /* sharing the cache is best-effort */
  }
}

// Reads the existing local Claude Code OAuth token. Never logs it, never writes
// it anywhere; it is only sent to api.anthropic.com over HTTPS.
function readOauthToken() {
  // 1) credentials file (Linux/Windows, and macOS when exported)
  try {
    const f = path.join(CLAUDE_DIR, '.credentials.json');
    if (fileExists(f)) {
      const t = JSON.parse(fs.readFileSync(f, 'utf8')).claudeAiOauth?.accessToken;
      if (t) return t;
    }
  } catch (e) {
    /* ignore */
  }
  // 2) macOS Keychain — execFile (no shell) with a constant argv, stderr muted
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execFileSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const t = JSON.parse(out).claudeAiOauth?.accessToken;
      if (t) return t;
    } catch (e) {
      /* ignore — no Keychain entry */
    }
  }
  return null;
}

// Pure: decides what an HTTP usage response means. An error (429/other/non-JSON)
// never becomes the cached value — we keep serving the last good one (`prevGood`).
// Returns { value, state, cache?, backoffMs? }. state ∈ ok|stale|ratelimited|error.
function classifyUsageResponse(statusCode, body, headers, prevGood) {
  let j = null;
  try {
    j = JSON.parse(body);
  } catch (e) {
    /* non-JSON body */
  }
  const valid = statusCode === 200 && j && (j.five_hour || j.seven_day);
  if (valid) return { value: j, state: 'ok', cache: j };
  if (statusCode === 429) {
    const ra = parseInt(headers && headers['retry-after'], 10);
    return {
      value: prevGood,
      state: prevGood ? 'stale' : 'ratelimited',
      backoffMs: ra > 0 ? ra * 1000 : DEFAULT_BACKOFF_MS,
    };
  }
  return { value: prevGood, state: prevGood ? 'stale' : 'error' };
}

// _usageCache.data always holds the last GOOD value (HTTP 200 with valid shape).
let _usageCache = { at: 0, data: null };
let _backoffUntil = 0;

// cb(data, state): state ∈ 'ok' | 'stale' | 'notoken' | 'ratelimited' | 'error'.
function getUsage(cb) {
  const now = Date.now();
  const have = _usageCache.data;

  // fresh in-memory value
  if (have && now - _usageCache.at < USAGE_TTL_MS) {
    cb(have, 'ok');
    return;
  }
  // piggyback on the statusline's shared cache — avoids hitting the API
  const shared = readSharedCache(SHARED_CACHE_MAX_AGE_MS);
  if (shared) {
    _usageCache = { at: now, data: shared };
    _backoffUntil = 0;
    recordUsage(shared, now);
    cb(shared, 'ok');
    return;
  }
  // in backoff after a 429 — don't hit the API, serve the last good (maybe null)
  if (now < _backoffUntil) {
    cb(have, have ? 'stale' : 'ratelimited');
    return;
  }
  const token = readOauthToken();
  if (!token) {
    cb(have, have ? 'stale' : 'notoken');
    return;
  }

  let done = false;
  const finish = (v, st) => {
    if (done) return;
    done = true;
    cb(v, st);
  };
  const https = require('https');
  const req = https.request(
    {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
    (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        const r = classifyUsageResponse(res.statusCode, b, res.headers, have);
        if (r.cache) {
          _usageCache = { at: now, data: r.cache };
          _backoffUntil = 0;
          recordUsage(r.cache, now);
          writeSharedCache(r.cache); // share with the statusline
        } else if (r.backoffMs != null) {
          _backoffUntil = now + r.backoffMs;
        }
        finish(r.value, r.state);
      });
    }
  );
  req.on('error', () => finish(have, have ? 'stale' : 'error'));
  req.on('timeout', () => {
    req.destroy();
    finish(have, have ? 'stale' : 'error');
  });
  req.end();
}

module.exports = {
  getUsage,
  readUsageHistory,
  recordUsage,
  // exported for unit tests
  mergeHistory,
  classifyUsageResponse,
};
