const test = require('node:test');
const assert = require('node:assert');
const { usageStyle, isHexColor } = require('../src/statusbar');

test('usage mode: green → amber → red ramp by threshold', () => {
  assert.deepEqual(usageStyle('usage', 10), { color: '#3fb950', background: null });
  assert.deepEqual(usageStyle('usage', 60), { color: '#e8b339', background: null });
  assert.deepEqual(usageStyle('usage', 90), { color: '#e0706b', background: null });
});

test('adaptive mode: neutral when healthy, native pill when high', () => {
  assert.deepEqual(usageStyle('adaptive', 10), { color: null, background: null });
  assert.deepEqual(usageStyle('adaptive', 60), {
    color: null,
    background: 'statusBarItem.warningBackground',
  });
  assert.deepEqual(usageStyle('adaptive', 85), {
    color: null,
    background: 'statusBarItem.errorBackground',
  });
});

test('adaptive is the default for unknown / missing modes', () => {
  assert.deepEqual(usageStyle(undefined, 90), {
    color: null,
    background: 'statusBarItem.errorBackground',
  });
  assert.deepEqual(usageStyle('bogus', 10), { color: null, background: null });
});

test('custom mode: uses the chosen color, ignores utilization', () => {
  assert.deepEqual(usageStyle('custom', 10, '#88aaff'), { color: '#88aaff', background: null });
  assert.deepEqual(usageStyle('custom', 95, '#fff'), { color: '#fff', background: null });
});

test('custom mode: invalid color falls back to theme default (null)', () => {
  assert.deepEqual(usageStyle('custom', 50, 'blue'), { color: null, background: null });
  assert.deepEqual(usageStyle('custom', 50, ''), { color: null, background: null });
  assert.deepEqual(usageStyle('custom', 50, undefined), { color: null, background: null });
});

test('none mode: always theme default', () => {
  assert.deepEqual(usageStyle('none', 10), { color: null, background: null });
  assert.deepEqual(usageStyle('none', 95), { color: null, background: null });
});

test('utilization is clamped, null/NaN treated as 0', () => {
  assert.deepEqual(usageStyle('usage', -5), { color: '#3fb950', background: null });
  assert.deepEqual(usageStyle('usage', 150), { color: '#e0706b', background: null });
  assert.deepEqual(usageStyle('adaptive', null), { color: null, background: null });
});

test('isHexColor: accepts #rgb and #rrggbb, rejects the rest', () => {
  assert.ok(isHexColor('#fff'));
  assert.ok(isHexColor('#3fb950'));
  assert.ok(isHexColor('  #ABC  '));
  assert.ok(!isHexColor('fff'));
  assert.ok(!isHexColor('#gggggg'));
  assert.ok(!isHexColor('red'));
  assert.ok(!isHexColor(null));
});
