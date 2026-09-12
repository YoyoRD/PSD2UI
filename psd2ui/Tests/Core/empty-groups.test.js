'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../Core');
const validBounds = { left: 0, top: 0, right: 80, bottom: 60 };
const emptyBounds = { left: NaN, top: NaN, right: NaN, bottom: NaN };
function layer(layerId, name, kind, children = [], bounds = validBounds) {
  return { layerId, name, kind, children, bounds };
}
function initialize(snapshot, resourceNaming = 'source') {
  return core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    module: 'document', ...(resourceNaming ? { resourceNaming } : {}), name: 'View', rootLayerId: 1,
    rootLayerName: 'View', width: 80, height: 60, snapshot
  } }, { actor: 'human-panel' }).manifest;
}

test('empty groups and nested empty directories export no nodes or resources and preserve authoring state', () => {
  for (const resourceNaming of ['source', 'allocated']) {
    const snapshot = { root: layer(1, 'View', 'group', [
      layer(2, 'Empty', 'group', [], emptyBounds),
      layer(3, 'Directory', 'group', [layer(4, 'NestedEmpty', 'group', [], emptyBounds)], emptyBounds),
      layer(5, 'ZeroBoundsEmpty', 'group', [], { left: 0, top: 0, right: 0, bottom: 0 }),
      layer(6, 'Content', 'group', [layer(7, 'comm_sp_0001', 'pixel')])
    ]) };
    // The legacy numbered mode does not declare a resourceNaming value.
    const manifest = initialize(snapshot, resourceNaming === 'source' ? 'source' : null);
    const before = JSON.stringify(manifest);
    const sourceBefore = structuredClone(snapshot);
    const report = core.preflightBundle(manifest, snapshot);
    assert.equal(report.status, 'ready', JSON.stringify(report.issues));
    assert.deepEqual(report.bundle.root.children.map(node => node.sourceLayerId), ['6']);
    assert.equal(report.bundle.resources.length, 1);
    assert.equal(report.bundle.root.children[0].children[0].sourceLayerId, '7');
    assert.equal(JSON.stringify(manifest), before);
    assert.deepEqual(snapshot, sourceBefore);
    assert.equal(manifest.nodes['2'].semantic, 'group');
    assert.equal(manifest.nodes['2'].authoringSource, 'default');
    snapshot.root.children = snapshot.root.children.slice(0, 3);
    const empty = core.preflightBundle(manifest, snapshot);
    assert.equal(empty.status, 'ready');
    assert.deepEqual(empty.bundle.root.children, []);
    assert.deepEqual(empty.bundle.resources, []);
    assert.equal(empty.bundle.root.semantic, 'view');
  }
});

test('adding content to a formerly empty group restores normal export and validation without resetting its preset', () => {
  const group = layer(2, 'Group', 'group', [], emptyBounds);
  const snapshot = { root: layer(1, 'View', 'group', [group]) };
  const manifest = initialize(snapshot);
  assert.deepEqual(core.buildBundle(manifest, snapshot).root.children, []);
  const nodeId = manifest.nodes['2'].id;
  group.children = [layer(3, 'comm_sp_0001', 'pixel')]; group.bounds = validBounds;
  const filled = core.buildBundle(manifest, snapshot);
  assert.equal(filled.root.children[0].id, nodeId);
  assert.equal(filled.root.children[0].children[0].sourceLayerId, '3');
  assert.equal(filled.resources.length, 1);
  group.children[0].name = 'bad image name';
  assert.equal(core.preflightBundle(manifest, snapshot).issues[0].code, 'PSD2UI_IMAGE_NAME_INVALID');
});

test('an explicitly configured empty component still reports its structural error', () => {
  const snapshot = { root: layer(1, 'View', 'group', [layer(2, 'Button', 'group', [], emptyBounds)]) };
  let manifest = initialize(snapshot);
  manifest = core.executeAuthoringCommand(manifest, { command: 'apply-node-preset', input: {
    layerId: 2, name: 'Button', semantic: 'button'
  } }, { actor: 'human-panel' }).manifest;
  const report = core.preflightBundle(manifest, snapshot);
  assert.equal(report.status, 'blocked');
  assert.ok(report.issues.some(issue => issue.code === 'PSD2UI_STRUCTURE_ROOT_EMPTY'));
  assert.equal(manifest.nodes['2'].semantic, 'button');
});
