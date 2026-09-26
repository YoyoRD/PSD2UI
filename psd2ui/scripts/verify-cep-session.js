'use strict';

// 真实 Photoshop + 真实 CEP 适配器；COM 调用不能代替 CEF 窗口验收。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const { parseSessionOptions, verifySessionIdentity } = require('./cep-session-options');
const options = parseSessionOptions(process.argv.slice(2));
// 可选：将已打开业务 PSD 的指定同名资源复制到隔离样本，原文档只读。
const sourcePath = process.env.PSD2UI_SESSION_SOURCE_PATH || '';
const resourceName = process.env.PSD2UI_SESSION_RESOURCE || '';
if (Boolean(sourcePath) !== Boolean(resourceName)) throw Error('Provide both PSD2UI_SESSION_SOURCE_PATH and PSD2UI_SESSION_RESOURCE.');
const root = path.resolve(__dirname, '..');
const output = path.resolve(options.output || path.join(root, '.tmp', 'cep-session-' + Date.now()));
fs.mkdirSync(output, { recursive: true });
const hostSource = path.join(root, 'Plus-ins/PSD2UI-CEP/host/photoshop.jsx');
const isolatedHost = path.join(output, 'host.jsx');
fs.writeFileSync(isolatedHost, fs.readFileSync(hostSource, 'utf8').replaceAll('$.PSD2UIHost', '$.PSD2UISessionTestHost'));
const acceptanceSource = fs.readFileSync(isolatedHost, 'utf8').replace('json: { parse: parseJson, stringify: stringifyJson },',
  'json: { parse: parseJson, stringify: stringifyJson }, testSession: function () { return { history: historyTokens, temporary: temporaryDocuments, serial: serial, scopedHistorySupported: scopedHistorySupported, documentHistoryIds: documentHistoryIds }; },');
let hostSession = { history: {}, temporary: {}, serial: 0, scopedHistorySupported: null, documentHistoryIds: {} };
const report = { ok: false, output, requestedProgId: options.progId, expectedVersionMajor: options.expectedVersionMajor, checks: [], measurements: [] };
function persist() { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); }
const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'cep-session-bridge.ps1'),
  '-ProgId', options.progId, '-ExpectedVersionMajor', String(options.expectedVersionMajor)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = [];
let bridgeFailure = null;
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
readline.createInterface({ input: child.stdout }).on('line', line => {
  let result;
  try { result = JSON.parse(line); }
  catch (error) { rejectReady(error); const job = pending.shift(); if (job) job.reject(error); return; }
  if (result.type === 'ready') {
    try { resolveReady(verifySessionIdentity(options, result)); } catch (error) { rejectReady(error); }
    return;
  }
  const job = pending.shift(); if (!job) return;
  try { if (!result.ok) throw Error(result.error); job.resolve(JSON.parse(result.value)); }
  catch (error) { job.reject(error); }
});
child.stderr.on('data', data => process.stderr.write(data));
function bridgeFailed(error) { bridgeFailure = error; rejectReady(error); while (pending.length) pending.shift().reject(error); }
child.on('error', bridgeFailed);
child.stdin.on('error', bridgeFailed);
child.on('exit', code => bridgeFailed(Error('Photoshop bridge exited: ' + code)));
function script(body) {
  if (bridgeFailure) return Promise.reject(bridgeFailure);
  const source = acceptanceSource.replace('var historyTokens = {};', 'var historyTokens = ' + JSON.stringify(hostSession.history) + ';')
    .replace('var temporaryDocuments = {};', 'var temporaryDocuments = ' + JSON.stringify(hostSession.temporary) + ';')
    .replace('var serial = 0;', 'var serial = ' + hostSession.serial + ';')
    .replace('var scopedHistorySupported = null;', 'var scopedHistorySupported = ' + JSON.stringify(hostSession.scopedHistorySupported) + ';')
    .replace('var documentHistoryIds = {};', 'var documentHistoryIds = ' + JSON.stringify(hostSession.documentHistoryIds) + ';');
  return new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify({ script: source + '\n' + body }) + '\n'); });
}
const literal = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function resultScript(body) { return '(function(){' + body + '}());'; }
function record(name) { report.checks.push(name); persist(); console.log(name); }
let fixture;
async function main() {
  report.connection = await ready;
  report.photoshopVersion = report.connection.photoshopVersion;
  persist();
  // COM 每次调用重建脚本上下文；测试传递纯数据历史令牌，在单次调用中完成分段读取。
  fixture = await script(resultScript(`
    if (String(app.version) !== ${literal(report.photoshopVersion)}) throw Error('Photoshop version changed before fixture creation');
    var codec = $.PSD2UISessionTestHost.json, previous = app.documents.length ? app.activeDocument.id : null, excluded = [], i;
    for (i = 0; i < app.documents.length; i++) excluded.push(app.documents[i].id);
    var doc = app.documents.add(new UnitValue(320,'px'),new UnitValue(240,'px'),72,'PSD2UI_Session_${Date.now()}',NewDocumentMode.RGB,DocumentFill.TRANSPARENT);
    var layers=[], emptyLayer=doc.layers[0];
    try {
    for(i=0;i<6;i++) {
      var group = doc.layerSets.add(); group.name='Component '+i;
      var pixel = group.artLayers.add(); pixel.name='comm_bt_00'+(10+i);
      doc.activeLayer=pixel; doc.selection.select([[10+i*12,10],[90+i*12,10],[90+i*12,50],[10+i*12,50]]);
      var color = new SolidColor(); color.rgb.red=80+i*15; color.rgb.green=120; color.rgb.blue=180; doc.selection.fill(color); doc.selection.deselect();
      var label=group.artLayers.add(); label.kind=LayerKind.TEXT; label.name='Title '+i; label.textItem.contents='Button '+i; label.textItem.size=12; label.textItem.position=[new UnitValue(20+i*12,'px'),new UnitValue(35,'px')];
      layers.push({group:group.id,pixel:pixel.id,text:label.id});
    }
    emptyLayer.remove();
    var sharedSource=doc.layerSets[0].artLayers[1], shared=sharedSource.duplicate(); shared.name=sharedSource.name; shared.opacity=40;
    shared.translate(new UnitValue(15,'px'),new UnitValue(60,'px'));
    var sourceCopies=[];
    if (${literal(sourcePath)}) {
      var requested=${literal(path.normalize(sourcePath).split(path.sep).join('/').toLowerCase())}, source=null;
      for(i=0;i<app.documents.length;i++) { var candidate=app.documents[i]; try { if(candidate.fullName.fsName.replace(/\\\\/g,'/').toLowerCase()===requested)source=candidate; } catch(noFile){} }
      if(!source)throw Error('Requested source PSD must already be open');
      var matches=[];
      function collect(items){for(var n=0;n<items.length;n++){if(items[n].name===${literal(resourceName)})matches.push(items[n]);if(items[n].typename==='LayerSet')collect(items[n].layers);}}
      collect(source.layers); if(matches.length<2)throw Error('Expected multiple same-name source layers');
      for(i=0;i<matches.length;i++) {
        app.activeDocument=source; var original=matches[i], originalBounds=original.bounds;
        var copied=original.duplicate(doc,ElementPlacement.PLACEATBEGINNING); app.activeDocument=doc;copied.name=original.name;
        var copiedBounds=copied.bounds;
        copied.translate(new UnitValue(10+i*50-copiedBounds[0].as('px'),'px'),new UnitValue(130-copiedBounds[1].as('px'),'px'));
        sourceCopies.push({sourceLayerId:original.id,fixtureLayerId:copied.id,name:original.name,width:originalBounds[2].as('px')-originalBounds[0].as('px'),height:originalBounds[3].as('px')-originalBounds[1].as('px')});
      }
    }
    app.activeDocument=doc;
    doc.activeLayer=doc.layerSets[0];
    var file = File(${literal(path.join(output, 'fixture.psd').replaceAll('\\', '/'))}); doc.saveAs(file,new PhotoshopSaveOptions(),false,Extension.LOWERCASE);
    return codec.stringify({documentId:doc.id,previous:previous,path:file.fsName,excluded:excluded,layers:layers,sourceCopies:sourceCopies,photoshopVersion:String(app.version)});
    } catch(error) { app.activeDocument=doc; doc.close(SaveOptions.DONOTSAVECHANGES); if(previous!=null) for(i=0;i<app.documents.length;i++) if(app.documents[i].id===previous) app.activeDocument=app.documents[i]; throw error; }
  `));
  assert.equal(fixture.photoshopVersion, report.connection.photoshopVersion); report.fixture = fixture; persist();
  const excluded = new Set(fixture.excluded.map(String)), fullStamps = new Map();
  let lastStamp;
  let pages = [];
  const calls = [];
  const visibleStamp = full => {
    const visible = { ...full, documents: full.documents.filter(doc => !excluded.has(String(doc.id))) };
    fullStamps.set(JSON.stringify(visible), full); lastStamp = full; return visible;
  };
  const transport = { async invoke(method, input) {
    const params = { ...input };
    if (method === 'beginState') params.knownDocuments = (params.knownDocuments || []).concat(lastStamp.documents.filter(doc => excluded.has(String(doc.id))));
    if (params.stamp) params.stamp = fullStamps.get(JSON.stringify(params.stamp));
    const start = Date.now();
    let response;
    if (method === 'statePage') response = pages.shift();
    else {
      const reply = await script(resultScript(`var h=$.PSD2UISessionTestHost,c=h.json,r=c.parse(h.dispatch(${literal(JSON.stringify({ method, params, deferState: true }))})),pages=[];
        if(${literal(method)}==='beginState' && r.ok && !r.value.done){do{var p=c.parse(h.dispatch(c.stringify({method:'statePage',params:{token:r.value.token},deferState:true})));pages.push(p);if(!p.ok)break;}while(!p.value.done);}
        return c.stringify({response:r,pages:pages,session:h.testSession()});`));
      response = reply.response; hostSession = reply.session;
      if (method === 'beginState') pages = reply.pages;
    }
    calls.push({ method, milliseconds: Date.now() - start, layerCount: params.layerIds && params.layerIds.length });
    if (response.ok && method === 'probe') response.value = visibleStamp(response.value);
    if (response.ok && method === 'beginState') {
      response.value.stamp = visibleStamp(response.value.stamp);
      response.value.reusedDocumentIds = response.value.reusedDocumentIds.filter(id => !excluded.has(String(id)));
    }
    return response;
  } };
  const { createPhotoshopFacade } = require('../Plus-ins/PSD2UI-CEP/src/photoshop');
  const ps = createPhotoshopFacade({ transport, yieldHost: () => new Promise(resolve => setTimeout(resolve, 5)) });
  await ps.initialize();
  assert.equal(ps.app.documents.length, 1); assert.equal(ps.app.activeDocument.id, fixture.documentId);
  record('initial precise snapshot isolated from user documents');
  const selected = ps.app.activeDocument.layers.find(layer => layer.kind === 'group'), pixel = selected.layers.find(layer => layer.kind === 'pixel');
  const originalVisibility = pixel.visible;
  async function nativeVisibility(visible) {
    await script(resultScript(`if(app.activeDocument.id!==${fixture.documentId})throw Error('Fixture lost focus'); var r=new ActionReference(); r.putIdentifier(stringIDToTypeID('layer'),${pixel.id}); var a=new ActionDescriptor(); a.putReference(stringIDToTypeID('null'),r); executeAction(stringIDToTypeID('${visible ? 'show' : 'hide'}'),a,DialogModes.NO); return 'true';`));
  }
  for (const hint of [{ visibility: true, layerIds: [String(pixel.id)] }, { history: true }, { full: true }]) {
    const expectedVisibility = !pixel.visible;
    await nativeVisibility(expectedVisibility); calls.length = 0;
    const started = Date.now(); await ps.poll(hint);
    assert.equal(pixel.visible, expectedVisibility, 'native visibility must update even when Photoshop keeps the history ID');
    assert.ok(!calls.some(call => call.method === 'readGeometry'));
    report.measurements.push({ mode: JSON.stringify(hint), milliseconds: Date.now() - started, calls: calls.slice() });
  }
  calls.length = 0; await ps.refresh();
  assert.ok(!calls.some(call => call.method === 'statePage'));
  record('visibility and unknown notifications defer geometry; explicit refresh reads dirty groups only');
  await nativeVisibility(originalVisibility); await ps.poll({ visibility: true, layerIds: [String(pixel.id)] }); await ps.refresh();

  const modules = new Map();
  const context = vm.createContext({ console, Buffer, process, setTimeout, clearTimeout, Map, WeakMap, Set });
  function load(filename) {
    filename = path.resolve(filename);
    if (filename === path.join(root, 'Plus-ins/PSD2UI-CEP/src/photoshop.js')) return ps;
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const req = name => {
      if (name === 'photoshop') return ps;
      if (name === 'uxp') return load(path.join(root, 'Plus-ins/PSD2UI-CEP/src/uxp.js'));
      if (name === './src/xmpStore') return load(path.join(root, 'Plus-ins/PSD2UI-CEP/src/xmpStore.js'));
      if (name.startsWith('.')) return load(require.resolve(path.resolve(path.dirname(filename), name)));
      return createRequire(filename)(name);
    };
    const fn = vm.runInContext('(function(module,exports,require,__filename,__dirname){\n' + fs.readFileSync(filename, 'utf8') + '\n})', context, { filename });
    fn(module, module.exports, req, filename, path.dirname(filename)); return module.exports;
  }
  const documentApi = load(path.join(root, 'Plus-ins/PSD2UI/src/photoshopDocument.js'));
  const xmp = load(path.join(root, 'Plus-ins/PSD2UI-CEP/src/xmpStore.js'));
  const Core = require('../Core');
  const snapshot = documentApi.createSnapshot('document-root');
  let manifest = Core.executeAuthoringCommand(null, { command: 'initialize-document', input: { module: 'session', resourceNaming: 'source', name: 'Session', width: 320, height: 240, rootLayerId: 'document-root', rootLayerName: 'Session', snapshot } }, { actor: 'human-panel' }).manifest;
  manifest = Core.executeAuthoringCommand(manifest, { command: 'sync-layer-tree', input: { snapshot } }, { actor: 'human-panel' }).manifest;
  manifest = Core.executeAuthoringCommand(manifest, { command: 'capture-baseline', input: { snapshot } }, { actor: 'human-panel' }).manifest;
  calls.length = 0;
  const saveStarted = Date.now();
  const written = await xmp.writeManifest(manifest, true);
  assert.equal(written.verifiedManifest, manifest);
  assert.deepEqual(JSON.parse(JSON.stringify(await xmp.readManifest())), JSON.parse(JSON.stringify(manifest)));
  assert.deepEqual(JSON.parse(fs.readFileSync(written.sidecarPath, 'utf8')), JSON.parse(JSON.stringify(manifest)));
  assert.equal(calls.filter(call => call.method === 'readManifest').length, 0);
  report.measurements.push({ mode: 'verified XMP + sidecar + PSD save', milliseconds: Date.now() - saveStarted, calls: calls.slice(), manifestBytes: Buffer.byteLength(JSON.stringify(manifest)) });
  record('real XMP, sidecar, PSD save and receipt cache preserve the complete manifest');
  const originalName = selected.name;
  await ps.core.executeAsModal(async execution => {
    const token = await execution.hostControl.suspendHistory({ documentID: fixture.documentId, name: 'PSD2UI acceptance undo' });
    selected.name = 'Acceptance temporary rename'; await ps.flush();
    await execution.hostControl.resumeHistory(token, false);
  });
  assert.equal(selected.name, originalName);
  record('history rollback restores original layer identity and name');
  const exportSnapshot = documentApi.createSnapshot('document-root');
  const prepared = Core.executeAuthoringCommand(manifest, { command: 'prepare-default-export', input: { snapshot: exportSnapshot } }, { actor: 'human-panel' });
  const bundle = Core.buildBundle(prepared.manifest, exportSnapshot);
  const exporter = load(path.join(root, 'Plus-ins/PSD2UI/src/exporter.js'));
  const exportPath = path.join(output, 'export'); fs.mkdirSync(exportPath, { recursive: true });
  calls.length = 0;
  const exportResult = await exporter.writeBundle(bundle, { uiResPath: exportPath });
  const expectedResources = sourcePath ? 7 : 6;
  assert.equal(exportResult.resourceCount, expectedResources);
  assert.equal(exportResult.sourceReuse.length, sourcePath ? 2 : 1);
  assert.equal(exportResult.sourceReuse[0].reusedLayerIds.length, 1);
  assert.equal(calls.filter(call => call.method === 'savePng').length, expectedResources, 'render each resource once');
  assert.equal(calls.filter(call => call.method === 'exportPixels').length, 0, 'reuse must not read per-pixel data');
  const outputJson = JSON.parse(fs.readFileSync(exportResult.json, 'utf8'));
  assert.deepEqual(outputJson, JSON.parse(JSON.stringify(bundle)));
  const { PNG } = require('pngjs');
  for (const resource of bundle.resources) {
    const file = path.join(exportPath, exporter.resourceDirectory(resource), resource.fileName);
    const png = PNG.sync.read(fs.readFileSync(file));
    const actualSource = resource.fileName === resourceName + '.png' && fixture.sourceCopies[0];
    assert.equal(png.width, actualSource ? actualSource.width : 80); assert.equal(png.height, actualSource ? actualSource.height : 40);
    assert.equal(Math.max(...png.data.filter((_, index) => index % 4 === 3)), 255, 'node opacity must not be baked into PNG');
  }
  report.export = exportResult;
  record('real shared exporter writes ' + expectedResources + ' PNGs and complete JSON; same-name nodes keep independent opacity');
  report.ok = true;
}

main().catch(error => { report.error = error.stack; process.exitCode = 1; console.error(error.message); }).finally(async () => {
  try {
    if (fixture) await script(resultScript(`for(var i=app.documents.length-1;i>=0;i--) {var d=app.documents[i]; if(d.id===${fixture.documentId} && String(d.fullName.fsName)===${literal(fixture.path)}){app.activeDocument=d;d.close(SaveOptions.DONOTSAVECHANGES);}} for(var i=0;i<app.documents.length;i++) if(app.documents[i].id===${fixture.previous}) app.activeDocument=app.documents[i]; return 'true';`));
  } catch (error) { report.cleanupError = error.message; report.ok = false; process.exitCode = 1; }
  persist(); child.stdin.end(); console.log(JSON.stringify({ ok: report.ok, report: path.join(output, 'result.json') }));
});
