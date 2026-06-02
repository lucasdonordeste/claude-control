const test = require('node:test');
const assert = require('node:assert');
const { prettyModel, contextTokens, pickWindow, latestSessionInfo, encodeProjectDir } = require('../src/session');

test('prettyModel: maps known Claude ids to short names', () => {
  assert.equal(prettyModel('claude-opus-4-8'), 'Opus 4.8');
  assert.equal(prettyModel('claude-sonnet-4-6'), 'Sonnet 4.6');
  assert.equal(prettyModel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});

test('prettyModel: falls back gracefully', () => {
  assert.equal(prettyModel('claude-future-x'), 'future-x');
  assert.equal(prettyModel(''), '');
  assert.equal(prettyModel(null), '');
});

test('contextTokens: sums input + cache read + cache creation', () => {
  assert.equal(
    contextTokens({ input_tokens: 2, cache_read_input_tokens: 236402, cache_creation_input_tokens: 946 }),
    237350
  );
  assert.equal(contextTokens({}), 0);
  assert.equal(contextTokens(null), 0);
});

test('latestSessionInfo: returns the last assistant turn with usage', () => {
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 2, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 } } }),
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
  ].join('\n');
  const r = latestSessionInfo(lines);
  assert.equal(r.model, 'Opus 4.8');
  assert.equal(r.tokens, 552);
  assert.equal(r.window, 200000); // under 200k -> standard window
});

test('pickWindow: flips to 1M once a prompt exceeds 200k', () => {
  assert.equal(pickWindow(150000), 200000);
  assert.equal(pickWindow(200000), 200000);
  assert.equal(pickWindow(200001), 1000000);
  assert.equal(pickWindow(295452), 1000000);
});

test('latestSessionInfo: auto-detects the 1M window and reads tier', () => {
  const lines = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 2, cache_read_input_tokens: 295000, service_tier: 'standard' } } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1, cache_read_input_tokens: 150000, service_tier: 'priority' } } }),
  ].join('\n');
  const r = latestSessionInfo(lines);
  assert.equal(r.tokens, 150001); // latest turn
  assert.equal(r.tier, 'priority');
  assert.equal(r.window, 1000000); // an earlier turn peaked above 200k
});

test('latestSessionInfo: skips partial/invalid leading lines (tail read)', () => {
  const text =
    '{"partial": broken json' +
    '\n' +
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 10 } } });
  const r = latestSessionInfo(text);
  assert.equal(r.model, 'Sonnet 4.6');
  assert.equal(r.tokens, 10);
});

test('latestSessionInfo: null when no assistant usage present', () => {
  assert.equal(latestSessionInfo(''), null);
  assert.equal(latestSessionInfo(JSON.stringify({ type: 'user', message: {} })), null);
});

test('encodeProjectDir: non-alphanumerics become dashes', () => {
  assert.equal(
    encodeProjectDir('/Volumes/ssd_external/Jobs/claude-control'),
    '-Volumes-ssd-external-Jobs-claude-control'
  );
});
