'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../Core');

function fixture(layoutMode, resourceNaming = 'source') {
  const text = { value: '16:00', fontSize: 34, alignment: 'middle-center', lineSpacing: 1 };
  if (layoutMode !== undefined) text.layoutMode = layoutMode;
  const layer = { layerId: '2', name: 'TimeLabel', kind: 'text', text,
    bounds: { left: 10, top: 20, right: 82, bottom: 45 }, children: [] };
  const snapshot = { root: { layerId: '1', name: 'Panel', kind: 'group',
    bounds: { left: 0, top: 0, right: 400, bottom: 200 }, children: [layer] } };
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    module: 'document', ...(resourceNaming ? { resourceNaming } : {}),
    rootLayerId: '1', rootLayerName: 'Panel', name: 'Panel', width: 400, height: 200, snapshot
  } }, { actor: 'human-panel' }).manifest;
  return { manifest, snapshot, layer };
}

for (const mode of ['point', 'paragraph']) {
  test(`1.5 preserves explicit ${mode} text layout without changing font size or glyph bounds`, () => {
    const { manifest, snapshot } = fixture(mode);
    assert.equal(manifest.nodes['2'].text.layoutMode, mode);
    const bundle = core.buildBundle(manifest, snapshot);
    assert.equal(bundle.schemaVersion, '1.5.0');
    assert.equal(bundle.root.children[0].text.layoutMode, mode);
    assert.equal(bundle.root.children[0].text.fontSize, 34);
    assert.deepEqual(bundle.root.children[0].rect, { x: 10, y: 20, width: 72, height: 25 });
  });
}

test('unknown source layout is omitted rather than inferred from a single line of text', () => {
  for (const unknown of [undefined, null, 'unknown']) {
    const { manifest, snapshot } = fixture(unknown);
    assert.equal(Object.hasOwn(manifest.nodes['2'].text, 'layoutMode'), false);
    assert.equal(Object.hasOwn(core.buildBundle(manifest, snapshot).root.children[0].text, 'layoutMode'), false);
  }
});

test('snapshot mode changes update the authoring baseline and remove a stale mode when source type becomes unknown', () => {
  const { manifest, snapshot, layer } = fixture('point');
  const baseline = core.captureBaseline(manifest, snapshot);
  layer.text.layoutMode = 'paragraph';
  assert.ok(core.diffLayerFromBaseline(baseline, layer).includes('文本内容或排版已改变'));
  const prepared = core.prepareManifestForExport(manifest, snapshot);
  assert.equal(prepared.manifest.nodes['2'].text.layoutMode, 'paragraph');
  delete layer.text.layoutMode;
  const unknown = core.prepareManifestForExport(prepared.manifest, snapshot);
  assert.equal(Object.hasOwn(unknown.manifest.nodes['2'].text, 'layoutMode'), false);
  layer.text = null;
  const unavailable = core.prepareManifestForExport(prepared.manifest, snapshot);
  assert.equal(Object.hasOwn(unavailable.manifest.nodes['2'].text, 'layoutMode'), false);
});

test('legacy bundle generation strips new text layout even when authoring has a known Photoshop text type', () => {
  const { manifest, snapshot } = fixture('point', null);
  assert.equal(manifest.nodes['2'].text.layoutMode, 'point');
  const bundle = core.buildBundle(manifest, snapshot);
  assert.equal(bundle.schemaVersion, '1.4.0');
  assert.equal(Object.hasOwn(bundle.root.children[0].text, 'layoutMode'), false);
  assert.equal(manifest.nodes['2'].text.layoutMode, 'point');
});

test('authoring validation rejects explicit invalid text layout values including null', () => {
  for (const invalid of [null, '', 'Point', 'legacy', 1, false]) {
    const { manifest } = fixture('point');
    manifest.nodes['2'].text.layoutMode = invalid;
    const issues = core.validateManifest(manifest);
    assert.ok(issues.some(issue => issue.code === 'PSD2UI_TEXT_LAYOUT_MODE_INVALID'
      && issue.path.endsWith('.text.layoutMode')), JSON.stringify(issues));
  }
});
