'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../Core');
const { createPreset } = require('../../Core/defaults');

function layer(id, width, height, name = `comm_sp_${String(id).padStart(4, '0')}`) {
  return { layerId: String(id), name, kind: 'pixel', children: [],
    bounds: { left: 10, top: 20, right: 10 + width, bottom: 20 + height } };
}
function fixture(children, source = true) {
  const snapshot = { root: { ...layer(1, 720, 1560, 'TestView'), kind: 'group', children } };
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    name: 'TestView', module: 'document', ...(source ? { resourceNaming: 'source' } : {}),
    rootLayerId: 1, width: 720, height: 1560, snapshot
  } }, { actor: 'human-panel' }).manifest;
  return { manifest, snapshot };
}
function explicit(manifest, id, semantic) {
  manifest.nodes[id] = { ...manifest.nodes[id], ...createPreset(semantic) };
  if (semantic !== 'image') delete manifest.nodes[id].image;
  if (semantic !== 'raw-image') delete manifest.nodes[id].rawImage;
}

test('source auto classification uses area including the boundary, with a separate atlas side guard', () => {
  const examples = [
    [511, 512, 'sprite'], [512, 512, 'texture'], [1024, 255, 'sprite'], [1024, 256, 'texture'],
    [667, 128, 'sprite'], [629, 64, 'sprite'], [2040, 1, 'sprite'], [2041, 1, 'texture'],
    [1, 2041, 'texture'], [720, 1560, 'texture']
  ];
  const { manifest, snapshot } = fixture(examples.map(([w, h], i) => layer(i + 2, w, h)));
  const bundle = core.buildBundle(manifest, snapshot);
  for (const [i, [width, height, kind]] of examples.entries()) {
    const resource = bundle.resources.find(r => r.sourceLayerId === String(i + 2));
    assert.equal(resource.kind, kind, `${width} x ${height}`);
    assert.equal(bundle.root.children[i].semantic, kind === 'texture' ? 'raw-image' : 'image');
  }
  assert.equal(manifest.nodes['1'].semantic, 'view');
});

test('existing default images reclassify both ways with stable node/resource ids and no input mutation', () => {
  const image = layer(2, 100, 100);
  const { manifest, snapshot } = fixture([image]);
  const original = core.prepareManifestForExport(manifest, snapshot).manifest;
  const originalId = original.nodes['2'].image.resourceId;
  const before = JSON.stringify(original);
  image.bounds.right = 730; image.bounds.bottom = 1580;
  const updated = core.prepareManifestForExport(original, snapshot).manifest;
  const node = updated.nodes['2'];
  assert.equal(node.id, original.nodes['2'].id);
  assert.equal(node.semantic, 'raw-image');
  assert.equal(node.authoringSource, 'default');
  assert.equal(node.image, undefined);
  assert.equal(node.rawImage.resourceId, originalId);
  assert.equal(updated.resourceRegistry.resources[originalId].kind, 'texture');
  assert.equal(updated.resourceRegistry.resources[originalId].fileName, 'comm_sp_0002.png');
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(core.prepareManifestForExport(updated, snapshot).manifest, updated);
  image.bounds.right = 110; image.bounds.bottom = 120;
  const shrunk = core.prepareManifestForExport(updated, snapshot).manifest;
  assert.equal(shrunk.nodes['2'].semantic, 'image');
  assert.equal(shrunk.nodes['2'].image.resourceId, originalId);
  assert.equal(shrunk.resourceRegistry.resources[originalId].kind, 'sprite');
});

test('manual types and nine-slice settings take precedence over large bounds', () => {
  const { manifest, snapshot } = fixture([layer(2, 720, 1560), layer(3, 20, 20),
    layer(4, 720, 1560), layer(5, 720, 1560)]);
  explicit(manifest, '2', 'image');
  explicit(manifest, '3', 'raw-image');
  explicit(manifest, '4', 'button');
  // Legacy metadata can carry a nine-slice while still marked default.
  explicit(manifest, '5', 'image');
  manifest.nodes['5'].authoringSource = 'default';
  manifest.nodes['5'].image.imageType = 'sliced';
  manifest.nodes['5'].image.sliceBorder = { left: 8, right: 8, top: 8, bottom: 8 };
  const bundle = core.buildBundle(manifest, snapshot);
  assert.deepEqual(bundle.root.children.map(n => n.semantic), ['image', 'raw-image', 'button', 'image']);
  assert.deepEqual(bundle.resources.map(r => r.kind), ['sprite', 'texture', 'sprite', 'sprite']);
  assert.deepEqual(bundle.root.children[3].image.sliceBorder, manifest.nodes['5'].image.sliceBorder);
});

test('automatic projection preserves specialized image parameters and transfers common graphic settings', () => {
  const { manifest, snapshot } = fixture([layer(2, 100, 100), layer(3, 100, 100), layer(4, 720, 1560)]);
  manifest.nodes['2'].image.preserveAspect = 'enabled';
  manifest.nodes['3'].image.color = { r: 0.2, g: 0.4, b: 0.6, a: 1 };
  manifest.nodes['3'].image.raycast = 'enabled';
  manifest.nodes['4'].rawImage.uvRect.width = 0.5;
  for (const child of snapshot.root.children.slice(0, 2)) child.bounds.bottom = 4000;
  snapshot.root.children[2].bounds = layer(4, 20, 20).bounds;
  const projected = core.projectAutomaticImageSemantics(manifest, snapshot);
  assert.equal(projected.nodes['2'].semantic, 'image');
  assert.equal(projected.nodes['3'].semantic, 'raw-image');
  assert.deepEqual(projected.nodes['3'].rawImage.color, manifest.nodes['3'].image.color);
  assert.equal(projected.nodes['3'].rawImage.raycast, 'enabled');
  assert.equal(projected.nodes['4'].semantic, 'raw-image');
  assert.equal(projected.nodes['4'].rawImage.uvRect.width, 0.5);
});

test('existing required Toggle image roles remain Sprite after resizing without changing the owner', () => {
  const background = layer(3, 100, 100); const check = layer(4, 100, 100);
  const group = { ...layer(2, 720, 1560, '开关组'), kind: 'group', children: [background, check] };
  const { manifest, snapshot } = fixture([group]);
  explicit(manifest, '2', 'toggle');
  manifest.nodes['2'].authoringSource = 'structured';
  manifest.nodes['2'].structure = { version: 1, roles: [{ name: 'background', layerId: '3' },
    { name: 'on-graphic', layerId: '4' }], previewLayerIds: [] };
  background.bounds = layer(3, 720, 1560).bounds;
  check.bounds = layer(4, 512, 512).bounds;
  const bundle = core.buildBundle(manifest, snapshot);
  assert.equal(bundle.root.children[0].semantic, 'toggle');
  assert.ok(bundle.resources.every(r => r.kind === 'sprite'));
  assert.deepEqual(bundle.root.children[0].children.map(n => n.semantic), ['image', 'image']);
});

test('same-name shared default sprites change kind together without duplicating or replacing their resource', () => {
  const first = layer(2, 100, 100, 'comm_bg_0001');
  const second = layer(3, 100, 100, 'comm_bg_0001@unpack');
  const { manifest, snapshot } = fixture([first, second]);
  const original = core.prepareManifestForExport(manifest, snapshot).manifest;
  const id = original.nodes['2'].image.resourceId;
  first.bounds = second.bounds = layer(2, 720, 1560).bounds;
  const updated = core.prepareManifestForExport(original, snapshot).manifest;
  assert.equal(updated.nodes['2'].rawImage.resourceId, id);
  assert.equal(updated.nodes['3'].rawImage.resourceId, id);
  const bundle = core.buildBundle(updated, snapshot);
  assert.equal(bundle.resources.length, 1);
  assert.equal(bundle.resources[0].kind, 'texture');
  assert.deepEqual(bundle.resources[0].sourceLayerIds, ['2', '3']);
  assert.deepEqual(core.prepareManifestForExport(updated, snapshot).manifest, updated);
});

test('conflicting explicit types of shared resources remain actionable errors', () => {
  const { manifest, snapshot } = fixture([layer(2, 720, 1560, 'comm_bg_0001'),
    layer(3, 720, 1560, 'comm_bg_0001')]);
  explicit(manifest, '2', 'image');
  const report = core.preflightBundle(manifest, snapshot);
  assert.equal(report.status, 'blocked');
  assert.equal(report.issues[0].code, 'PSD2UI_RESOURCE_NAME_CONFLICT');
  assert.equal(report.issues[0].layerId, '3');
});

test('legacy numbered exports retain their side threshold, and old suffixes never classify source resources', () => {
  const { manifest, snapshot } = fixture([layer(2, 667, 128)], false);
  assert.equal(core.buildBundle(manifest, snapshot).resources[0].kind, 'texture');
  const source = fixture([layer(2, 667, 128, 'comm_bg_0001@unpack'), layer(3, 720, 1560, 'comm_bt_0001@image')]);
  const bundle = core.buildBundle(source.manifest, source.snapshot);
  assert.deepEqual(bundle.resources.map(r => r.kind), ['sprite', 'texture']);
  assert.deepEqual(bundle.resources.map(r => r.fileName), ['comm_bg_0001.png', 'comm_bt_0001.png']);
});
