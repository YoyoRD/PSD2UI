'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../Plus-ins/PSD2UI/src/exporter.js'), 'utf8');

function harness(pixelValues = [[1, 2, 3, 255], [1, 2, 3, 255]]) {
  const state = { outputWrites: 0, copies: [], failCopy: null, beforeCopy: null, exportedLayers: [], pixelReads: 0 };
  function folder(name, parent) {
    const entry = { name, isFolder: true, isFile: false, entries: new Map(),
      nativePath: parent ? `${parent.nativePath}/${name}` : `F:/${name}`,
      async getEntries() { return Array.from(this.entries.values()); },
      async createFolder(childName) {
        if (this.entries.has(childName)) throw new Error('folder exists');
        const child = folder(childName, this); this.entries.set(childName, child); return child;
      },
      async createFile(fileName, options) {
        if (this.entries.has(fileName) && !options.overwrite) throw new Error('file exists');
        const file = { name: fileName, isFile: true, nativePath: `${this.nativePath}/${fileName}`, data: '',
          async read(options) { if (state.beforeRead) await state.beforeRead(this, options); return this.data; },
          async write(data) { this.data = data; },
          async copyTo(target, copyOptions) {
            if (target.nativePath.startsWith(output.nativePath) && state.beforeCopy) state.beforeCopy(this, target);
            const copy = await target.createFile(this.name, { overwrite: copyOptions.overwrite });
            copy.data = this.data;
            state.copies.push([this.nativePath, target.nativePath]);
            if (target.nativePath.startsWith(output.nativePath)) {
              state.outputWrites += 1;
              if (state.failCopy) state.failCopy(this, target);
            }
            return copy;
          },
          async delete() { entry.entries.delete(fileName); }
        };
        this.entries.set(fileName, file); return file;
      },
      async delete() { if (parent) parent.entries.delete(name); this.entries.clear(); }
    };
    return entry;
  }
  const output = folder('任意 美术交付目录');
  const temp = folder('Temp');
  let sequence = 100;
  const app = { documents: [] };
  const document = { id: 1, path: 'F:/Art/Source.psd', width: 1, height: 1, name: '源', layers: [] };
  pixelValues.forEach((pixels, index) => {
    document.layers.push({ id: index + 2, name: 'comm_bt_0032@ignored', visible: index === 0,
      bounds: { left: 0, top: 0, right: 1, bottom: 1 },
      async duplicate(target) {
        state.exportedLayers.push(String(index + 2));
        target.pixels = new Uint8Array(pixels);
        target.renderLayer = { visible: this.visible, opacity: this.opacity == null ? 100 : this.opacity, async translate() {} };
        return target.renderLayer;
      }
    });
  });
  app.documents.push(document); app.activeDocument = document;
  app.documents.add = async (options) => {
    const added = { id: sequence++, name: options.name, width: options.width || 1, height: options.height || 1, layers: [{ id: 99 }],
      path: '', async trim() {},
      saveAs: { png: async (file) => {
        const pixels = Array.from(added.pixels);
        if (added.renderLayer) {
          for (let index = 3; index < pixels.length; index += 4) {
            pixels[index] = Math.round(pixels[index] * added.renderLayer.opacity / 100);
          }
        }
        await file.write(pixels.join(','));
      } },
      async closeWithoutSaving() { app.documents.splice(app.documents.indexOf(added), 1); app.activeDocument = document; }
    };
    app.documents.push(added); app.activeDocument = added; return added;
  };
  app.open = async (file) => {
    const added = await app.documents.add({ name: file.name });
    const [data, dimensions] = String(file.data).split('|');
    added.pixels = new Uint8Array(data.split(',').map(Number));
    if (dimensions && dimensions.startsWith('size=')) [added.width, added.height] = dimensions.slice(5).split('x').map(Number);
    added.components = added.pixels.length / (added.width * added.height);
    return added;
  };
  const photoshop = { app, core: { executeAsModal: async (fn) => fn() },
    constants: { TrimType: { TRANSPARENT: 1 } },
    imaging: {
      createImageDataFromBuffer: async (pixels, options) => ({ pixels, ...options, dispose() {} }),
      putPixels: async ({ documentID, imageData }) => { app.documents.find(entry => entry.id === documentID).pixels = imageData.pixels; },
      getPixels: async ({ documentID }) => {
      state.pixelReads += 1;
      const current = app.documents.find((entry) => entry.id === documentID);
      return { imageData: { width: current.width, height: current.height, components: current.components || 4, colorSpace: 'RGB', colorProfile: 'sRGB',
        async getData() { return current.pixels; }, dispose() {} } };
    } }
  };
  const storage = { formats: { utf8: 'utf8' }, localFileSystem: { getTemporaryFolder: async () => temp } };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Uint8Array,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    require(id) {
      if (id === 'photoshop') return photoshop;
      if (id === 'uxp') return { storage };
      if (id === './photoshopDocument') return {
        findLayerById: (layers, id) => layers.find((layer) => String(layer.id) === String(id)),
        asNumber: Number, openLocalDocument: async () => { app.activeDocument = document; return document; }
      };
      if (id === './uiResPath') return require('../../Plus-ins/PSD2UI/src/uiResPath');
      if (id === '../generated/core/naming') return require('../../Core/naming');
      if (id === '../generated/core/nineSlice') return require('../../Core/nineSlice');
      throw new Error(id);
    }
  }, { filename: 'exporter.js' });
  const ids = document.layers.map((layer) => String(layer.id));
  const bundle = { schemaVersion: '1.5.0', document: { id: 'doc-1', name: '中文 界面', module: 'document' },
    resources: [{ id: 'res-1', fileName: 'comm_bt_0032.png', module: 'comm', scope: 'module', kind: 'sprite',
      sourceLayerId: ids[0], sourceLayerIds: ids }],
    root: { children: ids.map((id) => ({ sourceLayerId: id, image: { resourceId: 'res-1' }, children: [] })) }
  };
  const get = relative => relative.split('/').reduce((entry, name) => entry && entry.entries.get(name), output);
  const put = async (relative, data) => {
    const segments = relative.split('/'), name = segments.pop();
    let parent = output;
    for (const segment of segments) parent = parent.entries.get(segment) || await parent.createFolder(segment);
    const file = await parent.createFile(name, { overwrite: true }); await file.write(data); return file;
  };
  function findTemporaryFile(nativePath, current = temp) {
    for (const entry of current.entries.values()) {
      if (entry.nativePath === nativePath) return entry;
      if (entry.isFolder) { const found = findTemporaryFile(nativePath, entry); if (found) return found; }
    }
    return null;
  }
  return { api: module.exports, output, temp, state, bundle, document, folder, get, put, photoshop, findTemporaryFile };
}

test('任意合法目录同名图片只导出代表层，隐藏引用保留在节点中', async () => {
  const h = harness();
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.resourceCount, 1);
  assert.deepEqual([...h.output.entries.keys()].sort(), ['json', 'sprite', 'texture']);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.match(result.json, /\/json\/中文 界面.psd2ui.json$/);
  assert.equal(h.temp.entries.size, 0);
  assert.deepEqual(h.state.exportedLayers, ['2']);
});

test('同一 PSD 重复导出不覆盖未变化的图片和 JSON', async () => {
  const h = harness();
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  const writes = h.state.outputWrites;
  const image = h.get('sprite/comm/comm_bt_0032.png');
  const json = h.get('json/中文 界面.psd2ui.json');
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.state.outputWrites, writes);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), image);
  assert.equal(h.get('json/中文 界面.psd2ui.json'), json);
  assert.equal(result.reusedResourceCount, 1);
});

test('再次导出只发布实际变化的图片或 JSON', async () => {
  const h = harness();
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  const image = h.get('sprite/comm/comm_bt_0032.png');
  const json = h.get('json/中文 界面.psd2ui.json');
  h.document.layers[0].duplicate = async target => {
    target.pixels = new Uint8Array([4, 5, 6, 255]);
    target.renderLayer = { visible: true, opacity: 100, async translate() {} };
    return target.renderLayer;
  };
  const writes = h.state.outputWrites;
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.state.outputWrites - writes, 1);
  assert.notEqual(h.get('sprite/comm/comm_bt_0032.png'), image);
  assert.equal(h.get('json/中文 界面.psd2ui.json'), json);
  h.bundle.root.children[0].opacity = 0.5;
  const secondWrites = h.state.outputWrites;
  const updatedImage = h.get('sprite/comm/comm_bt_0032.png');
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.state.outputWrites - secondWrites, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), updatedImage);
  assert.notEqual(h.get('json/中文 界面.psd2ui.json'), json);
});

test('CEP 图片编码字节变化但像素相同时沿用已有文件', async () => {
  const h = harness();
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  const image = h.get('sprite/comm/comm_bt_0032.png');
  const writes = h.state.outputWrites;
  h.photoshop.core.exportLayerPng = async params => {
    await h.findTemporaryFile(params.path).write('same pixels, different PNG encoding');
  };
  h.photoshop.core.samePngContent = async () => true;
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.state.outputWrites, writes);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), image);
});

test('Sprite和Texture均使用资源自身module建目录，不使用文档module', async () => {
  const h = harness();
  h.bundle.resources[0].sourceLayerIds = ['2'];
  h.document.layers[1].name = 'baoleizhengduo_bg_0001';
  h.bundle.resources.push({ id: 'res-2', fileName: 'baoleizhengduo_bg_0001.png',
    module: 'baoleizhengduo', scope: 'module', kind: 'texture', sourceLayerId: '3', sourceLayerIds: ['3'] });
  const node = h.bundle.root.children[1];
  delete node.image; node.rawImage = { resourceId: 'res-2' };
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.equal(h.get('texture/baoleizhengduo/baoleizhengduo_bg_0001.png').data, '1,2,3,255');
  assert.equal(h.get('sprite/document'), undefined);
  assert.equal(h.get('sprite/comm_bt_0032.png'), undefined);
  assert.equal(h.get('texture/baoleizhengduo_bg_0001.png'), undefined);
  const saved = JSON.parse(h.get('json/中文 界面.psd2ui.json').data);
  assert.deepEqual(saved, h.bundle, 'fileName and module remain unchanged in JSON');
});

test('旧类型目录共享图迁入模块目录时保留已有 PNG 和其他 JSON', async () => {
  for (const kind of ['sprite', 'texture']) {
    const h = harness();
    h.bundle.resources[0].kind = kind;
    if (kind === 'texture') h.bundle.root.children.forEach(n => { n.rawImage = n.image; delete n.image; });
    const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧类型目录' };
    await h.put('json/旧类型目录.psd2ui.json', JSON.stringify(other));
    const original = await h.put(`${kind}/comm_bt_0032.png`, '1,2,3,255|old split encoding');
    assert.equal((await h.api.verifyBundle(h.bundle, { uiResFolder: h.output })).reusedResourceCount, 1);
    assert.equal(h.get(`${kind}/comm`), undefined, 'preflight creates no module directories');
    assert.equal((await h.api.writeBundle(h.bundle, { uiResFolder: h.output })).reusedResourceCount, 1);
    assert.equal(h.get(`${kind}/comm/comm_bt_0032.png`).data, original.data);
    assert.equal(h.get(`${kind}/comm_bt_0032.png`), original);
    assert.ok(h.get('json/旧类型目录.psd2ui.json'));
  }
  const h = harness();
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧类型目录' };
  await h.put('json/旧类型目录.psd2ui.json', JSON.stringify(other));
  await h.put('sprite/comm_bt_0032.png', '9,8,7,255,9,8,7,255|size=2x1');
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.reusedResourceCount, 1);
  assert.ok(result.warnings.some(warning => warning.code === 'PSD2UI_RESOURCE_SIZE_REUSED'));
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '9,8,7,255,9,8,7,255|size=2x1');
  assert.equal(h.get('sprite/comm_bt_0032.png').data, '9,8,7,255,9,8,7,255|size=2x1');
});

test('自己的旧类型目录交付迁移失败会恢复JSON并删除新增模块目录', async () => {
  const h = harness();
  const previous = JSON.stringify(h.bundle);
  await h.put('json/中文 界面.psd2ui.json', previous);
  const original = await h.put('sprite/comm_bt_0032.png', 'old pixels');
  let failed = false;
  h.state.failCopy = file => {
    if (!failed && file.name.endsWith('.json')) { failed = true; throw new Error('publish fails'); }
  };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /publish fails/);
  assert.equal(h.get('json/中文 界面.psd2ui.json').data, previous);
  assert.equal(h.get('sprite/comm_bt_0032.png'), original);
  assert.equal(h.get('sprite/comm'), undefined);
  assert.equal(h.get('texture'), undefined);
  assert.equal(h.temp.entries.size, 0);
});

test('模块目录无效或被同名文件占用时，在输出写入前阻断', async () => {
  for (const module of ['../escape', 'comm/child', 'comm\\child', 'con', '']) {
    const h = harness(); h.bundle.resources[0].module = module;
    await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_OUTPUT_NAME_INVALID|PSD2UI_RESOURCE_MODULE_INVALID/);
    assert.equal(h.state.outputWrites, 0);
    assert.equal(h.output.entries.size, 0);
  }
  const h = harness();
  const blockingFile = await h.put('sprite/comm', 'keep me');
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_OUTPUT_PATH_CONFLICT/);
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.get('sprite/comm'), blockingFile);
});

test('同名同尺寸异像素使用稳定主来源，输出报告列出全部复用层且节点不变', async () => {
  const h = harness([[1, 2, 3, 255], [7, 8, 9, 255]]);
  h.bundle.resources[0].sourceLayerIds.reverse();
  h.bundle.root.children[0].rect = { x: 1, y: 2, width: 1, height: 1 };
  h.bundle.root.children[1].rect = { x: 99, y: 50, width: 1, height: 1 };
  h.bundle.root.children[0].visible = 'enabled';
  h.bundle.root.children[1].visible = 'disabled';
  h.bundle.root.children[1].opacity = 0.25;
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.deepEqual(h.state.exportedLayers, ['2'], 'the declared source wins even when sourceLayerIds is reordered');
  assert.equal(h.state.pixelReads, 0, 'same-name reuse does not perform pixel readbacks');
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.deepEqual(JSON.parse(JSON.stringify(result.sourceReuse)), [{ resourceId: 'res-1', fileName: 'comm_bt_0032.png', sourceLayerId: '2', reusedLayerIds: ['3'] }]);
  assert.deepEqual(JSON.parse(h.get('json/中文 界面.psd2ui.json').data).root, h.bundle.root);
  assert.equal(h.temp.entries.size, 0);
});

test('同一 PSD 的同名图片布局尺寸不同仍导出，并保留两个节点尺寸', async () => {
  const h = harness();
  h.bundle.root.children[0].rect = { width: 1, height: 1 };
  h.bundle.root.children[1].rect = { width: 2, height: 1 };
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.deepEqual(h.state.exportedLayers, ['2']);
  assert.ok(result.warnings.some(warning => warning.code === 'PSD2UI_RESOURCE_SIZE_REUSED'
    && /图层 2.*图层 3/.test(warning.message)));
  assert.deepEqual(JSON.parse(h.get('json/中文 界面.psd2ui.json').data).root.children.map(node => node.rect.width), [1, 2]);
});

test('提交JSON时失败可恢复被覆盖PNG与旧JSON，删除本次新增输出', async () => {
  for (const split of [false, true]) {
  const h = harness();
  const previous = JSON.stringify(h.bundle);
  const png = `${split ? 'sprite/comm/' : ''}comm_bt_0032.png`;
  const json = `${split ? 'json/' : ''}中文 界面.psd2ui.json`;
  await h.put(png, 'old-pixels');
  await h.put(json, previous);
  let failed = false;
  h.state.failCopy = (file) => {
    if (!failed && file.name.endsWith('.json')) { failed = true; throw new Error('simulated JSON copy failure'); }
  };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /simulated JSON copy failure/);
  assert.equal(h.get(png).data, 'old-pixels');
  assert.equal(h.get(json).data, previous);
  if (!split) assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined);
  assert.equal(h.temp.entries.size, 0);
  }
});

test('分类目录内同名同尺寸PNG原样复用，像素或alpha不同也不覆盖', async () => {
  const h = harness();
  const existing = await h.put('sprite/comm/comm_bt_0032.png', '0,0,0,30');
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.reusedResourceCount, 1);
  assert.equal(result.sourceReuse[0].existingFile, existing.nativePath);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), existing);
  assert.equal(existing.data, '0,0,0,30');
  assert.equal(h.state.outputWrites, 1, 'only the new JSON is written');
  assert.equal(h.state.pixelReads, 0, 'existing PNG reuse only reads dimensions');
});

test('省略同名候选来源或源图层改名时，导出预检阻断所有写入', async () => {
  const h = harness();
  h.bundle.resources[0].sourceLayerIds = ['2'];
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_RESOURCE_SOURCES_INVALID/);
  h.bundle.resources[0].sourceLayerIds = ['2', '3'];
  h.document.layers[1].name = 'i_diamond_small';
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_SOURCE_NAME_CHANGED/);
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.temp.entries.size, 0);
});

test('无旧文件的提交失败删除已创建输出，恢复失败则保留备份路径', async () => {
  const h = harness();
  const stage = await h.temp.createFolder('staged');
  const backups = await h.temp.createFolder('backup');
  const png = await stage.createFile('comm_sp_0017.png', { overwrite: false });
  const json = await stage.createFile('View.psd2ui.json', { overwrite: false });
  h.state.failCopy = (file) => { if (file.name === json.name) throw new Error('json fails'); };
  await assert.rejects(h.api.commitStagedFiles(h.output, [png, json], backups), /json fails/);
  assert.equal(h.output.entries.size, 0);
  const prior = await h.output.createFile(png.name, { overwrite: false }); await prior.write('prior');
  h.state.failCopy = () => { throw new Error('disk failed'); };
  await assert.rejects(h.api.commitStagedFiles(h.output, [png], backups),
    (error) => error.preserveExportBackup === true && /PSD2UI_EXPORT_RECOVERY_FAILED/.test(error.message));
  assert.equal(backups.entries.get(png.name).data, 'prior');
});

test('覆盖图片期间JSON离线；图片恢复失败时不发布旧JSON与新图片的混合交付', async () => {
  const h = harness();
  const previous = JSON.stringify(h.bundle);
  await h.put('sprite/comm/comm_bt_0032.png', 'old-pixels');
  await h.put('json/中文 界面.psd2ui.json', previous);
  h.state.beforeCopy = (file) => {
    if (file.name.endsWith('.png')) assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined);
    if (file.nativePath.includes('/backup/') && file.name.endsWith('.png')) throw new Error('backup PNG restore failed');
  };
  h.state.failCopy = (file) => {
    if (file.nativePath.includes('/staged/') && file.name.endsWith('.json')) throw new Error('publish JSON failed');
  };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }),
    (error) => error.preserveExportBackup && /PSD2UI_EXPORT_RECOVERY_FAILED/.test(error.message));
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined);
  const transaction = Array.from(h.temp.entries.values())[0];
  assert.equal(transaction.entries.get('backup').entries.get('sprite').entries.get('comm').entries.get('comm_bt_0032.png').data, 'old-pixels');
  assert.equal(transaction.entries.get('backup').entries.get('json').entries.get('中文 界面.psd2ui.json').data, previous);
});

test('同一插件不允许两次异步导出交错提交', async () => {
  const h = harness();
  const first = h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_EXPORT_BUSY/);
  await first;
  assert.equal(h.output.entries.size, 3);
});

test('不同PSD同名公共图像素相同自动复用，即使PNG编码元数据不同', async () => {
  const h = harness();
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '另一个界面' };
  await h.put('json/另一个界面.psd2ui.json', JSON.stringify(other));
  await h.put('sprite/comm/comm_bt_0032.png', '1,2,3,255|different PNG metadata');
  const before = h.get('sprite/comm/comm_bt_0032.png');
  const preflight = await h.api.verifyBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(preflight.reusedResourceCount, 1);
  assert.equal(h.state.outputWrites, 0, 'preflight does not publish or migrate files');
  assert.equal(h.temp.entries.size, 0);
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.reusedResourceCount, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), before, 'shared PNG is not rewritten');
  assert.equal(h.state.outputWrites, 1, 'only current JSON is written');
  assert.ok(h.get('json/另一个界面.psd2ui.json'));
  assert.ok(h.get('json/中文 界面.psd2ui.json'));
});

test('不同 PSD 的同名共享图片尺寸不同仍复用已有 PNG', async () => {
  const h = harness();
  await h.put('json/中文 界面.psd2ui.json', JSON.stringify(h.bundle));
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧界面' };
  await h.put('json/旧界面.psd2ui.json', JSON.stringify(other));
  await h.put('sprite/comm/comm_bt_0032.png', '7,8,9,255,7,8,9,255|size=2x1');
  const before = h.get('sprite/comm/comm_bt_0032.png');
  const checked = await h.api.verifyBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(checked.reusedResourceCount, 1);
  assert.ok(checked.warnings.some(warning => warning.code === 'PSD2UI_RESOURCE_SIZE_REUSED'));
  assert.equal(h.state.outputWrites, 0);
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.reusedResourceCount, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), before);
  assert.equal(h.state.outputWrites, 1, 'only current JSON is published');
});

test('后续 PSD 的九宫四边全零继承既有 PNG 与边距，源图层无需容纳边距', async () => {
  const h = harness();
  const border = { left: 2, top: 1, right: 2, bottom: 1 };
  const zeros = { left: 0, top: 0, right: 0, bottom: 0 };
  const other = structuredClone(h.bundle);
  other.document = { id: 'other', name: '旧界面' };
  other.resources[0].sliceBorder = border;
  other.root.children.forEach(node => { node.image.imageType = 'sliced'; node.image.sliceBorder = border; });
  h.bundle.resources[0].sliceBorder = zeros;
  h.bundle.root.children.forEach(node => { node.image.imageType = 'sliced'; node.image.sliceBorder = zeros; });
  await h.put('json/旧界面.psd2ui.json', JSON.stringify(other));
  const png = await h.put('sprite/comm/comm_bt_0032.png', `${Array(60).fill(7).join(',')}|size=5x3`);
  const checked = await h.api.verifyBundle(h.bundle, { uiResFolder: h.output });
  assert.ok(checked.warnings.some(warning => warning.code === 'PSD2UI_SHARED_SLICE_INHERITED'));
  assert.deepEqual(h.bundle.resources[0].sliceBorder, zeros, '预检不改美术保存的占位参数');
  assert.equal(h.state.exportedLayers.length, 0, '不从较小的第二份 PSD 图层重新生成九宫 PNG');
  assert.equal(h.state.outputWrites, 0);
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  const published = JSON.parse(h.get('json/中文 界面.psd2ui.json').data);
  assert.equal(result.reusedResourceCount, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), png);
  assert.deepEqual(published.resources[0].sliceBorder, border);
  published.root.children.forEach(node => assert.deepEqual(node.image.sliceBorder, border));
  assert.equal(h.state.exportedLayers.length, 0);
  assert.equal(h.state.outputWrites, 1, '仅写入继承实际边距的新 JSON');
});

test('首次交付九宫四边全零时提示填写，不能从孤立 PNG 猜边距', async () => {
  const h = harness();
  h.bundle.resources[0].sliceBorder = { left: 0, top: 0, right: 0, bottom: 0 };
  await h.put('sprite/comm/comm_bt_0032.png', '1,2,3,255');
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }),
    /PSD2UI_SHARED_SLICE_INHERIT_UNAVAILABLE/);
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined);
});

test('同一 PSD 再次导出时仍能沿用自己的历史九宫记录而不重写 PNG', async () => {
  const h = harness();
  const previous = structuredClone(h.bundle);
  const border = { left: 1, top: 0, right: 0, bottom: 0 };
  previous.resources[0].sliceBorder = border;
  h.bundle.resources[0].sliceBorder = { left: 0, top: 0, right: 0, bottom: 0 };
  await h.put('json/中文 界面.psd2ui.json', JSON.stringify(previous));
  const png = await h.put('sprite/comm/comm_bt_0032.png', '1,2,3,255,1,2,3,255|size=2x1');
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), png);
  assert.equal(result.reusedResourceCount, 1);
  assert.deepEqual(JSON.parse(h.get('json/中文 界面.psd2ui.json').data).resources[0].sliceBorder, border);
  assert.equal(h.state.outputWrites, 1, '只更新 JSON');
});

test('已有多份九宫记录边距不同不能静默继承', async () => {
  const h = harness();
  h.bundle.resources[0].sliceBorder = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const [index, left] of [1, 2].entries()) {
    const other = structuredClone(h.bundle);
    other.document = { id: `other-${index}`, name: `旧界面${index}` };
    other.resources[0].sliceBorder = { left, top: 0, right: 0, bottom: 0 };
    await h.put(`json/旧界面${index}.psd2ui.json`, JSON.stringify(other));
  }
  await h.put('sprite/comm/comm_bt_0032.png', '1,2,3,255');
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }),
    /PSD2UI_RESOURCE_SETTINGS_CONFLICT/);
  assert.equal(h.state.outputWrites, 0);
});

test('旧平铺共享图比较后复制到sprite，保留旧消费者PNG和JSON', async () => {
  const h = harness();
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧界面' };
  await h.put('旧界面.psd2ui.json', JSON.stringify(other));
  await h.put('comm_bt_0032.png', '1,2,3,255|legacy encoding');
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.reusedResourceCount, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255|legacy encoding');
  assert.ok(h.get('旧界面.psd2ui.json'));
  assert.ok(h.get('comm_bt_0032.png'));
});

test('自己的旧平铺JSON成功迁入json，不留下重复文档声明；Texture按kind分类', async () => {
  const h = harness();
  h.bundle.resources[0].kind = 'texture';
  h.bundle.root.children.forEach(node => { node.rawImage = node.image; delete node.image; });
  await h.put('中文 界面.psd2ui.json', JSON.stringify(h.bundle));
  await h.put('comm_bt_0032.png', 'legacy');
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.get('中文 界面.psd2ui.json'), undefined);
  assert.ok(h.get('json/中文 界面.psd2ui.json'));
  assert.equal(h.get('texture/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.equal(h.get('sprite').entries.size, 0);
});

test('旧声明缺图时提示并导出，九宫边框冲突仍阻断', async () => {
  const h = harness();
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧界面' };
  await h.put('json/旧界面.psd2ui.json', JSON.stringify(other));
  const checked = await h.api.verifyBundle(h.bundle, { uiResFolder: h.output });
  assert.ok(checked.warnings.some(warning => warning.code === 'PSD2UI_SHARED_RESOURCE_MISSING'));
  assert.equal(h.state.outputWrites, 0);
  other.resources[0].sliceBorder = { left: 1, top: 0, right: 0, bottom: 0 };
  await h.put('json/旧界面.psd2ui.json', JSON.stringify(other));
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_RESOURCE_SETTINGS_CONFLICT/);
  assert.equal(h.state.outputWrites, 0);
});

test('像素比较忽略无alpha的编码差异和全透明RGB，保留尺寸与alpha差异', () => {
  const h = harness();
  const value = (pixels, components = 4) => ({ width: 1, height: 1, components, pixels });
  assert.equal(h.api.pixelsEqual(value([1, 2, 3, 255]), value([1, 2, 3], 3)), true);
  assert.equal(h.api.pixelsEqual(value([1, 2, 3, 0]), value([7, 8, 9, 0])), true);
  assert.equal(h.api.pixelsEqual(value([1, 2, 3, 0]), value([1, 2, 3, 1])), false);
  assert.equal(h.api.pixelsEqual(value([1, 2, 3, 255]), { ...value([1, 2, 3, 255]), canvasWidth: 2 }), false);
});

test('公共图比较完成后文件被外部改变，提交前阻断而不写JSON', async () => {
  const h = harness();
  const shared = await h.put('sprite/comm/comm_bt_0032.png', '1,2,3,255');
  let reads = 0;
  h.state.beforeRead = file => { if (file === shared && ++reads === 2) file.data = '9,8,7,255'; };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_EXPORT_TARGET_CHANGED/);
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined);
});

test('公共资源尺寸差异在预检结果中保留来源图层提示', async () => {
  const h = harness();
  await h.put('sprite/comm/comm_bt_0032.png', '9,8,7,255,9,8,7,255|size=2x1');
  const result = await h.api.verifyBundle(h.bundle, { uiResFolder: h.output });
  assert.ok(result.warnings.some(warning => warning.code === 'PSD2UI_RESOURCE_SIZE_REUSED'
    && warning.sourceLayerId === '2' && warning.resourceId === 'res-1'));
  assert.equal(h.state.outputWrites, 0);
});

function explicitNineSliceHarness(pixelValues = [[1, 2, 3, 255, 1, 2, 3, 255], [7, 8, 9, 255, 7, 8, 9, 255]]) {
  const h = harness(pixelValues);
  h.document.width = 2;
  h.document.layers.forEach(layer => { layer.bounds.right = 2; });
  h.bundle.resources[0].sliceBorder = { left: 1, top: 0, right: 0, bottom: 0 };
  return h;
}

test('显式共用九宫只导出指定源图，允许引用层像素不同并保留全部节点', async () => {
  const h = explicitNineSliceHarness();
  Object.assign(h.bundle.resources[0], { sourceLayerId: '3', exportSourceLayerId: '3',
    sliceBorder: { left: 1, top: 0, right: 0, bottom: 0 } });
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.deepEqual(h.state.exportedLayers, ['3']);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '7,8,9,255,7,8,9,255');
  const json = JSON.parse(h.get('json/中文 界面.psd2ui.json').data);
  assert.equal(json.root.children.length, 2);
  assert.deepEqual(json.resources[0].sourceLayerIds, ['2', '3']);
});

test('指定九宫源图时仍以已有公共 PNG 为权威', async () => {
  const h = explicitNineSliceHarness();
  Object.assign(h.bundle.resources[0], { sourceLayerId: '3', exportSourceLayerId: '3',
    sliceBorder: { left: 1, top: 0, right: 0, bottom: 0 } });
  const before = await h.put('sprite/comm/comm_bt_0032.png', '1,2,3,255,1,2,3,255,1,2,3,255|size=3x1');
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.ok(result.warnings.some(warning => warning.code === 'PSD2UI_RESOURCE_SIZE_REUSED'));
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), before);
});

test('非法共用来源在生成任何 PNG 之前被拦截', async () => {
  const h = harness();
  h.bundle.resources[0].exportSourceLayerId = '999';
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_SHARED_SLICE_SOURCE_INVALID/);
  assert.deepEqual(h.state.exportedLayers, []);
});

test('同名图片仅节点不透明度不同时共享原始 alpha，保留 JSON 外观和源 PSD', async () => {
  const h = harness([[1, 2, 3, 180], [1, 2, 3, 180]]);
  h.document.layers[0].opacity = 100;
  h.document.layers[1].opacity = 25;
  h.bundle.root.children[0].opacity = 1;
  h.bundle.root.children[1].opacity = 0.25;
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,180');
  const saved = JSON.parse(h.get('json/中文 界面.psd2ui.json').data);
  assert.deepEqual(saved.root.children.map(node => node.opacity), [1, 0.25]);
  assert.deepEqual(h.document.layers.map(layer => layer.opacity), [100, 25]);
});

test('同名同尺寸图片自身 alpha 不同也按代表图统一复用', async () => {
  const h = harness([[1, 2, 3, 180], [1, 2, 3, 90]]);
  h.document.layers[0].opacity = 50;
  h.document.layers[1].opacity = 100;
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.deepEqual(h.state.exportedLayers, ['2']);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,180');
  assert.equal(result.sourceReuse[0].sourceLayerId, '2');
});

test('CEP 普通资源只调用单资源 RPC，复用声明与文件事务保持完整', async () => {
  const h = harness(), requests = [];
  h.photoshop.core.exportLayerPng = async params => {
    requests.push(params);
    await h.findTemporaryFile(params.path).write('1,2,3,180');
  };
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].documentId, h.document.id); assert.equal(requests[0].layerId, h.document.layers[0].id);
  assert.equal(requests[0].compression, 6); assert.match(requests[0].path, /\/staged\/comm_bt_0032.png$/);
  assert.deepEqual(h.state.exportedLayers, []); assert.equal(h.state.pixelReads, 0);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,180');
  assert.equal(result.sourceReuse[0].sourceLayerId, '2'); assert.equal(h.temp.entries.size, 0);
});

test('CEP 单资源 RPC 失败停止文件事务，不重放旧导出通路', async () => {
  const h = harness(); let requests = 0;
  h.photoshop.core.exportLayerPng = async () => { requests++; throw new Error('PNG encode failed'); };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PNG encode failed/);
  assert.equal(requests, 1); assert.deepEqual(h.state.exportedLayers, []);
  assert.equal(h.state.outputWrites, 0); assert.equal(h.temp.entries.size, 0);
});

test('CEP 提供快速 PNG 能力时九宫仍执行共享像素通路', async () => {
  const h = explicitNineSliceHarness();
  h.photoshop.core.exportLayerPng = async () => { throw new Error('Nine slice must not use ordinary PNG export'); };
  await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.deepEqual(h.state.exportedLayers, ['2']); assert.equal(h.state.pixelReads, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255,1,2,3,255');
});

test('CEP 快速导出后的 JSON 提交失败仍回滚图片事务', async () => {
  const h = harness();
  h.photoshop.core.exportLayerPng = async params => { await h.findTemporaryFile(params.path).write('1,2,3,180'); };
  h.state.failCopy = file => { if (file.name.endsWith('.json')) throw new Error('Injected JSON commit failure'); };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /Injected JSON commit failure/);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png'), undefined);
  assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined); assert.equal(h.temp.entries.size, 0);
});

test('CEP 单资源 RPC 结果未知时保留仍可能写入的暂存目录且不重放', async () => {
  const h = harness(); let requests = 0, staged;
  h.photoshop.core.exportLayerPng = async params => {
    requests++; staged = h.findTemporaryFile(params.path);
    const error = new Error('Host request timed out'); error.code = 'CEP_HOST_RESULT_UNKNOWN'; throw error;
  };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), error => {
    assert.equal(error.code, 'CEP_HOST_RESULT_UNKNOWN'); assert.match(error.exportTransactionPath, /psd2ui-export-/);
    assert.match(error.message, /暂存目录已保留/); return true;
  });
  assert.equal(requests, 1); assert.deepEqual(h.state.exportedLayers, []); assert.equal(h.state.outputWrites, 0);
  assert.equal(h.temp.entries.size, 1); assert.equal(h.findTemporaryFile(staged.nativePath), staged);
});

test('CEP 原生 PNG 尺寸比较不打开 PS 文档，保持已有共享文件原样复用', async () => {
  const h = harness(), reads = [];
  await h.put('sprite/comm/comm_bt_0032.png', '9,8,7,255');
  h.photoshop.core.readPngSize = async file => { reads.push(file.nativePath); return { width: 1, height: 1 }; };
  h.photoshop.app.open = async () => { throw new Error('CEP size read must not open Photoshop document'); };
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(reads.length, 2); assert.equal(result.reusedResourceCount, 1);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '9,8,7,255');
  assert.deepEqual(Array.from(h.photoshop.app.documents), [h.document]);
});

test('CEP 原生 PNG 读取失败或尺寸无效时停止，不回退 PS 读取', async () => {
  for (const invalid of [null, { width: 0, height: 1 }, { width: 1.5, height: 1 }, 'decode failed']) {
    const h = harness(); await h.put('sprite/comm/comm_bt_0032.png', '9,8,7,255');
    h.photoshop.core.readPngSize = async () => { if (typeof invalid === 'string') throw new Error(invalid); return invalid; };
    h.photoshop.app.open = async () => { throw new Error('Unexpected Photoshop open'); };
    await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_PNG_SIZE_INVALID|decode failed/);
    assert.equal(h.state.outputWrites, 0); assert.equal(h.temp.entries.size, 0);
  }
});

async function attachCheckpointFacade(h) {
  const { createPhotoshopFacade } = require('../../Plus-ins/PSD2UI-CEP/src/photoshop');
  const stamp = () => ({ activeDocumentId: h.document.id, documents: [{
    id: h.document.id, name: h.document.name, path: h.document.path,
    width: h.document.width, height: h.document.height, resolution: 72,
    historyId: 'unchanged', activeLayerIds: h.document.activeLayerIds || []
  }] });
  const calls = [];
  const ps = createPhotoshopFacade({ yieldHost: async () => {}, transport: async (method, params) => {
    calls.push(method);
    let value;
    if (method === 'probe') value = stamp();
    else if (method === 'beginState') value = { token: 'checkpoint', stamp: stamp(), reusedDocumentIds: [], done: false };
    else if (method === 'statePage') value = { done: true, items: h.document.layers.map(layer => ({
      documentId: h.document.id, parentId: null,
      layer: { id: layer.id, name: layer.name, visible: layer.visible, bounds: { ...layer.bounds },
        boundsNoEffects: { ...layer.bounds }, kind: 'pixel', opacity: 100, blendMode: 'normal', descriptor: {}, layers: [] }
    })) };
    else if (method === 'readVisibility') value = { layers: params.layerIds.map(id => {
      const layer = h.document.layers.find(entry => String(entry.id) === String(id));
      return { id: layer.id, visible: layer.visible };
    }) };
    else throw new Error('Unexpected checkpoint method: ' + method);
    return { ok: true, value };
  } });
  await ps.initialize();
  h.photoshop.core.getExportSourceCheckpoint = ps.core.getExportSourceCheckpoint;
  h.photoshop.core.verifyExportSourceCheckpoint = ps.core.verifyExportSourceCheckpoint;
  return { ps, calls };
}

for (const checkOnly of [false, true]) test(`CEP 无历史显隐变化阻断${checkOnly ? '预检通过' : '文件提交'}`, async () => {
  const h = harness(), { calls } = await attachCheckpointFacade(h);
  h.photoshop.core.exportLayerPng = async params => {
    await h.findTemporaryFile(params.path).write('1,2,3,255');
    h.document.layers[1].visible = true;
  };
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output, checkOnly }), { code: 'PSD2UI_EXPORT_SOURCE_CHANGED' });
  assert.ok(calls.includes('readVisibility'));
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.get('json/中文 界面.psd2ui.json'), undefined);
  assert.equal(h.temp.entries.size, 0);
});

test('CEP 导出核对允许缓存全量重读与选择变化，不误判源已改变', async () => {
  const h = harness(), { ps, calls } = await attachCheckpointFacade(h);
  h.photoshop.core.exportLayerPng = async params => {
    await h.findTemporaryFile(params.path).write('1,2,3,255');
    h.document.activeLayerIds = [3];
    await ps.invoke('state', {});
  };
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.resourceCount, 1);
  assert.ok(calls.includes('readVisibility'));
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.ok(h.get('json/中文 界面.psd2ui.json'));
  assert.equal(h.temp.entries.size, 0);
});
