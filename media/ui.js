/* Claude Control — shared render primitives.
   Formatters, the i18n lookup, and every reusable block the views compose from.
   Pure string builders: nothing here touches the DOM or posts a message. */
(function () {
  const CC = (window.CC = window.CC || {});
  const I = CC.I;

  // ---- escaping -------------------------------------------------------------
  const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => ENT[c]);

  // ---- i18n -----------------------------------------------------------------
  // The bundle arrives from the extension host; an unknown key renders as itself
  // so a missing translation is visible rather than blank.
  let T = {};
  function setBundle(b) {
    T = b || {};
  }
  function tr(key, ...args) {
    let s = T[key] != null ? T[key] : key;
    if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? m : String(args[i])));
    return s;
  }

  // ---- formatters -----------------------------------------------------------
  function kfmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return +(n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M';
    return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
  }

  function bytes(n) {
    n = Number(n) || 0;
    if (n >= 1024 ** 3) return +(n / 1024 ** 3).toFixed(1) + ' GB';
    if (n >= 1024 ** 2) return Math.round(n / 1024 ** 2) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  // "3h12m" until an ISO instant, or '' once it has passed.
  function leftTime(iso) {
    if (!iso) return '';
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    if (!(s > 0)) return '';
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    return hh ? `${hh}h${String(mm).padStart(2, '0')}m` : `${mm}m`;
  }

  // Compact "how long ago" / "for how long": now, 4s, 12m, 3h, 2d.
  function ago(ms) {
    if (!ms) return '';
    const s = Math.max(0, (Date.now() - ms) / 1000);
    // Rounding sub-second gaps to "0s" reads as broken; say what it means.
    if (s < 5) return tr('time.now');
    if (s < 60) return Math.round(s) + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  }

  function minutesLabel(mins) {
    if (mins == null) return '';
    if (mins < 60) return mins + 'm';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}m` : `${h}h`;
  }

  // Shortens a path from the left so the filename stays readable.
  function shortPath(p, max) {
    const s = String(p || '');
    const lim = max || 46;
    return s.length <= lim ? s : '…' + s.slice(-(lim - 1));
  }

  // ---- usage colour ramp ----------------------------------------------------
  // Shared by every gauge so "how full is it" reads the same everywhere.
  function ucolor(p) {
    return p < 50 ? 'var(--led-on)' : p < 80 ? 'var(--warn)' : 'var(--danger)';
  }

  // ---- blocks ---------------------------------------------------------------
  function section(id, icon, title, count, bodyHtml, collapsed) {
    return (
      `<div class="sec ${collapsed ? 'collapsed' : ''}" data-secwrap="${esc(id)}">` +
      `<div class="sec-h" data-sec="${esc(id)}">` +
      `<span class="chev">${I.chevron}</span><span class="ic">${icon}</span>` +
      `<span class="nm">${esc(title)}</span>` +
      (count != null ? `<span class="ct">${esc(count)}</span>` : '') +
      `</div><div class="sec-b">${bodyHtml || `<div class="empty">${tr('empty.generic')}</div>`}</div></div>`
    );
  }

  function scope(label, tag, tone) {
    return (
      `<div class="scope"><span class="dot ${tone ? 'dot-' + tone : ''}"></span>${esc(label)}` +
      (tag ? `<span class="path">${esc(tag)}</span>` : '') +
      `</div>`
    );
  }

  function toggleRow(label, on, act, extraAttrs, sub) {
    const attrs = Object.entries(extraAttrs || {})
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ');
    return (
      `<div class="row ${sub ? 'sub' : ''} ${on ? 'on' : ''}">` +
      `<span class="led ${on ? 'on' : ''}"></span>` +
      `<div class="body"><div class="l">${esc(label)}</div></div>` +
      `<div class="sw ${on ? 'on' : ''}" role="switch" tabindex="0" aria-checked="${on ? 'true' : 'false'}" ` +
      `aria-label="${esc(label)}" data-act="${esc(act)}" ${attrs}></div>` +
      `<span class="state">${on ? 'ON' : 'OFF'}</span></div>`
    );
  }

  function linkRow(icon, label, desc, path, badgeText) {
    return (
      `<div class="row click" data-act="open" data-path="${esc(path)}" role="button" tabindex="0">` +
      `<span class="ic">${icon}</span>` +
      `<div class="body"><div class="l">${esc(label)}` +
      (badgeText ? ` ${badge(badgeText)}` : '') +
      `</div>` +
      (desc ? `<div class="d">${esc(desc)}</div>` : '') +
      `</div><span class="go">${I.go}</span></div>`
    );
  }

  function actionRow(label, act, data) {
    const attrs = Object.entries(data || {})
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ');
    return (
      `<div class="row click act" data-act="${esc(act)}" ${attrs} role="button" tabindex="0">` +
      `<span class="ic">${I.plus}</span>` +
      `<div class="body"><div class="l">${esc(label)}</div></div></div>`
    );
  }

  function badge(text, tone) {
    return `<span class="badge ${tone ? 'badge-' + tone : ''}">${esc(text)}</span>`;
  }

  // A removable pill — permission rules, env vars.
  function chip(text, act, data, tone) {
    const attrs = Object.entries(data || {})
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ');
    return (
      `<span class="chip ${tone ? 'chip-' + tone : ''}">${esc(text)}` +
      (act
        ? `<button class="chip-x" data-act="${esc(act)}" ${attrs} aria-label="${esc(tr('act.remove'))}">${I.close}</button>`
        : '') +
      `</span>`
    );
  }

  function btn(label, icon, act, data, tone) {
    const attrs = Object.entries(data || {})
      .map(([k, v]) => `data-${k}="${esc(v)}"`)
      .join(' ');
    return (
      `<button class="btn ${tone ? 'btn-' + tone : ''}" data-act="${esc(act)}" ${attrs} title="${esc(label)}">` +
      (icon ? `<span class="bic">${icon}</span>` : '') +
      `<span>${esc(label)}</span></button>`
    );
  }

  function segmented(act, options, current, dataKey) {
    return (
      `<div class="segmented">` +
      options
        .map(
          (o) =>
            `<button class="seg ${current === o.value ? 'on' : ''}" data-act="${esc(act)}" ` +
            `data-${esc(dataKey || 'value')}="${esc(o.value)}">${esc(o.label)}</button>`
        )
        .join('') +
      `</div>`
    );
  }

  function field(label, bodyHtml, hint) {
    return (
      `<div class="cfg-field"><div class="cfg-label">${esc(label)}</div>${bodyHtml}` +
      (hint ? `<div class="cfg-hint">${esc(hint)}</div>` : '') +
      `</div>`
    );
  }

  // ---- meters ---------------------------------------------------------------
  // A labelled horizontal gauge — the workhorse of the Usage and Live tabs.
  function meter(label, pct, extra, color) {
    const c = color || ucolor(pct);
    const w = Math.max(2, Math.min(100, pct));
    return (
      `<div class="urow"><span class="ulbl">${esc(label)}</span>` +
      `<span class="ubar"><span class="ufill" style="width:${w}%;background:${c}"></span></span>` +
      `<span class="upct" style="color:${c}">${Math.round(pct)}%</span>` +
      `<span class="uext">${esc(extra || '')}</span></div>`
    );
  }

  function metaRow(label, value) {
    return (
      `<div class="urow"><span class="ulbl">${esc(label)}</span>` +
      `<span class="umeta">${esc(value)}</span></div>`
    );
  }

  // Big number tile.
  function stat(value, label, tone) {
    return (
      `<div class="stat ${tone ? 'stat-' + tone : ''}">` +
      `<div class="stat-v">${esc(value)}</div>` +
      `<div class="stat-l">${esc(label)}</div></div>`
    );
  }

  // Compact ring gauge. Used for cache efficiency, where a single ratio is the
  // whole story and deserves more weight than another bar in a stack of bars.
  function donut(pct, label, color) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const R = 26;
    const C = 2 * Math.PI * R;
    const c = color || 'var(--accent)';
    return (
      `<div class="donut"><svg viewBox="0 0 64 64" aria-hidden="true">` +
      `<circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--hair)" stroke-width="7"/>` +
      `<circle cx="32" cy="32" r="${R}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" ` +
      `stroke-dasharray="${((p / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/>` +
      `</svg><div class="donut-c"><b>${Math.round(p)}%</b><span>${esc(label)}</span></div></div>`
    );
  }

  // Trend sparkline over a series of 0–100 values (nulls are gaps).
  function sparkline(points, color) {
    const W = 252;
    const H = 42;
    const pad = 4;
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
      `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<path d="${area}" fill="${color}" opacity="0.13"/>` +
      `<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="2.3" fill="${color}"/></svg>`
    );
  }

  // Daily column chart. Flex divs rather than SVG so it reflows with the sidebar
  // instead of stretching, and so each column can carry its own tooltip.
  function columns(series, valueOf, labelOf) {
    if (!series.length) return '';
    const max = Math.max(...series.map(valueOf), 1);
    return (
      `<div class="cols">` +
      series
        .map((d) => {
          const v = valueOf(d);
          const h = v ? Math.max(3, Math.round((v / max) * 100)) : 0;
          return (
            `<div class="col ${v ? '' : 'zero'}" title="${esc(labelOf(d))}">` +
            `<span class="col-b" style="height:${h}%"></span></div>`
          );
        })
        .join('') +
      `</div>`
    );
  }

  // Ranked horizontal bars — projects, models.
  function ranked(items, max) {
    if (!items.length) return `<div class="empty">${tr('empty.generic')}</div>`;
    const top = max || Math.max(...items.map((i) => i.value), 1);
    return items
      .map(
        (i) =>
          `<div class="hrow"><span class="hlbl" title="${esc(i.name)}">${esc(i.name)}</span>` +
          `<span class="hbar"><span class="hfill" style="width:${Math.max(2, (i.value / top) * 100)}%"></span></span>` +
          `<span class="hval">${esc(i.display)}</span></div>`
      )
      .join('');
  }

  CC.ui = {
    esc,
    setBundle,
    tr,
    kfmt,
    bytes,
    leftTime,
    ago,
    minutesLabel,
    shortPath,
    ucolor,
    section,
    scope,
    toggleRow,
    linkRow,
    actionRow,
    badge,
    chip,
    btn,
    segmented,
    field,
    meter,
    metaRow,
    stat,
    donut,
    sparkline,
    columns,
    ranked,
  };
})();
