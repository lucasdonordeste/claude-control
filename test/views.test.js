const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const Module = require('module');

// The webview's builders are pure string functions, so they can be exercised in
// Node with a stub `window` — no DOM, no VS Code. Until now nothing under
// media/ was covered at all.
const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console, CSS: { escape: (s) => s } };
vm.createContext(sandbox);
for (const f of ['icons.js', 'ui.js', 'views.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'media', f), 'utf8'), sandbox, { filename: f });
}
const CC = sandbox.window.CC;

const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'vscode' ? 'vscode-stub' : orig.call(this, req, ...rest);
};
require.cache['vscode-stub'] = {
  id: 'vscode-stub', filename: 'vscode-stub', loaded: true,
  exports: { env: { language: 'en' } },
};
CC.ui.setBundle(require('../src/i18n').bundle());

// A → B → C on one branch, D → E on another.
function tree(running) {
  const n = (id, depth, descendants) => ({
    id, depth, descendants, agentType: 'general-purpose', description: id,
    running: !!running[id], tokens: 1000, path: '/x/' + id + '.jsonl',
  });
  return [n('A', 0, 2), n('B', 1, 1), n('C', 2, 0), n('D', 0, 1), n('E', 1, 0)];
}

function visibleAgents(agents, foldedAgents, showDone) {
  const st = {
    model: { global: { projectScope: true } },
    openAgents: { s1: true },
    foldedAgents: foldedAgents || {},
    showDone: showDone ? { s1: true } : {},
    openCards: {},
    collapsed: {},
    live: {
      groups: [{ name: 'p', isWorkspace: true, sessions: [{
        sessionId: 's1', cwd: '/p', project: 'p', title: 't', status: 'busy',
        tokens: 1, window: 100, agents, isWorkspace: true, pid: 1,
      }] }],
      sessions: [], total: 1, hidden: 0, waiting: 0, agents: 1,
    },
  };
  const html = CC.views.buildLive(st);
  return ['A', 'B', 'C', 'D', 'E'].filter((id) => html.includes('>' + id + '<'));
}

test('agent tree: a finished branch leaves the tree and becomes a count', () => {
  // A finished *leaf* cannot be folded — folding a childless node hides nothing
  // — so thirteen returned agents used to render as thirteen rows. Whole
  // finished branches move behind a count instead.
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 })), ['A', 'B', 'C']);
});

test('agent tree: the count opens, to roots that open in turn', () => {
  // Revealing the finished set shows its top-level agents; each branch keeps its
  // own chevron rather than dumping a whole history at once.
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), {}, true), ['A', 'B', 'C', 'D']);
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), { D: false }, true), ['A', 'B', 'C', 'D', 'E']);
});

test('agent tree: nothing running leaves only the count', () => {
  assert.deepEqual(visibleAgents(tree({})), []);
  // and nothing was destroyed — every root is one click away, each still openable
  assert.deepEqual(visibleAgents(tree({}), {}, true), ['A', 'D']);
  // Each level opens on its own — B is a finished branch too, so C stays behind
  // B's chevron until B is opened as well.
  assert.deepEqual(visibleAgents(tree({}), { A: false, D: false }, true), ['A', 'B', 'D', 'E']);
  assert.deepEqual(
    visibleAgents(tree({}), { A: false, B: false, D: false }, true),
    ['A', 'B', 'C', 'D', 'E']
  );
});

test('agent tree: a live branch still folds internally', () => {
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), { B: true }), ['A', 'B']);
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), { A: true }), ['A']);
});

test('agent tree: a live child keeps its finished ancestors visible', () => {
  // Only C is working; A and B have returned. They stay, or C renders indented
  // under nothing.
  assert.deepEqual(visibleAgents(tree({ C: 1 })), ['A', 'B', 'C']);
});

// Whether the tree starts open, with no click of the user's to honour yet.
function agentsStartOpen(agents, expandAgents) {
  const st = {
    model: { global: { projectScope: true, expandAgents } },
    openAgents: {}, // untouched — this is the default path
    foldedAgents: {}, showDone: {}, openCards: {}, collapsed: {},
    live: {
      groups: [{ name: 'p', isWorkspace: true, sessions: [{
        sessionId: 's1', cwd: '/p', project: 'p', title: 't', status: 'busy',
        tokens: 1, window: 100, agents, isWorkspace: true, pid: 1,
      }] }],
      sessions: [], total: 1, hidden: 0, waiting: 0, agents: 1,
    },
  };
  const m = CC.views.buildLive(st).match(/data-act="toggleAgents" data-sid="s1" data-open="(\d)"/);
  return m && m[1] === '1';
}

test('agent tree: opens by default, whatever the agents are doing', () => {
  // The tree used to open only while work was in flight, so the moment the last
  // agent returned the session's record of delegated work folded itself away —
  // exactly when you go looking for what it did.
  assert.equal(agentsStartOpen(tree({ A: 1 })), true);
  assert.equal(agentsStartOpen(tree({})), true);
});

test('agent tree: the default is a setting, and a click still wins over it', () => {
  // 'never' means never — including with work in flight, which is the one case
  // the old open-while-running rule forced open.
  assert.equal(agentsStartOpen(tree({}), 'never'), false);
  assert.equal(agentsStartOpen(tree({ A: 1 }), 'never'), false);
  // 'whileRunning' is the old behaviour, kept for whoever preferred it.
  assert.equal(agentsStartOpen(tree({ A: 1 }), 'whileRunning'), true);
  assert.equal(agentsStartOpen(tree({}), 'whileRunning'), false);
  // An explicit toggle outranks any of them — visibleAgents() sets openAgents.
  assert.deepEqual(visibleAgents(tree({}), {}, true), ['A', 'D']);
});

function settingsHtml(global) {
  return CC.views.buildSettings({
    collapsed: {},
    config: { permissions: { allow: [], ask: [], deny: [] }, env: {} },
    modelPresets: ['opus'], effortLevels: ['high'], permissionModes: ['default'],
    model: { global: Object.assign({ soundReady: 1, notifyReady: 1, statusBar: false }, global) },
  });
}

test('settings: every panel feature is switchable from the panel', () => {
  // Each of these shipped as a settings.json key only, which made the feature
  // invisible to anyone who never opens the JSON.
  const h = settingsHtml({});
  for (const act of ['togglePet', 'toggleStatusWatch', 'setExpandAgents', 'setQuotaWarning']) {
    assert.match(h, new RegExp(`data-act="${act}"`), act + ' missing from Settings');
  }
});

test('settings: a quota threshold of 0 shows as Off, not as the default', () => {
  // `g.quotaWarning || 30` would make 0 unreachable — the one value that means
  // "stop warning me" would silently read back as 30 minutes.
  assert.match(
    settingsHtml({ quotaWarning: 0 }),
    /class="seg on" data-act="setQuotaWarning" data-value="0"/
  );
  // And an unset value falls back to the real default rather than to Off.
  assert.match(
    settingsHtml({}),
    /class="seg on" data-act="setQuotaWarning" data-value="30"/
  );
});

test('settings: the subagent-tree choice reflects what is configured', () => {
  assert.match(
    settingsHtml({ expandAgents: 'whileRunning' }),
    /class="seg on" data-act="setExpandAgents" data-value="whileRunning"/
  );
});

test('pet: mood follows the sessions, needing you outranks being busy', () => {
  const live = (o) => Object.assign({ total: 0, waiting: 0, groups: [] }, o);
  assert.equal(CC.views.petMood(live()), 'asleep');
  assert.equal(CC.views.petMood(null), 'asleep');
  // Open but idle.
  assert.equal(
    CC.views.petMood(live({ total: 1, groups: [{ sessions: [{ status: 'idle' }] }] })),
    'idle'
  );
  assert.equal(
    CC.views.petMood(live({ total: 1, groups: [{ sessions: [{ status: 'busy' }] }] })),
    'working'
  );
  // Waiting wins even while another session is busy.
  assert.equal(
    CC.views.petMood(live({ total: 2, waiting: 1, groups: [{ sessions: [{ status: 'busy' }] }] })),
    'alert'
  );
});

const busyLive = {
  groups: [{ name: 'p', isWorkspace: true, sessions: [{
    sessionId: 's1', cwd: '/p', project: 'p', title: 't', status: 'busy',
    tokens: 1, window: 100, agents: [], isWorkspace: true, pid: 1,
  }] }], sessions: [], total: 1, hidden: 0, waiting: 0, agents: 0,
};

test('pet: absent unless switched on', () => {
  // Opt-in: the panel is a precision instrument by default, and an existing user
  // should not find a cat in it after an update they did not ask for.
  assert.equal(CC.views.petBlock({ model: { global: {} } }, busyLive), '');
  // The class list carries the pacing flag too, so match the prefix.
  assert.match(
    CC.views.petBlock({ model: { global: { pet: true } } }, busyLive),
    /class="pet pet-working/
  );
});

test('pet: lives outside the tab body, so it survives every tab and every poll', () => {
  // It used to be appended inside buildLive, which put it below the last session
  // card — off-screen the moment you had two sessions, defeating the one job it
  // has. It also sat inside `.fade`, whose transform animation breaks sticky
  // positioning in descendants.
  const st = { model: { global: { projectScope: true, pet: true } },
    openAgents: {}, foldedAgents: {}, showDone: {}, openCards: {}, collapsed: {}, live: busyLive };
  assert.doesNotMatch(CC.views.buildLive(st), /class="pet/);
  assert.match(CC.views.petBlock(st, busyLive), /class="pet/);
});

test('pet: every species draws, and an unknown one falls back to the cat', () => {
  const draw = (petSpecies) => CC.views.petBlock({ model: { global: { pet: true, petSpecies } } }, busyLive);
  for (const s of CC.views.PET_SPECIES) {
    const h = draw(s);
    assert.match(h, /<svg /, s + ' drew nothing');
    // Every species must offer both eye states, or it cannot show sleep.
    assert.match(h, /class="p-eye-open"/, s + ' has no open eye');
    assert.match(h, /class="p-eye-shut"/, s + ' has no shut eye');
    assert.match(h, /--tail-o:/, s + ' declares no pivot for its tail');
  }
  assert.equal(CC.views.PET_SPECIES.length, 5);
  // A species from a newer build, or a hand-edited settings.json.
  assert.equal(draw('velociraptor'), draw('cat'));
  assert.equal(draw(undefined), draw('cat'));
});

test('pet: celebrates only when work actually finished', () => {
  // The cheer is a transition, not a state: main.js sets the flag, the view just
  // renders it. What matters here is that it is carried through and that it is
  // not confused with the mood classes.
  const on = { model: { global: { pet: true } }, petCheer: true };
  assert.match(CC.views.petBlock(on, { total: 0, groups: [] }), /class="pet pet-asleep pet-cheer"/);
  assert.doesNotMatch(
    CC.views.petBlock({ model: { global: { pet: true } } }, { total: 0, groups: [] }),
    /pet-cheer/
  );
});

test('pet: no longer paces', () => {
  // Pacing read as restless rather than alive; the tail and the colour already
  // carry the state.
  for (const live of [busyLive, { total: 1, waiting: 0, groups: [{ sessions: [{ status: 'idle' }] }] }]) {
    assert.doesNotMatch(CC.views.petBlock({ model: { global: { pet: true } } }, live), /pet-walks/);
  }
});

test('pet: a custom image is embedded as <img>, never as inline svg', () => {
  // An inline <svg> from someone else's file would run its own <script>; an
  // <img> cannot, which is the whole reason for the data: URI round trip.
  const evil = 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+';
  const h = CC.views.petBlock({ model: { global: { pet: true, petCustom: evil } } }, busyLive);
  assert.match(h, /<img class="p-img"/);
  assert.doesNotMatch(h, /<svg/);
  assert.doesNotMatch(h, /<script/);
  // The URI is attribute-escaped like any other untrusted value. What matters is
  // that the quote is neutralised, so the payload stays *inside* src rather than
  // closing it and becoming an attribute of its own — the literal text
  // "onerror=" surviving in the value is harmless.
  const quoted = CC.views.petBlock(
    { model: { global: { pet: true, petCustom: '" onerror="alert(1)' } } },
    busyLive
  );
  assert.match(quoted, /src="&quot; onerror=&quot;/);
  assert.doesNotMatch(quoted, /"\s*onerror\s*=\s*"/);
});

test('pet: sleeps when nothing is running, and with no live data at all', () => {
  const on = { model: { global: { pet: true } } };
  const empty = { groups: [], sessions: [], total: 0, hidden: 0, waiting: 0, agents: 0 };
  assert.match(CC.views.petBlock(on, empty), /class="pet pet-asleep"/);
  // Before the first usage message arrives, st.live is undefined.
  assert.match(CC.views.petBlock(on, undefined), /class="pet pet-asleep"/);
});

test('status banner: silent unless something is actually wrong', () => {
  // A green bar you scroll past for weeks is one you no longer see when it turns
  // red, so healthy and unknown both render nothing at all.
  assert.equal(CC.views.statusBanner(null), '');
  assert.equal(CC.views.statusBanner(undefined), '');
  assert.equal(CC.views.statusBanner({ level: 'ok', label: 'All Systems Operational' }), '');
  assert.equal(CC.views.statusBanner({ level: 'unknown' }), '');
});

test('status banner: shows the incident headline, and escapes it', () => {
  const h = CC.views.statusBanner({
    level: 'major',
    label: 'Major outage',
    incident: 'Elevated error rates',
    url: 'https://status.claude.com',
  });
  assert.match(h, /lvl-major/);
  assert.match(h, /Elevated error rates/);
  assert.match(h, /data-act="openStatusPage"/);

  // The incident name comes off a third-party page and lands in an attribute.
  const evil = CC.views.statusBanner({ level: 'major', incident: '"><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(evil, /<img/);
});

test('status banner: falls back to the severity when there is no incident text', () => {
  const h = CC.views.statusBanner({ level: 'degraded', label: '', incident: '' });
  assert.match(h, /Degraded performance/);
});

test('every data value rendered into an attribute is escaped', () => {
  // The primitives take caller-supplied objects; this invariant is otherwise
  // maintained by hand across twenty-odd call sites.
  const evil = '" onmouseover="alert(1)';
  const U = CC.ui;
  const outputs = [
    U.btn(evil, '', 'act', { path: evil }),
    U.chip(evil, 'act', { rule: evil }),
    U.linkRow('', evil, evil, evil),
    U.actionRow(evil, 'act', { key: evil }),
    U.toggleRow(evil, true, 'act', { key: evil }),
    U.badge(evil),
    U.segmented('act', [{ value: evil, label: evil }], evil, 'value'),
  ];
  // The payload must survive only in escaped form: a raw `"` is what would end
  // the attribute early and let `onmouseover` become one of its own.
  for (const html of outputs) {
    assert.equal(html.includes('" onmouseover="'), false, 'attribute broken out of: ' + html);
    assert.ok(html.includes('&quot;'), 'value was not escaped at all: ' + html);
  }
});

test('attribute names cannot be injected through a data key', () => {
  const html = CC.ui.btn('x', '', 'act', { 'a" onclick="alert(1)': 'v' });
  // The key is stripped to [A-Za-z0-9-], so the quotes that would have ended the
  // attribute are gone and the payload collapses into one inert data-* name.
  // (It still *contains* the letters "onclick" — what matters is that no
  // attribute is named that.)
  assert.equal(/\son[a-z]+\s*=/.test(html), false, 'an event handler attribute appeared: ' + html);
  assert.ok(html.includes('data-aonclickalert1="v"'), html);
});

test('pet: the cheer fires on finishing, not on being interrupted', () => {
  const f = CC.views.petFinished;
  // Work ended and nothing is left running.
  assert.equal(f('working', 'asleep'), true);
  // Work ended but other sessions are still open.
  assert.equal(f('working', 'idle'), true);
  // A session stopping to ask you something has finished nothing.
  assert.equal(f('working', 'alert'), false);
  // Nothing was running to finish.
  assert.equal(f('idle', 'asleep'), false);
  assert.equal(f('asleep', 'idle'), false);
  assert.equal(f('alert', 'idle'), false);
  // Still going.
  assert.equal(f('working', 'working'), false);
  // First render of the session: there is no previous mood to have finished.
  assert.equal(f(undefined, 'idle'), false);
});

// --- the task checklist -------------------------------------------------------

function taskCard(count, showAll, doingAt) {
  const items = Array.from({ length: count }, (_, i) => ({
    subject: 'T' + i,
    status: i < doingAt ? 'completed' : i === doingAt ? 'in_progress' : 'pending',
  }));
  const st = {
    model: { global: { projectScope: true } },
    openAgents: {}, foldedAgents: {}, showDone: {}, openCards: {}, collapsed: {},
    showAllTasks: showAll ? { s1: true } : {},
    live: {
      groups: [{ name: 'p', isWorkspace: true, sessions: [{
        sessionId: 's1', cwd: '/p', project: 'p', title: 't', status: 'busy',
        tokens: 1, window: 100, agents: [], isWorkspace: true, pid: 1,
        tasks: { done: doingAt, total: count, items },
      }] }],
      sessions: [], total: 1, hidden: 0, waiting: 0, agents: 0,
    },
  };
  const html = CC.views.buildLive(st);
  return {
    shown: items.map((i) => i.subject).filter((s) => html.includes('>' + s + '<')),
    html,
  };
}

test('tasks: a long list is windowed around the one in progress', () => {
  // Nine items, the seventh running: the window follows the work rather than
  // starting from the top, which would show six finished rows and nothing live.
  const r = taskCard(9, false, 6);
  assert.deepEqual(r.shown, ['T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
  assert.ok(r.shown.includes('T6'), 'the running item is in the window');
  assert.ok(r.html.includes('+3 more'), 'and the three it scrolled past are counted');
});

test('tasks: the count opens the whole list, and closes it again', () => {
  // The bug: that count was dead text, so the items the window hid could not be
  // read at all — on a nine-item plan, three of them were simply unreachable.
  const open = taskCard(9, true, 6);
  assert.deepEqual(open.shown, ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
  assert.ok(open.html.includes('show fewer'), 'and it offers the way back');
  assert.ok(open.html.includes('aria-expanded="true"'));

  const shut = taskCard(9, false, 6);
  assert.ok(shut.html.includes('data-act="toggleTasks"'), 'the count is a button');
  assert.ok(shut.html.includes('data-sid="s1"'), 'keyed to its own session');
  assert.ok(shut.html.includes('aria-expanded="false"'));
});

test('tasks: a short list has nothing to open', () => {
  const r = taskCard(3, false, 1);
  assert.deepEqual(r.shown, ['T0', 'T1', 'T2']);
  assert.ok(!r.html.includes('toggleTasks'), 'no button when nothing is hidden');
});
