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
const catalog = require('./catalog');

// Effort levels, cheapest first. `xhigh` and `max` exist but are gated by model,
// so we offer them and let Claude Code decide.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
// The release that stopped a top-level `effortLevel` reaching new models.
const LEGACY_EFFORT_CUTOFF = '2.1.280';

// Permission modes as of 2.1.3xx. "default" was renamed to "manual"; we accept
// the old spelling on read so an existing config still displays correctly.
// `dontAsk` denies anything not pre-approved instead of asking.
const PERMISSION_MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

// With no mode configured, interactive sessions have started in auto since
// 2.1.284 — so "unset" is not "manual", and the panel must not say it is.
const IMPLICIT_MODE = 'auto';

const PERMISSION_BUCKETS = ['allow', 'ask', 'deny'];

// Model aliases Claude Code understands. The `[1m]` variants are gone from the
// list: 1M is the default window on every current model and 2.1.311 dropped
// the suffix from names. Free-form ids are still allowed — this list only
// drives the picker, and labels come from the model catalog when there is one.
const MODEL_PRESETS = ['opus', 'sonnet', 'haiku', 'fable', 'default'];

// Plain behaviour switches Claude Code reads from settings.json, each with the
// value it has when the key is absent. Curated: these change what a session
// does, not how the terminal looks.
const BEHAVIOR_TOGGLES = {
  // Compacts a long session while you are away, so it is ready on return.
  idleCompaction: true,
  // Pull the skills and plugins enabled on claude.ai into terminal sessions.
  syncClaudeAiSkills: true,
  syncClaudeAiPlugins: true,
};

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

function modelSettingsOf(s) {
  const ms = s.modelSettings;
  return ms && typeof ms === 'object' && !Array.isArray(ms) ? ms : {};
}

// Pure: what the effort control is about. Since 2.1.252 `/effort` is saved per
// model under `modelSettings.<id>.effortLevel`, and since 2.1.280 a top-level
// `effortLevel` no longer applies to newly released models — so writing only
// the top-level key, as this panel used to, silently did nothing on Opus 5.5.
function effortState(s, cat) {
  const model = typeof s.model === 'string' ? s.model : '';
  const id = catalog.resolveModel(cat, model);
  const entry = catalog.findModel(cat, id);
  const per = id && modelSettingsOf(s)[id];
  const perLevel = per && typeof per.effortLevel === 'string' ? per.effortLevel : '';
  const legacy = typeof s.effortLevel === 'string' ? s.effortLevel : '';
  // The top-level key still applies to models that predate per-model effort;
  // the ones released after it (2.1.280: "such as Opus 5.5") ignore it.
  const legacyApplies = !!legacy && !(entry && entry.minVersion && catalog.versionAtLeast(entry.minVersion, LEGACY_EFFORT_CUTOFF));
  // Only levels this panel can also write — a catalog level newer than this
  // build would render as a raw key and be refused on click.
  const levels = entry ? entry.effortLevels.filter((l) => EFFORT_LEVELS.includes(l)) : [];
  return {
    effortModelId: id,
    effortModelName: entry ? entry.name : '',
    // Levels this model accepts; the full list when the catalog is silent.
    effortLevels: levels.length ? levels : EFFORT_LEVELS,
    defaultEffort: entry ? entry.defaultEffort : '',
    effortWarnings: entry ? entry.effortWarnings : {},
    // What is in effect: the model's own level, else the global key where it
    // still applies.
    effortLevel: perLevel || (!id || legacyApplies ? legacy : ''),
    effortFromLegacy: !perLevel && (!id || legacyApplies) && !!legacy,
    legacyEffort: legacy,
    legacyIgnored: !!legacy && !!id && !legacyApplies,
  };
}

// Pure: the model picker's options — aliases labelled with what they resolve to
// today ("opus · Opus 5.5"), so choosing one is not a guess.
function modelOptions(cat) {
  return MODEL_PRESETS.map((alias) => {
    const m = catalog.findModel(cat, catalog.resolveModel(cat, alias));
    return { value: alias, name: m ? m.name : '', window: m ? m.window : 0 };
  });
}

function attributionHidden(a) {
  if (a === false) return true;
  // The object form with both texts emptied hides it too.
  return !!(a && typeof a === 'object' && a.commit === '' && a.pr === '');
}

// Everything the Settings tab renders, read in one pass.
function read() {
  const s = readSettingsSafe();
  const perms = s.permissions || {};
  // The real key is `permissions.defaultMode`. Older builds of this panel wrote
  // a top-level `defaultMode`, which Claude Code never read; it is still shown
  // (and migrated on the next change) so the config says what it does.
  const mode = perms.defaultMode || s.defaultMode || s.permissionMode || '';
  const cat = catalog.readCatalog();
  const behavior = {};
  for (const [k, dflt] of Object.entries(BEHAVIOR_TOGGLES)) {
    behavior[k] = typeof s[k] === 'boolean' ? s[k] : dflt;
  }
  return {
    model: typeof s.model === 'string' ? s.model : '',
    modelOptions: modelOptions(cat),
    ...effortState(s, cat),
    // Normalize the legacy spelling for display without rewriting the file.
    defaultMode: mode === 'default' ? 'manual' : mode,
    implicitMode: IMPLICIT_MODE,
    strayMode: !perms.defaultMode && !!(s.defaultMode || s.permissionMode),
    behavior,
    attributionHidden: attributionHidden(s.attribution),
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

// Pure: writes (or clears) the effort for the configured model — per model
// when the model is known, the legacy top-level key otherwise.
function applyEffort(s, value, cat) {
  const id = catalog.resolveModel(cat, s.model);
  if (!id) {
    if (value) s.effortLevel = value;
    else delete s.effortLevel;
    return s;
  }
  const ms = { ...modelSettingsOf(s) };
  const entry = ms[id] && typeof ms[id] === 'object' && !Array.isArray(ms[id]) ? { ...ms[id] } : {};
  if (value) entry.effortLevel = value;
  // Clearing a level that came from the global key (nothing per model) clears
  // that key — otherwise the click would change nothing on screen.
  else if (!entry.effortLevel) delete s.effortLevel;
  else delete entry.effortLevel;
  if (Object.keys(entry).length) ms[id] = entry;
  else delete ms[id];
  if (Object.keys(ms).length) s.modelSettings = ms;
  else delete s.modelSettings;
  return s;
}

// Pure: the permission mode lives under `permissions`; a stray top-level copy
// left by an older build is removed so there is one answer, not two.
function applyMode(s, value) {
  delete s.defaultMode;
  delete s.permissionMode;
  const perms = s.permissions && typeof s.permissions === 'object' ? { ...s.permissions } : {};
  if (value) perms.defaultMode = value;
  else delete perms.defaultMode;
  if (Object.keys(perms).length) s.permissions = perms;
  else delete s.permissions;
  return s;
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
  if (key === 'effortLevel') applyEffort(s, v, catalog.readCatalog());
  else if (key === 'defaultMode') applyMode(s, v);
  else if (v) s[key] = v;
  else delete s[key];
  writeSettings(s);
  return v;
}

// Flips one of BEHAVIOR_TOGGLES. The default value is written as an absent key,
// so the file only ever records a deliberate departure.
function setBehavior(key, on) {
  if (!Object.prototype.hasOwnProperty.call(BEHAVIOR_TOGGLES, key)) {
    throw new Error('Not a behaviour setting: ' + key);
  }
  const s = readSettingsSafe();
  if (!!on === BEHAVIOR_TOGGLES[key]) delete s[key];
  else s[key] = !!on;
  writeSettings(s);
  return !!on;
}

// `"attribution": false` (2.1.281) hides the commit and PR trailers. CLIs older
// than that skip a settings file holding the boolean, so the object form —
// both texts empty — is what we write: it hides the same lines and every
// version reads it.
//
// Hiding replaces whatever was there, so the previous value is returned for the
// caller to keep, and handed back on un-hide to restore — a custom trailer
// survives the round trip instead of being deleted by it.
function setAttributionHidden(hide, restore) {
  const s = readSettingsSafe();
  const prev = s.attribution;
  if (hide) s.attribution = { commit: '', pr: '' };
  else if (restore !== undefined && restore !== null && !attributionHidden(restore)) s.attribution = restore;
  else delete s.attribution;
  writeSettings(s);
  return prev;
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

// Environment switches worth knowing about, offered by the "add variable"
// picker with a suggested value. Descriptions live in i18n under `envcat.<name>`.
const ENV_CATALOG = [
  // Opus 4.8, Sonnet 5, Fable 5 and newer ship without the todo/task tools —
  // which is also what feeds the Live tab's checklist.
  { name: 'CLAUDE_CODE_ENABLE_TODO_TOOLS', value: '1' },
  { name: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', value: '400k' },
  { name: 'CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS', value: '200000' },
  { name: 'CLAUDE_CODE_DISABLE_1M_CONTEXT', value: '1' },
  { name: 'CLAUDE_CODE_SUBAGENT_MODEL', value: 'sonnet' },
  { name: 'CLAUDE_CODE_FORK_SUBAGENT', value: '0' },
  { name: 'CLAUDE_CODE_DISABLE_WEB_FETCH', value: '1' },
];

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
  setBehavior,
  setAttributionHidden,
  addPermission,
  removePermission,
  setEnv,
  removeEnv,
  removeMcpServer,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  PERMISSION_BUCKETS,
  MODEL_PRESETS,
  BEHAVIOR_TOGGLES,
  IMPLICIT_MODE,
  ENV_CATALOG,
  // exported for unit tests
  isValidRule,
  applyPermission,
  applyEffort,
  applyMode,
  effortState,
  modelOptions,
  attributionHidden,
};
