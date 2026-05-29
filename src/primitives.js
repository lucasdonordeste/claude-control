// Config CRUD surface: plugins, marketplace, MCP servers, hooks (incl. the
// cross-platform notification hook scripts), and skill/agent/command discovery
// and scaffolding.
const fs = require('fs');
const path = require('path');
const {
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
function listMcp() {
  return Object.keys(readSettingsSafe().mcpServers || {}).sort();
}

// --- skills (SKILL.md from plugins + the user's own) ---
function listSkills() {
  const out = [];
  collectSkills(path.join(CLAUDE_DIR, 'plugins', 'cache'), out);
  collectSkills(path.join(CLAUDE_DIR, 'skills'), out);
  return dedupeByName(out).sort(byName);
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
function listAllHooks() {
  const hooks = readSettingsSafe().hooks || {};
  const out = [];
  for (const event of Object.keys(hooks)) {
    (hooks[event] || []).forEach((group) => {
      const matcher = group.matcher || '';
      (group.hooks || []).forEach((hk) => {
        out.push({ event, matcher, command: hk.command || hk.type || '(?)' });
      });
    });
  }
  return out;
}
function addHook(event, command) {
  if (!isSafeKey(event)) throw new Error('Invalid hook event');
  const s = readSettingsSafe();
  if (!s.hooks) s.hooks = {};
  if (!s.hooks[event]) s.hooks[event] = [];
  s.hooks[event].push({ hooks: [{ type: 'command', command }] });
  writeSettings(s);
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
// Appends a command hook for `event` without clobbering existing user hooks, and
// without stacking a duplicate of our own command on re-runs.
function appendHookGroup(s, event, command) {
  if (!s.hooks) s.hooks = {};
  if (!s.hooks[event]) s.hooks[event] = [];
  const exists = s.hooks[event].some((g) =>
    (g.hooks || []).some((h) => h.command === command)
  );
  if (!exists) s.hooks[event].push({ hooks: [{ type: 'command', command }] });
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
  appendHookGroup(s, 'Stop', sc.stopCmd);
  appendHookGroup(s, 'Notification', sc.notifyCmd);
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

function createSkill(scope, name, root) {
  const slug = slugify(name);
  const dir = path.join(scaffoldDir(scope, root, 'skills'), slug);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  if (!fileExists(file)) {
    fs.writeFileSync(
      file,
      `---\nname: ${slug}\ndescription: Use when ... (describe when this skill should trigger)\n---\n\n# ${name}\n\nSkill instructions go here.\n`
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
      `---\nname: ${slug}\ndescription: Use this agent when ... (when to dispatch this subagent)\ntools: \n---\n\nYou are a specialized subagent. Describe the goal, the step-by-step, and the response format here.\n`
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
      `---\ndescription: What this command does\n---\n\nInstructions for the /${slug} command. Use $ARGUMENTS to receive arguments.\n`
    );
  }
  return file;
}

// --- agents / commands discovery: user-level + any folder named <kind> in plugins ---
function collectPrimitive(kind) {
  const out = [];
  const pushMd = (dir) =>
    walkFiles(dir, {
      maxDepth: 8,
      match: (n) => n.toLowerCase().endsWith('.md'),
      onFile: (full, name) => out.push(parseFrontmatter(full, name.replace(/\.md$/i, ''))),
    });
  pushMd(path.join(CLAUDE_DIR, kind));
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
      const full = path.join(dir, e.name);
      if (e.name === kind) pushMd(full);
      else findKindDirs(full, depth + 1);
    }
  };
  findKindDirs(path.join(CLAUDE_DIR, 'plugins', 'cache'), 0);
  return dedupeByName(out).sort(byName);
}
function listAgents() {
  return collectPrimitive('agents');
}
function listCommands() {
  return collectPrimitive('commands');
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
  // exported for unit tests
  slugify,
};
