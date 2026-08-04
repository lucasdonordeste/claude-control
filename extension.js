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
// The status page is a CDN document and an incident outlives any poll interval;
// src/status.js caches for five minutes, so most of these ticks cost nothing.
const STATUS_POLL_MS = 5 * 60 * 1000;
// How many status-bar slots to reserve for per-session context gauges.
const MAX_STATUS_SESSIONS = 3;

function activate(context) {
  extState = context.globalState;
  const provider = new ControlViewProvider(context);
  currentProvider = provider;

  // The extension can claim six status-bar slots; on a small screen that pushes
  // the branch name off the left side, and VS Code lets a user hide an item but
  // not move it. Losing the gauges to fix a layout problem is the wrong trade.
  const side =
    cfg('statusBar.alignment', 'left') === 'right'
      ? vscode.StatusBarAlignment.Right
      : vscode.StatusBarAlignment.Left;
  statusBarSession = vscode.window.createStatusBarItem(side, 100);
  statusBarWeek = vscode.window.createStatusBarItem(side, 99);
  statusBarSessions = vscode.window.createStatusBarItem(side, 97);
  // Sits ahead of the gauges: when Claude Code itself is degraded, that outranks
  // knowing how much quota is left. It is hidden entirely while things are fine,
  // so it costs nothing in the common case.
  statusBarHealth = vscode.window.createStatusBarItem(side, 101);
  statusBarHealth.command = 'claudeControl.openStatusPage';
  statusBarSession.command = 'claudeControlView.focus';
  statusBarWeek.command = 'claudeControlView.focus';
  statusBarSessions.command = 'claudeControl.showLive';
  statusBarContexts = [];
  for (let i = 0; i < MAX_STATUS_SESSIONS; i++) {
    const it = vscode.window.createStatusBarItem(side, 96 - i);
    it.command = 'claudeControl.showLive';
    statusBarContexts.push(it);
  }
  updateStatusBar();

  const pollTimer = setInterval(() => {
    if (statusBarEnabled() || (provider.view && provider.view.visible)) refreshUsage();
  }, POLL_MS);
  // Unconditional, unlike the usage poll: the whole point is to warn someone who
  // does not have the panel open. src/status.js caches for five minutes and backs
  // off for fifteen after a failure, so this tick is nearly always free.
  refreshStatus();
  const statusTimer = setInterval(refreshStatus, STATUS_POLL_MS);
  // Each tick re-reads every live session's transcript tail and subagent
  // directory, and the mtime cache cannot help an *active* session — which is
  // exactly the one being watched. With several parallel sessions that is real
  // CPU, so the cadence is adjustable in both directions.
  let liveTimer = null;
  const startLiveTimer = () => {
    if (liveTimer) clearInterval(liveTimer);
    const secs = Math.min(60, Math.max(1, Number(cfg('live.refreshSeconds', 4)) || 4));
    liveTimer = setInterval(() => {
      if (statusBarEnabled() || (provider.view && provider.view.visible)) refreshLive();
    }, secs * 1000);
  };
  startLiveTimer();

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
    // Cross-project prompt search. A picker, not a tab: search *is* what a
    // QuickPick is, and the panel already has six tabs.
    vscode.commands.registerCommand('claudeControl.searchPrompts', async () => {
      const entries = claude.history.read();
      if (!entries.length) {
        vscode.window.showInformationMessage(t('msg.noHistory'));
        return;
      }
      const roots = projectRoots().map((r) => nodePath.resolve(r));
      const scoped = projectScope() && roots.length;
      const pool = scoped
        ? entries.filter((e) => roots.includes(nodePath.resolve(e.project || '')))
        : entries;

      const toItems = (list) =>
        list.slice(0, 200).map((e) => ({
          label: claude.history.oneLine(e.text),
          description: nodePath.basename(e.project || '') || '',
          detail:
            (e.at ? new Date(e.at).toLocaleString() : '') +
            (e.sessionId ? '  ·  ' + e.sessionId.slice(0, 8) : ''),
          _e: e,
        }));

      const qp = vscode.window.createQuickPick();
      qp.matchOnDescription = true;
      qp.placeholder = t('pick.searchPrompts', pool.length);
      qp.items = toItems(claude.history.search(pool, '', { limit: 200 }));
      // Re-rank on every keystroke: the picker's own filter cannot know about
      // recency, and it would be scoring thousands of rows instead of hundreds.
      qp.onDidChangeValue((v) => {
        qp.items = toItems(claude.history.search(pool, v, { limit: 200 }));
      });
      qp.onDidAccept(async () => {
        const sel = qp.selectedItems[0];
        qp.hide();
        if (!sel) return;
        const e = sel._e;
        const act = await vscode.window.showQuickPick(
          [
            { label: '$(play) ' + t('act.resume'), _a: 'resume' },
            { label: '$(clippy) ' + t('act.copyPrompt'), _a: 'copy' },
            { label: '$(file-code) ' + t('act.transcript'), _a: 'transcript' },
          ],
          { placeHolder: claude.history.oneLine(e.text, 70) }
        );
        if (!act) return;
        if (act._a === 'copy') {
          await vscode.env.clipboard.writeText(e.text);
          vscode.window.showInformationMessage(t('msg.copied'));
        } else if (act._a === 'transcript') {
          if (claude.registry.SESSION_ID_RE.test(e.sessionId)) {
            openDoc(session.transcriptPath(e.project, e.sessionId));
          }
        } else if (act._a === 'resume') {
          if (!claude.registry.SESSION_ID_RE.test(e.sessionId)) return;
          const term = vscode.window.createTerminal({ name: t('term.resume'), cwd: e.project });
          term.show();
          term.sendText(claude.actions.resumeCommand(e.sessionId, e.project));
        }
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
    }),
    vscode.workspace.registerTextDocumentContentProvider(GIT_SCHEME, headContentProvider),
    vscode.commands.registerCommand('claudeControl.openStatusPage', () =>
      vscode.env.openExternal(vscode.Uri.parse(claude.status.PAGE))
    ),
    vscode.commands.registerCommand('claudeControl.metrics', async () => {
      await vscode.commands.executeCommand('claudeControlView.focus');
      provider.showTab('metrics');
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.post()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeControl')) {
        if (e.affectsConfiguration('claudeControl.live.refreshSeconds')) startLiveTimer();
        if (statusBarEnabled() && !lastUsage) refreshUsage();
        else updateStatusBar();
        provider.post();
      }
    }),
    statusBarSession,
    statusBarWeek,
    statusBarSessions,
    statusBarHealth,
    ...statusBarContexts,
    { dispose: () => clearInterval(pollTimer) },
    { dispose: () => clearInterval(statusTimer) },
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

// --- project scope ---
// "Only this project" is view state, not Claude Code configuration, so it lives
// in the extension's own globalState rather than in settings.json. That also
// means it works the moment the extension loads: a newly contributed setting is
// not registered until the window reloads, and a switch that throws
// "not a registered configuration" on first click is worse than no switch.
//
// It defaults ON. On a machine with many projects, the useful default is "show
// me this one" — seeing every session, every finding and every token from
// thirteen other projects is noise you have to filter before you can read it.
const SCOPE_KEY = 'live.onlyCurrentProject';
let extState = null;

function projectScope() {
  return extState ? extState.get(SCOPE_KEY, true) : true;
}
async function setProjectScope(v) {
  if (extState) await extState.update(SCOPE_KEY, !!v);
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

// The committed side of a session diff. A virtual document rather than a temp
// file: nothing to write, nothing to clean up, and VS Code caches it per URI.
// The query carries the repo, the path carries the file — both are ours, but the
// provider still refuses anything that escapes the repo.
const GIT_SCHEME = 'claude-control-git';

const headContentProvider = {
  provideTextDocumentContent(uri) {
    let cwd = '';
    try {
      cwd = JSON.parse(uri.query || '{}').cwd || '';
    } catch (e) {
      return '';
    }
    const rel = uri.path.replace(/^\//, '');
    if (!cwd || !rel || rel.includes('..')) return '';
    return claude.gitdiff.showHead(cwd, rel) || '';
  },
};

// Opens the native side-by-side diff for one file a session changed.
function openSessionDiff(cwd, c) {
  const title = nodePath.basename(c.path) + ' · ' + t(c.untracked ? 'diff.new' : 'diff.title');
  const right = vscode.Uri.file(c.abs);
  // An untracked file has no committed side at all; diffing it against an empty
  // document is what "everything here is new" looks like.
  // Uri.from, not Uri.parse: a filename containing a space or a '#' would be
  // mangled by parsing it back out of a string.
  const left = c.untracked
    ? vscode.Uri.from({ scheme: GIT_SCHEME, path: '/empty', query: '{}' })
    : vscode.Uri.from({
        scheme: GIT_SCHEME,
        path: '/' + c.path,
        query: JSON.stringify({ cwd }),
      });
  vscode.commands.executeCommand('vscode.diff', left, right, title);
}

// ---- status bar (plan usage + live sessions) ----
let statusBarSession = null;
let statusBarWeek = null;
let statusBarSessions = null;
let statusBarContexts = [];
let statusBarHealth = null;
let lastStatus = null; // Anthropic's status page, or null while healthy/unknown
// The reset timestamp of the window we have already warned about, per gauge.
// Keyed by window so a new one rearms the warning by itself.
let quotaWarned = { five: null, week: null };
let currentProvider = null;
let lastUsage = undefined; // undefined = loading, null = unavailable, {} = data
let lastState = '';
let lastLive = { groups: [], sessions: [], total: 0, hidden: 0, waiting: 0, agents: 0 };
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

// The health item lives outside statusBarEnabled(): someone who turned the usage
// gauges off still wants to be told that Claude Code is down. It obeys only its
// own setting, and shows up only when there is something wrong to report.
function updateHealthItem() {
  if (!statusBarHealth) return;
  const s = lastStatus;
  if (!s || s.level === 'ok' || s.level === 'unknown' || !cfg('status.enabled', true)) {
    return statusBarHealth.hide();
  }
  const icon = s.level === 'maintenance' ? '$(tools)' : '$(warning)';
  statusBarHealth.text = `${icon} ${t('status.short')}`;
  statusBarHealth.tooltip = (s.incident || s.label || t('status.degraded')) + ' — ' + s.url;
  statusBarHealth.color =
    s.level === 'degraded' || s.level === 'maintenance'
      ? new vscode.ThemeColor('statusBarItem.warningForeground')
      : new vscode.ThemeColor('statusBarItem.errorForeground');
  statusBarHealth.show();
}

function updateStatusBar() {
  updateHealthItem();
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

  // A gauge reading 94% does not tell you whether that is fine or whether you
  // have twenty minutes left; the projection does. Marks whichever window is
  // about to run out, on the same threshold as the notification.
  const warnAt = Number(cfg('quotaWarning.minutes', 30));
  const tight = (b) =>
    warnAt > 0 && b && b.minutesLeft != null && !b.resetsFirst && b.minutesLeft <= warnAt
      ? '$(warning) '
      : '';
  let burnNow = null;
  try {
    burnNow = currentBurn(claude.readUsageHistory());
  } catch (e) {
    /* the gauges must render with or without a projection */
  }

  if (s != null && statusBarShow('show5h', true)) {
    statusBarSession.text = `${tight(burnNow && burnNow.five)}5h ${usageBar(s, 6)} ${Math.round(s)}%`;
    applyUsageStyle(statusBarSession, s);
    statusBarSession.tooltip = md;
    statusBarSession.show();
  } else statusBarSession.hide();

  if (w != null && statusBarShow('show7d', true)) {
    statusBarWeek.text = `${tight(burnNow && burnNow.week)}7d ${usageBar(w, 6)} ${Math.round(w)}%`;
    applyUsageStyle(statusBarWeek, w);
    statusBarWeek.tooltip = md;
    statusBarWeek.show();
  } else statusBarWeek.hide();

  updateSessionStatusItems();
}

// The live half of the status bar: an at-a-glance count of what Claude Code is
// doing across every project, plus one context gauge per session in this one.
function updateSessionStatusItems() {
  const live = lastLive || { sessions: [], total: 0, hidden: 0, waiting: 0, agents: 0 };

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
  const onlyProject = projectScope();
  const list = [];
  let hidden = 0;
  for (const s of session.allSessions(roots, { entries })) {
    const isWorkspace = wanted.has(nodePath.resolve(s.cwd));
    if (onlyProject && !isWorkspace) {
      hidden++;
      continue;
    }
    let agents = [];
    try {
      agents = claude.agentTree(s.cwd, s.sessionId);
    } catch (e) {
      agents = []; // a malformed subagent dir must not hide the session
    }
    list.push({ ...s, isWorkspace, agents });
  }
  // Two live sessions in one directory is the collision worktrees exist to
  // prevent, and the most reported friction in running several at once. We only
  // name it — rearranging someone's checkouts from a sidebar would be worse than
  // the problem. Computed over the *unfiltered* set on purpose: a session hidden
  // by the project scope still contests the directory.
  let contested = new Set();
  try {
    contested = claude.worktree.contestedDirs(entries);
  } catch (e) {
    /* the warning is a nicety; the list is not */
  }
  for (const s of list) {
    s.contested = contested.has(s.cwd);
    // Which checkout this session is actually in. Answers the other half of the
    // question the warning raises: a session in its own linked worktree is
    // isolated by construction, and worth being able to see at a glance.
    try {
      const wt = claude.worktree.worktreeOfCached(s.cwd);
      s.worktree = wt && wt.linked ? { branch: wt.branch, detached: wt.detached } : null;
    } catch (e) {
      s.worktree = null;
    }
  }
  // Within a project: whatever needs you first, then whatever is working, then
  // the idle terminals somebody left open. Registry order is last-updated, which
  // buries a session waiting on an answer under three that are doing nothing.
  const RANK = { waiting: 0, busy: 1, shell: 1, idle: 2 };
  const rank = (x) => (x.waiting ? 0 : RANK[x.status] != null ? RANK[x.status] : 2);
  const groups = claude.registry.groupByProject(list, roots).map((g) => ({
    name: g.name,
    root: g.root,
    isWorkspace: g.isWorkspace,
    sessions: g.sessions.slice().sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt),
  }));
  return {
    groups,
    sessions: list,
    total: list.length,
    hidden,
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

// The gauges have always known you were about to run out — you just had to be
// looking at them. This says it out loud, once per window.
function alertQuota(burn) {
  const limit = Number(cfg('quotaWarning.minutes', 30));
  if (!limit || limit <= 0 || !burn) return;
  const u = lastUsage || {};
  const windows = [
    { key: 'five', b: burn.five, resets: (u.five_hour || {}).resets_at, label: t('quota.five') },
    { key: 'week', b: burn.week, resets: (u.seven_day || {}).resets_at, label: t('quota.week') },
  ];
  for (const w of windows) {
    const at = w.resets ? Date.parse(w.resets) : NaN;
    const resetsAt = isNaN(at) ? null : at;
    if (!claude.metrics.shouldWarnQuota(w.b, resetsAt, quotaWarned[w.key], limit)) continue;
    quotaWarned[w.key] = resetsAt || 'nowindow';
    vscode.window
      .showWarningMessage(t('notify.quota', w.label, String(w.b.minutesLeft)), t('btn.reveal'))
      .then((pick) => {
        if (pick === t('btn.reveal')) vscode.commands.executeCommand('claudeControl.metrics');
      });
  }
}

function refreshLive() {
  try {
    lastLive = collectLive();
  } catch (e) {
    lastLive = { groups: [], sessions: [], total: 0, hidden: 0, waiting: 0, agents: 0 };
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
// Anthropic's public status page. Anonymous GET, no token and no query string —
// nothing about you goes out, which is why this can be on by default without
// touching the "no telemetry" promise. Off entirely when the setting says so.
function refreshStatus() {
  if (!cfg('status.enabled', true)) {
    lastStatus = null;
    try {
      updateHealthItem();
    } catch (e) {
      /* never take the panel down over the status bar */
    }
    if (currentProvider) currentProvider.pushStatus();
    return;
  }
  claude.status.getStatus((s) => {
    lastStatus = s;
    try {
      updateHealthItem();
    } catch (e) {
      /* as above */
    }
    if (currentProvider) currentProvider.pushStatus();
  });
}

function refreshUsage() {
  // One of the two network requests in a product whose first promise is "no
  // telemetry, no third parties" — this one reads a credential, the status page
  // (refreshStatus) sends nothing at all. An API-key user gets an empty gauge
  // anyway and still paid for a Keychain shell-out every minute.
  if (!cfg('planUsage.enabled', true)) {
    lastUsage = null;
    lastState = 'off';
    try {
      lastLive = collectLive();
    } catch (e) {
      lastLive = { groups: [], sessions: [], total: 0, hidden: 0, waiting: 0, agents: 0 };
    }
    if (currentProvider) currentProvider.pushUsage();
    try {
      updateStatusBar();
    } catch (e) {
      /* never take the panel down over the status bar */
    }
    return;
  }
  try {
    lastLive = collectLive();
  } catch (e) {
    lastLive = { groups: [], sessions: [], total: 0, hidden: 0, waiting: 0, agents: 0 };
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
    try {
      alertQuota(currentBurn(claude.readUsageHistory()));
    } catch (e) {
      /* a missed warning must not break the poll */
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

// Someone's own pet, turned into a data: URI for the webview.
//
// A data: URI rather than a file path, because the webview may only load from
// `localResourceRoots` and adding an arbitrary user directory to that would open
// the whole of it. And the panel puts it in an <img>: an inline <svg> from
// another person's file would execute its own <script>, an <img> never does.
// Kept in step with the `claudeControl.pet.species` enum in package.json; the
// wiring test asserts the two agree.
const PET_SPECIES = ['cat', 'dog', 'owl', 'capybara', 'cangaceiro'];
const PET_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const PET_MAX_BYTES = 256 * 1024; // it travels in every postMessage of the model

// Keyed by path+mtime+size: buildModel runs on every post(), and re-reading and
// re-encoding a quarter-megabyte each time would be pure waste. Editing the
// image changes its mtime, so the cache invalidates itself.
let _petCache = { key: '', uri: '' };

function readPetImage(file) {
  const p = String(file || '').trim();
  if (!p) return '';
  const mime = PET_TYPES[nodePath.extname(p).toLowerCase()];
  if (!mime) return '';
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > PET_MAX_BYTES) return '';
    const key = `${p}:${st.mtimeMs}:${st.size}`;
    if (_petCache.key === key) return _petCache.uri;
    const uri = `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
    _petCache = { key, uri };
    return uri;
  } catch (e) {
    return ''; // gone, unreadable, or not a file — fall back to the drawn set
  }
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
    expandAgents: cfg('live.expandAgents', 'always'),
    pet: cfg('pet.enabled', false),
    petSpecies: cfg('pet.species', 'cat'),
    petCustom: cfg('pet.enabled', false) ? readPetImage(cfg('pet.customPath', '')) : '',
    statusWatch: cfg('status.enabled', true),
    quotaWarning: Number(cfg('quotaWarning.minutes', 30)),
    projectScope: projectScope(),
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
      // Which file to open for a project MCP row — .mcp.json when it exists,
      // otherwise the project settings that declared the server.
      mcpFile: claude.fileExists(p.mcp) ? p.mcp : claude.fileExists(p.settings) ? p.settings : '',
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
    // Terminals we opened, by the session id they host — so a second click on
    // Resume raises that conversation instead of starting another one beside it.
    this.terminals = new Map();
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
    // Cached in src/status.js, so a re-open repaints the banner without a request.
    refreshStatus();
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

  // Its own message rather than a field on `usage`: the status poll runs on a
  // five-minute clock of its own and must not wait for a usage tick to reach the
  // banner, nor drag the whole usage payload along when it changes.
  pushStatus() {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'status', status: lastStatus });
  }

  sendMetrics() {
    const opts = {
      days: cfg('metrics.days', 30),
      projectScope: projectScope(),
      roots: projectRoots(),
    };
    claude.metrics.collect(opts, (report) => {
      if (report && this.view) this.view.webview.postMessage({ type: 'metrics', report });
    });
  }

  sendDoctor() {
    if (!this.view) return;
    const report = claude.doctor.run({
      roots: projectRoots(),
      projectScope: projectScope(),
      ignore: cfg('doctor.ignore', []),
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

      // An undismissable false positive keeps the Doctor dot pulsing forever and
      // teaches the user to ignore the tab — which costs them the true findings.
      case 'ignoreFinding': {
        const list = cfg('doctor.ignore', []).slice();
        if (msg.id && !list.includes(msg.id)) list.push(msg.id);
        await this.set('doctor.ignore', list);
        this.sendDoctor();
        break;
      }
      case 'clearIgnored':
        await this.set('doctor.ignore', []);
        this.sendDoctor();
        break;

      case 'scanDisk':
        claude.doctor.diskUsage((disk) => {
          if (this.view) this.view.webview.postMessage({ type: 'disk', disk });
        });
        break;

      // One scope for the whole panel: Live, Metrics and Doctor all read it, so
      // flipping it anywhere changes what every tab is talking about.
      case 'toggleProjectScope':
        await setProjectScope(!projectScope());
        refreshLive();
        this.post();
        this.sendDoctor();
        this.sendMetrics();
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
      case 'togglePet':
        await this.flip('pet.enabled', false);
        break;
      case 'setPetSpecies':
        // The list is the webview's, so validate against the manifest's enum
        // rather than trusting the message.
        if (PET_SPECIES.includes(msg.value)) {
          await this.set('pet.species', msg.value);
          this.post();
        }
        break;
      case 'toggleStatusWatch': {
        // Repost immediately: switching it off must clear the banner and the
        // status-bar item now, not at the next five-minute tick.
        await this.flip('status.enabled', true, true);
        refreshStatus();
        this.post();
        break;
      }
      case 'setExpandAgents':
        if (['always', 'whileRunning', 'never'].includes(msg.value)) {
          await this.set('live.expandAgents', msg.value);
          this.post();
        }
        break;
      case 'setQuotaWarning': {
        // The segmented control hands back strings; the setting is a number, and
        // writing "30" into a number-typed key makes VS Code reject it silently.
        const mins = Number(msg.value);
        if ([0, 15, 30, 60].includes(mins)) {
          await this.set('quotaWarning.minutes', mins);
          // A threshold change can retire or raise the gauge marker right away.
          try {
            updateStatusBar();
          } catch (e) {
            /* never take the panel down over the status bar */
          }
          this.post();
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
        // Typing `Bash(git push:*)` from memory is not a reasonable ask — you
        // cannot choose from a vocabulary you have never been shown. Offer the
        // catalogue first, with what each rule actually governs, and keep the
        // free-text box for the cases the list cannot anticipate.
        const perms = claude.config.read().permissions;
        const taken = [...perms.allow, ...perms.ask, ...perms.deny];
        const catalog = claude.config.ruleCatalog(
          claude.listMcp().map((m) => m.name),
          taken
        );
        const items = [];
        let group = '';
        for (const r of catalog) {
          if (r.group !== group) {
            group = r.group;
            items.push({ label: t('permgroup.' + group), kind: vscode.QuickPickItemKind.Separator });
          }
          items.push({
            label: r.rule,
            description: r.taken ? t('perm.alreadySet') : '',
            detail: r.group === 'mcp' ? t('permcat.mcp', r.label) : t('permcat.' + r.id),
            _rule: r.rule,
          });
        }
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(edit) ' + t('perm.custom'), detail: t('perm.customHint'), _custom: true });

        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: t('pick.permRule', t('perm.' + msg.bucket)),
          matchOnDetail: true,
        });
        if (!pick) break;
        let rule = pick._rule;
        if (pick._custom) {
          rule = await vscode.window.showInputBox({
            prompt: t('input.permRule', t('perm.' + msg.bucket)),
            placeHolder: t('input.permRulePlaceholder'),
            validateInput: (v) =>
              !v || claude.config.isValidRule(v.trim()) ? null : t('input.permRuleInvalid'),
          });
        }
        if (!rule) break;
        claude.config.addPermission(msg.bucket, rule.trim());
        this.post();
        vscode.window.showInformationMessage(
          t('msg.permAdded', rule.trim(), t('perm.' + msg.bucket))
        );
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

      case 'installPlugin': {
        // Validated at the source (listMarketplacePlugins) — re-tested here
        // because these are interpolated unquoted into a shell command, and the
        // boundary that matters is this message, not the element it came from.
        const SAFE = /^[A-Za-z0-9._-]+$/;
        if (!SAFE.test(String(msg.name || '')) || !SAFE.test(String(msg.marketplace || ''))) break;
        this.runInTerminal(t('term.installPlugin'), `claude plugin install ${msg.name}@${msg.marketplace}`);
        vscode.window.showInformationMessage(t('msg.installingPlugin', msg.name));
        break;
      }

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
      // One button, three situations — and only one of them wanted a plain
      // `claude --resume`:
      //   • we already opened a terminal for this session: the conversation is
      //     sitting right there, so raise it;
      //   • the session is detached: `claude attach` is precisely that;
      //   • the session is interactive and its process is still running (the
      //     Live tab only lists live sessions, so this is the common case).
      //     Resuming it reuses the session id, which puts a second Claude Code
      //     on the same transcript — and the newcomer finds the original's
      //     background agents with no completion record and says so. Branch it
      //     into its own id instead, or hand the command over.
      case 'resumeSession': {
        const sid = String(msg.sid || '');
        const open = this.terminals.get(sid);
        if (open && open.exitStatus === undefined) {
          open.show();
          break;
        }
        this.terminals.delete(sid);
        const detached = !!(msg.kind && msg.kind !== 'interactive');
        let fork = false;
        if (!detached && msg.alive) {
          const forkIt = t('act.forkSession');
          const copyIt = t('act.copyResume');
          const pick = await vscode.window.showWarningMessage(
            t('msg.sessionLive'),
            { modal: true, detail: t('msg.sessionLive.detail') },
            forkIt,
            copyIt
          );
          if (!pick) break;
          if (pick === copyIt) {
            await vscode.env.clipboard.writeText(
              claude.actions.resumeCommand(sid, msg.cwd, undefined, msg.kind)
            );
            vscode.window.showInformationMessage(t('msg.copied'));
            break;
          }
          fork = true;
        }
        const cmd = claude.actions.resumeCommand(sid, msg.cwd, undefined, msg.kind, fork);
        const term = this.runInTerminal(t('term.resume'), cmd, msg.cwd);
        // A fork gets a new session id from the CLI, so this terminal is not the
        // home of `sid` and must not be raised for it later.
        if (!fork) this.terminals.set(sid, term);
        break;
      }
      // The list of files this session has written — the question you actually
      // have when an agent is loose in your repo, and the one thing the old
      // "Transcript" button pretended to answer while handing over 7 MB of JSONL.
      case 'sessionFiles': {
        if (!claude.registry.SESSION_ID_RE.test(String(msg.sid || ''))) break;
        const files = session.editedFiles(msg.cwd, msg.sid);
        if (!files.length) {
          vscode.window.showInformationMessage(t('msg.noFiles'));
          break;
        }
        // "Which files" is rarely the question; "what did it do to them" is. When
        // the project is a git repo we can answer the second one — +N −M per
        // file, and the native diff on pick. Outside a repo, or once the work is
        // committed, this is null/empty and the old behaviour stands rather than
        // promising a diff we cannot produce.
        const changed = claude.gitdiff.changedFiles(msg.cwd, files.map((f) => f.path));
        const stat = new Map((changed || []).map((c) => [c.abs, c]));
        if (changed && !changed.length) {
          vscode.window.showInformationMessage(t('msg.noPending'));
          break;
        }
        const rows = (changed ? files.filter((f) => stat.has(f.path)) : files).map((f) => {
          const c = stat.get(f.path);
          const churn = !c
            ? ''
            : c.binary
              ? t('files.binary')
              : `+${c.added} −${c.removed}` + (c.untracked ? ' · ' + t('files.new') : '');
          return {
            label: (f.exists ? '$(file) ' : '$(trash) ') + nodePath.basename(f.path),
            description: [churn, t('files.edits', f.count)].filter(Boolean).join('  ·  '),
            detail: f.path,
            _f: f,
            _c: c,
          };
        });
        const pick = await vscode.window.showQuickPick(rows, {
          placeHolder: t('pick.files', rows.length),
          matchOnDetail: true,
        });
        if (!pick) break;
        if (!pick._f.exists) {
          vscode.window.showWarningMessage(t('msg.fileGone', pick._f.path));
        } else if (pick._c && !pick._c.binary) {
          openSessionDiff(msg.cwd, pick._c);
        } else {
          openDoc(pick._f.path);
        }
        break;
      }

      // Everything else a session card can do. A menu rather than more buttons:
      // they are all occasional, and one of them kills a process.
      case 'sessionMenu': {
        const items = [
          { label: '$(file-code) ' + t('act.transcript'), _a: 'transcript' },
          {
            label: '$(folder) ' + t(msg.workspace ? 'act.revealFolder' : 'act.openFolder'),
            _a: 'folder',
          },
          { label: '$(clippy) ' + t('act.copyId'), _a: 'copyId' },
          { label: '$(terminal) ' + t('act.copyResume'), _a: 'copyResume' },
        ];
        if (Number(msg.pid) > 0) {
          items.push({ label: '$(stop-circle) ' + t('act.stopSession'), _a: 'stop' });
        }
        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: msg.name || t('scope.live'),
        });
        if (!pick) break;
        // Spread first: `msg` still carries `type: 'sessionMenu'`, so putting the
        // new type before it was overwritten by the old one and the menu simply
        // re-opened itself. Stop, Transcript and Open folder all did nothing.
        if (pick._a === 'transcript') return this.handle({ ...msg, type: 'openTranscript' });
        if (pick._a === 'folder') return this.handle({ ...msg, type: 'openFolder' });
        if (pick._a === 'stop') return this.handle({ ...msg, type: 'killSession' });
        if (pick._a === 'copyId') {
          await vscode.env.clipboard.writeText(String(msg.sid));
          vscode.window.showInformationMessage(t('msg.copied'));
        }
        if (pick._a === 'copyResume') {
          await vscode.env.clipboard.writeText(
            claude.actions.resumeCommand(msg.sid, msg.cwd, undefined, msg.kind)
          );
          vscode.window.showInformationMessage(t('msg.copied'));
        }
        break;
      }

      case 'openStatusPage':
        return vscode.commands.executeCommand('claudeControl.openStatusPage');

      case 'openTranscript':
        // The id becomes a path segment; the DOM is our own, but the postMessage
        // channel is the trust boundary, not the DOM.
        if (!claude.registry.SESSION_ID_RE.test(String(msg.sid || ''))) break;
        openDoc(session.transcriptPath(msg.cwd, msg.sid));
        break;
      case 'openFolder': {
        // Opening the folder that is already the workspace does nothing visible
        // — the editor just focuses the window you are looking at. With the
        // project scope on, that is the *normal* case, so the button has to mean
        // something in it: show the folder in the OS file manager instead.
        const target = nodePath.resolve(msg.cwd);
        const isOpen = roots.some((r) => nodePath.resolve(r) === target);
        await vscode.commands.executeCommand(
          isOpen ? 'revealFileInOS' : 'vscode.openFolder',
          vscode.Uri.file(msg.cwd),
          isOpen ? undefined : { forceNewWindow: true }
        );
        break;
      }
      case 'killSession': {
        const pid = Number(msg.pid);
        // Not just "truthy": kill(2) reads a negative as a process *group*, and
        // -1 means every process this user may signal.
        if (!Number.isInteger(pid) || pid <= 0) break;
        const ok = await vscode.window.showWarningMessage(
          t('prompt.killSession', msg.name || pid),
          { modal: true, detail: t('prompt.killSessionDetail', pid) },
          t('btn.stop')
        );
        if (ok !== t('btn.stop')) break;
        // The modal can sit open indefinitely. Re-read the registry before
        // signalling: if that session has since exited, the pid may now belong to
        // something else entirely.
        const still = claude.registry
          .liveSessions()
          .some((x) => x.pid === pid && x.sessionId === msg.sid);
        if (!still) {
          vscode.window.showInformationMessage(t('msg.sessionGone'));
          refreshLive();
          break;
        }
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
        const allowed = claude.doctor
          .run({ roots })
          .findings.filter((f) => f.fix && f.fix.action === 'fixSecret')
          .map((f) => f.fix.path);
        const r = claude.actions.indirectSecret(
          msg.path,
          segments,
          msg.env,
          msg.masked,
          allowed
        );
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
      case 'chmodHook': {
        // Confined to the scripts the health check itself reported, so an
        // arbitrary path in a stale message cannot be made executable.
        const known = claude.doctor
          .run({ roots })
          .findings.some((f) => f.fix && f.fix.action === 'chmodHook' && f.fix.path === msg.path);
        if (!known) break;
        if (claude.actions.makeExecutable(msg.path)) {
          vscode.window.showInformationMessage(t('msg.madeExecutable', baseName(msg.path)));
        }
        this.sendDoctor();
        break;
      }
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
  //
  // A setting only becomes writable once the window has loaded the manifest that
  // declares it — and updating an extension in place does not rebuild that
  // registry. So the first click on any newly added toggle, after any in-place
  // update, fails with "… is not a registered configuration". That is the normal
  // update path, not an edge case, so it gets a real answer instead of VS Code's
  // raw error: say what happened and offer the one action that fixes it.
  async set(key, value) {
    try {
      await vscode.workspace
        .getConfiguration('claudeControl')
        .update(key, value, vscode.ConfigurationTarget.Global);
      return true;
    } catch (e) {
      if (!/not a registered configuration/i.test(String((e && e.message) || e))) throw e;
      const reload = await vscode.window.showWarningMessage(
        t('msg.needsReload'),
        t('btn.reloadWindow')
      );
      if (reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
      return false;
    }
  }
  async flip(key, def, skipPost) {
    const next = !cfg(key, def);
    const ok = await this.set(key, next);
    if (!skipPost) this.post();
    return ok ? next : !next;
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
