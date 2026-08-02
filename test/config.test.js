const test = require('node:test');
const assert = require('node:assert');
const { isValidRule, applyPermission } = require('../src/config');
const { addHookTo, templateCommand, HOOK_EVENTS, MATCHER_EVENTS } = require('../src/hooklib');
const { shQuote, psQuote, resumeCommand, mcpLoginCommand, getIn, setIn, exportLine } = require('../src/actions');

test('isValidRule: accepts the shapes Claude Code understands', () => {
  assert.equal(isValidRule('Read'), true);
  assert.equal(isValidRule('Bash(npm test:*)'), true);
  assert.equal(isValidRule('WebFetch(domain:example.com)'), true);
  assert.equal(isValidRule('mcp__github__create_issue'), true);
  assert.equal(isValidRule('mcp__github'), true);
});

test('isValidRule: rejects malformed or dangerous input', () => {
  assert.equal(isValidRule(''), false);
  assert.equal(isValidRule('Bash(unclosed'), false);
  assert.equal(isValidRule('two words'), false);
  assert.equal(isValidRule('Bash(a)(b)'), false);
  assert.equal(isValidRule(null), false);
  assert.equal(isValidRule('x'.repeat(500)), false);
});

test('applyPermission: a rule ends up in exactly one bucket', () => {
  const start = { allow: ['Read'], ask: [], deny: ['Read'] };
  const out = applyPermission(start, 'ask', 'Read');
  assert.deepEqual(out.allow, []);
  assert.deepEqual(out.deny, []);
  assert.deepEqual(out.ask, ['Read']);
});

test('applyPermission: keeps buckets sorted and does not mutate the input', () => {
  const start = { allow: ['Write'], ask: [], deny: [] };
  const out = applyPermission(start, 'allow', 'Bash');
  assert.deepEqual(out.allow, ['Bash', 'Write']);
  assert.deepEqual(start.allow, ['Write']);
});

test('applyPermission: tolerates a settings file with no permissions block', () => {
  assert.deepEqual(applyPermission({}, 'deny', 'Read').deny, ['Read']);
});

test('addHookTo: appends without clobbering an existing hook on the same event', () => {
  const s = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing.sh' }] }] } };
  assert.equal(addHookTo(s, 'Stop', '', 'mine.sh'), true);
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'existing.sh');
});

test('addHookTo: the same command is never registered twice', () => {
  const s = {};
  assert.equal(addHookTo(s, 'Stop', '', 'mine.sh'), true);
  assert.equal(addHookTo(s, 'Stop', '', 'mine.sh'), false);
  assert.equal(s.hooks.Stop.length, 1);
});

test('addHookTo: a matcher is only stored on events that support one', () => {
  const s = {};
  addHookTo(s, 'PreToolUse', 'Bash', 'a.sh');
  addHookTo(s, 'Stop', 'Bash', 'b.sh');
  assert.equal(s.hooks.PreToolUse[0].matcher, 'Bash');
  assert.equal(s.hooks.Stop[0].matcher, undefined);
});

test('addHookTo: refuses an unusable event name', () => {
  assert.throws(() => addHookTo({}, '__proto__', '', 'x.sh'));
});

test('hook events cover the 2.1 surface, and matcher events are a subset', () => {
  for (const e of ['PreToolUse', 'PostToolUseFailure', 'StopFailure', 'PermissionRequest', 'SubagentStart', 'DirectoryAdded']) {
    assert.ok(HOOK_EVENTS.includes(e), e + ' should be offered');
  }
  for (const e of MATCHER_EVENTS) assert.ok(HOOK_EVENTS.includes(e));
});

test('templateCommand: is stable, so an installed template is recognised again', () => {
  assert.equal(templateCommand('format-on-edit'), templateCommand('format-on-edit'));
  assert.match(templateCommand('format-on-edit'), /cc-format-on-edit\.(py|ps1)/);
});

test('shQuote / psQuote: embedded quotes cannot break out of the string', () => {
  assert.equal(shQuote("it's"), `'it'\\''s'`);
  assert.equal(psQuote("it's"), "'it''s'");
  assert.equal(shQuote('/a b/c'), "'/a b/c'");
});

test('resumeCommand: cds into the session directory before resuming', () => {
  const cmd = resumeCommand('8a810bb3-accc-4548-84db-0351afd81e9c', "/tmp/it's mine", 'darwin');
  assert.match(cmd, /^cd '\/tmp\/it'\\''s mine'; claude --resume 8a810bb3-/);
});

test('resumeCommand: refuses anything that is not a session id', () => {
  assert.throws(() => resumeCommand('; rm -rf /', '/tmp', 'darwin'));
  assert.throws(() => resumeCommand('', '/tmp', 'darwin'));
});

test('mcpLoginCommand: quotes the name and rejects shell metacharacters', () => {
  assert.equal(mcpLoginCommand('claude.ai Stack Overflow', 'darwin'), "claude mcp login 'claude.ai Stack Overflow'");
  assert.throws(() => mcpLoginCommand('a; rm -rf /', 'darwin'));
});

test('getIn / setIn: address values through keys that contain dots', () => {
  const o = { projects: { '/Users/me/my.app': { env: { K: 'v' } } } };
  const seg = ['projects', '/Users/me/my.app', 'env', 'K'];
  assert.equal(getIn(o, seg), 'v');
  assert.equal(setIn(o, seg, 'w'), true);
  assert.equal(o.projects['/Users/me/my.app'].env.K, 'w');
});

test('setIn: refuses to invent intermediate objects', () => {
  assert.equal(setIn({}, ['a', 'b', 'c'], 'x'), false);
});

test('exportLine: emits the right syntax per platform', () => {
  assert.equal(exportLine('API_KEY', "s'k", 'darwin'), `export API_KEY='s'\\''k'`);
  assert.equal(exportLine('API_KEY', 'sk', 'win32'), "setx API_KEY 'sk'");
});
