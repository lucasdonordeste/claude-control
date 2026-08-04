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
