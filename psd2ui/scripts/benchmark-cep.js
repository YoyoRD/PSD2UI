'use strict';

// 合成大 PSD 的面板投影与跨宿主调用基准；不代替 Photoshop 实机验收。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex >= 0 ? path.resolve(process.argv[baselineIndex + 1]) : null;

function load(file, original, photoshop) {
  const nativeRequire = createRequire(original);
  const sandbox = { module: { exports: {} }, console, setTimeout, clearTimeout,
    require: name => name === 'photoshop' ? photoshop : nativeRequire(name) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: original });
  return sandbox.module.exports;
}

function documentFixture(count) {
  const layers = Array.from({ length: count - 1 }, (_, index) => {
    const text = index % 4 === 0;
    const bounds = { left: index % 720, top: index % 1560, right: index % 720 + 100, bottom: index % 1560 + 40 };
    return { id: index + 2, name: 'comm_sp_' + index, kind: text ? 'text' : 'pixel', visible: true,
      opacity: 100, blendMode: 'normal', bounds, boundsNoEffects: bounds, layers: [],
      textItem: text ? { contents: '中文面板性能基准 ' + index, characterStyle: { size: 24, color: { rgb: { red: 255, green: 255, blue: 255 } } }, paragraphStyle: {}, isPointText: true } : null,
      descriptor: text ? { textKey: { textKey: '中文面板性能基准 ' + index,
        textStyleRange: [{ from: 0, to: 10, textStyle: { size: { _unit: 'pixelsUnit', _value: 24 }, fontPostScriptName: 'TestFont' } }] },
      layerEffects: { scale: { _unit: 'percentUnit', _value: 100 } } } : {} };
  });
  return { activeDocumentId: 10, version: 'synthetic', documents: [{ id: 10, historyId: 1,
    name: 'Benchmark.psd', title: 'Benchmark.psd', path: 'C:/Benchmark.psd', width: 720, height: 1560, resolution: 72,
    activeLayerIds: [1], layers: [{ id: 1, name: 'Group', kind: 'group', visible: true, opacity: 100,
      bounds: { left: 0, top: 0, right: 720, bottom: 1560 }, descriptor: {}, layers }] }] };
}

async function benchmark(label, facadeFile, projectionFile, count) {
  const state = documentFixture(count), calls = {}, facadePath = path.join(root, 'Plus-ins/PSD2UI-CEP/src/photoshop.js');
  let pages = [];
  const stamp = () => ({ ...state, documents: state.documents.map(doc => ({ ...doc, layers: undefined })) });
  const { createPhotoshopFacade } = load(facadeFile, facadePath);
  const photoshop = createPhotoshopFacade({ yieldHost: async () => {}, transport: async (method, params) => {
    calls[method] = (calls[method] || 0) + 1;
    let value;
    if (method === 'probe') value = stamp();
    else if (method === 'beginState') {
      const doc = state.documents[0], reused = (params.knownDocuments || []).some(known => known.id === doc.id && known.historyId === doc.historyId);
      pages = [];
      const walk = (items, parentId) => items.forEach(layer => { pages.push({ documentId: doc.id, parentId, layer: { ...layer, layers: [] } }); walk(layer.layers, layer.id); });
      if (!reused) walk(doc.layers, null);
      value = { stamp: stamp(), token: 'benchmark', reusedDocumentIds: reused ? [doc.id] : [], done: pages.length === 0 };
    } else if (method === 'statePage') { value = { items: pages.splice(0, 8), done: pages.length <= 0 }; }
    else if (method === 'select') {
      const doc = state.documents[0];
      doc.activeLayerIds = params.add ? Array.from(new Set(doc.activeLayerIds.concat(params.layerIds))) : params.layerIds.slice();
    } else throw new Error('Unexpected benchmark method: ' + method);
    return { ok: true, value };
  } });
  await photoshop.initialize();
  const api = load(projectionFile, path.join(root, 'Plus-ins/PSD2UI/src/photoshopDocument.js'), photoshop);
  const samples = [];
  for (let iteration = 0; iteration < 31; iteration++) {
    const started = performance.now();
    // 当前组、准备状态、组件编辑器在一次选择/页签刷新中的读取。
    api.getActiveLayersInfo(); api.readLayer(photoshop.app.activeDocument.layers[0]); api.getActiveLayersInfo();
    if (iteration) samples.push(performance.now() - started);
  }
  Object.keys(calls).forEach(key => { delete calls[key]; });
  await api.selectLayersById(Array.from({ length: 12 }, (_, index) => String(index + 2)));
  samples.sort((a, b) => a - b);
  return { label, layers: count, projectionMedianMs: Number(samples[15].toFixed(3)),
    projectionP95Ms: Number(samples[28].toFixed(3)), multiSelectCalls: calls };
}

(async () => {
  const results = [];
  for (const count of [146, 1000]) {
    if (baseline) results.push(await benchmark('before', path.join(baseline, 'before-facade.js'), path.join(baseline, 'before-document.js'), count));
    results.push(await benchmark('after', path.join(root, 'Plus-ins/PSD2UI-CEP/src/photoshop.js'), path.join(root, 'Plus-ins/PSD2UI/src/photoshopDocument.js'), count));
  }
  console.log(JSON.stringify({ kind: 'synthetic-node-benchmark', node: process.version, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
