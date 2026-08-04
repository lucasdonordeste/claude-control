/* Claude Control — tab bodies.
   Each build* function takes the whole state object and returns HTML. No DOM
   access and no message posting: main.js owns both. */
(function () {
  const CC = (window.CC = window.CC || {});
  const I = CC.I;
  const U = CC.ui;
  const { esc, tr, kfmt, bytes, leftTime, ago, minutesLabel, shortPath, ucolor } = U;

  const sec = (st, id, icon, title, count, body) =>
    U.section(id, icon, title, count, body, !!st.collapsed[id]);

  // One switch, three tabs. Live, Metrics and Doctor all narrow to the open
  // workspace, so they share a single scope rather than each keeping its own —
  // a panel where two tabs disagree about what "this project" means is worse
  // than no filter at all. `hidden` reports what the scope is holding back, so
  // the filter never silently looks like an empty result.
  function scopeBar(st, hidden) {
    const on = !!(st.model.global && st.model.global.projectScope);
    return (
      `<div class="livebar">` +
      U.toggleRow(tr('live.onlyThisProject'), on, 'toggleProjectScope', {}, true) +
      (on && hidden ? `<div class="scopenote">${esc(tr('scope.hidden', hidden))}</div>` : '') +
      `</div>`
    );
  }

  // ============================================================ LIVE ==========

  // Statuses Claude Code reports in the session registry, plus the one we derive
  // ("waiting" — a question on screen with nobody answering it).
  const STATUS_TONE = {
    busy: 'busy',
    shell: 'shell',
    idle: 'idle',
    waiting: 'waiting',
    ended: 'ended',
  };

  function statusLabel(s) {
    const key = 'status.' + s;
    const got = tr(key);
    return got === key ? s : got;
  }

  function modelBadge(s) {
    if (!s.model) return '';
    return U.badge(s.model, 'model');
  }

  // An unknown verb must not render as the literal key `activity.foo`.
  function verbLabel(verb) {
    const label = tr('activity.' + verb);
    return label === 'activity.' + verb ? verb : label;
  }

  function activityLine(a) {
    if (!a) return '';
    const text = verbLabel(a.verb);
    // No pulse here. The card header already has a pulsing status LED, and every
    // agent row has its own — repeating it on each activity line meant sixteen
    // blinking dots on a card with eight live agents.
    return (
      `<div class="doing ${a.running ? 'live' : 'past'}">` +
      `<span class="doing-v">${esc(text)}</span>` +
      (a.target ? `<span class="doing-t">${esc(a.target)}</span>` : '') +
      `</div>`
    );
  }

  // The checklist is the most legible thing on a session card — it says what the
  // work *is*, not just what the current tool call is — so it stays visible
  // rather than hiding behind the expander. Long lists are windowed around the
  // item in progress, which is the row you actually came to read.
  const TASKS_VISIBLE = 6;

  function taskBlock(t) {
    if (!t) return '';
    const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
    let h = `<div class="tasks">`;
    h +=
      `<div class="tasks-h"><span>${esc(tr('usage.tasksDone', t.done, t.total))}</span>` +
      `<span class="tasks-bar"><span style="width:${pct}%"></span></span></div>`;

    const items = t.items || [];
    if (items.length) {
      const at = items.findIndex((i) => i.status === 'in_progress');
      let from = 0;
      if (items.length > TASKS_VISIBLE && at > -1) {
        from = Math.min(Math.max(0, at - 1), items.length - TASKS_VISIBLE);
      }
      const slice = items.slice(from, from + TASKS_VISIBLE);
      const MARK = { completed: 'done', in_progress: 'run' };
      h += `<div class="tlist">`;
      h += slice
        .map(
          (i) =>
            `<div class="tli ${esc(own(MARK, i.status, ''))}"><span class="tlm"></span>` +
            `<span class="tlt">${esc(i.subject)}</span></div>`
        )
        .join('');
      const rest = items.length - (from + slice.length) + from;
      if (rest > 0) h += `<div class="tli more">${esc(tr('live.moreTasks', rest))}</div>`;
      h += `</div>`;
    } else if (t.doing) {
      h += `<div class="tasks-now">${esc(t.doing)}</div>`;
    }
    return h + `</div>`;
  }

  // One agent in the tree. Everything that identifies it — what kind it is, which
  // model it burns, how much it has spent, when it last moved — on one meta line,
  // with its own activity underneath while it is still working. All of this was
  // already being collected; showing it is what makes the tree readable rather
  // than just a list of names.
  function agentRow(a, folded) {
    const indent = Math.min(a.depth, 5);
    const kids = a.descendants || 0;
    const bits = [];
    if (a.model) bits.push(esc(a.model));
    if (a.tokens) bits.push(esc(kfmt(a.tokens)));
    if (a.lastActivityAt) bits.push(esc(ago(a.lastActivityAt)));
    return (
      `<div class="arow ${a.running ? 'run' : 'done'} ${kids ? 'has-kids' : ''}" style="--d:${indent}">` +
      `<span class="aline"></span>` +
      (kids
        ? `<span class="afold ${folded ? 'closed' : ''}" data-act="foldAgent" data-aid="${esc(a.id)}" ` +
          `data-folded="${folded ? '1' : '0'}" ` +
          `role="button" tabindex="0" aria-expanded="${!folded}" ` +
          `title="${esc(tr(folded ? 'live.unfoldBranch' : 'live.foldBranch', kids))}">${I.chevron}</span>`
        : `<span class="afold empty"></span>`) +
      `<span class="adot ${a.running ? 'run' : 'done'}"></span>` +
      `<div class="abody">` +
      `<div class="al">${esc(a.description || a.agentType)}</div>` +
      `<div class="am">${U.badge(a.agentType, 'agent')}` +
      (bits.length ? `<span class="atok">${bits.join(' · ')}</span>` : '') +
      (kids && folded ? `<span class="akids">${esc(tr('live.subBranch', kids))}</span>` : '') +
      `</div>` +
      (a.running && a.activity
        ? `<div class="aact">` +
          `<span class="aact-v">${esc(verbLabel(a.activity.verb))}</span>` +
          (a.activity.target ? `<span class="aact-t">${esc(a.activity.target)}</span>` : '') +
          `</div>`
        : '') +
      `</div>` +
      `<span class="go" data-act="open" data-path="${esc(a.path)}">${I.go}</span>` +
      `</div>`
    );
  }

  // Walks the depth-first list, skipping anything under a folded ancestor. The
  // list is already ordered so a node's subtree immediately follows it, which is
  // what makes a single depth comparison enough to fold a whole branch.
  //
  // Folding is tri-state, and that is the point. A branch where nothing is left
  // running folds *by default*, at every depth — that is what lets the finished
  // agents stay in the tree without burying the two still working. `foldedAgents`
  // only ever holds an explicit choice, and an explicit choice always wins, so
  // opening a finished branch keeps it open and closing a live one keeps it shut.
  function treeRows(st, list) {
    const out = [];
    let skipBelow = -1;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (skipBelow >= 0) {
        if (a.depth > skipBelow) continue;
        skipBelow = -1;
      }
      const kids = a.descendants || 0;
      // Read the subtree off the flat list: buildTree guarantees a node's
      // descendants are exactly the next `kids` entries.
      const branchDone =
        !a.running && !list.slice(i + 1, i + 1 + kids).some((x) => x.running);
      const choice = st.foldedAgents ? st.foldedAgents[a.id] : undefined;
      const folded = kids > 0 && (choice === undefined ? branchDone : !!choice);
      out.push(agentRow(a, folded));
      if (folded) skipBelow = a.depth;
    }
    return out.join('');
  }

  function agentBlock(st, s) {
    const list = s.agents || [];
    if (!list.length) return '';
    const running = list.filter((a) => a.running).length;
    // The tree is the session's record of delegated work, so nothing is deleted —
    // but a finished *leaf* cannot be folded (folding a childless node hides
    // nothing), and thirteen of those is the clutter this was supposed to avoid.
    // So finished top-level branches leave the tree entirely and become a count,
    // and the count opens. Live branches keep their internal folding.
    const shown = [];
    const hidden = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.depth !== 0) continue; // subtrees travel with their root
      const subtree = list.slice(i, i + 1 + (a.descendants || 0));
      (subtree.some((x) => x.running) ? shown : hidden).push(...subtree);
    }
    const doneTokens = hidden.reduce((n, a) => n + (a.tokens || 0), 0);
    const revealDone = !!(st.showDone && st.showDone[s.sessionId]);
    // The tree is the answer to "what did this session delegate", so it opens by
    // default — the old rule closed it the moment the last agent returned, which
    // is when you go looking. `whileRunning` keeps that rule for whoever wants
    // it; an explicit click outranks all of them.
    const pref = (st.model && st.model.global && st.model.global.expandAgents) || 'always';
    const byPref = pref === 'never' ? false : pref === 'whileRunning' ? shown.length > 0 : true;
    const choice = st.openAgents ? st.openAgents[s.sessionId] : undefined;
    const open = choice === undefined ? byPref : !!choice;
    return (
      `<div class="agents ${open ? '' : 'collapsed'}">` +
      `<div class="agents-h" data-act="toggleAgents" data-sid="${esc(s.sessionId)}" ` +
      `data-open="${open ? '1' : '0'}" role="button" tabindex="0" aria-expanded="${open}">` +
      `<span class="chev">${I.chevron}</span>` +
      `<span class="ic">${I.node}</span>` +
      `<span>${esc(tr('live.agents', list.length))}</span>` +
      (running ? `<span class="run-pill">${esc(tr('live.agentsRunning', running))}</span>` : '') +
      `</div>` +
      `<div class="agents-b">${treeRows(st, shown)}` +
      (hidden.length
        ? `<div class="adone ${revealDone ? 'open' : ''}" data-act="toggleDone" ` +
          `data-sid="${esc(s.sessionId)}" role="button" tabindex="0" aria-expanded="${revealDone}">` +
          `<span class="chev">${I.chevron}</span>` +
          `${esc(tr('live.agentsDone', hidden.length, kfmt(doneTokens)))}</div>` +
          (revealDone ? treeRows(st, hidden) : '')
        : '') +
      `</div>` +
      `</div>`
    );
  }

  // What the session has been doing, most recent first. The collapsed card shows
  // the current instant; this shows the trajectory that led to it.
  function recentBlock(list) {
    if (!list || !list.length) return '';
    return (
      `<div class="trail">` +
      list
        .map((c) => {
          const verb = verbLabel(c.verb);
          return (
            `<div class="trow ${c.running ? 'run' : ''}">` +
            `<span class="tdot"></span>` +
            `<span class="tverb">${esc(verb)}</span>` +
            `<span class="ttarget">${esc(c.target || c.name)}</span>` +
            `</div>`
          );
        })
        .join('') +
      `</div>`
    );
  }

  // Two live sessions in the same directory. Named, not fixed: the panel does not
  // rearrange anyone's checkouts. Shown on the card rather than behind the fold,
  // because by the time you open a card to investigate, they have already been
  // writing over each other for a while.
  function contestedLine(s) {
    if (!s.contested) return '';
    return (
      `<div class="contested" title="${esc(tr('live.contested.help'))}">` +
      `<span class="ct-ic">${I.warn}</span>` +
      `<span>${esc(tr('live.contested'))}</span>` +
      `</div>`
    );
  }

  function detailBlock(st, s) {
    if (!st.openCards || !st.openCards[s.sessionId]) return '';
    let h = `<div class="detail">`;
    if (s.lastPrompt) {
      h +=
        `<div class="dsec"><div class="dlbl">${esc(tr('live.lastPrompt'))}</div>` +
        `<div class="dprompt">${esc(s.lastPrompt.slice(0, 400))}</div></div>`;
    }
    if (s.recent && s.recent.length) {
      h += `<div class="dsec"><div class="dlbl">${esc(tr('live.recent'))}</div>${recentBlock(s.recent)}</div>`;
    }
    const meta = [];
    // A session in its own linked worktree cannot collide with the others — the
    // reassuring counterpart to the contested warning.
    if (s.worktree) {
      meta.push(
        tr('live.worktree') + (s.worktree.branch ? `: ${s.worktree.branch}` : ` (${tr('live.detached')})`)
      );
    }
    if (s.tier) meta.push(`${tr('usage.tier')}: ${s.tier}`);
    if (s.pid) meta.push(`pid ${s.pid}`);
    if (s.version) meta.push(`v${s.version}`);
    if (s.slug) meta.push(s.slug);
    if (meta.length) h += `<div class="dmeta">${esc(meta.join(' · '))}</div>`;
    return h + `</div>`;
  }

  // Own-property lookup, or a status of "constructor" resolves to an inherited
  // Object.prototype member and lands in the class attribute. Both `status` and
  // task `status` come from files on disk / model output.
  const own = (obj, k, fallback) =>
    Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : fallback;

  function sessionCard(st, s) {
    const tone = own(STATUS_TONE, s.status, 'idle');
    const pct = s.window ? Math.round((s.tokens / s.window) * 100) : 0;
    let h = `<div class="card card-${tone}" data-card="${esc(s.sessionId)}">`;

    const open = !!(st.openCards && st.openCards[s.sessionId]);
    h +=
      `<div class="card-h ${open ? 'open' : ''}" data-act="toggleCard" data-sid="${esc(s.sessionId)}" ` +
      `role="button" tabindex="0" aria-expanded="${open}">`;
    h += `<span class="statled s-${tone}" title="${esc(statusLabel(s.status))}"></span>`;
    h += `<div class="card-t"><div class="t1">${esc(s.title || s.name || s.slug || tr('live.untitled'))}</div>`;
    h += `<div class="t2">`;
    h += modelBadge(s);
    if (s.effort) h += U.badge(s.effort, 'effort');
    // `mode` and `permissionMode` are separate concepts that frequently hold the
    // same word ("plan"); showing both then reads as a rendering bug.
    if (s.mode && s.mode !== 'normal') h += U.badge(s.mode, 'mode');
    if (s.permissionMode && s.permissionMode !== s.mode) h += U.badge(s.permissionMode, 'perm');
    if (s.branch) h += `<span class="t2i">${I.branch}${esc(s.branch)}</span>`;
    if (s.startedAt) h += `<span class="t2i">${I.clock}${esc(ago(s.startedAt))}</span>`;
    // Uptime says how long it has been going; this says whether it is still
    // moving — the difference between a session working and one wedged.
    if (s.lastActivityAt) {
      // Its own icon, or it reads as one value glued to the uptime ("1h 2s").
      h +=
        `<span class="t2i last" title="${esc(tr('live.lastMoved'))}">` +
        `${I.live}${esc(ago(s.lastActivityAt))}</span>`;
    }
    h += `</div></div>`;
    h += `<span class="card-x">${I.chevron}</span>`;
    h += `</div>`;

    if (s.waiting) {
      h +=
        `<div class="asking"><span class="ask-ic">${I.alert}</span>` +
        `<div><b>${esc(tr('live.waitingYou'))}</b>` +
        (s.question ? `<div class="ask-q">${esc(s.question)}</div>` : '') +
        `</div></div>`;
    }

    if (s.tokens) h += U.meter(`${kfmt(s.tokens)}/${kfmt(s.window)}`, pct, '', ucolor(pct));
    h += activityLine(s.activity);
    h += contestedLine(s);
    h += taskBlock(s.tasks);
    h += agentBlock(st, s);
    h += detailBlock(st, s);

    // Four buttons wrapped onto two rows at sidebar width and gave equal weight
    // to actions of very unequal value. One primary action, one that answers the
    // question you actually have about a session touching your repo, and an
    // overflow for the rest — including the destructive one, which is rare and
    // is better behind a deliberate step.
    h += `<div class="card-a">`;
    h += U.btn(
      tr(s.kind && s.kind !== 'interactive' ? 'act.attach' : 'act.resume'),
      I.play,
      'resumeSession',
      { sid: s.sessionId, cwd: s.cwd, kind: s.kind || '', alive: s.alive ? '1' : '' }
    );
    h += U.btn(tr('act.files'), I.doc, 'sessionFiles', { sid: s.sessionId, cwd: s.cwd });
    h += U.btn('', I.dots, 'sessionMenu', {
      sid: s.sessionId,
      cwd: s.cwd,
      pid: s.pid || 0,
      kind: s.kind || '',
      workspace: s.isWorkspace ? '1' : '',
      name: s.title || s.name || s.sessionId,
    });
    h += `</div>`;

    return h + `</div>`;
  }

  function buildLive(st) {
    const all = st.live || { groups: [], total: 0, waiting: 0, agents: 0 };
    let h = '';

    const summary =
      `<span class="path">` +
      esc(tr('live.summary', all.total, all.agents)) +
      `</span>`;
    h += `<div class="scope"><span class="dot ${all.total ? '' : 'dot-idle'}"></span>${esc(tr('scope.live'))}${summary}</div>`;

    if (!all.total) {
      // With the scope on and sessions running elsewhere, "nothing is running"
      // would be a lie — say what is being hidden and leave the switch in reach.
      // The pet rides along on these paths too: "nothing is running" is exactly
      // when it is curled up asleep, and returning early here would have made
      // that — its most common state — the one you could never see.
      if (all.hidden) {
        return (
          h +
          scopeBar(st, all.hidden) +
          `<div class="empty">${esc(tr('live.noneHere'))}</div>` +
          petBlock(st, all)
        );
      }
      return (
        h +
        `<div class="empty">${esc(tr('live.none'))}</div>` +
        `<div class="hintbox">${esc(tr('live.noneHint'))}</div>` +
        petBlock(st, all)
      );
    }

    if (all.waiting) {
      h +=
        `<div class="alert alert-warn"><span class="ic">${I.alert}</span>` +
        `<div>${esc(tr('live.waitingBanner', all.waiting))}</div></div>`;
    }

    h += scopeBar(st, all.hidden);

    for (const g of all.groups) {
      h +=
        `<div class="scope sub"><span class="dot ${g.isWorkspace ? '' : 'dot-idle'}"></span>${esc(g.name)}` +
        (g.isWorkspace ? `<span class="path">${esc(tr('live.thisProject'))}</span>` : '') +
        `</div>`;
      h += g.sessions.map((s) => sessionCard(st, s)).join('');
    }
    h += petBlock(st, all);
    return h;
  }

  // Pure: what the pet is doing, from what the sessions are doing. Order is a
  // priority, not a guess — being needed outranks being busy, which outranks
  // being merely alive.
  function petMood(live) {
    if (!live || !live.total) return 'asleep';
    if (live.waiting) return 'alert';
    const busy = (live.groups || []).some((g) =>
      (g.sessions || []).some((s) => s.status === 'busy')
    );
    return busy ? 'working' : 'idle';
  }

  // A cat, drawn here rather than borrowed: vscode-pets is MIT but its sprites
  // are individual artists' work under no stated licence, so this is our own
  // line art in the panel's own accent. Peripheral vision, not decoration — the
  // shape tells you whether anything needs you without reading a word.
  function petBlock(st, live) {
    const g = st.model && st.model.global;
    if (!g || !g.pet) return '';
    const mood = petMood(live);
    return (
      `<div class="pet pet-${mood}" title="${esc(tr('pet.' + mood))}" role="img" ` +
      `aria-label="${esc(tr('pet.' + mood))}">` +
      `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.6" ` +
      `stroke-linecap="round" stroke-linejoin="round">` +
      // body and head
      `<path class="p-body" d="M14 32c0-7 5-11 11-11h6c6 0 11 4 11 11"/>` +
      `<path class="p-head" d="M42 21a8 8 0 1 1 0-.5"/>` +
      // ears
      `<path class="p-ear" d="M36 14l1.5-5 4 3.5M48 14l-1.5-5-4 3.5"/>` +
      // eyes: two dots open, two lines shut — swapped by CSS per mood
      `<path class="p-eye-open" d="M40 20v.6M46.5 20v.6"/>` +
      `<path class="p-eye-shut" d="M38.5 20.5h3M45 20.5h3"/>` +
      // tail, animated
      `<path class="p-tail" d="M14 32c-5 0-7-4-6-8"/>` +
      // legs
      `<path d="M20 32v4M28 32v4M36 32v4"/>` +
      // floor
      `<path class="p-floor" d="M8 36.5h48" opacity=".25"/>` +
      // sleep marks, shown only when asleep
      `<path class="p-z" d="M50 8h4l-4 5h4"/>` +
      `</svg></div>`
    );
  }

  // ========================================================== METRICS =========

  function burnLine(label, burn, pct) {
    if (!burn) return '';
    const rate = burn.ratePerHour;
    const dir = rate > 0.05 ? '+' : '';
    const left =
      burn.minutesLeft != null
        ? tr('metrics.fullIn', minutesLabel(burn.minutesLeft))
        : burn.resetsFirst
          ? tr('metrics.resetsFirst')
          : tr('metrics.notFilling');
    const tone = burn.minutesLeft != null && burn.minutesLeft < 60 ? 'danger' : '';
    return (
      `<div class="burn ${tone ? 'burn-' + tone : ''}">` +
      `<span class="burn-l">${esc(label)}</span>` +
      `<span class="burn-r">${esc(dir + rate.toFixed(1))}%/h</span>` +
      `<span class="burn-e">${esc(left)}</span></div>`
    );
  }

  function buildMetrics(st) {
    const u = st.usage;
    let h = '';

    // --- plan windows (the live numbers) ---
    h += U.scope(tr('scope.usage'), tr('usage.live', st.pollSeconds));
    if (u === undefined) {
      h += `<div class="empty">${esc(tr('boot.loading'))}</div>`;
    } else if (!u) {
      const msg =
        st.usageState === 'ratelimited'
          ? tr('usage.ratelimited')
          : st.usageState === 'error'
            ? tr('usage.error')
            : tr('usage.notoken');
      h += `<div class="empty">${esc(msg)}</div>`;
    } else {
      const fh = u.five_hour || {};
      const sd = u.seven_day || {};
      let bars = '';
      if (fh.utilization != null) bars += U.meter(tr('usage.session'), fh.utilization, leftTime(fh.resets_at));
      if (sd.utilization != null) bars += U.meter(tr('usage.week'), sd.utilization, leftTime(sd.resets_at));
      const staleNote =
        st.usageState === 'stale' ? `<div class="usenote">${esc(tr('usage.stale'))}</div>` : '';
      h += `<div class="usebox">${bars || `<div class="empty">${esc(tr('empty.usageData'))}</div>`}${staleNote}</div>`;

      // --- burn rate: the projection nothing else gives you ---
      const b5 = st.burn && st.burn.five;
      const b7 = st.burn && st.burn.week;
      if (b5 || b7) {
        h += U.scope(tr('scope.burn'));
        h += `<div class="usebox">`;
        h += burnLine(tr('usage.session'), b5, fh.utilization);
        h += burnLine(tr('usage.week'), b7, sd.utilization);
        h += `<div class="usenote">${esc(tr('metrics.burnNote'))}</div>`;
        h += `</div>`;
      }
    }

    // --- trend ---
    const hist = st.history || [];
    if (hist.length > 1) {
      h += U.scope(tr('scope.trend'), tr('trend.points', hist.length));
      const block = (label, pts) => {
        const latest = [...pts].reverse().find((v) => v != null);
        const c = latest == null ? 'var(--mute)' : ucolor(latest);
        const svg = U.sparkline(pts, c);
        return svg
          ? `<div class="sparkrow"><div class="sparklbl"><span>${esc(label)}</span>` +
              `<span style="color:${c}">${latest == null ? '' : Math.round(latest) + '%'}</span></div>${svg}</div>`
          : '';
      };
      h += block(tr('usage.sessionTrend'), hist.map((p) => p.s));
      h += block(tr('usage.weekTrend'), hist.map((p) => p.w));
    }

    // --- token analytics from the transcripts ---
    const m = st.metrics;
    h += U.scope(tr('scope.tokens'), m ? tr('metrics.window', m.days_) : '');
    h += scopeBar(st, m && m.hiddenByScope);
    if (!m) {
      h += `<div class="empty">${esc(tr('metrics.scanning'))}</div>`;
      return h;
    }
    if (!m.total.turns) {
      h += `<div class="empty">${esc(tr('metrics.noData'))}</div>`;
      return h;
    }

    h += `<div class="stats">`;
    h += U.stat(kfmt(m.total.total), tr('metrics.totalTokens'));
    h += U.stat(kfmt(m.total.turns), tr('metrics.turns'));
    h += U.stat(kfmt(m.total.output), tr('metrics.output'));
    h += `</div>`;

    // Cache efficiency gets the ring: it is the one ratio worth optimising, and
    // in a stack of bars it would read as just another row.
    const chr = Math.round((m.total.cacheHitRate || 0) * 100);
    h +=
      `<div class="cachebox">` +
      U.donut(chr, tr('metrics.cache'), chr >= 80 ? 'var(--led-on)' : chr >= 50 ? 'var(--warn)' : 'var(--danger)') +
      `<div class="cache-t"><div class="cache-h">${esc(tr('metrics.cacheTitle'))}</div>` +
      `<div class="cache-d">${esc(tr('metrics.cacheDesc'))}</div>` +
      `<div class="cache-n">${esc(kfmt(m.total.cacheRead))} ${esc(tr('metrics.cacheRead'))} · ` +
      `${esc(kfmt(m.total.cacheCreate))} ${esc(tr('metrics.cacheWritten'))}</div></div></div>`;

    // --- daily columns ---
    const series = m.series || [];
    if (series.length) {
      h += U.scope(tr('scope.daily'), tr('metrics.days', m.seriesDays || series.length));
      h += U.columns(
        series,
        (d) => d.total,
        (d) => `${d.day} · ${kfmt(d.total)} · ${d.turns} ${tr('metrics.turns')}`
      );
      h +=
        `<div class="colsx"><span>${esc(series[0].day.slice(5))}</span>` +
        `<span>${esc(series[series.length - 1].day.slice(5))}</span></div>`;
    }

    // --- by project / by model ---
    if (m.projects.length > 1) {
      h += U.scope(tr('scope.byProject'));
      h += U.ranked(
        m.projects.slice(0, 8).map((p) => ({ name: p.name, value: p.total, display: kfmt(p.total) }))
      );
    }
    // What it did, not just what it cost. The error column is the point: a tool
    // failing one call in three is a broken setup nobody is being told about.
    if (m.tools && m.tools.length) {
      const totalCalls = m.tools.reduce((n, t) => n + t.calls, 0);
      h += U.scope(tr('scope.tools'), tr('metrics.calls', kfmt(totalCalls)));
      h += m.tools
        .slice(0, 8)
        .map((t) => {
          const pct = Math.round(t.errorRate * 100);
          return (
            `<div class="hrow"><span class="hlbl" title="${esc(t.name)}">${esc(t.name)}</span>` +
            `<span class="hbar"><span class="hfill" style="width:${Math.max(2, (t.calls / m.tools[0].calls) * 100)}%"></span></span>` +
            `<span class="hval">${esc(kfmt(t.calls))}</span>` +
            `<span class="herr ${pct >= 10 ? 'bad' : ''}">${t.errors ? pct + '%' : ''}</span></div>`
          );
        })
        .join('');
    }

    // When the work actually happens. Twenty-four buckets of local hour.
    if (m.hours && m.hours.some((n) => n)) {
      const peakHour = m.hours.indexOf(Math.max(...m.hours));
      h += U.scope(tr('scope.rhythm'), tr('metrics.peakHour', peakHour));
      h += U.columns(
        m.hours.map((n, i) => ({ n, i })),
        (d) => d.n,
        (d) => `${String(d.i).padStart(2, '0')}:00 — ${kfmt(d.n)}`
      );
      h += `<div class="colsx"><span>00h</span><span>12h</span><span>23h</span></div>`;
    }

    if (m.models.length) {
      h += U.scope(tr('scope.byModel'));
      h += U.ranked(
        m.models.slice(0, 6).map((p) => ({
          name: p.name.replace(/^claude-/, ''),
          value: p.total,
          display: kfmt(p.total),
        }))
      );
    }
    h += `<div class="usenote">${esc(tr('metrics.footnote'))}</div>`;
    return h;
  }

  // =========================================================== DOCTOR =========

  const SEV_ICON = { error: 'alert', warn: 'warn', info: 'info' };

  function finding(f) {
    const title = tr(f.key, ...(f.args || []));
    const detail = f.detailKey ? tr(f.detailKey, ...(f.detailArgs || [])) : '';
    let h = `<div class="finding f-${esc(f.severity)}">`;
    h += `<span class="fic">${I[SEV_ICON[f.severity] || 'info']}</span>`;
    h += `<div class="fbody"><div class="ftitle">${esc(title)}</div>`;
    if (detail) h += `<div class="fdetail">${esc(shortPath(detail, 120))}</div>`;
    if (f.fix) {
      const fix = f.fix;
      h += `<div class="factions">`;
      if (fix.action === 'fixSecret') {
        h += U.btn(tr('fix.moveToEnv'), I.key, 'fixSecret', {
          path: fix.path,
          segments: JSON.stringify(fix.segments),
          env: fix.envName,
          masked: fix.masked || '',
        });
        h += U.btn(tr('fix.openFile'), I.doc, 'open', { path: fix.path });
      } else if (fix.action === 'open') {
        h += U.btn(tr('fix.openFile'), I.doc, 'open', { path: fix.path });
      } else if (fix.action === 'chmodHook') {
        h += U.btn(tr('fix.makeExec'), I.bolt, 'chmodHook', { path: fix.path });
      } else if (fix.action === 'mcpLogin') {
        h += U.btn(tr('fix.mcpLogin'), I.plug, 'mcpLogin', { name: fix.name });
      } else if (fix.action === 'installHooks') {
        h += U.btn(tr('act.installHooks'), I.bolt, 'installHooks', {});
      } else if (fix.action === 'cleanStaleSessions') {
        h += U.btn(tr('fix.cleanStale'), I.broom, 'cleanStaleSessions', {});
      }
      h += `</div>`;
    }
    h += `<button class="fdismiss" data-act="ignoreFinding" data-id="${esc(f.id)}" ` +
      `title="${esc(tr('fix.dismissHint'))}">${esc(tr('fix.dismiss'))}</button>`;
    return h + `</div></div>`;
  }

  function buildDoctor(st) {
    const d = st.doctor;
    let h = '';
    h += U.scope(tr('scope.doctor'), d ? tr('doctor.checked', d.checkedFiles) : '');
    if (!d) return h + `<div class="empty">${esc(tr('boot.loading'))}</div>`;

    const c = d.counts;
    h += `<div class="stats">`;
    h += U.stat(String(c.error), tr('doctor.errors'), c.error ? 'danger' : 'ok');
    h += U.stat(String(c.warn), tr('doctor.warnings'), c.warn ? 'warn' : 'ok');
    h += U.stat(String(c.info), tr('doctor.notes'));
    h += `</div>`;

    h += scopeBar(st, d.hiddenByScope);

    if (d.dismissed) {
      h += `<div class="usenote">${esc(tr('doctor.dismissed', d.dismissed))} ` +
        `<button class="btn btn-ghost" data-act="clearIgnored">${esc(tr('doctor.unDismiss'))}</button></div>`;
    }

    if (!d.findings.length) {
      h += `<div class="allgood"><span>${I.shield}</span><div><b>${esc(tr('doctor.allGood'))}</b>` +
        `<div>${esc(tr('doctor.allGoodHint'))}</div></div></div>`;
    } else {
      h += `<div class="findings">${d.findings.map(finding).join('')}</div>`;
    }

    // --- disk ---
    h += U.scope(tr('scope.disk'));
    const disk = st.disk;
    if (st.diskScanning) {
      h += `<div class="empty">${esc(tr('doctor.diskScanning'))}</div>`;
    } else if (!disk) {
      h += `<div class="row click act" data-act="scanDisk" role="button" tabindex="0">` +
        `<span class="ic">${I.disk}</span><div class="body"><div class="l">${esc(tr('doctor.scanDisk'))}</div></div></div>`;
    } else if (!disk.length) {
      h += `<div class="empty">${esc(tr('empty.generic'))}</div>`;
    } else {
      const total = disk.reduce((a, b) => a + b.bytes, 0);
      h += `<div class="usenote">${esc(tr('doctor.diskTotal', bytes(total)))}</div>`;
      for (const dd of disk) {
        h += `<div class="drow"><span class="dnm">${esc(dd.key)}</span>`;
        h += `<span class="dsz">${esc(bytes(dd.bytes))}</span>`;
        h += dd.safe
          ? U.btn(tr('act.clean'), I.broom, 'cleanDir', { key: dd.key, size: bytes(dd.bytes) }, 'danger')
          : `<span class="dkeep">${esc(tr('doctor.keep'))}</span>`;
        h += `</div>`;
      }
      h += `<div class="row click act" data-act="archiveTranscripts" role="button" tabindex="0">` +
        `<span class="ic">${I.disk}</span><div class="body"><div class="l">${esc(tr('act.archive'))}</div>` +
        `<div class="d">${esc(tr('act.archiveHint'))}</div></div></div>`;
    }
    return h;
  }

  // =========================================================== GLOBAL =========

  function pluginRow(p) {
    return (
      `<div class="row">` +
      `<span class="led ${p.enabled ? 'on' : ''}"></span>` +
      `<div class="body"><div class="l">${esc(p.name)}</div></div>` +
      `<div class="sw ${p.enabled ? 'on' : ''}" role="switch" tabindex="0" aria-checked="${p.enabled}" ` +
      `aria-label="${esc(p.name)}" data-act="togglePlugin" data-key="${esc(p.key)}"></div>` +
      `</div>`
    );
  }

  function marketRow(p) {
    return (
      `<div class="row click" data-act="installPlugin" data-name="${esc(p.name)}" ` +
      `data-marketplace="${esc(p.marketplace)}" role="button" tabindex="0">` +
      `<span class="ic">${I.download}</span>` +
      `<div class="body"><div class="l">${esc(p.name)}</div>` +
      (p.description ? `<div class="d">${esc(p.description)}</div>` : '') +
      `</div><span class="go">${I.go}</span></div>`
    );
  }

  function hookRow(hk) {
    const managed = hk.source ? hk.source.replace('template:', '') : '';
    return (
      `<div class="row">` +
      `<span class="ic">${I.bolt}</span>` +
      `<div class="body"><div class="l">${esc(hk.event)}${hk.matcher ? ' · ' + esc(hk.matcher) : ''}` +
      (managed ? ` ${U.badge(managed, 'managed')}` : '') +
      `</div><div class="d">${esc(hk.command)}</div></div>` +
      `<span class="del" data-act="removeHook" data-event="${esc(hk.event)}" ` +
      `data-command="${esc(hk.command)}" role="button" tabindex="0" ` +
      `aria-label="${esc(tr('act.remove'))}">${I.trash}</span></div>`
    );
  }

  function fileRows(list, icon, emptyTxt) {
    if (!list.length) return `<div class="empty">${esc(emptyTxt || tr('empty.generic'))}</div>`;
    return list
      .map((f) => U.linkRow(icon, f.name, f.description, f.path, f.source && f.source !== 'user' ? f.source : ''))
      .join('');
  }

  // Project MCP servers arrive as bare names with no file behind them; rendering
  // them as openable rows produced a click that could only ever fail.
  function mcpRows(list, file) {
    if (!list.length) return `<div class="empty">${esc(tr('empty.mcp'))}</div>`;
    return list
      .map((m) => {
        const name = typeof m === 'string' ? m : m.name;
        const target = (typeof m === 'string' ? file : m.file) || '';
        if (target) return U.linkRow(I.plug, name, '', target);
        return (
          `<div class="row"><span class="ic">${I.plug}</span>` +
          `<div class="body"><div class="l">${esc(name)}</div></div></div>`
        );
      })
      .join('');
  }

  function buildGlobal(st) {
    const g = st.model.global;
    let h = U.scope(tr('scope.global'), '~/.claude');

    h += sec(st, 'g-plugins', I.puzzle, tr('sec.plugins'), g.plugins.length,
      g.plugins.length ? g.plugins.map(pluginRow).join('') : `<div class="empty">${esc(tr('empty.plugins'))}</div>`);

    const mk = g.marketplace || [];
    h += sec(st, 'g-market', I.download, tr('sec.market'), mk.length,
      mk.length ? mk.map(marketRow).join('') : `<div class="empty">${esc(tr('empty.market'))}</div>`);

    h += sec(st, 'g-skills', I.sparkle, tr('sec.skills'), g.skills.length,
      fileRows(g.skills, I.sparkle, tr('empty.skills')) + U.actionRow(tr('act.newSkill'), 'newSkill'));

    h += sec(st, 'g-agents', I.agent, tr('sec.agents'), (g.agents || []).length,
      fileRows(g.agents || [], I.agent, tr('empty.agents')) + U.actionRow(tr('act.newAgent'), 'newAgent'));

    h += sec(st, 'g-cmd', I.terminal, tr('sec.commands'), (g.commands || []).length,
      fileRows(g.commands || [], I.terminal, tr('empty.commands')) + U.actionRow(tr('act.newCommand'), 'newCommand'));

    const plans = g.plans || [];
    h += sec(st, 'g-plans', I.doc, tr('sec.plans'), plans.length, fileRows(plans, I.doc, tr('empty.plans')));

    h += sec(st, 'g-mcp', I.plug, tr('sec.mcp'), g.mcp.length,
      mcpRows(g.mcp) + U.actionRow(tr('act.addMcp'), 'addMcp'));

    const hooks = g.hooks || [];
    h += sec(st, 'g-hooks', I.bolt, tr('sec.hooks'), hooks.length,
      (hooks.length ? hooks.map(hookRow).join('') : `<div class="empty">${esc(tr('empty.hooks'))}</div>`) +
        U.actionRow(tr('act.hookLibrary'), 'hookLibrary') +
        U.actionRow(tr('act.newHook'), 'newHook'));

    return h;
  }

  // ========================================================== PROJECT =========

  function buildProject(st) {
    const model = st.model;
    if (!model.projects.length) {
      return (
        U.scope(tr('scope.project'), '', 'idle') + `<div class="empty">${esc(tr('empty.openFolder'))}</div>`
      );
    }
    let h = '';
    model.projects.forEach((p, idx) => {
      const sk = 'p' + idx;
      h += U.scope(p.name, tr('scope.projectTag'));
      const filesBody = p.files.length
        ? p.files.map((f) => U.linkRow(f.kind === 'doc' ? I.doc : I.json, f.label, '', f.path)).join('')
        : `<div class="empty">${esc(tr('empty.projectFiles'))}</div>`;
      h += sec(st, sk + '-files', I.doc, tr('sec.files'), p.files.length, filesBody);
      if (p.commands.length)
        h += sec(st, sk + '-cmd', I.terminal, tr('sec.commands'), p.commands.length, fileRows(p.commands, I.terminal));
      if (p.skills.length)
        h += sec(st, sk + '-sk', I.sparkle, tr('sec.skills'), p.skills.length, fileRows(p.skills, I.sparkle));
      if (p.agents.length)
        h += sec(st, sk + '-ag', I.agent, tr('sec.agents'), p.agents.length, fileRows(p.agents, I.agent));
      if (p.mcp.length)
        h += sec(st, sk + '-mcp', I.plug, tr('sec.mcp'), p.mcp.length, mcpRows(p.mcp, p.mcpFile));
    });
    return h;
  }

  // ========================================================= SETTINGS =========

  function colorModeBlock(g) {
    const mode = g.colorMode || 'adaptive';
    let h = U.segmented(
      'setColorMode',
      ['adaptive', 'usage', 'custom', 'none'].map((m) => ({ value: m, label: tr('color.' + m) })),
      mode,
      'mode'
    );
    if (mode === 'custom') {
      const val = /^#([0-9a-f]{6})$/i.test(g.customColor || '') ? g.customColor : '#7aa2f7';
      h +=
        `<div class="colorpick"><input type="color" id="ccColor" value="${esc(val)}" ` +
        `aria-label="${esc(tr('cfg.customColor'))}" />` +
        `<span class="hex">${esc((g.customColor || val).toLowerCase())}</span></div>`;
    }
    return U.field(tr('cfg.statusBarColor'), h, tr('cfg.customColorHint'));
  }

  function permBucket(label, bucket, rules, tone) {
    const body = rules.length
      ? rules.map((r) => U.chip(r, 'removePermission', { bucket, rule: r }, tone)).join('')
      : `<span class="chip-empty">${esc(tr('cfg.noRules'))}</span>`;
    return (
      `<div class="permb"><div class="permh"><span class="permt permt-${tone}">${esc(label)}</span>` +
      `<button class="btn btn-ghost" data-act="addPermission" data-bucket="${esc(bucket)}">` +
      `<span class="bic">${I.plus}</span><span>${esc(tr('act.addRule'))}</span></button></div>` +
      `<div class="chips">${body}</div></div>`
    );
  }

  function buildSettings(st) {
    const g = st.model.global;
    const cfg = st.config || { permissions: { allow: [], ask: [], deny: [] }, env: {} };
    let h = U.scope(tr('scope.settings'));

    // --- notifications & status bar ---
    let body = '';
    if (g.soundReady || g.notifyReady) {
      if (g.soundReady) body += U.toggleRow(tr('toggle.sound'), g.sound, 'toggleSound');
      if (g.notifyReady) body += U.toggleRow(tr('toggle.notify'), g.notify, 'toggleNotify');
    } else {
      body += `<div class="empty">${esc(tr('empty.notifyUnset'))}</div>` +
        U.actionRow(tr('act.installHooks'), 'installHooks');
    }
    body += `<div class="divider"></div>`;
    body += U.toggleRow(tr('toggle.alertWaiting'), !!g.alertWaiting, 'toggleAlertWaiting');
    body += `<div class="divider"></div>`;
    body += U.toggleRow(tr('toggle.statusBar'), g.statusBar, 'toggleStatusBar');
    if (g.statusBar) {
      body +=
        `<div class="substack">` +
        U.toggleRow(tr('toggle.show5h'), g.show5h, 'toggleStatusItem', { key: 'show5h' }, true) +
        U.toggleRow(tr('toggle.show7d'), g.show7d, 'toggleStatusItem', { key: 'show7d' }, true) +
        U.toggleRow(tr('toggle.showContext'), g.showContext, 'toggleStatusItem', { key: 'showContext' }, true) +
        U.toggleRow(tr('toggle.showSessions'), g.showSessions, 'toggleStatusItem', { key: 'showSessions' }, true) +
        `</div>`;
      body += colorModeBlock(g);
    }
    h += sec(st, 's-config', I.gear, tr('sec.panel'), null, body);

    // --- Claude Code itself ---
    let cc = '';
    // A Bedrock/Vertex id, or any alias newer than this build, is not in the
    // preset list — and a segmented control with no match renders as *nothing*
    // selected, so the panel would report an unset model for a configured one.
    // Carry the actual value as its own option.
    const presets = st.modelPresets || [];
    const modelOpts = presets.map((m) => ({ value: m, label: m }));
    if (cfg.model && !presets.includes(cfg.model)) {
      modelOpts.push({ value: cfg.model, label: cfg.model });
    }
    cc += U.field(
      tr('cfg.model'),
      U.segmented('setModel', modelOpts, cfg.model, 'value'),
      tr('cfg.modelHint')
    );
    cc += U.field(
      tr('cfg.effort'),
      U.segmented(
        'setEffort',
        (st.effortLevels || []).map((m) => ({ value: m, label: tr('effort.' + m) })),
        cfg.effortLevel,
        'value'
      ),
      tr('cfg.effortHint')
    );
    cc += U.field(
      tr('cfg.defaultMode'),
      U.segmented(
        'setDefaultMode',
        (st.permissionModes || []).map((m) => ({ value: m, label: tr('permmode.' + m) })),
        cfg.defaultMode,
        'value'
      ),
      tr('cfg.defaultModeHint')
    );
    h += sec(st, 's-claude', I.cpu, tr('sec.claudeCode'), null, cc);

    // --- permissions ---
    const p = cfg.permissions;
    let perms = `<div class="cfg-hint pad">${esc(tr('cfg.permHint'))}</div>`;
    perms += permBucket(tr('perm.allow'), 'allow', p.allow, 'ok');
    perms += permBucket(tr('perm.ask'), 'ask', p.ask, 'warn');
    perms += permBucket(tr('perm.deny'), 'deny', p.deny, 'danger');
    h += sec(st, 's-perms', I.shield, tr('sec.permissions'),
      p.allow.length + p.ask.length + p.deny.length, perms);

    // --- env ---
    const envKeys = Object.keys(cfg.env || {});
    let env = '';
    env += `<div class="cfg-hint pad">${esc(tr('cfg.envHint'))}</div>`;
    env += envKeys.length
      ? `<div class="chips">${envKeys
          .map((k) => U.chip(k, 'removeEnv', { name: k }, 'neutral'))
          .join('')}</div>`
      : `<div class="empty">${esc(tr('empty.env'))}</div>`;
    env += U.actionRow(tr('act.addEnv'), 'addEnv');
    h += sec(st, 's-env', I.flask, tr('sec.env'), envKeys.length, env);

    h += `<div class="divider"></div>`;
    h += U.linkRow(I.json, 'settings.json', g.settingsPath, g.settingsPath);
    return h;
  }

  // Anthropic's status page, above every tab — because "is it me or is it them?"
  // is the first question when a session starts failing, and the answer used to
  // live in a browser tab. Silent while healthy: a green bar you scroll past for
  // weeks is a bar you no longer see when it turns red.
  function statusBanner(s) {
    if (!s || s.level === 'ok' || s.level === 'unknown') return '';
    const icon = s.level === 'maintenance' ? I.clock : I.warn;
    // Prefer the incident's own headline; it says more than any severity word.
    const text = s.incident || s.label || tr('status.level.' + s.level);
    return (
      `<div class="statusbar-banner lvl-${esc(s.level)}" role="status">` +
      `<span class="sb-ic">${icon}</span>` +
      `<span class="sb-tx" title="${esc(text)}">${esc(text)}</span>` +
      `<button class="sb-go" data-act="openStatusPage" ` +
      `title="${esc(tr('status.open'))}" aria-label="${esc(tr('status.open'))}">` +
      `${I.external}</button>` +
      `</div>`
    );
  }

  CC.views = {
    buildLive, buildGlobal, buildProject, buildMetrics, buildDoctor, buildSettings,
    statusBanner, petMood,
  };
})();
