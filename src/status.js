'use strict';

// Anthropic's public status page.
//
// status.anthropic.com 302s to status.claude.com, which is a standard Atlassian
// Statuspage: /api/v2/summary.json carries the overall indicator, one entry per
// component, and the open incidents.
//
// Privacy: this is an anonymous GET of a public page. No token, no cookies, no
// query string, nothing about you or your machine goes out — it is the same
// request your browser makes when you open the status page, and it is off the
// moment `claudeControl.status.enabled` is false. It is not telemetry: nothing
// is reported *about* you. See README "Privacy".

const HOST = 'status.claude.com';
const PATH = '/api/v2/summary.json';
const PAGE = 'https://status.claude.com';

const REQUEST_TIMEOUT_MS = 4000;
// The status page is a CDN-backed static document and an incident lasts far
// longer than a poll interval, so this is deliberately lazy.
const TTL_MS = 5 * 60 * 1000;
// After a failure, stop asking for a while. A machine that is offline should not
// retry every five minutes forever, and the status page is the last thing that
// should generate noise when the network is already unhappy.
const BACKOFF_MS = 15 * 60 * 1000;

// The components the CLI actually depends on. claude.ai, the Console, Cowork and
// Government can all be down without touching anything you do in a terminal, and
// a banner that cries wolf is a banner you stop reading.
const WATCHED = ['claude code', 'claude api'];

// Statuspage's component vocabulary, worst last. `level` is our own name for it,
// so the UI never has to know Statuspage's spelling.
const RANK = [
  { key: 'operational', level: 'ok', rank: 0 },
  { key: 'under_maintenance', level: 'maintenance', rank: 1 },
  { key: 'degraded_performance', level: 'degraded', rank: 2 },
  { key: 'partial_outage', level: 'partial', rank: 3 },
  { key: 'major_outage', level: 'major', rank: 4 },
];

function rankOf(componentStatus) {
  const hit = RANK.find((r) => r.key === String(componentStatus || '').toLowerCase());
  // An unknown status is not silently treated as healthy: a Statuspage that grew
  // a new severity should surface as *something* rather than vanish.
  return hit || { key: 'unknown', level: 'degraded', rank: 2 };
}

// A component counts if its name is one we watch. Matching is loose because the
// page names them "Claude Code" and "Claude API (api.anthropic.com)" today and
// has renamed them before.
function isWatched(name) {
  const n = String(name || '').toLowerCase();
  return WATCHED.some((w) => n.startsWith(w));
}

// Pure: summary.json -> what the UI shows. Never throws; anything unusable
// becomes level 'unknown', which the UI renders as nothing at all.
function parseStatus(json) {
  const unknown = { level: 'unknown', label: '', components: [], incident: '', url: PAGE };
  if (!json || typeof json !== 'object') return unknown;

  const all = Array.isArray(json.components) ? json.components : [];
  const watched = all.filter((c) => c && isWatched(c.name) && !c.group);
  if (!watched.length) return unknown;

  let worst = { level: 'ok', rank: 0 };
  const components = [];
  for (const c of watched) {
    const r = rankOf(c.status);
    components.push({ name: String(c.name || ''), level: r.level });
    if (r.rank > worst.rank) worst = r;
  }

  // The incident name is the one useful sentence on the page — "Elevated error
  // rates on Claude Code" says more than any severity word we could invent.
  const incidents = Array.isArray(json.incidents) ? json.incidents : [];
  const open = incidents.find((i) => i && i.status && i.status !== 'resolved');

  return {
    level: worst.level,
    label: String((json.status && json.status.description) || ''),
    components,
    incident: open ? String(open.name || '') : '',
    url: PAGE,
  };
}

let _cache = { at: 0, data: null };
let _backoffUntil = 0;

// Fires `cb(status|null)`. Never rejects and never throws: a status banner is
// the last thing that should break the panel.
function getStatus(cb, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  if (_cache.data && now - _cache.at < TTL_MS) return cb(_cache.data);
  if (now < _backoffUntil) return cb(_cache.data);

  let done = false;
  const finish = (v) => {
    if (done) return;
    done = true;
    cb(v);
  };

  const https = require('https');
  const req = https.request(
    {
      hostname: HOST,
      path: PATH,
      method: 'GET',
      // No Authorization, no cookie, no identifying header of any kind.
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
    },
    (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          _backoffUntil = now + BACKOFF_MS;
          return finish(_cache.data);
        }
        let parsed;
        try {
          parsed = parseStatus(JSON.parse(b));
        } catch (e) {
          _backoffUntil = now + BACKOFF_MS;
          return finish(_cache.data);
        }
        if (parsed.level === 'unknown') {
          _backoffUntil = now + BACKOFF_MS;
          return finish(_cache.data);
        }
        _cache = { at: now, data: parsed };
        _backoffUntil = 0;
        finish(parsed);
      });
    }
  );
  const fail = () => {
    _backoffUntil = now + BACKOFF_MS;
    req.destroy();
    finish(_cache.data);
  };
  req.on('error', fail);
  req.on('timeout', fail);
  req.end();
}

module.exports = { parseStatus, getStatus, PAGE, TTL_MS, BACKOFF_MS };
