const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// i18n.js needs `vscode` only to pick a locale; stub it so the dictionaries can
// be audited under `node --test`.
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'vscode' ? 'vscode-stub' : orig.call(this, req, ...rest);
};
require.cache['vscode-stub'] = {
  id: 'vscode-stub', filename: 'vscode-stub', loaded: true,
  exports: { env: { language: 'en' } },
};
const i18n = require('../src/i18n');
const en = i18n.bundle(); // language 'en' -> the base dictionary

const ROOT = path.join(__dirname, '..');
const SOURCES = ['extension.js', 'media/views.js', 'media/ui.js', 'media/main.js'];

// Keys built at runtime as `prefix + value`. Their suffixes come from fixed
// vocabularies elsewhere in the codebase, so a static scan cannot see them.
const DYNAMIC_PREFIXES = [
  'activity.', 'status.', 'mcp.', 'hooktpl.', 'effort.', 'permmode.',
  'perm.', 'noun.', 'color.', 'doc.', 'tab.', 'time.',
  'permcat.', 'permgroup.', 'status.level.', 'pet.',
];

// Keys reach `tr()` through ternaries as often as directly (`tr(x ? 'a' : 'b')`),
// so match the call and take every key-shaped literal up to its closing paren.
// Scanning the whole file instead would sweep in VS Code command ids and setting
// names, which are the same shape but a different namespace.
function referencedKeys() {
  const found = new Set();
  const KEY = /'([a-z][a-zA-Z0-9]*\.[a-zA-Z][\w.-]*)'/g;
  for (const f of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/\b(?:tr|t)\(/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
      }
      const arg = src.slice(m.index, i);
      for (const k of arg.matchAll(KEY)) found.add(k[1]);
    }
  }
  return found;
}

test('every statically referenced i18n key exists in the base dictionary', () => {
  // A missing key renders as the raw key in the UI — "btn.openFile" on a button.
  // A literal ending in a dot is the left half of a runtime-built key
  // (`tr('status.level.' + level)`), not a key of its own. Single-segment
  // prefixes like 'activity.' never matched the key pattern to begin with; a
  // two-segment one does, and would otherwise be reported as missing forever.
  const missing = [...referencedKeys()].filter((k) => !k.endsWith('.') && !(k in en));
  assert.deepEqual(missing, [], 'missing from en: ' + missing.join(', '));
});

test('no dead keys in the dictionary', () => {
  const used = referencedKeys();
  const dead = Object.keys(en).filter(
    (k) => !used.has(k) && !DYNAMIC_PREFIXES.some((p) => k.startsWith(p))
  );
  assert.deepEqual(dead, [], 'unreferenced: ' + dead.join(', '));
});

test('placeholder indices are contiguous from zero', () => {
  // `'Empty the "{1}" cache?'` called with one argument renders the literal
  // placeholder — the string must not skip {0}.
  const bad = [];
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== 'string') continue;
    const idx = [...v.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
    if (!idx.length) continue;
    const uniq = [...new Set(idx)].sort((a, b) => a - b);
    if (uniq[0] !== 0 || uniq[uniq.length - 1] !== uniq.length - 1) bad.push(`${k}: ${v}`);
  }
  assert.deepEqual(bad, [], bad.join(' | '));
});

test('pt-br uses the same placeholder set as en', () => {
  Module._resolveFilename = function (req, ...rest) {
    return req === 'vscode' ? 'vscode-pt' : orig.call(this, req, ...rest);
  };
  require.cache['vscode-pt'] = {
    id: 'vscode-pt', filename: 'vscode-pt', loaded: true,
    exports: { env: { language: 'pt-br' } },
  };
  delete require.cache[require.resolve('../src/i18n')];
  const pt = require('../src/i18n').bundle();
  const ph = (v) => [...new Set([...String(v).matchAll(/\{(\d+)\}/g)].map((m) => m[1]))].sort().join(',');
  const bad = Object.keys(en).filter((k) => k in pt && ph(en[k]) !== ph(pt[k]));
  assert.deepEqual(bad, [], 'placeholder mismatch: ' + bad.join(', '));
});

test('every %key% in package.json exists in both nls files', () => {
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  const keys = [...new Set([...pkg.matchAll(/"%([\w.]+)%"/g)].map((m) => m[1]))];
  for (const f of ['package.nls.json', 'package.nls.pt-br.json']) {
    const nls = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const missing = keys.filter((k) => !(k in nls));
    assert.deepEqual(missing, [], `${f} missing: ${missing.join(', ')}`);
  }
});
