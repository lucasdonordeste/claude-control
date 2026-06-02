// Claude Control — sidebar panel (Webview) for Cursor / VS Code.
// Rich HTML/CSS UI (media/), data sourced from ~/.claude (global) and the open
// folder (project). User-facing strings are localized via src/i18n.
const vscode = require('vscode');
const crypto = require('crypto');
const nodePath = require('path');
const claude = require('./src/claude');
const i18n = require('./src/i18n');
const { usageStyle } = require('./src/statusbar');
const session = require('./src/session');
const t = i18n.t;

// Poll cadence for plan usage. 60s keeps us under the endpoint's rate limit (the
// value changes slowly), and we also refresh on demand and when the panel opens.
const POLL_MS = 60000;

function activate(context) {
  const provider = new ControlViewProvider(context);
  currentProvider = provider;

  // status bar (plan usage) — two items (session | week); clicking opens the panel
  statusBarSession = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarWeek = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusBarContext = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  statusBarSession.command = 'claudeControlView.focus';
  statusBarWeek.command = 'claudeControlView.focus';
  statusBarContext.command = 'claudeControlView.focus';
  updateStatusBar();

  const pollTimer = setInterval(() => {
    if (statusBarEnabled() || (provider.view && provider.view.visible)) refreshUsage();
  }, POLL_MS);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeControlView', provider),
    vscode.commands.registerCommand('claudeControl.refresh', () => provider.post()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.post()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeControl.statusBar')) {
        if (statusBarEnabled() && !lastUsage) refreshUsage();
        else updateStatusBar();
      }
    }),
    statusBarSession,
    statusBarWeek,
    statusBarContext,
    { dispose: () => clearInterval(pollTimer) }
  );

  refreshUsage(); // first read
}

function projectRoots() {
  return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
}

// Asks for a name + scope (global/project) when scaffolding a skill/agent/command.
// Returns { name, scope, root } or null if the user cancels. `what` is a localized noun.
async function askNameAndScope(what) {
  const name = await vscode.window.showInputBox({
    prompt: t('input.name', what),
    placeHolder: t('input.namePlaceholder'),
  });
  if (!name) return null;
  const roots = projectRoots();
  let scope = 'global';
  if (roots.length) {
    const globalLabel = t('pick.scopeGlobal');
    const pick = await vscode.window.showQuickPick([globalLabel, t('pick.scopeProject')], {
      placeHolder: t('pick.scopeWhere', what),
    });
    if (!pick) return null;
    scope = pick === globalLabel ? 'global' : 'project';
  }
  return { name, scope, root: roots[0] };
}

// Hook events supported by Claude Code (for "New hook").
const HOOK_EVENTS = [
  'Stop',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact',
];

// Curated list of popular MCP servers for "Add MCP". Descriptions are localized
// via the i18n key `mcp.<name>`.
const CURATED_MCP = [
  { name: 'filesystem', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<path>'] } },
  { name: 'github', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<token>' } } },
  { name: 'fetch', config: { command: 'uvx', args: ['mcp-server-fetch'] } },
  { name: 'memory', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  { name: 'sequential-thinking', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] } },
  { name: 'puppeteer', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } },
  { name: 'playwright', config: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  { name: 'context7', config: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } },
];

function baseName(p) {
  return nodePath.basename(p) || p;
}

function openDoc(p) {
  vscode.workspace.openTextDocument(vscode.Uri.file(p)).then(
    (doc) => vscode.window.showTextDocument(doc),
    () => vscode.window.showErrorMessage('Could not open: ' + p)
  );
}

// ---- status bar (plan usage at the bottom of Cursor/VS Code) ----
// Two adjacent items: each value gets its own color (a status-bar item allows
// only one color, so session and week are separate items).
let statusBarSession = null;
let statusBarWeek = null;
let statusBarContext = null;
let currentProvider = null;
let lastUsage = undefined; // undefined = loading, null = unavailable, {} = data
let lastSession = null; // { model, tokens, window } from the active transcript

function statusBarEnabled() {
  return vscode.workspace.getConfiguration('claudeControl').get('statusBar.enabled', true);
}
function statusBarShow(key, def) {
  return vscode.workspace.getConfiguration('claudeControl').get('statusBar.' + key, def);
}

function statusBarColorMode() {
  return vscode.workspace.getConfiguration('claudeControl').get('statusBar.colorMode', 'adaptive');
}
function statusBarCustomColor() {
  return vscode.workspace.getConfiguration('claudeControl').get('statusBar.customColor', '');
}

// Color a usage item per the user's colorMode setting. The decision is a pure
// function (src/statusbar); here we just map it onto the VS Code API.
function applyUsageStyle(item, pct) {
  const { color, background } = usageStyle(statusBarColorMode(), pct, statusBarCustomColor());
  item.color = color || undefined;
  item.backgroundColor = background ? new vscode.ThemeColor(background) : undefined;
}

// Mini consumption bar with fractional (eighths) blocks: even 3% shows a sliver.
function usageBar(pct, cells) {
  const eighths = ['░', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
  const filled = Math.round((p / 100) * cells * 8);
  let out = '';
  for (let i = 0; i < cells; i++) {
    const take = Math.max(0, Math.min(8, filled - i * 8));
    out += take === 8 ? '█' : eighths[take];
  }
  return out;
}

// Time left until reset (e.g. "3h12m"). Kept in sync with the copy in media/main.js.
function leftTime(iso) {
  if (!iso) return '';
  try {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    if (s <= 0) return '';
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    return hh ? `${hh}h${String(mm).padStart(2, '0')}m` : `${mm}m`;
  } catch (e) {
    return '';
  }
}

// e.g. 237350 -> "237k", 1000000 -> "1M"; small values stay as-is.
function kTokens(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return String(+(n / 1000000).toFixed(1)).replace(/\.0$/, '') + 'M';
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
}

function updateStatusBar() {
  if (!statusBarSession || !statusBarWeek || !statusBarContext) return;
  const hideAll = () => {
    statusBarSession.hide();
    statusBarWeek.hide();
    statusBarContext.hide();
  };
  if (!statusBarEnabled()) return hideAll();

  const u = lastUsage;
  const fh = (u && u.five_hour) || {};
  const sd = (u && u.seven_day) || {};
  const s = fh.utilization;
  const w = sd.utilization;

  // tooltip shared by the 5h/7d items
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${t('scope.usage')}**\n\n`);
  if (s != null) {
    const lt = leftTime(fh.resets_at);
    md.appendMarkdown(
      `${t('usage.sessionTrend')}: **${Math.round(s)}%**` +
        (lt ? ` · ${t('tooltip.resetsIn', lt)}` : '') +
        '\n\n'
    );
  }
  if (w != null) md.appendMarkdown(`${t('usage.weekTrend')}: **${Math.round(w)}%**`);

  if (s != null && statusBarShow('show5h', true)) {
    statusBarSession.text = `5h ${usageBar(s, 6)} ${Math.round(s)}%`;
    applyUsageStyle(statusBarSession, s);
    statusBarSession.tooltip = md;
    statusBarSession.show();
  } else {
    statusBarSession.hide();
  }

  if (w != null && statusBarShow('show7d', true)) {
    statusBarWeek.text = `7d ${usageBar(w, 6)} ${Math.round(w)}%`;
    applyUsageStyle(statusBarWeek, w);
    statusBarWeek.tooltip = md;
    statusBarWeek.show();
  } else {
    statusBarWeek.hide();
  }

  const cs = lastSession;
  if (cs && cs.tokens > 0 && statusBarShow('showContext', true)) {
    const pct = Math.round((cs.tokens / (cs.window || 200000)) * 100);
    statusBarContext.text = `ctx:${kTokens(cs.tokens)}/${kTokens(cs.window)} ${pct}%`;
    applyUsageStyle(statusBarContext, pct);
    const cmd = new vscode.MarkdownString();
    cmd.appendMarkdown(`**${t('usage.context')}**\n\n`);
    if (cs.model) cmd.appendMarkdown(`${t('usage.model')}: **${cs.model}**\n\n`);
    if (cs.tier) cmd.appendMarkdown(`${t('usage.tier')}: **${cs.tier}**\n\n`);
    if (cs.slug) {
      cmd.appendMarkdown(`${t('usage.sessionName')}: **${cs.slug}**${cs.branch ? ' · ' + cs.branch : ''}\n\n`);
    }
    cmd.appendMarkdown(`${kTokens(cs.tokens)} / ${kTokens(cs.window)} (${pct}%)`);
    if (cs.sessionCount > 1) cmd.appendMarkdown(`\n\n${t('usage.multiSession', cs.sessionCount)}`);
    statusBarContext.tooltip = cmd;
    statusBarContext.show();
  } else {
    statusBarContext.hide();
  }
}

// Single source of usage: updates the status bar and pushes to the panel (if open).
function refreshUsage() {
  try {
    lastSession = session.sessionForRoots(projectRoots());
  } catch (e) {
    lastSession = null; // reading the transcript is best-effort
  }
  claude.getUsage((usage, state) => {
    lastUsage = usage;
    // panel first: a render error in the status bar must never take down the panel
    if (currentProvider) currentProvider.pushUsage(usage, claude.readUsageHistory(), state, lastSession);
    try {
      updateStatusBar();
    } catch (e) {
      /* status-bar render never takes down the rest */
    }
  });
}

// Builds the data model sent to the webview.
function buildModel(version) {
  const ready = claude.hooksReady();
  const global = {
    sound: !claude.flagOff('sound'),
    notify: !claude.flagOff('notify'),
    soundReady: ready.sound,
    notifyReady: ready.notify,
    statusBar: statusBarEnabled(),
    show5h: statusBarShow('show5h', true),
    show7d: statusBarShow('show7d', true),
    showContext: statusBarShow('showContext', true),
    colorMode: statusBarColorMode(),
    customColor: statusBarCustomColor(),
    settingsPath: claude.SETTINGS_PATH,
    plugins: claude
      .listPlugins()
      .map((p) => ({ key: p.key, name: p.key.split('@')[0], enabled: p.enabled })),
    marketplace: claude.listMarketplacePlugins().filter((p) => !p.installed),
    skills: claude.listSkills(),
    agents: claude.listAgents(),
    commands: claude.listCommands(),
    mcp: claude.listMcp(),
    hooks: claude.listAllHooks(),
  };

  const projects = projectRoots().map((root) => {
    const p = claude.projectPaths(root);
    return {
      name: baseName(root),
      root,
      files: [
        claude.fileExists(p.claudeMd) && { label: 'CLAUDE.md', path: p.claudeMd, kind: 'doc' },
        claude.fileExists(p.settings) && { label: 'settings.json', path: p.settings, kind: 'json' },
        claude.fileExists(p.settingsLocal) && {
          label: 'settings.local.json',
          path: p.settingsLocal,
          kind: 'json',
        },
      ].filter(Boolean),
      commands: claude.dirExists(p.commands) ? claude.listMarkdown(p.commands) : [],
      skills: claude.dirExists(p.skills) ? claude.listProjectSkills(root) : [],
      agents: claude.dirExists(p.agents) ? claude.listMarkdown(p.agents) : [],
      mcp: claude.listProjectMcp(root),
    };
  });

  return {
    global,
    projects,
    version: version || '',
    pollSeconds: Math.round(POLL_MS / 1000),
    i18n: i18n.bundle(),
  };
}

class ControlViewProvider {
  constructor(context) {
    this.context = context;
    this.version = (context.extension && context.extension.packageJSON.version) || '';
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidChangeVisibility(() => {
      if (view.visible) this.post();
    });
    this.post();
  }

  post() {
    if (!this.view) return;
    try {
      this.view.webview.postMessage({ type: 'data', model: buildModel(this.version) });
    } catch (e) {
      this.view.webview.postMessage({ type: 'error', message: String(e.message || e) });
    }
    // plan usage (async, cached) — updates panel + status bar
    refreshUsage();
  }

  pushUsage(usage, history, state, sess) {
    if (this.view) {
      this.view.webview.postMessage({
        type: 'usage',
        usage,
        history: history || [],
        state,
        session: sess || null,
      });
    }
  }

  async onMessage(msg) {
    try {
      switch (msg.type) {
        case 'ready':
        case 'refresh':
          this.post();
          break;
        case 'toggleSound':
          claude.toggleFlag('sound');
          this.post();
          break;
        case 'toggleNotify':
          claude.toggleFlag('notify');
          this.post();
          break;
        case 'toggleStatusBar': {
          const cfg = vscode.workspace.getConfiguration('claudeControl');
          const next = !cfg.get('statusBar.enabled', true);
          await cfg.update('statusBar.enabled', next, vscode.ConfigurationTarget.Global);
          if (next && !lastUsage) refreshUsage();
          else updateStatusBar();
          this.post();
          break;
        }
        case 'toggleStatusItem': {
          const keys = { show5h: true, show7d: true, showContext: true };
          if (msg.key in keys) {
            const cfg = vscode.workspace.getConfiguration('claudeControl');
            const cur = cfg.get('statusBar.' + msg.key, keys[msg.key]);
            await cfg.update('statusBar.' + msg.key, !cur, vscode.ConfigurationTarget.Global);
            updateStatusBar();
          }
          this.post();
          break;
        }
        case 'setColorMode': {
          const modes = ['adaptive', 'usage', 'custom', 'none'];
          if (modes.includes(msg.mode)) {
            await vscode.workspace
              .getConfiguration('claudeControl')
              .update('statusBar.colorMode', msg.mode, vscode.ConfigurationTarget.Global);
            updateStatusBar();
          }
          this.post();
          break;
        }
        case 'setCustomColor': {
          await vscode.workspace
            .getConfiguration('claudeControl')
            .update('statusBar.customColor', msg.value || '', vscode.ConfigurationTarget.Global);
          updateStatusBar();
          this.post();
          break;
        }
        case 'togglePlugin': {
          const enabled = claude.togglePlugin(msg.key);
          this.post();
          vscode.window.showInformationMessage(
            t(
              'msg.pluginToggled',
              msg.key.split('@')[0],
              enabled ? t('state.enabled') : t('state.disabled')
            )
          );
          break;
        }
        case 'open':
          openDoc(msg.path);
          break;

        case 'installHooks': {
          const plat = claude.installNotificationHooks();
          this.post();
          vscode.window.showInformationMessage(t('msg.hooksInstalled', plat));
          break;
        }

        case 'installPlugin': {
          // msg.name / msg.marketplace were validated to a safe charset at the
          // source (listMarketplacePlugins), so they can't carry shell metachars.
          const term = vscode.window.createTerminal(t('term.installPlugin'));
          term.show();
          term.sendText(`claude plugin install ${msg.name}@${msg.marketplace}`);
          vscode.window.showInformationMessage(t('msg.installingPlugin', msg.name));
          break;
        }

        case 'newSkill': {
          const a = await askNameAndScope(t('noun.skill'));
          if (!a) break;
          openDoc(claude.createSkill(a.scope, a.name, a.root));
          this.post();
          break;
        }

        case 'newAgent': {
          const a = await askNameAndScope(t('noun.agent'));
          if (!a) break;
          openDoc(claude.createAgent(a.scope, a.name, a.root));
          this.post();
          break;
        }

        case 'newCommand': {
          const a = await askNameAndScope(t('noun.command'));
          if (!a) break;
          openDoc(claude.createCommand(a.scope, a.name, a.root));
          this.post();
          break;
        }

        case 'addMcp': {
          const items = CURATED_MCP.map((m) => ({
            label: m.name,
            description: t('mcp.' + m.name),
            _mcp: m,
          }));
          const pick = await vscode.window.showQuickPick(items, {
            placeHolder: t('pick.mcpChoose'),
          });
          if (!pick) break;
          let scope = 'global';
          let root;
          const roots = projectRoots();
          if (roots.length) {
            const globalLabel = t('pick.mcpGlobal');
            const sp = await vscode.window.showQuickPick([globalLabel, t('pick.mcpProject')], {
              placeHolder: t('pick.mcpWhere'),
            });
            if (!sp) break;
            if (sp !== globalLabel) {
              scope = 'project';
              root = roots[0];
            }
          }
          const target = claude.addMcpServer(scope, pick._mcp.name, pick._mcp.config, root);
          this.post();
          const open = await vscode.window.showInformationMessage(
            t('msg.mcpAdded', pick._mcp.name),
            t('btn.openConfig')
          );
          if (open) openDoc(target);
          break;
        }

        case 'newHook': {
          const event = await vscode.window.showQuickPick(HOOK_EVENTS, {
            placeHolder: t('pick.hookEvent'),
          });
          if (!event) break;
          const command = await vscode.window.showInputBox({
            prompt: t('input.hookCommand', event),
            placeHolder: t('input.hookCommandPlaceholder'),
          });
          if (!command) break;
          claude.addHook(event, command);
          this.post();
          vscode.window.showInformationMessage(t('msg.hookAdded', event));
          break;
        }

        case 'removeHook': {
          const ok = await vscode.window.showWarningMessage(
            t('prompt.removeHook', msg.event),
            { modal: true },
            t('btn.remove')
          );
          if (ok === t('btn.remove')) {
            claude.removeHook(msg.event, msg.command);
            this.post();
          }
          break;
        }
      }
    } catch (e) {
      vscode.window.showErrorMessage(t('host.err.prefix') + (e.message || e));
    }
  }

  html(webview) {
    const uri = (f) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp =
      `default-src 'none'; img-src ${webview.cspSource} data:; ` +
      `style-src ${webview.cspSource} 'unsafe-inline'; ` +
      `font-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="${i18n.lang()}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${uri('main.css')}" rel="stylesheet" />
</head>
<body>
  <div id="app"><div class="boot">${t('boot.loading')}</div></div>
  <script nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
