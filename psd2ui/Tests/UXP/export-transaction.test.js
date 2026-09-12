'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../Plus-ins/PSD2UI/src/exporter.js'), 'utf8');

function harness(pixelValues = [[1, 2, 3, 255], [1, 2, 3, 255]]) {
  const state = { outputWrites: 0, copies: [], failCopy: null, beforeCopy: null };
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
        target.pixels = new Uint8Array(pixels);
        return { visible: false, async translate() {} };
      }
    });
  });
  app.documents.push(document); app.activeDocument = document;
  app.documents.add = async (options) => {
    const added = { id: sequence++, name: options.name, width: 1, height: 1, layers: [{ id: 99 }],
      path: '', async trim() {},
      saveAs: { png: async (file) => { await file.write(Array.from(added.pixels).join(',')); } },
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
    imaging: { getPixels: async ({ documentID }) => {
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
  return { api: module.exports, output, temp, state, bundle, document, folder, get, put };
}

test('任意合法目录接受相同实际像素的同名图片，隐藏候选也参与验证', async () => {
  const h = harness();
  const result = await h.api.writeBundle(h.bundle, { uiResFolder: h.output });
  assert.equal(result.resourceCount, 1);
  assert.deepEqual([...h.output.entries.keys()].sort(), ['json', 'sprite', 'texture']);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '1,2,3,255');
  assert.match(result.json, /\/json\/中文 界面.psd2ui.json$/);
  assert.equal(h.temp.entries.size, 0);
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

test('旧类型目录共享图迁入模块目录前比较内容，旧文件和其他JSON保留', async () => {
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
  await h.put('sprite/comm_bt_0032.png', '9,8,7,255');
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_RESOURCE_CONTENT_CONFLICT/);
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.get('sprite/comm'), undefined);
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

test('同名异像素在目标写入前失败，诊断包含两源layerId', async () => {
  const h = harness([[1, 2, 3, 255], [7, 8, 9, 255]]);
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }),
    /PSD2UI_RESOURCE_CONTENT_CONFLICT.*图层 2 与 3/);
  assert.equal(h.output.entries.size, 0);
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.temp.entries.size, 0);
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

test('分类目录内无归属的现有PNG也按像素判断，不同内容不能覆盖', async () => {
  const h = harness();
  await h.put('sprite/comm/comm_bt_0032.png', '0,0,0,255');
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_RESOURCE_CONTENT_CONFLICT/);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '0,0,0,255');
  assert.equal(h.state.outputWrites, 0);
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

test('共享后原PSD改变图片也必须阻断，报错包含可定位图层和旧交付名', async () => {
  const h = harness();
  await h.put('json/中文 界面.psd2ui.json', JSON.stringify(h.bundle));
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧界面' };
  await h.put('json/旧界面.psd2ui.json', JSON.stringify(other));
  await h.put('sprite/comm/comm_bt_0032.png', '7,8,9,255');
  await assert.rejects(h.api.verifyBundle(h.bundle, { uiResFolder: h.output }), error => {
    assert.equal(error.code, 'PSD2UI_RESOURCE_CONTENT_CONFLICT');
    assert.equal(error.details.sourceLayerId, '2');
    assert.match(error.message, /旧界面.psd2ui.json/); return true;
  });
  assert.equal(h.state.outputWrites, 0);
  assert.equal(h.get('sprite/comm/comm_bt_0032.png').data, '7,8,9,255');
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_RESOURCE_CONTENT_CONFLICT/);
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

test('共享资源缺文件或九宫边框冲突时带图层信息阻断', async () => {
  const h = harness();
  const other = structuredClone(h.bundle); other.document = { id: 'other', name: '旧界面' };
  await h.put('json/旧界面.psd2ui.json', JSON.stringify(other));
  await assert.rejects(h.api.writeBundle(h.bundle, { uiResFolder: h.output }), /PSD2UI_SHARED_RESOURCE_MISSING/);
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

test('公共资源内容冲突通过正式诊断解析器定位当前PSD图层', async () => {
  const h = harness();
  await h.put('sprite/comm/comm_bt_0032.png', '9,8,7,255');
  const { describePreflightIssues } = require('../../Plus-ins/PSD2UI/src/preflightIssues');
  await assert.rejects(h.api.verifyBundle(h.bundle, { uiResFolder: h.output }), error => {
    const snapshot = { root: { layerId: 'document-root', name: '界面', children: h.document.layers.map(layer => ({layerId:String(layer.id),name:layer.name,children:[]})) } };
    const issues = describePreflightIssues(error, { nodes:{} }, snapshot);
    assert.equal(issues[0].code, 'PSD2UI_RESOURCE_CONTENT_CONFLICT');
    assert.deepEqual(issues[0].layers.map(layer=>layer.id), ['2','3']);
    assert.ok(issues[0].layers.every(layer=>layer.canLocate && layer.path.startsWith('界面 / ')));
    return true;
  });
});
