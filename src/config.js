'use strict';

// The editable surface of ~/.claude/settings.json.
//
// These are the knobs people actually reach for — which model runs, how hard it
// thinks, which permission mode it starts in, and the allow/deny/ask rules — and
// today every one of them means opening JSON and remembering the exact spelling.
//
// Writes go through writeSettings (atomic, with a .bak), and every value is
// validated against the vocabulary Claude Code accepts before it can reach the
// file: a typo'd `effortLevel` is not a harmless string, it is a setting that
// silently stops applying.
const { readSettingsSafe, writeSettings, isSafeKey } = require('./settings');

// Effort levels, cheapest first. `xhigh` and `max` exist but are gated by model,
// so we offer them and let Claude Code decide.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Permission modes as of 2.1.x. "default" was renamed to "manual"; we accept the
// old spelling on read so an existing config still displays correctly.
const PERMISSION_MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];

const PERMISSION_BUCKETS = ['allow', 'ask', 'deny'];

// Model aliases Claude Code understands, plus the `[1m]` long-context variants.
// Free-form ids are still allowed — this list only drives the picker.
const MODEL_PRESETS = [
  'opus',
  'opus[1m]',
  'sonnet',
  'sonnet[1m]',
  'haiku',
  'fable',
  'default',
];

// A catalogue of the rules worth reaching for, so the picker can offer them
// instead of asking someone to recall the syntax. Descriptions live in i18n
// under `permcat.<id>`; only the rule text is here.
//
// Grouped by what a person is actually trying to do, because "which rule do I
// need" is a goal-shaped question, not an alphabetical one.
const RULE_CATALOG = [
  // read-only work
  { id: 'read', rule: 'Read', group: 'read' },
  { id: 'glob', rule: 'Glob', group: 'read' },
  { id: 'grep', rule: 'Grep', group: 'read' },
  // editing
  { id: 'edit', rule: 'Edit', group: 'edit' },
  { id: 'write', rule: 'Write', group: 'edit' },
  { id: 'notebook', rule: 'NotebookEdit', group: 'edit' },
  // shell — the bucket where patterns actually matter
  { id: 'bash-all', rule: 'Bash', group: 'shell' },
  { id: 'bash-git-read', rule: 'Bash(git status:*)', group: 'shell' },
  { id: 'bash-git-diff', rule: 'Bash(git diff:*)', group: 'shell' },
  { id: 'bash-git-log', rule: 'Bash(git log:*)', group: 'shell' },
  { id: 'bash-git-commit', rule: 'Bash(git commit:*)', group: 'shell' },
  { id: 'bash-git-push', rule: 'Bash(git push:*)', group: 'shell' },
  { id: 'bash-npm-test', rule: 'Bash(npm test:*)', group: 'shell' },
  { id: 'bash-npm-run', rule: 'Bash(npm run:*)', group: 'shell' },
  { id: 'bash-npm-install', rule: 'Bash(npm install:*)', group: 'shell' },
  { id: 'bash-rm', rule: 'Bash(rm:*)', group: 'shell' },
  { id: 'bash-curl', rule: 'Bash(curl:*)', group: 'shell' },
  { id: 'bash-docker', rule: 'Bash(docker:*)', group: 'shell' },
  // network
  { id: 'websearch', rule: 'WebSearch', group: 'net' },
  { id: 'webfetch', rule: 'WebFetch', group: 'net' },
  // delegation and long-running work
  { id: 'agent', rule: 'Agent', group: 'agents' },
  { id: 'workflow', rule: 'Workflow', group: 'agents' },
  { id: 'skill', rule: 'Skill', group: 'agents' },
];

// A permission rule is `Tool`, `Tool(pattern)` or `mcp__server__tool`. Reject
// anything with characters that would make it meaningless or unparseable.
const RULE_RE = /^[A-Za-z_][A-Za-z0-9_-]*(\([^()]*\))?$|^mcp__[A-Za-z0-9_.-]+(__[A-Za-z0-9_.-]+)?$/;

function isValidRule(rule) {
  return typeof rule === 'string' && rule.length > 0 && rule.length < 400 && RULE_RE.test(rule.trim());
}

// Everything the Settings tab renders, read in one pass.
function read() {
  const s = readSettingsSafe();
  const perms = s.permissions || {};
  const mode = s.defaultMode || s.permissionMode || '';
  return {
    model: typeof s.model === 'string' ? s.model : '',
    effortLevel: typeof s.effortLevel === 'string' ? s.effortLevel : '',
    // Normalize the legacy spelling for display without rewriting the file.
    defaultMode: mode === 'default' ? 'manual' : mode,
    permissions: {
      allow: Array.isArray(perms.allow) ? perms.allow.slice() : [],
      ask: Array.isArray(perms.ask) ? perms.ask.slice() : [],
      deny: Array.isArray(perms.deny) ? perms.deny.slice() : [],
    },
    env: s.env && typeof s.env === 'object' && !Array.isArray(s.env) ? { ...s.env } : {},
    // Read-only context for the UI.
    language: typeof s.language === 'string' ? s.language : '',
    hasStatusLine: !!s.statusLine,
  };
}

// Sets (or clears, when value is empty) one of the simple scalar settings.
function setScalar(key, value) {
  const v = value == null ? '' : String(value);
  if (key === 'effortLevel' && v && !EFFORT_LEVELS.includes(v)) {
    throw new Error('Unknown effort level: ' + v);
  }
  if (key === 'defaultMode' && v && !PERMISSION_MODES.includes(v)) {
    throw new Error('Unknown permission mode: ' + v);
  }
  if (key === 'model' && v.length > 120) throw new Error('Model id too long');
  if (!['model', 'effortLevel', 'defaultMode'].includes(key)) {
    throw new Error('Not an editable setting: ' + key);
  }
  const s = readSettingsSafe();
  if (v) s[key] = v;
  else delete s[key];
  writeSettings(s);
  return v;
}

// Pure: inserts a rule into a bucket, removing it from the other two so a rule
// can never be simultaneously allowed and denied (Claude Code resolves that in a
// fixed order, which makes the config a lie about what it does).
function applyPermission(permissions, bucket, rule) {
  const out = {
    allow: (permissions.allow || []).slice(),
    ask: (permissions.ask || []).slice(),
    deny: (permissions.deny || []).slice(),
  };
  for (const b of PERMISSION_BUCKETS) {
    out[b] = out[b].filter((r) => r !== rule);
  }
  out[bucket].push(rule);
  out[bucket].sort((a, b) => a.localeCompare(b));
  return out;
}

function addPermission(bucket, rule) {
  if (!PERMISSION_BUCKETS.includes(bucket)) throw new Error('Unknown permission bucket');
  const r = String(rule || '').trim();
  if (!isValidRule(r)) throw new Error('Invalid permission rule: ' + r);
  const s = readSettingsSafe();
  s.permissions = applyPermission(s.permissions || {}, bucket, r);
  writeSettings(s);
  return r;
}

function removePermission(bucket, rule) {
  if (!PERMISSION_BUCKETS.includes(bucket)) throw new Error('Unknown permission bucket');
  const s = readSettingsSafe();
  const perms = s.permissions || {};
  if (!Array.isArray(perms[bucket])) return false;
  const before = perms[bucket].length;
  perms[bucket] = perms[bucket].filter((r) => r !== rule);
  if (perms[bucket].length === before) return false;
  if (!perms[bucket].length) delete perms[bucket];
  if (!Object.keys(perms).length) delete s.permissions;
  else s.permissions = perms;
  writeSettings(s);
  return true;
}

// Environment variables Claude Code exports into every session.
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function setEnv(name, value) {
  const n = String(name || '').trim();
  if (!ENV_NAME_RE.test(n) || !isSafeKey(n)) throw new Error('Invalid environment variable name');
  const s = readSettingsSafe();
  if (!s.env || typeof s.env !== 'object' || Array.isArray(s.env)) s.env = {};
  s.env[n] = String(value == null ? '' : value);
  writeSettings(s);
  return n;
}

function removeEnv(name) {
  const s = readSettingsSafe();
  if (!s.env || !(name in s.env)) return false;
  delete s.env[name];
  if (!Object.keys(s.env).length) delete s.env;
  writeSettings(s);
  return true;
}

// Removes an MCP server from the global settings. Returns the config that was
// removed so the caller can offer an undo.
function removeMcpServer(name) {
  const s = readSettingsSafe();
  if (!s.mcpServers || !(name in s.mcpServers)) return null;
  const removed = s.mcpServers[name];
  delete s.mcpServers[name];
  if (!Object.keys(s.mcpServers).length) delete s.mcpServers;
  writeSettings(s);
  return removed;
}

// The catalogue plus every MCP server currently configured, since
// `mcp__<server>` is the rule people most often need and can least often spell.
// `taken` marks what is already in some bucket, so the picker can say so.
function ruleCatalog(mcpNames, taken) {
  const used = new Set(taken || []);
  const out = RULE_CATALOG.map((r) => ({ ...r, taken: used.has(r.rule) }));
  for (const name of mcpNames || []) {
    const rule = 'mcp__' + String(name).replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!isValidRule(rule)) continue;
    out.push({ id: 'mcp:' + name, rule, group: 'mcp', label: name, taken: used.has(rule) });
  }
  return out;
}

module.exports = {
  read,
  ruleCatalog,
  RULE_CATALOG,
  setScalar,
  addPermission,
  removePermission,
  setEnv,
  removeEnv,
  removeMcpServer,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  PERMISSION_BUCKETS,
  MODEL_PRESETS,
  // exported for unit tests
  isValidRule,
  applyPermission,
};
