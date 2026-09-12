'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Core = require('../../Core');
const PluginRoot = path.resolve(__dirname, '../../Plus-ins/PSD2UI');
const read = (name) => fs.readFileSync(path.join(PluginRoot, name), 'utf8');

function layer(id, name, kind = 'pixel', bounds) {
  return { id, name, kind, bounds: bounds || { left: 0, top: 0, right: 100, bottom: 40 },
    visible: true, opacity: 100, layers: [], parent: null,
    ...(kind === 'text' ? { textItem: { contents: name, characterStyle: { size: 20 }, paragraphStyle: {} } } : {}) };
}

function photoshopHost(layers, options = {}) {
  const document = { id: 1, title: '测试界面.psd', path: 'F:/Art/测试界面.psd', width: 720, height: 1560,
    layers, activeLayers: layers.slice(), save: async () => {} };
  const attach = (items, parent) => items.forEach((item) => { item.parent = parent; attach(item.layers || [], item); });
  attach(layers, document);
  const history = [];
  let modalCount = 0;
  let nextGroupId = 900;
  let baseline;
  const capture = (root) => [{ object: root, layers: root.layers.slice(), bounds: root.bounds && { ...root.bounds }, parent: root.parent, visible: root.visible },
    ...root.layers.flatMap(capture)];
  const photoshop = {
    app: { activeDocument: document, documents: [document] },
    constants: { BlendMode: { PASSTHROUGH: 'passThrough' } },
    action: {
      async addNotificationListener() {}, async removeNotificationListener() {},
      async batchPlay(commands) {
        const find = (items, id) => { for (const item of items) { if (item.id === id) return item; const nested = find(item.layers, id); if (nested) return nested; } return null; };
        commands.forEach((command) => {
          if (command._obj === 'select') {
            const selected = find(document.layers, command._target[0]._id);
            document.activeLayers = command.selectionModifier ? [...document.activeLayers, selected] : [selected];
          }
        });
        return [];
      }
    },
    core: {
      async executeAsModal(callback) {
        modalCount += 1;
        if (options.beforeModal) options.beforeModal(document);
        return callback({ hostControl: {
          async suspendHistory() { baseline = capture(document); return { id: 1 }; },
          async resumeHistory(_handle, commit) {
            history.push(commit);
            if (!commit) baseline.forEach((entry) => {
              entry.object.layers = entry.layers; entry.object.parent = entry.parent; entry.object.visible = entry.visible;
              if (entry.bounds) entry.object.bounds = entry.bounds;
            });
          }
        } });
      }
    }
  };
  document.createLayerGroup = async ({ name, fromLayers }) => {
    const parent = fromLayers[0].parent || document;
    const firstIndex = parent.layers.indexOf(fromLayers[0]);
    const group = layer(nextGroupId++, name, 'group', {
      left: Math.min(...fromLayers.map((item) => item.bounds.left)), top: Math.min(...fromLayers.map((item) => item.bounds.top)),
      right: Math.max(...fromLayers.map((item) => item.bounds.right)), bottom: Math.max(...fromLayers.map((item) => item.bounds.bottom))
    });
    group.parent = parent;
    group.layers = options.reverseChildren ? fromLayers.slice().reverse() : fromLayers.slice();
    group.layers.forEach((item) => { item.parent = group; });
    parent.layers = parent.layers.filter((item) => !fromLayers.includes(item));
    parent.layers.splice(firstIndex, 0, group);
    if (options.moveUnselected) parent.layers.reverse();
    if (options.moveBounds) group.layers[0].bounds = { ...group.layers[0].bounds, left: group.layers[0].bounds.left + 2 };
    document.activeLayers = [group];
    return group;
  };
  const sandbox = { module: { exports: {} }, console, require(name) {
    if (name === 'photoshop') return photoshop;
    if (name === './textEffects') return { normalizeLayerTextEffects: () => null };
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.runInNewContext(read('src/photoshopDocument.js'), sandbox);
  return { document, photoshop, api: sandbox.module.exports, history, get modalCount() { return modalCount; } };
}

test('document-root snapshot reads all top-level layers without creating or changing PSD groups', () => {
  const host = photoshopHost([layer(2, 'comm_sp_001'), layer(3, '说明', 'text')]);
  const snapshot = host.api.createSnapshot('document-root');
  assert.equal(snapshot.root.documentRoot, true);
  assert.equal(snapshot.root.bounds.right, 720);
  assert.deepEqual(Array.from(snapshot.root.children, (child) => child.layerId), ['2', '3']);
  assert.deepEqual(host.document.layers.map((item) => item.id), [2, 3]);
  assert.equal(host.modalCount, 0);
});

test('combine rejects nonadjacent or differently parented layers before mutation and reports the gap', async () => {
  const host = photoshopHost([layer(2, 'comm_sp_001'), layer(3, '夹层'), layer(4, 'comm_sp_002')]);
  host.document.activeLayers = [host.document.layers[0], host.document.layers[2]];
  await assert.rejects(host.api.structureActiveLayers({ groupName: '按钮' }, async () => null), (error) => {
    assert.match(error.message, /夹层/); assert.deepEqual(Array.from(error.layerIds), ['3']); return true;
  });
  assert.equal(host.modalCount, 0);
  const group = layer(5, '父组', 'group'); group.layers = [layer(6, 'comm_sp_003')];
  const nested = photoshopHost([layer(2, 'comm_sp_001'), group]);
  nested.document.activeLayers = [nested.document.layers[0], group.layers[0]];
  await assert.rejects(nested.api.structureActiveLayers({ groupName: '按钮' }, async () => null), /同一父组/);
  assert.equal(nested.modalCount, 0);
});

test('combine keeps stable IDs, absolute bounds, child ordering and surrounding layer ordering', async () => {
  const host = photoshopHost([layer(2, '顶部'), layer(3, 'comm_sp_001'), layer(4, '标题', 'text'), layer(5, '底部')]);
  host.document.activeLayers = [host.document.layers[2], host.document.layers[1]];
  const result = await host.api.structureActiveLayers({ groupName: '购买按钮', sourceLayerIds: ['3', '4'] }, async (group) => ({ id: group.id }));
  assert.equal(result.id, '900');
  assert.deepEqual(host.document.layers.map((item) => item.id), [2, 900, 5]);
  assert.deepEqual(Array.from(host.document.layers[1].layers, (item) => item.id), [3, 4]);
  assert.equal(host.document.layers[1].blendMode, 'passThrough');
  assert.deepEqual(host.history, [true]);
});

test('combine rejects a selection changed while waiting for the Photoshop modal', async () => {
  const host = photoshopHost([layer(2, 'comm_sp_001'), layer(3, '标题', 'text'), layer(4, 'comm_sp_002')], {
    beforeModal(document) { document.activeLayers = document.layers.slice(1); }
  });
  host.document.activeLayers = host.document.layers.slice(0, 2);
  await assert.rejects(host.api.structureActiveLayers({ groupName: '按钮', sourceLayerIds: ['2', '3'] }, async () => null), /等待 Photoshop 执行期间选择已变化/);
  assert.deepEqual(host.document.layers.map((item) => item.id), [2, 3, 4]);
  assert.deepEqual(host.history, []);
});

for (const [option, message] of [['reverseChildren', /叠放顺序/], ['moveUnselected', /未选图层/], ['moveBounds', /位置或尺寸/]]) {
  test(`combine rolls back when Photoshop readback fails: ${option}`, async () => {
    const host = photoshopHost([layer(2, '顶部'), layer(3, 'comm_sp_001'), layer(4, '标题', 'text'), layer(5, '底部')], { [option]: true });
    host.document.activeLayers = [host.document.layers[1], host.document.layers[2]];
    let persisted = false;
    await assert.rejects(host.api.structureActiveLayers({ groupName: '按钮' }, async () => { persisted = true; }), message);
    assert.equal(persisted, false);
    assert.deepEqual(host.history, [false]);
    assert.deepEqual(host.document.layers.map((item) => item.id), [2, 3, 4, 5]);
    assert.equal(host.document.layers[1].bounds.left, 0);
  });
}

test('combine rolls back when manifest persistence fails', async () => {
  const host = photoshopHost([layer(2, 'comm_sp_001'), layer(3, '文字', 'text')]);
  await assert.rejects(host.api.structureActiveLayers({ groupName: '按钮' }, async () => { throw new Error('sidecar failed'); }), /sidecar failed/);
  assert.deepEqual(host.history, [false]);
  assert.deepEqual(host.document.layers.map((item) => item.id), [2, 3]);
});

test('visual state preview restores the exact original visibility after switching previews', async () => {
  const first = layer(2, '正常', 'group'); first.layers = [layer(3, 'comm_sp_001')];
  const second = layer(4, '锁定', 'group'); second.layers = [layer(5, 'comm_sp_002')]; second.visible = false;
  const host = photoshopHost([first, second]);
  const value = { defaultState: 'normal', states: [{ name: 'normal', layerId: '2' }, { name: 'locked', layerId: '4' }] };
  await host.api.previewVisualState(value, 'locked');
  assert.equal(first.visible, false); assert.equal(second.visible, true);
  await host.api.previewVisualState(value, 'normal');
  await host.api.restoreVisualStatePreview();
  assert.equal(first.visible, true); assert.equal(second.visible, false);
});

class FakeElement {
  constructor() {
    this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.checked = false; this.disabled = false;
    const classes = new Set(); this.classList = { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  addEventListener(event, callback) { (this.listeners[event] || (this.listeners[event] = [])).push(callback); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  async dispatch(event) { for (const callback of this.listeners[event] || []) await callback(); }
}

async function panelHarness(layers, options = {}) {
  const host = photoshopHost(layers);
  const elements = {};
  for (const match of read('index.html').matchAll(/\bid="([^"]+)"/g)) elements[match[1]] = new FakeElement();
  elements.semantic.value = 'image'; elements['image-type'].value = 'simple';
  let stored = options.stored || null;
  let writes = 0;
  const xmp = {
    async readManifest() {
      if (options.beforeRead) await options.beforeRead(host, writes);
      return stored && JSON.parse(JSON.stringify(stored));
    },
    async readSidecarManifest() { return { path: 'F:/Art/测试界面.psd2ui.authoring.json', manifest: stored }; },
    async writeManifest(manifest) {
      if (options.failWrite) throw new Error('模拟 PSD 保存失败');
      stored = JSON.parse(JSON.stringify(manifest)); writes += 1;
      if (options.corruptWrite) stored.nodes['2'].semantic = 'image';
      return { sidecarPath: 'F:/Art/测试界面.psd2ui.authoring.json' };
    },
    async getDocumentXmp() { return JSON.stringify(stored); },
    async setDocumentXmp(serialized) { stored = JSON.parse(serialized); },
    async restoreSidecarRaw() {},
    async readSidecarRaw() { return { exists: Boolean(stored), serialized: JSON.stringify(stored), path: 'F:/Art/测试界面.psd2ui.authoring.json' }; }
  };
  xmp.writeManifestInCurrentModal = xmp.writeManifest;
  const sandbox = { console: { error() {} }, setTimeout, clearTimeout, document: { getElementById: (id) => elements[id] || null, createElement: () => new FakeElement() }, window: {}, require(name) {
    if (name === 'photoshop') return host.photoshop;
    if (name === './generated/core/index') return Core;
    if (name === './src/preflightIssues') return require('../../Plus-ins/PSD2UI/src/preflightIssues');
    if (name === './src/photoshopDocument') return host.api;
    if (name === './src/xmpStore') return xmp;
    if (name === './src/exporter') return { getRememberedUiResFolder: async () => null, chooseUiResFolder: async () => ({ nativePath: 'F:/Output', isFolder: true }), clearRememberedUiResFolder() {}, writeBundle: async () => { throw new Error('Unexpected export'); } };
    throw new Error(`Unexpected dependency ${name}`);
  } };
  vm.createContext(sandbox);
  vm.runInContext(read('uiShell.js'), sandbox);
  vm.runInContext(read('app.js'), sandbox);
  await new Promise(setImmediate);
  return { host, sandbox, elements, get stored() { return stored; }, get writes() { return writes; } };
}

test('a button saved before initialization survives selection changes, panel restart and repeated preparation', async () => {
  const button = layer(2, 'comm_bt_0001'); const decoration = layer(3, 'comm_sp_0001');
  const panel = await panelHarness([button, decoration]);
  panel.host.document.activeLayers = [button]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  await panel.elements['apply-preset'].dispatch('click');
  assert.equal(panel.stored.nodes['2'].semantic, 'button');
  panel.host.document.activeLayers = [decoration]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, 'image');
  panel.host.document.activeLayers = [button]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, 'button');
  assert.match(panel.elements['layer-config-status'].textContent, /已保存/);
  assert.equal(panel.elements['preparation-badge'].textContent, '已准备');
  const id = panel.stored.document.id;
  await panel.elements['prepare-document'].dispatch('click');
  await panel.elements['initialize-document'].dispatch('click');
  assert.equal(panel.stored.document.id, id);
  assert.equal(panel.stored.nodes['2'].semantic, 'button');
  const reopened = await panelHarness([button], { stored: panel.stored });
  assert.equal(reopened.elements.semantic.value, 'button');
  assert.equal(reopened.writes, 0);
});

test('panel previews size classification for saved defaults and preserves a manual Image override after reopening', async () => {
  const background = layer(2, 'comm_bg_0001');
  const panel = await panelHarness([background]);
  await panel.elements['prepare-document'].dispatch('click');
  const stored = panel.stored;
  assert.equal(stored.nodes['2'].semantic, 'image');
  background.bounds = { left: 0, top: 0, right: 720, bottom: 1560 };
  const reopened = await panelHarness([background], { stored });
  assert.equal(reopened.elements.semantic.value, 'raw-image');
  assert.match(reopened.elements['layer-config-status'].textContent, /720 × 1560 px → Texture/);
  assert.equal(reopened.writes, 0);
  assert.equal(reopened.stored.nodes['2'].semantic, 'image');
  const exported = await reopened.sandbox.prepareCurrentDocumentForExport();
  assert.equal(exported.manifest.nodes['2'].semantic, 'raw-image');
  await reopened.sandbox.preflightCurrentDocument();
  assert.match(reopened.elements['export-summary'].textContent, /0 个 Sprite、1 个 Texture/);
  reopened.elements.semantic.value = 'image'; await reopened.elements.semantic.dispatch('change');
  await reopened.elements['apply-preset'].dispatch('click');
  assert.equal(reopened.stored.nodes['2'].authoringSource, 'explicit');
  assert.equal(reopened.stored.nodes['2'].semantic, 'image');
  const afterSave = await panelHarness([background], { stored: reopened.stored });
  assert.equal(afterSave.elements.semantic.value, 'image');
  assert.match(afterSave.elements['layer-config-status'].textContent, /已保存/);
});

test('newly added images use the same area rule in the panel as in export', async () => {
  const small = layer(2, 'comm_sp_0001');
  const panel = await panelHarness([small]);
  const large = layer(3, 'comm_bg_0001', 'pixel', { left: 0, top: 0, right: 1024, bottom: 256 });
  const strip = layer(4, 'comm_sp_0002', 'pixel', { left: 0, top: 0, right: 667, bottom: 128 });
  panel.host.document.layers.push(large, strip);
  panel.host.document.activeLayers = [large]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, 'raw-image');
  panel.host.document.activeLayers = [strip]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, 'image');
  assert.equal(panel.writes, 0);
});

test('business module can be named before first preparation, survives refresh, and is persisted by either preparation action', async () => {
  for (const action of ['set-module', 'prepare-document']) {
    const image = layer(2, 'comm_bt_0001');
    const panel = await panelHarness([image]);
    const initial = await panel.sandbox.ensureAuthoringManifest();
    assert.equal(panel.elements['document-module'].value, '');
    assert.match(panel.elements['document-module-status'].textContent, /暂用 document/);
    panel.elements['document-module'].value = 'BAOLEIZHENGDUO';
    await panel.elements['document-module'].dispatch('input');
    await panel.elements['normalize-module'].dispatch('click');
    await panel.sandbox.refreshAuthoringState();
    assert.equal(panel.elements['document-module'].value, 'baoleizhengduo');
    assert.equal(panel.writes, 0);
    await panel.elements[action].dispatch('click');
    assert.equal(panel.stored.document.module, 'baoleizhengduo');
    assert.equal(panel.stored.document.id, initial.document.id);
    assert.equal(panel.writes, 1);
    assert.equal(image.name, 'comm_bt_0001');
    const reopened = await panelHarness([image], { stored: panel.stored });
    assert.equal(reopened.elements['document-module'].value, 'baoleizhengduo');
    assert.match(reopened.elements['document-module-status'].textContent, /当前配置：baoleizhengduo/);
  }
});

test('changing an existing document module keeps component and resource identities and resource module folders', async () => {
  const image = layer(2, 'comm_bt_0001');
  const background = layer(3, 'baoleizhengduo_bg_0001');
  const panel = await panelHarness([image, background]);
  panel.host.document.activeLayers = [image]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  await panel.elements['apply-preset'].dispatch('click');
  const snapshot = panel.host.api.createSnapshot(panel.stored.document.rootLayerId);
  const before = Core.prepareManifestForExport(panel.stored, snapshot).manifest;
  const reopened = await panelHarness([image, background], { stored: before });
  reopened.elements['document-module'].value = 'baoleizhengduo';
  await reopened.elements['document-module'].dispatch('input');
  reopened.host.document.activeLayers = [background]; await reopened.sandbox.refreshAuthoringState();
  assert.equal(reopened.elements['document-module'].value, 'baoleizhengduo');
  await reopened.elements['set-module'].dispatch('click');
  assert.equal(reopened.stored.document.id, before.document.id);
  assert.equal(reopened.stored.document.module, 'baoleizhengduo');
  assert.deepEqual(reopened.stored.nodes['2'], before.nodes['2']);
  assert.deepEqual(reopened.stored.resourceRegistry, before.resourceRegistry);
  const bundle = Core.buildBundle(reopened.stored, snapshot);
  assert.equal(bundle.document.module, 'baoleizhengduo');
  assert.deepEqual(bundle.resources.map(r => [r.module, r.fileName]),
    [['baoleizhengduo', 'baoleizhengduo_bg_0001.png'], ['comm', 'comm_bt_0001.png']]);
});

test('invalid business module is not saved and its draft is retained for correction', async () => {
  const panel = await panelHarness([layer(2, 'comm_bt_0001')]);
  panel.elements['document-module'].value = '../invalid';
  await panel.elements['document-module'].dispatch('input');
  await panel.elements['set-module'].dispatch('click');
  assert.equal(panel.writes, 0);
  assert.match(panel.elements['status-summary'].textContent, /保存界面所属模块失败/);
  await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements['document-module'].value, '../invalid');
});

test('failed or mismatched save is visible and is never reported as success', async () => {
  for (const options of [{ failWrite: true }, { corruptWrite: true }]) {
    const panel = await panelHarness([layer(2, 'comm_bt_0001')], options);
    panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
    await panel.elements['apply-preset'].dispatch('click');
    assert.match(panel.elements['status-summary'].textContent, /失败/);
    assert.equal(panel.elements['status-toggle'].getAttribute('aria-expanded'), 'true');
    assert.equal(panel.elements['status-summary'].classList.contains('is-error'), true);
  }
});

test('a layer outside a legacy root cannot be silently dropped by save reconciliation', async () => {
  const group = layer(2, '已有根', 'group'); group.layers = [layer(3, 'comm_sp_0001')];
  const outside = layer(4, 'comm_bt_0001');
  const panel = await panelHarness([group, outside]);
  panel.host.document.activeLayers = [group]; await panel.sandbox.refreshAuthoringState();
  await panel.elements['initialize-document'].dispatch('click');
  assert.equal(panel.stored.document.rootLayerId, '2');
  panel.host.document.activeLayers = [outside]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button';
  const beforeWrites = panel.writes;
  await assert.rejects(panel.sandbox.applySelectedPreset(), /根组之外/);
  assert.equal(panel.writes, beforeWrites);
});

test('wrapping all layers saves a single root and retains a saved button and document identity', async () => {
  const button = layer(2, 'comm_bt_0001'); const text = layer(3, '说明', 'text');
  const panel = await panelHarness([button, text]);
  panel.host.document.activeLayers = [button]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button'; await panel.sandbox.applySelectedPreset();
  const id = panel.stored.document.id;
  panel.elements['root-group-name'].value = '商店界面';
  await panel.elements['wrap-document-root'].dispatch('click');
  assert.deepEqual(panel.host.document.layers.map((entry) => entry.name), ['商店界面']);
  assert.deepEqual(Array.from(panel.host.document.layers[0].layers, (entry) => entry.id), [2, 3]);
  assert.equal(panel.stored.document.id, id);
  assert.equal(panel.stored.nodes['2'].semantic, 'button');
  assert.equal(panel.elements['wrap-document-root'].disabled, true);
  await panel.sandbox.wrapDocumentRoot();
  assert.equal(panel.host.document.layers[0].layers.length, 2);
});

test('root wrapper rolls back changed ordering, geometry and a failed save callback', async () => {
  for (const options of [{ reverseChildren: true }, { moveBounds: true }, {}]) {
    const host = photoshopHost([layer(2, '背景'), layer(3, '说明', 'text')], options);
    await assert.rejects(host.api.wrapTopLevelLayersInGroup(['2', '3'], '界面', async () => { throw new Error('保存失败'); }));
    assert.deepEqual(host.document.layers.map((entry) => entry.id), [2, 3]);
    assert.deepEqual(host.history, [false]);
  }
});

test('complex component guide explains nested list roles without mutating PSD', async () => {
  const panel = await panelHarness([layer(2, 'comm_sp_0001')]);
  await panel.elements['component-guide-toggle'].dispatch('click');
  panel.elements['component-guide-kind'].value = 'list';
  await panel.elements['component-guide-kind'].dispatch('change');
  assert.match(panel.elements['component-guide-tree'].textContent, /条目模板/);
  assert.match(panel.elements['component-guide-steps'].children[0].textContent, /购买按钮/);
  assert.equal(panel.elements['component-guide-steps'].children.length, 3);
  assert.equal(panel.writes, 0);
});

test('locating a role then returning to the component restores unsaved choices', async () => {
  const root = layer(2, '购买按钮', 'group');
  root.layers = [layer(3, 'comm_bt_0001'), layer(4, 'comm_sp_0001'), layer(5, '购买', 'text')];
  const panel = await panelHarness([root]);
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  const fields = panel.elements['component-role-fields'].children;
  fields[0].children[1].value = '3'; await fields[0].children[1].dispatch('change');
  fields[1].children[1].value = '5'; await fields[1].children[1].dispatch('change');
  await fields[0].children[3].dispatch('click');
  await new Promise(setImmediate);
  assert.equal(panel.host.document.activeLayers[0].id, 3);
  await panel.elements['return-to-component'].dispatch('click');
  assert.equal(panel.host.document.activeLayers[0].id, 2);
  assert.equal(panel.elements.semantic.value, 'button');
  assert.equal(panel.elements['component-role-fields'].children[0].children[1].value, '3');
  assert.equal(panel.elements['component-role-fields'].children[1].children[1].value, '5');
  assert.equal(panel.writes, 0);
});

test('an older asynchronous refresh cannot overwrite the newer selected layer', async () => {
  let waitRead = null;
  const first = layer(2, 'comm_bt_0001'); const second = layer(3, '说明', 'text');
  const panel = await panelHarness([first, second], { beforeRead: async () => { if (waitRead) await waitRead; } });
  panel.host.document.activeLayers = [first];
  let release;
  waitRead = new Promise(resolve => { release = resolve; });
  const pending = panel.sandbox.refreshAuthoringState();
  await new Promise(setImmediate);
  waitRead = null;
  panel.host.document.activeLayers = [second];
  await panel.sandbox.refreshAuthoringState();
  release(); await pending;
  assert.equal(panel.elements.semantic.value, 'text');
});

test('preflight identifies invalid group geometry by full PSD path, locates it, and clears resolved issues without saving', async () => {
  const empty = layer(6330, '组 1', 'group', { left: NaN, top: NaN, right: NaN, bottom: NaN });
  empty.layers = [layer(6331, 'comm_sp_0001')];
  const parent = layer(2, '上2', 'group'); parent.layers = [empty];
  const panel = await panelHarness([parent]);
  await panel.elements.preflight.dispatch('click');
  assert.match(panel.elements['status-summary'].textContent, /失败/);
  assert.equal(panel.elements['preflight-report'].classList.contains('is-hidden'), false);
  const row = panel.elements['preflight-issues'].children[0];
  assert.match(row.children[0].textContent, /组 1/);
  assert.match(row.children[1].textContent, /测试界面 \/ 上2 \/ 组 1 · #6330/);
  assert.match(row.children[2].textContent, /位置或尺寸无效/);
  assert.doesNotMatch(panel.elements.status.value, /undefined/);
  const locate = row.children.find(child => child.textContent === '定位「组 1」');
  await locate.dispatch('click');
  assert.equal(panel.host.document.activeLayers[0].id, 6330);
  assert.equal(panel.elements['preflight-issues'].children.length, 1);
  empty.bounds = { left: 0, top: 0, right: 40, bottom: 40 };
  await panel.elements['recheck-preflight'].dispatch('click');
  assert.equal(panel.elements['preflight-report'].classList.contains('is-hidden'), true);
  assert.equal(panel.elements['preflight-issues'].children.length, 0);
  assert.match(panel.elements['export-summary'].textContent, /预检通过/);
  assert.equal(panel.writes, 0);
});

test('a missing component role points to its surviving owner group', async () => {
  const root = layer(2, '购买按钮', 'group'); root.layers = [layer(3, 'comm_bt_0001'), layer(4, '购买', 'text')];
  const panel = await panelHarness([root]);
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  await panel.sandbox.structureSelectedComponent();
  root.layers = root.layers.filter(child => child.id !== 3);
  await panel.elements.preflight.dispatch('click');
  const row = panel.elements['preflight-issues'].children[0];
  assert.match(row.children[0].textContent, /购买按钮/);
  assert.match(row.children[2].textContent, /角色|图层/);
  const locate = row.children.find(child => child.textContent === '定位「购买按钮」');
  await locate.dispatch('click');
  assert.equal(panel.host.document.activeLayers[0].id, 2);
  assert.equal(panel.writes, 1);
});

test('failed export precheck uses the issue list and stale results cannot select in a different PSD', async () => {
  const empty = layer(2, '无效组', 'group', { left: NaN, top: NaN, right: NaN, bottom: NaN });
  empty.layers = [layer(4, 'comm_sp_0001')];
  const other = layer(3, '另一个组', 'group');
  const panel = await panelHarness([empty, other]);
  await panel.elements['select-uires'].dispatch('click');
  await panel.elements['export-bundle'].dispatch('click');
  assert.equal(panel.elements['preflight-issues'].children.length, 1);
  const row = panel.elements['preflight-issues'].children[0];
  const locate = row.children.find(child => child.textContent === '定位「无效组」');
  panel.host.document.activeLayers = [other];
  panel.host.document.id = 99;
  await locate.dispatch('click');
  assert.match(panel.elements.status.value, /切换了 PSD/);
  assert.equal(panel.host.document.activeLayers[0].id, 3);
  assert.equal(panel.writes, 0);
});

test('document-level export errors are visible without a fabricated layer locator', async () => {
  const panel = await panelHarness([layer(2, 'comm_sp_0001')]);
  await panel.elements['export-bundle'].dispatch('click');
  const row = panel.elements['preflight-issues'].children[0];
  assert.match(row.children[0].textContent, /文档 \/ 导出设置/);
  assert.match(row.children[1].textContent, /选择输出目录/);
  assert.equal(row.children.some(child => (child.textContent || '').startsWith('定位「')), false);
  assert.equal(panel.writes, 0);
});

test('unconfigured groups show an unset picker and empty groups pass preflight before and after initialization', async () => {
  const empty = layer(6330, '空组', 'group', { left: NaN, top: NaN, right: NaN, bottom: NaN });
  const parent = layer(2, '只有空组的目录', 'group', empty.bounds); parent.layers = [empty];
  const ordinary = layer(3, '普通组', 'group'); ordinary.layers = [layer(4, 'comm_sp_0001')];
  const panel = await panelHarness([parent, ordinary]);
  for (const initialized of [false, true]) {
    if (initialized) await panel.elements['prepare-document'].dispatch('click');
    panel.host.document.activeLayers = [ordinary.layers[0]]; await panel.sandbox.refreshAuthoringState();
    assert.equal(panel.elements.semantic.value, 'image');
    for (const group of [ordinary, empty, parent]) {
      panel.host.document.activeLayers = [group]; await panel.sandbox.refreshAuthoringState();
      assert.equal(panel.elements.semantic.value, '');
      assert.match(panel.elements['semantic-summary-title'].textContent, /未设置组件/);
      assert.equal(panel.elements['options-image'].classList.contains('is-hidden'), true);
      assert.equal(panel.elements['apply-preset'].disabled, true);
      if (group !== ordinary) assert.equal(panel.elements['effective-semantic'].textContent, '空组 · 未设置组件');
    }
    await panel.elements.preflight.dispatch('click');
    assert.match(panel.elements['export-summary'].textContent, /预检通过；1 个 Sprite、0 个 Texture/);
    assert.equal(panel.elements['preflight-report'].classList.contains('is-hidden'), true);
    assert.equal(panel.writes, initialized ? 1 : 0);
    if (initialized) {
      assert.equal(panel.stored.nodes['6330'].semantic, 'group');
      assert.equal(panel.stored.nodes['6330'].authoringSource, 'default');
    }
  }
});

test('a configured component that loses all content retains its type and reports its missing structure', async () => {
  const root = layer(2, '购买按钮', 'group'); root.layers = [layer(3, 'comm_bt_0001'), layer(4, '购买', 'text')];
  const empty = layer(5, '空组', 'group');
  const panel = await panelHarness([root, empty]);
  panel.host.document.activeLayers = [root]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  await panel.sandbox.structureSelectedComponent();
  root.layers = []; root.bounds = { left: NaN, top: NaN, right: NaN, bottom: NaN };
  panel.host.document.activeLayers = [empty]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, '');
  panel.host.document.activeLayers = [root]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, 'button');
  assert.match(panel.elements['layer-config-status'].textContent, /已保存/);
  await panel.elements.preflight.dispatch('click');
  assert.match(panel.elements.status.value, /PSD2UI_STRUCTURE_ROOT_EMPTY/);
  const row = panel.elements['preflight-issues'].children[0];
  assert.match(row.children[0].textContent, /购买按钮/);
  assert.equal(panel.stored.nodes['2'].semantic, 'button');
  assert.equal(panel.writes, 1);
});

test('actual panel bootstrap auto initializes only in memory and name checking locates invalid images without writing PSD', async () => {
  const root = layer(2, '中文组', 'group'); root.layers = [layer(3, '临时图片'), layer(4, '正常文字', 'text')];
  const panel = await panelHarness([root]);
  const first = await panel.sandbox.ensureAuthoringManifest();
  const second = await panel.sandbox.ensureAuthoringManifest();
  assert.equal(first.document.id, second.document.id);
  assert.equal(first.resourceNaming, 'source');
  assert.equal(panel.writes, 0);
  const checked = await panel.sandbox.checkImageNames(false);
  assert.equal(checked.status, 'blocked');
  assert.deepEqual(Array.from(checked.issues, (issue) => issue.layerId), ['3']);
  assert.equal(panel.elements['image-name-issues'].children.length, 1);
  await assert.rejects(panel.sandbox.prepareCurrentDocumentForExport(), /图片命名检查未通过/);
  assert.equal(panel.writes, 0);
});

test('actual panel shows only applicable save actions and image controls for the current selection', async () => {
  const first = layer(2, 'comm_bt_0001'); const second = layer(3, '购买', 'text');
  const panel = await panelHarness([first, second]);
  panel.host.document.activeLayers = [first]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements['apply-preset'].classList.contains('is-hidden'), false);
  assert.equal(panel.elements['structure-component'].classList.contains('is-hidden'), true);
  assert.equal(panel.elements['combine-component'].classList.contains('is-hidden'), true);
  assert.equal(panel.elements['image-rename-card'].classList.contains('is-hidden'), false);
  panel.sandbox.loadNodeIntoFields({ semantic: 'image', image: { imageType: 'sliced', sliceBorder: { left: 4 } } });
  assert.equal(panel.elements['slice-fields'].classList.contains('is-hidden'), false);
  panel.sandbox.resetImageDefaults();
  assert.equal(panel.elements['slice-fields'].classList.contains('is-hidden'), true);
  panel.host.document.activeLayers = [first, second]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  assert.equal(panel.elements['apply-preset'].classList.contains('is-hidden'), true);
  assert.equal(panel.elements['structure-component'].classList.contains('is-hidden'), true);
  assert.equal(panel.elements['combine-component'].classList.contains('is-hidden'), false);
  assert.equal(panel.elements['image-rename-card'].classList.contains('is-hidden'), true);
});

test('actual panel renders role choices and saves a compound group with explicit background without renaming PSD', async () => {
  const root = layer(2, '购买按钮', 'group'); root.layers = [layer(3, 'comm_bt_0001'), layer(4, 'comm_sp_0001'), layer(5, '购买', 'text')];
  const panel = await panelHarness([root]);
  panel.host.document.activeLayers = [root];
  await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'button';
  await panel.elements.semantic.dispatch('change');
  assert.equal(panel.elements['component-editor'].classList.contains('is-hidden'), false);
  const fields = panel.elements['component-role-fields'].children;
  assert.equal(fields.length, 2);
  const background = fields[0].children[1]; background.value = '3'; await background.dispatch('change');
  const label = fields[1].children[1]; label.value = '5'; await label.dispatch('change');
  assert.equal(panel.elements['structure-component'].disabled, false);
  assert.equal(panel.elements['structure-component'].classList.contains('is-hidden'), false);
  assert.equal(panel.elements['apply-preset'].classList.contains('is-hidden'), true);
  assert.equal(panel.elements['combine-component'].classList.contains('is-hidden'), true);
  const result = await panel.sandbox.structureSelectedComponent();
  assert.equal(result.groupLayerId, '2');
  assert.equal(panel.stored.nodes['2'].semantic, 'button');
  assert.deepEqual(panel.stored.nodes['2'].structure.roles, [{ name: 'background', layerId: '3' }, { name: 'label', layerId: '5' }]);
  assert.equal(root.name, '购买按钮'); assert.deepEqual(root.layers.map((item) => item.id), [3, 4, 5]);
  assert.equal(panel.writes, 1);
});

test('actual panel saves component metadata before image naming is complete', async () => {
  const root = layer(2, '按钮组', 'group'); root.layers = [layer(3, '未命名背景'), layer(4, '按钮文字', 'text')];
  const panel = await panelHarness([root]);
  panel.elements.semantic.value = 'button'; await panel.elements.semantic.dispatch('change');
  await panel.sandbox.structureSelectedComponent();
  assert.equal(panel.stored.nodes['2'].semantic, 'button');
  const checked = await panel.sandbox.checkImageNames(false);
  assert.equal(checked.status, 'blocked');
});

test('actual panel saves an explicit list template, preview sample, layout and viewport and exports their projection', async () => {
  const first = layer(3, '条目一', 'group'); first.layers = [layer(4, 'comm_sp_0001')];
  const second = layer(5, '条目二', 'group', { left: 0, top: 40, right: 100, bottom: 80 });
  second.layers = [layer(6, 'comm_sp_0002', 'pixel', { left: 0, top: 40, right: 100, bottom: 80 })];
  const root = layer(2, '列表', 'group', { left: 0, top: 0, right: 100, bottom: 80 }); root.layers = [first, second];
  const panel = await panelHarness([root]);
  panel.elements.semantic.value = 'list'; await panel.elements.semantic.dispatch('change');
  let roleFields = panel.elements['component-role-fields'].children;
  roleFields[0].children[1].value = '3'; await roleFields[0].children[1].dispatch('change');
  const previews = panel.elements['component-preview-fields'].children;
  assert.equal(previews.length, 2);
  previews[1].children[0].checked = true; await previews[1].children[0].dispatch('change');
  const viewport = panel.elements['component-viewport-fields'].children;
  viewport[0].children[0].checked = true; await viewport[0].children[0].dispatch('change');
  viewport[1].children[1].value = '120'; viewport[2].children[1].value = '80';
  await viewport[1].children[1].dispatch('change');
  await panel.sandbox.structureSelectedComponent();
  assert.deepEqual(panel.stored.nodes['2'].structure.roles, [{ name: 'item-template', layerId: '3' }]);
  assert.deepEqual(panel.stored.nodes['2'].structure.previewLayerIds, ['5']);
  assert.deepEqual(panel.stored.nodes['2'].viewport, { width: 120, height: 80 });
  const prepared = await panel.sandbox.prepareCurrentDocumentForExport();
  const list = prepared.bundle.root.children[0];
  assert.equal(list.rect.width, 120);
  assert.deepEqual(Array.from(list.children, (node) => node.sourceLayerId), ['3']);
});

test('actual panel can save default visual state by group identity and clear its state configuration', async () => {
  const first = layer(3, '正常组', 'group'); first.layers = [layer(4, 'comm_sp_0001')];
  const second = layer(5, '锁定组', 'group'); second.layers = [layer(6, 'comm_sp_0002')];
  const root = layer(2, '复合外观', 'group'); root.layers = [first, second];
  const panel = await panelHarness([root]);
  await panel.elements['add-visual-state'].dispatch('click');
  await panel.elements['add-visual-state'].dispatch('click');
  const rows = panel.elements['visual-state-rows'].children;
  rows[0].children[0].value = 'normal'; rows[0].children[1].value = '3';
  rows[1].children[0].value = 'locked'; rows[1].children[1].value = '5';
  await rows[1].children[1].dispatch('change');
  await panel.sandbox.saveVisualStates();
  assert.deepEqual(panel.stored.nodes['2'].visualStates, { defaultState: 'normal', states: [{ name: 'normal', layerId: '3' }, { name: 'locked', layerId: '5' }] });
  await rows[1].children[3].dispatch('click'); await rows[0].children[3].dispatch('click');
  await panel.sandbox.saveVisualStates();
  assert.equal(panel.stored.nodes['2'].visualStates, undefined);
});

test('Grid save persists template, layout and previews after changing selection and reopening the panel', async () => {
  const bounds = [
    { left: 152, top: 353, right: 227, bottom: 427 },
    { left: 228, top: 353, right: 303, bottom: 427 },
    { left: 68, top: 353, right: 143, bottom: 427 },
    { left: 68, top: 433, right: 143, bottom: 507 }
  ];
  const cells = bounds.map((box, index) => {
    const cell = layer(3 + index * 2, index < 2 ? `组 ${3 - index}` : '组 1 ', 'group', box);
    cell.layers = [layer(4 + index * 2, `comm_sp_000${index + 1}`, 'pixel', box)];
    return cell;
  });
  const root = layer(2, '组 1 ', 'group', { left: 68, top: 353, right: 303, bottom: 507 }); root.layers = cells;
  const other = layer(20, 'comm_bt_0001');
  const panel = await panelHarness([root, other]);
  panel.host.document.activeLayers = [root]; await panel.sandbox.refreshAuthoringState();
  panel.elements.semantic.value = 'grid'; await panel.elements.semantic.dispatch('change');
  const template = panel.elements['component-role-fields'].children[0].children[1];
  template.value = '7'; await template.dispatch('change');
  const fields = panel.elements['component-layout-fields'].children;
  assert.deepEqual(fields.map(row => Number(row.children[1].value)), [75, 74, 3, 2, 5, 6]);
  assert.match(panel.elements['component-layout-status'].textContent, /4 个同级样例.*1–9px/);
  const expectedLayout = { cellWidth: 75, cellHeight: 74, columns: 3, rows: 2, horizontalSpacing: 12, verticalSpacing: 6 };
  Object.values(expectedLayout).forEach((value, index) => { fields[index].children[1].value = String(value); });
  await fields[2].children[1].dispatch('change');
  for (const row of panel.elements['component-preview-fields'].children.slice(1)) {
    row.children[0].checked = true; await row.children[0].dispatch('change');
  }
  assert.equal(panel.elements['structure-component'].disabled, false);
  await panel.elements['structure-component'].dispatch('click');
  assert.match(panel.elements['status-summary'].textContent, /成功/);
  assert.doesNotMatch(panel.elements['selection-constraint'].textContent, /多个候选|缺少/);
  assert.match(panel.elements['component-save-feedback'].textContent, /#2 → 网格 \/ Grid/);
  assert.equal(panel.stored.nodes['2'].semantic, 'grid');
  assert.deepEqual(panel.stored.nodes['2'].structure.layout, expectedLayout);
  assert.deepEqual(panel.stored.nodes['2'].structure.roles, [{ name: 'cell-template', layerId: '7' }]);
  assert.deepEqual(panel.stored.nodes['2'].structure.previewLayerIds, ['3', '5', '9']);
  panel.host.document.activeLayers = [other]; await panel.sandbox.refreshAuthoringState();
  assert.match(panel.elements['component-save-feedback'].textContent, /#2 → 网格 \/ Grid/);
  panel.host.document.activeLayers = [root]; await panel.sandbox.refreshAuthoringState();
  assert.equal(panel.elements.semantic.value, 'grid');
  const reopened = await panelHarness([root], { stored: panel.stored });
  assert.equal(reopened.elements.semantic.value, 'grid');
  assert.equal(reopened.elements['component-role-fields'].children[0].children[1].value, '7');
  const prepared = await reopened.sandbox.prepareCurrentDocumentForExport();
  assert.equal(prepared.bundle.root.children[0].semantic, 'grid');
  assert.deepEqual(prepared.bundle.root.children[0].structure.layout, expectedLayout);
  await reopened.elements['recalculate-component-layout'].dispatch('click');
  assert.equal(reopened.elements['component-layout-fields'].children[4].children[1].value, '5');
  cells[1].bounds = { left: 248, top: 353, right: 323, bottom: 427 };
  await reopened.elements['recalculate-component-layout'].dispatch('click');
  assert.equal(reopened.elements['component-layout-fields'].children[4].children[1].value, '15');
  assert.equal(reopened.writes, 0, 'Measuring geometry must not save the PSD implicitly');
});

function sourceManifest(layers) {
  const host = photoshopHost(layers);
  return Core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    module: 'chongzhi', resourceNaming: 'source', name: '测试界面', width: 720, height: 1560,
    rootLayerId: 'document-root', rootLayerName: '测试界面', snapshot: host.api.createSnapshot('document-root')
  } }, { actor: 'mcp' }).manifest;
}

function containerPlan(host, containers) {
  const ids = [...new Set(containers.flatMap((entry) => entry.members).filter((ref) => !ref.startsWith('@')))];
  return { version: 1, confirmationId: 'confirmed-state-containers', containers,
    preconditions: ids.map((id) => {
      const item = host.api.findLayerById(host.document.layers, id);
      return { layerId: id, name: item.name, parentId: String(item.parent.id), bounds: { ...item.bounds } };
    }) };
}

test('automation initializes a virtual source root and inspect returns persisted configuration without writes', async () => {
  const image = layer(2, 'comm_sp_0001'); const text = layer(3, '充值标题', 'text');
  const panel = await panelHarness([image, text]);
  const automation = panel.sandbox.__PSD2UI_DEV__;
  const expectedDocumentPath = panel.host.document.path;
  await automation.initialize({ expectedDocumentPath, module: 'chongzhi' });
  assert.equal(panel.stored.resourceNaming, 'source');
  assert.equal(panel.stored.document.rootLayerId, 'document-root');
  assert.deepEqual(panel.host.document.layers.map((item) => item.name), ['comm_sp_0001', '充值标题']);
  const writes = panel.writes;
  const inspected = await automation.inspect({ expectedDocumentPath });
  assert.equal(inspected.manifest.nodes['3'].text.content, panel.stored.nodes['3'].text.content);
  assert.equal(inspected.manifest.document.id, panel.stored.document.id);
  assert.equal(inspected.manifest.nodeCount, 3);
  assert.equal(inspected.exportSettings.uiResPath, null);
  assert.equal(inspected.exportSettings.scope, 'global');
  assert.equal(panel.writes, writes);
  await assert.rejects(automation.initialize({ expectedDocumentPath, module: 'chongzhi' }), /已经初始化/);
  assert.equal(panel.writes, writes);
});

test('automation saves and reads normal/selected state groups, preserving old document identity through export', async () => {
  const normal = layer(3, '未选中', 'group'); normal.layers = [layer(4, 'comm_sp_0001')];
  const selected = layer(5, '选中', 'group'); selected.layers = [layer(6, 'comm_sp_0002')];
  const root = layer(2, '页签', 'group'); root.layers = [normal, selected];
  const stored = sourceManifest([root]); delete stored.resourceNaming;
  const beforeIds = Object.fromEntries(Object.entries(stored.nodes).map(([key, value]) => [key, value.id]));
  const panel = await panelHarness([root], { stored });
  const automation = panel.sandbox.__PSD2UI_DEV__;
  const expectedDocumentPath = panel.host.document.path;
  const visualStates = { defaultState: 'normal', states: [{ name: 'normal', layerId: '3' }, { name: 'selected', layerId: '5' }] };
  const saved = await automation.execute({ expectedDocumentPath, command: 'set-visual-states', input: { layerId: '2', visualStates } });
  assert.deepEqual(JSON.parse(JSON.stringify(saved.value.visualStates)), visualStates);
  assert.deepEqual(panel.stored.nodes['2'].visualStates, visualStates);
  assert.equal(panel.stored.document.id, stored.document.id);
  assert.deepEqual(Object.fromEntries(Object.entries(panel.stored.nodes).map(([key, value]) => [key, value.id])), beforeIds);
  const prepared = await panel.sandbox.prepareCurrentDocumentForExport();
  const exported = prepared.bundle.root.children[0];
  assert.equal(exported.visualStates.defaultState, 'normal');
  assert.deepEqual(Array.from(exported.children, (node) => node.visible), ['enabled', 'disabled']);
  const inspected = await automation.inspect({ expectedDocumentPath });
  assert.deepEqual(inspected.manifest.nodes['2'].visualStates, visualStates);
  await automation.execute({ expectedDocumentPath, command: 'set-visual-states', input: { layerId: '2', visualStates: null } });
  assert.equal(panel.stored.nodes['2'].visualStates, undefined);
});

test('automation rejects missing, foreign, hidden-from-export and non-group state targets before saving', async () => {
  const normal = layer(3, '未选中', 'group'); normal.layers = [layer(4, 'comm_sp_0001')];
  const root = layer(2, '页签', 'group'); root.layers = [normal];
  const outside = layer(8, '其他组件', 'group'); outside.layers = [layer(9, 'comm_sp_0002')];
  const stored = sourceManifest([root, outside]);
  const panel = await panelHarness([root, outside], { stored });
  const execute = (input) => panel.sandbox.__PSD2UI_DEV__.execute({
    expectedDocumentPath: panel.host.document.path, command: 'set-visual-states', input
  });
  await assert.rejects(execute({ layerId: '2' }), /必须提供 visualStates/);
  for (const layerId of ['4', '8', '999']) {
    await assert.rejects(execute({ layerId: '2', visualStates: {
      defaultState: 'normal', states: [{ name: 'normal', layerId }]
    } }), /必须指向当前组件内的组/);
  }
  await assert.rejects(execute({ layerId: '4', visualStates: null }), /只能配置在 Photoshop 组/);
  await assert.rejects(panel.sandbox.__PSD2UI_DEV__.execute({ expectedDocumentPath: 'F:/Art/别的.psd',
    command: 'set-visual-states', input: { layerId: '2', visualStates: null } }), /不是预期目标/);
  assert.equal(panel.writes, 0);
  stored.nodes['3'].exportMode = 'preview-only';
  const excluded = await panelHarness([root, outside], { stored });
  await assert.rejects(excluded.sandbox.__PSD2UI_DEV__.execute({ expectedDocumentPath: excluded.host.document.path,
    command: 'set-visual-states', input: { layerId: '2', visualStates: {
      defaultState: 'normal', states: [{ name: 'normal', layerId: '3' }]
    } } }), /当前图层配置不可用/);
  assert.equal(excluded.writes, 0);
});

test('automation sets unequal collection previews with live snapshot and records the actual viewport bounds', async () => {
  const template = layer(3, '每日特惠', 'group', { left: 0, top: 0, right: 995, bottom: 403 });
  template.layers = [layer(4, 'comm_sp_0001')];
  const preview = layer(5, '自选礼包', 'group', { left: 0, top: 425, right: 995, bottom: 784 });
  preview.layers = [layer(6, 'comm_sp_0002')];
  const root = layer(2, '礼包列表', 'group', { left: 0, top: 0, right: 995, bottom: 784 }); root.layers = [template, preview];
  let stored = sourceManifest([root]);
  const layout = { direction: 'vertical', itemWidth: 995, itemHeight: 403, spacing: 22 };
  stored = Core.executeAuthoringCommand(stored, { command: 'apply-structured-group', input: {
    layerId: '2', semantic: 'list', structure: { version: 1, roles: [{ name: 'item-template', layerId: '3' }],
      previewLayerIds: [], layout }
  } }, { actor: 'human-panel' }).manifest;
  const panel = await panelHarness([root], { stored });
  const automation = panel.sandbox.__PSD2UI_DEV__;
  const expectedDocumentPath = panel.host.document.path;
  const saved = await automation.execute({ expectedDocumentPath, command: 'set-collection-previews', input: {
    layerId: '2', previewLayerIds: ['5'], snapshot: { root: { layerId: 'forged' } }
  } });
  assert.deepEqual(Array.from(saved.value.structure.previewLayerIds), ['5']);
  assert.deepEqual(panel.stored.nodes['2'].structure.layout, layout);
  await automation.execute({ expectedDocumentPath, command: 'set-node-viewport', input: {
    layerId: '2', viewport: { width: 995, height: 403 }, sourceBounds: { left: -99, top: -99, right: -90, bottom: -90 }
  } });
  assert.deepEqual(panel.stored.nodes['2'].viewportSourceBounds, root.bounds);
  const prepared = await panel.sandbox.prepareCurrentDocumentForExport();
  assert.deepEqual(Array.from(prepared.bundle.root.children[0].children, (node) => node.sourceLayerId), ['3']);
  assert.equal(prepared.bundle.root.children[0].rect.height, 403);
  assert.deepEqual(root.layers.map((node) => node.id), [3, 5]);
  await automation.execute({ expectedDocumentPath, command: 'set-collection-previews', input: { layerId: '2', previewLayerIds: [] } });
  assert.deepEqual(panel.stored.nodes['2'].structure.previewLayerIds, []);
});

test('confirmed collection plan preserves explicit layout with unequal preview groups through save and export', async () => {
  const template = layer(3, '每日特惠', 'group', { left: 0, top: 0, right: 995, bottom: 403 });
  template.layers = [layer(4, 'comm_sp_0001')];
  const preview = layer(5, '自选礼包', 'group', { left: 0, top: 425, right: 995, bottom: 784 });
  preview.layers = [layer(6, 'comm_sp_0002')];
  const root = layer(2, '礼包列表', 'group', { left: 0, top: 0, right: 995, bottom: 784 }); root.layers = [template, preview];
  const panel = await panelHarness([root], { stored: sourceManifest([root]) });
  const layout = { direction: 'vertical', itemWidth: 995, itemHeight: 403, spacing: 22 };
  const plan = { version: 1, confirmationId: 'confirmed-list-with-unequal-previews',
    preconditions: [root, template, preview].map((item) => ({ layerId: String(item.id), name: item.name,
      parentId: String(item.parent.id), bounds: { ...item.bounds } })),
    adopt: [{ ref: '2', semantic: 'list', roles: [{ name: 'item-template', ref: '3' }], previewRefs: ['5'], layout }]
  };
  const result = await panel.sandbox.__PSD2UI_DEV__.applyConfirmedStructurePlan({ expectedDocumentPath: panel.host.document.path,
    plan, confirmationId: plan.confirmationId, confirmationText: 'APPLY_CONFIRMED_STRUCTURE_PLAN'
  });
  assert.equal(result.diagnostics.some((issue) => issue.severity === 'error'), false);
  assert.deepEqual(panel.stored.nodes['2'].structure.layout, layout);
  assert.equal(panel.stored.nodes['2'].structure.layoutSource, 'explicit');
  assert.deepEqual(panel.stored.nodes['2'].structure.previewLayerIds, ['5']);
  const prepared = await panel.sandbox.prepareCurrentDocumentForExport();
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.bundle.root.children[0].structure.layout)), layout);
  assert.deepEqual(Array.from(prepared.bundle.root.children[0].children, (node) => node.sourceLayerId), ['3']);
  assert.deepEqual(root.layers.map((node) => node.id), [3, 5]);
});

test('confirmed state containers persist as ordinary groups and can be configured by returned layer IDs', async () => {
  const root = layer(2, '页签', 'group'); root.layers = [layer(3, 'comm_sp_0001'), layer(4, '未选文字', 'text'),
    layer(5, 'comm_sp_0002'), layer(6, '已选文字', 'text')];
  const stored = Core.executeAuthoringCommand(sourceManifest([root]), {
    command: 'apply-structured-group', input: { layerId: '2', semantic: 'toggle', structure: {
      version: 1, roles: [{ name: 'background', layerId: '3' }, { name: 'on-graphic', layerId: '5' }], previewLayerIds: []
    } }
  }, { actor: 'human-panel' }).manifest;
  const panel = await panelHarness([root], { stored });
  const plan = containerPlan(panel.host, [
    { alias: '@normal', name: '未选中', members: ['4', '3'] },
    { alias: '@selected', name: '选中', members: ['5', '6'] }
  ]);
  const automation = panel.sandbox.__PSD2UI_DEV__;
  const expectedDocumentPath = panel.host.document.path;
  const applied = await automation.applyConfirmedStructurePlan({ expectedDocumentPath, plan,
    confirmationId: plan.confirmationId, confirmationText: 'APPLY_CONFIRMED_STRUCTURE_PLAN' });
  assert.deepEqual(Array.from(applied.containers, (entry) => entry.layerId), ['900', '901']);
  assert.deepEqual(root.layers.map((item) => Array.from(item.layers, (child) => child.id)), [[3, 4], [5, 6]]);
  assert.equal(panel.stored.nodes['900'].semantic, 'group');
  assert.equal(panel.stored.nodes['901'].structure, null);
  assert.equal(panel.stored.document.id, stored.document.id);
  assert.equal(panel.stored.nodes['3'].id, stored.nodes['3'].id);
  assert.deepEqual(panel.stored.nodes['2'].structure.roles.map((role) => [role.name, role.layerId]),
    [['background', '3'], ['on-graphic', '5']]);
  await automation.execute({ expectedDocumentPath, command: 'set-visual-states', input: {
    layerId: '2', visualStates: { defaultState: 'normal', states: applied.containers.map((entry, index) => ({
      name: index === 0 ? 'normal' : 'selected', layerId: entry.layerId
    })) }
  } });
  const prepared = await panel.sandbox.prepareCurrentDocumentForExport();
  assert.deepEqual(Array.from(prepared.bundle.root.children[0].children, (node) => node.visible), ['enabled', 'disabled']);
  assert.deepEqual(panel.host.history, [true]);
});

test('state containers reject incomplete aliases and members before entering Photoshop history', async () => {
  const host = photoshopHost([layer(2, 'comm_sp_0001'), layer(3, '文字', 'text')]);
  const plan = containerPlan(host, [{ alias: '@state', name: '状态', members: ['2', '3'] }]);
  for (const container of [
    { alias: '', name: '状态', members: ['2'] },
    { alias: 'state', name: '状态', members: ['2'] },
    { alias: '@state', name: '', members: ['2'] },
    { alias: '@state', name: '状态', members: [] },
    { alias: '@state', name: '状态', members: ['2', '2'] },
    { alias: '@state', name: '状态', members: ['@future'] }
  ]) {
    await assert.rejects(host.api.applyConfirmedStructurePlan({ ...plan, containers: [container] }, async () => {}));
  }
  await assert.rejects(host.api.applyConfirmedStructurePlan({ ...plan, containers: [...plan.containers, ...plan.containers] }, async () => {}), /alias 重复/);
  assert.equal(host.modalCount, 0);
  assert.deepEqual(host.document.layers.map((item) => item.id), [2, 3]);
});

test('automation state container persistence failure restores Photoshop hierarchy and the saved manifest', async () => {
  const root = layer(2, '页签', 'group'); root.layers = [layer(3, 'comm_sp_0001'), layer(4, '文字', 'text')];
  const stored = sourceManifest([root]);
  const panel = await panelHarness([root], { stored, failWrite: true });
  const plan = containerPlan(panel.host, [{ alias: '@normal', name: '未选中', members: ['3', '4'] }]);
  await assert.rejects(panel.sandbox.__PSD2UI_DEV__.applyConfirmedStructurePlan({ expectedDocumentPath: panel.host.document.path,
    plan, confirmationId: plan.confirmationId, confirmationText: 'APPLY_CONFIRMED_STRUCTURE_PLAN'
  }), /模拟 PSD 保存失败/);
  assert.deepEqual(root.layers.map((item) => item.id), [3, 4]);
  assert.deepEqual(panel.stored, stored);
  assert.deepEqual(panel.host.history, [false]);
});

test('state container grouping checks coverage and same parent, and rolls back failed persistence', async () => {
  const root = layer(2, '页签', 'group'); root.layers = [layer(3, 'comm_sp_0001'), layer(4, '未选文字', 'text')];
  const outside = layer(5, 'comm_sp_0002');
  const host = photoshopHost([root, outside]);
  const plan = containerPlan(host, [{ alias: '@normal', name: '未选中', members: ['3', '4'] }]);
  await assert.rejects(host.api.applyConfirmedStructurePlan({ ...plan, preconditions: plan.preconditions.slice(0, 1) }, async () => {}), /缺少现有图层前置条件/);
  assert.equal(host.modalCount, 0);
  const mixedParent = containerPlan(host, [{ alias: '@bad', name: '状态', members: ['3', '5'] }]);
  await assert.rejects(host.api.applyConfirmedStructurePlan(mixedParent, async () => {}), /不在同一父级/);
  await assert.rejects(host.api.applyConfirmedStructurePlan(plan, async () => { throw new Error('sidecar write failed'); }), /sidecar write failed/);
  assert.deepEqual(root.layers.map((item) => item.id), [3, 4]);
  assert.deepEqual(host.document.layers.map((item) => item.id), [2, 5]);
  assert.deepEqual(host.history, [false, false]);
});

for (const options of [{ reverseChildren: true }, { moveBounds: true }]) {
  test(`state containers reject unexpected Photoshop readback ${Object.keys(options)[0]}`, async () => {
    const root = layer(2, '页签', 'group'); root.layers = [layer(3, 'comm_sp_0001'), layer(4, '未选文字', 'text')];
    const host = photoshopHost([root], options);
    const plan = containerPlan(host, [{ alias: '@normal', name: '未选中', members: ['3', '4'] }]);
    let persisted = false;
    await assert.rejects(host.api.applyConfirmedStructurePlan(plan, async () => { persisted = true; }), /叠放顺序|前置条件不符/);
    assert.equal(persisted, false);
    assert.deepEqual(root.layers.map((item) => item.id), [3, 4]);
    assert.deepEqual(host.history, [false]);
  });
}
