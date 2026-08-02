'use strict';

// Hook events and a small library of ready-made hooks.
//
// Writing a hook by hand means knowing the event names, the stdin JSON shape and
// the exit-code protocol, then getting shell quoting right inside a JSON string.
// The templates here collapse that into one click: each one ships a real script
// file (written to ~/.claude/hooks/, the same place our notification hooks live)
// and registers the command that runs it.
//
// Hook contract used by every template:
//   • the hook receives one JSON object on stdin (tool_name, tool_input, cwd, …)
//   • exit 0 = allow, exit 2 = block and show stderr back to Claude
// Scripts are written in Python on POSIX and PowerShell on Windows, because both
// ship with the OS and both can parse the stdin JSON without extra tooling.
const fs = require('fs');
const path = require('path');
const { HOOKS_DIR, readSettingsSafe, writeSettings, isSafeKey } = require('./settings');

// Every event Claude Code fires as of 2.1.x. Ordered by how often people use
// them rather than alphabetically, since this list populates a picker.
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
  'Notification',
  'PermissionRequest',
  'SubagentStart',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'Setup',
  'PreCompact',
  'DirectoryAdded',
];

// Events where a `matcher` (tool-name pattern) is meaningful.
const MATCHER_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
]);

const isWin = () => process.platform === 'win32';

// --- template scripts ---------------------------------------------------------

// Reads the hook payload from stdin and hands it to `body` as `d`. Keeping the
// preamble in one place means a template only expresses its own rule.
function pyScript(body) {
  return (
    '#!/usr/bin/env python3\n' +
    '# Installed by Claude Control. Safe to edit or delete.\n' +
    'import json, os, sys\n' +
    'try:\n' +
    '    d = json.load(sys.stdin)\n' +
    'except Exception:\n' +
    '    sys.exit(0)  # no payload: never block on our own parsing\n' +
    'ti = d.get("tool_input") or {}\n' +
    'tool = d.get("tool_name") or ""\n' +
    'cwd = d.get("cwd") or os.getcwd()\n' +
    body
  );
}

function ps1Script(body) {
  return (
    '# Installed by Claude Control. Safe to edit or delete.\n' +
    '$ErrorActionPreference = "Stop"\n' +
    'try { $d = [Console]::In.ReadToEnd() | ConvertFrom-Json } catch { exit 0 }\n' +
    '$ti = $d.tool_input\n$tool = $d.tool_name\n' +
    '$cwd = if ($d.cwd) { $d.cwd } else { (Get-Location).Path }\n' +
    body
  );
}

const TEMPLATES = [
  {
    id: 'protect-secrets',
    event: 'PreToolUse',
    matcher: 'Read|Edit|Write|Bash',
    severity: 'security',
    py: pyScript(
      'BLOCKED = (".env", ".env.local", ".env.production", "credentials.json",\n'
      + '           ".credentials.json", "id_rsa", "id_ed25519", ".npmrc", ".pypirc")\n'
      + 'target = ti.get("file_path") or ti.get("path") or ti.get("command") or ""\n'
      + 'low = str(target).lower()\n'
      + 'if any(b in low for b in BLOCKED):\n'
      + '    sys.stderr.write(\n'
      + '        "Blocked by Claude Control: %s touches a secrets file. "\n'
      + '        "Ask the user to share the specific value instead.\\n" % tool)\n'
      + '    sys.exit(2)\n'
    ),
    ps1: ps1Script(
      '$blocked = @(".env", ".env.local", "credentials.json", "id_rsa", "id_ed25519", ".npmrc")\n'
      + '$target = if ($ti.file_path) { $ti.file_path } elseif ($ti.command) { $ti.command } else { "" }\n'
      + '$low = "$target".ToLower()\n'
      + 'foreach ($b in $blocked) {\n'
      + '  if ($low.Contains($b)) {\n'
      + '    [Console]::Error.WriteLine("Blocked by Claude Control: $tool touches a secrets file.")\n'
      + '    exit 2\n'
      + '  }\n'
      + '}\n'
    ),
  },
  {
    id: 'guard-outside-repo',
    event: 'PreToolUse',
    matcher: 'Write|Edit|NotebookEdit',
    severity: 'security',
    py: pyScript(
      'p = ti.get("file_path") or ""\n'
      + 'if not p:\n'
      + '    sys.exit(0)\n'
      + 'root = os.path.realpath(cwd)\n'
      + 'target = os.path.realpath(os.path.join(root, p))\n'
      + 'if not (target == root or target.startswith(root + os.sep)):\n'
      + '    sys.stderr.write(\n'
      + '        "Blocked by Claude Control: %s is outside the project (%s).\\n" % (target, root))\n'
      + '    sys.exit(2)\n'
    ),
    ps1: ps1Script(
      '$p = $ti.file_path\n'
      + 'if (-not $p) { exit 0 }\n'
      + '$root = (Resolve-Path $cwd).Path\n'
      + 'try { $target = (Resolve-Path -LiteralPath (Join-Path $root $p) -ErrorAction Stop).Path }\n'
      + 'catch { $target = [System.IO.Path]::GetFullPath((Join-Path $root $p)) }\n'
      + 'if (-not $target.StartsWith($root)) {\n'
      + '  [Console]::Error.WriteLine("Blocked by Claude Control: $target is outside the project.")\n'
      + '  exit 2\n'
      + '}\n'
    ),
  },
  {
    id: 'format-on-edit',
    event: 'PostToolUse',
    matcher: 'Edit|Write|NotebookEdit',
    severity: 'quality',
    py: pyScript(
      'import shutil, subprocess\n'
      + 'p = ti.get("file_path") or ""\n'
      + 'if not p or not os.path.exists(p):\n'
      + '    sys.exit(0)\n'
      + 'ext = os.path.splitext(p)[1].lower()\n'
      + '# (extensions, executable, args) — first formatter that is installed wins.\n'
      + 'RULES = [\n'
      + '    ({".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".scss", ".html", ".md", ".yml", ".yaml"},\n'
      + '     "prettier", ["--write"]),\n'
      + '    ({".py"}, "ruff", ["format"]),\n'
      + '    ({".py"}, "black", []),\n'
      + '    ({".go"}, "gofmt", ["-w"]),\n'
      + '    ({".rs"}, "rustfmt", []),\n'
      + '    ({".rb"}, "rubocop", ["-a"]),\n'
      + ']\n'
      + 'for exts, exe, args in RULES:\n'
      + '    if ext in exts and shutil.which(exe):\n'
      + '        subprocess.run([exe] + args + [p], cwd=cwd,\n'
      + '                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n'
      + '        break\n'
      + '# Formatting is advisory: never fail the turn over it.\n'
      + 'sys.exit(0)\n'
    ),
    ps1: ps1Script(
      '$p = $ti.file_path\n'
      + 'if (-not $p -or -not (Test-Path $p)) { exit 0 }\n'
      + '$ext = [System.IO.Path]::GetExtension($p).ToLower()\n'
      + '$web = @(".js",".jsx",".ts",".tsx",".json",".css",".scss",".html",".md",".yml",".yaml")\n'
      + 'if ($web -contains $ext -and (Get-Command prettier -ErrorAction SilentlyContinue)) {\n'
      + '  & prettier --write $p *> $null\n'
      + '} elseif ($ext -eq ".py" -and (Get-Command black -ErrorAction SilentlyContinue)) {\n'
      + '  & black $p *> $null\n'
      + '}\n'
      + 'exit 0\n'
    ),
  },
  {
    id: 'command-audit',
    event: 'PreToolUse',
    matcher: 'Bash',
    severity: 'audit',
    py: pyScript(
      'from datetime import datetime\n'
      + 'log = os.path.join(os.path.expanduser("~"), ".claude", "command-audit.log")\n'
      + 'cmd = (ti.get("command") or "").replace("\\n", " ")\n'
      + 'if cmd:\n'
      + '    try:\n'
      + '        with open(log, "a", encoding="utf-8") as f:\n'
      + '            f.write("%s\\t%s\\t%s\\n" % (datetime.now().isoformat(timespec="seconds"), cwd, cmd))\n'
      + '    except Exception:\n'
      + '        pass  # a full disk must not block the command\n'
    ),
    ps1: ps1Script(
      '$log = Join-Path $env:USERPROFILE ".claude\\command-audit.log"\n'
      + '$cmd = "$($ti.command)" -replace "`n", " "\n'
      + 'if ($cmd) {\n'
      + '  try { Add-Content -Path $log -Value ("{0}`t{1}`t{2}" -f (Get-Date -Format s), $cwd, $cmd) } catch {}\n'
      + '}\n'
    ),
  },
  {
    id: 'test-on-stop',
    event: 'Stop',
    matcher: '',
    severity: 'quality',
    py: pyScript(
      'import json as _json, subprocess\n'
      + '# Only runs when the project actually declares a test script.\n'
      + 'pkg = os.path.join(cwd, "package.json")\n'
      + 'if not os.path.exists(pkg):\n'
      + '    sys.exit(0)\n'
      + 'try:\n'
      + '    scripts = (_json.load(open(pkg, encoding="utf-8")).get("scripts") or {})\n'
      + 'except Exception:\n'
      + '    sys.exit(0)\n'
      + 'if "test" not in scripts:\n'
      + '    sys.exit(0)\n'
      + 'r = subprocess.run(["npm", "test", "--silent"], cwd=cwd,\n'
      + '                   capture_output=True, text=True)\n'
      + 'if r.returncode != 0:\n'
      + '    tail = (r.stdout + r.stderr)[-1500:]\n'
      + '    sys.stderr.write("Tests are failing after this change:\\n" + tail + "\\n")\n'
      + '    sys.exit(2)\n'
    ),
    ps1: ps1Script(
      '$pkg = Join-Path $cwd "package.json"\n'
      + 'if (-not (Test-Path $pkg)) { exit 0 }\n'
      + '$scripts = (Get-Content $pkg -Raw | ConvertFrom-Json).scripts\n'
      + 'if (-not $scripts.test) { exit 0 }\n'
      + '$out = & npm test --silent 2>&1\n'
      + 'if ($LASTEXITCODE -ne 0) {\n'
      + '  [Console]::Error.WriteLine("Tests are failing after this change:`n" + ($out -join "`n"))\n'
      + '  exit 2\n'
      + '}\n'
    ),
  },
  {
    id: 'session-log',
    event: 'SessionStart',
    matcher: '',
    severity: 'audit',
    py: pyScript(
      'from datetime import datetime\n'
      + 'log = os.path.join(os.path.expanduser("~"), ".claude", "session-log.tsv")\n'
      + 'src = d.get("source") or ""\n'
      + 'try:\n'
      + '    with open(log, "a", encoding="utf-8") as f:\n'
      + '        f.write("%s\\t%s\\t%s\\n" % (datetime.now().isoformat(timespec="seconds"), cwd, src))\n'
      + 'except Exception:\n'
      + '    pass\n'
    ),
    ps1: ps1Script(
      '$log = Join-Path $env:USERPROFILE ".claude\\session-log.tsv"\n'
      + 'try { Add-Content -Path $log -Value ("{0}`t{1}`t{2}" -f (Get-Date -Format s), $cwd, $d.source) } catch {}\n'
    ),
  },
];

function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

// Metadata for the picker. Wording lives in i18n under `hooktpl.<id>` /
// `hooktpl.<id>.desc`, so this stays language-free.
function listTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    event: t.event,
    matcher: t.matcher,
    severity: t.severity,
  }));
}

function scriptName(id) {
  return isWin() ? `cc-${id}.ps1` : `cc-${id}.py`;
}

// The command that runs an installed template. `~` is used on POSIX (Claude Code
// runs hooks through a shell, which expands it) and %USERPROFILE% on Windows, so
// the settings file stays portable between machines with different home paths.
function templateCommand(id) {
  const name = scriptName(id);
  return isWin()
    ? `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.claude\\hooks\\${name}"`
    : `python3 "$HOME/.claude/hooks/${name}"`;
}

// Pure: adds a hook to a settings object without clobbering existing entries and
// without stacking a duplicate of the same command. Returns true if it changed.
function addHookTo(settings, event, matcher, command) {
  if (!isSafeKey(event)) throw new Error('Invalid hook event');
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[event]) settings.hooks[event] = [];
  const groups = settings.hooks[event];
  const already = groups.some((g) => ((g && g.hooks) || []).some((h) => h.command === command));
  if (already) return false;
  const entry = { hooks: [{ type: 'command', command }] };
  if (matcher && MATCHER_EVENTS.has(event)) entry.matcher = matcher;
  groups.push(entry);
  return true;
}

// Writes the template's script and registers it. Returns
// { installed, alreadyInstalled, script, command, event }.
function installTemplate(id) {
  const t = templateById(id);
  if (!t) throw new Error('Unknown hook template: ' + id);
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const file = path.join(HOOKS_DIR, scriptName(id));
  fs.writeFileSync(file, isWin() ? t.ps1 : t.py);
  if (!isWin()) {
    try {
      fs.chmodSync(file, 0o755);
    } catch (e) {
      /* the command invokes python3 explicitly, so the x-bit is a nicety */
    }
  }
  const command = templateCommand(id);
  const s = readSettingsSafe();
  const changed = addHookTo(s, t.event, t.matcher, command);
  if (changed) writeSettings(s);
  return {
    installed: changed,
    alreadyInstalled: !changed,
    script: file,
    command,
    event: t.event,
  };
}

// Which templates are already registered, so the UI can show them as installed.
function installedTemplates() {
  const hooks = readSettingsSafe().hooks || {};
  const all = new Set();
  for (const groups of Object.values(hooks)) {
    for (const g of groups || []) {
      for (const h of (g && g.hooks) || []) all.add(String(h.command || ''));
    }
  }
  return TEMPLATES.filter((t) => all.has(templateCommand(t.id))).map((t) => t.id);
}

module.exports = {
  HOOK_EVENTS,
  MATCHER_EVENTS,
  listTemplates,
  templateById,
  installTemplate,
  installedTemplates,
  templateCommand,
  scriptName,
  // exported for unit tests
  addHookTo,
  TEMPLATES,
};
