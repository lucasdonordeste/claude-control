const test = require('node:test');
const assert = require('node:assert');
const { classifyUsageResponse, mergeHistory } = require('../src/usage');

test('classifyUsageResponse: valid 200 is cached and returns ok', () => {
  const r = classifyUsageResponse(200, JSON.stringify({ five_hour: { utilization: 12 } }), {}, null);
  assert.equal(r.state, 'ok');
  assert.ok(r.cache);
  assert.equal(r.value.five_hour.utilization, 12);
});

test('classifyUsageResponse: 200 with invalid shape is an error, never cached', () => {
  const r = classifyUsageResponse(200, JSON.stringify({ nope: 1 }), {}, null);
  assert.equal(r.state, 'error');
  assert.equal(r.cache, undefined);
});

test('classifyUsageResponse: 429 backs off and honours retry-after', () => {
  const noPrev = classifyUsageResponse(429, '', {}, null);
  assert.equal(noPrev.state, 'ratelimited');
  assert.equal(noPrev.backoffMs, 120000);

  const withPrev = classifyUsageResponse(429, '', { 'retry-after': '30' }, { five_hour: {} });
  assert.equal(withPrev.state, 'stale');
  assert.equal(withPrev.backoffMs, 30000);
});

test('classifyUsageResponse: a server error keeps the last good value (stale) and never caches', () => {
  const prev = { five_hour: { utilization: 5 } };
  const r = classifyUsageResponse(500, 'oops', {}, prev);
  assert.equal(r.state, 'stale');
  assert.equal(r.value, prev);
  assert.equal(r.cache, undefined);
});

test('classifyUsageResponse: non-JSON body', () => {
  assert.equal(classifyUsageResponse(200, '<<not json', {}, null).state, 'error');
});

test('mergeHistory: coalesces points within 45s, appends after', () => {
  let h = [];
  h = mergeHistory(h, { s: 1, w: 2 }, 1000);
  assert.equal(h.length, 1);

  h = mergeHistory(h, { s: 3, w: 4 }, 1000 + 44000);
  assert.equal(h.length, 1, 'point within 45s should coalesce');
  assert.deepEqual(h[0], { t: 45000, s: 3, w: 4 });

  h = mergeHistory(h, { s: 5, w: 6 }, 45000 + 50000);
  assert.equal(h.length, 2, 'point after 45s should append');
});

test('mergeHistory: caps the series at 240 points', () => {
  let h = [];
  for (let i = 0; i < 300; i++) h = mergeHistory(h, { s: i, w: i }, i * 60000);
  assert.equal(h.length, 240);
  assert.equal(h[h.length - 1].s, 299);
});
