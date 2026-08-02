/* Claude Control — icon set.
   Line icons on a 24×24 grid, stroked with currentColor so every one of them
   inherits the surrounding text colour and the VS Code theme. Loaded first;
   everything else reads them off window.CC. */
(function () {
  const svg = (body, attrs) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="${(attrs && attrs.w) || 1.8}" stroke-linecap="round" ` +
    `stroke-linejoin="round">${body}</svg>`;

  window.CC = window.CC || {};
  window.CC.I = {
    // brand
    mark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/>' +
      '<circle cx="9" cy="7" r="2.7" fill="var(--vscode-sideBar-background)"/>' +
      '<circle cx="15.5" cy="12" r="2.7" fill="var(--vscode-sideBar-background)"/>' +
      '<circle cx="7.5" cy="17" r="2.7" fill="var(--vscode-sideBar-background)"/></svg>',

    // tab icons
    live: svg('<path d="M2 12h4l3-8 4 16 3-8h6"/>', { w: 2 }),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>'),
    folder: svg('<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', { w: 2 }),
    stethoscope: svg('<path d="M6 3v5a4 4 0 0 0 8 0V3"/><path d="M4 3h3M13 3h3"/><path d="M10 12v3a5 5 0 0 0 10 0v-1"/><circle cx="20" cy="11" r="2"/>'),
    gear: svg(
      '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.8 7.8 0 0 0 .1-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-2.6-1.5l-.3-2.1H8.5l-.3 2.1c-1 .3-1.8.8-2.6 1.5l-2-.8L1.8 9.2l1.7 1.3a7.8 7.8 0 0 0 0 3l-1.7 1.3 1.8 3.1 2-.8c.8.7 1.6 1.2 2.6 1.5l.3 2.1h3.6l.3-2.1c1-.3 1.8-.8 2.6-1.5l2 .8 1.8-3.1z"/>',
      { w: 1.9 }
    ),

    // chrome
    refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>', { w: 2 }),
    chevron: svg('<path d="M6 9l6 6 6-6"/>', { w: 2.2 }),
    go: svg('<path d="M9 6l6 6-6 6"/>', { w: 2.2 }),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', { w: 2 }),
    plus: svg('<path d="M12 5v14M5 12h14"/>', { w: 2.2 }),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>', { w: 2.2 }),
    dots: svg('<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>'),

    // primitives
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>',
    puzzle: svg('<path d="M10 3a2 2 0 0 1 4 0c0 .5.5 1 1 1h2a1 1 0 0 1 1 1v2c0 .5.5 1 1 1a2 2 0 0 1 0 4c-.5 0-1 .5-1 1v3a1 1 0 0 1-1 1h-3c-.5 0-1-.5-1-1a2 2 0 0 0-4 0c0 .5-.5 1-1 1H6a1 1 0 0 1-1-1v-3c0-.5-.5-1-1-1a2 2 0 0 1 0-4c.5 0 1-.5 1-1V6a1 1 0 0 1 1-1h2c.5 0 1-.5 1-1z"/>'),
    doc: svg('<path d="M6 3h8l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6"/>'),
    json: svg('<path d="M8 4c-2 0-2 2-2 4s0 3-2 4c2 1 2 2 2 4s0 4 2 4"/><path d="M16 4c2 0 2 2 2 4s0 3 2 4c-2 1-2 2-2 4s0 4-2 4"/>', { w: 1.9 }),
    terminal: svg('<path d="M5 7l4 4-4 4"/><path d="M12 16h6"/>', { w: 1.9 }),
    agent: svg('<rect x="4" y="8" width="16" height="11" rx="2.5"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
    bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    plug: svg('<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>', { w: 1.9 }),
    download: svg('<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>', { w: 1.9 }),
    trash: svg('<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>', { w: 1.9 }),
    gauge: svg('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>'),

    // live / sessions
    branch: svg('<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 7.2v9.6M18 11.2v.8a4 4 0 0 1-4 4H8"/>'),
    cpu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
    play: svg('<path d="M7 4.5l12 7.5-12 7.5z"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    node: svg('<path d="M5 4v11a3 3 0 0 0 3 3h4"/><circle cx="16" cy="18" r="2.4"/>'),

    // doctor
    alert: svg('<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>', { w: 1.9 }),
    warn: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>', { w: 1.9 }),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>', { w: 1.9 }),
    check: svg('<path d="M4 12.5l5 5L20 6.5"/>', { w: 2.2 }),
    shield: svg('<path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9.5-4.8-1.2-8-5-8-9.5V6z"/><path d="M9 12l2 2 4-4"/>'),
    key: svg('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8 2 2-2 2 2 2-2 2-2-2-2 2"/>'),
    broom: svg('<path d="M14 3l7 7-4 4-7-7z"/><path d="M10 7l-6 6c-1.2 1.2-1.2 3 0 4.2l2.8 2.8c1.2 1.2 3 1.2 4.2 0l6-6"/>'),
    disk: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
    flask: svg('<path d="M10 3v6L4.5 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M9 3h6M7.5 15h9"/>'),
  };
})();
