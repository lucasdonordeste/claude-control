const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The webview and the host talk through strings: `data-act="x"` on one side,
// `case 'x':` on the other. Nothing checks that they agree, so a renamed action
// or a typo is a button that silently does nothing — which is exactly how the
// overflow menu shipped broken for three releases.
const ROOT = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(ROOT, 'extension.js'), 'utf8');
const views = fs.readFileSync(path.join(ROOT, 'media', 'views.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'media', 'main.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Actions the webview handles itself and never forwards.
// `petPoke` is pure decoration: a message to the host would cost a round trip
// and a re-render, and the re-render would replace the node mid-hop.
const LOCAL_ONLY = new Set([
  'toggleCard', 'toggleAgents', 'foldAgent', 'toggleDone', 'toggleTasks', 'scanDisk', 'petPoke',
]);
// Messages the webview sends that are not `data-act` attributes.
const IMPLICIT = new Set(['ready', 'refresh', 'needMetrics', 'needDoctor', 'scanDisk', 'setCustomColor']);

function declaredActs() {
  const out = new Set();
  for (const src of [views, main]) {
    for (const m of src.matchAll(/data-act="([a-zA-Z]+)"/g)) out.add(m[1]);
    for (const m of src.matchAll(/'(?:data-act)',\s*'([a-zA-Z]+)'/g)) out.add(m[1]);
    // U.btn/U.chip/U.actionRow/U.toggleRow take the act as a bare argument
    for (const m of src.matchAll(/,\s*'([a-zA-Z]+)',\s*\{/g)) out.add(m[1]);
  }
  return out;
}

function hostCases() {
  const out = new Set();
  for (const m of host.matchAll(/^\s*case '([a-zA-Z]+)':/gm)) out.add(m[1]);
  return out;
}

test('every action the webview can send has a handler', () => {
  const acts = declaredActs();
  const cases = hostCases();
  const orphans = [...acts].filter((a) => !cases.has(a) && !LOCAL_ONLY.has(a));
  assert.deepEqual(orphans, [], 'buttons that do nothing: ' + orphans.join(', '));
});

test('no handler is unreachable', () => {
  // Reachable means the name appears somewhere other than its own `case` line —
  // as a data-act, as a bare argument to one of the render primitives, or in a
  // re-dispatch from the host's own overflow menu.
  const cases = hostCases();
  const corpus = views + main + host.replace(/^\s*case '[a-zA-Z]+':/gm, '');
  const dead = [...cases].filter(
    (c) => !IMPLICIT.has(c) && !new RegExp('\\b' + c + '\\b').test(corpus)
  );
  assert.deepEqual(dead, [], 'handlers nothing can reach: ' + dead.join(', '));
});

test('re-dispatching a message overrides its type, not the other way round', () => {
  // `{ type: 'killSession', ...msg }` puts the *incoming* type back, because msg
  // still carries it — so the menu re-opened itself instead of stopping the
  // session. The spread has to come first.
  const bad = [...host.matchAll(/this\.handle\(\{\s*type:[^}]*\.\.\.msg/g)];
  assert.deepEqual(
    bad.map((m) => m[0]),
    [],
    'spread after type resets it to the incoming message type'
  );
});

test('every contributed command is registered, and vice versa', () => {
  const contributed = (pkg.contributes.commands || []).map((c) => c.command);
  const registered = [...host.matchAll(/registerCommand\('([\w.]+)'/g)].map((m) => m[1]);
  for (const c of contributed) {
    assert.ok(registered.includes(c), 'contributed but never registered: ' + c);
  }
  for (const r of registered) {
    assert.ok(contributed.includes(r), 'registered but not contributed: ' + r);
  }
});

test('every setting read at runtime is declared in the manifest', () => {
  // cfg('x', …) reads claudeControl.x — an undeclared key silently returns the
  // fallback forever, and writing it throws.
  const declared = new Set(
    Object.keys(pkg.contributes.configuration.properties).map((k) => k.replace(/^claudeControl\./, ''))
  );
  const read = new Set();
  // A trailing dot means the key is completed at runtime (`cfg('statusBar.' + k)`);
  // those are covered by the statusBarShow sweep below.
  for (const m of host.matchAll(/\bcfg\('([\w.]+)'/g)) if (!m[1].endsWith('.')) read.add(m[1]);
  for (const m of host.matchAll(/statusBarShow\('([\w.]+)'/g)) read.add('statusBar.' + m[1]);
  const missing = [...read].filter((k) => !declared.has(k));
  assert.deepEqual(missing, [], 'read but not declared: ' + missing.join(', '));
});

test('the webview assigns the message type after the forwarded attributes', () => {
  // A `data-type` attribute must never be able to redirect the action — the
  // mirror of the host-side bug above.
  const loop = main.slice(main.indexOf('for (const attr of act.attributes)'));
  const assign = loop.indexOf('msg.type = type');
  const forward = loop.indexOf('msg[attr.name.slice(5)]');
  assert.ok(assign > -1, 'type is not assigned after the loop');
  assert.ok(assign > forward, 'type is assigned before the forwarded attributes');
});

test('every pet species is declared, validated and drawn', () => {
  // Three lists have to agree: the manifest's enum (what the settings UI and the
  // JSON offer), the host's validation list (what it will write), and the art
  // (what can actually be rendered). A species missing from any one of them is a
  // choice that silently does nothing.
  const manifest = pkg.contributes.configuration.properties['claudeControl.pet.species'].enum;
  const declared = host.match(/const PET_SPECIES = \[([^\]]+)\]/)[1]
    .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  assert.deepEqual(declared, manifest, 'host validation list differs from the manifest');
  for (const s of manifest) {
    assert.match(views, new RegExp('\\n    ' + s + ': \\{'), 'no art for species: ' + s);
  }
});
