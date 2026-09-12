'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../Core');

function layer(id, name, kind = 'pixel', children = []) {
  return { layerId: id, name, kind, children, bounds: { left: 0, top: 0, right: 80, bottom: 60 } };
}
function create(children) {
  const snapshot = { root: layer(1, '中文 窗口', 'group', children) };
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    module: 'document', resourceNaming: 'source', name: '中文 窗口', rootLayerId: 1,
    rootLayerName: '中文 窗口', width: 80, height: 60, snapshot
  } }, { actor: 'human-panel' }).manifest;
  return { snapshot, manifest };
}

test('正式图片名保持原拼写和分组，所有旧后缀不产生语义', () => {
  const names = ['comm_sp_0017@unpack', 'comm_bt_0032@anniu@anything', 'buildicon_000_6',
    'i_diamond_small', 'head_soul_bust_0001'];
  const { manifest, snapshot } = create(names.map((name, index) => layer(index + 2, name)));
  const bundle = core.buildBundle(manifest, snapshot);
  assert.equal(bundle.schemaVersion, '1.5.0');
  assert.deepEqual(bundle.resources.map((item) => item.fileName).sort(),
    names.map((name) => `${name.split('@')[0]}.png`).sort());
  assert.ok(bundle.resources.every((item) => item.scope === 'module'));
  assert.equal(bundle.resources.find((item) => item.fileName === 'comm_sp_0017.png').module, 'comm');
  assert.ok(bundle.root.children.every((node) => node.semantic === 'image'));
  assert.ok(bundle.root.children.every((node) => !node.name.includes('@')));
  assert.ok(bundle.resources.every((item) => item.sourceLayerIds.includes(item.sourceLayerId)));
});

test('中文文字、数字组名通过，错误图片诊断包含layerId和定位路径', () => {
  const { manifest, snapshot } = create([layer(2, '123', 'group', [layer(3, '领取奖励', 'text')]),
    layer(4, '滚动列表@gundong', 'other')]);
  const report = core.preflightBundle(manifest, snapshot);
  assert.equal(report.status, 'blocked');
  assert.equal(report.bundle, null);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].layerId, '4');
  assert.equal(report.issues[0].path, 'root.children[1].name');
  assert.equal(report.issues[0].code, 'PSD2UI_IMAGE_NAME_INVALID');
  snapshot.root.children[1].name = 'comm_sp_0020@任意旧后缀';
  const valid = core.preflightBundle(manifest, snapshot);
  assert.equal(valid.status, 'ready', JSON.stringify(valid.issues));
  assert.equal(valid.bundle.root.children[0].name, '123');
  assert.equal(valid.bundle.root.children[0].children[0].name, '领取奖励');
});

test('同名图片保留每个候选来源供实际像素检查，不假称已验证', () => {
  const { manifest, snapshot } = create([layer(2, 'comm_bt_0032'), layer(3, 'comm_bt_0032@old')]);
  const prepared = core.prepareManifestForExport(manifest, snapshot);
  const bundle = core.buildBundle(prepared.manifest, snapshot);
  assert.equal(bundle.resources.length, 1);
  assert.deepEqual(bundle.resources[0].sourceLayerIds, ['2', '3']);
  assert.equal(bundle.root.children[0].image.resourceId, bundle.root.children[1].image.resourceId);
  assert.equal(bundle.resources[0].contentVerified, undefined);
  snapshot.root.children[1].name = 'comm_bt_0077';
  const renamed = core.buildBundle(prepared.manifest, snapshot);
  assert.equal(renamed.resources.length, 2);
  assert.deepEqual(renamed.resources.map((resource) => resource.fileName).sort(), ['comm_bt_0032.png', 'comm_bt_0077.png']);
});

test('单层改名保持资源id，改变分组不隐式改写图片编号', () => {
  const { manifest, snapshot } = create([layer(2, 'comm_sp_0246')]);
  const prepared = core.prepareManifestForExport(manifest, snapshot);
  const first = core.buildBundle(prepared.manifest, snapshot).resources[0];
  snapshot.root.children[0].name = 'baoleizhengduo_bt_9998@foo';
  const second = core.buildBundle(prepared.manifest, snapshot).resources[0];
  assert.equal(first.id, second.id);
  assert.equal(second.fileName, 'baoleizhengduo_bt_9998.png');
  assert.equal(second.module, 'baoleizhengduo');
});

test('拒绝会产生Windows大小写文件冲突的两个不同图片名', () => {
  const { manifest, snapshot } = create([layer(2, 'comm_sp_0017'), layer(3, 'comm_SP_0017')]);
  const result = core.preflightBundle(manifest, snapshot);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issues[0].code, 'PSD2UI_RESOURCE_NAME_CONFLICT');
  assert.equal(result.issues[0].layerId, '3');
});

test('状态组仅控制默认可见性，隐藏状态的图片与像素来源仍完整导出', () => {
  const { manifest, snapshot } = create([
    layer(2, '未选中', 'group', [layer(4, 'comm_sp_0017')]),
    layer(3, '选中', 'group', [layer(5, 'comm_sp_0017@old')])
  ]);
  manifest.nodes['1'].visualStates = { defaultState: 'selected', states: [
    { name: 'normal', layerId: '2' }, { name: 'selected', layerId: '3' }
  ] };
  const bundle = core.buildBundle(manifest, snapshot);
  assert.equal(bundle.root.children[0].visible, 'disabled');
  assert.equal(bundle.root.children[1].visible, 'enabled');
  assert.equal(bundle.root.children[0].children.length, 1);
  assert.deepEqual(bundle.resources[0].sourceLayerIds, ['4', '5']);
  assert.equal(bundle.root.visualStates.states[1].nodeId, bundle.root.children[1].id);
  assert.equal(bundle.root.visualStates.defaultState, 'selected');
});

test('旧manifest主动升级为source草稿，保留身份和历史且不修改原对象', () => {
  const snapshot = { root: layer(1, 'LegacyView', 'group', [layer(2, 'comm_bt_0032')]) };
  const original = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    module: 'login', name: 'LegacyView', rootLayerId: 1, rootLayerName: 'LegacyView', width: 80, height: 60, snapshot
  } }, { actor: 'human-panel' }).manifest;
  const legacy = core.prepareManifestForExport(original, snapshot).manifest;
  const legacyBundle = core.buildBundle(legacy, snapshot);
  const before = JSON.stringify(legacy);
  const upgraded = core.prepareSourceManifest(legacy, snapshot).manifest;
  const newBundle = core.buildBundle(upgraded, snapshot);
  assert.equal(newBundle.document.id, legacyBundle.document.id);
  assert.equal(newBundle.root.children[0].id, legacyBundle.root.children[0].id);
  assert.equal(newBundle.resources[0].id, legacyBundle.resources[0].id);
  assert.equal(newBundle.resources[0].fileName, 'comm_bt_0032.png');
  assert.equal(upgraded.resourceRegistry.resources[newBundle.resources[0].id].history[0].fileName, 'login_sp_0001.png');
  assert.equal(JSON.stringify(legacy), before);
});

test('明确忽略的子树无需资源名，普通隐藏图片仍受图片命名检查', () => {
  const { manifest, snapshot } = create([layer(2, '辅助参考', 'group', [layer(3, '原始参考图')]),
    layer(4, 'comm_sp_0017')]);
  manifest.nodes['2'].semantic = 'ignore';
  const report = core.preflightBundle(manifest, snapshot);
  assert.equal(report.status, 'ready', JSON.stringify(report.issues));
  assert.equal(report.bundle.root.children.length, 1);
  assert.equal(report.bundle.resources.length, 1);
  snapshot.root.children[1].name = '隐藏但需导出的错误图片';
  snapshot.root.children[1].visible = false;
  const invalid = core.preflightBundle(manifest, snapshot);
  assert.equal(invalid.status, 'blocked');
  assert.equal(invalid.issues[0].layerId, '4');
});

test('ignored状态配置既不阻断导出，也不能改变其他组的可见性', () => {
  const { manifest, snapshot } = create([layer(2, '忽略的状态组', 'group'),
    layer(3, '正常组', 'group', [layer(4, 'comm_sp_0017')])]);
  manifest.nodes['2'].semantic = 'ignore';
  snapshot.root.children[1].visible = false;
  manifest.nodes['2'].visualStates = { defaultState: 'normal', states: [{ name: 'normal', layerId: '3' }] };
  assert.equal(core.buildBundle(manifest, snapshot).root.children[0].visible, 'disabled');
  manifest.nodes['2'].visualStates.states[0].layerId = '999';
  assert.equal(core.preflightBundle(manifest, snapshot).status, 'ready');
  manifest.nodes['2'].structure = { version: 1, roles: [], previewLayerIds: ['4'] };
  snapshot.root.children[1].children[0].name = '错误图片';
  assert.equal(core.collectInvalidImageLayerNames(snapshot, manifest)[0].layerId, '4');
});

test('ignored旧图片保留审计记录但不参与此次输出命名和类型冲突', () => {
  const created = create([layer(2, '忽略组', 'group', [layer(3, 'comm_sp_0003')]), layer(4, 'comm_sp_0004')]);
  let manifest = core.executeAuthoringCommand(created.manifest, { command: 'apply-node-preset',
    input: { layerId: 3, name: 'comm_sp_0003', semantic: 'raw-image' } }, { actor: 'human-panel' }).manifest;
  manifest = core.prepareManifestForExport(manifest, created.snapshot).manifest;
  const originalId = manifest.nodes['3'].rawImage.resourceId;
  manifest.nodes['2'].semantic = 'ignore';
  created.snapshot.root.children[1].name = 'comm_sp_0003';
  const updated = core.prepareManifestForExport(manifest, created.snapshot).manifest;
  const bundle = core.buildBundle(updated, created.snapshot);
  assert.equal(bundle.resources.length, 1);
  assert.equal(bundle.resources[0].kind, 'sprite');
  assert.equal(bundle.resources[0].fileName, 'comm_sp_0003.png');
  assert.equal(updated.resourceRegistry.resources[originalId].kind, 'texture');
  assert.equal(updated.resourceRegistry.resources[originalId].fileName, 'comm_sp_0003.png');
});

test('其他活动图层已在PSD改名时，旧资源名不误阻断当前新归属', () => {
  const created = create([layer(2, 'comm_sp_0003'), layer(3, 'comm_sp_0004')]);
  let manifest = core.executeAuthoringCommand(created.manifest, { command: 'apply-node-preset',
    input: { layerId: 2, name: 'comm_sp_0003', semantic: 'raw-image' } }, { actor: 'human-panel' }).manifest;
  manifest = core.prepareManifestForExport(manifest, created.snapshot).manifest;
  created.snapshot.root.children[0].name = 'comm_sp_0005';
  created.snapshot.root.children[1].name = 'comm_sp_0003';
  created.snapshot.root.children.reverse();
  const bundle = core.buildBundle(manifest, created.snapshot);
  assert.equal(bundle.resources.find((resource) => resource.fileName === 'comm_sp_0003.png').kind, 'sprite');
  assert.equal(bundle.resources.find((resource) => resource.fileName === 'comm_sp_0005.png').kind, 'texture');
});
