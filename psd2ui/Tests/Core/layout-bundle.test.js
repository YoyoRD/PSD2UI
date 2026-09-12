'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBundle, executeAuthoringCommand, planStructure } = require('../../Core');
const { layoutFixture } = require('./fixtures/structured-layout');

for (const semantic of ['list', 'grid']) {
  test(`${semantic} 分析布局完整导出至 1.4，模板保留且预览子树剪枝`, () => {
    const fixture = layoutFixture(semantic);
    const preview = fixture.snapshot.root.children[0].children[1];
    preview.children.push({ layerId: 90, name: 'PreviewText', kind: 'text', parentId: preview.layerId,
      bounds: { left: 0, top: 0, right: 20, bottom: 10 }, children: [] });
    const bundle = fixture.bundle();
    const node = bundle.root.children[0];
    assert.equal(bundle.schemaVersion, '1.4.0');
    assert.deepEqual(node.structure.layout, fixture.layout);
    assert.equal(node.structure.roles[0].nodeId, node.children[0].id);
    assert.equal(node.structure.roles[0].name, semantic === 'list' ? 'item-template' : 'cell-template');
    assert.deepEqual(node.children.map(child => child.name), ['ItemTemplate']);
    assert.equal(JSON.stringify(bundle).includes('PreviewText'), false);
  });
}

test('导出按当前样例重算布局，旧 Manifest 不丢失可恢复的 layout', () => {
  const fixture = layoutFixture();
  delete fixture.manifest.nodes['2'].structure.layout;
  const second = fixture.snapshot.root.children[0].children[1];
  second.bounds.top = 50; second.bounds.bottom = 80;
  assert.equal(fixture.bundle().root.children[0].structure.layout.spacing, 20);
});

test('仅剩模板时沿用明确布局，没有旧布局则要求重新结构化', () => {
  const fixture = layoutFixture();
  fixture.snapshot.root.children[0].children.pop();
  assert.deepEqual(fixture.bundle().root.children[0].structure.layout, fixture.layout);
  delete fixture.manifest.nodes['2'].structure.layout;
  assert.throws(() => fixture.bundle(), error => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT');
});

test('模板尺寸改变且缺少样例时不静默使用旧布局', () => {
  const fixture = layoutFixture();
  fixture.snapshot.root.children[0].children.pop();
  fixture.snapshot.root.children[0].children[0].bounds.right += 0.1;
  assert.throws(() => fixture.bundle(), error => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT'
    && error.details.diagnostics.some(item => item.code === 'PSD2UI_STRUCTURE_LAYOUT_STALE'));
});

test('模板尺寸只允许不超过 0.01px 的浮点误差', () => {
  const fixture = layoutFixture();
  fixture.snapshot.root.children[0].children.pop();
  fixture.snapshot.root.children[0].children[0].bounds.right += 0.005;
  assert.equal(fixture.bundle().schemaVersion, '1.4.0');
});

test('Grid 不允许规则排列但相邻重叠的 Cell', () => {
  const cell = (layerId, left) => ({ layerId, kind: 'group', parentId: 1,
    bounds: { left, top: 0, right: left + 20, bottom: 10 } });
  assert.throws(() => planStructure('grid', [cell(2, 0), cell(3, 10)], { templateLayerId: 2, previewLayerIds: [3] }),
    error => error.code === 'PSD2UI_STRUCTURE_OVERLAP_INVALID');
});

test('IgnoreSubtree 不输出后代节点或资源，也不被后代未完成组件阻断', () => {
  const fixture = layoutFixture();
  const ignored = fixture.snapshot.root.children[0];
  ignored.children.push({ layerId: 91, name: 'HiddenPixels', kind: 'pixel', parentId: 2,
    bounds: { left: 0, top: 0, right: 20, bottom: 10 }, children: [] });
  fixture.manifest = executeAuthoringCommand(fixture.manifest, { command: 'apply-node-preset',
    input: { layerId: 2, name: 'IgnoredEntries', semantic: 'ignore' } }, { actor: 'human-panel' }).manifest;
  fixture.manifest = executeAuthoringCommand(fixture.manifest, { command: 'apply-node-preset',
    input: { layerId: 3, name: 'IncompleteButton', semantic: 'button' } }, { actor: 'human-panel' }).manifest;
  const bundle = buildBundle(fixture.manifest, fixture.snapshot);
  assert.deepEqual(bundle.root.children, []);
  assert.deepEqual(bundle.resources, []);
});
