const test = require('node:test');
const assert = require('node:assert');
const {
  looksSecret,
  maskSecret,
  findSecrets,
  hookScriptPaths,
  isGuarded,
  envNameFor,
  checkShadowed,
} = require('../src/doctor');

test('looksSecret: recognises well-known credential prefixes anywhere', () => {
  assert.equal(looksSecret('anything', 'sk-abc123def456ghi789'), true);
  assert.equal(looksSecret('whatever', 'ghp_16CharsAtLeastHere'), true);
  assert.equal(looksSecret('x', 'msy_PE5BcnL42kYMbIQJYSmLYnV8'), true);
  assert.equal(looksSecret('Authorization', 'Bearer sk_live_9c8b7a6d5e4f'), true);
});

test('looksSecret: a credential-shaped key needs a credential-shaped value', () => {
  assert.equal(looksSecret('CLICKUP_API_TOKEN', 'pk_42925013_4S94WIEPQLVDZ2SB'), true);
  assert.equal(looksSecret('MY_TOKEN', 'short'), false); // too short
  assert.equal(looksSecret('MY_TOKEN', 'all lowercase words here'), false); // has spaces
  assert.equal(looksSecret('MY_TOKEN', 'abcdefghijklmnopqrst'), false); // no digits
});

test('looksSecret: a bland key with a bland value is not a secret', () => {
  assert.equal(looksSecret('command', 'npx -y some-package-2'), false);
  assert.equal(looksSecret('args', '--verbose'), false);
  assert.equal(looksSecret('CLICKUP_TEAM_ID', '9011947304'), false);
});

test('looksSecret: placeholders and indirections are never flagged', () => {
  assert.equal(looksSecret('TOKEN', '<token>'), false);
  assert.equal(looksSecret('TOKEN', '${GITHUB_TOKEN}'), false);
  assert.equal(looksSecret('TOKEN', '$GITHUB_TOKEN'), false);
  assert.equal(looksSecret('TOKEN', '%USERPROFILE%'), false);
  assert.equal(looksSecret('TOKEN', ''), false);
  assert.equal(looksSecret('TOKEN', '   '), false);
  assert.equal(looksSecret('TOKEN', 'changeme'), false);
  assert.equal(looksSecret('TOKEN', 12345), false);
});

test('maskSecret: shows the ends only, and never the middle', () => {
  assert.equal(maskSecret('pk_42925013_4S94WIEPQ552G'), 'pk_4••••552G');
  assert.equal(maskSecret('short'), '••••');
  assert.equal(maskSecret('12345678'), '••••');
});

test('findSecrets: reports an addressable path, not just a name', () => {
  const cfg = {
    mcpServers: {
      clickup: { command: 'npx', env: { CLICKUP_API_TOKEN: 'pk_4292501_4S94WIEPQLVD552G' } },
      pixellab: { headers: { Authorization: 'Bearer abc123def456ghi789jkl' } },
    },
  };
  const found = findSecrets(cfg);
  assert.equal(found.length, 2);
  const byPath = Object.fromEntries(found.map((f) => [f.path, f]));
  assert.ok(byPath['mcpServers.clickup.env.CLICKUP_API_TOKEN']);
  assert.deepEqual(byPath['mcpServers.clickup.env.CLICKUP_API_TOKEN'].segments, [
    'mcpServers',
    'clickup',
    'env',
    'CLICKUP_API_TOKEN',
  ]);
});

test('findSecrets: segments survive keys that themselves contain dots', () => {
  // ~/.claude.json keys projects by absolute path, so a joined string is ambiguous.
  const cfg = { projects: { '/Users/me/my.app': { mcpServers: { x: { env: { API_KEY: 'sk-abcd1234efgh5678' } } } } } };
  const [f] = findSecrets(cfg);
  assert.deepEqual(f.segments, ['projects', '/Users/me/my.app', 'mcpServers', 'x', 'env', 'API_KEY']);
});

test('findSecrets: walks arrays without losing the index', () => {
  const found = findSecrets({ list: [{ TOKEN: 'ghp_abcdefgh12345678' }] });
  assert.deepEqual(found[0].segments, ['list', '[0]', 'TOKEN']);
});

test('hookScriptPaths: pulls the script out of quoted and bare commands', () => {
  assert.deepEqual(hookScriptPaths('"$HOME/.claude/hooks/stop.sh"'), ['$HOME/.claude/hooks/stop.sh']);
  assert.deepEqual(hookScriptPaths('~/.claude/hooks/notify.sh'), ['~/.claude/hooks/notify.sh']);
  assert.deepEqual(
    hookScriptPaths('powershell -NoProfile -File "%USERPROFILE%\\.claude\\hooks\\stop.ps1"'),
    ['%USERPROFILE%\\.claude\\hooks\\stop.ps1']
  );
});

test('hookScriptPaths: finds the script inside a shell guard', () => {
  const cmd = "if [ -x '/Users/me/.orca/agent-hooks/claude-hook.sh' ]; then /bin/sh '/Users/me/.orca/agent-hooks/claude-hook.sh'; fi";
  assert.deepEqual(hookScriptPaths(cmd), ['/Users/me/.orca/agent-hooks/claude-hook.sh']);
});

test('hookScriptPaths: an inline one-liner has no script to check', () => {
  assert.deepEqual(hookScriptPaths('echo hello'), []);
  assert.deepEqual(hookScriptPaths('npm run lint'), []);
  assert.deepEqual(hookScriptPaths(''), []);
});

test('isGuarded: recognises commands that tolerate a missing script', () => {
  assert.equal(isGuarded("if [ -x '/a/b.sh' ]; then /a/b.sh; fi"), true);
  assert.equal(isGuarded('if (Test-Path $p) { & $p }'), true);
  assert.equal(isGuarded('command -v foo && foo'), true);
  assert.equal(isGuarded('"$HOME/.claude/hooks/stop.sh"'), false);
});

test('envNameFor: derives a usable variable name from the key', () => {
  assert.equal(envNameFor({ key: 'CLICKUP_API_TOKEN' }), 'CLICKUP_API_TOKEN');
  assert.equal(envNameFor({ key: 'Authorization' }), 'AUTHORIZATION');
  assert.equal(envNameFor({ key: 'api-key' }), 'API_KEY');
  assert.equal(envNameFor({ key: '2fa' }), 'CLAUDE_2FA');
});

test('checkShadowed: flags a name defined more than once, ignoring unique ones', () => {
  const out = checkShadowed({
    skill: [
      { name: 'review', path: '/a/review/SKILL.md' },
      { name: 'review', path: '/b/review/SKILL.md' },
      { name: 'solo', path: '/c/solo/SKILL.md' },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].category, 'primitives');
  assert.deepEqual(out[0].args, ['review', 'skill', 2]);
});

test('checkShadowed: name matching is case-insensitive', () => {
  const out = checkShadowed({ agent: [{ name: 'Foo', path: '/a' }, { name: 'foo', path: '/b' }] });
  assert.equal(out.length, 1);
});
