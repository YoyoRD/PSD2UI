'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../Core');

function fixture() {
  const layer = (layerId, width, height) => ({ layerId: String(layerId), name: 'comm_sp_0031', kind: 'pixel',
    bounds: { left: layerId * 100, top: 10, right: layerId * 100 + width, bottom: 10 + height },
    visible: layerId !== 3, opacity: layerId === 3 ? 0.5 : 1, children: [] });
  const snapshot = { root: { layerId: '1', name: '测试界面', kind: 'group',
    bounds: { left: 0, top: 0, right: 720, bottom: 1560 },
    children: [layer(2, 80, 80), layer(3, 120, 34), layer(4, 360, 80)] } };
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    name: '测试界面', module: 'main', resourceNaming: 'source', rootLayerId: '1', rootLayerName: '测试界面',
    width: 720, height: 1560, snapshot
  } }, { actor: 'human-panel' }).manifest;
  ['2', '3', '4'].forEach(id => Object.assign(manifest.nodes[id], { authoringSource: 'explicit',
    image: { ...manifest.nodes[id].image, imageType: 'sliced',
      sliceBorder: { left: 10, top: 10, right: 10, bottom: 10 } } }));
  return { manifest, snapshot };
}
function choose(manifest, snapshot, layerId = '2', clear = false) {
  return core.executeAuthoringCommand(manifest, { command: 'set-shared-nine-slice-source',
    input: { snapshot, layerId, clear } }, { actor: 'human-panel' }).manifest;
}

test('共用九宫保存后往返只指定一个源图，各节点保留布局显隐透明度', () => {
  const { manifest, snapshot } = fixture();
  const selected = choose(manifest, snapshot);
  assert.equal(Object.keys(manifest.resourceRegistry.resources).length, 0, 'command must not mutate input');
  const bundle = core.buildBundle(JSON.parse(JSON.stringify(selected)), snapshot);
  assert.equal(bundle.resources.length, 1);
  assert.equal(bundle.resources[0].exportSourceLayerId, '2');
  assert.equal(bundle.resources[0].sourceLayerId, '2');
  assert.deepEqual(bundle.resources[0].sourceLayerIds, ['2', '3', '4']);
  assert.deepEqual(bundle.root.children.map(n => [n.rect.width, n.rect.height]), [[80, 80], [120, 34], [360, 80]]);
  assert.equal(bundle.root.children[1].visible, 'disabled');
  assert.equal(bundle.root.children[1].opacity, 0.5);
  assert.equal(new Set(bundle.root.children.map(n => n.image.resourceId)).size, 1);
});

test('源图边距统一投影；引用尺寸小于固定边距仍保留其原始尺寸', () => {
  const { manifest, snapshot } = fixture();
  const selected = choose(manifest, snapshot);
  selected.nodes['2'].image.sliceBorder = { left: 20, top: 20, right: 20, bottom: 20 };
  const bundle = core.buildBundle(selected, snapshot);
  assert.equal(bundle.root.children[1].rect.height, 34);
  assert.ok(bundle.root.children.every(n => n.image.sliceBorder.top === 20));
  assert.equal(bundle.resources[0].sliceBorder.top, 20);
});

for (const mutation of ['delete', 'rename', 'ignore', 'preview', 'simple']) {
  test(`共用源图 ${mutation} 时阻断且不悄悄更换来源`, () => {
    const { manifest, snapshot } = fixture();
    const selected = choose(manifest, snapshot);
    if (mutation === 'delete') snapshot.root.children.shift();
    if (mutation === 'rename') snapshot.root.children[0].name = 'comm_sp_0099';
    if (mutation === 'ignore') selected.nodes['2'].semantic = 'ignore';
    if (mutation === 'preview') selected.nodes['2'].exportMode = 'preview-only';
    if (mutation === 'simple') selected.nodes['2'].image.imageType = 'simple';
    assert.throws(() => core.buildBundle(selected, snapshot), /指定源图/);
  });
}

test('可以从引用层取消或更换源图，取消后恢复原有一致性检查', () => {
  const { manifest, snapshot } = fixture();
  const selected = choose(manifest, snapshot);
  const replaced = choose(selected, snapshot, '4');
  assert.equal(core.buildBundle(replaced, snapshot).resources[0].exportSourceLayerId, '4');
  const cleared = choose(replaced, snapshot, '3', true);
  assert.equal(core.buildBundle(cleared, snapshot).resources[0].exportSourceLayerId, undefined);
  cleared.nodes['3'].image.sliceBorder.left = 12;
  assert.throws(() => core.buildBundle(cleared, snapshot), /不同九宫参数/);
});

test('普通图片不能被指定为九宫源图', () => {
  const { manifest, snapshot } = fixture();
  manifest.nodes['2'].image.imageType = 'simple';
  assert.throws(() => choose(manifest, snapshot), /保存为九宫格/);
});

for (const singleSource of [false, true]) {
  test(`指定源图${singleSource ? '独占资源' : '和所有引用一起'}改名仍阻断，明确换源或取消后可恢复`, () => {
    const { manifest, snapshot } = fixture();
    if (singleSource) snapshot.root.children = snapshot.root.children.filter(layer => layer.layerId === '3');
    const selected = choose(manifest, snapshot, '3');
    snapshot.root.children.forEach(layer => { layer.name = 'comm_sp_0099'; });
    assert.throws(() => core.buildBundle(selected, snapshot), error => error.code === 'PSD2UI_SHARED_SLICE_SOURCE_INVALID');
    const replaced = choose(selected, snapshot, singleSource ? '3' : '4');
    const changed = core.buildBundle(replaced, snapshot);
    assert.equal(changed.resources[0].fileName, 'comm_sp_0099.png');
    assert.equal(changed.resources[0].exportSourceLayerId, singleSource ? '3' : '4');
    const cleared = choose(selected, snapshot, '3', true);
    assert.equal(core.buildBundle(cleared, snapshot).resources[0].exportSourceLayerId, undefined);
    assert.equal(Object.values(selected.resourceRegistry.resources).find(r => r.status === 'active').fileName, 'comm_sp_0031.png');
  });
}

test('仅引用图层改名不会改变剩余资源的指定源图', () => {
  const { manifest, snapshot } = fixture();
  const selected = choose(manifest, snapshot, '3');
  snapshot.root.children[0].name = 'comm_sp_0099';
  const bundle = core.buildBundle(selected, snapshot);
  assert.equal(bundle.resources.find(r => r.fileName === 'comm_sp_0031.png').exportSourceLayerId, '3');
  assert.equal(bundle.resources.find(r => r.fileName === 'comm_sp_0099.png').exportSourceLayerId, undefined);
});

for (const ancestor of [false, true]) for (const excluded of ['ignore', 'preview-only']) {
  test(`不能指定${ancestor ? '祖先' : '自身'}为 ${excluded} 的图层，失败保留原指定源`, () => {
    const { manifest, snapshot } = fixture();
    let selected = choose(manifest, snapshot, '3');
    let excludedId = '2';
    if (ancestor) {
      const child = snapshot.root.children[0];
      snapshot.root.children[0] = { layerId: '5', name: '容器', kind: 'group', bounds: child.bounds, children: [child] };
      selected = core.executeAuthoringCommand(selected, { command: 'apply-node-preset',
        input: { layerId: '5', name: '容器', semantic: 'group' } }, { actor: 'human-panel' }).manifest;
      excludedId = '5';
    }
    if (excluded === 'ignore') selected.nodes[excludedId].semantic = 'ignore';
    else selected.nodes[excludedId].exportMode = 'preview-only';
    assert.throws(() => choose(selected, snapshot, '2'), error => error.code === 'PSD2UI_SHARED_SLICE_SOURCE_INVALID');
    assert.equal(Object.values(selected.resourceRegistry.resources).find(r => r.status === 'active').exportSourceLayerId, '3');
  });
}
