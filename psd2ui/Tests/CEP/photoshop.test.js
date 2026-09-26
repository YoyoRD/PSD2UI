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
function fakeHost(options = {}) {
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
        historyId: options.freezeHistory ? 'unchanged' : JSON.stringify(doc, (key, value) => key === 'activeLayerIds' ? undefined : value && typeof value === 'object' && !Array.isArray(value)
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
      case 'exportLayerPng': {
        const current = stamp();
        if (String(params.expectedHistoryId) !== String(current.documents.find(doc => doc.id === document.id).historyId)) {
          return { ok: false, error: { code: 'PSD2UI_STATE_CHANGED', message: 'Source changed before export' } };
        }
        value = { documentId: document.id, layerId: params.layerId, path: params.path, width: 30, height: 40,
          temporaryDocumentId: 999, closed: true, activeDocumentId: document.id, stamp: current };
        if (options.exportReceipt) value = options.exportReceipt(value);
        return { ok: true, value };
      }
      case 'readVisibility': return { ok: true, value: { layers: params.layerIds.map(id => {
        const layer = find(document.layers, id).layer;
        return { id, visible: layer.visible, ...(params.names ? { name: layer.name } : {}), ...(params.groupIds.includes(String(id))
          ? { bounds: clone(layer.bounds), boundsNoEffects: clone(layer.boundsNoEffects || layer.bounds) } : {}) };
      }) } };
      case 'readGeometry': return { ok: true, value: { layers: params.layerIds.map(id => {
        const layer = find(document.layers, id).layer;
        return { id, bounds: clone(layer.bounds), boundsNoEffects: clone(layer.boundsNoEffects || layer.bounds) };
      }) } };
      case 'beginState': {
        scan = [];
        const currentStamp = stamp();
        const reusedDocumentIds = currentStamp.documents.filter(doc => (params.knownDocuments || []).some(known =>
          known.id === doc.id && known.historyId === doc.historyId)).map(doc => doc.id);
        function collect(documentId, layers, parentId) {
          layers.forEach(layer => {
            scan.push({ documentId, parentId, layer: { ...clone(layer), layers: [],
              deferredBounds: params.deferGeometry === true && layer.kind === 'group' } });
            collect(documentId, layer.layers || [], layer.id);
          });
        }
        state.documents.filter(doc => !reusedDocumentIds.includes(doc.id)).forEach(doc => collect(doc.id, doc.layers, null));
        return { ok: true, value: { token: 'read', stamp: currentStamp, reusedDocumentIds, done: scan.length === 0 } };
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

test('single-resource export preserves cached source wrappers and skips intermediate state scans', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const source = ps.app.activeDocument, first = source.layers[0], revision = ps.core.getSnapshotRevision();
  host.calls.length = 0;
  const receipt = await ps.core.exportLayerPng({ documentId: source.id, layerId: first.id, path: 'C:/Temp/a.png' });
  assert.equal(receipt.closed, true);
  assert.deepEqual(host.calls.map(call => call.method), ['exportLayerPng']);
  assert.ok(host.calls[0].params.expectedHistoryId);
  assert.deepEqual(host.calls[0].params.sourceBounds, { left: 10, top: 20 });
  assert.strictEqual(ps.app.activeDocument, source);
  assert.strictEqual(source.layers[0], first);
  assert.equal(ps.core.getSnapshotRevision(), revision);
});

test('single-resource export drains setters first and rejects stale source without replay', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  ps.app.activeDocument.layers[0].visible = false;
  host.calls.length = 0;
  await ps.core.exportLayerPng({ documentId: 10, layerId: 1, path: 'C:/Temp/a.png' });
  assert.equal(host.calls[0].method, 'setLayer');
  assert.equal(host.calls[host.calls.length - 1].method, 'exportLayerPng');
  host.calls.length = 0;
  host.before = method => { if (method === 'exportLayerPng') host.state.documents[0].layers[0].name = 'Edited meanwhile'; };
  await assert.rejects(ps.core.exportLayerPng({ documentId: 10, layerId: 1, path: 'C:/Temp/b.png' }), { code: 'PSD2UI_STATE_CHANGED' });
  assert.deepEqual(host.calls.map(call => call.method), ['exportLayerPng']);
});

test('single-resource export refuses incomplete cleanup, changed source and wrong result identity', async () => {
  for (const mutate of [
    value => ({ ...value, closed: false }),
    value => ({ ...value, layerId: 2 }),
    value => ({ ...value, path: 'C:/Temp/another.png' }),
    value => ({ ...value, width: 0 }),
    value => ({ ...value, stamp: null }),
    value => { value.stamp.documents.push({ id: 999 }); return value; },
    value => { value.stamp.documents[0].historyId = 'changed'; return value; }
  ]) {
    const host = fakeHost({ exportReceipt: mutate });
    const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
    await ps.initialize();
    host.calls.length = 0;
    await assert.rejects(ps.core.exportLayerPng({ documentId: 10, layerId: 1, path: 'C:/Temp/a.png' }), /回执|已变化/);
    assert.deepEqual(host.calls.map(call => call.method), ['exportLayerPng']);
  }
});

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

test('saved flag refreshes from a probe without rescanning an unchanged PSD', async () => {
  const host = fakeHost({ freezeHistory: true });
  host.state.documents[0].saved = true;
  const ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  assert.equal(ps.app.activeDocument.saved, true);
  host.calls.length = 0;
  host.state.documents[0].saved = false;
  await ps.poll();
  assert.equal(ps.app.activeDocument.saved, false);
  assert.deepEqual(host.calls.map(call => call.method), ['probe']);
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

test('multi-selection batches host calls and metadata-only actions do not start empty tree scans', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize(); host.calls.length = 0;
  const commands = [1, 2, 3].map((id, index) => ({ _obj: 'select', _target: [{ _ref: 'layer', _id: id }],
    ...(index ? { selectionModifier: { _value: 'addToSelection' } } : {}) }));
  assert.equal((await ps.action.batchPlay(commands, {})).length, 3);
  assert.deepEqual(host.calls.map(call => call.method), ['select', 'probe']);
  assert.deepEqual(ps.app.activeDocument.activeLayers.map(layer => layer.id), [1, 2, 3]);
  host.calls.length = 0;
  await ps.app.activeDocument.save();
  assert.deepEqual(host.calls.map(call => call.method), ['save', 'probe']);
});

test('a superseded automatic snapshot stops between pages without publishing or replaying a write', async () => {
  const host = fakeHost(); let current = true;
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const document = ps.app.activeDocument, original = document.layers[0].name;
  const revision = ps.core.getDocumentRevision();
  host.state.documents[0].layers.push(...Array.from({ length: 40 }, (_, i) => pixel(i + 100, 'Extra')));
  host.state.documents[0].layers[0].name = 'Edited';
  host.calls.length = 0;
  host.before = async method => { if (method === 'statePage') current = false; };
  await assert.rejects(ps.poll({ full: true }, () => current), { code: 'PSD2UI_REFRESH_SUPERSEDED' });
  assert.equal(document.layers[0].name, original);
  assert.equal(ps.core.getDocumentRevision(), revision);
  assert.equal(host.calls.filter(call => call.method === 'statePage').length, 1);
  current = true; host.before = null;
  await ps.poll({ full: true }, () => current);
  assert.equal(document.layers.length, 43);
  assert.equal(document.layers[0].name, 'Edited');
});

test('large visibility reads yield in bounded batches and publish atomically', async () => {
  const host = fakeHost(); let current = true, yields = 0;
  host.state.documents[0].layers = Array.from({ length: 80 }, (_, i) => pixel(i + 1, 'Image'));
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => { yields++; } });
  await ps.initialize();
  const documentRevision = ps.core.getDocumentRevision(), snapshotRevision = ps.core.getSnapshotRevision();
  host.state.documents[0].layers.forEach(layer => { layer.visible = false; });
  host.calls.length = 0; yields = 0;
  host.before = async method => { if (method === 'readVisibility') current = false; };
  const hint = { visibility: true, allLayers: true };
  await assert.rejects(ps.poll(hint, () => current), { code: 'PSD2UI_REFRESH_SUPERSEDED' });
  assert.ok(ps.app.activeDocument.layers.every(layer => layer.visible));
  assert.equal(ps.core.getSnapshotRevision(), snapshotRevision);
  current = true; host.before = null; host.calls.length = 0;
  await ps.poll(hint, () => current);
  assert.deepEqual(host.calls.filter(call => call.method === 'readVisibility').map(call => call.params.layerIds.length), [32, 32, 16]);
  assert.equal(yields, 2);
  assert.ok(ps.app.activeDocument.layers.every(layer => !layer.visible));
  assert.equal(ps.core.getDocumentRevision(), documentRevision, 'saved authoring projection is still reusable');
  assert.notEqual(ps.core.getSnapshotRevision(), snapshotRevision, 'live layer projection must see visibility changes');
});

test('an empty incremental snapshot completes without scheduling a host page', async () => {
  const calls = [];
  const ps = createPhotoshopFacade({ transport: async method => {
    calls.push(method);
    return { ok: true, value: method === 'probe' ? { documents: [], activeDocumentId: null } :
      { stamp: { documents: [], activeDocumentId: null }, done: true, reusedDocumentIds: [] } };
  } });
  await ps.initialize();
  assert.deepEqual(calls, ['probe', 'beginState']);
});

test('explicit native rename refreshes identity without recalculating group geometry', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host });
  await ps.initialize();
  const oldRevision = ps.core.getDocumentRevision();
  host.state.documents[0].layers[0].name = 'Renamed'; host.calls.length = 0;
  await ps.poll({ names: true, layerIds: ['1'] });
  assert.deepEqual(host.calls.map(call => call.method), ['probe', 'readVisibility']);
  assert.equal(ps.app.activeDocument.layers[0].name, 'Renamed');
  assert.notEqual(ps.core.getDocumentRevision(), oldRevision);
  assert.equal(ps.core.hasDeferredSnapshot(), false);
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

test('validated large manifests use a raw UTF-8 file and a small fixed-RPC envelope', async () => {
  const fs = require('node:fs');
  const serializedManifest = JSON.stringify({ text: '文"\\\n\u2028\u2029🦆'.repeat(10000), numeric: 0.9960600137710571 });
  const params = { documentID: 22, serializedManifest, namespaceUri: 'https://yoyoengine.dev/psd2ui/1.0/', validated: true };
  let file, envelope;
  const rpc = createHostRpc({ evalScript(script, callback) {
    assert.ok(script.length < 700, 'ES3 only compiles and parses the small control envelope');
    vm.runInNewContext(script, { $: { PSD2UIHost: { dispatch(json) {
      envelope = JSON.parse(json); file = envelope.params.serializedManifestFile;
      assert.match(file, /[a-f0-9]{32}\.manifest\.json$/);
      assert.equal(fs.readFileSync(file, 'utf8'), serializedManifest);
    } } } });
    callback(JSON.stringify({ ok: true, value: { verified: true, documentId: 22, serializedLength: serializedManifest.length } }));
  } });
  const response = await rpc.invoke('writeManifest', params);
  assert.equal(response.value.serializedLength, serializedManifest.length);
  assert.deepEqual(envelope, { method: 'writeManifest', params: { documentID: 22, namespaceUri: params.namespaceUri,
    validated: true, serializedManifestFile: file, serializedManifestLength: serializedManifest.length }, deferState: true });
  assert.equal(params.serializedManifest, serializedManifest, 'transport must not mutate caller parameters');
  assert.equal(fs.existsSync(file), false);
});

for (const outcome of ['failed', 'invalid', 'timeout']) test(`raw Manifest staging lifecycle preserves unknown writes: ${outcome}`, async () => {
  const fs = require('node:fs');
  const params = { documentID: 22, serializedManifest: JSON.stringify({ text: 'x'.repeat(40000) }), validated: true };
  let file, submissions = 0, late;
  const rpc = createHostRpc({ timeoutMilliseconds: 10, evalScript(script, callback) {
    submissions++; late = callback;
    vm.runInNewContext(script, { $: { PSD2UIHost: { dispatch(json) { file = JSON.parse(json).params.serializedManifestFile; } } } });
    if (outcome === 'failed') callback('{"ok":false,"error":{"code":"PSD2UI_XMP_READBACK_FAILED"}}');
    if (outcome === 'invalid') callback('invalid result');
  } });
  try {
    if (outcome === 'failed') {
      assert.equal((await rpc.invoke('writeManifest', params)).ok, false);
      assert.equal(fs.existsSync(file), false, 'a completed host failure has consumed its input');
      assert.equal(rpc.isUncertain(), false);
    } else {
      await assert.rejects(rpc.invoke('writeManifest', params), error => error.code === 'CEP_HOST_RESULT_UNKNOWN');
      assert.equal(fs.existsSync(file), true);
      late('{"ok":true,"value":{"verified":true}}');
      await assert.rejects(rpc.invoke('writeManifest', params), /结果未知/);
      assert.equal(submissions, 1, 'unknown writes must never be replayed');
      assert.equal(fs.existsSync(file), true, 'a late callback cannot retroactively discard uncertain input');
    }
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

for (const allLayers of [false, true]) test(`visibility refresh defers expensive group bounds until explicit refresh (all=${allLayers})`, async () => {
  const host = fakeHost();
  const group = pixel(20, 'Group'); group.kind = 'group'; group.layers = host.state.documents[0].layers;
  host.state.documents[0].layers = [group];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const revision = ps.core.getDocumentRevision(), wrapper = ps.app.activeDocument.layers[0];
  host.calls.length = 0;
  group.layers[1].visible = false; group.bounds.right = 100;
  await ps.poll({ visibility: true, layerIds: ['2'], allLayers });
  assert.equal(wrapper.layers[1].visible, false);
  assert.equal(wrapper.bounds.right, 40, 'auto refresh defers group geometry');
  assert.equal(ps.core.getDocumentRevision(), revision, 'visibility does not invalidate authoring metadata');
  assert.equal(ps.core.hasDeferredSnapshot(), true);
  assert.deepEqual(host.calls.map(c => c.method), ['probe', 'readVisibility']);
  const request = host.calls[1].params;
  assert.deepEqual(request.groupIds, []);
  assert.equal(request.layerIds.length, allLayers ? 4 : 1);
  host.calls.length = 0;
  await ps.poll();
  assert.deepEqual(host.calls.map(c => c.method), ['probe']);
  await ps.refresh();
  assert.ok(host.calls.some(c => c.method === 'readGeometry'), 'explicit commands read only dirty group geometry');
  assert.ok(!host.calls.some(c => c.method === 'statePage'), 'visibility must never force another complete snapshot');
  assert.equal(ps.core.hasDeferredSnapshot(), false);
  assert.equal(wrapper.bounds.right, 100, 'commands must use fresh geometry');
  assert.notEqual(ps.core.getDocumentRevision(), revision, 'resolved geometry refreshes derived authoring presentation');
});

test('unknown edits and invalid or foreign visibility hints use complete snapshots', async () => {
  for (const hint of [{ full: true, visibility: true, layerIds: ['1'] },
    { visibility: true, layerIds: ['999'] }, { visibility: true, layerIds: ['1'], documentIds: ['99'] }]) {
    const host = fakeHost(), ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
    await ps.initialize(); host.calls.length = 0;
    host.state.documents[0].layers[0].name = 'Renamed';
    await ps.poll(hint);
    assert.equal(ps.app.activeDocument.layers[0].name, 'Renamed');
    assert.ok(host.calls.some(c => c.method === 'statePage'));
    assert.ok(!host.calls.some(c => c.method === 'readVisibility'));
  }
});

test('visibility read failures fall back without keeping a partially patched cache', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize(); host.calls.length = 0;
  host.state.documents[0].layers[0].visible = false;
  host.before = async method => { if (method === 'readVisibility') throw Object.assign(new Error('changed'), { code: 'PSD2UI_STATE_CHANGED' }); };
  await ps.poll({ visibility: true, layerIds: ['1'] });
  assert.equal(ps.app.activeDocument.layers[0].visible, false);
  assert.ok(host.calls.some(c => c.method === 'statePage'));
  assert.equal(ps.core.hasDeferredSnapshot(), false);
});

test('visibility invalidates only the changed layer and ancestors, never sibling projections or XMP', async () => {
  const host = fakeHost();
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers.slice(0, 2) });
  host.state.documents[0].layers = [group, host.state.documents[0].layers[2]];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const doc = ps.app.activeDocument, sibling = doc.layers[1], child = doc.layers[0].layers[0];
  const untouched = ps.core.getLayerRevision(sibling), changed = ps.core.getLayerRevision(child), metadata = ps.core.getMetadataRevision();
  group.layers[0].visible = false; host.calls.length = 0;
  await ps.poll({ visibility: true, layerIds: ['1'] });
  assert.equal(ps.core.getLayerRevision(sibling), untouched);
  assert.notEqual(ps.core.getLayerRevision(child), changed);
  await ps.refresh();
  assert.equal(ps.core.getMetadataRevision(), metadata);
  assert.deepEqual(host.calls.filter(c => c.method === 'readGeometry').map(c => c.params.layerIds), [['20']]);
  assert.ok(!host.calls.some(c => ['beginState', 'statePage', 'readManifest'].includes(c.method)));
});

test('group visibility reads one flag and keeps child visibility and unrelated groups intact', async () => {
  const host = fakeHost();
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers });
  host.state.documents[0].layers = [group];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize(); group.visible = false; host.calls.length = 0;
  await ps.poll({ visibility: true, layerIds: ['20'] });
  assert.deepEqual(host.calls.find(c => c.method === 'readVisibility').params.layerIds, ['20']);
  assert.ok(ps.app.activeDocument.layers[0].layers.every(layer => layer.visible));
});

test('unknown native edits use descriptor snapshots and resolve only affected group bounds on demand', async () => {
  const host = fakeHost();
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers.slice(0, 1) });
  const other = Object.assign(pixel(30, 'Other'), { kind: 'group', layers: host.state.documents[0].layers.slice(1) });
  host.state.documents[0].layers = [group, other];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  group.layers[0].bounds.right = 200; group.bounds.right = 200; host.calls.length = 0;
  await ps.poll({ history: true });
  assert.equal(host.calls.find(c => c.method === 'beginState').params.deferGeometry, true);
  assert.equal(ps.app.activeDocument.layers[0].bounds.right, 40);
  assert.equal(ps.app.activeDocument.layers[0].layers[0].bounds.right, 200);
  host.calls.length = 0; await ps.refresh();
  assert.equal(ps.app.activeDocument.layers[0].bounds.right, 200);
  assert.deepEqual(host.calls.filter(c => c.method === 'readGeometry').map(c => c.params.layerIds), [['20']]);
});

test('geometry read conflicts never publish a partial set or clear pending invalidations', async () => {
  const host = fakeHost();
  const child = host.state.documents[0].layers[0];
  const nested = Object.assign(pixel(21, 'Nested'), { kind: 'group', layers: [child] });
  host.state.documents[0].layers = [Object.assign(pixel(20, 'Group'), { kind: 'group', layers: [nested] })];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize(); child.visible = false; nested.bounds.right = 200;
  await ps.poll({ visibility: true, layerIds: ['1'] });
  let reads = 0;
  host.before = async method => { if (method === 'readGeometry' && ++reads === 2) throw Object.assign(new Error('changed'), { code: 'PSD2UI_STATE_CHANGED' }); };
  await assert.rejects(ps.refresh(), { code: 'PSD2UI_STATE_CHANGED' });
  assert.equal(ps.app.activeDocument.layers[0].layers[0].bounds.right, 40);
  assert.equal(ps.core.hasDeferredSnapshot(), true);
  host.before = null; await ps.refresh();
  assert.equal(ps.app.activeDocument.layers[0].layers[0].bounds.right, 200);
  assert.equal(ps.core.hasDeferredSnapshot(), false);
});

test('queued visibility writes invalidate cached projections when Photoshop keeps the same history ID', async () => {
  const host = fakeHost({ freezeHistory: true });
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers.slice(0, 2) });
  host.state.documents[0].layers = [group, host.state.documents[0].layers[2]];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const doc = ps.app.activeDocument, wrapper = doc.layers[0], layer = wrapper.layers[0], sibling = doc.layers[1];
  const projection = projectionsFor(ps);
  assert.equal(projection.createSnapshot('document-root').root.children[0].children[0].visible, true);
  const siblingRevision = ps.core.getLayerRevision(sibling), metadataRevision = ps.core.getMetadataRevision();
  host.calls.length = 0;
  layer.visible = false;
  group.bounds.right = 200;
  await ps.flush();
  assert.equal(projection.createSnapshot('document-root').root.children[0].children[0].visible, false);
  assert.equal(layer.descriptor.visible, false);
  assert.equal(ps.core.getLayerRevision(sibling), siblingRevision);
  assert.equal(ps.core.getMetadataRevision(), metadataRevision);
  assert.equal(ps.core.hasDeferredSnapshot(), true);
  assert.ok(!host.calls.some(call => call.method === 'statePage'));
  await ps.refresh();
  assert.equal(wrapper.bounds.right, 200);
  assert.equal(ps.core.hasDeferredSnapshot(), false);
});

test('cross-document duplication refreshes its known target even when inactive history is cached', async () => {
  const host = fakeHost({ freezeHistory: true });
  host.state.documents.push({ ...clone(host.state.documents[0]), id: 11, layers: [] });
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const source = ps.app.activeDocument.layers[0], target = ps.app.documents[1];
  host.calls.length = 0;
  const copied = await source.duplicate(target, ps.constants.ElementPlacement.PLACEATBEGINNING);
  assert.equal(target.layers[0], copied);
  assert.equal(copied.name, source.name);
  assert.equal(ps.app.activeDocument.id, 10);
  assert.equal(host.calls.filter(call => call.method === 'duplicate').length, 1);
  assert.ok(host.calls.some(call => call.method === 'statePage'));
});

test('programmatic activation reconciles missed visibility changes with unchanged history', async () => {
  const host = fakeHost({ freezeHistory: true });
  host.state.documents.push({ ...clone(host.state.documents[0]), id: 11, path: 'C:/Art/Other.psd' });
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  host.state.documents[1].layers[0].visible = false;
  host.calls.length = 0;
  await projectionsFor(ps).openLocalDocument('C:/Art/Other.psd');
  assert.equal(ps.app.activeDocument.id, 11);
  assert.equal(ps.app.activeDocument.layers[0].visible, false);
  assert.ok(host.calls.some(call => call.method === 'readVisibility' && call.params.documentId === 11));
  assert.ok(!host.calls.some(call => call.method === 'statePage'));
});

function projectionsFor(photoshop) {
  const filename = require('node:path').resolve(__dirname, '../../Plus-ins/PSD2UI/src/photoshopDocument.js');
  const localRequire = require('node:module').createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(require('node:fs').readFileSync(filename, 'utf8'), {
    require: name => name === 'photoshop' ? photoshop : localRequire(name), module, exports: module.exports, console
  }, { filename });
  return module.exports;
}

test('moving a layer between parents updates its cached snapshot parent ID', async () => {
  const host = fakeHost();
  const first = Object.assign(pixel(20, 'First'), { kind: 'group', layers: [host.state.documents[0].layers[0]] });
  const second = Object.assign(pixel(21, 'Second'), { kind: 'group', layers: [host.state.documents[0].layers[1]] });
  host.state.documents[0].layers = [first, second];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const projection = projectionsFor(ps);
  assert.equal(projection.createSnapshot('document-root').root.children[0].children[0].parentId, '20');
  const layer = ps.app.activeDocument.layers[0].layers[0];
  await layer.moveTo(ps.app.activeDocument.layers[1]);
  const moved = projection.createSnapshot('document-root').root.children[1].children.find(child => child.layerId === '1');
  assert.equal(moved.parentId, '21');
});

test('reordering children with equal revisions invalidates the cached parent projection', async () => {
  const host = fakeHost();
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers });
  host.state.documents[0].layers = [group];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const projection = projectionsFor(ps);
  assert.equal(projection.createSnapshot('document-root').root.children[0].children.map(child => child.layerId).join(','), '1,2,3');
  group.layers.reverse();
  await ps.poll({ full: true });
  assert.equal(projection.createSnapshot('document-root').root.children[0].children.map(child => child.layerId).join(','), '3,2,1');
});

test('native visibility without a history change updates the projected layer and notifies the panel once', async () => {
  const host = fakeHost({ freezeHistory: true });
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const projection = projectionsFor(ps), events = [];
  assert.equal(projection.createSnapshot('document-root').root.children[0].visible, true);
  await ps.action.addNotificationListener(['select'], (...args) => events.push(args));
  const metadata = ps.core.getMetadataRevision(), sibling = ps.core.getLayerRevision(ps.app.activeDocument.layers[1]);
  host.state.documents[0].layers[0].visible = false;
  host.calls.length = 0;
  await ps.poll({ visibility: true, layerIds: ['1'] });
  assert.equal(projection.createSnapshot('document-root').root.children[0].visible, false);
  assert.equal(events.length, 1);
  assert.equal(ps.core.getMetadataRevision(), metadata);
  assert.equal(ps.core.getLayerRevision(ps.app.activeDocument.layers[1]), sibling);
  assert.deepEqual(host.calls.map(call => call.method), ['probe', 'readVisibility']);
  await ps.poll({ visibility: true, layerIds: ['1'] });
  await ps.poll();
  assert.equal(events.length, 1, 'repeated flags do not redraw the panel again');
});

test('focus reconciliation repairs a missed history-free visibility event without reading geometry or XMP', async () => {
  const host = fakeHost({ freezeHistory: true });
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers });
  host.state.documents[0].layers = [group];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const projection = projectionsFor(ps), events = [];
  projection.createSnapshot('document-root');
  await ps.action.addNotificationListener(['select'], () => events.push('changed'));
  group.layers[0].visible = false;
  group.bounds.right = 200;
  await ps.poll();
  assert.equal(ps.app.activeDocument.layers[0].layers[0].visible, true, 'the history-only watchdog cannot see the missed flag');
  host.calls.length = 0;
  await ps.poll({ reconcileVisibility: true });
  assert.equal(projection.createSnapshot('document-root').root.children[0].children[0].visible, false);
  assert.equal(ps.app.activeDocument.layers[0].bounds.right, 40, 'focus leaves expensive geometry deferred');
  assert.equal(ps.core.hasDeferredSnapshot(), true);
  assert.equal(events.length, 1);
  assert.deepEqual(host.calls.map(call => call.method), ['probe', 'readVisibility']);
  await ps.refresh({ verifyVisibility: true });
  assert.equal(ps.app.activeDocument.layers[0].bounds.right, 200, 'the next explicit operation obtains precise bounds');
});

test('activating a cached document resolves its own deferred bounds before callers build a snapshot', async () => {
  const host = fakeHost({ freezeHistory: true });
  const child = pixel(31, 'Child');
  const group = Object.assign(pixel(30, 'Other group'), { kind: 'group', layers: [child] });
  host.state.documents.push({ ...clone(host.state.documents[0]), id: 11, name: 'Other.psd', title: 'Other.psd',
    path: 'C:/Art/Other.psd', layers: [group] });
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  child.visible = false;
  group.bounds.right = 200;
  await ps.poll({ visibility: true, documentIds: ['11'], layerIds: ['31'] });
  assert.equal(ps.app.activeDocument.id, 10);
  assert.equal(ps.app.documents[1].layers[0].bounds.right, 40);
  host.calls.length = 0;
  const projection = projectionsFor(ps);
  await projection.openLocalDocument('C:/Art/Other.psd');
  const snapshot = projection.createSnapshot('document-root');
  assert.equal(ps.app.activeDocument.id, 11);
  assert.equal(snapshot.root.children[0].bounds.right, 200);
  assert.equal(snapshot.root.children[0].children[0].visible, false);
  assert.deepEqual(host.calls.filter(call => call.method === 'readGeometry').map(call => [call.params.documentId, call.params.layerIds]), [[11, ['30']]]);
  assert.ok(!host.calls.some(call => call.method === 'statePage'), 'activation must not scan either document');
});

test('switching back reconciles a history-free visibility event received after switching to a document with the same layer ID', async () => {
  const host = fakeHost({ freezeHistory: true });
  const group = Object.assign(pixel(20, 'Group'), { kind: 'group', layers: host.state.documents[0].layers });
  host.state.documents[0].layers = [group];
  host.state.documents.push({ ...clone(host.state.documents[0]), id: 11, name: 'Other.psd', title: 'Other.psd', path: 'C:/Art/Other.psd' });
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const projection = projectionsFor(ps);
  projection.createSnapshot('document-root');
  group.layers[0].visible = false;
  group.bounds.right = 200;
  host.state.activeDocumentId = 11;
  await ps.poll({ visibility: true, layerIds: ['1'] });
  assert.equal(ps.app.activeDocument.layers[0].layers[0].visible, true, 'the other document retains its own same-ID layer flag');
  host.state.activeDocumentId = 10;
  host.calls.length = 0;
  await ps.poll();
  assert.equal(projection.createSnapshot('document-root').root.children[0].children[0].visible, false);
  assert.equal(ps.app.activeDocument.layers[0].bounds.right, 40, 'native document switching does not resolve group bounds');
  assert.equal(ps.core.hasDeferredSnapshot(), true);
  assert.deepEqual(host.calls.map(call => call.method), ['probe', 'readVisibility']);
  assert.equal(host.calls[1].params.documentId, 10);
});

test('idle notifications wait for every queued operation and the outer modal to finish', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const idle = [], remove = ps.addIdleListener(() => idle.push(ps.isBusy()));
  const entered = [deferred(), deferred()], release = [deferred(), deferred()];
  let index = 0;
  host.before = async method => {
    if (method !== 'getXmp') return;
    const current = index++; entered[current].resolve(); await release[current].promise;
  };
  const first = ps.invoke('getXmp', { documentId: 10 });
  const second = ps.invoke('getXmp', { documentId: 10 });
  await entered[0].promise; release[0].resolve(); await first; await entered[1].promise;
  assert.deepEqual(idle, [], 'an earlier response must not announce idle while another operation is queued');
  release[1].resolve(); await second;
  assert.deepEqual(idle, [false]);
  host.before = null;
  await ps.core.executeAsModal(async () => {
    await ps.invoke('getXmp', { documentId: 10 });
    assert.equal(idle.length, 1, 'internal reads do not announce idle during a modal callback');
  });
  assert.deepEqual(idle, [false, false]);
  remove(); await ps.refresh(); assert.equal(idle.length, 2);
});

test('queued modal callbacks never expose a false idle gap between operations', async () => {
  const host = fakeHost(), ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const idle = [], entered = [deferred(), deferred()], release = [deferred(), deferred()];
  const remove = ps.addIdleListener(() => idle.push(ps.isBusy()));
  const first = ps.core.executeAsModal(async () => { entered[0].resolve(); await release[0].promise; });
  const second = ps.core.executeAsModal(async () => { entered[1].resolve(); await release[1].promise; });
  assert.equal(ps.isBusy(), true, 'a queued modal is busy before its callback starts');
  assert.deepEqual(await ps.poll(), { skipped: true });
  await entered[0].promise; release[0].resolve(); await first; await entered[1].promise;
  assert.deepEqual(idle, [], 'the next queued modal keeps notification refresh suspended');
  release[1].resolve(); await second;
  assert.deepEqual(idle, [false]);
  remove();
});

test('export checkpoint rejects native visibility changes without history and reads every layer', async () => {
  const host = fakeHost({ freezeHistory: true });
  const nested = pixel(4, 'Nested');
  host.state.documents[0].layers[0].kind = 'group';
  host.state.documents[0].layers[0].layers = [nested];
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const checkpoint = ps.core.getExportSourceCheckpoint(10);
  nested.visible = false;
  host.calls.length = 0;
  await assert.rejects(ps.core.verifyExportSourceCheckpoint(10, checkpoint), { code: 'PSD2UI_EXPORT_SOURCE_CHANGED' });
  assert.equal(ps.app.activeDocument.layers[0].layers[0].visible, false);
  assert.deepEqual(host.calls.find(call => call.method === 'readVisibility').params.layerIds.sort(), ['1', '2', '3', '4']);
});

test('export checkpoint ignores selection and complete cache rereads but rejects history and document changes', async () => {
  const host = fakeHost();
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  const checkpoint = ps.core.getExportSourceCheckpoint(10);
  host.state.documents[0].activeLayerIds = [2];
  await ps.invoke('state', {});
  assert.equal(ps.core.getExportSourceCheckpoint(10), checkpoint);
  await ps.core.verifyExportSourceCheckpoint(10, checkpoint);
  host.state.documents[0].layers[1].bounds.right += 1;
  await assert.rejects(ps.core.verifyExportSourceCheckpoint(10, checkpoint), { code: 'PSD2UI_EXPORT_SOURCE_CHANGED' });
  const secondCheckpoint = ps.core.getExportSourceCheckpoint(10);
  host.state.documents[0].path = 'C:/Art/Renamed.psd';
  await assert.rejects(ps.core.verifyExportSourceCheckpoint(10, secondCheckpoint), { code: 'PSD2UI_EXPORT_SOURCE_CHANGED' });
});

test('export checkpoint refuses unsynchronized setters and an inactive source', async () => {
  const host = fakeHost({ freezeHistory: true });
  host.state.documents.push({ ...clone(host.state.documents[0]), id: 11, name: 'Other.psd' });
  const ps = createPhotoshopFacade({ transport: host, yieldHost: async () => {} });
  await ps.initialize();
  assert.throws(() => ps.core.getExportSourceCheckpoint(11), { code: 'PSD2UI_EXPORT_SOURCE_CHANGED' });
  ps.app.activeDocument.layers[0].visible = false;
  assert.throws(() => ps.core.getExportSourceCheckpoint(10), { code: 'PSD2UI_EXPORT_SOURCE_CHANGED' });
  await ps.flush();
  assert.equal(typeof ps.core.getExportSourceCheckpoint(10), 'string');
});
