/* Claude Control — webview shell: state, rendering and event wiring.
   Loaded last; icons.js → ui.js → views.js must already be in scope. */
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const CC = window.CC;
  const I = CC.I;
  const U = CC.ui;
  const { esc, tr } = U;

  // ---- tabs -----------------------------------------------------------------
  // Inactive tabs collapse to their icon so six of them fit a narrow sidebar;
  // the active one expands to icon + label so you always know where you are.
  const TABS = [
    { id: 'live', icon: 'live', key: 'tab.live' },
    { id: 'global', icon: 'globe', key: 'tab.global' },
    { id: 'project', icon: 'folder', key: 'tab.project' },
    { id: 'metrics', icon: 'chart', key: 'tab.metrics' },
    { id: 'doctor', icon: 'stethoscope', key: 'tab.doctor' },
    { id: 'settings', icon: 'gear', key: 'tab.settings' },
  ];
  const TAB_IDS = TABS.map((t) => t.id);
  const SEARCHABLE = new Set(['global', 'project']);

  // ---- state ----------------------------------------------------------------
  const saved = vscode.getState() || {};
  const st = {
    model: null,
    usage: undefined, // undefined = loading, null = unavailable, obj = data
    usageState: '',
    history: [],
    live: null,
    burn: null,
    metrics: null,
    doctor: null,
    disk: null,
    diskScanning: false,
    config: null,
    modelPresets: [],
    effortLevels: [],
    permissionModes: [],
    pollSeconds: 60,
    searchQuery: '',
    activeTab: TAB_IDS.includes(saved.activeTab) ? saved.activeTab : 'live',
    collapsed: Object.assign(
      {
        'g-plugins': true,
        'g-market': true,
        'g-skills': true,
        'g-agents': true,
        'g-cmd': true,
        'g-plans': true,
        'g-mcp': true,
        'g-hooks': true,
        's-claude': true,
        's-perms': true,
        's-env': true,
      },
      saved.collapsed || {}
    ),
    // Object.create(null): a session id of "__proto__" would otherwise read back
    // as truthy from a plain {} and never be assignable, wedging that card open.
    openAgents: Object.assign(Object.create(null), saved.openAgents || {}),
    openCards: Object.assign(Object.create(null), saved.openCards || {}),
    foldedAgents: Object.assign(Object.create(null), saved.foldedAgents || {}),
    showDone: Object.assign(Object.create(null), saved.showDone || {}),
  };

  function saveState() {
    vscode.setState({
      activeTab: st.activeTab,
      collapsed: st.collapsed,
      openAgents: st.openAgents,
      openCards: st.openCards,
      foldedAgents: st.foldedAgents,
      showDone: st.showDone,
    });
  }

  // Tabs that need data the host only computes on demand, so opening one asks
  // for it rather than every refresh paying for every tab.
  function ensureTabData(tab) {
    if (tab === 'metrics' && !st.metrics) vscode.postMessage({ type: 'needMetrics' });
    if (tab === 'doctor' && !st.doctor) vscode.postMessage({ type: 'needDoctor' });
  }

  // ---- render ---------------------------------------------------------------
  function tabBar() {
    return (
      `<div class="tabs" role="tablist">` +
      TABS.map((t) => {
        const on = st.activeTab === t.id;
        const label = tr(t.key);
        const dot = t.id === 'live' && st.live && st.live.waiting ? '<span class="tabdot"></span>' : '';
        const warn =
          t.id === 'doctor' && st.doctor && (st.doctor.counts.error || st.doctor.counts.warn)
            ? `<span class="tabdot ${st.doctor.counts.error ? 'err' : 'warn'}"></span>`
            : '';
        return (
          `<button class="tab ${on ? 'on' : ''}" data-tab="${t.id}" role="tab" ` +
          `aria-selected="${on}" title="${esc(label)}" aria-label="${esc(label)}">` +
          `<span class="tic">${I[t.icon]}</span>` +
          (on ? `<span class="tlb">${esc(label)}</span>` : '') +
          dot + warn +
          `</button>`
        );
      }).join('') +
      `</div>`
    );
  }

  function render() {
    if (!st.model) return;
    let h = '';

    h += `<div class="top">`;
    h +=
      `<div class="hdr"><span class="mark">${I.mark}</span>` +
      `<div class="title"><b>Claude Control</b>` +
      `<span>v${esc(st.model.version || '')} · ${esc(tr('app.subtitle'))}</span></div>` +
      `<span class="spacer"></span>` +
      `<button class="iconbtn" id="refresh" title="${esc(tr('refresh.title'))}" ` +
      `aria-label="${esc(tr('refresh.title'))}">${I.refresh}</button></div>`;
    h += tabBar();
    h += CC.views.statusBanner(st.status);
    if (SEARCHABLE.has(st.activeTab)) {
      h +=
        `<div class="searchwrap"><span class="sic">${I.search}</span>` +
        `<input id="search" class="search" type="text" ` +
        `placeholder="${esc(tr('search.placeholder'))}" aria-label="${esc(tr('search.placeholder'))}" /></div>`;
    }
    h += `</div>`;

    let content = '';
    try {
      const V = CC.views;
      if (st.activeTab === 'live') content = V.buildLive(st);
      else if (st.activeTab === 'global') content = V.buildGlobal(st);
      else if (st.activeTab === 'project') content = V.buildProject(st);
      else if (st.activeTab === 'metrics') content = V.buildMetrics(st);
      else if (st.activeTab === 'doctor') content = V.buildDoctor(st);
      else content = V.buildSettings(st);
    } catch (e) {
      // A render bug in one tab must not leave the panel blank and unusable.
      content = `<div class="empty">${esc(tr('err.prefix'))}${esc(e && e.message)}</div>`;
    }
    // Keyed by tab: the patch keeps this node across a poll (so the body does
    // not fade in every few seconds) but replaces it when the tab changes,
    // which is the one moment the entrance animation was ever meant for.
    h += `<div class="fade" data-tabkey="${st.activeTab}">${content}</div>`;

    // Every control here is a focusable div, and the Live tab replaces the whole
    // tree every few seconds — without this, keyboard focus is destroyed on each
    // poll and the panel cannot be driven without a mouse.
    const focused = document.activeElement;
    const mark =
      focused && app.contains(focused) && focused !== app
        ? focused.id
          ? '#' + focused.id
          : signature(focused)
        : '';

    // The body is patched, not rewritten; the pet and the footer are separate
    // nodes. The pet keeps its own slot so its animations survive a poll —
    // recreating it every four seconds restarted the tail mid-swing and cut the
    // cheer in half — and so it keeps updating on tabs that never re-render.
    U.morph(slots().body, h);
    if (mark) {
      const back = app.querySelector(mark);
      if (back) back.focus({ preventScroll: true });
    }
    refreshPet();
    bind();
    applyFilter();
  }

  // Creates the three slots once, then hands them back on every later call.
  function slots() {
    let body = app.querySelector('#cc-body');
    if (!body) {
      app.innerHTML =
        `<div id="cc-body"></div><div id="cc-pet"></div>` +
        `<div class="foot">${esc(tr('foot.by'))} @lucasdonordeste</div>`;
      body = app.querySelector('#cc-body');
    }
    return { body, pet: app.querySelector('#cc-pet') };
  }

  // Only touches the DOM when the pet's markup actually changed, so a running
  // animation is never restarted by a poll that changed nothing.
  function refreshPet() {
    const slot = slots().pet;
    if (!slot) return;
    const html = CC.views.petBlock(st, st.live);
    if (slot.innerHTML !== html) slot.innerHTML = html;
  }

  // A selector that finds the same control again after the tree is rebuilt.
  function signature(el) {
    const parts = [];
    for (const a of ['data-act', 'data-tab', 'data-sec', 'data-sid', 'data-key', 'data-path']) {
      const v = el.getAttribute(a);
      if (v != null) parts.push(`[${a}="${CSS.escape(v)}"]`);
    }
    return parts.length ? parts.join('') : '';
  }

  // ---- search ---------------------------------------------------------------
  // Filters rows of the active tab and auto-expands whichever sections still
  // have a match, so a query reveals results without any clicking.
  function applyFilter() {
    const q = (st.searchQuery || '').trim().toLowerCase();
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
        sec.classList.toggle('collapsed', !!st.collapsed[id]);
      }
    });
  }

  // ---- events ---------------------------------------------------------------
  let clickBound = false;

  // The patch keeps nodes across renders, so a control that survived is already
  // wired: binding it again would stack another handler on it every few seconds
  // and one click would fire four. The flag lives on the node, so a control the
  // patch did have to rebuild is wired again exactly once.
  function once(el, wire) {
    if (!el || el.__ccBound) return;
    el.__ccBound = true;
    wire(el);
  }

  function bind() {
    once(document.getElementById('refresh'), (r) => {
      r.addEventListener('click', () => {
        r.classList.add('spin');
        setTimeout(() => r.classList.remove('spin'), 600);
        st.metrics = null;
        st.doctor = null;
        st.disk = null;
        st.diskScanning = false;
        vscode.postMessage({ type: 'refresh' });
        ensureTabData(st.activeTab);
      });
    });
    once(document.getElementById('search'), (si) => {
      si.value = st.searchQuery;
      si.addEventListener('input', (e) => {
        st.searchQuery = e.target.value;
        applyFilter();
      });
    });
    once(document.getElementById('ccColor'), (cc) => {
      cc.addEventListener('change', (e) =>
        vscode.postMessage({ type: 'setCustomColor', value: e.target.value })
      );
    });
    if (!clickBound) {
      app.addEventListener('click', onActivate);
      // Everything clickable is reachable by keyboard: Enter/Space activate the
      // same handler, which is why the markup carries role/tabindex.
      app.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const hit = e.target.closest('[data-act],[data-tab],[data-sec]');
        if (!hit || !app.contains(hit)) return;
        e.preventDefault();
        onActivate(e);
      });
      clickBound = true;
    }
  }

  function onActivate(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab && app.contains(tab)) {
      const id = tab.getAttribute('data-tab');
      if (id !== st.activeTab) {
        st.activeTab = id;
        // The query is only editable on tabs that render the box; carrying it to
        // one that doesn't hides rows with nothing on screen to explain why.
        if (!SEARCHABLE.has(id)) st.searchQuery = '';
        saveState();
        ensureTabData(id);
        render();
      }
      return;
    }

    const sec = e.target.closest('[data-sec]');
    if (sec && app.contains(sec)) {
      const id = sec.getAttribute('data-sec');
      const wrap = app.querySelector(`[data-secwrap="${CSS.escape(id)}"]`);
      if (!wrap) return;
      const nowCol = !wrap.classList.contains('collapsed');
      wrap.classList.toggle('collapsed', nowCol);
      st.collapsed[id] = nowCol;
      saveState();
      return;
    }

    const act = e.target.closest('[data-act]');
    if (!act || !app.contains(act)) return;
    const type = act.getAttribute('data-act');
    const d = (k) => act.getAttribute('data-' + k);
    // Deleting rather than storing `false` keeps the persisted blob to the set of
    // things actually toggled, instead of everything ever touched.
    const flip = (map, key) => {
      if (map[key]) delete map[key];
      else map[key] = true;
    };

    // Purely local interactions — no round trip to the host.
    // Poking the pet is pure decoration: it must not cost a message, and it must
    // not re-render (a re-render would replace the node mid-hop and swallow it).
    if (type === 'petPoke') {
      act.classList.remove('poked');
      // Reading offsetWidth forces a reflow, so re-adding the class restarts the
      // animation instead of being coalesced into no change at all.
      void act.offsetWidth;
      act.classList.add('poked');
      setTimeout(() => act.classList.remove('poked'), 520);
      return;
    }

    // The agent tree folds by a computed default (finished branches start shut),
    // so these two cannot use `flip`: absence means "follow the default", not
    // "open". Storing the negation of what is currently on screen is what makes
    // the click always do the thing the chevron is pointing at.
    if (type === 'foldAgent') {
      st.foldedAgents[d('aid')] = d('folded') !== '1';
      saveState();
      render();
      return;
    }
    if (type === 'toggleDone') {
      flip(st.showDone, d('sid'));
      saveState();
      render();
      return;
    }
    if (type === 'toggleAgents') {
      st.openAgents[d('sid')] = d('open') !== '1';
      saveState();
      render();
      return;
    }
    if (type === 'toggleCard') {
      flip(st.openCards, d('sid'));
      saveState();
      render();
      return;
    }
    if (type === 'scanDisk') {
      st.diskScanning = true;
      vscode.postMessage({ type: 'scanDisk' });
      render();
      return;
    }

    // Everything else is a host action; forward the data attributes it needs.
    // `type` is assigned last on purpose: a `data-type` attribute would otherwise
    // overwrite the action being sent, which is exactly how the host's overflow
    // menu ended up re-dispatching itself instead of stopping a session.
    const msg = {};
    for (const attr of act.attributes) {
      if (attr.name.startsWith('data-') && attr.name !== 'data-act') {
        msg[attr.name.slice(5)] = attr.value;
      }
    }
    msg.type = type;
    vscode.postMessage(msg);
  }

  // The pet celebrates when work finishes: the moment the last busy session goes
  // quiet without anything waiting on you. Tracked here rather than in the host
  // because it is a transition between two renders, and the panel is the only
  // side that sees both.
  //
  const CHEER_MS = 1300;

  function notePetMood() {
    const mood = CC.views.petMood(st.live);
    const was = st.petMood;
    st.petMood = mood;
    if (!CC.views.petFinished(was, mood)) return;
    st.petCheer = true;
    clearTimeout(st.petCheerTimer);
    st.petCheerTimer = setTimeout(() => {
      st.petCheer = false;
      if (st.model) render();
    }, CHEER_MS);
  }

  // ---- host messages --------------------------------------------------------
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'data':
        st.model = m.model;
        if (m.model.i18n) U.setBundle(m.model.i18n);
        if (m.model.pollSeconds) st.pollSeconds = m.model.pollSeconds;
        st.config = m.model.config || st.config;
        st.modelPresets = m.model.modelPresets || st.modelPresets;
        st.effortLevels = m.model.effortLevels || st.effortLevels;
        st.permissionModes = m.model.permissionModes || st.permissionModes;
        render();
        ensureTabData(st.activeTab);
        break;
      case 'usage':
        pruneSessionState(m.live);
        st.usage = m.usage === undefined ? undefined : m.usage || null;
        st.history = m.history || [];
        st.usageState = m.state || '';
        st.burn = m.burn || null;
        st.live = m.live || st.live;
        notePetMood();
        // Only these two tabs read live data; re-rendering the others on every
        // poll would fight the user's scroll position for nothing.
        if (st.model && (st.activeTab === 'metrics' || st.activeTab === 'live')) render();
        else if (st.model) {
          refreshTabDots();
          // The pet sits outside the tab body and reports the sessions, so it
          // has to keep up even on tabs that never re-render.
          refreshPet();
        }
        break;
      // Cheap and rare (five-minute clock), and it sits above every tab — so it
      // repaints whatever is on screen rather than only the active tab.
      case 'status':
        st.status = m.status || null;
        if (st.model) render();
        break;
      case 'metrics':
        st.metrics = m.report;
        if (st.activeTab === 'metrics') render();
        break;
      case 'doctor':
        st.doctor = m.report;
        if (st.activeTab === 'doctor') render();
        else refreshTabDots();
        break;
      case 'disk':
        st.disk = m.disk || [];
        st.diskScanning = false;
        if (st.activeTab === 'doctor') render();
        break;
      // A status-bar click or command palette entry asking for a specific tab.
      case 'showTab':
        if (TAB_IDS.includes(m.tab) && m.tab !== st.activeTab) {
          st.activeTab = m.tab;
          saveState();
          ensureTabData(m.tab);
          render();
        }
        break;
      case 'error':
        app.innerHTML = `<div class="boot">${esc(tr('err.prefix'))}${esc(m.message)}</div>`;
        break;
    }
  });

  // Drops open/expanded flags for sessions that are gone, so the persisted state
  // tracks what exists rather than growing for the life of the install.
  function pruneSessionState(live) {
    const sessions = (live && live.sessions) || [];
    const alive = new Set(sessions.map((s) => s.sessionId));
    if (!alive.size) return;
    let changed = false;
    for (const map of [st.openCards, st.openAgents, st.showDone]) {
      for (const id of Object.keys(map)) {
        if (!alive.has(id)) {
          delete map[id];
          changed = true;
        }
      }
    }
    // Fold choices are keyed by agent id, so the session sweep above never
    // reaches them — a machine that runs subagents all day would otherwise grow
    // this blob forever. Guarded on a non-empty set: live sessions that simply
    // have not delegated yet must not wipe a fold the user just made.
    const agents = new Set();
    for (const s of sessions) for (const a of s.agents || []) agents.add(a.id);
    if (agents.size) {
      for (const id of Object.keys(st.foldedAgents)) {
        if (!agents.has(id)) {
          delete st.foldedAgents[id];
          changed = true;
        }
      }
    }
    if (changed) saveState();
  }

  // Keeps the attention dots on the tab bar current without a full re-render.
  // Patched rather than reassigned so a dot that was already there keeps its
  // pulse going instead of restarting on every poll.
  function refreshTabDots() {
    const bar = app.querySelector('.tabs');
    if (!bar) return;
    U.morphOuter(bar, tabBar());
  }

  vscode.postMessage({ type: 'ready' });
})();
