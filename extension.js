// Claude Control — sidebar panel (Webview) for Cursor / VS Code.
// Rich HTML/CSS UI (media/), data sourced from ~/.claude (global) and the open
// folder (project). User-facing strings are localized via src/i18n.
const vscode = require('vscode');
const crypto = require('crypto');
const nodePath = require('path');
const fs = require('fs');
const { CLAUDE_DIR } = require('./src/settings');
const claude = require('./src/claude');
const i18n = require('./src/i18n');
const { usageStyle } = require('./src/statusbar');
const session = require('./src/session');
const t = i18n.t;

// Poll cadence for plan usage. 60s keeps us under the endpoint's rate limit (the
// value changes slowly), and we also refresh on demand and when the panel opens.
const POLL_MS = 60000;
// The live view reacts faster than the plan gauges: a session going from "busy"
// to "waiting for you" is only useful if you hear about it promptly. Reading the
// registry is a handful of small JSON files, so this stays cheap.
const LIVE_POLL_MS = 4000;
// How many status-bar slots to reserve for per-session context gauges.
const MAX_STATUS_SESSIONS = 3;

function activate(context) {
  const provider = new ControlViewProvider(context);
  currentProvider = provider;

  statusBarSession = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarWeek = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusBarSessions = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  statusBarSession.command = 'claudeControlView.focus';
  statusBarWeek.command = 'claudeControlView.focus';
  statusBarSessions.command = 'claudeControl.showLive';
  statusBarContexts = [];
  for (let i = 0; i < MAX_STATUS_SESSIONS; i++) {
    const it = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96 - i);
    it.command = 'claudeControl.showLive';
    statusBarContexts.push(it);
  }
  updateStatusBar();

  const pollTimer = setInterval(() => {
    if (statusBarEnabled() || (provider.view && provider.view.visible)) refreshUsage();
  }, POLL_MS);
  const liveTimer = setInterval(() => {
    if (statusBarEnabled() || (provider.view && provider.view.visible)) refreshLive();
  }, LIVE_POLL_MS);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeControlView', provider),
    vscode.commands.registerCommand('claudeControl.refresh', () => provider.post()),
    vscode.commands.registerCommand('claudeControl.showLive', async () => {
      await vscode.commands.executeCommand('claudeControlView.focus');
      provider.showTab('live');
    }),
    vscode.commands.registerCommand('claudeControl.doctor', async () => {
      await vscode.commands.executeCommand('claudeControlView.focus');
      provider.showTab('doctor');
    }),
    vscode.commands.registerCommand('claudeControl.metrics', async () => {
      await vscode.commands.executeCommand('claudeControlView.focus');
      provider.showTab('metrics');
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.post()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeControl')) {
        if (statusBarEnabled() && !lastUsage) refreshUsage();
        else updateStatusBar();
        provider.post();
      }
    }),
    statusBarSession,
    statusBarWeek,
    statusBarSessions,
    ...statusBarContexts,
    { dispose: () => clearInterval(pollTimer) },
    { dispose: () => clearInterval(liveTimer) }
  );

  // Watch the to-do/task files so the "working on" view updates live (event-driven,
  // debounced) without shortening the poll. Recursive watch is macOS/Windows only;
  // on Linux it throws and we just rely on the poll.
  let taskDebounce = null;
  const onTasksChanged = () => {
    clearTimeout(taskDebounce);
    taskDebounce = setTimeout(() => refreshLive(), 700);
  };
  try {
    const watcher = fs.watch(nodePath.join(CLAUDE_DIR, 'tasks'), { recursive: true }, onTasksChanged);
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch (e) {
    /* no recursive watch on this platform — the poll covers it */
  }

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

// ---- status bar (plan usage + live sessions) ----
let statusBarSession = null;
let statusBarWeek = null;
let statusBarSessions = null;
let statusBarContexts = [];
let currentProvider = null;
let lastUsage = undefined; // undefined = loading, null = unavailable, {} = data
let lastState = '';
let lastLive = { groups: [], sessions: [], total: 0, waiting: 0, agents: 0 };
// Sessions we have already alerted about, so a session sitting on a question
// doesn't re-notify every 4 seconds. Cleared when it stops waiting.
const notifiedWaiting = new Set();

function cfg(key, def) {
  return vscode.workspace.getConfiguration('claudeControl').get(key, def);
}
function statusBarEnabled() {
  return cfg('statusBar.enabled', true);
}
function statusBarShow(key, def) {
  return cfg('statusBar.' + key, def);
}

// Color a usage item per the user's colorMode setting. The decision is a pure
// function (src/statusbar); here we just map it onto the VS Code API.
function applyUsageStyle(item, pct) {
  const { color, background } = usageStyle(cfg('statusBar.colorMode', 'adaptive'), pct, cfg('statusBar.customColor', ''));
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

// Time left until reset (e.g. "3h12m"). Kept in sync with the copy in media/ui.js.
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
  if (!statusBarSession || !statusBarWeek) return;
  const hideAll = () => {
    statusBarSession.hide();
    statusBarWeek.hide();
    statusBarSessions.hide();
    statusBarContexts.forEach((it) => it.hide());
  };
  if (!statusBarEnabled()) return hideAll();

  const u = lastUsage;
  const fh = (u && u.five_hour) || {};
  const sd = (u && u.seven_day) || {};
  const s = fh.utilization;
  const w = sd.utilization;

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${t('scope.usage')}**\n\n`);
  if (s != null) {
    const lt = leftTime(fh.resets_at);
    md.appendMarkdown(
      `${t('usage.sessionTrend')}: **${Math.round(s)}%**` + (lt ? ` · ${t('tooltip.resetsIn', lt)}` : '') + '\n\n'
    );
  }
  if (w != null) md.appendMarkdown(`${t('usage.weekTrend')}: **${Math.round(w)}%**`);

  if (s != null && statusBarShow('show5h', true)) {
    statusBarSession.text = `5h ${usageBar(s, 6)} ${Math.round(s)}%`;
    applyUsageStyle(statusBarSession, s);
    statusBarSession.tooltip = md;
    statusBarSession.show();
  } else statusBarSession.hide();

  if (w != null && statusBarShow('show7d', true)) {
    statusBarWeek.text = `7d ${usageBar(w, 6)} ${Math.round(w)}%`;
    applyUsageStyle(statusBarWeek, w);
    statusBarWeek.tooltip = md;
    statusBarWeek.show();
  } else statusBarWeek.hide();

  updateSessionStatusItems();
}

// The live half of the status bar: an at-a-glance count of what Claude Code is
// doing across every project, plus one context gauge per session in this one.
function updateSessionStatusItems() {
  const live = lastLive || { sessions: [], total: 0, waiting: 0, agents: 0 };

  if (statusBarShow('showSessions', true) && live.total) {
    const bits = [`$(pulse) ${live.total}`];
    if (live.agents) bits.push(`$(type-hierarchy) ${live.agents}`);
    if (live.waiting) bits.push(`$(bell-dot) ${live.waiting}`);
    statusBarSessions.text = bits.join(' ');
    statusBarSessions.backgroundColor = live.waiting
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${t('scope.live')}**\n\n`);
    for (const s of live.sessions.slice(0, 8)) {
      const state = s.waiting ? `⧗ ${t('status.waiting')}` : t('status.' + s.status);
      md.appendMarkdown(`- ${s.project} · **${s.title || s.name || s.sessionId.slice(0, 8)}** — ${state}\n`);
    }
    if (live.waiting) md.appendMarkdown(`\n${t('live.waitingBanner', live.waiting)}`);
    statusBarSessions.tooltip = md;
    statusBarSessions.show();
  } else {
    statusBarSessions.hide();
  }

  // per-session context gauges, current project first
  const mine = (live.sessions || []).filter((s) => s.isWorkspace).slice(0, MAX_STATUS_SESSIONS);
  const showCtx = statusBarShow('showContext', true);
  const multi = mine.length > 1;
  statusBarContexts.forEach((item, i) => {
    const cs = mine[i];
    if (!showCtx || !cs || !(cs.tokens > 0)) return item.hide();
    const win = cs.window || 200000;
    const pct = Math.round((cs.tokens / win) * 100);
    const label = multi ? 'S' + (i + 1) : 'ctx';
    item.text = `${label}:${kTokens(cs.tokens)}/${kTokens(win)} ${pct}%`;
    applyUsageStyle(item, pct);
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${t('usage.context')}${multi ? ' · S' + (i + 1) : ''}**\n\n`);
    if (cs.model) md.appendMarkdown(`${t('usage.model')}: **${cs.model}**\n\n`);
    if (cs.title) md.appendMarkdown(`${cs.title}${cs.branch ? ' · ' + cs.branch : ''}\n\n`);
    if (cs.tasks && cs.tasks.doing) md.appendMarkdown(`${t('usage.working')}: **${cs.tasks.doing}**\n\n`);
    md.appendMarkdown(`${kTokens(cs.tokens)} / ${kTokens(win)} (${pct}%)`);
    item.tooltip = md;
    item.show();
  });
}

// ---- live sessions ----
// Reads the registry, enriches each session with its transcript state and
// subagent tree, and groups by project with the open workspace first.
function collectLive() {
  const roots = projectRoots();
  const wanted = new Set(roots.map((r) => nodePath.resolve(r)));
  const entries = claude.registry.liveSessions();
  const onlyProject = cfg('live.onlyCurrentProject', false);
  const list = [];
  for (const s of session.allSessions(roots, { entries })) {
    const isWorkspace = wanted.has(nodePath.resolve(s.cwd));
    if (onlyProject && !isWorkspace) continue;
    let agents = [];
    try {
      const info = session.readSessionInfo(session.transcriptPath(s.cwd, s.sessionId));
      agents = claude.agentTree(s.cwd, s.sessionId, {
        answeredIds: info ? info.answeredIds : [],
      });
    } catch (e) {
      agents = []; // a malformed subagent dir must not hide the session
    }
    list.push({ ...s, isWorkspace, agents });
  }
  const groups = claude.registry.groupByProject(list, roots).map((g) => ({
    name: g.name,
    root: g.root,
    isWorkspace: g.isWorkspace,
    sessions: g.sessions,
  }));
  return {
    groups,
    sessions: list,
    total: list.length,
    waiting: list.filter((s) => s.waiting).length,
    agents: list.reduce((n, s) => n + claude.runningAgents(s.agents), 0),
  };
}

// Tells the user when a session starts waiting on them — the whole point of
// watching sessions you are not looking at.
function alertWaiting(live) {
  if (!cfg('alertWaiting', true)) return;
  const waitingNow = new Set();
  for (const s of live.sessions) {
    if (!s.waiting) continue;
    waitingNow.add(s.sessionId);
    if (notifiedWaiting.has(s.sessionId)) continue;
    notifiedWaiting.add(s.sessionId);
    const label = s.title || s.name || s.project;
    vscode.window
      .showWarningMessage(
        t('notify.waiting', s.project, label) + (s.question ? ` — ${s.question}` : ''),
        t('btn.reveal')
      )
      .then((pick) => {
        if (pick === t('btn.reveal')) vscode.commands.executeCommand('claudeControl.showLive');
      });
  }
  // A session that answered its question becomes eligible to alert again.
  for (const id of [...notifiedWaiting]) if (!waitingNow.has(id)) notifiedWaiting.delete(id);
}

function refreshLive() {
  try {
    lastLive = collectLive();
  } catch (e) {
    lastLive = { groups: [], sessions: [], total: 0, waiting: 0, agents: 0 };
  }
  alertWaiting(lastLive);
  if (currentProvider) currentProvider.pushUsage();
  try {
    updateStatusBar();
  } catch (e) {
    /* status-bar render never takes down the rest */
  }
}

// Single source of usage: updates the status bar and pushes to the panel.
function refreshUsage() {
  try {
    lastLive = collectLive();
  } catch (e) {
    lastLive = { groups: [], sessions: [], total: 0, waiting: 0, agents: 0 };
  }
  alertWaiting(lastLive);
  claude.getUsage((usage, state) => {
    lastUsage = usage;
    lastState = state;
    // panel first: a render error in the status bar must never take down the panel
    if (currentProvider) currentProvider.pushUsage();
    try {
      updateStatusBar();
    } catch (e) {
      /* status-bar render never takes down the rest */
    }
  });
}

// Burn rate for both plan windows, derived from the history we already keep.
function currentBurn(history) {
  const u = lastUsage || {};
  const fh = u.five_hour || {};
  const sd = u.seven_day || {};
  const at = (iso) => {
    const ms = iso ? Date.parse(iso) : NaN;
    return isNaN(ms) ? null : ms;
  };
  const now = Date.now();
  return {
    five: claude.metrics.burnRate(history, 's', fh.utilization, now, at(fh.resets_at)),
    week: claude.metrics.burnRate(history, 'w', sd.utilization, now, at(sd.resets_at)),
  };
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
    showSessions: statusBarShow('showSessions', true),
    alertWaiting: cfg('alertWaiting', true),
    colorMode: cfg('statusBar.colorMode', 'adaptive'),
    customColor: cfg('statusBar.customColor', ''),
    settingsPath: claude.SETTINGS_PATH,
    plugins: claude.listPlugins().map((p) => ({ key: p.key, name: p.key.split('@')[0], enabled: p.enabled })),
    marketplace: claude.listMarketplacePlugins().filter((p) => !p.installed),
    skills: claude.listSkills(),
    agents: claude.listAgents(),
    commands: claude.listCommands(),
    plans: claude.listPlans(),
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
        claude.fileExists(p.settingsLocal) && { label: 'settings.local.json', path: p.settingsLocal, kind: 'json' },
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
    config: claude.config.read(),
    modelPresets: claude.config.MODEL_PRESETS,
    effortLevels: claude.config.EFFORT_LEVELS,
    permissionModes: claude.config.PERMISSION_MODES,
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

  // Focusing the view may be what *creates* it, in which case the webview isn't
  // listening yet — hold the request and replay it once it resolves.
  showTab(tab) {
    if (this.view) this.view.webview.postMessage({ type: 'showTab', tab });
    else this.pendingTab = tab;
  }

  post() {
    if (!this.view) return;
    try {
      this.view.webview.postMessage({ type: 'data', model: buildModel(this.version) });
    } catch (e) {
      this.view.webview.postMessage({ type: 'error', message: String(e.message || e) });
    }
    refreshUsage();
  }

  pushUsage() {
    if (!this.view) return;
    const history = claude.readUsageHistory();
    this.view.webview.postMessage({
      type: 'usage',
      usage: lastUsage,
      history,
      state: lastState,
      burn: currentBurn(history),
      live: lastLive,
    });
  }

  sendMetrics() {
    claude.metrics.collect({ days: cfg('metrics.days', 30) }, (report) => {
      if (report && this.view) this.view.webview.postMessage({ type: 'metrics', report });
    });
  }

  sendDoctor() {
    if (!this.view) return;
    const report = claude.doctor.run({
      roots: projectRoots(),
      skills: claude.listSkills(),
      agents: claude.listAgents(),
      commands: claude.listCommands(),
    });
    this.view.webview.postMessage({ type: 'doctor', report });
  }

  // Runs a shell command in a dedicated terminal, optionally in a given cwd.
  runInTerminal(name, command, cwd) {
    const term = vscode.window.createTerminal({ name, cwd: cwd || undefined });
    term.show();
    term.sendText(command);
    return term;
  }

  async onMessage(msg) {
    try {
      await this.handle(msg);
    } catch (e) {
      vscode.window.showErrorMessage(t('host.err.prefix') + (e.message || e));
    }
  }

  async handle(msg) {
    const roots = projectRoots();
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        this.post();
        if (this.pendingTab) {
          this.showTab(this.pendingTab);
          this.pendingTab = null;
        }
        break;

      case 'needMetrics':
        this.sendMetrics();
        break;
      case 'needDoctor':
        this.sendDoctor();
        break;

      case 'scanDisk':
        claude.doctor.diskUsage((disk) => {
          if (this.view) this.view.webview.postMessage({ type: 'disk', disk });
        });
        break;

      case 'setFilter':
        await vscode.workspace
          .getConfiguration('claudeControl')
          .update('live.onlyCurrentProject', !!msg.onlyProject, vscode.ConfigurationTarget.Global);
        refreshLive();
        break;

      // ---- toggles -----------------------------------------------------------
      case 'toggleSound':
        claude.toggleFlag('sound');
        this.post();
        break;
      case 'toggleNotify':
        claude.toggleFlag('notify');
        this.post();
        break;
      case 'toggleAlertWaiting':
        await this.flip('alertWaiting', true);
        break;
      case 'toggleStatusBar': {
        const next = await this.flip('statusBar.enabled', true, true);
        if (next && !lastUsage) refreshUsage();
        else updateStatusBar();
        break;
      }
      case 'toggleStatusItem': {
        const keys = { show5h: true, show7d: true, showContext: true, showSessions: true };
        if (msg.key in keys) {
          await this.flip('statusBar.' + msg.key, keys[msg.key], true);
          updateStatusBar();
        }
        break;
      }
      case 'setColorMode':
        if (['adaptive', 'usage', 'custom', 'none'].includes(msg.mode)) {
          await this.set('statusBar.colorMode', msg.mode);
          updateStatusBar();
        }
        break;
      case 'setCustomColor':
        await this.set('statusBar.customColor', msg.value || '');
        updateStatusBar();
        break;

      // ---- Claude Code settings ---------------------------------------------
      case 'setModel':
      case 'setEffort':
      case 'setDefaultMode': {
        const key = { setModel: 'model', setEffort: 'effortLevel', setDefaultMode: 'defaultMode' }[msg.type];
        const cur = claude.config.read()[key];
        // Clicking the active segment clears it, so there is a way back to
        // "let Claude Code decide" without hand-editing JSON.
        claude.config.setScalar(key, cur === msg.value ? '' : msg.value);
        this.post();
        vscode.window.showInformationMessage(t('msg.settingSaved', key));
        break;
      }

      case 'addPermission': {
        const rule = await vscode.window.showInputBox({
          prompt: t('input.permRule', t('perm.' + msg.bucket)),
          placeHolder: t('input.permRulePlaceholder'),
          validateInput: (v) =>
            !v || claude.config.isValidRule(v.trim()) ? null : t('input.permRuleInvalid'),
        });
        if (!rule) break;
        claude.config.addPermission(msg.bucket, rule.trim());
        this.post();
        break;
      }
      case 'removePermission':
        claude.config.removePermission(msg.bucket, msg.rule);
        this.post();
        break;

      case 'addEnv': {
        const name = await vscode.window.showInputBox({
          prompt: t('input.envName'),
          placeHolder: 'MY_API_HOST',
          validateInput: (v) => (!v || /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.trim()) ? null : t('input.envNameInvalid')),
        });
        if (!name) break;
        const value = await vscode.window.showInputBox({ prompt: t('input.envValue', name.trim()) });
        if (value == null) break;
        claude.config.setEnv(name.trim(), value);
        this.post();
        break;
      }
      case 'removeEnv':
        claude.config.removeEnv(msg.name);
        this.post();
        break;

      // ---- primitives --------------------------------------------------------
      case 'open':
        openDoc(msg.path);
        break;

      case 'togglePlugin': {
        const enabled = claude.togglePlugin(msg.key);
        this.post();
        vscode.window.showInformationMessage(
          t('msg.pluginToggled', msg.key.split('@')[0], enabled ? t('state.enabled') : t('state.disabled'))
        );
        break;
      }

      case 'installPlugin':
        // msg.name / msg.marketplace were validated to a safe charset at the
        // source (listMarketplacePlugins), so they can't carry shell metachars.
        this.runInTerminal(t('term.installPlugin'), `claude plugin install ${msg.name}@${msg.marketplace}`);
        vscode.window.showInformationMessage(t('msg.installingPlugin', msg.name));
        break;

      case 'installHooks': {
        const plat = claude.installNotificationHooks();
        this.post();
        vscode.window.showInformationMessage(t('msg.hooksInstalled', plat));
        break;
      }

      case 'newSkill':
      case 'newAgent':
      case 'newCommand': {
        const kind = { newSkill: 'skill', newAgent: 'agent', newCommand: 'command' }[msg.type];
        const a = await askNameAndScope(t('noun.' + kind));
        if (!a) break;
        const make = { skill: claude.createSkill, agent: claude.createAgent, command: claude.createCommand }[kind];
        openDoc(make(a.scope, a.name, a.root));
        this.post();
        break;
      }

      case 'addMcp': {
        const items = CURATED_MCP.map((m) => ({ label: m.name, description: t('mcp.' + m.name), _mcp: m }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder: t('pick.mcpChoose') });
        if (!pick) break;
        let scope = 'global';
        let root;
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
        const open = await vscode.window.showInformationMessage(t('msg.mcpAdded', pick._mcp.name), t('btn.openConfig'));
        if (open) openDoc(target);
        break;
      }

      // ---- hooks -------------------------------------------------------------
      case 'newHook': {
        const event = await vscode.window.showQuickPick(claude.hooklib.HOOK_EVENTS, {
          placeHolder: t('pick.hookEvent'),
        });
        if (!event) break;
        let matcher = '';
        if (claude.hooklib.MATCHER_EVENTS.has(event)) {
          matcher =
            (await vscode.window.showInputBox({
              prompt: t('input.hookMatcher', event),
              placeHolder: 'Edit|Write  ·  Bash  ·  *',
            })) || '';
        }
        const command = await vscode.window.showInputBox({
          prompt: t('input.hookCommand', event),
          placeHolder: t('input.hookCommandPlaceholder'),
        });
        if (!command) break;
        claude.addHook(event, command, matcher);
        this.post();
        vscode.window.showInformationMessage(t('msg.hookAdded', event));
        break;
      }

      case 'hookLibrary': {
        const installed = new Set(claude.hooklib.installedTemplates());
        const items = claude.hooklib.listTemplates().map((tpl) => ({
          label: (installed.has(tpl.id) ? '$(check) ' : '') + t('hooktpl.' + tpl.id),
          description: tpl.event + (tpl.matcher ? ' · ' + tpl.matcher : ''),
          detail: t('hooktpl.' + tpl.id + '.desc'),
          _id: tpl.id,
          _installed: installed.has(tpl.id),
        }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder: t('pick.hookTemplate') });
        if (!pick) break;
        if (pick._installed) {
          vscode.window.showInformationMessage(t('msg.hookTplAlready'));
          break;
        }
        const r = claude.hooklib.installTemplate(pick._id);
        this.post();
        const open = await vscode.window.showInformationMessage(
          t('msg.hookTplInstalled', t('hooktpl.' + pick._id), r.event),
          t('btn.openScript')
        );
        if (open) openDoc(r.script);
        break;
      }

      case 'removeHook': {
        const ok = await vscode.window.showWarningMessage(
          t('prompt.removeHook', msg.event),
          { modal: true, detail: msg.command },
          t('btn.remove')
        );
        if (ok === t('btn.remove')) {
          claude.removeHook(msg.event, msg.command);
          this.post();
        }
        break;
      }

      // ---- session actions ---------------------------------------------------
      case 'resumeSession': {
        const cmd = claude.actions.resumeCommand(msg.sid, msg.cwd);
        this.runInTerminal(t('term.resume'), cmd, msg.cwd);
        break;
      }
      case 'openTranscript':
        openDoc(session.transcriptPath(msg.cwd, msg.sid));
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.cwd), {
          forceNewWindow: true,
        });
        break;
      case 'killSession': {
        const pid = Number(msg.pid);
        if (!pid) break;
        const ok = await vscode.window.showWarningMessage(
          t('prompt.killSession', msg.name || pid),
          { modal: true, detail: t('prompt.killSessionDetail', pid) },
          t('btn.stop')
        );
        if (ok !== t('btn.stop')) break;
        try {
          // SIGTERM, not SIGKILL: Claude Code gets to flush its transcript and
          // clean up its registry entry rather than leaving both half-written.
          process.kill(pid, 'SIGTERM');
          vscode.window.showInformationMessage(t('msg.sessionStopped', msg.name || pid));
        } catch (e) {
          vscode.window.showErrorMessage(t('msg.sessionStopFailed', String(e.message || e)));
        }
        setTimeout(() => refreshLive(), 600);
        break;
      }

      // ---- doctor fixes ------------------------------------------------------
      case 'fixSecret': {
        let segments;
        try {
          segments = JSON.parse(msg.segments);
        } catch (e) {
          break;
        }
        const ok = await vscode.window.showWarningMessage(
          t('prompt.fixSecret', msg.env),
          { modal: true, detail: t('prompt.fixSecretDetail', msg.path, msg.env) },
          t('btn.moveIt')
        );
        if (ok !== t('btn.moveIt')) break;
        const r = claude.actions.indirectSecret(msg.path, segments, msg.env);
        if (!r.ok) {
          vscode.window.showWarningMessage(t('msg.fixSecretStale'));
          this.sendDoctor();
          break;
        }
        const line = claude.actions.exportLine(msg.env, r.secret);
        await vscode.env.clipboard.writeText(line);
        this.sendDoctor();
        this.post();
        const act = await vscode.window.showInformationMessage(
          t('msg.secretMoved', msg.env),
          t('btn.openFile')
        );
        if (act) openDoc(msg.path);
        break;
      }
      case 'chmodHook':
        if (claude.actions.makeExecutable(msg.path)) {
          vscode.window.showInformationMessage(t('msg.madeExecutable', baseName(msg.path)));
        }
        this.sendDoctor();
        break;
      case 'mcpLogin':
        this.runInTerminal(t('term.mcpLogin'), claude.actions.mcpLoginCommand(msg.name));
        break;
      case 'cleanStaleSessions': {
        const files = claude.registry.staleSessionFiles();
        const ok = await vscode.window.showWarningMessage(
          t('prompt.cleanStale', files.length),
          { modal: true },
          t('btn.remove')
        );
        if (ok !== t('btn.remove')) break;
        const n = claude.actions.removeStaleSessionFiles(files);
        vscode.window.showInformationMessage(t('msg.staleCleaned', n));
        this.sendDoctor();
        break;
      }
      case 'cleanDir': {
        const ok = await vscode.window.showWarningMessage(
          t('prompt.cleanDir', msg.key),
          { modal: true, detail: t('prompt.cleanDirDetail', msg.size || '', msg.key) },
          t('btn.clean')
        );
        if (ok !== t('btn.clean')) break;
        const r = claude.actions.cleanCacheDir(msg.key);
        vscode.window.showInformationMessage(t('msg.cleaned', r.removed, msg.key));
        claude.doctor.diskUsage((disk) => {
          if (this.view) this.view.webview.postMessage({ type: 'disk', disk });
        });
        break;
      }
      case 'archiveTranscripts': {
        const days = cfg('archive.days', 90);
        const ok = await vscode.window.showWarningMessage(
          t('prompt.archive', days),
          { modal: true, detail: t('prompt.archiveDetail') },
          t('btn.archive')
        );
        if (ok !== t('btn.archive')) break;
        const r = claude.actions.archiveTranscripts(days);
        vscode.window.showInformationMessage(t('msg.archived', r.moved, r.dest));
        claude.doctor.diskUsage((disk) => {
          if (this.view) this.view.webview.postMessage({ type: 'disk', disk });
        });
        break;
      }
    }
  }

  // Small helpers for the VS Code configuration store.
  async set(key, value) {
    await vscode.workspace
      .getConfiguration('claudeControl')
      .update(key, value, vscode.ConfigurationTarget.Global);
  }
  async flip(key, def, skipPost) {
    const next = !cfg(key, def);
    await this.set(key, next);
    if (!skipPost) this.post();
    return next;
  }

  html(webview) {
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp =
      `default-src 'none'; img-src ${webview.cspSource} data:; ` +
      `style-src ${webview.cspSource} 'unsafe-inline'; ` +
      `font-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    // Load order matters: icons define the symbol table, ui the primitives that
    // use them, views the tab bodies, main the state that drives all three.
    const scripts = ['icons.js', 'ui.js', 'views.js', 'main.js']
      .map((f) => `  <script nonce="${nonce}" src="${uri(f)}"></script>`)
      .join('\n');
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
${scripts}
</body>
</html>`;
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
