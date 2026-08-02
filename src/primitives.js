// Config CRUD surface: plugins, marketplace, MCP servers, hooks (incl. the
// cross-platform notification hook scripts), and skill/agent/command discovery
// and scaffolding.
const fs = require('fs');
const path = require('path');
const {
  HOME,
  CLAUDE_DIR,
  HOOKS_DIR,
  SETTINGS_PATH,
  isSafeKey,
  fileExists,
  readSettingsSafe,
  writeSettings,
  writeJsonAtomic,
} = require('./settings');
const {
  walkFiles,
  parseFrontmatter,
  collectSkills,
  dedupeByName,
  byName,
  projectPaths,
} = require('./project');
const { addHookTo, templateCommand, TEMPLATES } = require('./hooklib');

// --- plugins ---
function listPlugins() {
  const ep = readSettingsSafe().enabledPlugins || {};
  return Object.keys(ep)
    .sort()
    .map((k) => ({ key: k, enabled: !!ep[k] }));
}
function togglePlugin(key) {
  if (!isSafeKey(key)) throw new Error('Invalid plugin key');
  const s = readSettingsSafe();
  if (!s.enabledPlugins) s.enabledPlugins = {};
  const now = !s.enabledPlugins[key];
  s.enabledPlugins[key] = now;
  writeSettings(s);
  return now;
}

// --- mcp servers ---
// Global MCP servers live in two places depending on how they were added:
// `claude mcp add` writes ~/.claude.json, while settings.json is the documented
// home. Reading only settings.json (as we used to) hid every server the CLI
// registered, which for most users is all of them.
function listMcp() {
  const names = new Map(); // name -> where it is declared
  for (const n of Object.keys(readSettingsSafe().mcpServers || {})) {
    names.set(n, SETTINGS_PATH);
  }
  const dotJson = path.join(HOME, '.claude.json');
  try {
    const j = JSON.parse(fs.readFileSync(dotJson, 'utf8'));
    for (const n of Object.keys((j && j.mcpServers) || {})) {
      if (!names.has(n)) names.set(n, dotJson);
    }
  } catch (e) {
    /* no ~/.claude.json, or unreadable */
  }
  return [...names.entries()]
    .map(([name, file]) => ({ name, file }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- provenance ---------------------------------------------------------------
// Plugins are unpacked to ~/.claude/plugins/cache/<marketplace>/<plugin>/…, so the
// second path segment below the cache root names the plugin a primitive came from.
// Knowing that is what lets the panel say *why* a skill exists — and which copy
// wins when two share a name.
const PLUGIN_CACHE = path.join(CLAUDE_DIR, 'plugins', 'cache');

function pluginSourceFor(full) {
  const rel = path.relative(PLUGIN_CACHE, full);
  if (!rel || rel.startsWith('..')) return '';
  const parts = rel.split(path.sep);
  return parts.length >= 2 ? parts[1] : parts[0] || '';
}

// Interrupted plugin installs leave temp_git_*/temp_subdir_*.clone directories
// behind. Walking them double-lists every primitive of the plugin being updated.
function isTempCache(name) {
  return /^temp_(git|subdir)_/.test(name) || name.endsWith('.clone');
}

function tagSource(list, source) {
  return list.map((x) => ({ ...x, source: source || pluginSourceFor(x.path) || 'user' }));
}

// --- skills (SKILL.md from plugins + the user's own) ---
function listSkills() {
  const fromPlugins = [];
  collectSkills(PLUGIN_CACHE, fromPlugins, { skipDir: isTempCache });
  const own = [];
  collectSkills(path.join(CLAUDE_DIR, 'skills'), own);
  // The user's own skills take precedence on a name clash, so they go first —
  // dedupeByName keeps the first occurrence.
  return dedupeByName(tagSource(own, 'user').concat(tagSource(fromPlugins))).sort(byName);
}

// --- marketplace: plugins available to install ---
// Names/marketplace ids parsed from .claude-plugin/marketplace.json are NOT
// authored by the user; we accept only a safe charset so they can never be
// reinterpreted as shell metacharacters downstream (see installPlugin).
const SAFE_PLUGIN_ID = /^[A-Za-z0-9._-]+$/;
function listMarketplacePlugins() {
  const base = path.join(CLAUDE_DIR, 'plugins', 'marketplaces');
  const enabled = readSettingsSafe().enabledPlugins || {};
  const out = [];
  let mkts;
  try {
    mkts = fs.readdirSync(base, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const m of mkts) {
    if (!m.isDirectory()) continue;
    const file = path.join(base, m.name, '.claude-plugin', 'marketplace.json');
    let j;
    try {
      j = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      continue;
    }
    const mkName = j.name || m.name;
    if (!SAFE_PLUGIN_ID.test(mkName)) continue;
    for (const p of j.plugins || []) {
      const name = typeof p === 'string' ? p : p && p.name;
      if (!name || !SAFE_PLUGIN_ID.test(name)) continue;
      const key = `${name}@${mkName}`;
      out.push({
        name,
        marketplace: mkName,
        key,
        description: (p && p.description) || '',
        installed: key in enabled,
      });
    }
  }
  return out.sort(byName);
}

// --- hooks: list / add / remove ---
// Commands installed by Claude Control get tagged so the panel can show them as
// managed (and offer the matching one-click removal) rather than as opaque shell.
function hookSourceFor(command) {
  for (const t of TEMPLATES) {
    if (command === templateCommand(t.id)) return 'template:' + t.id;
  }
  if (/\b(stop|notify)\.(sh|ps1)\b/.test(command)) return 'notify';
  return '';
}

function listAllHooks() {
  const hooks = readSettingsSafe().hooks || {};
  const out = [];
  for (const event of Object.keys(hooks)) {
    (hooks[event] || []).forEach((group) => {
      const matcher = group.matcher || '';
      (group.hooks || []).forEach((hk) => {
        const command = hk.command || hk.type || '(?)';
        out.push({ event, matcher, command, source: hookSourceFor(command) });
      });
    });
  }
  return out;
}
function addHook(event, command, matcher) {
  const s = readSettingsSafe();
  if (addHookTo(s, event, matcher || '', command)) writeSettings(s);
}
// Removes the specific hook identified by its command (not a positional index),
// so it is robust to the settings changing between render and click and never
// drops a sibling hook in the same group.
function removeHook(event, command) {
  const s = readSettingsSafe();
  const groups = s.hooks && s.hooks[event];
  if (!groups) return;
  for (let gi = 0; gi < groups.length; gi++) {
    const hooks = groups[gi].hooks || [];
    const hi = hooks.findIndex((h) => (h.command || h.type || '') === command);
    if (hi === -1) continue;
    hooks.splice(hi, 1);
    if (!hooks.length) groups.splice(gi, 1);
    if (!groups.length) delete s.hooks[event];
    writeSettings(s);
    return;
  }
}

// --- install sound/notification hooks (cross-platform) ---
function hookScripts(plat) {
  if (plat === 'win32') {
    return {
      files: [
        {
          name: 'stop.ps1',
          content:
            "$flag = Join-Path $env:USERPROFILE '.claude\\hooks\\.sound-off'\n" +
            'if (Test-Path $flag) { exit 0 }\n[console]::beep(880,180)\n',
        },
        {
          name: 'notify.ps1',
          content:
            "$nflag = Join-Path $env:USERPROFILE '.claude\\hooks\\.notify-off'\n" +
            'if (Test-Path $nflag) { exit 0 }\n' +
            'Add-Type -AssemblyName System.Windows.Forms\nAdd-Type -AssemblyName System.Drawing\n' +
            '$ni = New-Object System.Windows.Forms.NotifyIcon\n' +
            '$ni.Icon = [System.Drawing.SystemIcons]::Information\n$ni.Visible = $true\n' +
            "$ni.ShowBalloonTip(4000, 'Claude Code', 'Needs your attention', [System.Windows.Forms.ToolTipIcon]::Info)\n" +
            'Start-Sleep -Milliseconds 4500\n$ni.Dispose()\n',
        },
      ],
      stopCmd:
        'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.claude\\hooks\\stop.ps1"',
      notifyCmd:
        'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.claude\\hooks\\notify.ps1"',
    };
  }
  if (plat === 'darwin') {
    return {
      files: [
        {
          name: 'stop.sh',
          exec: true,
          content:
            '#!/bin/zsh\n[ -f "$HOME/.claude/hooks/.sound-off" ] && exit 0\n' +
            'afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 &\n',
        },
        {
          name: 'notify.sh',
          exec: true,
          content:
            '#!/bin/zsh\n[ -f "$HOME/.claude/hooks/.notify-off" ] && exit 0\n' +
            "osascript -e 'display notification \"Needs your attention\" with title \"Claude Code\" sound name \"Funk\"' >/dev/null 2>&1 &\n",
        },
      ],
      stopCmd: '"$HOME/.claude/hooks/stop.sh"',
      notifyCmd: '"$HOME/.claude/hooks/notify.sh"',
    };
  }
  // linux and other unix
  return {
    files: [
      {
        name: 'stop.sh',
        exec: true,
        content:
          '#!/usr/bin/env bash\n[ -f "$HOME/.claude/hooks/.sound-off" ] && exit 0\n' +
          '( paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null ' +
          '|| aplay -q /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null ) &\n',
      },
      {
        name: 'notify.sh',
        exec: true,
        content:
          '#!/usr/bin/env bash\n[ -f "$HOME/.claude/hooks/.notify-off" ] && exit 0\n' +
          'command -v notify-send >/dev/null 2>&1 && notify-send "Claude Code" "Needs your attention"\n',
      },
    ],
    stopCmd: '"$HOME/.claude/hooks/stop.sh"',
    notifyCmd: '"$HOME/.claude/hooks/notify.sh"',
  };
}
function installNotificationHooks() {
  const plat = process.platform;
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const sc = hookScripts(plat);
  for (const f of sc.files) {
    const p = path.join(HOOKS_DIR, f.name);
    fs.writeFileSync(p, f.content);
    if (f.exec) {
      try {
        fs.chmodSync(p, 0o755);
      } catch (e) {
        /* ignore */
      }
    }
  }
  const s = readSettingsSafe();
  addHookTo(s, 'Stop', '', sc.stopCmd);
  addHookTo(s, 'Notification', '', sc.notifyCmd);
  writeSettings(s);
  return plat;
}

// --- add an MCP server (global -> settings.json, project -> .mcp.json) ---
function addMcpServer(scope, name, config, root) {
  if (!isSafeKey(name)) throw new Error('Invalid MCP server name');
  if (scope === 'project' && root) {
    const mcpPath = projectPaths(root).mcp;
    let j = {};
    if (fileExists(mcpPath)) {
      try {
        j = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
      } catch (e) {
        j = {};
      }
      try {
        fs.copyFileSync(mcpPath, mcpPath + '.bak');
      } catch (e) {
        /* best-effort backup */
      }
    }
    if (!j.mcpServers) j.mcpServers = {};
    j.mcpServers[name] = config;
    writeJsonAtomic(mcpPath, j);
    return mcpPath;
  }
  const s = readSettingsSafe();
  if (!s.mcpServers) s.mcpServers = {};
  s.mcpServers[name] = config;
  writeSettings(s);
  return SETTINGS_PATH;
}

// --- slug + scaffolding ---
function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function scaffoldDir(scope, root, kind) {
  return scope === 'project' && root
    ? path.join(root, '.claude', kind)
    : path.join(CLAUDE_DIR, kind);
}

// The scaffolds below carry the frontmatter Claude Code actually reads in 2.x —
// including the optional keys people most often go looking for — commented out
// so a new file is valid immediately but the options are discoverable.
function createSkill(scope, name, root) {
  const slug = slugify(name);
  const dir = path.join(scaffoldDir(scope, root, 'skills'), slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  if (!fileExists(file)) {
    fs.writeFileSync(
      file,
      `---
name: ${slug}
description: Use when ... — describe the trigger, not the capability. This line is the only thing Claude sees when deciding whether to load the skill, so name the situations, tools and phrasings that should pull it in.
# allowed-tools: Read, Grep, Bash        # restrict what the skill may use
# disable-model-invocation: false        # true = only runnable as /${slug}
---

# ${name}

## When to use this

Concrete situations. Be specific enough that the description above is provable.

## Steps

1. ...
2. ...

## Notes

Put reference material in sibling files and link them — the body is loaded in
full every time the skill triggers, so keep it tight.
`
    );
  }
  return file;
}
function createAgent(scope, name, root) {
  const slug = slugify(name);
  const baseDir = scaffoldDir(scope, root, 'agents');
  fs.mkdirSync(baseDir, { recursive: true });
  const file = path.join(baseDir, slug + '.md');
  if (!fileExists(file)) {
    fs.writeFileSync(
      file,
      `---
name: ${slug}
description: Use this agent when ... — when the main session should delegate to it, and what it returns.
# tools: Read, Grep, Glob, Bash          # omit to inherit every tool
# model: sonnet                          # omit to inherit the session's model
---

You are a specialized subagent.

## Goal

What "done" means for this agent.

## Method

1. ...
2. ...

## Output

Your final message is the return value — the parent sees nothing else. State the
result directly; do not address the user.
`
    );
  }
  return file;
}
function createCommand(scope, name, root) {
  const slug = slugify(name);
  const baseDir = scaffoldDir(scope, root, 'commands');
  fs.mkdirSync(baseDir, { recursive: true });
  const file = path.join(baseDir, slug + '.md');
  if (!fileExists(file)) {
    fs.writeFileSync(
      file,
      `---
description: What this command does (shown in the / picker)
# argument-hint: <file> [--flag]
# allowed-tools: Read, Edit, Bash
# model: sonnet
---

Instructions for /${slug}.

Arguments arrive as $ARGUMENTS (or $1, $2, … positionally).
Shell output can be inlined with !\`command\`, and files with @path/to/file.
`
    );
  }
  return file;
}

// --- agents / commands discovery: user-level + any folder named <kind> in plugins ---
function collectPrimitive(kind) {
  const own = [];
  const fromPlugins = [];
  const pushMd = (dir, sink) =>
    walkFiles(dir, {
      maxDepth: 8,
      match: (n) => n.toLowerCase().endsWith('.md'),
      onFile: (full, name) => sink.push(parseFrontmatter(full, name.replace(/\.md$/i, ''))),
    });
  pushMd(path.join(CLAUDE_DIR, kind), own);
  const findKindDirs = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
      if (isTempCache(e.name)) continue; // half-finished plugin update
      const full = path.join(dir, e.name);
      if (e.name === kind) pushMd(full, fromPlugins);
      else findKindDirs(full, depth + 1);
    }
  };
  findKindDirs(PLUGIN_CACHE, 0);
  // User-level definitions shadow plugin ones, so they must come first for
  // dedupeByName (which keeps the first occurrence) to reflect what wins.
  return dedupeByName(tagSource(own, 'user').concat(tagSource(fromPlugins))).sort(byName);
}
function listAgents() {
  return collectPrimitive('agents');
}
function listCommands() {
  return collectPrimitive('commands');
}

// --- plans (plan-mode docs saved under ~/.claude/plans) ---
function listPlans() {
  const dir = path.join(CLAUDE_DIR, 'plans');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  const out = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const full = path.join(dir, f);
    let name = f.replace(/\.md$/, '');
    let mtime = 0;
    try {
      const head = fs.readFileSync(full, 'utf8').split('\n').find((l) => l.trim().startsWith('#'));
      if (head) name = head.replace(/^#+\s*/, '').trim() || name;
    } catch (e) {
      /* keep filename */
    }
    try {
      mtime = fs.statSync(full).mtimeMs;
    } catch (e) {
      /* ignore */
    }
    out.push({ name, path: full, mtime });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

module.exports = {
  listPlugins,
  togglePlugin,
  listMcp,
  listSkills,
  listMarketplacePlugins,
  listAllHooks,
  addHook,
  removeHook,
  installNotificationHooks,
  addMcpServer,
  createSkill,
  createAgent,
  createCommand,
  listAgents,
  listCommands,
  listPlans,
  // exported for unit tests
  slugify,
};
