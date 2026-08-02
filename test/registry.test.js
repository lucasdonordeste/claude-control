const test = require('node:test');
const assert = require('node:assert');
const { normalizeEntry, groupByProject, STALE_MS } = require('../src/registry');

const NOW = 1785705400000;
const base = {
  pid: 45357,
  sessionId: '8a810bb3-accc-4548-84db-0351afd81e9c',
  cwd: '/Volumes/x/claude-control',
  startedAt: NOW - 60000,
  updatedAt: NOW - 1000,
  version: '2.1.220',
  kind: 'interactive',
  entrypoint: 'cli',
  name: 'claude-control-35',
  status: 'busy',
};

test('normalizeEntry: keeps the reported status while the process is alive', () => {
  const e = normalizeEntry(base, true, NOW);
  assert.equal(e.status, 'busy');
  assert.equal(e.alive, true);
  assert.equal(e.pid, 45357);
  assert.equal(e.version, '2.1.220');
});

test('normalizeEntry: a dead process is "ended" regardless of its last status', () => {
  const e = normalizeEntry(base, false, NOW);
  assert.equal(e.status, 'ended');
  assert.equal(e.alive, false);
});

test('normalizeEntry: rejects records without a session id or cwd', () => {
  assert.equal(normalizeEntry({ ...base, sessionId: '' }, true, NOW), null);
  assert.equal(normalizeEntry({ ...base, cwd: '' }, true, NOW), null);
  assert.equal(normalizeEntry(null, true, NOW), null);
  assert.equal(normalizeEntry('nope', true, NOW), null);
});

test('normalizeEntry: drops entries older than the stale window', () => {
  const old = { ...base, updatedAt: NOW - STALE_MS - 1, startedAt: NOW - STALE_MS - 1 };
  assert.equal(normalizeEntry(old, false, NOW), null);
});

test('normalizeEntry: tolerates missing optional fields', () => {
  const e = normalizeEntry({ sessionId: 'a', cwd: '/x' }, true, NOW);
  assert.equal(e.name, '');
  assert.equal(e.version, '');
  assert.equal(e.pid, 0);
  assert.equal(e.status, 'idle');
});

test('groupByProject: open workspace roots come first, in workspace order', () => {
  const sessions = [
    { sessionId: 'a', cwd: '/other/proj', updatedAt: 300 },
    { sessionId: 'b', cwd: '/ws/two', updatedAt: 200 },
    { sessionId: 'c', cwd: '/ws/one', updatedAt: 100 },
  ];
  const groups = groupByProject(sessions, ['/ws/one', '/ws/two']);
  assert.deepEqual(groups.map((g) => g.name), ['one', 'two', 'proj']);
  assert.equal(groups[0].isWorkspace, true);
  assert.equal(groups[2].isWorkspace, false);
});

test('groupByProject: sessions sharing a cwd land in one group', () => {
  const sessions = [
    { sessionId: 'a', cwd: '/ws/one', updatedAt: 300 },
    { sessionId: 'b', cwd: '/ws/one', updatedAt: 200 },
  ];
  const groups = groupByProject(sessions, ['/ws/one']);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sessions.length, 2);
});

test('groupByProject: non-workspace groups are ordered by recency', () => {
  const sessions = [
    { sessionId: 'a', cwd: '/other/old', updatedAt: 100 },
    { sessionId: 'b', cwd: '/other/new', updatedAt: 900 },
  ];
  const groups = groupByProject(sessions, []);
  assert.deepEqual(groups.map((g) => g.name), ['new', 'old']);
});
