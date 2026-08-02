const test = require('node:test');
const assert = require('node:assert');
const { scanAgentTranscript, buildTree } = require('../src/agents');

test('scanAgentTranscript: reads the latest turn and collects spawned tool ids', () => {
  const text = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-02T10:00:00Z',
      message: {
        model: 'claude-sonnet-5',
        usage: { input_tokens: 5, cache_read_input_tokens: 1000 },
        content: [{ type: 'tool_use', id: 'toolu_child', name: 'Agent', input: { description: 'sub' } }],
      },
    }),
  ].join('\n');
  const r = scanAgentTranscript(text);
  assert.equal(r.tokens, 1005);
  assert.equal(r.model, 'Sonnet 5');
  assert.deepEqual(r.spawnedIds, ['toolu_child']);
  assert.equal(r.lastTool.verb, 'delegating');
  assert.equal(r.lastTool.running, true);
});

test('scanAgentTranscript: a tool call with a result is no longer running', () => {
  const text = [
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'ls' } }] },
    }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x1' }] } }),
  ].join('\n');
  assert.equal(scanAgentTranscript(text).lastTool.running, false);
});

test('scanAgentTranscript: empty and malformed input are safe', () => {
  assert.equal(scanAgentTranscript('').tokens, 0);
  assert.equal(scanAgentTranscript('{broken').lastTool, null);
});

test('buildTree: nests a child under the agent whose call spawned it', () => {
  const agents = [
    { id: 'a', toolUseId: 'from-session', spawnedIds: ['t-b'], spawnDepth: 1, startedAt: 1 },
    { id: 'b', toolUseId: 't-b', spawnedIds: [], spawnDepth: 2, startedAt: 2 },
  ];
  const tree = buildTree(agents);
  assert.deepEqual(tree.map((x) => [x.id, x.depth]), [['a', 0], ['b', 1]]);
});

test('buildTree: siblings keep start order, and grandchildren stay depth-first', () => {
  const agents = [
    { id: 'a', toolUseId: 's1', spawnedIds: ['t-c'], spawnDepth: 1, startedAt: 1 },
    { id: 'b', toolUseId: 's2', spawnedIds: [], spawnDepth: 1, startedAt: 3 },
    { id: 'c', toolUseId: 't-c', spawnedIds: ['t-d'], spawnDepth: 2, startedAt: 2 },
    { id: 'd', toolUseId: 't-d', spawnedIds: [], spawnDepth: 3, startedAt: 4 },
  ];
  assert.deepEqual(
    buildTree(agents).map((x) => [x.id, x.depth]),
    [['a', 0], ['c', 1], ['d', 2], ['b', 0]]
  );
});

test('buildTree: an unseen parent leaves the agent at the root', () => {
  const agents = [{ id: 'a', toolUseId: 'never-seen', spawnedIds: [], spawnDepth: 1, startedAt: 1 }];
  assert.deepEqual(buildTree(agents).map((x) => x.depth), [0]);
});

test('buildTree: a cycle cannot hang the walk', () => {
  const agents = [
    { id: 'a', toolUseId: 't-b', spawnedIds: ['t-a'], spawnDepth: 1, startedAt: 1 },
    { id: 'b', toolUseId: 't-a', spawnedIds: ['t-b'], spawnDepth: 2, startedAt: 2 },
  ];
  const tree = buildTree(agents);
  assert.equal(tree.length, 2);
  assert.deepEqual(new Set(tree.map((x) => x.id)), new Set(['a', 'b']));
});

test('buildTree: an empty list is an empty tree', () => {
  assert.deepEqual(buildTree([]), []);
});

test('scanAgentTranscript: end_turn is the explicit finished marker', () => {
  const text = JSON.stringify({
    type: 'assistant',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  });
  const r = scanAgentTranscript(text);
  assert.equal(r.finished, true);
});

test('scanAgentTranscript: a final text block with no marker is only "settled"', () => {
  // Roughly one finished agent in ten closes this way; calling it finished
  // outright would risk cutting off one that is still streaming, so it is
  // settled and the caller adds a quiet period.
  const text = JSON.stringify({
    type: 'assistant',
    message: { stop_reason: null, content: [{ type: 'text', text: 'the answer' }] },
  });
  const r = scanAgentTranscript(text);
  assert.equal(r.finished, false);
  assert.equal(r.settled, true);
});

test('scanAgentTranscript: an agent mid-tool is neither finished nor settled', () => {
  const text = JSON.stringify({
    type: 'assistant',
    message: { stop_reason: null, content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: {} }] },
  });
  const r = scanAgentTranscript(text);
  assert.equal(r.finished, false);
  assert.equal(r.settled, false);
});

test('scanAgentTranscript: a tool answered inside the same entry is not running', () => {
  // The backward outer scan cannot see a result that shares its call's entry
  // unless the inner walk also goes backwards.
  const text = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_result', tool_use_id: 'u1' },
      ],
    },
  });
  assert.equal(scanAgentTranscript(text).lastTool.running, false);
});
