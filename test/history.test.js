const test = require('node:test');
const assert = require('node:assert');
const { parse, search, oneLine } = require('../src/history');

const NOW = 1785705527289;
const day = 86400000;
const line = (o) => JSON.stringify(o);

test('parse: newest first, and unusable rows are skipped', () => {
  const text = [
    line({ display: 'oldest', timestamp: NOW - 3 * day, project: '/a', sessionId: 's1' }),
    'not json',
    line({ display: '   ', timestamp: NOW, project: '/a' }),
    line({ nope: true }),
    line({ display: 'newest', timestamp: NOW, project: '/b', sessionId: 's2' }),
  ].join('\n');
  const out = parse(text);
  assert.deepEqual(out.map((e) => e.text), ['newest', 'oldest']);
  assert.equal(out[0].project, '/b');
  assert.equal(out[0].sessionId, 's2');
});

test('parse: honours the cap, keeping the newest', () => {
  const text = Array.from({ length: 50 }, (_, i) =>
    line({ display: 'p' + i, timestamp: NOW - i * 1000 })
  ).join('\n');
  const out = parse(text, 5);
  assert.equal(out.length, 5);
  assert.equal(out[0].text, 'p49'); // last line is newest in file order
});

test('parse: an empty or unreadable history is empty, not a throw', () => {
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse('\n\n'), []);
});

const entries = [
  { text: 'webhook retry with exponential backoff', at: NOW - 20 * day, project: '/a', sessionId: 's1' },
  { text: 'fix the webhook', at: NOW - 1 * day, project: '/a', sessionId: 's2' },
  { text: 'add a retry to the queue consumer', at: NOW - 40 * day, project: '/b', sessionId: 's3' },
  { text: 'unrelated styling work', at: NOW, project: '/b', sessionId: 's4' },
];

test('search: every term must be present', () => {
  const r = search(entries, 'webhook retry', { now: NOW });
  assert.equal(r.length, 1);
  assert.equal(r[0].text, 'webhook retry with exponential backoff');
});

test('search: with recency equal, an earlier match wins', () => {
  // Same age, same word: the only difference is where the term sits, and a term
  // that leads the prompt is the topic rather than an aside.
  const same = [
    { text: 'a'.repeat(80) + ' webhook', at: NOW, project: '/a', sessionId: 's1' },
    { text: 'webhook ' + 'a'.repeat(80), at: NOW, project: '/a', sessionId: 's2' },
  ];
  assert.equal(search(same, 'webhook', { now: NOW })[0].sessionId, 's2');
});

test('search: with position equal, the more recent wins', () => {
  const same = [
    { text: 'webhook please', at: NOW - 30 * day, project: '/a', sessionId: 'old' },
    { text: 'webhook please', at: NOW, project: '/a', sessionId: 'new' },
  ];
  assert.equal(search(same, 'webhook', { now: NOW })[0].sessionId, 'new');
});

test('search: a whole word beats an incidental substring', () => {
  const same = [
    { text: 'rewebhooking the thing', at: NOW, project: '/a', sessionId: 'sub' },
    { text: 'the webhook thing', at: NOW, project: '/a', sessionId: 'word' },
  ];
  assert.equal(search(same, 'webhook', { now: NOW })[0].sessionId, 'word');
});

test('search: recency is bounded, so it cannot beat a far better position', () => {
  // Six weeks older, but the term leads the prompt instead of trailing 200
  // characters in. Nothing about "yesterday" should outrank that.
  const same = [
    { text: 'webhook retry design', at: NOW - 42 * day, project: '/a', sessionId: 'topic' },
    { text: 'x'.repeat(200) + ' webhook', at: NOW, project: '/a', sessionId: 'aside' },
  ];
  assert.equal(search(same, 'webhook', { now: NOW })[0].sessionId, 'topic');
});

test('search: an empty query returns everything, newest first', () => {
  const r = search(entries, '', { now: NOW });
  assert.equal(r.length, entries.length);
  assert.equal(r[0].text, 'unrelated styling work');
});

test('search: a term with regex metacharacters does not throw', () => {
  assert.doesNotThrow(() => search(entries, 'c++ (a|b) [x]', { now: NOW }));
  assert.deepEqual(search(entries, 'c++', { now: NOW }), []);
});

test('search: respects the limit', () => {
  assert.equal(search(entries, '', { now: NOW, limit: 2 }).length, 2);
});

test('oneLine: collapses whitespace and truncates', () => {
  assert.equal(oneLine('a\n\n  b\tc'), 'a b c');
  assert.equal(oneLine('x'.repeat(300)).length, 120);
  assert.equal(oneLine('x'.repeat(300), 10).length, 10);
});
