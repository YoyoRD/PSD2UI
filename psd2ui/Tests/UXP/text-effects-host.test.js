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

test('同层中文混色按原始 UTF-16 范围生成完整 color 标签，纯文本和换行仍保留', () => {
  const green = { _obj: 'RGBColor', red: 0, grain: 153, blue: 102 };
  const gray = { _obj: 'RGBColor', red: 128, green: 136, blue: 144 };
  const first = '强攻1号舱\r';
  const second = '5件红色机甲\r\n';
  const third = '持续😀';
  const contents = first + second + third;
  const descriptor = { textKey: { textKey: contents, textStyleRange: [
    { from: 0, to: first.length, textStyle: { color: green } },
    { from: first.length, to: first.length + second.length, textStyle: { baseParentStyle: { color: gray } } },
    { from: first.length + second.length, to: contents.length, textStyle: { color: green } }
  ] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110],
    textItems: { 7110: { contents } } });
  const layer = host.api.createSnapshot('document-root').root.children[0];
  assert.equal(layer.text.value, '强攻1号舱\n5件红色机甲\n持续😀');
  assert.equal(layer.text.renderValue, '<color=#009966FF>强攻1号舱\n</color>'
    + '<color=#808890FF>5件红色机甲\n</color><color=#009966FF>持续😀</color>');
  assert.equal(layer.text.renderValue.replace(/<[^>]+>/g, ''), layer.text.value);
  const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
    resourceNaming: 'source', name: '文字混色', rootLayerId: 'document-root', rootLayerName: '文字混色',
    width: 720, height: 1560, snapshot: { root: { ...host.api.createSnapshot('document-root').root } }
  } }, { actor: 'human-panel' }).manifest;
  const bundle = core.buildBundle(manifest, host.api.createSnapshot('document-root'));
  assert.equal(bundle.root.children[0].text.value, layer.text.value);
  assert.equal(bundle.root.children[0].text.renderValue, layer.text.renderValue);
});

test('混色范围不可靠或包含 Unity 标签时不生成 renderValue，并报告警告', () => {
  const red = { _obj: 'RGBColor', red: 255, green: 0, blue: 0 };
  const blue = { _obj: 'RGBColor', red: 0, green: 0, blue: 255 };
  const ranges = (end) => [
    { from: 0, to: 1, textStyle: { color: red } },
    { from: 1, to: end, textStyle: { color: blue } }
  ];
  const cases = [
    { value: 'a<b>', descriptorValue: 'a<b>', styles: ranges(4), reason: /< 字符/ },
    { value: 'a😀', descriptorValue: 'a😀', styles: [
      { from: 0, to: 2, textStyle: { color: red } },
      { from: 2, to: 3, textStyle: { color: blue } }], reason: /Unicode 字符/ },
    { value: 'a\r\nb', descriptorValue: 'a\r\nb', styles: [
      { from: 0, to: 2, textStyle: { color: red } },
      { from: 2, to: 4, textStyle: { color: blue } }], reason: /换行/ },
    { value: 'ab', descriptorValue: 'ac', styles: ranges(2), reason: /不一致/ },
    { value: 'ab', descriptorValue: 'ab', styles: [ranges(2)[0],
      { from: 2, to: 3, textStyle: { color: blue } }], reason: /不连续或越界/ },
    { value: 'ab', descriptorValue: 'ab', styles: [ranges(2)[0],
      { from: 1, to: 2, textStyle: {} }], reason: /缺少可继承/ },
    { value: 'ab', descriptorValue: 'ab', styles: [
      { from: 0, to: 1, textStyle: { color: { _obj: 'CMYKColor', cyan: 1 } } },
      { from: 1, to: 2, textStyle: {} }], reason: /没有可用的 RGB/ }
  ];
  for (const sample of cases) {
    const host = snapshotHost({ 7110: { textKey: {
      textKey: sample.descriptorValue, textStyleRange: sample.styles
    } } }, { layerIds: [7110], textItems: { 7110: { contents: sample.value } } });
    const text = host.api.createSnapshot('document-root').root.children[0].text;
    assert.equal(text.renderValue, undefined, sample.reason.source);
    assert.match(text.renderWarning, sample.reason);
  }
});

test('后段颜色单独改变会更新富文本和源样式签名，图层填充效果跳过逐字颜色', () => {
  const red = { _obj: 'RGBColor', red: 255, green: 0, blue: 0 };
  const blue = { _obj: 'RGBColor', red: 0, green: 0, blue: 255 };
  const green = { _obj: 'RGBColor', red: 0, green: 255, blue: 0 };
  const descriptor = { textKey: { textKey: '甲乙', textStyleRange: [
    { from: 0, to: 1, textStyle: { color: red } },
    { from: 1, to: 2, textStyle: { color: blue } }
  ] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110], textItems: { 7110: { contents: '甲乙' } } });
  const before = host.api.createSnapshot('document-root').root.children[0];
  descriptor.textKey.textStyleRange[1].textStyle.color = green;
  const after = host.api.createSnapshot('document-root').root.children[0];
  assert.notEqual(after.text.renderValue, before.text.renderValue);
  assert.notEqual(after.styleSignature, before.styleSignature);
  descriptor.layerEffects = { gradientFill: { enabled: true, present: true } };
  const withFill = host.api.createSnapshot('document-root').root.children[0].text;
  assert.equal(withFill.renderValue, undefined);
  assert.match(withFill.renderWarning, /填充效果/);
});

test('描述符仅多一个结尾回车时按 DOM 正文截断，不把终止符写入富文本', () => {
  const descriptor = { textKey: { textKey: '甲乙\r', textStyleRange: [
    { from: 0, to: 1, textStyle: { color: { _obj: 'RGBColor', red: 255, green: 0, blue: 0 } } },
    { from: 1, to: 4, textStyle: { color: { _obj: 'RGBColor', red: 0, green: 0, blue: 255 } } }
  ] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110], textItems: { 7110: { contents: '甲乙' } } });
  const text = host.api.createSnapshot('document-root').root.children[0].text;
  assert.equal(text.value, '甲乙');
  assert.equal(text.renderValue, '<color=#FF0000FF>甲</color><color=#0000FFFF>乙</color>');
});

test('仅覆盖 Photoshop 结尾标记的样式段不需要 RGB 字色', () => {
  const descriptor = { textKey: { textKey: '甲乙\r', textStyleRange: [
    { from: 0, to: 1, textStyle: { color: { _obj: 'RGBColor', red: 255, green: 0, blue: 0 } } },
    { from: 1, to: 2, textStyle: { color: { _obj: 'RGBColor', red: 0, green: 0, blue: 255 } } },
    { from: 2, to: 4, textStyle: {} }
  ] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110], textItems: { 7110: { contents: '甲乙' } } });
  const text = host.api.createSnapshot('document-root').root.children[0].text;
  assert.equal(text.renderValue, '<color=#FF0000FF>甲</color><color=#0000FFFF>乙</color>');
  assert.equal(text.renderWarning, undefined);
});

test('可见文字统一字体读取继承的 PostScript 名，忽略 Photoshop 结尾标记', () => {
  const descriptor = { textKey: { textKey: '甲乙\r', textStyleRange: [
    { from: 0, to: 1, textStyle: { fontPostScriptName: 'FZHTJW', fontAvailable: false } },
    { from: 1, to: 2, textStyle: { baseParentStyle: { fontPostScriptName: 'FZHTJW' } } },
    { from: 2, to: 4, textStyle: { fontPostScriptName: 'AlibabaPuHuiTi-Heavy' } }
  ] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110], textItems: { 7110: { contents: '甲乙' } } });
  const layer = host.api.createSnapshot('document-root').root.children[0];
  assert.equal(layer.text.fontPostScriptName, 'FZHTJW');
  assert.equal(layer.text.fontWarning, undefined);
  assert.equal(JSON.parse(layer.styleSignature).textSource.styles[1].fontPostScriptName, 'FZHTJW');
});

test('同层多字体或不可靠样式范围只报告诊断，不推断单一字体', () => {
  const heavy = { fontPostScriptName: 'AlibabaPuHuiTi-Heavy' };
  const medium = { fontPostScriptName: 'AlibabaPuHuiTi-Medium' };
  const cases = [
    { source: '甲乙', value: '甲乙', styles: [
      { from: 0, to: 1, textStyle: heavy }, { from: 1, to: 2, textStyle: medium }
    ], reason: /多个字体/ },
    { source: '甲乙', value: '甲乙', styles: [
      { from: 0, to: 1, textStyle: heavy }, { from: 2, to: 3, textStyle: heavy }
    ], reason: /不连续或越界/ },
    { source: '甲乙', value: '甲丙', styles: [
      { from: 0, to: 2, textStyle: heavy }
    ], reason: /不一致/ },
    { source: '甲😀', value: '甲😀', styles: [
      { from: 0, to: 2, textStyle: heavy }, { from: 2, to: 3, textStyle: heavy }
    ], reason: /Unicode 字符/ },
    { source: '甲\r\n乙', value: '甲\r\n乙', styles: [
      { from: 0, to: 2, textStyle: heavy }, { from: 2, to: 4, textStyle: heavy }
    ], reason: /换行/ },
    { source: '甲乙', value: '甲乙', styles: [
      { from: 0, to: 1, textStyle: heavy }, { from: 1, to: 2, textStyle: {} }
    ], reason: /缺少可继承/ },
    { source: undefined, value: '甲乙', styles: [
      { from: 0, to: 2, textStyle: heavy }
    ], reason: /完整文字样式范围/ }
  ];
  for (const sample of cases) {
    const host = snapshotHost({ 7110: { textKey: {
      textKey: sample.source, textStyleRange: sample.styles
    } } }, { layerIds: [7110], textItems: { 7110: { contents: sample.value } } });
    const snapshot = host.api.createSnapshot('document-root');
    const layer = snapshot.root.children[0];
    assert.equal(layer.text.fontPostScriptName, undefined, sample.reason.source);
    assert.match(layer.text.fontWarning, sample.reason);
    const manifest = core.executeAuthoringCommand(null, { command: 'initialize-document', input: {
      resourceNaming: 'source', name: '字体诊断', rootLayerId: 'document-root', rootLayerName: '字体诊断',
      width: 720, height: 1560, snapshot
    } }, { actor: 'human-panel' }).manifest;
    const bundle = core.buildBundle(manifest, snapshot);
    assert.equal(bundle.root.children[0].text.fontKey, 'default');
    assert.equal(bundle.root.children[0].text.fontPostScriptName, undefined);
    assert.ok(bundle.diagnostics.some((entry) => entry.code === 'PSD2UI_TEXT_FONT_UNRESOLVED'
      && sample.reason.test(entry.message)));
  }
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
  assert.match(time.text.fontWarning, /样式范围/);
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

test('异常小的 Photoshop 行距不会在 Unity 生成重叠文字', () => {
  const descriptor = { textKey: { textStyleRange: [{ textStyle: {
    impliedFontSize: { _unit: 'pixelsUnit', _value: 40 },
    impliedLeading: { _unit: 'pixelsUnit', _value: 0.5 }
  } }] } };
  const host = snapshotHost({ 7110: descriptor }, { layerIds: [7110] });
  assert.equal(host.api.createSnapshot('document-root').root.children[0].text.lineSpacing, 1);
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
