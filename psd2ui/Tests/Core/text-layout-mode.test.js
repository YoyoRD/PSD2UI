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

test('mixed-color renderValue is optional, preserves plain value, and tracks later color edits', () => {
  const { manifest, snapshot, layer } = fixture('point');
  layer.text.renderValue = '<color=#00AA00FF>16</color><color=#888888FF>:00</color>';
  const prepared = core.prepareManifestForExport(manifest, snapshot);
  assert.equal(prepared.manifest.nodes['2'].text.value, '16:00');
  assert.equal(prepared.manifest.nodes['2'].text.renderValue, layer.text.renderValue);
  const bundle = core.buildBundle(prepared.manifest, snapshot);
  assert.equal(bundle.root.children[0].text.renderValue, layer.text.renderValue);
  const baseline = core.captureBaseline(prepared.manifest, snapshot);
  layer.text.renderValue = '<color=#00AA00FF>16</color><color=#777777FF>:00</color>';
  assert.ok(core.diffLayerFromBaseline(baseline, layer).includes('文本内容或排版已改变'));
  delete layer.text.renderValue;
  layer.text.renderWarning = '原文包含可能被 Unity 识别为标签的 < 字符';
  const skipped = core.buildBundle(prepared.manifest, snapshot);
  assert.equal(Object.hasOwn(skipped.root.children[0].text, 'renderValue'), false);
  assert.ok(skipped.diagnostics.some((entry) => entry.code === 'PSD2UI_TEXT_RENDER_VALUE_SKIPPED'
    && entry.message.includes('< 字符')));
  layer.text = null;
  const unavailable = core.prepareManifestForExport(prepared.manifest, snapshot);
  assert.equal(Object.hasOwn(unavailable.manifest.nodes['2'].text, 'renderValue'), false);
});

test('renderValue requires exact color-tag coverage and enabled rich text', () => {
  const { manifest } = fixture('point');
  for (const invalid of ['<color=#FF0000FF>16</color>', '<color=red>16:00</color>',
    '<color=#FF0000FF></color><color=#00FF00FF>16:00</color>',
    '<color=#FF0000FF><b>16:00</b></color>', '16:00']) {
    manifest.nodes['2'].text.renderValue = invalid;
    assert.ok(core.validateManifest(manifest).some((entry) => entry.code === 'PSD2UI_TEXT_RENDER_VALUE_INVALID'), invalid);
  }
  manifest.nodes['2'].text.renderValue = '<color=#FF0000FF>16</color><color=#00FF00FF>:00</color>';
  manifest.nodes['2'].text.richText = 'disabled';
  assert.ok(core.validateManifest(manifest).some((entry) => entry.code === 'PSD2UI_TEXT_RENDER_VALUE_INVALID'));
});

test('legacy bundle omits renderValue while the 1.5 bundle retains it', () => {
  const { manifest, snapshot, layer } = fixture('point', null);
  layer.text.renderValue = '<color=#FF0000FF>16</color><color=#00FF00FF>:00</color>';
  const prepared = core.prepareManifestForExport(manifest, snapshot);
  assert.equal(prepared.manifest.nodes['2'].text.renderValue, layer.text.renderValue);
  const bundle = core.buildBundle(prepared.manifest, snapshot);
  assert.equal(bundle.schemaVersion, '1.4.0');
  assert.equal(Object.hasOwn(bundle.root.children[0].text, 'renderValue'), false);
});

test('source font name follows Photoshop edits while manual fontKey remains unchanged', () => {
  const { manifest, snapshot, layer } = fixture('point');
  layer.text.fontPostScriptName = 'FZHTJW';
  const first = core.prepareManifestForExport(manifest, snapshot);
  assert.equal(first.manifest.nodes['2'].text.fontKey, 'default');
  assert.equal(first.manifest.nodes['2'].text.fontPostScriptName, 'FZHTJW');
  assert.equal(core.buildBundle(manifest, snapshot).root.children[0].text.fontPostScriptName, 'FZHTJW');
  const baseline = core.captureBaseline(first.manifest, snapshot);
  layer.text.fontPostScriptName = 'AlibabaPuHuiTi-Bold';
  assert.ok(core.diffLayerFromBaseline(baseline, layer).includes('文本内容或排版已改变'));
  const changed = core.buildBundle(first.manifest, snapshot);
  assert.equal(changed.root.children[0].text.fontKey, 'default');
  assert.equal(changed.root.children[0].text.fontPostScriptName, 'AlibabaPuHuiTi-Bold');
  first.manifest.nodes['2'].text.fontKey = 'FZHTJW';
  assert.equal(core.buildBundle(first.manifest, snapshot).root.children[0].text.fontKey, 'FZHTJW');
  delete layer.text.fontPostScriptName;
  layer.text.fontWarning = '同一文字层使用了多个字体';
  const fallback = core.buildBundle(first.manifest, snapshot);
  assert.equal(fallback.root.children[0].text.fontKey, 'default');
  assert.equal(first.manifest.nodes['2'].text.fontKey, 'FZHTJW');
  assert.equal(Object.hasOwn(fallback.root.children[0].text, 'fontPostScriptName'), false);
  assert.ok(fallback.diagnostics.some((entry) => entry.code === 'PSD2UI_TEXT_FONT_UNRESOLVED'));
  layer.text = null;
  const unavailable = core.prepareManifestForExport(first.manifest, snapshot);
  assert.equal(Object.hasOwn(unavailable.manifest.nodes['2'].text, 'fontPostScriptName'), false);
});

test('legacy bundle omits the optional Photoshop PostScript font name', () => {
  const { manifest, snapshot, layer } = fixture('point', null);
  layer.text.fontPostScriptName = 'FZHTJW';
  const prepared = core.prepareManifestForExport(manifest, snapshot);
  assert.equal(prepared.manifest.nodes['2'].text.fontPostScriptName, 'FZHTJW');
  const bundle = core.buildBundle(prepared.manifest, snapshot);
  assert.equal(bundle.schemaVersion, '1.4.0');
  assert.equal(Object.hasOwn(bundle.root.children[0].text, 'fontPostScriptName'), false);
});

test('authoring validation rejects invalid Photoshop PostScript font names', () => {
  const { manifest } = fixture('point');
  for (const invalid of [null, '', ' ', 1, 'A\nB']) {
    manifest.nodes['2'].text.fontPostScriptName = invalid;
    assert.ok(core.validateManifest(manifest).some((entry) =>
      entry.code === 'PSD2UI_FONT_POSTSCRIPT_NAME_INVALID'), String(invalid));
  }
});
