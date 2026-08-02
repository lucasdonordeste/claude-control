const test = require('node:test');
const assert = require('node:assert');
const {
  scanTranscript,
  aggregate,
  fillDays,
  burnRate,
  cacheHitRate,
  totalTokens,
  projectNameFromDir,
} = require('../src/metrics');

const turn = (ts, model, u) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: '/Volumes/x/allium-web',
    message: { model, usage: u },
  });

test('scanTranscript: buckets usage by local day and by model', () => {
  const text = [
    turn('2026-08-02T10:00:00.000Z', 'claude-opus-5', {
      input_tokens: 2,
      output_tokens: 100,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 50,
    }),
    turn('2026-08-02T11:00:00.000Z', 'claude-opus-5', { input_tokens: 3, output_tokens: 200 }),
  ].join('\n');
  const r = scanTranscript(text);
  const day = r.days[Object.keys(r.days)[0]];
  assert.equal(day.turns, 2);
  assert.equal(day.output, 300);
  assert.equal(day.cacheRead, 5000);
  assert.equal(r.models['claude-opus-5'].turns, 2);
});

test('scanTranscript: recovers the real cwd for a truthful project name', () => {
  assert.equal(scanTranscript(turn('2026-08-02T10:00:00Z', 'claude-opus-5', {})).cwd, '/Volumes/x/allium-web');
});

test('scanTranscript: skips synthetic turns and non-assistant lines', () => {
  const text = [
    turn('2026-08-02T10:00:00.000Z', '<synthetic>', { input_tokens: 999, output_tokens: 999 }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-02T10:00:00Z', message: { model: 'm' } }),
    'not json at all',
  ].join('\n');
  const r = scanTranscript(text);
  assert.deepEqual(r.models, {});
  assert.deepEqual(r.days, {});
});

test('scanTranscript: empty input yields empty buckets, not a throw', () => {
  assert.deepEqual(scanTranscript('').days, {});
  assert.deepEqual(scanTranscript(null).models, {});
});

test('aggregate: sums across files and clips to the window', () => {
  const files = [
    {
      project: 'a',
      days: { '2026-07-01': { input: 1, output: 2, cacheRead: 3, cacheCreate: 4, turns: 1 } },
      models: { m1: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4, turns: 1 } },
    },
    {
      project: 'b',
      days: { '2026-08-01': { input: 10, output: 20, cacheRead: 30, cacheCreate: 40, turns: 2 } },
      models: { m1: { input: 10, output: 20, cacheRead: 30, cacheCreate: 40, turns: 2 } },
    },
  ];
  const r = aggregate(files, '2026-07-15');
  assert.equal(r.total.turns, 2); // the July file is outside the window
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].name, 'b');
  assert.equal(r.days.length, 1);
});

test('aggregate: days come back in chronological order', () => {
  const files = [
    {
      project: 'a',
      days: {
        '2026-08-03': { input: 1, output: 0, cacheRead: 0, cacheCreate: 0, turns: 1 },
        '2026-08-01': { input: 1, output: 0, cacheRead: 0, cacheCreate: 0, turns: 1 },
      },
      models: {},
    },
  ];
  assert.deepEqual(aggregate(files, '2026-07-01').days.map((d) => d.day), ['2026-08-01', '2026-08-03']);
});

test('fillDays: gaps become zero days so the chart stays a calendar', () => {
  const filled = fillDays([{ day: '2026-08-02', total: 5, turns: 1 }], 3, '2026-08-03');
  assert.deepEqual(filled.map((d) => d.day), ['2026-08-01', '2026-08-02', '2026-08-03']);
  assert.equal(filled[0].total, 0);
  assert.equal(filled[1].total, 5);
});

test('cacheHitRate: measures reads against the whole prompt side', () => {
  assert.equal(cacheHitRate({ input: 0, cacheRead: 90, cacheCreate: 10 }), 0.9);
  assert.equal(cacheHitRate({ input: 0, cacheRead: 0, cacheCreate: 0 }), 0);
});

test('totalTokens: counts every direction', () => {
  assert.equal(totalTokens({ input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }), 10);
});

test('burnRate: derives a rate and a time-to-full from a rising series', () => {
  const now = 1785700000000;
  const h = (n) => now - n * 3600000;
  const hist = [
    { t: h(3), s: 10 },
    { t: h(2), s: 20 },
    { t: h(1), s: 30 },
    { t: now, s: 40 },
  ];
  const r = burnRate(hist, 's', 40, now);
  assert.ok(Math.abs(r.ratePerHour - 10) < 0.001);
  assert.equal(r.minutesLeft, 360); // 60 points left at 10%/h
});

test('burnRate: measures only the run since the last window reset', () => {
  const now = 1785700000000;
  const h = (n) => now - n * 3600000;
  const hist = [
    { t: h(5), s: 80 },
    { t: h(4), s: 95 },
    { t: h(3), s: 5 }, // window rolled over here
    { t: h(2), s: 10 },
    { t: h(1), s: 15 },
    { t: now, s: 20 },
  ];
  const r = burnRate(hist, 's', 20, now);
  assert.ok(Math.abs(r.ratePerHour - 5) < 0.001); // 5%/h since the reset, not the average
});

test('burnRate: says nothing when there is nothing honest to say', () => {
  const now = 1785700000000;
  assert.equal(burnRate([], 's', 0, now), null);
  assert.equal(burnRate([{ t: now, s: 1 }], 's', 1, now), null); // too few points
  // a series that went cold must not be projected forward
  const cold = [
    { t: now - 7200000, s: 10 },
    { t: now - 7000000, s: 20 },
    { t: now - 6800000, s: 30 },
  ];
  assert.equal(burnRate(cold, 's', 30, now), null);
});

test('burnRate: a window that resets before it fills reports that, not a time', () => {
  const now = 1785700000000;
  const h = (n) => now - n * 3600000;
  const hist = [
    { t: h(3), s: 10 },
    { t: h(2), s: 20 },
    { t: h(1), s: 30 },
    { t: now, s: 40 },
  ];
  // 6h to fill, but the 5h window rolls over in 1h — the projection is moot.
  const r = burnRate(hist, 's', 40, now, now + 3600000);
  assert.equal(r.minutesLeft, null);
  assert.equal(r.resetsFirst, true);
  // With a reset far enough out, the time-to-full stands.
  const r2 = burnRate(hist, 's', 40, now, now + 40 * 3600000);
  assert.equal(r2.minutesLeft, 360);
  assert.equal(r2.resetsFirst, false);
});

test('burnRate: a flat series has no time-to-full', () => {
  const now = 1785700000000;
  const hist = [
    { t: now - 3600000, s: 40 },
    { t: now - 1800000, s: 40 },
    { t: now, s: 40 },
  ];
  assert.equal(burnRate(hist, 's', 40, now).minutesLeft, null);
});

test('projectNameFromDir: falls back to the last encoded segment', () => {
  assert.equal(projectNameFromDir('-Volumes-ssd-external-Jobs-claude-control'), 'control');
  assert.equal(projectNameFromDir(''), '');
});
