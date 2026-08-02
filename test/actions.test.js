const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { indirectSecret } = require('../src/actions');
const { writeJsonAtomic } = require('../src/settings');

// These are the operations that rewrite the user's real config, so they get
// exercised against a real temp filesystem rather than mocked.
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
}
const SECRET = 'sk-abcd1234efgh5678ijkl';
const MASKED = 'sk-a••••ijkl';

function fixture(dir, value) {
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, JSON.stringify({ mcpServers: { x: { env: { API_KEY: value } } } }, null, 2));
  return f;
}
const SEG = ['mcpServers', 'x', 'env', 'API_KEY'];
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('indirectSecret: replaces the value, returns the secret, keeps siblings', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, JSON.stringify({ model: 'opus', mcpServers: { x: { command: 'npx', env: { API_KEY: SECRET } } } }));
  const r = indirectSecret(f, SEG, 'API_KEY');
  assert.equal(r.ok, true);
  assert.equal(r.secret, SECRET);
  const j = read(f);
  assert.equal(j.mcpServers.x.env.API_KEY, '${API_KEY}');
  assert.equal(j.model, 'opus'); // untouched
  assert.equal(j.mcpServers.x.command, 'npx');
});

test('indirectSecret: does not leave the secret behind in a .bak', () => {
  // The whole point is removing the credential from disk; a backup next to the
  // file would defeat it, and nothing rescans .bak.
  const dir = tmpdir();
  const f = fixture(dir, SECRET);
  assert.equal(indirectSecret(f, SEG, 'API_KEY').ok, true);
  assert.equal(fs.existsSync(f + '.bak'), false);
  assert.equal(fs.readFileSync(f, 'utf8').includes(SECRET), false);
});

test('indirectSecret: a Bearer header keeps its scheme', () => {
  const dir = tmpdir();
  const f = fixture(dir, 'Bearer ' + SECRET);
  const r = indirectSecret(f, SEG, 'API_KEY');
  assert.equal(r.secret, SECRET);
  assert.equal(read(f).mcpServers.x.env.API_KEY, 'Bearer ${API_KEY}');
});

test('indirectSecret: refuses when the value changed since the finding', () => {
  const dir = tmpdir();
  const f = fixture(dir, 'sk-totally-different-99999');
  const r = indirectSecret(f, SEG, 'API_KEY', MASKED);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stale');
  assert.equal(read(f).mcpServers.x.env.API_KEY, 'sk-totally-different-99999');
});

test('indirectSecret: matching mask passes the staleness guard', () => {
  const dir = tmpdir();
  const f = fixture(dir, SECRET);
  assert.equal(indirectSecret(f, SEG, 'API_KEY', MASKED).ok, true);
});

test('indirectSecret: refuses a file outside the offered set', () => {
  const dir = tmpdir();
  const f = fixture(dir, SECRET);
  const r = indirectSecret(f, SEG, 'API_KEY', null, [path.join(dir, 'other.json')]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'path');
  assert.equal(read(f).mcpServers.x.env.API_KEY, SECRET); // untouched
});

test('indirectSecret: rejects a bad env name or empty segments', () => {
  const dir = tmpdir();
  const f = fixture(dir, SECRET);
  assert.equal(indirectSecret(f, SEG, 'lower').ok, false);
  assert.equal(indirectSecret(f, SEG, 'A B').ok, false);
  assert.equal(indirectSecret(f, [], 'API_KEY').ok, false);
  assert.equal(read(f).mcpServers.x.env.API_KEY, SECRET);
});

test('indirectSecret: a missing address changes nothing', () => {
  const dir = tmpdir();
  const f = fixture(dir, SECRET);
  assert.equal(indirectSecret(f, ['nope', 'gone'], 'API_KEY').ok, false);
  assert.equal(read(f).mcpServers.x.env.API_KEY, SECRET);
});

test('writeJsonAtomic: preserves a restrictive file mode', () => {
  // A config the user chmod'ed 600 must not come back world-readable.
  if (process.platform === 'win32') return;
  const dir = tmpdir();
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, '{}');
  fs.chmodSync(f, 0o600);
  writeJsonAtomic(f, { a: 1 });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('writeJsonAtomic: writes through a symlink instead of replacing it', () => {
  // A dotfiles setup links settings.json into a git repo; replacing the link
  // would leave the real file — and its secret — untouched and unlinked.
  if (process.platform === 'win32') return;
  const dir = tmpdir();
  const real = path.join(dir, 'real.json');
  const link = path.join(dir, 'settings.json');
  fs.writeFileSync(real, JSON.stringify({ a: 1 }));
  fs.symlinkSync(real, link);
  writeJsonAtomic(link, { a: 2 });
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'link survived');
  assert.equal(read(real).a, 2, 'target updated');
});

test('indirectSecret through a symlink updates the real file', () => {
  if (process.platform === 'win32') return;
  const dir = tmpdir();
  const real = path.join(dir, 'real.json');
  const link = path.join(dir, 'settings.json');
  fs.writeFileSync(real, JSON.stringify({ mcpServers: { x: { env: { API_KEY: SECRET } } } }));
  fs.symlinkSync(real, link);
  assert.equal(indirectSecret(link, SEG, 'API_KEY').ok, true);
  assert.equal(fs.readFileSync(real, 'utf8').includes(SECRET), false);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
});
