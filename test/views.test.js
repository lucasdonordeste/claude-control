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

function visibleAgents(agents, foldedAgents) {
  const st = {
    model: { global: { projectScope: true } },
    openAgents: { s1: true },
    foldedAgents: foldedAgents || {},
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

test('agent tree: a branch with nothing running folds itself', () => {
  // The point of the default: forty finished agents stay in the record without
  // burying the two still working.
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 })), ['A', 'B', 'C', 'D']);
});

test('agent tree: folding works at grandchild depth', () => {
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), { B: true }), ['A', 'B', 'D']);
});

test('agent tree: an explicit choice beats the computed default', () => {
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), { D: false }), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(visibleAgents(tree({ A: 1, B: 1, C: 1 }), { A: true }), ['A', 'D']);
});

test('agent tree: when everything has finished nothing is deleted', () => {
  // Collapsed to the two roots — the record survives for a post-mortem.
  assert.deepEqual(visibleAgents(tree({})), ['A', 'D']);
});

test('agent tree: a live child keeps its finished parent visible', () => {
  // Otherwise the child renders indented under nothing.
  assert.deepEqual(visibleAgents(tree({ C: 1 })), ['A', 'B', 'C', 'D']);
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
