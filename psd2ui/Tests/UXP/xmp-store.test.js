'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const StorePath = path.resolve(__dirname, '../../Plus-ins/PSD2UI/src/xmpStore.js');
const StoreSource = fs.readFileSync(StorePath, 'utf8');

function createHarness(options) {
  const config = options || {};
  let rawXmp = config.initialRaw || '';
  let saveCount = 0;
  let setDescriptor = null;
  const files = {};
  const sidecarUrl = 'file:/F:/Art/Login.psd2ui.authoring.json';
  if (Object.prototype.hasOwnProperty.call(config, 'initialSidecar')) {
    files[sidecarUrl] = config.initialSidecar;
  }

  class FakeXMPMeta {
    constructor(raw) {
      this.value = typeof raw === 'string' && raw.startsWith('manifest:')
        ? raw.slice('manifest:'.length)
        : null;
    }

    static registerNamespace() {}

    setProperty(namespace, name, value) {
      this.value = value;
    }

    getProperty() {
      return this.value === null ? null : { value: this.value };
    }

    serialize() {
      return `manifest:${this.value}`;
    }
  }

  const document = {
    id: 42,
    path: 'F:\\Art\\Login.psd',
    async save() {
      saveCount += 1;
      if (saveCount <= Number(config.failSaveAttempts || 0)) {
        throw new Error('simulated document.save failure');
      }
    }
  };
  const photoshop = {
    app: { activeDocument: document },
    action: {
      async batchPlay(descriptors) {
        const descriptor = descriptors[0];
        if (descriptor._obj === 'get') {
          return [{ XMPMetadataAsUTF8: rawXmp }];
        }
        setDescriptor = descriptor;
        if (config.persistSet !== false) {
          rawXmp = descriptor.to.XMPMetadataAsUTF8;
        }
        return [{}];
      }
    },
    core: {
      async executeAsModal(callback) {
        if (config.switchBeforeModal) photoshop.app.activeDocument = { id: 99, path: 'F:/Art/Other.psd' };
        return callback();
      }
    }
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require(id) {
      if (id === 'photoshop') return photoshop;
      if (id === 'uxp') return { xmp: { XMPMeta: FakeXMPMeta } };
      if (id === 'fs') {
        return {
          async writeFile(url, value) {
            files[url] = value;
          },
          async readFile(url) {
            if (!Object.prototype.hasOwnProperty.call(files, url)) throw new Error('ENOENT');
            return files[url];
          },
          async unlink(url) {
            if (!Object.prototype.hasOwnProperty.call(files, url)) throw new Error('ENOENT');
            delete files[url];
          }
        };
      }
      throw new Error(`未注册测试模块：${id}`);
    }
  };
  vm.runInNewContext(StoreSource, sandbox, { filename: StorePath });
  return {
    store: sandbox.module.exports,
    getRawXmp: () => rawXmp,
    getSaveCount: () => saveCount,
    getSetDescriptor: () => setDescriptor,
    getFiles: () => files
  };
}

test('文档 XMP 使用可持久化的 Photoshop document setter 并立即读回', async () => {
  const harness = createHarness();
  const manifest = { schemaVersion: 1, document: { viewName: '技能三选一', module: 'skill_choice' } };

  const writeResult = await harness.store.writeManifest(manifest, true);

  const descriptor = harness.getSetDescriptor();
  assert.equal(descriptor._target[0]._ref, 'property');
  assert.equal(descriptor._target[0]._property, 'XMPMetadataAsUTF8');
  assert.equal(descriptor.to._obj, 'document');
  assert.equal(descriptor._options.dialogOptions, 'dontDisplay');
  assert.equal(harness.getSaveCount(), 1);
  assert.equal(JSON.stringify(await harness.store.readManifest()), JSON.stringify(manifest));
  assert.equal(writeResult.sidecarPath, 'F:\\Art\\Login.psd2ui.authoring.json');
  assert.equal(
    JSON.stringify(JSON.parse(harness.getFiles()['file:/F:/Art/Login.psd2ui.authoring.json'])),
    JSON.stringify(manifest));
  assert.equal(
    JSON.stringify((await harness.store.readSidecarManifest()).manifest),
    JSON.stringify(manifest));
});

test('XMP setter 未生效时阻止保存并给出明确错误', async () => {
  const harness = createHarness({ persistSet: false });

  await assert.rejects(
    harness.store.writeManifest({ schemaVersion: 1 }, true),
    /写入后读回不一致/
  );
  assert.equal(harness.getSaveCount(), 0);
  assert.equal(harness.getRawXmp(), '');
});

test('等待 Photoshop modal 时切换文档会在任何写入之前停止', async () => {
  const harness = createHarness({ switchBeforeModal: true });
  await assert.rejects(harness.store.writeManifest({ schemaVersion: 1 }, true), /切换了 PSD/);
  assert.equal(harness.getSaveCount(), 0);
  assert.equal(harness.getSetDescriptor(), null);
  assert.equal(Object.keys(harness.getFiles()).length, 0);
});

test('文档保存失败时恢复原始 XMP 与同目录配置镜像', async () => {
  const originalManifest = { schemaVersion: 1, document: { viewName: 'Original' } };
  const originalRaw = `manifest:${JSON.stringify(originalManifest)}`;
  const originalSidecar = JSON.stringify(originalManifest, null, 2);
  const harness = createHarness({
    initialRaw: originalRaw,
    initialSidecar: originalSidecar,
    failSaveAttempts: 1
  });

  await assert.rejects(
    harness.store.writeManifest({ schemaVersion: 2, document: { viewName: 'Changed' } }, true),
    /simulated document\.save failure/);

  assert.equal(harness.getSaveCount(), 2, '失败后应保存一次恢复状态');
  assert.equal(harness.getRawXmp(), originalRaw);
  assert.equal(harness.getFiles()['file:/F:/Art/Login.psd2ui.authoring.json'], originalSidecar);
});
