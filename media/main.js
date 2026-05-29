/* Claude Control — webview renderer (vanilla JS). */
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  // ---- icons (line icons, inherit currentColor) ----
  const I = {
    mark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/>' +
      '<circle cx="9" cy="7" r="2.7" fill="var(--vscode-sideBar-background)"/>' +
      '<circle cx="15.5" cy="12" r="2.7" fill="var(--vscode-sideBar-background)"/>' +
      '<circle cx="7.5" cy="17" r="2.7" fill="var(--vscode-sideBar-background)"/></svg>',
    refresh:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    gear:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.8 7.8 0 0 0 .1-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-2.6-1.5l-.3-2.1H8.5l-.3 2.1c-1 .3-1.8.8-2.6 1.5l-2-.8L1.8 9.2l1.7 1.3a7.8 7.8 0 0 0 0 3l-1.7 1.3 1.8 3.1 2-.8c.8.7 1.6 1.2 2.6 1.5l.3 2.1h3.6l.3-2.1c1-.3 1.8-.8 2.6-1.5l2 .8 1.8-3.1z"/></svg>',
    sparkle:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>',
    puzzle:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M10 3a2 2 0 0 1 4 0c0 .5.5 1 1 1h2a1 1 0 0 1 1 1v2c0 .5.5 1 1 1a2 2 0 0 1 0 4c-.5 0-1 .5-1 1v3a1 1 0 0 1-1 1h-3c-.5 0-1-.5-1-1a2 2 0 0 0-4 0c0 .5-.5 1-1 1H6a1 1 0 0 1-1-1v-3c0-.5-.5-1-1-1a2 2 0 0 1 0-4c.5 0 1-.5 1-1V6a1 1 0 0 1 1-1h2c.5 0 1-.5 1-1z"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
    doc:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6"/></svg>',
    json:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4c-2 0-2 2-2 4s0 3-2 4c2 1 2 2 2 4s0 4 2 4"/><path d="M16 4c2 0 2 2 2 4s0 3 2 4c-2 1-2 2-2 4s0 4-2 4"/></svg>',
    terminal:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l4 4-4 4"/><path d="M12 16h6"/></svg>',
    agent:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>',
    plus:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4M5 21h14"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
    bolt:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    plug:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v6"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    gauge:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/></svg>',
  };

  // ---- i18n (bundle sent from the extension host) ----
  let T = {};
  function tr(key, ...args) {
    let s = T[key] != null ? T[key] : key;
    if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? m : String(args[i])));
    return s;
  }

  // ---- persisted state (section collapse + active tab) ----
  const _state = vscode.getState() || {};
  let collapsed = Object.assign(
    {
      'g-plugins': true,
      'g-market': true,
      'g-skills': true,
      'g-agents': true,
      'g-cmd': true,
      'g-mcp': true,
      'g-hooks': true,
    },
    _state.collapsed || {}
  );
  const TABS = ['global', 'project', 'usage'];
  let activeTab = TABS.includes(_state.activeTab) ? _state.activeTab : 'global';
  function saveState() {
    vscode.setState({ collapsed, activeTab });
  }

  let currentModel = null;
  let searchQuery = '';
  let pollSeconds = 60;

  const esc = (s) =>
    String(s == null ? '' : s).replace(
      /[&<>"'`]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c])
    );

  function secId(scopeKey, name) {
    return scopeKey + '-' + name;
  }

  // ---- reusable rows / blocks ----
  function section(id, icon, title, count, bodyHtml) {
    const isCol = !!collapsed[id];
    return (
      `<div class="sec ${isCol ? 'collapsed' : ''}" data-secwrap="${id}">` +
      `<div class="sec-h" data-sec="${id}">` +
      `<span class="chev">${I.chevron}</span><span class="ic">${icon}</span>` +
      `<span class="nm">${esc(title)}</span>` +
      (count != null ? `<span class="ct">${count}</span>` : '') +
      `</div><div class="sec-b">${bodyHtml || `<div class="empty">${tr('empty.generic')}</div>`}</div></div>`
    );
  }
  function toggleRow(label, on, act) {
    return (
      `<div class="row ${on ? 'on' : ''}">` +
      `<span class="led ${on ? 'on' : ''}"></span>` +
      `<div class="body"><div class="l">${esc(label)}</div></div>` +
      `<div class="sw ${on ? 'on' : ''}" data-act="${act}"></div>` +
      `<span class="state">${on ? 'ON' : 'OFF'}</span></div>`
    );
  }
  function pluginRow(p) {
    return (
      `<div class="row">` +
      `<span class="led ${p.enabled ? 'on' : ''}"></span>` +
      `<div class="body"><div class="l">${esc(p.name)}</div></div>` +
      `<div class="sw ${p.enabled ? 'on' : ''}" data-act="togglePlugin" data-key="${esc(p.key)}"></div>` +
      `</div>`
    );
  }
  function linkRow(icon, label, desc, path) {
    return (
      `<div class="row click" data-act="open" data-path="${esc(path)}">` +
      `<span class="ic">${icon}</span>` +
      `<div class="body"><div class="l">${esc(label)}</div>` +
      (desc ? `<div class="d">${esc(desc)}</div>` : '') +
      `</div>` +
      `<span class="go">${I.go}</span></div>`
    );
  }
  function actionRow(label, act, data) {
    const attrs = Object.entries(data || {})
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ');
    return (
      `<div class="row click act" data-act="${act}" ${attrs}>` +
      `<span class="ic">${I.plus}</span>` +
      `<div class="body"><div class="l">${esc(label)}</div></div></div>`
    );
  }
  function marketRow(p) {
    return (
      `<div class="row click" data-act="installPlugin" data-name="${esc(p.name)}" data-marketplace="${esc(p.marketplace)}">` +
      `<span class="ic">${I.download}</span>` +
      `<div class="body"><div class="l">${esc(p.name)}</div>` +
      (p.description ? `<div class="d">${esc(p.description)}</div>` : '') +
      `</div><span class="go">${I.go}</span></div>`
    );
  }
  function hookRow(hk) {
    return (
      `<div class="row">` +
      `<span class="ic">${I.bolt}</span>` +
      `<div class="body"><div class="l">${esc(hk.event)}${hk.matcher ? ' · ' + esc(hk.matcher) : ''}</div>` +
      `<div class="d">${esc(hk.command)}</div></div>` +
      `<span class="del" data-act="removeHook" data-event="${esc(hk.event)}" data-command="${esc(hk.command)}">${I.trash}</span></div>`
    );
  }
  function skillRows(list) {
    if (!list.length) return `<div class="empty">${tr('empty.skills')}</div>`;
    return list.map((s) => linkRow(I.sparkle, s.name, s.description, s.path)).join('');
  }
  function fileRows(list, icon, emptyTxt) {
    if (!list.length) return `<div class="empty">${esc(emptyTxt || tr('empty.generic'))}</div>`;
    return list.map((f) => linkRow(icon, f.name, f.description, f.path)).join('');
  }
  function mcpRows(list, openPath) {
    if (!list.length) return `<div class="empty">${tr('empty.mcp')}</div>`;
    return list.map((n) => linkRow(I.plug, n, '', openPath || '')).join('');
  }

  // ---- tabs ----
  function tabBtn(id, label) {
    return `<button class="tab ${activeTab === id ? 'on' : ''}" data-tab="${id}">${esc(label)}</button>`;
  }

  // ---- per-tab content ----
  function buildGlobal(g) {
    let h = '';
    h += `<div class="scope"><span class="dot"></span>${tr('scope.global')}<span class="path">~/.claude</span></div>`;

    let cfgBody = '';
    if (g.soundReady || g.notifyReady) {
      if (g.soundReady) cfgBody += toggleRow(tr('toggle.sound'), g.sound, 'toggleSound');
      if (g.notifyReady) cfgBody += toggleRow(tr('toggle.notify'), g.notify, 'toggleNotify');
      cfgBody += `<div class="divider"></div>`;
    } else {
      cfgBody +=
        `<div class="empty">${tr('empty.notifyUnset')}</div>` +
        actionRow(tr('act.installHooks'), 'installHooks');
      cfgBody += `<div class="divider"></div>`;
    }
    cfgBody += toggleRow(tr('toggle.statusBar'), g.statusBar, 'toggleStatusBar');
    cfgBody += `<div class="divider"></div>`;
    cfgBody += linkRow(I.json, 'settings.json', '', g.settingsPath);
    h += section('g-config', I.gear, tr('sec.config'), null, cfgBody);

    h += section(
      'g-plugins',
      I.puzzle,
      tr('sec.plugins'),
      g.plugins.length,
      g.plugins.length ? g.plugins.map(pluginRow).join('') : `<div class="empty">${tr('empty.plugins')}</div>`
    );
    const mk = g.marketplace || [];
    h += section(
      'g-market',
      I.download,
      tr('sec.market'),
      mk.length,
      mk.length ? mk.map(marketRow).join('') : `<div class="empty">${tr('empty.market')}</div>`
    );
    h += section('g-skills', I.sparkle, tr('sec.skills'), g.skills.length, skillRows(g.skills) + actionRow(tr('act.newSkill'), 'newSkill'));
    h += section(
      'g-agents',
      I.agent,
      tr('sec.agents'),
      (g.agents || []).length,
      fileRows(g.agents || [], I.agent, tr('empty.agents')) + actionRow(tr('act.newAgent'), 'newAgent')
    );
    h += section(
      'g-cmd',
      I.terminal,
      tr('sec.commands'),
      (g.commands || []).length,
      fileRows(g.commands || [], I.terminal, tr('empty.commands')) + actionRow(tr('act.newCommand'), 'newCommand')
    );
    h += section('g-mcp', I.plug, tr('sec.mcp'), g.mcp.length, mcpRows(g.mcp, g.settingsPath) + actionRow(tr('act.addMcp'), 'addMcp'));
    const hooks = g.hooks || [];
    h += section(
      'g-hooks',
      I.bolt,
      tr('sec.hooks'),
      hooks.length,
      (hooks.length ? hooks.map(hookRow).join('') : `<div class="empty">${tr('empty.hooks')}</div>`) + actionRow(tr('act.newHook'), 'newHook')
    );
    return h;
  }

  function buildProjects(model) {
    let h = '';
    if (!model.projects.length) {
      h += `<div class="scope"><span class="dot" style="background:var(--mute2);box-shadow:none"></span>${tr('scope.project')}</div>`;
      h += `<div class="empty">${tr('empty.openFolder')}</div>`;
      return h;
    }
    model.projects.forEach((p, idx) => {
      const sk = 'p' + idx;
      h += `<div class="scope"><span class="dot"></span>${esc(p.name)}<span class="path">${tr('scope.projectTag')}</span></div>`;
      const filesBody = p.files.length
        ? p.files.map((f) => linkRow(f.kind === 'doc' ? I.doc : I.json, f.label, '', f.path)).join('')
        : `<div class="empty">${tr('empty.projectFiles')}</div>`;
      h += section(secId(sk, 'files'), I.doc, tr('sec.files'), p.files.length, filesBody);
      if (p.commands.length) h += section(secId(sk, 'cmd'), I.terminal, tr('sec.commands'), p.commands.length, fileRows(p.commands, I.terminal));
      if (p.skills.length) h += section(secId(sk, 'sk'), I.sparkle, tr('sec.skills'), p.skills.length, skillRows(p.skills));
      if (p.agents.length) h += section(secId(sk, 'ag'), I.agent, tr('sec.agents'), p.agents.length, fileRows(p.agents, I.agent));
      if (p.mcp.length) h += section(secId(sk, 'mcp'), I.plug, tr('sec.mcp'), p.mcp.length, mcpRows(p.mcp, p.files[0] && p.files[0].path));
    });
    return h;
  }

  // ---- Usage tab: numbers + trend sparkline ----
  function ucolor(p) {
    return p < 50 ? 'var(--led-on)' : p < 80 ? '#e8b339' : '#e0706b';
  }
  function leftTime(iso) {
    // Kept in sync with the copy in extension.js (host vs webview run in separate contexts).
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
  function urow(label, pct, extra) {
    const c = ucolor(pct);
    const w = Math.max(2, Math.min(100, pct));
    return (
      `<div class="urow"><span class="ulbl">${esc(label)}</span>` +
      `<span class="ubar"><span class="ufill" style="width:${w}%;background:${c}"></span></span>` +
      `<span class="upct" style="color:${c}">${Math.round(pct)}%</span>` +
      `<span class="uext">${esc(extra || '')}</span></div>`
    );
  }
  function sparkSvg(points, color) {
    const W = 252, H = 42, pad = 4;
    const n = points.length;
    const pts = [];
    points.forEach((v, i) => {
      if (v == null) return;
      const x = pad + (n > 1 ? (i / (n - 1)) * (W - 2 * pad) : 0);
      const y = H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * pad);
      pts.push([x, y]);
    });
    if (pts.length < 2) return '';
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area =
      `M${pts[0][0].toFixed(1)} ${H - pad} ` +
      pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') +
      ` L${pts[pts.length - 1][0].toFixed(1)} ${H - pad} Z`;
    const end = pts[pts.length - 1];
    return (
      `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      `<path d="${area}" fill="${color}" opacity="0.13"/>` +
      `<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="2.3" fill="${color}"/></svg>`
    );
  }
  function sparkBlock(label, points) {
    const latest = [...points].reverse().find((v) => v != null);
    const c = latest == null ? 'var(--mute)' : ucolor(latest);
    const svg = sparkSvg(points, c);
    if (!svg) return '';
    return (
      `<div class="sparkrow"><div class="sparklbl"><span>${esc(label)}</span>` +
      `<span style="color:${c}">${latest == null ? '' : Math.round(latest) + '%'}</span></div>${svg}</div>`
    );
  }
  function buildUsage() {
    const u = lastUsage;
    let h = `<div class="scope"><span class="dot"></span>${tr('scope.usage')}<span class="path">${tr('usage.live', pollSeconds)}</span></div>`;
    if (u === undefined) return h + `<div class="empty">${tr('boot.loading')}</div>`;
    if (!u) {
      const msg =
        lastState === 'ratelimited'
          ? tr('usage.ratelimited')
          : lastState === 'error'
            ? tr('usage.error')
            : tr('usage.notoken');
      return h + `<div class="empty">${msg}</div>`;
    }
    const fh = u.five_hour || {};
    const sd = u.seven_day || {};
    let bars = '';
    if (fh.utilization != null) bars += urow(tr('usage.session'), fh.utilization, leftTime(fh.resets_at));
    if (sd.utilization != null) bars += urow(tr('usage.week'), sd.utilization, leftTime(sd.resets_at));
    if (!bars) bars = `<div class="empty">${tr('empty.usageData')}</div>`;
    h += `<div class="usebox">${bars}</div>`;

    const hist = lastHistory || [];
    h += `<div class="scope"><span class="dot"></span>${tr('scope.trend')}<span class="path">${tr('trend.points', hist.length)}</span></div>`;
    const sBlock = hist.length > 1 ? sparkBlock(tr('usage.sessionTrend'), hist.map((p) => p.s)) : '';
    const wBlock = hist.length > 1 ? sparkBlock(tr('usage.weekTrend'), hist.map((p) => p.w)) : '';
    if (sBlock || wBlock) h += sBlock + wBlock;
    else h += `<div class="empty">${tr('empty.collecting')}</div>`;
    return h;
  }

  // ---- main render ----
  function render() {
    const model = currentModel;
    if (!model) return;
    const g = model.global;
    let h = '';

    h += `<div class="top">`;
    h +=
      `<div class="hdr"><span class="mark">${I.mark}</span>` +
      `<div class="title"><b>Claude Control</b><span>v${esc(model.version || '')} · ${tr('app.subtitle')}</span></div>` +
      `<span class="spacer"></span>` +
      `<button class="iconbtn" id="refresh" title="${esc(tr('refresh.title'))}">${I.refresh}</button></div>`;
    h += `<div class="tabs">${tabBtn('global', tr('tab.global'))}${tabBtn('project', tr('tab.project'))}${tabBtn('usage', tr('tab.usage'))}</div>`;
    if (activeTab !== 'usage') {
      h +=
        `<div class="searchwrap"><span class="sic">${I.search}</span>` +
        `<input id="search" class="search" type="text" placeholder="${esc(tr('search.placeholder'))}" /></div>`;
    }
    h += `</div>`;

    let content = '';
    if (activeTab === 'global') content = buildGlobal(g);
    else if (activeTab === 'project') content = buildProjects(model);
    else content = buildUsage();
    h += `<div class="fade">${content}</div>`;

    app.innerHTML = h;
    bind();
    applyFilter();
  }

  // ---- search: filters rows of the active tab, expands sections with a match ----
  function applyFilter() {
    const q = (searchQuery || '').trim().toLowerCase();
    app.querySelectorAll('.sec').forEach((sec) => {
      const id = sec.getAttribute('data-secwrap');
      let any = false;
      sec.querySelectorAll('.row, .empty').forEach((r) => {
        const isAct = r.classList.contains('act');
        const isEmpty = r.classList.contains('empty');
        if (q && isAct) {
          r.style.display = 'none';
          return;
        }
        const match = !q || r.textContent.toLowerCase().includes(q);
        r.style.display = match ? '' : 'none';
        if (match && !isAct && !isEmpty) any = true;
      });
      if (q) {
        sec.style.display = any ? '' : 'none';
        sec.classList.toggle('collapsed', !any);
      } else {
        sec.style.display = '';
        sec.classList.toggle('collapsed', !!collapsed[id]);
      }
    });
  }

  let lastUsage = undefined; // undefined = loading; null = unavailable; obj = data
  let lastHistory = [];
  let lastState = ''; // ok | stale | notoken | ratelimited | error

  let clickBound = false;
  function bind() {
    const r = document.getElementById('refresh');
    if (r)
      r.addEventListener('click', () => {
        r.classList.add('spin');
        setTimeout(() => r.classList.remove('spin'), 600);
        vscode.postMessage({ type: 'refresh' });
      });
    const si = document.getElementById('search');
    if (si) {
      si.value = searchQuery;
      si.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        applyFilter();
      });
    }
    if (!clickBound) {
      app.addEventListener('click', onClick);
      clickBound = true;
    }
  }

  function onClick(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab && app.contains(tab)) {
      const id = tab.getAttribute('data-tab');
      if (id !== activeTab) {
        activeTab = id;
        saveState();
        render();
      }
      return;
    }
    const sec = e.target.closest('[data-sec]');
    if (sec && app.contains(sec)) {
      const id = sec.getAttribute('data-sec');
      const wrap = app.querySelector(`[data-secwrap="${id}"]`);
      const nowCol = !wrap.classList.contains('collapsed');
      wrap.classList.toggle('collapsed', nowCol);
      collapsed[id] = nowCol;
      saveState();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && app.contains(act)) {
      const type = act.getAttribute('data-act');
      const d = (k) => act.getAttribute('data-' + k);
      if (type === 'open') vscode.postMessage({ type: 'open', path: d('path') });
      else if (type === 'togglePlugin') vscode.postMessage({ type: 'togglePlugin', key: d('key') });
      else if (type === 'installPlugin')
        vscode.postMessage({ type: 'installPlugin', name: d('name'), marketplace: d('marketplace') });
      else if (type === 'removeHook') vscode.postMessage({ type: 'removeHook', event: d('event'), command: d('command') });
      else vscode.postMessage({ type });
    }
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'data') {
      currentModel = m.model;
      if (m.model.i18n) T = m.model.i18n;
      if (m.model.pollSeconds) pollSeconds = m.model.pollSeconds;
      render();
    } else if (m.type === 'usage') {
      lastUsage = m.usage === undefined ? undefined : m.usage || null;
      lastHistory = m.history || [];
      lastState = m.state || '';
      if (currentModel && activeTab === 'usage') render();
    } else if (m.type === 'error') {
      app.innerHTML = `<div class="boot">${tr('err.prefix')}${esc(m.message)}</div>`;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
