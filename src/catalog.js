'use strict';

// Claude Code's own model catalog.
//
// Since 2.1.2xx the CLI caches the list it offers in /model under
// ~/.claude/cache/model-catalog/<org>-cc.json (or tok-<hash>-cc.json):
//
//   { "fetchedAt": …, "catalog": { "config": {
//       "models": [{ "id": "claude-opus-5-5", "name": "Opus 5.5",
//                    "section": "main" | "overflow",
//                    "runtime": { "max_input_tokens": 1000000,
//                                 "effort_levels": ["low", …], "default_effort": "medium" },
//                    "thinking": { "effort_options": [{ "id", "name", "badge"? }] } }],
//       "provider_alias_targets": { "opus": { "default": "claude-opus-5-5" } } } } }
//
// It answers three questions this extension used to guess at: what each alias
// resolves to, how large each model's context window really is, and which
// effort levels each model accepts. Every reader here degrades to "unknown"
// (null / empty) so a missing or foreign file only falls back to the old
// heuristics — it never breaks the panel.
const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR } = require('./settings');

const CATALOG_DIR = path.join(CLAUDE_DIR, 'cache', 'model-catalog');

// Pure: the useful part of one catalog file, or null.
function parseCatalog(raw) {
  const cfg = raw && raw.catalog && raw.catalog.config;
  if (!cfg || !Array.isArray(cfg.models)) return null;
  const models = [];
  for (const m of cfg.models) {
    if (!m || typeof m.id !== 'string' || !m.id) continue;
    const rt = m.runtime || {};
    const opts = (m.thinking && Array.isArray(m.thinking.effort_options) && m.thinking.effort_options) || [];
    const levels = Array.isArray(rt.effort_levels) ? rt.effort_levels.filter((x) => typeof x === 'string') : [];
    models.push({
      id: m.id,
      name: typeof m.name === 'string' ? m.name : m.id,
      description: typeof m.description === 'string' ? m.description : '',
      main: m.section === 'main',
      window: Number(rt.max_input_tokens) || 0,
      effortLevels: levels,
      defaultEffort: typeof rt.default_effort === 'string' ? rt.default_effort : '',
      // The CLI version that introduced it — how we tell a model released after
      // effort went per-model (which ignores a top-level `effortLevel`).
      minVersion: typeof m.min_claude_code_version === 'string' ? m.min_claude_code_version : '',
      // Only the warning badges ("3.5× or more usage") — those change a decision.
      effortWarnings: Object.fromEntries(
        opts
          .filter((o) => o && o.badge && o.badge.variant === 'warning' && typeof o.badge.message === 'string')
          .map((o) => [o.id, o.badge.message])
      ),
    });
  }
  const aliases = {};
  const targets = cfg.provider_alias_targets || {};
  for (const k of Object.keys(targets)) {
    const d = targets[k] && targets[k].default;
    if (typeof d === 'string') aliases[k] = d;
  }
  return { fetchedAt: Number(raw.fetchedAt) || 0, models, aliases };
}

// The freshest readable catalog on disk. Cheap enough to call per refresh: a
// handful of small files, re-read only when one of them changed.
let memo = { key: '', value: null };
function readCatalog(dir) {
  dir = dir || CATALOG_DIR;
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('-cc.json'));
  } catch (e) {
    return null;
  }
  const stats = files.map((f) => {
    try {
      return { f, m: fs.statSync(path.join(dir, f)).mtimeMs };
    } catch (e) {
      return { f, m: 0 };
    }
  });
  const key = dir + '|' + stats.map((s) => s.f + ':' + s.m).join(',');
  if (memo.key === key) return memo.value;
  let best = null;
  for (const s of stats) {
    try {
      const c = parseCatalog(JSON.parse(fs.readFileSync(path.join(dir, s.f), 'utf8')));
      if (c && c.models.length && (!best || c.fetchedAt > best.fetchedAt)) best = c;
    } catch (e) {
      /* half-written or foreign — skip */
    }
  }
  memo = { key, value: best };
  return best;
}

// Pure: 'opus' → 'claude-opus-5-5'; 'opus[1m]' → same; an explicit id is kept.
// '' when it cannot be resolved (unset model, 'default', unknown alias).
function resolveModel(cat, model) {
  const m = String(model || '').trim().replace(/\[1m\]$/i, '');
  if (!m || m === 'default') return (cat && cat.aliases.default) || '';
  if (cat && cat.aliases[m]) return cat.aliases[m];
  return /^claude-/.test(m) ? m : '';
}

// Pure: the catalog entry for a model id. A dated id falls back to its family
// ('claude-sonnet-5-20260101' → 'claude-sonnet-5'), and only a date does: a
// bare 'claude-opus-4' must not be taken for 'claude-opus-4-8'.
function findModel(cat, id) {
  if (!cat || !id) return null;
  return (
    cat.models.find((m) => m.id === id) ||
    cat.models.find((m) => id.startsWith(m.id + '-') && /^\d{8}$/.test(id.slice(m.id.length + 1))) ||
    null
  );
}

// Pure: '2.1.280' >= '2.1.252'.
function versionAtLeast(v, min) {
  const a = String(v || '').split('.').map(Number);
  const b = String(min || '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

function windowFor(cat, id) {
  const m = findModel(cat, id);
  return m ? m.window : 0;
}

module.exports = {
  CATALOG_DIR,
  readCatalog,
  resolveModel,
  findModel,
  windowFor,
  versionAtLeast,
  // exported for unit tests
  parseCatalog,
};
