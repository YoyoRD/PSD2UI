'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../../Core');
const textEffects = require('../../Plus-ins/PSD2UI/src/textEffects');

function snapshotHost(descriptors, options = {}) {
  const document = { id: 59, title: '文字效果.psd', path: 'F:/Artist/文字效果.psd',
    width: 720, height: 1560, resolution: options.resolution || 72, layers: [] };
  document.layers = (options.layerIds || [7110, 6703]).map((id) => ({
    id, name: id === 7110 ? 'Backpack' : 'Sure', kind: options.layerKind || 'text', parent: document,
    bounds: { left: 24, top: 64, right: 258, bottom: 125 }, visible: true, opacity: 100,
    textItem: { contents: id === 7110 ? 'Backpack' : 'Sure',
      characterStyle: options.characterStyles && options.characterStyles[id] || { size: 48 }, paragraphStyle: {},
      ...(options.textItems && options.textItems[id] || {}) }
  }));
  const calls = [];
  const photoshop = { app: { activeDocument: document }, action: {
    // This is the API shape observed in the real Photoshop UXP host: no batchPlaySync.
    batchPlay(commands, options) {
      calls.push({ commands, options });
      const target = commands[0]._target._ref;
      const layerId = target.find((entry) => entry._ref === 'layer')._id;
      return [descriptors[layerId] || {}];
    }
  }, core: {}, constants: {} };
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../../Plus-ins/PSD2UI/src/photoshopDocument.js'), 'utf8');
  vm.runInNewContext(source, { module, exports: module.exports, require(id) {
    if (id === 'photoshop') return photoshop;
    if (id === './textEffects') return textEffects;
    throw new Error(`Unexpected dependency: ${id}`);
  } });
  return { api: module.exports, calls };
}

const black = { red: 0, grain: 0, blue: 0 };
const outline = { _obj: 'frameFX', enabled: true, present: true,
  size: { _unit: 'pixelsUnit', _value: 2 }, opacity: { _unit: 'percentUnit', _value: 100 }, color: black };

test('non-text snapshot protection reads clipping and masks from the host descriptor once', () => {
  const host = snapshotHost({ 7110: { group: true, hasUserMask: true, hasVectorMask: true } },
    { layerKind: 'pixel', layerIds: [7110] });
  const node = host.api.createSnapshot('document-root').root.children[0];
  assert.equal(node.protection.clipped, true);
  assert.equal(node.protection.hasLayerMask, true);
  assert.equal(node.protection.hasVectorMask, true);
  assert.equal(host.calls.length, 1);
});

test('真实 UXP 的同步 batchPlay 接口使文字描边与阴影进入同步快照及 Bundle', () => {
  const host = snapshotHost({
    7110: { layerEffects: { frameFX: outline, dropShadow: { enabled: true, present: true,
      color: black, opacity: { _unit: 'percentUnit', _value: 100 },
      localLightingAngle: { _unit: 'angleUnit', _value: 90 }, distance: { _unit: 'pixelsUnit', _value: 6 } } } },
    6703: { layerEffects: { frameFX: outline, dropShadowMulti: [{ enabled: false, present: false }] } }
  });
  const snapshot = host.api.createSnapshot('document-root');
  assert.equal(typeof snapshot.then, 'undefined');
  assert.equal(snapshot.root.children[0].text.effects.outline.distanceX, 2);
  assert.equal(snapshot.root.children[0].text.effects.shadow.distanceY, -6);
  assert.equal(snapshot.root.children[1].text.effects.outline.color.a, 1);
  assert.equal(snapshot.root.children[1].text.effects.shadow, null);
  assert.equal(host.calls.length, 2, '每层一次完整描述符读取，不能为每个公共参数追加宿主调用');
  for (const call of host.calls) {
    assert.equal(call.options.synchronousExecution, true);
    assert.equal(call.commands[0]._target._ref.find((entry) => entry._ref === 'document')._id, 59);
  }
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    resourceNaming: 'source', name: '文字效果', rootLayerId: 'document-root', rootLayerName: '文字效果',
    width: 720, height: 1560, snapshot
  } }, { actor: 'human-panel' }).manifest;
  const bundle = core.buildBundle(manifest, snapshot);
  assert.equal(bundle.root.children[0].text.effects.outline.distanceX, 2);
  assert.equal(bundle.root.children[0].text.effects.shadow.distanceY, -6);
  assert.equal(bundle.root.children[1].text.effects.shadow, null);
  assert.equal(bundle.root.children[0].text.fontSize, 48);
});

test('没有图层效果属性的文字仍能生成同步快照', () => {
  const host = snapshotHost({ 7110: {}, 6703: { _obj: 'error', message: 'Property is unavailable', result: -25922 } });
  const snapshot = host.api.createSnapshot('document-root');
  assert.ok(snapshot.root.children.every((layer) => layer.text.effects === null));
});

test('新 PS 参数保留全部效果与共同字段，CR 和自动行距在源端归一，Bundle 不丢新语义', () => {
  const descriptor = { layerFXVisible: true, fillOpacity: 0, globalAngle: 45,
    layerEffects: { frameFX: { ...outline, style: { _value: 'insetFrame' }, overprint: true },
      dropShadow: { enabled: true, present: true, color: black, distance: { _value: 4 },
        localLightingAngle: { _value: 135 }, useGlobalAngle: true, blur: { _value: 8 }, noise: { _value: 30 } },
      outerGlow: { enabled: true, customFutureField: { preserved: 123 } } },
    textKey: { textStyleRange: [{ textStyle: { autoLeading: true,
      impliedFontSize: { _unit: 'pixelsUnit', _value: 40 }, impliedLeading: { _unit: 'pixelsUnit', _value: 0 } } }],
      paragraphStyleRange: [{ paragraphStyle: { autoLeading: 150 } }] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110], textItems: { 7110: { isPointText: true, contents: '一\r二\r\n三' } } });
  const snapshot = host.api.createSnapshot('document-root');const text = snapshot.root.children[0].text;
  assert.equal(text.value, '一\n二\n三');assert.equal(text.lineAdvance, 60);assert.equal(text.lineSpacing, 1.5);
  const raw = JSON.parse(text.photoshop.descriptorJson);
  assert.deepEqual(raw.layerEffects, descriptor.layerEffects);assert.equal(raw.fillOpacity, 0);assert.equal(raw.globalAngle, 45);
  assert.equal(raw.textKey, undefined, 'PS 私有文字引擎数据不随效果源包保存');
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    resourceNaming: 'source', name: '文字效果', rootLayerId: 'document-root', rootLayerName: '文字效果', width: 720, height: 1560, snapshot
  } }, { actor: 'human-panel' }).manifest;
  const exported = core.buildBundle(manifest, snapshot).root.children[0].text;
  assert.equal(exported.photoshop.descriptorJson, text.photoshop.descriptorJson);assert.equal(exported.lineAdvance, 60);
});

test('自由变换后的文字采用真实 impliedFontSize 与 impliedLeading，不以图层边界拟合字号', () => {
  const transform = { xx: 0.7383444338725024, xy: 0, yx: 0, yy: 0.7519765739385065, tx: 0, ty: 0 };
  const textKey = (font, rawSize, impliedSize) => ({ textKey: { transform, textStyleRange: [{
    from: 0, to: 5, textStyle: { fontPostScriptName: font, fontAvailable: false,
      size: { _unit: 'pointsUnit', _value: rawSize },
      impliedFontSize: { _unit: 'pointsUnit', _value: impliedSize },
      impliedLeading: { _unit: 'pointsUnit', _value: 36.094875549046264 } }
  }] } });
  const host = snapshotHost({
    7233: textKey('AlibabaPuHuiTi-Heavy', 45.21417999267578, 34.000004164329376),
    7234: textKey('AlibabaPuHuiTi-Bold', 37.235198974609375, 27.99999735484376)
  }, { layerIds: [7233, 7234], characterStyles: {
    7233: { size: 45.21417999267578, leading: 48 },
    7234: { size: 37.235198974609375, leading: 48 }
  } });
  const snapshot = host.api.createSnapshot('document-root');
  const [time, date] = snapshot.root.children;
  assert.equal(time.text.fontSize, 34);
  assert.equal(date.text.fontSize, 28);
  assert.ok(Math.abs(time.text.lineSpacing - 1.061613856709897) < 1e-12);
  assert.ok(Math.abs(date.text.lineSpacing - 1.289102819961594) < 1e-12);
  const source = JSON.parse(time.styleSignature).textSource;
  assert.equal(source.styles[0].fontPostScriptName, 'AlibabaPuHuiTi-Heavy');
  assert.equal(source.styles[0].size._value, 45.21417999267578);
  assert.equal(time.text.fontKey, undefined);
  assert.equal(time.bounds.bottom - time.bounds.top, 61);
});

test('descriptor points 按文档分辨率转像素，已为 pixels 的值不重复缩放', () => {
  const textKey = (unit, size, leading) => ({ textKey: { textStyleRange: [{ textStyle: {
    impliedFontSize: { _unit: unit, _value: size }, impliedLeading: { _unit: unit, _value: leading }
  } }] } });
  const host = snapshotHost({ 7110: textKey('pointsUnit', 12, 18), 6703: textKey('pixelsUnit', 24, 36) },
    { resolution: 144 });
  const snapshot = host.api.createSnapshot('document-root');
  for (const layer of snapshot.root.children) {
    assert.equal(layer.text.fontSize, 24);
    assert.equal(layer.text.lineSpacing, 1.5);
  }
});

test('文字排版类型采用 DOM 布尔事实，优先于 descriptor，换行不改变点文本类型', () => {
  const paint = { textKey: { textShape: [{ char: { _enum: 'char', _value: 'paint' } }] } };
  const host = snapshotHost({ 6703: paint }, { textItems: {
    7110: { isPointText: true, contents: '第一行\n第二行' },
    6703: { isPointText: false, isParagraphText: true }
  } });
  const snapshot = host.api.createSnapshot('document-root');
  assert.equal(snapshot.root.children[0].text.layoutMode, 'point');
  assert.equal(snapshot.root.children[1].text.layoutMode, 'paragraph');
  const paragraphOnly = snapshotHost({}, { textItems: { 7110: { isParagraphText: true } } });
  assert.equal(paragraphOnly.api.createSnapshot('document-root').root.children[0].text.layoutMode, 'paragraph');
});

test('DOM 类型未知时仅识别已验证 paint 描述符，其余省略 layoutMode', () => {
  const paint = { textKey: { textShape: [{ char: { _enum: 'char', _value: 'paint' } }] } };
  const host = snapshotHost({ 7110: paint }, { textItems: { 6703: { contents: '多行\n未知类型', isPointText: 'true' } } });
  const snapshot = host.api.createSnapshot('document-root');
  assert.equal(snapshot.root.children[0].text.layoutMode, 'point');
  assert.equal(Object.hasOwn(snapshot.root.children[1].text, 'layoutMode'), false);
  const unknownShape = snapshotHost({ 7110: { textKey: { textShape: [{ char: { _enum: 'char', _value: 'unverified' } }] } } });
  assert.equal(Object.hasOwn(unknownShape.api.createSnapshot('document-root').root.children[0].text, 'layoutMode'), false);
});
