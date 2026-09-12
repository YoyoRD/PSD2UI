'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createPhotoshopFacade } = require('../../Plus-ins/PSD2UI-CEP/src/photoshop');
const { createHostRpc, scriptForRequest } = require('../../Plus-ins/PSD2UI-CEP/src/hostRpc');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function pixel(id, name) {
  return { id, name, kind: 'pixel', visible: true, opacity: 100, blendMode: 'normal',
    bounds: { left: 10, top: 20, right: 40, bottom: 60 },
    descriptor: { layerID: id, layerEffects: { scale: { _unit: 'percentUnit', _value: 100 } } }, layers: [] };
}
function fakeHost() {
  let state = { activeDocumentId: 10, documents: [{
    id: 10, name: 'Source.psd', title: 'Source.psd', path: 'C:/Art/Source.psd',
    width: 100, height: 80, resolution: 72, xmp: 'original',
    activeLayerIds: [], layers: [pixel(1, 'A'), pixel(2, 'B'), pixel(3, 'C')]
  }] };
  let nextId = 20;
  const history = new Map();
  const host = { calls: [], before: null, get state() { return state; } };
  let scan = null;
  function stamp() {
    // Model Photoshop's history revision, which changes even with the same
    // selection. Sort only in this fake; production reads a scalar history ID.
    return { activeDocumentId: state.activeDocumentId, version: state.version,
      documents: state.documents.map(doc => ({ ...clone(doc), layers: undefined,
        historyId: JSON.stringify(doc, (key, value) => key === 'activeLayerIds' ? undefined : value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value) })) };
  }
  function find(layers, id) {
    for (let index = 0; index < layers.length; index += 1) {
      if (String(layers[index].id) === String(id)) return { layer: layers[index], siblings: layers, index };
      const nested = find(layers[index].layers || [], id);
      if (nested) return nested;
    }
    return null;
  }
  host.invoke = async (method, params) => {
    host.calls.push({ method, params: clone(params) });
    if (host.before) await host.before(method, params);
    let document = state.documents.find((entry) => String(entry.id) === String(params.documentId));
    const location = document && params.layerId != null ? find(document.layers, params.layerId) : null;
    let value = null;
    switch (method) {
      case 'probe': return { ok: true, value: stamp() };
      case 'beginState': {
        scan = [];
        const currentStamp = stamp();
        const reusedDocumentIds = currentStamp.documents.filter(doc => (params.knownDocuments || []).some(known =>
          known.id === doc.id && known.historyId === doc.historyId)).map(doc => doc.id);
        function collect(documentId, layers, parentId) {
          layers.forEach(layer => {
            scan.push({ documentId, parentId, layer: { ...clone(layer), layers: [] } });
            collect(documentId, layer.layers || [], layer.id);
          });
        }
        state.documents.filter(doc => !reusedDocumentIds.includes(doc.id)).forEach(doc => collect(doc.id, doc.layers, null));
        return { ok: true, value: { token: 'read', stamp: currentStamp, reusedDocumentIds } };
      }
      case 'statePage': {
        const items = scan.splice(0, 8);
        return { ok: true, value: { items, done: scan.length === 0 } };
      }
      case 'state': value = clone(state); break;
      case 'activate': state.activeDocumentId = document.id; break;
      case 'setLayer':
        ['name', 'visible', 'opacity', 'blendMode'].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(params, key)) location.layer[key] = params[key];
        });
        break;
      case 'translate':
        location.layer.bounds.left += params.offsetX;
        location.layer.bounds.right += params.offsetX;
        location.layer.bounds.top += params.offsetY;
        location.layer.bounds.bottom += params.offsetY;
        break;
      case 'group': {
        const first = find(document.layers, params.layerIds[0]);
        const members = first.siblings.filter((entry) => params.layerIds.includes(entry.id));
        const index = first.index;
        members.forEach((entry) => first.siblings.splice(first.siblings.indexOf(entry), 1));
        const group = Object.assign(pixel(nextId++, params.name), { kind: 'group', layers: members });
        first.siblings.splice(index, 0, group);
        value = { layerId: group.id };
        break;
      }
      case 'duplicate': {
        const target = state.documents.find((entry) => String(entry.id) === String(params.targetDocumentId));
        const duplicate = clone(location.layer);
        duplicate.id = nextId++;
        if (target) target.layers.unshift(duplicate);
        else location.siblings.splice(location.index, 0, duplicate);
        value = { layerId: duplicate.id };
        break;
      }
      case 'move': {
        location.siblings.splice(location.index, 1);
        const target = params.parentId === 'document-root' ? document.layers : find(document.layers, params.parentId).layer.layers;
        const before = params.beforeId != null ? target.findIndex((layer) => layer.id === params.beforeId) : -1;
        target.splice(before < 0 ? target.length : before, 0, location.layer);
        break;
      }
      case 'ungroup':
        location.siblings.splice(location.index, 1, ...location.layer.layers);
        value = { childIds: location.layer.layers.map((layer) => layer.id) };
        break;
      case 'delete': location.siblings.splice(location.index, 1); break;
      case 'select':
        document.activeLayerIds = params.add
          ? Array.from(new Set(document.activeLayerIds.concat(params.layerIds))) : params.layerIds.slice();
        break;
      case 'beginHistory': {
        const id = nextId++;
        history.set(id, clone(state));
        value = { id, documentId: document.id };
        break;
      }
      case 'endHistory':
        if (!params.commit) state = clone(history.get(params.token.id));
        history.delete(params.token.id);
        break;
      case 'addDocument':
        document = { id: nextId++, title: params.name, name: params.name, path: '',
          width: params.width, height: params.height, resolution: 72,
          layers: [pixel(1, 'Blank')], activeLayerIds: [1], xmp: '' };
        state.documents.push(document);
        state.activeDocumentId = document.id;
        value = { documentId: document.id };
        break;
      case 'open':
        document = state.documents.find((entry) => entry.path === params.path);
        state.activeDocumentId = document.id;
        value = { documentId: document.id };
        break;
      case 'close':
        state.documents = state.documents.filter((entry) => entry !== document);
        state.activeDocumentId = state.documents.length ? state.documents[0].id : null;
        break;
      case 'save': case 'savePng': case 'trim': break;
      case 'getXmp': value = document.xmp; break;
      case 'setXmp': document.xmp = params.xmp; break;
      default: return { ok: false, error: { code: 'UNSUPPORTED', message: method } };
    }
    // CEP requests deferState: true; mutations never carry an implicit full tree.
    return { ok: true, value };
  };
  return host;
}

test('wrappers and child collections stay stable across grouping, move, ungroup and deletion', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const document = ps.app.activeDocument;
  const layers = document.layers;
  const first = layers[0];
  const second = layers[1];
  const group = await document.createLayerGroup({ name: 'Container', fromLayers: [first, second] });
  assert.strictEqual(ps.app.activeDocument, document);
  assert.strictEqual(document.layers, layers);
  assert.strictEqual(group.layers[0], first);
  assert.strictEqual(first.parent, group);
  await second.moveTo(document, { beforeId: group.id });
  assert.strictEqual(layers[0], second);
  assert.strictEqual(second.parent, document);
  await group.ungroup();
  assert.strictEqual(first.parent, document);
  assert.equal(document.layers.some((layer) => layer.id === group.id), false);
  await first.delete();
  assert.throws(() => { first.name = 'stale'; }, /图层已删除/);
});

test('queued setters flush before async operations and later optimistic setters survive prior responses', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const layer = ps.app.activeDocument.layers[0];
  const entered = deferred();
  const release = deferred();
  host.before = async (method) => {
    if (method === 'setLayer') { entered.resolve(); await release.promise; }
  };
  layer.name = 'Renamed';
  const flush = ps.flush();
  await entered.promise;
  layer.visible = false;
  release.resolve();
  await flush;
  await layer.translate(3, -2);
  assert.equal(layer.name, 'Renamed');
  assert.equal(layer.visible, false);
  assert.deepEqual(layer.bounds, { left: 13, top: 18, right: 43, bottom: 58 });
  assert.deepEqual(host.calls.map(entry => entry.method).filter(method => !['probe', 'beginState', 'statePage'].includes(method)),
    ['setLayer', 'setLayer', 'translate']);
});

test('new document IDs and duplicate wrappers belong to their actual target document', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const source = ps.app.activeDocument;
  const sourceLayer = source.layers[0];
  const output = await ps.app.documents.add({ width: 30, height: 40, name: 'PSD2UI_tmp' });
  assert.strictEqual(ps.app.activeDocument, output);
  assert.notStrictEqual(output.layers[0], sourceLayer); // Both documents contain layer ID 1.
  ps.app.activeDocument = source;
  const copy = await sourceLayer.duplicate(output, ps.constants.ElementPlacement.PLACEATBEGINNING);
  assert.strictEqual(copy.parent, output);
  await copy.translate(-10, -20);
  assert.equal(sourceLayer.bounds.left, 10);
  assert.equal(copy.bounds.left, 0);
  await output.saveAs.png({ nativePath: 'C:/Temp/out.png' }, { compression: 6 }, true);
  const saved = host.calls.find((entry) => entry.method === 'savePng');
  assert.equal(saved.params.documentId, output.id);
  assert.equal(saved.params.path, 'C:/Temp/out.png');
  await output.closeWithoutSaving();
  assert.equal(ps.app.documents.includes(output), false);
  assert.strictEqual(await ps.app.open({ nativePath: source.path }), source);
});

test('duplicate without a target preserves its parent instead of requesting a document-root copy', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const document = ps.app.activeDocument;
  const first = document.layers[0];
  const group = await document.createLayerGroup({ name: 'Container', fromLayers: document.layers.slice(0, 2) });
  const copied = await first.duplicate();
  assert.strictEqual(copied.parent, group);
  assert.equal(host.calls.find((entry) => entry.method === 'duplicate').params.targetDocumentId, undefined);
});

test('synchronous descriptors do not invoke host and additive selection preserves an empty initial selection', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const document = ps.app.activeDocument;
  assert.deepEqual(document.activeLayers, []);
  const count = host.calls.length;
  const result = ps.action.batchPlay([{ _obj: 'get', _target: { _ref: [
    { _property: 'layerEffects' }, { _ref: 'layer', _id: 1 }, { _ref: 'document', _id: 10 }
  ] } }], { synchronousExecution: true });
  assert.equal(result[0].layerEffects.scale._value, 100);
  assert.equal(host.calls.length, count);
  await ps.action.batchPlay([
    { _obj: 'select', _target: [{ _ref: 'layer', _id: 2 }], makeVisible: false },
    { _obj: 'select', _target: [{ _ref: 'layer', _id: 3 }],
      selectionModifier: { _value: 'addToSelection' }, makeVisible: false }
  ], {});
  assert.deepEqual(document.activeLayers.map((layer) => layer.id), [2, 3]);
  await assert.rejects(ps.action.batchPlay([{ _obj: 'unimplemented', _target: [{ _ref: 'document', _id: 10 }] }], {}), /尚未实现/);
});

test('failed structural transaction discards pending setters and restores original wrappers', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const document = ps.app.activeDocument;
  const first = document.layers[0];
  await assert.rejects(ps.core.executeAsModal(async (context) => {
    const token = await context.hostControl.suspendHistory({ documentID: 10, name: 'Group' });
    const group = await document.createLayerGroup({ name: 'Bad', fromLayers: document.layers.slice(0, 2) });
    group.blendMode = 'passThrough';
    first.name = 'Must never reach host';
    await context.hostControl.resumeHistory(token, false);
    throw new Error('cancelled plan');
  }), /cancelled plan/);
  assert.strictEqual(document.layers[0], first);
  assert.equal(first.name, 'A');
  assert.strictEqual(first.parent, document);
  assert.equal(host.calls.some((entry) => entry.method === 'setLayer'), false);
  assert.equal(ps.isBusy(), false);
});

test('modal callbacks serialize and polling skips active work', async () => {
  const ps = createPhotoshopFacade({ transport: fakeHost() });
  await ps.initialize();
  const entered = deferred();
  const release = deferred();
  const order = [];
  const first = ps.core.executeAsModal(async () => {
    order.push('first'); entered.resolve(); await release.promise; order.push('first-end');
  });
  await entered.promise;
  const second = ps.core.executeAsModal(() => { order.push('second'); });
  assert.deepEqual(await ps.poll(), { skipped: true });
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'first-end', 'second']);
  assert.equal(ps.core.isBusy(), false);
});

test('selection polling notifies only after a change and errors preserve host code', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const events = [];
  const listener = (name) => events.push(name);
  await ps.action.addNotificationListener(['select', 'open', 'close'], listener);
  await ps.poll();
  assert.deepEqual(events, []);
  host.state.documents[0].activeLayerIds = [2];
  await ps.poll();
  await ps.poll();
  assert.deepEqual(events, ['select']);
  await ps.action.removeNotificationListener(['select'], listener);
  host.state.documents[0].activeLayerIds = [3];
  await ps.poll();
  assert.deepEqual(events, ['select']);
  await assert.rejects(ps.invoke('bad', {}), (error) => error.code === 'UNSUPPORTED');
});

test('unchanged polling and read-only XMP calls never request a layer page', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host });
  await ps.initialize(); host.calls.length = 0;
  for (let i = 0; i < 10; i++) await ps.poll();
  assert.deepEqual(host.calls.map(call => call.method), Array(10).fill('probe'));
  await ps.invoke('getXmp', { documentId: 10 });
  assert.equal(host.calls.at(-1).method, 'getXmp');
});

test('selection changes and repeated action refreshes reuse the tree without reading pages', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host });
  await ps.initialize(); host.calls.length = 0;
  const target = ps.app.activeDocument.layers[1];
  const revision = ps.core.getDocumentRevision();
  host.state.documents[0].activeLayerIds = [target.id];
  const events = [];
  await ps.action.addNotificationListener(['select'], () => events.push('select'));
  await ps.poll(); await ps.refresh(); await ps.refresh();
  assert.deepEqual(host.calls.map(call => call.method), ['probe', 'probe', 'probe']);
  assert.deepEqual(events, ['select']);
  assert.strictEqual(ps.app.activeDocument.activeLayers[0], target);
  assert.equal(ps.core.getDocumentRevision(), revision, 'selection retains cached panel projections');
  host.state.documents[0].layers[1].name = 'Edited';
  await ps.poll();
  assert.notEqual(ps.core.getDocumentRevision(), revision, 'content edits invalidate panel projections');
});

test('opening and editing another document retain the unchanged document tree and revision', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const original = ps.app.activeDocument, layer = original.layers[0];
  const revision = ps.core.getDocumentRevision();
  host.calls.length = 0;
  await ps.app.documents.add({ name: 'Temporary', width: 32, height: 32 });
  assert.equal(host.calls.filter(call => call.method === 'statePage').length, 1);
  const begin = host.calls.find(call => call.method === 'beginState');
  assert.deepEqual(begin.params.knownDocuments.map(doc => doc.id), [original.id]);
  assert.strictEqual(original.layers[0], layer);
  ps.app.activeDocument = original;
  await ps.flush();
  assert.equal(ps.core.getDocumentRevision(), revision);
  host.calls.length = 0;
  await ps.app.open({ nativePath: original.path });
  ps.app.activeDocument = original;
  await ps.flush();
  assert.equal(host.calls.some(call => call.method === 'activate'), false, 'opening an active document does not queue another activation');
  assert.equal(ps.core.getDocumentRevision(), revision);
});

test('paged reads yield and keep the previous snapshot when a later page fails', async () => {
  const host = fakeHost();
  let yields = 0;
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => { yields++; } });
  await ps.initialize();
  const original = ps.app.activeDocument.layers[0];
  host.state.documents[0].layers = Array.from({ length: 24 }, (_, i) => pixel(100 + i, 'New ' + i));
  let pages = 0;
  host.before = async method => {
    if (method === 'statePage' && ++pages === 2) throw new Error('Read interrupted');
  };
  await assert.rejects(ps.refresh(), /Read interrupted/);
  assert.equal(yields, 3); assert.equal(pages, 2);
  assert.strictEqual(ps.app.activeDocument.layers[0], original);
  assert.equal(ps.app.activeDocument.layers.length, 3);
  host.before = null;
  await ps.refresh();
  assert.equal(ps.app.activeDocument.layers.length, 24);
});

test('polling refreshes unchanged selections after document, nested layer and descriptor edits', async () => {
  const host = fakeHost();
  const document = host.state.documents[0];
  const layer = document.layers.shift();
  const group = Object.assign(pixel(40, 'Group'), { kind: 'group', layers: [layer] });
  document.layers.unshift(group);
  document.activeLayerIds = [layer.id];
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const selected = ps.app.activeDocument.activeLayers[0];
  const events = [];
  await ps.action.addNotificationListener(['select'], (name, descriptor) => events.push({ name, descriptor }));
  const changes = [
    ['nested layer name', () => { layer.name = 'Renamed externally'; }],
    ['visibility', () => { layer.visible = false; }],
    ['opacity', () => { layer.opacity = 70; }],
    ['blend mode', () => { layer.blendMode = 'multiply'; }],
    ['bounds', () => { layer.bounds.right += 4; }],
    ['clipping', () => { layer.clipped = true; }],
    ['text', () => { layer.kind = 'text'; layer.textItem = { contents: 'Changed text' }; }],
    ['effects', () => { layer.descriptor.layerEffects.scale._value = 125; }],
    ['descriptor-only data', () => { layer.descriptor.textKey = { textStyleRange: [{ from: 0, to: 4 }] }; }],
    ['parent', () => { group.layers.pop(); document.layers.push(layer); }],
    ['sibling order', () => { document.layers.reverse(); }],
    ['document name', () => { document.name = 'Renamed.psd'; document.title = document.name; }],
    ['saved path', () => { document.path = 'C:/Art/Renamed.psd'; }],
    ['canvas', () => { document.width += 10; document.height += 20; }],
    ['resolution', () => { document.resolution = 144; }],
    ['authoring XMP', () => { document.xmp = '<xmp>updated configuration</xmp>'; }]
  ];
  for (const [label, change] of changes) {
    const count = events.length;
    change();
    assert.deepEqual(await ps.poll(), { skipped: false });
    assert.equal(events.length, count + 1, label + ' must notify');
    assert.deepEqual(events[count], { name: 'select', descriptor: { documentID: 10 } });
    assert.strictEqual(ps.app.activeDocument.activeLayers[0], selected, label + ' preserves selected wrapper');
    await ps.poll();
    assert.equal(events.length, count + 1, label + ' must not repeat');
  }
  assert.equal(selected.name, 'Renamed externally');
  assert.strictEqual(selected.parent, ps.app.activeDocument);
  assert.equal(selected.descriptor.layerEffects.scale._value, 125);
});

test('polling ignores object key order and skips queued or in-flight writes without consuming changes', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const events = [];
  await ps.action.addNotificationListener(['select'], (name) => events.push(name));
  const rawLayer = host.state.documents[0].layers[0];
  rawLayer.descriptor = { layerEffects: rawLayer.descriptor.layerEffects, layerID: rawLayer.id };
  await ps.poll();
  assert.deepEqual(events, []);

  ps.app.activeDocument.layers[0].name = 'Queued edit';
  const beforeSkippedPoll = host.calls.length;
  assert.deepEqual(await ps.poll(), { skipped: true });
  assert.equal(host.calls.length, beforeSkippedPoll);
  assert.deepEqual(events, []);
  const entered = deferred();
  const release = deferred();
  host.before = async (method) => {
    if (method === 'setLayer') { entered.resolve(); await release.promise; }
  };
  const pending = ps.flush();
  await entered.promise;
  assert.deepEqual(await ps.poll(), { skipped: true });
  assert.deepEqual(events, []);
  release.resolve();
  await pending;
  await ps.poll();
  await ps.poll();
  assert.deepEqual(events, ['select']);
  assert.equal(ps.app.activeDocument.layers[0].name, 'Queued edit');
});

test('evalScript request preserves quotes, paths and ES3 line separators as data', async () => {
  const params = { name: 'a"); throw new Error("injected"); //\u2028\u2029', path: 'C:\\美术\\x.psd', text: '\n\"\'' };
  const script = scriptForRequest('setLayer', params);
  assert.equal(script.includes('\u2028'), false);
  assert.equal(script.includes('\u2029'), false);
  let captured;
  vm.runInNewContext(script, { $: { PSD2UIHost: { dispatch(json) { captured = JSON.parse(json); } } } });
  assert.deepEqual(captured, { method: 'setLayer', params, deferState: true });
  const rpc = createHostRpc({ evalScript(expression, callback) {
    assert.equal(expression, script);
    callback('{"ok":true,"value":123}');
  } });
  assert.equal((await rpc.invoke('setLayer', params)).value, 123);
});

test('large RPC payloads remain data and completed requests clean up their staging file', async () => {
  const fs = require('node:fs');
  const params = { serializedManifest: JSON.stringify({ value: '文"\\\n'.repeat(10000) }) };
  let file, captured;
  const rpc = createHostRpc({ evalScript(script, callback) {
    assert.ok(script.length < 300, 'large payload must not be compiled as a script literal');
    vm.runInNewContext(script, { $: { PSD2UIHost: { dispatchFile(name) {
      file = name; captured = JSON.parse(fs.readFileSync(file, 'utf8'));
    } } } });
    callback('{"ok":true,"value":123}');
  } });
  assert.equal((await rpc.invoke('writeManifest', params)).value, 123);
  assert.deepEqual(captured, { method: 'writeManifest', params, deferState: true });
  assert.equal(fs.existsSync(file), false);
  const unknown = createHostRpc({ timeoutMilliseconds: 5, evalScript(script) {
    vm.runInNewContext(script, { $: { PSD2UIHost: { dispatchFile(name) { file = name; } } } });
  } });
  try {
    await assert.rejects(unknown.invoke('writeManifest', params), error => error.code === 'CEP_HOST_RESULT_UNKNOWN');
    assert.equal(fs.existsSync(file), true, 'unknown host may still need the input file');
  } finally { if (file && fs.existsSync(file)) fs.unlinkSync(file); }
});

test('host RPC serializes requests and a timeout blocks reissue of unknown writes', async () => {
  const pending = [];
  const rpc = createHostRpc({ timeoutMilliseconds: 1000, evalScript(script, callback) { pending.push(callback); } });
  const first = rpc.invoke('state', {});
  const second = rpc.invoke('state', {});
  await Promise.resolve();
  assert.equal(pending.length, 1);
  pending[0]('{"ok":true,"value":1}');
  await first;
  await Promise.resolve();
  pending[1]('{"ok":true,"value":2}');
  assert.equal((await second).value, 2);

  let attempts = 0;
  const unknown = createHostRpc({ timeoutMilliseconds: 5, evalScript() { attempts += 1; } });
  await assert.rejects(unknown.invoke('duplicate', {}), (error) => error.code === 'CEP_HOST_RESULT_UNKNOWN');
  await assert.rejects(unknown.invoke('duplicate', {}), /结果未知/);
  assert.equal(attempts, 1);
  assert.equal(unknown.isUncertain(), true);
});
