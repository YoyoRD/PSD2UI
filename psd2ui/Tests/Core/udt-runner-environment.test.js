'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  readCheckOnlyOption,
  connectPlugin,
  statusExpression,
  assertEnvironmentStatus,
  debugTargetUrl
} = require('../../scripts/uxp-devtools-runner');

function connectionFixture(t, cache = 'matching') {
  const temporaryRoot = path.resolve(os.tmpdir());
  const prefix = 'psd2ui-udt-check-test-';
  const directory = fs.mkdtempSync(path.join(temporaryRoot, prefix));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith(prefix));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  class PluginSession {
    constructor(sessions, pluginInfo) {
      this.sessions = sessions;
      this.pluginInfo = pluginInfo;
    }
  }

  const configuration = {
    manifest: path.join(directory, 'manifest.json'),
    cachePath: path.join(directory, 'session.json'),
    fingerprint: 'current-plugin',
    checkOnly: true,
    PluginSession
  };
  const cachedSession = new PluginSession([{ id: 'already-running' }], { id: 'psd2ui' });
  if (cache !== 'missing') {
    fs.writeFileSync(configuration.cachePath, cache === 'invalid' ? '{invalid json' : JSON.stringify({
      manifestPath: configuration.manifest,
      fingerprint: cache === 'mismatch' ? 'previous-plugin' : configuration.fingerprint,
      sessions: cachedSession.sessions,
      pluginInfo: cachedSession.pluginInfo
    }), 'utf8');
    // A rewrite is detectable even if its content happened to match.
    fs.utimesSync(configuration.cachePath, new Date(1000000), new Date(1000000));
  }
  const before = cache === 'missing' ? null : {
    content: fs.readFileSync(configuration.cachePath, 'utf8'),
    modified: fs.statSync(configuration.cachePath).mtimeMs
  };
  const calls = [];
  const debugTargets = [{ cdtDebugWsUrl: 'ws://127.0.0.1:9322/devtools/page/psd2ui' }];
  const manager = {
    async loadPlugin() {
      calls.push('load');
      return new PluginSession([{ id: 'newly-loaded' }], { id: 'psd2ui' });
    },
    async reloadPlugin() { calls.push('reload'); },
    async debugPlugin(session) {
      calls.push(`debug:${session.sessions[0].id}`);
      return debugTargets;
    }
  };
  const assertCacheUnchanged = () => {
    if (!before) {
      assert.equal(fs.existsSync(configuration.cachePath), false);
      return;
    }
    assert.equal(fs.readFileSync(configuration.cachePath, 'utf8'), before.content);
    assert.equal(fs.statSync(configuration.cachePath).mtimeMs, before.modified);
  };
  return { configuration, manager, calls, debugTargets, assertCacheUnchanged };
}

function evaluateStatus(automation, activeDocument = null) {
  return vm.runInNewContext(statusExpression(), {
    require(name) {
      assert.equal(name, 'photoshop');
      return { app: { activeDocument } };
    },
    __PSD2UI_DEV__: automation
  });
}

test('check-only is opt-in and rejects mutation operations or ambiguous values', () => {
  assert.equal(readCheckOnlyOption({}, 'status'), false);
  assert.equal(readCheckOnlyOption({ 'check-only': 'false' }, 'invoke'), false);
  assert.equal(readCheckOnlyOption({ 'check-only': 'true' }, 'status'), true);
  for (const operation of ['invoke', 'reload']) {
    assert.throws(() => readCheckOnlyOption({ 'check-only': 'true' }, operation), /只允许 operation=status/);
  }
  assert.throws(() => readCheckOnlyOption({ 'check-only': 'yes' }, 'status'), /只接受 true 或 false/);
});

test('check-only reuses a running matching session without loading, reloading or rewriting its cache', async (t) => {
  const fixture = connectionFixture(t);
  const result = await connectPlugin(fixture.manager, fixture.configuration);
  assert.equal(result.reusedSession, true);
  assert.deepEqual(result.debugTargets, fixture.debugTargets);
  assert.deepEqual(fixture.calls, ['debug:already-running']);
  fixture.assertCacheUnchanged();
});

for (const cache of ['missing', 'invalid', 'mismatch']) {
  test(`check-only stops for ${cache} session cache without repairing it`, async (t) => {
    const fixture = connectionFixture(t, cache);
    await assert.rejects(connectPlugin(fixture.manager, fixture.configuration),
      cache === 'mismatch' ? /指纹不一致/ : /没有可复用/);
    assert.deepEqual(fixture.calls, []);
    fixture.assertCacheUnchanged();
  });
}

test('check-only stops when the cached session is stale without default fallback or cache deletion', async (t) => {
  const fixture = connectionFixture(t);
  fixture.manager.debugPlugin = async () => {
    fixture.calls.push('debug');
    throw new Error('Session disconnected');
  };
  await assert.rejects(connectPlugin(fixture.manager, fixture.configuration), /Session disconnected.*不会重新加载插件或改写缓存/);
  assert.deepEqual(fixture.calls, ['debug']);
  fixture.assertCacheUnchanged();
});

test('check-only rejects an explicit reload before touching the session', async (t) => {
  const fixture = connectionFixture(t);
  fixture.configuration.forceReload = true;
  await assert.rejects(connectPlugin(fixture.manager, fixture.configuration), /不允许重新加载/);
  assert.deepEqual(fixture.calls, []);
  fixture.assertCacheUnchanged();
});

test('normal mode still loads a plugin and writes a fresh cache when no session exists', async (t) => {
  const fixture = connectionFixture(t, 'missing');
  fixture.configuration.checkOnly = false;
  const result = await connectPlugin(fixture.manager, fixture.configuration);
  assert.equal(result.reusedSession, false);
  assert.deepEqual(fixture.calls, ['load', 'debug:newly-loaded']);
  const cache = JSON.parse(fs.readFileSync(fixture.configuration.cachePath, 'utf8'));
  assert.equal(cache.sessions[0].id, 'newly-loaded');
});

test('normal mode still reloads a changed plugin and updates its fingerprint', async (t) => {
  const fixture = connectionFixture(t, 'mismatch');
  fixture.configuration.checkOnly = false;
  const result = await connectPlugin(fixture.manager, fixture.configuration);
  assert.equal(result.reusedSession, true);
  assert.deepEqual(fixture.calls, ['reload', 'debug:already-running']);
  const cache = JSON.parse(fs.readFileSync(fixture.configuration.cachePath, 'utf8'));
  assert.equal(cache.fingerprint, fixture.configuration.fingerprint);
});

test('normal mode still falls back to loading after a stale cached session fails', async (t) => {
  const fixture = connectionFixture(t);
  fixture.configuration.checkOnly = false;
  fixture.manager.debugPlugin = async (session) => {
    fixture.calls.push(`debug:${session.sessions[0].id}`);
    if (session.sessions[0].id === 'already-running') throw new Error('Session disconnected');
    return fixture.debugTargets;
  };
  const result = await connectPlugin(fixture.manager, fixture.configuration);
  assert.equal(result.reusedSession, false);
  assert.deepEqual(fixture.calls, ['debug:already-running', 'load', 'debug:newly-loaded']);
  const cache = JSON.parse(fs.readFileSync(fixture.configuration.cachePath, 'utf8'));
  assert.equal(cache.sessions[0].id, 'newly-loaded');
});

test('environment status accepts no open PSD and still reports callable automation methods', () => {
  const value = evaluateStatus({ openDocument() {}, inspect() {}, snapshot() {}, version: '1' });
  assert.equal(value.document, null);
  assert.equal(value.automationAvailable, true);
  assert.deepEqual(Array.from(value.automationMethods), ['inspect', 'openDocument', 'snapshot']);
  assert.doesNotThrow(() => assertEnvironmentStatus(value));
});

test('environment status rejects absent or incomplete APIs including non-function method names', () => {
  assert.throws(() => assertEnvironmentStatus(evaluateStatus(undefined)), /自动化入口尚未注册/);
  assert.throws(() => assertEnvironmentStatus(evaluateStatus({ openDocument() {}, inspect() {} })), /缺少方法：snapshot/);
  assert.throws(() => assertEnvironmentStatus(evaluateStatus({ openDocument: true, inspect() {}, snapshot() {} })), /缺少方法：openDocument/);
});

test('status still reads document details when a PSD is open', () => {
  const value = evaluateStatus({ openDocument() {}, inspect() {}, snapshot() {} }, {
    id: 42, title: 'UI.psd', path: 'F:/art/UI.psd', width: 100, height: 200,
    activeLayers: [], layers: [{ id: 9, name: 'Root', kind: 'group', layers: [] }]
  });
  assert.doesNotThrow(() => assertEnvironmentStatus(value));
  assert.equal(value.document.id, '42');
  assert.equal(value.document.path, 'F:/art/UI.psd');
  assert.equal(value.document.topLevelLayers[0].name, 'Root');
});

test('strict environment checks require exactly one usable debug target', () => {
  assert.equal(debugTargetUrl([{ cdtDebugWsUrl: 'ws=127.0.0.1:9222/plugin' }], true), 'ws://127.0.0.1:9222/plugin');
  for (const targets of [undefined, [], [null], [{}, {}]]) {
    assert.throws(() => debugTargetUrl(targets, true), /期望 1 个 Photoshop 调试目标/);
  }
  assert.throws(() => debugTargetUrl([{}], true), /没有返回插件调试地址/);
  assert.throws(() => debugTargetUrl([{ cdtDebugWsUrl: 'ws://bad address' }], true), /调试地址无效/);
  assert.throws(() => debugTargetUrl([{ cdtDebugWsUrl: 'http://127.0.0.1:9222/plugin' }], true), /调试地址无效/);
});
