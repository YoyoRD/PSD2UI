'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeAuthoringCommand, planStructuredGroup, planCollectionLayout,
  prepareManifestForExport, buildBundle } = require('../../Core');

function image(id, height = 403, name = `comm_sp_${String(id).padStart(4, '0')}`) {
  return { layerId: String(id), name, kind: 'pixel', visible: true,
    bounds: { left: 0, top: 0, right: 995, bottom: height }, children: [] };
}
function group(id, children, height = 403) {
  return { ...image(id, height), kind: 'group', name: `组${id}`,
    children: children.map(child => ({ ...child, parentId: String(id) })) };
}
function run(manifest, command, input, actor = 'mcp') {
  return executeAuthoringCommand(manifest, { command, input }, { actor }).manifest;
}
function fixture(semantic = 'list') {
  const items = [403, 357, 359, 321].map((height, index) => group(index + 3, [image(index + 30, height)], height));
  const collection = group(2, [...items, image(8, 10)]);
  const root = group(1, [collection]);
  let manifest = run(null, 'initialize-document', {
    name: '超值礼包', module: 'chongzhi', resourceNaming: 'source', rootLayerId: '1',
    width: 995, height: 2000, snapshot: { root }
  });
  for (const item of items) {
    const plan = planStructuredGroup('button', item);
    manifest = run(manifest, 'apply-structured-group', {
      layerId: item.layerId, name: item.name, semantic: 'button', structure: plan.structure
    }, 'human-panel');
  }
  const layout = semantic === 'list'
    ? { direction: 'vertical', itemWidth: 995, itemHeight: 403, spacing: 22 }
    : { cellWidth: 995, cellHeight: 403, columns: 1, rows: 1, horizontalSpacing: 0, verticalSpacing: 22 };
  const plan = planStructuredGroup(semantic, collection, { templateLayerId: '3', layout });
  manifest = run(manifest, 'apply-structured-group', {
    layerId: '2', name: collection.name, semantic, structure: plan.structure
  }, 'human-panel');
  return { manifest, root, collection, items, layout };
}
function setPreviews(manifest, root, previewLayerIds = ['4', '5', '6']) {
  return run(manifest, 'set-collection-previews', { layerId: '2', previewLayerIds, snapshot: { root } });
}

for (const semantic of ['list', 'grid']) {
  test(`${semantic} MCP 明确排除不同尺寸条目，保留模板、布局和其他运行时内容`, () => {
    const { manifest, root, layout } = fixture(semantic);
    const before = JSON.stringify(manifest);
    const snapshotBefore = JSON.stringify(root);
    manifest.nodes['2'].structure.layoutSource = 'inferred';
    const result = setPreviews(manifest, root);
    assert.deepEqual(result.nodes['2'].structure.previewLayerIds, ['4', '5', '6']);
    assert.equal(result.nodes['2'].structure.layoutSource, 'explicit');
    assert.deepEqual(result.nodes['2'].structure.layout, layout);
    for (const id of ['3', '4', '5', '6', '8', '30', '31', '32', '33']) {
      assert.deepEqual(result.nodes[id], manifest.nodes[id]);
    }
    assert.equal(result.revision, manifest.revision + 1);
    assert.equal(JSON.stringify(root), snapshotBefore);
    const prepared = prepareManifestForExport(result, { root });
    assert.deepEqual(prepared.diagnostics.filter(entry => entry.severity === 'error'), []);
    for (const id of ['31', '32', '33']) assert.equal(prepared.manifest.resourceRegistry.layerBindings[id], undefined);
    const bundle = buildBundle(prepared.manifest, { root });
    assert.deepEqual(bundle.root.children[0].children.map(node => node.sourceLayerId), ['3', '8']);
    assert.deepEqual(bundle.resources.map(resource => resource.fileName).sort(), ['comm_sp_0008.png', 'comm_sp_0030.png']);
    assert.equal(bundle.root.children[0].children[0].semantic, 'button');
    assert.deepEqual(bundle.root.children[0].structure.layout, layout);
    manifest.nodes['2'].structure.layoutSource = 'explicit';
    assert.equal(JSON.stringify(manifest), before);
  });
}

test('仅预览不放宽自动布局推导，也不据尺寸差异自动选择其他图层', () => {
  const { manifest, root, items } = fixture();
  assert.throws(() => planCollectionLayout('list', items), error => error.code === 'PSD2UI_STRUCTURE_SIZE_MISMATCH');
  const result = setPreviews(manifest, root, ['4']);
  const bundle = buildBundle(result, { root });
  assert.deepEqual(bundle.root.children[0].children.map(node => node.sourceLayerId), ['3', '5', '6', '8']);
  assert.equal(bundle.resources.some(resource => resource.fileName === 'comm_sp_0032.png'), true);
});

test('仅预览保留历史资源与组件设置，清除后可以恢复运行时导出', () => {
  const { manifest, root } = fixture();
  const allocated = prepareManifestForExport(manifest, { root }).manifest;
  const resourceId = allocated.resourceRegistry.layerBindings['31'];
  assert.ok(resourceId);
  const excluded = setPreviews(allocated, root);
  assert.deepEqual(excluded.resourceRegistry, allocated.resourceRegistry);
  assert.equal(buildBundle(excluded, { root }).resources.some(resource => resource.id === resourceId), false);
  const restored = setPreviews(excluded, root, []);
  const bundle = buildBundle(restored, { root });
  assert.equal(bundle.resources.some(resource => resource.id === resourceId), true);
  assert.equal(restored.nodes['4'].semantic, 'button');
});

test('模板、非组、重复、跨组件内部和组件外图层不能设为预览', () => {
  const { manifest, root } = fixture();
  for (const ids of [['3'], ['8'], ['4', '4'], ['31'], ['1'], ['2'], ['missing']]) {
    const before = JSON.stringify(manifest);
    assert.throws(() => setPreviews(manifest, root, ids), error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_INVALID');
    assert.equal(JSON.stringify(manifest), before);
  }
});

test('模板祖先或跨父级预览被拒绝，内部子组件不能被外部集合穿透', () => {
  const { manifest, root, collection } = fixture();
  const wrapper = group(20, [collection.children[0]]);
  collection.children[0] = { ...wrapper, parentId: '2' };
  root.children[0] = collection;
  for (const ids of [['20'], ['4']]) {
    assert.throws(() => setPreviews(manifest, root, ids), error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_INVALID');
  }
  const nested = group(21, [image(40)]);
  collection.children[1].children.push({ ...nested, parentId: '4' });
  assert.throws(() => setPreviews(manifest, root, ['21']), error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_INVALID');
});

test('仍被运行时视觉状态或角色引用的预览子树不能被排除', () => {
  const { manifest, root } = fixture();
  const states = run(manifest, 'set-visual-states', { layerId: '2', visualStates: {
    defaultState: 'normal', states: [{ name: 'normal', layerId: '3' }, { name: 'selected', layerId: '4' }]
  } });
  assert.throws(() => setPreviews(states, root), error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_REFERENCED'
    && error.details.ownerLayerId === '2' && error.details.targetLayerId === '4');
  const roleReference = JSON.parse(JSON.stringify(manifest));
  roleReference.nodes['1'].structure = { version: 1, roles: [{ name: 'background', layerId: '31' }] };
  assert.throws(() => setPreviews(roleReference, root), error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_REFERENCED'
    && error.details.targetLayerId === '31');
});

test('仅预览命令需要当前快照、明确数组及已有集合布局', () => {
  const { manifest, root } = fixture();
  assert.throws(() => run(manifest, 'set-collection-previews', { layerId: '2', previewLayerIds: [] }),
    error => error.code === 'PSD2UI_SNAPSHOT_REQUIRED');
  assert.throws(() => run(manifest, 'set-collection-previews', { layerId: '2', snapshot: { root } }),
    error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_INVALID');
  assert.throws(() => setPreviews(manifest, { ...root, layerId: '99' }),
    error => error.code === 'PSD2UI_SNAPSHOT_ROOT_MISMATCH');
  assert.throws(() => run(manifest, 'set-collection-previews', { layerId: '3', previewLayerIds: [], snapshot: { root } }),
    error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_NODE_INVALID');
  const missingLayout = JSON.parse(JSON.stringify(manifest));
  delete missingLayout.nodes['2'].structure.layout;
  assert.throws(() => setPreviews(missingLayout, root), error => error.code === 'PSD2UI_STRUCTURE_LAYOUT_INVALID');
});

test('完整 PSD 快照可包含虚拟文档根，配置范围仍限定在已初始化根内', () => {
  const { manifest, root } = fixture();
  const wholeDocument = group('document-root', [root, group(100, [image(101)])]);
  const result = setPreviews(manifest, wholeDocument);
  assert.deepEqual(result.nodes['2'].structure.previewLayerIds, ['4', '5', '6']);
  const stale = JSON.parse(JSON.stringify(manifest));
  stale.nodes['100'] = { ...stale.nodes['2'], layerId: '100' };
  assert.throws(() => run(stale, 'set-collection-previews', {
    layerId: '100', previewLayerIds: [], snapshot: { root: wholeDocument }
  }), error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_NODE_INVALID');
});
