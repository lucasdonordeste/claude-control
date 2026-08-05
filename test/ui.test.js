const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Same trick as views.test.js: the webview helpers are loadable in Node with a
// stub `window`. The DOM walk in morph() needs a browser and is checked there;
// what is worth pinning here is the rule that decides whether a node on screen
// may be reused for a piece of new markup — get that wrong and a poll either
// recycles one session's card into another's slot, or rebuilds the whole body
// and brings the flicker back.
const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console, CSS: { escape: (s) => s } };
vm.createContext(sandbox);
for (const f of ['icons.js', 'ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'media', f), 'utf8'), sandbox, { filename: f });
}
const { sameNode } = sandbox.window.CC.ui;

// Minimal stand-in for a DOM node: morph only ever asks these three things.
function el(name, attrs) {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    getAttribute: (k) => (attrs && k in attrs ? attrs[k] : null),
  };
}
const text = (v) => ({ nodeType: 3, nodeValue: v });

test('sameNode: unkeyed nodes of the same tag are reused', () => {
  assert.equal(sameNode(el('div'), el('div')), true);
  assert.equal(sameNode(el('div', { class: 'a' }), el('div', { class: 'b' })), true);
});

test('sameNode: a different tag is never reused', () => {
  assert.equal(sameNode(el('div'), el('span')), false);
});

test('sameNode: text nodes are patched in place, not replaced', () => {
  assert.equal(sameNode(text('41k'), text('57k')), true);
});

test('sameNode: node types never mix', () => {
  assert.equal(sameNode(el('div'), text('x')), false);
  assert.equal(sameNode(null, el('div')), false);
});

test('sameNode: a card keeps its identity across a poll', () => {
  assert.equal(sameNode(el('div', { 'data-sid': 'abc' }), el('div', { 'data-sid': 'abc' })), true);
});

test('sameNode: one session card is never recycled as another', () => {
  assert.equal(sameNode(el('div', { 'data-sid': 'abc' }), el('div', { 'data-sid': 'xyz' })), false);
});

test('sameNode: keyed and unkeyed are different things', () => {
  assert.equal(sameNode(el('div'), el('div', { 'data-sid': 'abc' })), false);
});

// This is what still gives a tab switch its entrance animation: the body is
// replaced (so the CSS fade runs) instead of patched (which would not).
test('sameNode: the tab body is replaced when the tab changes', () => {
  assert.equal(sameNode(el('div', { 'data-tabkey': 'live' }), el('div', { 'data-tabkey': 'live' })), true);
  assert.equal(sameNode(el('div', { 'data-tabkey': 'live' }), el('div', { 'data-tabkey': 'doctor' })), false);
});

test('sameNode: id outranks the other keys', () => {
  assert.equal(sameNode(el('div', { id: 'a', 'data-sid': 'x' }), el('div', { id: 'b', 'data-sid': 'x' })), false);
  assert.equal(sameNode(el('div', { id: 'a', 'data-sid': 'x' }), el('div', { id: 'a', 'data-sid': 'y' })), true);
});
