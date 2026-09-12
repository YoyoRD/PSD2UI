'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describePreflightIssues } = require('../../Plus-ins/PSD2UI/src/preflightIssues');
const snapshot = { root: { layerId: 'document-root', name: '商店', children: [
  { layerId: '2', name: '左侧', children: [{ layerId: '3', name: '背景', kind: 'pixel', children: [] }] },
  { layerId: '4', name: '右侧', children: [{ layerId: '5', name: '背景', kind: 'pixel', children: [] }] }
] } };
const manifest = { document: { rootLayerId: 'document-root' }, nodes: {
  '3': { id: 'node-left', name: '背景', image: { resourceId: 'shared' } },
  '5': { id: 'node-right', name: '背景', image: { resourceId: 'shared' } }
}, resourceRegistry: { resources: { shared: { sourceLayerId: '3' } } } };

test('validation paths and node identities distinguish same-named layers by full path', () => {
  const rows = describePreflightIssues({ issues: [
    { path: 'nodes.3.image.sliceBorder', code: 'SLICE', message: '边距无效' },
    { nodeId: 'node-right', code: 'STRUCTURE', message: '角色失效' }
  ] }, manifest, snapshot);
  assert.equal(rows[0].layers[0].path, '商店 / 左侧 / 背景');
  assert.equal(rows[1].layers[0].path, '商店 / 右侧 / 背景');
});

test('a resource conflict exposes both layer targets and resource paths resolve all owners', () => {
  const error = new Error('资源类型冲突'); error.code = 'CONFLICT'; error.details = { layerId: '3', otherLayerId: '5' };
  const rows = describePreflightIssues(error, manifest, snapshot);
  assert.deepEqual(rows[0].layers.map(layer => layer.id), ['3', '5']);
  assert.equal(rows[0].message, '资源类型冲突');
  const validation = describePreflightIssues({ issues: [{ path: 'resourceRegistry.resources.shared.kind', message: '类型无效' }] }, manifest, snapshot);
  assert.deepEqual(validation[0].layers.map(layer => layer.id), ['3', '5']);
});

test('deleted layers and document-level errors never receive a locator', () => {
  const rows = describePreflightIssues({ issues: [
    { layerId: '999', message: '引用已失效' },
    { path: 'document.rootLayerId', message: '根配置无效' },
    { message: '输出目录不可写' }
  ] }, manifest, snapshot);
  assert.equal(rows[0].layers[0].canLocate, false);
  assert.equal(rows[1].layers[0].canLocate, false);
  assert.deepEqual(rows[2].layers, []);
});
