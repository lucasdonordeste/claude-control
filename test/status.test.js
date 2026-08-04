const test = require('node:test');
const assert = require('node:assert');
const { parseStatus } = require('../src/status');

// Shaped like the real status.claude.com/api/v2/summary.json.
function summary(components, extra) {
  return Object.assign(
    {
      page: { name: 'Claude' },
      status: { indicator: 'none', description: 'All Systems Operational' },
      components: components.map((c) => ({ name: c[0], status: c[1] })),
      incidents: [],
    },
    extra || {}
  );
}

const HEALTHY = [
  ['claude.ai', 'operational'],
  ['Claude Console (platform.claude.com)', 'operational'],
  ['Claude API (api.anthropic.com)', 'operational'],
  ['Claude Code', 'operational'],
  ['Claude Cowork', 'operational'],
  ['Claude for Government', 'operational'],
];

test('status: all operational reads as ok', () => {
  const s = parseStatus(summary(HEALTHY));
  assert.equal(s.level, 'ok');
  assert.equal(s.label, 'All Systems Operational');
  assert.deepEqual(s.components.map((c) => c.name), ['Claude API (api.anthropic.com)', 'Claude Code']);
});

test('status: only the components the CLI depends on count', () => {
  // claude.ai and the Console can be down without affecting a terminal session,
  // and a banner that cries wolf is one you stop reading.
  const s = parseStatus(
    summary([
      ['claude.ai', 'major_outage'],
      ['Claude Console (platform.claude.com)', 'major_outage'],
      ['Claude API (api.anthropic.com)', 'operational'],
      ['Claude Code', 'operational'],
    ])
  );
  assert.equal(s.level, 'ok');
});

test('status: the worst watched component wins', () => {
  const degraded = parseStatus(
    summary([
      ['Claude API (api.anthropic.com)', 'operational'],
      ['Claude Code', 'degraded_performance'],
    ])
  );
  assert.equal(degraded.level, 'degraded');

  // The API degrading while the Claude Code component stays green is exactly the
  // case that made us watch both.
  const api = parseStatus(
    summary([
      ['Claude API (api.anthropic.com)', 'major_outage'],
      ['Claude Code', 'operational'],
    ])
  );
  assert.equal(api.level, 'major');
});

test('status: an unfamiliar severity is surfaced, not treated as healthy', () => {
  // Statuspage growing a new vocabulary must not silently render as "fine".
  const s = parseStatus(summary([['Claude Code', 'everything_is_on_fire']]));
  assert.equal(s.level, 'degraded');
});

test('status: the open incident name comes through, resolved ones do not', () => {
  const open = parseStatus(
    summary([['Claude Code', 'degraded_performance']], {
      incidents: [{ name: 'Elevated error rates', status: 'investigating' }],
    })
  );
  assert.equal(open.incident, 'Elevated error rates');

  const resolved = parseStatus(
    summary([['Claude Code', 'operational']], {
      incidents: [{ name: 'Old thing', status: 'resolved' }],
    })
  );
  assert.equal(resolved.incident, '');
});

test('status: garbage never throws and never claims health', () => {
  // The banner is decoration; it must not be able to break the panel, and it
  // must not invent an "all clear" out of a broken response.
  for (const bad of [null, undefined, '', 42, {}, { components: null }, { components: [] }]) {
    const s = parseStatus(bad);
    assert.equal(s.level, 'unknown', 'for ' + JSON.stringify(bad));
  }
  // A payload with only components we do not watch is unusable, not healthy.
  assert.equal(parseStatus(summary([['Claude Cowork', 'operational']])).level, 'unknown');
});

test('status: component groups are not mistaken for components', () => {
  // Statuspage repeats a group header as an entry with `group: true`; counting it
  // would double-count the group's children.
  const s = parseStatus({
    status: { description: 'x' },
    components: [
      { name: 'Claude Code', status: 'major_outage', group: true },
      { name: 'Claude Code', status: 'operational' },
    ],
    incidents: [],
  });
  assert.equal(s.level, 'ok');
});
