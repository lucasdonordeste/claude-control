'use strict';

// Health checks over the local Claude Code setup.
//
// The premise: most Claude Code misconfiguration fails *silently*. A settings.json
// with a trailing comma is ignored wholesale; a hook pointing at a deleted script
// never fires; an MCP server that lost its OAuth just stops appearing; two skills
// with the same name shadow each other with no warning. None of that surfaces
// anywhere — you only notice when something you rely on quietly stopped working.
//
// Every finding is returned as data, not prose: { id, severity, category, key,
// args, … } where `key` is an i18n key the webview formats. That keeps the checks
// testable and the wording localizable.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CLAUDE_DIR,
  SETTINGS_PATH,
  HOOKS_DIR,
  fileExists,
  dirExists,
  readSettingsSafe,
} = require('./settings');
const { projectPaths } = require('./project');
const registry = require('./registry');

const SEV = { error: 0, warn: 1, info: 2 };

// --- secret detection ---------------------------------------------------------

// Prefixes that are unambiguously credentials in the wild. A value carrying one
// of these is reported regardless of where it sits.
const SECRET_PREFIXES = [
  'sk-', 'sk_', 'pk_', 'rk_', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'github_pat_',
  'xoxb-', 'xoxp-', 'xoxa-', 'AIza', 'AKIA', 'ASIA', 'glpat-', 'npm_', 'msy_',
  'shppa_', 'shpat_', 'SG.', 'pcsk_', 'dop_v1_', 'sbp_', 'hf_', 'anthropic-',
];
// Key names that mean "this holds a credential" even when the value looks bland.
const SECRET_KEY_RE = /(^|[-_.])(token|secret|password|passwd|apikey|api_key|access_key|private_key|credential|authorization|auth)($|[-_.])/i;
// Values that are obviously not a live secret.
const PLACEHOLDER_RE = /^(\s*|<[^>]*>|\$\{[^}]*\}|%[A-Z_]+%|change ?me|your[-_ ]?\w*|xxx+|todo|null|none|test|example)$/i;

// Pure: does this key/value pair look like a real credential sitting in plaintext?
function looksSecret(key, value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || PLACEHOLDER_RE.test(v)) return false;
  if (v.startsWith('${') || v.startsWith('$')) return false; // already indirected
  const bearer = /^Bearer\s+(\S+)$/i.exec(v);
  const probe = bearer ? bearer[1] : v;
  if (SECRET_PREFIXES.some((p) => probe.startsWith(p))) return true;
  if (!SECRET_KEY_RE.test(String(key))) return false;
  // Key says "secret" — treat a long, unbroken, mixed-case/digit run as one.
  return probe.length >= 16 && !/\s/.test(probe) && /[0-9]/.test(probe) && /[A-Za-z]/.test(probe);
}

// Show enough to recognise which credential it is, never enough to use it.
function maskSecret(v) {
  const s = String(v);
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

// Pure: walks a parsed config object and yields every plaintext credential with
// its dotted path, e.g. `mcpServers.clickup.env.CLICKUP_API_TOKEN`.
function findSecrets(obj, basePath) {
  const out = [];
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, trail.concat('[' + i + ']')));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      const next = trail.concat(k);
      if (typeof v === 'string') {
        if (looksSecret(k, v)) {
          // `segments` is the authoritative address: a dotted string is ambiguous
          // here because real keys contain dots (~/.claude.json keys projects by
          // absolute path, e.g. `projects./Users/me/app.mcpServers.…`).
          out.push({
            segments: next.slice(),
            path: next.join('.'),
            key: k,
            masked: maskSecret(v),
            length: v.length,
          });
        }
      } else {
        walk(v, next);
      }
    }
  };
  walk(obj, basePath ? [basePath] : []);
  return out;
}

// --- hook script resolution ---------------------------------------------------

// Pure: pulls candidate script paths out of a hook command line. Hook commands
// range from a bare quoted path to a full shell guard, so we take every token
// that looks like a filesystem path and let the caller test them.
function hookScriptPaths(command) {
  const cmd = String(command || '');
  const found = new Set();
  // quoted paths first — they survive spaces
  for (const m of cmd.matchAll(/["']([^"']+)["']/g)) {
    const p = m[1];
    if (/^(~|\/|\$HOME|%USERPROFILE%|[A-Za-z]:\\)/.test(p)) found.add(p);
  }
  // then bare tokens
  for (const m of cmd.matchAll(/(?:^|\s)((?:~|\/|\$HOME|%USERPROFILE%)[^\s"';|&]+)/g)) {
    found.add(m[1]);
  }
  return [...found].filter((p) => /\.(sh|bash|zsh|ps1|py|js|mjs|cjs|rb|pl)$/i.test(p) || /hooks?[\\/]/i.test(p));
}

function expandPath(p) {
  let s = String(p);
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  s = s.replace(/\$HOME/g, os.homedir()).replace(/%USERPROFILE%/g, os.homedir());
  return s.replace(/\\/g, path.sep);
}

// A command that tests for the script before running it (`[ -x … ]`, `Test-Path`)
// is *designed* to tolerate the file being absent — a missing script there is
// informational, not a fault.
function isGuarded(command) {
  return /\[\s*-[fxe]\s|Test-Path|command -v|which\s/.test(String(command || ''));
}

// --- individual checks --------------------------------------------------------

function checkJsonValid(files) {
  const out = [];
  for (const f of files) {
    if (!fileExists(f.path)) continue;
    try {
      JSON.parse(fs.readFileSync(f.path, 'utf8'));
    } catch (e) {
      out.push({
        id: 'json:' + f.path,
        severity: 'error',
        category: 'config',
        key: 'doc.badJson',
        args: [f.label],
        detailKey: 'doc.badJson.detail',
        detailArgs: [String(e.message || e).slice(0, 120)],
        file: f.path,
        fix: { action: 'open', path: f.path },
      });
    }
  }
  return out;
}

function checkSecrets(files) {
  const out = [];
  for (const f of files) {
    if (!fileExists(f.path)) continue;
    let j;
    try {
      j = JSON.parse(fs.readFileSync(f.path, 'utf8'));
    } catch (e) {
      continue; // reported by checkJsonValid
    }
    for (const s of findSecrets(j)) {
      out.push({
        id: 'secret:' + f.path + ':' + s.path,
        severity: 'warn',
        category: 'security',
        // ~/.claude.json keys per-project config by absolute path, so a secret
        // under `projects.<path>.…` belongs to that project, not to this one.
        // Recording the owner is what lets the panel scope the list.
        owner: ownerOf(s.segments) || f.owner || '',
        key: 'doc.secret',
        // The title gets the short address (a ~/.claude.json path key can be
        // 80 characters on its own); the full one goes in the detail line.
        args: [compactPath(s.segments), f.label],
        detailKey: 'doc.secret.detail',
        detailArgs: [s.masked, s.path],
        file: f.path,
        fix: {
          action: 'fixSecret',
          path: f.path,
          segments: s.segments,
          jsonPath: s.path,
          envName: envNameFor(s),
        },
      });
    }
  }
  return out;
}

// Which project a JSON address belongs to, or '' when it is global config.
// Only `projects.<absolute path>.…` in ~/.claude.json is project-owned.
function ownerOf(segments) {
  const s = segments || [];
  return s.length >= 2 && s[0] === 'projects' && path.isAbsolute(String(s[1])) ? String(s[1]) : '';
}

// The last few segments of a JSON address — enough to recognise which entry it
// is without printing an absolute path that dominates the card.
function compactPath(segments) {
  const parts = segments || [];
  return parts.length <= 3 ? parts.join('.') : '…' + parts.slice(-3).join('.');
}

// Env var name to suggest when indirecting a secret out of a config file.
function envNameFor(s) {
  const raw = String(s.key || 'SECRET').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return /^[A-Z]/.test(raw) ? raw : 'CLAUDE_' + raw;
}

function checkHooks() {
  const out = [];
  const hooks = readSettingsSafe().hooks || {};
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of groups || []) {
      for (const hk of (g && g.hooks) || []) {
        const cmd = hk && hk.command;
        if (!cmd) continue;
        const guarded = isGuarded(cmd);
        for (const cand of hookScriptPaths(cmd)) {
          const abs = expandPath(cand);
          if (fileExists(abs)) {
            // exists — is it runnable? (POSIX only; Windows has no x-bit)
            if (process.platform !== 'win32' && /\.(sh|bash|zsh|py|rb|pl)$/i.test(abs)) {
              let mode = 0;
              try {
                mode = fs.statSync(abs).mode;
              } catch (e) {
                /* ignore */
              }
              if (mode && !(mode & 0o111)) {
                out.push({
                  id: 'hookmode:' + event + ':' + abs,
                  severity: 'warn',
                  category: 'hooks',
                  key: 'doc.hookNotExec',
                  args: [event, path.basename(abs)],
                  detailKey: 'doc.hookNotExec.detail',
                  detailArgs: [abs],
                  fix: { action: 'chmodHook', path: abs },
                });
              }
            }
          } else {
            out.push({
              id: 'hookmissing:' + event + ':' + abs,
              severity: guarded ? 'info' : 'warn',
              category: 'hooks',
              key: 'doc.hookMissing',
              args: [event, path.basename(abs)],
              detailKey: guarded ? 'doc.hookMissing.guarded' : 'doc.hookMissing.detail',
              detailArgs: [abs],
              fix: { action: 'open', path: SETTINGS_PATH },
            });
          }
        }
      }
    }
  }
  return out;
}

function checkMcpAuth() {
  const out = [];
  const f = path.join(CLAUDE_DIR, 'mcp-needs-auth-cache.json');
  if (!fileExists(f)) return out;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return out;
  }
  // The cache maps server name -> truthy marker (shape has varied across
  // versions), so treat any truthy entry as "this one needs a login".
  for (const [name, v] of Object.entries(j || {})) {
    if (!v) continue;
    out.push({
      id: 'mcpauth:' + name,
      severity: 'warn',
      category: 'mcp',
      key: 'doc.mcpAuth',
      args: [name],
      detailKey: 'doc.mcpAuth.detail',
      detailArgs: [name],
      fix: { action: 'mcpLogin', name },
    });
  }
  return out;
}

// Two skills (or agents, or commands) answering to the same name: only one wins,
// and which one is not obvious.
function checkShadowed(lists) {
  const out = [];
  for (const [kind, items] of Object.entries(lists)) {
    const byName = new Map();
    for (const it of items || []) {
      const n = String(it.name || '').toLowerCase();
      if (!n) continue;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(it);
    }
    for (const [n, group] of byName) {
      if (group.length < 2) continue;
      out.push({
        id: 'shadow:' + kind + ':' + n,
        severity: 'info',
        category: 'primitives',
        key: 'doc.shadowed',
        args: [group[0].name, kind, group.length],
        detailKey: 'doc.shadowed.detail',
        detailArgs: [group.map((g) => g.path).join('  •  ')],
        fix: { action: 'open', path: group[0].path },
      });
    }
  }
  return out;
}

function checkVersions() {
  const out = [];
  const sessions = registry.listSessions();
  const versions = [...new Set(sessions.filter((s) => s.alive && s.version).map((s) => s.version))];
  if (versions.length > 1) {
    out.push({
      id: 'ver:mixed',
      severity: 'info',
      category: 'version',
      key: 'doc.mixedVersions',
      args: [versions.join(', ')],
      detailKey: 'doc.mixedVersions.detail',
      detailArgs: [],
    });
  }
  // Claude Code records the outcome of its own last self-update; a failure there
  // means the CLI is pinned to an old build and nothing told the user.
  const f = path.join(CLAUDE_DIR, '.last-update-result.json');
  if (fileExists(f)) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && j.outcome && j.outcome !== 'success') {
        out.push({
          id: 'ver:updatefail',
          severity: 'warn',
          category: 'version',
          key: 'doc.updateFailed',
          args: [String(j.version_from || '?'), String(j.version_to || '?')],
          detailKey: 'doc.updateFailed.detail',
          detailArgs: [String(j.error_code || j.status || '')],
        });
      }
    } catch (e) {
      /* ignore */
    }
  }
  return out;
}

function checkStaleSessions() {
  const stale = registry.staleSessionFiles();
  if (stale.length < 3) return []; // a couple is normal churn
  return [
    {
      id: 'stale:sessions',
      severity: 'info',
      category: 'cleanup',
      key: 'doc.staleSessions',
      args: [stale.length],
      detailKey: 'doc.staleSessions.detail',
      detailArgs: [],
      fix: { action: 'cleanStaleSessions' },
    },
  ];
}

// Notification hooks that reference our own scripts but whose scripts are gone,
// or flag files left behind — the reason the sound/notify switches can look
// enabled while doing nothing.
function checkNotifyIntegrity() {
  const out = [];
  const s = readSettingsSafe();
  const hooks = s.hooks || {};
  const ours = (event, needle) =>
    ((hooks[event] || []).some((g) =>
      ((g && g.hooks) || []).some((h) => String(h.command || '').includes(needle))
    ));
  const soundHook = ours('Stop', 'stop.');
  const notifyHook = ours('Notification', 'notify.');
  if ((hooks.Stop || hooks.Notification) && !soundHook && !notifyHook) {
    out.push({
      id: 'notify:foreign',
      severity: 'info',
      category: 'hooks',
      key: 'doc.notifyForeign',
      args: [],
      detailKey: 'doc.notifyForeign.detail',
      detailArgs: [],
      fix: { action: 'installHooks' },
    });
  }
  if (!dirExists(HOOKS_DIR) && (soundHook || notifyHook)) {
    out.push({
      id: 'notify:nodir',
      severity: 'warn',
      category: 'hooks',
      key: 'doc.notifyNoDir',
      args: [],
      detailKey: 'doc.notifyNoDir.detail',
      detailArgs: [HOOKS_DIR],
      fix: { action: 'installHooks' },
    });
  }
  return out;
}

// --- entry point --------------------------------------------------------------

// Runs every check. `ctx` supplies the already-computed primitive lists so we
// don't walk the plugin cache twice per refresh.
function run(ctx) {
  ctx = ctx || {};
  const roots = ctx.roots || [];
  const files = [
    { label: 'settings.json', path: SETTINGS_PATH },
    { label: 'settings.local.json', path: path.join(CLAUDE_DIR, 'settings.local.json') },
    { label: '.claude.json', path: path.join(os.homedir(), '.claude.json') },
  ];
  for (const r of roots) {
    const p = projectPaths(r);
    const tag = path.basename(r);
    // These belong to a project, but to *this* one — they are never filtered out.
    files.push({ label: tag + '/.claude/settings.json', path: p.settings, owner: r });
    files.push({ label: tag + '/.claude/settings.local.json', path: p.settingsLocal, owner: r });
    files.push({ label: tag + '/.mcp.json', path: p.mcp, owner: r });
  }

  let findings = [];
  const safely = (fn, ...args) => {
    try {
      findings = findings.concat(fn(...args) || []);
    } catch (e) {
      // One broken check must never take the whole panel down.
      findings.push({
        id: 'check:failed:' + (fn.name || 'anon'),
        severity: 'info',
        category: 'internal',
        key: 'doc.checkFailed',
        args: [fn.name || '?'],
        detailKey: 'doc.checkFailed.detail',
        detailArgs: [String(e.message || e).slice(0, 100)],
      });
    }
  };

  safely(checkJsonValid, files);
  safely(checkSecrets, files);
  safely(checkHooks);
  safely(checkMcpAuth);
  safely(checkNotifyIntegrity);
  safely(checkShadowed, {
    skill: ctx.skills || [],
    agent: ctx.agents || [],
    command: ctx.commands || [],
  });
  safely(checkVersions);
  safely(checkStaleSessions);

  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.id.localeCompare(b.id));

  // Project scope keeps global findings (they affect every session) and this
  // project's, and drops the ones that demonstrably belong to another project —
  // on a machine with many projects those are pure noise here.
  const mine = new Set(roots.map((r) => path.resolve(r)));
  const inScope = (f) => !f.owner || mine.has(path.resolve(f.owner));
  const hiddenByScope = ctx.projectScope ? findings.filter((f) => !inScope(f)).length : 0;
  const shown = ctx.projectScope ? findings.filter(inScope) : findings;

  const counts = { error: 0, warn: 0, info: 0 };
  shown.forEach((f) => counts[f.severity]++);
  return {
    findings: shown,
    counts,
    hiddenByScope,
    checkedFiles: files.filter((f) => fileExists(f.path)).length,
  };
}

// --- disk usage (on demand; walking ~/.claude can be slow) ---------------------

const CLEANABLE = [
  { key: 'projects', dir: 'projects', safe: false },
  { key: 'shell-snapshots', dir: 'shell-snapshots', safe: true },
  { key: 'paste-cache', dir: 'paste-cache', safe: true },
  { key: 'image-cache', dir: 'image-cache', safe: true },
  { key: 'file-history', dir: 'file-history', safe: true },
  { key: 'telemetry', dir: 'telemetry', safe: true },
  { key: 'backups', dir: 'backups', safe: true },
  { key: 'debug', dir: 'debug', safe: true },
  { key: 'session-env', dir: 'session-env', safe: true },
];

function dirSize(dir, budget) {
  let total = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    if (files > budget) return { bytes: total, files, partial: true };
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        files++;
        try {
          total += fs.statSync(full).size;
        } catch (err) {
          /* vanished mid-walk */
        }
      }
    }
  }
  return { bytes: total, files, partial: false };
}

// Sizes of the reclaimable directories under ~/.claude, one per tick so a large
// history never freezes the UI. cb(list) once done.
function diskUsage(cb, opts) {
  opts = opts || {};
  const budget = opts.fileBudget || 60000;
  const out = [];
  const todo = CLEANABLE.slice();
  const step = () => {
    const item = todo.shift();
    if (!item) return cb(out.sort((a, b) => b.bytes - a.bytes));
    const full = path.join(CLAUDE_DIR, item.dir);
    if (dirExists(full)) {
      const r = dirSize(full, budget);
      out.push({ key: item.key, dir: full, safe: item.safe, ...r });
    }
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

module.exports = {
  run,
  diskUsage,
  CLEANABLE,
  // exported for unit tests
  looksSecret,
  maskSecret,
  findSecrets,
  hookScriptPaths,
  expandPath,
  isGuarded,
  envNameFor,
  compactPath,
  checkShadowed,
};
