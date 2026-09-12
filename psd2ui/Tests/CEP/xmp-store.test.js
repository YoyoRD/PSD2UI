'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const storePath = path.resolve(__dirname, '../../Plus-ins/PSD2UI-CEP/src/xmpStore.js');
const source = fs.readFileSync(storePath, 'utf8');

function harness(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psd2ui-cep-xmp-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^psd2ui-cep-xmp-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const document = { id: 42, path: path.join(root, '界面.psd'), async save() {
    saveCount += 1;
    if (saveCount <= (options.failSaveAttempts || 0)) throw new Error('simulated save failure');
  } };
  const sidecar = path.join(root, '界面.psd2ui.authoring.json');
  if (Object.hasOwn(options, 'sidecar')) fs.writeFileSync(sidecar, options.sidecar);
  if (options.sidecarDirectory) fs.mkdirSync(sidecar);
  let raw = options.raw || '';
  let saveCount = 0;
  const calls = [];
  const photoshop = { app: { activeDocument: document }, core: { async executeAsModal(callback) {
    if (options.switchBeforeModal) photoshop.app.activeDocument = { id: 99, path: 'other.psd' };
    return callback();
  } }, async invoke(method, params) {
    calls.push({ method, params });
    assert.equal(params.documentID, 42, 'all reads and rollback writes must pin original document');
    if (method === 'getXmp') return raw;
    if (method === 'setXmp') { raw = params.rawXmp; return true; }
    if (method === 'readManifest') {
      assert.equal(params.serialized, true, 'parse large manifests in CEP, not ExtendScript');
      const manifest = raw ? JSON.parse(raw).manifest || null : null;
      return manifest ? JSON.stringify(manifest) : null;
    }
    if (method === 'writeManifest') {
      assert.equal(params.namespaceUri, 'https://yoyoengine.dev/psd2ui/1.0/');
      assert.equal(params.namespacePrefix, 'yoyoPsd2ui');
      assert.equal(params.propertyName, 'Manifest');
      if (options.persistWrite !== false) raw = JSON.stringify({ ...raw && JSON.parse(raw), manifest: JSON.parse(params.serializedManifest) });
      if (options.switchAfterWrite) photoshop.app.activeDocument = { id: 99, path: 'other.psd' };
      return true;
    }
    throw new Error('unknown RPC ' + method);
  } };
  const sandbox = { module: { exports: {} }, require(id) {
    if (id === './photoshop') return photoshop;
    if (id === './native') return { requireNative: require };
    throw new Error('unknown module ' + id);
  } };
  vm.runInNewContext(source, sandbox, { filename: storePath });
  return { api: sandbox.module.exports, document, sidecar, calls,
    raw: () => raw, saveCount: () => saveCount };
}

test('CEP stores the manifest in XMP and verifies a Unicode UTF-8 mirror without using it as fallback', async t => {
  const h = harness(t, { raw: '{"creator":"美术","unrelated":123}', sidecar: '{"stale":true}' });
  assert.equal(await h.api.readManifest(), null, 'mirror must never override missing authoritative XMP');
  const manifest = { schemaVersion: 1, document: { name: '堡垒报名' }, nodes: { '12': { semantic: 'image' } } };
  const result = await h.api.writeManifest(manifest, true);
  assert.equal(result.sidecarPath, h.sidecar);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.sidecar, 'utf8')), manifest);
  assert.deepEqual(JSON.parse(JSON.stringify(await h.api.readManifest())), manifest);
  assert.equal(JSON.parse(h.raw()).creator, '美术');
  assert.equal(JSON.parse(h.raw()).unrelated, 123);
  assert.equal(h.saveCount(), 1);
});

test('failed PSD save restores exact original XMP and mirror bytes and saves the restored state', async t => {
  const raw = '{ "creator": "keep", "manifest": { "old": true } }';
  const sidecar = '{\n  "old": true\n}\n';
  const h = harness(t, { raw, sidecar, failSaveAttempts: 1 });
  await assert.rejects(h.api.writeManifest({ next: true }, true), /simulated save failure/);
  assert.equal(h.raw(), raw);
  assert.equal(fs.readFileSync(h.sidecar, 'utf8'), sidecar);
  assert.equal(h.saveCount(), 2);
});

test('rollback removes a newly created mirror and does not swallow an unreadable original mirror', async t => {
  const h = harness(t, { failSaveAttempts: 1 });
  await assert.rejects(h.api.writeManifest({ next: true }), /simulated save failure/);
  assert.equal(fs.existsSync(h.sidecar), false);
  assert.equal(h.raw(), '');
  const unreadable = harness(t, { sidecarDirectory: true });
  await assert.rejects(unreadable.api.writeManifest({ next: true }), /EISDIR|illegal operation/);
  assert.equal(unreadable.calls.filter(call => call.method === 'writeManifest').length, 0);
  assert.equal(fs.statSync(unreadable.sidecar).isDirectory(), true);
});

test('ignored XMP writes block saving and restore the original snapshot', async t => {
  const h = harness(t, { persistWrite: false });
  await assert.rejects(h.api.writeManifest({ next: true }), /写入后读回不一致/);
  assert.equal(h.saveCount(), 0);
  assert.equal(h.raw(), '');
  assert.equal(fs.existsSync(h.sidecar), false);
});

test('document switching blocks new writes and rollback always addresses the original document', async t => {
  const before = harness(t, { switchBeforeModal: true });
  await assert.rejects(before.api.writeManifest({ next: true }), /切换了 PSD/);
  assert.equal(before.calls.filter(call => call.method === 'writeManifest').length, 0);
  const raw = '{"manifest":{"original":true}}';
  const during = harness(t, { raw, switchAfterWrite: true });
  await assert.rejects(during.api.writeManifest({ next: true }), /切换了 PSD/);
  assert.equal(during.raw(), raw);
  assert.equal(during.saveCount(), 0);
  assert.equal(fs.existsSync(during.sidecar), false);
});

test('writeManifestInCurrentModal honors saveDocument false for surrounding authoring transactions', async t => {
  const h = harness(t);
  await h.api.writeManifestInCurrentModal({ next: true }, false);
  assert.equal(h.saveCount(), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.sidecar, 'utf8')), { next: true });
});
