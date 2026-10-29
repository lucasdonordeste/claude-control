const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCatalog, readCatalog, resolveModel, findModel, windowFor } = require('../src/catalog');
const { applyEffort, applyMode, effortState, modelOptions, attributionHidden } = require('../src/config');
const { ignoredSettings } = require('../src/doctor');
const { tmuxAttachCommand } = require('../src/actions');
const { normalizeEntry } = require('../src/registry');

const RAW = {
  fetchedAt: 10,
  catalog: {
    config: {
      models: [
        {
          id: 'claude-opus-5-5',
          name: 'Opus 5.5',
          section: 'main',
          thinking: {
            effort_options: [
              { id: 'medium', badge: { message: 'Recommended', variant: 'neutral' } },
              { id: 'max', badge: { message: '3.5× or more usage', variant: 'warning' } },
            ],
          },
          runtime: { max_input_tokens: 1000000, effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'], default_effort: 'medium' },
        },
        { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', section: 'overflow', runtime: { max_input_tokens: 200000 } },
        { name: 'no id — skipped' },
      ],
      provider_alias_targets: { opus: { default: 'claude-opus-5-5', per_provider: { gateway: 'x' } } },
    },
  },
};

test('parseCatalog: keeps what the panel needs, drops what it cannot use', () => {
  const c = parseCatalog(RAW);
  assert.equal(c.models.length, 2);
  assert.equal(c.models[0].window, 1000000);
  assert.equal(c.models[0].defaultEffort, 'medium');
  assert.deepEqual(c.models[0].effortWarnings, { max: '3.5× or more usage' });
  assert.deepEqual(c.models[1].effortLevels, []);
  assert.deepEqual(c.aliases, { opus: 'claude-opus-5-5' });
  assert.equal(parseCatalog({}), null);
  assert.equal(parseCatalog(null), null);
});

test('readCatalog: freshest valid file wins; a broken one is skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cat-'));
  fs.writeFileSync(path.join(dir, 'a-cc.json'), JSON.stringify(RAW));
  fs.writeFileSync(path.join(dir, 'b-cc.json'), JSON.stringify({ ...RAW, fetchedAt: 99 }));
  fs.writeFileSync(path.join(dir, 'c-cc.json'), '{ half');
  fs.writeFileSync(path.join(dir, 'published-floor.json'), '{}');
  assert.equal(readCatalog(dir).fetchedAt, 99);
  assert.equal(readCatalog(path.join(dir, 'nope')), null);
});

test('resolveModel / findModel / windowFor', () => {
  const c = parseCatalog(RAW);
  assert.equal(resolveModel(c, 'opus'), 'claude-opus-5-5');
  assert.equal(resolveModel(c, 'opus[1m]'), 'claude-opus-5-5');
  assert.equal(resolveModel(c, 'claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(resolveModel(c, 'mystery'), '');
  assert.equal(resolveModel(c, ''), '');
  assert.equal(resolveModel(null, 'opus'), '');
  assert.equal(findModel(c, 'claude-opus-5-5-20261001').name, 'Opus 5.5', 'a dated id falls back to its family');
  assert.equal(findModel(c, 'claude-opus-5'), null, 'a shorter id is not a newer model');
  assert.equal(findModel(c, 'claude-opus-5-5-beta'), null);
  assert.equal(windowFor(c, 'claude-opus-5-5'), 1000000);
  assert.equal(windowFor(c, 'claude-unknown-9'), 0);
});

test('effort is per model when the model is known, global otherwise', () => {
  const c = parseCatalog(RAW);
  const s = applyEffort({ model: 'opus', effortLevel: 'xhigh' }, 'high', c);
  assert.deepEqual(s.modelSettings, { 'claude-opus-5-5': { effortLevel: 'high' } });
  assert.equal(s.effortLevel, 'xhigh', 'the legacy key is left alone');
  const st = effortState(s, c);
  assert.equal(st.effortLevel, 'high');
  assert.equal(st.effortModelName, 'Opus 5.5');
  assert.equal(st.legacyEffort, 'xhigh');
  // Clearing removes the entry and the then-empty container.
  applyEffort(s, '', c);
  assert.equal(s.modelSettings, undefined);
  // Other per-model keys survive.
  const k = applyEffort({ model: 'opus', modelSettings: { 'claude-opus-5-5': { maxEffortLevel: 'high' } } }, '', c);
  assert.deepEqual(k.modelSettings, { 'claude-opus-5-5': { maxEffortLevel: 'high' } });
  // Unknown model: the old top-level key.
  assert.equal(applyEffort({ model: 'mystery' }, 'low', c).effortLevel, 'low');
});

test('a global effortLevel: honoured on older models, flagged on newer ones', () => {
  const raw = JSON.parse(JSON.stringify(RAW));
  raw.catalog.config.models[0].min_claude_code_version = '2.1.280';
  raw.catalog.config.models.push({ id: 'claude-opus-4-8', name: 'Opus 4.8', runtime: { effort_levels: ['low', 'high', 'ultra'] } });
  const c = parseCatalog(raw);
  const newer = effortState({ model: 'opus', effortLevel: 'xhigh' }, c);
  assert.equal(newer.effortLevel, '');
  assert.equal(newer.legacyIgnored, true);
  const older = effortState({ model: 'claude-opus-4-8', effortLevel: 'high' }, c);
  assert.equal(older.effortLevel, 'high');
  assert.equal(older.effortFromLegacy, true);
  assert.deepEqual(older.effortLevels, ['low', 'high'], 'levels this build cannot write are left out');
  // Clicking the active (inherited) level clears the global key it came from.
  const cleared = applyEffort({ model: 'claude-opus-4-8', effortLevel: 'high' }, '', c);
  assert.equal(cleared.effortLevel, undefined);
});

test('the permission mode is written under permissions, and the stray copy removed', () => {
  const s = applyMode({ defaultMode: 'plan', permissions: { allow: ['Read'] } }, 'acceptEdits');
  assert.deepEqual(s, { permissions: { allow: ['Read'], defaultMode: 'acceptEdits' } });
  assert.deepEqual(applyMode({ permissions: { defaultMode: 'plan' } }, ''), {});
});

test('modelOptions labels aliases with what they run today', () => {
  const o = modelOptions(parseCatalog(RAW));
  assert.deepEqual(o.find((x) => x.value === 'opus'), { value: 'opus', name: 'Opus 5.5', window: 1000000 });
  assert.equal(o.find((x) => x.value === 'sonnet').name, '');
});

test('attributionHidden: boolean and emptied-object forms', () => {
  assert.equal(attributionHidden(false), true);
  assert.equal(attributionHidden({ commit: '', pr: '' }), true);
  assert.equal(attributionHidden({ commit: 'x', pr: '' }), false);
  assert.equal(attributionHidden(undefined), false);
});

test('ignoredSettings: flags what a current CLI silently drops', () => {
  const proj = { label: 'p/.claude/settings.json', path: '/p/s.json', owner: '/p' };
  const user = { label: 'settings.json', path: '/u/s.json' };
  const keys = (obj, f) => ignoredSettings(obj, f).map((x) => x.key).sort();
  assert.deepEqual(keys({ permissions: { defaultMode: 'auto' } }, proj), ['doc.projectMode']);
  assert.deepEqual(keys({ permissions: { defaultMode: 'auto' } }, user), []);
  assert.deepEqual(keys({ defaultMode: 'plan' }, user), ['doc.strayMode']);
  assert.deepEqual(keys({ env: { TMPDIR: '/x', OTEL_LOGS_EXPORTER: 'otlp', FOO: '1' } }, proj), ['doc.projectEnv']);
  assert.deepEqual(keys({ env: { TMPDIR: '/x' } }, user), []);
  assert.deepEqual(keys({ keybindingFlavor: 'vim', env: { TASK_MAX_OUTPUT_LENGTH: '1' } }, user), ['doc.deadKey']);
  assert.deepEqual(keys({ enabledMcpjsonServers: 'one' }, user), ['doc.mcpjsonString']);
  assert.deepEqual(keys({ permissions: { allow: ['Bash(ls) x', 'Bash(ls)', 'Read'] } }, user), ['doc.badRule']);
  assert.deepEqual(
    keys({ hooks: { PermissionRequest: [{ hooks: [{ type: 'agent', prompt: 'x' }] }] } }, user),
    ['doc.agentHookPerm']
  );
  assert.deepEqual(keys({ mcpServers: { a: { type: 'sdk' }, b: { command: 'x' } } }, user), ['doc.mcpSdk']);
  assert.deepEqual(keys(null, user), []);
  assert.deepEqual(keys({}, user), []);
});

test('tmuxAttachCommand: quotes the session, checks the ids', () => {
  assert.equal(
    tmuxAttachCommand("my'sess:@1.%3"),
    "tmux attach-session -t '=my'\\''sess' \\; select-window -t @1 \\; select-pane -t %3"
  );
  assert.throws(() => tmuxAttachCommand('sess:@1.%3; rm -rf ~'));
  assert.throws(() => tmuxAttachCommand(''));
});

test('registry: tmux and Remote Control ids are carried only when well-formed', () => {
  const base = { sessionId: '2218e918-6680-4cb0-8414-a9015051f8b2', cwd: '/x', updatedAt: 1 };
  const ok = normalizeEntry({ ...base, tmux: 'cc-x:@0.%0', bridgeSessionId: 'session_01DZKAr7xPH9RG1QM8' }, true, 2);
  assert.equal(ok.tmux, 'cc-x:@0.%0');
  assert.equal(ok.bridgeSessionId, 'session_01DZKAr7xPH9RG1QM8');
  const bad = normalizeEntry({ ...base, tmux: 'x\n:@0.%0', bridgeSessionId: '../evil' }, true, 2);
  assert.equal(bad.tmux, '');
  assert.equal(bad.bridgeSessionId, '');
});
