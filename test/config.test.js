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

test('resumeCommand: attaches to a detached session, resumes an interactive one', () => {
  const id = '8a810bb3-accc-4548-84db-0351afd81e9c';
  // A background/agent session is detached — join it, it keeps running.
  assert.match(resumeCommand(id, '/tmp', 'darwin', 'background'), /claude attach 8a810bb3-/);
  // An interactive session belongs to its own terminal; reopen the conversation.
  assert.match(resumeCommand(id, '/tmp', 'darwin', 'interactive'), /claude --resume 8a810bb3-/);
  assert.match(resumeCommand(id, '/tmp', 'darwin'), /claude --resume 8a810bb3-/);
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

const { ruleCatalog, RULE_CATALOG } = require('../src/config');

test('ruleCatalog: every catalogued rule is a rule the validator accepts', () => {
  // The picker writes these straight into settings.json — a malformed entry
  // would be silently ignored by Claude Code.
  for (const r of RULE_CATALOG) {
    assert.ok(isValidRule(r.rule), r.id + ' -> ' + r.rule);
    assert.ok(r.group, r.id + ' has no group');
  }
});

test('ruleCatalog: every catalogued rule has a description to show', () => {
  // The whole point is that you cannot pick from a vocabulary nobody showed you.
  const Module = require('module');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    return req === 'vscode' ? 'vscode-cfg' : orig.call(this, req, ...rest);
  };
  require.cache['vscode-cfg'] = {
    id: 'vscode-cfg', filename: 'vscode-cfg', loaded: true,
    exports: { env: { language: 'en' } },
  };
  const bundle = require('../src/i18n').bundle();
  for (const r of RULE_CATALOG) {
    assert.ok(bundle['permcat.' + r.id], 'no description for ' + r.id);
  }
  for (const g of new Set(RULE_CATALOG.map((r) => r.group))) {
    assert.ok(bundle['permgroup.' + g], 'no heading for group ' + g);
  }
  assert.ok(bundle['permgroup.mcp'] && bundle['permcat.mcp']);
});

test('ruleCatalog: MCP servers are offered, with unsafe names made safe', () => {
  const cat = ruleCatalog(['clickup', 'claude.ai Stack Overflow'], []);
  const mcp = cat.filter((r) => r.group === 'mcp');
  assert.equal(mcp.length, 2);
  assert.equal(mcp[0].rule, 'mcp__clickup');
  // Spaces would make the rule invalid, so they are normalised rather than
  // dropped — the server is still offered.
  assert.equal(mcp[1].rule, 'mcp__claude.ai_Stack_Overflow');
  for (const r of mcp) assert.ok(isValidRule(r.rule), r.rule);
});

test('ruleCatalog: rules already in a bucket are marked, not hidden', () => {
  // Hiding them would make the list change shape between visits; marking them
  // lets you see at a glance what is already governed.
  const cat = ruleCatalog([], ['Read', 'Bash(git push:*)']);
  assert.equal(cat.find((r) => r.rule === 'Read').taken, true);
  assert.equal(cat.find((r) => r.rule === 'Bash(git push:*)').taken, true);
  assert.equal(cat.find((r) => r.rule === 'Write').taken, false);
});
