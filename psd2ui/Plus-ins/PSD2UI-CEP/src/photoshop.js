'use strict';

const defaultTransport = require('./hostRpc');

const constants = Object.freeze({
  BlendMode: Object.freeze({ NORMAL: 'normal', PASSTHROUGH: 'passThrough' }),
  ElementPlacement: Object.freeze({ PLACEATBEGINNING: 'placeAtBeginning' }),
  TrimType: Object.freeze({ TRANSPARENT: 'transparent' }),
  SaveOptions: Object.freeze({ DONOTSAVECHANGES: 'doNotSaveChanges' })
});

function nativePath(entry) {
  const value = typeof entry === 'string' ? entry : entry && entry.nativePath;
  if (!value) throw new Error('Photoshop 文件操作需要本地文件 nativePath。');
  return String(value);
}

function createPhotoshopFacade(options) {
  const configuration = options || {};
  const transport = configuration.transport || defaultTransport;
  const documentCache = new Map();
  const layerCache = new Map();
  const documents = [];
  const listeners = [];
  let activeDocumentId = null;
  let pendingWrites = [];
  let operationTail = Promise.resolve();
  let modalTail = Promise.resolve();
  let operations = 0;
  let modalRunning = false;
  let stateSignature = '';
  let snapshotStamp = '';
  let snapshotProbe = null;
  let contentRevision = 0;
  const yieldHost = configuration.yieldHost || (() => new Promise(resolve => setTimeout(resolve, 20)));

  function schedule(operation) {
    operations += 1;
    const result = operationTail.then(operation);
    operationTail = result.then(() => { operations -= 1; }, () => { operations -= 1; });
    return result;
  }

  function requireDocument(id) {
    const result = documentCache.get(String(id));
    if (!result || !result._present) throw new Error('Photoshop 文档已关闭或不存在：' + id);
    return result;
  }

  function requireLayer(documentId, layerId) {
    const result = layerCache.get(String(documentId) + ':' + String(layerId));
    if (!result || !result._present) throw new Error('Photoshop 图层已删除或不存在：' + layerId);
    return result;
  }

  function queueWrite(method, params, apply) {
    pendingWrites.push({ method, params, apply });
    apply();
  }

  function defineDataProperties(target, names) {
    names.forEach((name) => Object.defineProperty(target, name, {
      enumerable: true,
      get() { return target._data[name]; }
    }));
  }

  function makeLayer(documentId, data) {
    const layer = {};
    Object.defineProperties(layer, {
      _data: { value: {}, writable: true },
      _present: { value: true, writable: true },
      _documentId: { value: documentId },
      parent: { value: null, writable: true, enumerable: true },
      layers: { value: [], enumerable: true }
    });
    defineDataProperties(layer, ['id', 'kind', 'bounds', 'boundsNoEffects', 'clipped',
      'hasLayerMask', 'hasVectorMask', 'textItem', 'descriptor', 'isBackgroundLayer']);
    ['name', 'visible', 'opacity', 'blendMode'].forEach((property) => {
      Object.defineProperty(layer, property, {
        enumerable: true,
        get() { return layer._data[property]; },
        set(value) {
          requireLayer(documentId, layer.id);
          const params = { documentId, layerId: layer.id };
          params[property] = value;
          queueWrite('setLayer', params, () => { layer._data[property] = value; });
        }
      });
    });
    layer.duplicate = async (target, placement) => {
      requireLayer(documentId, layer.id);
      const targetDocumentId = target ? requireDocument(target.id).id : documentId;
      const value = await invoke('duplicate', {
        documentId, layerId: layer.id,
        targetDocumentId: target ? targetDocumentId : undefined,
        placement: placement || null
      });
      return requireLayer(targetDocumentId, value && (value.layerId != null ? value.layerId : value.id));
    };
    layer.translate = (offsetX, offsetY) => invoke('translate', {
      documentId, layerId: requireLayer(documentId, layer.id).id,
      offsetX: Number(offsetX), offsetY: Number(offsetY)
    });
    layer.moveTo = (parent, input) => {
      requireLayer(documentId, layer.id);
      const params = input || {};
      let parentId = 'document-root';
      if (parent && parent !== requireDocument(documentId) && parent !== 'document-root') {
        parentId = requireLayer(documentId, typeof parent === 'object' ? parent.id : parent).id;
      }
      return invoke('move', { documentId, layerId: layer.id, parentId,
        beforeId: params.beforeId, afterId: params.afterId });
    };
    layer.ungroup = () => invoke('ungroup', { documentId, layerId: requireLayer(documentId, layer.id).id });
    layer.delete = () => invoke('delete', { documentId, layerId: requireLayer(documentId, layer.id).id });
    layer._data = data;
    return layer;
  }

  function makeDocument(data) {
    const document = {};
    Object.defineProperties(document, {
      _data: { value: {}, writable: true },
      _present: { value: true, writable: true },
      _revision: { value: 0, writable: true },
      layers: { value: [], enumerable: true },
      activeLayers: { enumerable: true, get() {
        return (document._data.activeLayerIds || []).map((id) =>
          layerCache.get(String(document.id) + ':' + String(id))).filter((layer) => layer && layer._present);
      } }
    });
    defineDataProperties(document, ['id', 'title', 'name', 'path', 'width', 'height', 'resolution', 'xmp']);
    document.createLayerGroup = async (input) => {
      const params = input || {};
      const value = await invoke('group', {
        documentId: requireDocument(document.id).id,
        name: params.name,
        layerIds: (params.fromLayers || []).map((layer) => requireLayer(document.id, layer.id).id)
      });
      return requireLayer(document.id, value && (value.layerId != null ? value.layerId : value.id));
    };
    document.save = () => invoke('save', { documentId: requireDocument(document.id).id });
    document.closeWithoutSaving = () => invoke('close', { documentId: requireDocument(document.id).id });
    document.close = (saveOption) => {
      if (saveOption !== constants.SaveOptions.DONOTSAVECHANGES) {
        return Promise.reject(new Error('CEP 兼容层只支持显式 closeWithoutSaving。'));
      }
      return document.closeWithoutSaving();
    };
    document.trim = (type) => invoke('trim', { documentId: requireDocument(document.id).id, type });
    document.saveAs = { png: (file, params, asCopy) => invoke('savePng', {
      documentId: requireDocument(document.id).id, path: nativePath(file), options: params || {}, asCopy: asCopy === true
    }) };
    document._data = data;
    return document;
  }

  function replaceArray(target, values) {
    target.length = 0;
    values.forEach((value) => target.push(value));
  }

  function applyState(state) {
    if (!state || !Array.isArray(state.documents)) throw new Error('Photoshop 宿主未返回完整文档状态。');
    app.version = String(state.version || '');
    contentRevision += 1;
    documentCache.forEach((document) => { document._present = false; });
    layerCache.forEach((layer) => { layer._present = false; });
    const next = state.documents.map((data) => {
      const key = String(data.id);
      let document = documentCache.get(key);
      const sameLayers = Boolean(document && document._data.layers === data.layers);
      if (!document) {
        document = makeDocument(data);
        documentCache.set(key, document);
      }
      document._data = data;
      document._present = true;
      if (!sameLayers) document._revision = contentRevision;
      function patchLayers(values, parent) {
        return (values || []).map((entry) => {
          const layerKey = key + ':' + String(entry.id);
          let layer = layerCache.get(layerKey);
          if (!layer) {
            layer = makeLayer(data.id, entry);
            layerCache.set(layerKey, layer);
          }
          layer._data = entry;
          layer._present = true;
          layer.parent = parent;
          replaceArray(layer.layers, patchLayers(entry.layers, layer));
          return layer;
        });
      }
      replaceArray(document.layers, patchLayers(data.layers, document));
      return document;
    });
    replaceArray(documents, next);
    activeDocumentId = state.activeDocumentId;
    // Host responses for an earlier write must not erase later queued setters.
    pendingWrites.forEach((write) => write.apply());
  }

  async function request(method, params) {
    const response = await (typeof transport === 'function' ? transport(method, params) : transport.invoke(method, params));
    if (response && response.state) applyState(response.state);
    if (!response || response.ok !== true) {
      const details = response && response.error;
      const error = new Error(typeof details === 'string' ? details : details && details.message || 'Photoshop CEP 宿主操作失败：' + method);
      if (details && typeof details === 'object') {
        if (details.code) error.code = details.code;
        if (details.issues) error.issues = details.issues;
      }
      throw error;
    }
    return response.value;
  }

  function signature(value) { return JSON.stringify(value); }

  function contentSignature(stamp) {
    return JSON.stringify(stamp, (key, value) => key === 'activeDocumentId' || key === 'activeLayerIds' ? undefined : value);
  }

  async function synchronize(stamp) {
    if (!snapshotProbe || contentSignature(stamp) !== contentSignature(snapshotProbe)) return readState();
    // Clicking another layer/document is not a content edit. Keep the complete
    // cached tree and change only selection; do not rescan hundreds of layers.
    stamp.documents.forEach(data => { requireDocument(data.id)._data.activeLayerIds = data.activeLayerIds.slice(); });
    activeDocumentId = stamp.activeDocumentId;
    snapshotProbe = stamp;
    snapshotStamp = signature(stamp);
    return { activeDocumentId, version: app.version, documents: documents.map(document => document._data) };
  }

  async function readState(forceDocumentIds) {
    for (let attempt = 0; ; attempt++) {
      try {
        const forced = new Set((forceDocumentIds || []).map(String));
        const knownDocuments = snapshotProbe ? snapshotProbe.documents.filter(document => !forced.has(String(document.id))) : [];
        const begin = await request('beginState', { knownDocuments });
        const reused = new Set((begin.reusedDocumentIds || []).map(String));
        const snapshot = Object.assign({}, begin.stamp, {
          documents: begin.stamp.documents.map(document => Object.assign({}, document, {
            layers: reused.has(String(document.id)) ? requireDocument(document.id)._data.layers : []
          }))
        });
        const owners = new Map(snapshot.documents.map(document => [String(document.id), document]));
        const layers = new Map();
        let count = 0;
        for (;;) {
          await yieldHost();
          const page = await request('statePage', { token: begin.token });
          page.items.forEach(item => {
            const key = String(item.documentId) + ':';
            const parent = item.parentId == null ? owners.get(String(item.documentId)) : layers.get(key + item.parentId);
            if (!parent || !Array.isArray(item.layer.layers) || layers.has(key + item.layer.id)) {
              throw new Error('Photoshop 分段状态的图层关系无效，请刷新。');
            }
            parent.layers.push(item.layer);
            layers.set(key + item.layer.id, item.layer);
          });
          count += page.items.length;
          if (typeof globalThis.__PSD2UI_HOST_PROGRESS__ === 'function') globalThis.__PSD2UI_HOST_PROGRESS__(count);
          if (page.done) break;
        }
        applyState(snapshot);
        snapshotProbe = begin.stamp;
        snapshotStamp = signature(begin.stamp);
        return snapshot;
      } catch (error) {
        // Retry an interrupted read once; never replay a write.
        if (error.code !== 'PSD2UI_STATE_CHANGED' || attempt >= 1) throw error;
        await yieldHost();
      }
    }
  }

  async function send(method, params) {
    if (method === 'state') return readState(documents.map(document => document.id));
    const value = await request(method, params);
    // Reads never rescan all layers. Mutations publish a consistent snapshot
    // before their callers inspect cached objects.
    if (['probe', 'notificationEvents', 'getXmp', 'readManifest', 'chooseFolder', 'beginHistory'].indexOf(method) < 0) {
      await readState();
      // XMP changes may not advance Photoshop's pixel history. Invalidate only
      // the panel projection; reading metadata does not require a layer rescan.
      if (['setXmp', 'writeManifest'].indexOf(method) >= 0) {
        const document = requireDocument(params.documentId != null ? params.documentId : params.documentID);
        document._revision = ++contentRevision;
      }
    }
    return value;
  }

  async function drainWrites() {
    let changed = false;
    while (pendingWrites.length) {
      const write = pendingWrites.shift();
      try { await request(write.method, write.params); changed = true; } catch (error) {
        pendingWrites = [];
        // A failed setter can leave optimistic cache values behind. Read once;
        // never repeat a mutation whose completion is unknown.
        try { await send('state', {}); } catch (refreshError) { error.refreshError = refreshError.message; }
        throw error;
      }
    }
    if (changed) await readState();
  }

  function invoke(method, params) {
    return schedule(async () => {
      await drainWrites();
      return send(method, params || {});
    });
  }

  function flush() { return schedule(drainWrites); }
  function refresh() { return schedule(async () => {
    await drainWrites();
    return synchronize(await request('probe', {}));
  }); }

  const app = { documents };
  Object.defineProperty(documents, 'add', { value: async (params) => {
    const value = await invoke('addDocument', params || {});
    return requireDocument(value && (value.documentId != null ? value.documentId : value.id));
  } });
  Object.defineProperty(app, 'activeDocument', {
    enumerable: true,
    get() { return activeDocumentId == null ? null : documentCache.get(String(activeDocumentId)) || null; },
    set(document) {
      const id = requireDocument(document && document.id).id;
      if (String(activeDocumentId) === String(id)) return;
      queueWrite('activate', { documentId: id }, () => { activeDocumentId = id; });
    }
  });
  app.open = async (file) => {
    const value = await invoke('open', { path: nativePath(file) });
    return requireDocument(value && (value.documentId != null ? value.documentId : value.id));
  };

  function references(command) {
    const target = command._target;
    return Array.isArray(target) ? target : target && Array.isArray(target._ref) ? target._ref : target ? [target] : [];
  }

  function targetFor(command) {
    const refs = references(command);
    const documentRef = refs.find((ref) => ref._ref === 'document');
    const layerRef = refs.find((ref) => ref._ref === 'layer');
    const propertyRef = refs.find((ref) => ref._property);
    const document = requireDocument(documentRef && documentRef._id != null ? documentRef._id : activeDocumentId);
    return { document, layer: layerRef ? requireLayer(document.id, layerRef._id) : null,
      property: propertyRef && propertyRef._property };
  }

  function cachedGet(command) {
    const target = targetFor(command);
    if (target.property === 'XMPMetadataAsUTF8') throw new Error('CEP 文档 XMP 按需读取，请使用异步 batchPlay。');
    if (!target.layer) throw new Error('CEP 同步 get 仅支持已缓存图层描述符和文档 XMP。');
    const descriptor = target.layer.descriptor || {};
    if (!target.property) return descriptor;
    const result = {};
    result[target.property] = descriptor[target.property];
    return result;
  }

  const action = {
    batchPlay(commands, params) {
      if (params && params.synchronousExecution) {
        return commands.map((command) => {
          if (command._obj !== 'get') throw new Error('CEP 同步 batchPlay 不支持写操作：' + command._obj);
          return cachedGet(command);
        });
      }
      return schedule(async () => {
        await drainWrites();
        const results = [];
        for (const command of commands) {
          const target = targetFor(command);
          if (command._obj === 'get') {
            if (target.property === 'XMPMetadataAsUTF8') {
              results.push({ XMPMetadataAsUTF8: await send('getXmp', { documentId: target.document.id }) });
            } else results.push(cachedGet(command));
          } else if (command._obj === 'set' && target.property === 'XMPMetadataAsUTF8') {
            await send('setXmp', { documentId: target.document.id, xmp: command.to.XMPMetadataAsUTF8 });
            results.push({});
          } else if (command._obj === 'select' && target.layer) {
            await send('select', { documentId: target.document.id, layerIds: [target.layer.id],
              add: Boolean(command.selectionModifier && command.selectionModifier._value === 'addToSelection'),
              makeVisible: command.makeVisible === true });
            results.push({});
          } else throw new Error('CEP 兼容层尚未实现 batchPlay 命令：' + command._obj);
        }
        return results;
      });
    },
    addNotificationListener(events, listener) {
      listeners.push({ events: events.map(String), listener });
      return Promise.resolve();
    },
    removeNotificationListener(events, listener) {
      for (let i = listeners.length - 1; i >= 0; i -= 1) {
        if (listeners[i].listener === listener) listeners.splice(i, 1);
      }
      return Promise.resolve();
    }
  };

  const core = {
    // A selection change keeps the revision. Complete snapshots (including XMP
    // writes/undo) invalidate panel projections; optimistic writes are never cached.
    getDocumentRevision() {
      const document = app.activeDocument;
      return document && !operations && !pendingWrites.length && !modalRunning ? document._revision : null;
    },
    isBusy() { return modalRunning || operations > 0 || pendingWrites.length > 0; },
    // Serializes this plugin's work only. CEP cannot acquire UXP's native modal
    // lock; host methods validate document/layer identity on every mutation.
    executeAsModal(callback) {
      const run = async () => {
        modalRunning = true;
        const histories = [];
        const hostControl = {
          async suspendHistory(params) {
            const token = await invoke('beginHistory', {
              documentId: params.documentID != null ? params.documentID : params.documentId, name: params.name
            });
            histories.push(token);
            return token;
          },
          async resumeHistory(token, commit) {
            if (commit === false) pendingWrites = [];
            const result = await invoke('endHistory', { token, commit: commit !== false });
            const index = histories.indexOf(token);
            if (index >= 0) histories.splice(index, 1);
            return result;
          }
        };
        try {
          await refresh();
          const value = await callback({ hostControl, isCancelled: false });
          await flush();
          if (histories.length) throw new Error('Photoshop 历史事务未结束，已请求恢复。');
          return value;
        } catch (error) {
          pendingWrites = [];
          const rollbackErrors = [];
          for (let i = histories.length - 1; i >= 0; i -= 1) {
            try { await invoke('endHistory', { token: histories[i], commit: false }); }
            catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
          }
          try { await refresh(); } catch (refreshError) { rollbackErrors.push(refreshError.message); }
          if (rollbackErrors.length) error.message += '\nCEP 宿主恢复或状态检查失败：' + rollbackErrors.join('；');
          throw error;
        } finally { modalRunning = false; }
      };
      const result = modalTail.then(run);
      modalTail = result.catch(() => {});
      return result;
    }
  };

  async function poll() {
    if (modalRunning || operations || pendingWrites.length) return { skipped: true };
    await refresh();
    const next = snapshotStamp;
    if (next !== stateSignature) {
      stateSignature = next;
      listeners.slice().forEach((entry) => {
        if (entry.events.indexOf('select') >= 0) {
          try { entry.listener('select', { documentID: activeDocumentId }); }
          catch (error) { if (typeof console !== 'undefined') console.error(error); }
        }
      });
    }
    return { skipped: false };
  }

  const facade = { app, action, core, constants, invoke, refresh, flush, poll,
    async initialize() { const value = await refresh(); stateSignature = snapshotStamp; return value; },
    isBusy() { return modalRunning || operations > 0 || pendingWrites.length > 0; }
  };
  Object.defineProperty(facade, 'imaging', { enumerable: true, get() {
    return configuration.imaging || require('./imaging');
  } });
  facade._facade = facade;
  return facade;
}

const facade = createPhotoshopFacade();
facade.createPhotoshopFacade = createPhotoshopFacade;
module.exports = facade;
