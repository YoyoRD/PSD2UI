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
  const idleListeners = new Set();
  let activeDocumentId = null;
  let pendingWrites = [];
  let operationTail = Promise.resolve();
  let modalTail = Promise.resolve();
  let operations = 0;
  let modalRunning = false;
  let modalPending = 0;
  let stateSignature = '';
  let snapshotStamp = '';
  let snapshotProbe = null;
  let contentRevision = 0;
  const geometryDirty = new Map();
  const yieldHost = configuration.yieldHost || (() => new Promise(resolve => setTimeout(resolve, 20)));

  function schedule(operation) {
    operations += 1;
    const result = operationTail.then(operation);
    const finished = () => { operations -= 1; notifyIdle(); };
    operationTail = result.then(finished, finished);
    return result;
  }

  function notifyIdle() {
    if (modalRunning || modalPending || operations || pendingWrites.length) return;
    idleListeners.forEach(listener => {
      try { listener(); } catch (error) { if (typeof console !== 'undefined') console.error(error); }
    });
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

  function queueWrite(method, params, apply, committed) {
    pendingWrites.push({ method, params, apply, committed });
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
      _revision: { value: 0, writable: true },
      _fingerprint: { value: '', writable: true },
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
          queueWrite('setLayer', params, () => {
            layer._data[property] = value;
            const descriptor = layer._data.descriptor;
            if (descriptor) {
              if (property === 'name' || property === 'visible') descriptor[property] = value;
              else if (property === 'opacity') descriptor.opacity = Number(value) * 255 / 100;
              else if (property === 'blendMode') descriptor.mode = Object.assign({}, descriptor.mode, { _value: value });
            }
          }, () => {
            // 显隐不一定推进 PS 历史；确认写入后仍需失效本层和祖先的投影。
            invalidateLayer(layer, property !== 'name');
            if (property !== 'visible') requireDocument(documentId)._revision = contentRevision;
          });
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
      _snapshotRevision: { value: 0, writable: true },
      _metadataRevision: { value: 0, writable: true },
      layers: { value: [], enumerable: true },
      activeLayers: { enumerable: true, get() {
        return (document._data.activeLayerIds || []).map((id) =>
          layerCache.get(String(document.id) + ':' + String(id))).filter((layer) => layer && layer._present);
      } },
      saved: { enumerable: true, get() {
        const known = snapshotProbe && snapshotProbe.documents.find(entry => String(entry.id) === String(document.id));
        return known && known.saved;
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
    const retainedLayers = new Set();
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
      if (!sameLayers) {
        document._revision = document._snapshotRevision = contentRevision;
        document._metadataRevision = contentRevision;
      }
      if (!geometryDirty.has(key)) geometryDirty.set(key, new Set());
      const dirty = geometryDirty.get(key);
      function patchLayers(values, parent) {
        return (values || []).map((entry) => {
          const layerKey = key + ':' + String(entry.id);
          retainedLayers.add(layerKey);
          let layer = layerCache.get(layerKey);
          if (!layer) {
            layer = makeLayer(data.id, entry);
            layerCache.set(layerKey, layer);
          }
          const oldData = layer._data;
          const oldParent = layer.parent;
          const oldChildren = layer.layers.map(child => ({ layer: child, revision: child._revision }));
          const fingerprint = JSON.stringify(Object.assign({}, entry, {
            layers: undefined, deferredBounds: undefined,
            bounds: entry.kind === 'group' ? undefined : entry.bounds,
            boundsNoEffects: entry.kind === 'group' ? undefined : entry.boundsNoEffects
          }));
          const ownChanged = oldParent !== parent || layer._fingerprint !== fingerprint || (!entry.deferredBounds && entry.kind === 'group'
            && (JSON.stringify(oldData.bounds) !== JSON.stringify(entry.bounds)
              || JSON.stringify(oldData.boundsNoEffects) !== JSON.stringify(entry.boundsNoEffects)));
          layer._present = true;
          layer.parent = parent;
          replaceArray(layer.layers, patchLayers(entry.layers, layer));
          const changed = ownChanged || oldChildren.length !== layer.layers.length
            || layer.layers.some((child, index) => child !== oldChildren[index].layer || child._revision !== oldChildren[index].revision);
          if (entry.deferredBounds) {
            if (oldData.bounds) entry.bounds = oldData.bounds;
            if (oldData.boundsNoEffects) entry.boundsNoEffects = oldData.boundsNoEffects;
            if (changed) dirty.add(String(entry.id));
          } else dirty.delete(String(entry.id));
          layer._data = entry;
          layer._fingerprint = fingerprint;
          if (changed) layer._revision = contentRevision;
          return layer;
        });
      }
      if (sameLayers) {
        // 没变化的文档只更新文档头；保留图层对象、子集合和描述符。
        const retain = values => values.forEach(layer => {
          retainedLayers.add(key + ':' + String(layer.id)); retain(layer.layers);
        });
        retain(document.layers);
      } else replaceArray(document.layers, patchLayers(data.layers, document));
      return document;
    });
    layerCache.forEach((layer, key) => {
      if (!retainedLayers.has(key)) {
        layer._present = false;
        // 打开文档的已删图层仍可能撤销恢复，保留对象身份。
        const owner = documentCache.get(String(layer._documentId));
        if (!owner || !owner._present) layerCache.delete(key);
      }
    });
    documentCache.forEach((document, key) => {
      if (!document._present) { documentCache.delete(key); geometryDirty.delete(key); }
      else {
        const dirty = geometryDirty.get(key);
        if (dirty) dirty.forEach(id => { const layer = layerCache.get(key + ':' + id); if (!layer || !layer._present) dirty.delete(id); });
      }
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
    return JSON.stringify(stamp, (key, value) => ['activeDocumentId', 'activeLayerIds', 'saved'].includes(key) ? undefined : value);
  }

  function checkCurrent(isCurrent) {
    if (isCurrent && !isCurrent()) {
      const error = new Error('Photoshop 已发生新的操作，合并后重新读取。');
      error.code = 'PSD2UI_REFRESH_SUPERSEDED';
      throw error;
    }
  }

  async function synchronize(stamp, hint, isCurrent) {
    checkCurrent(isCurrent);
    const notified = hint && (hint.visibility || hint.names || hint.full || hint.history);
    if (notified || !snapshotProbe || contentSignature(stamp) !== contentSignature(snapshotProbe)) {
      if (!await synchronizePresentation(stamp, hint, isCurrent)) {
        // 显隐可以不产生历史记录；通知本身也是失效依据。
        const hintedIds = hint && hint.documentIds || [];
        const force = notified && snapshotProbe ? (hintedIds.length ? hintedIds : [stamp.activeDocumentId])
          .filter(id => stamp.documents.some(doc => String(doc.id) === String(id))) : undefined;
        return readState(force, isCurrent, Boolean(hint && hint.interactive));
      }
    }
    // Clicking another layer/document is not a content edit. Keep the complete
    // cached tree and change only selection; do not rescan hundreds of layers.
    stamp.documents.forEach(data => { requireDocument(data.id)._data.activeLayerIds = data.activeLayerIds.slice(); });
    activeDocumentId = stamp.activeDocumentId;
    snapshotProbe = stamp;
    snapshotStamp = signature(stamp);
    return { activeDocumentId, version: app.version, documents: documents.map(document => document._data) };
  }

  async function synchronizePresentation(stamp, hint, isCurrent) {
    if (!snapshotProbe || !hint || !(hint.visibility || hint.names) || hint.full) return false;
    const withoutHistory = value => JSON.stringify(value, (key, entry) =>
      ['activeDocumentId', 'activeLayerIds', 'historyId', 'saved'].includes(key) ? undefined : entry);
    if (withoutHistory(stamp) !== withoutHistory(snapshotProbe)) return false;
    const changed = stamp.documents.filter((doc, index) => doc.historyId !== snapshotProbe.documents[index].historyId);
    if (changed.length > 1) return false;
    const documentId = changed.length ? changed[0].id : (hint.documentIds && hint.documentIds.length === 1 ? hint.documentIds[0] : stamp.activeDocumentId);
    if (documentId == null) return false;
    if ((hint.documentIds || []).some(id => String(id) !== String(documentId))) return false;
    const document = requireDocument(documentId);
    const targets = new Set();
    function add(layer) {
      targets.add(String(layer.id));
    }
    if (hint.allLayers) {
      const visit = layers => layers.forEach(layer => { add(layer); visit(layer.layers); });
      visit(document.layers);
    } else {
      for (const id of hint.layerIds || []) {
        const layer = layerCache.get(String(documentId) + ':' + String(id));
        if (!layer || !layer._present) return false;
        add(layer);
      }
    }
    if (!targets.size) return false;
    try {
      const ids = Array.from(targets), values = [];
      // 大组的眼睛开关也要分段，让 Photoshop 有机会处理下一次输入。
      for (let offset = 0; offset < ids.length; offset += 32) {
        checkCurrent(isCurrent);
        const batch = ids.slice(offset, offset + 32);
        const value = await request('readVisibility', { documentId, layerIds: batch, groupIds: [], names: hint.names === true, stamp });
        checkCurrent(isCurrent);
        if (!value || !Array.isArray(value.layers) || value.layers.length !== batch.length
            || new Set(value.layers.map(layer => String(layer.id))).size !== batch.length
            || value.layers.some(layer => !batch.includes(String(layer.id)) || typeof layer.visible !== 'boolean'
              || hint.names && typeof layer.name !== 'string')) return false;
        values.push(...value.layers);
        if (offset + 32 < ids.length) await yieldHost();
      }
      let anyChanged = false;
      values.forEach(data => {
        const layer = requireLayer(documentId, data.id);
        const changedVisibility = layer._data.visible !== data.visible;
        const changedName = hint.names && layer._data.name !== data.name;
        layer._data.visible = data.visible;
        if (layer._data.descriptor) layer._data.descriptor.visible = data.visible;
        if (hint.names) {
          layer._data.name = data.name;
          if (layer._data.descriptor) layer._data.descriptor.name = data.name;
        }
        if (data.bounds) layer._data.bounds = data.bounds;
        if (data.boundsNoEffects) layer._data.boundsNoEffects = data.boundsNoEffects;
        if (changedVisibility || changedName) { anyChanged = true; invalidateLayer(layer, changedVisibility); }
      });
      // PS 组 bounds 的 DOM 读取可能耗时数秒；自动显隐只更新显隐值。
      // 面板复用配置；组几何和完整描述符在保存、预检及导出前统一刷新。
      if (anyChanged) {
        document._snapshotRevision = ++contentRevision;
        if (hint.names) document._revision = contentRevision;
      }
      return true;
    } catch (error) {
      if (['CEP_HOST_RESULT_UNKNOWN', 'CEP_HOST_UNAVAILABLE', 'PSD2UI_REFRESH_SUPERSEDED'].includes(error.code)) throw error;
      return false;
    }
  }

  function invalidateLayer(layer, geometry) {
    const dirty = geometryDirty.get(String(layer._documentId));
    const revision = ++contentRevision;
    for (let current = layer; current && current._documentId != null; current = current.parent) {
      current._revision = revision;
      if (geometry && current.kind === 'group' && dirty) dirty.add(String(current.id));
    }
    requireDocument(layer._documentId)._snapshotRevision = revision;
  }

  async function refreshGeometry(isCurrent) {
    const document = app.activeDocument;
    const dirty = document && geometryDirty.get(String(document.id));
    if (!dirty || !dirty.size) return;
    const values = [];
    for (const id of dirty) {
      checkCurrent(isCurrent);
      const value = await request('readGeometry', { documentId: document.id, layerIds: [id], stamp: snapshotProbe });
      checkCurrent(isCurrent);
      if (!value || !value.layers || value.layers.length !== 1 || String(value.layers[0].id) !== id
          || !value.layers[0].bounds || !value.layers[0].boundsNoEffects) throw new Error('Photoshop 组边界读回不完整。');
      values.push(value.layers[0]);
      await yieldHost();
    }
    values.forEach(value => {
      const layer = requireLayer(document.id, value.id);
      layer._data.bounds = value.bounds; layer._data.boundsNoEffects = value.boundsNoEffects;
      layer._data.deferredBounds = false;
      invalidateLayer(layer, false);
    });
    dirty.clear();
    document._revision = ++contentRevision;
  }

  async function readState(forceDocumentIds, isCurrent, deferGeometry) {
    for (let attempt = 0; ; attempt++) {
      try {
        checkCurrent(isCurrent);
        const forced = new Set((forceDocumentIds || []).map(String));
        const knownDocuments = snapshotProbe ? snapshotProbe.documents.filter(document => !forced.has(String(document.id))) : [];
        const begin = await request('beginState', { knownDocuments, deferGeometry: deferGeometry === true });
        checkCurrent(isCurrent);
        const reused = new Set((begin.reusedDocumentIds || []).map(String));
        const snapshot = Object.assign({}, begin.stamp, {
          documents: begin.stamp.documents.map(document => Object.assign({}, document, {
            layers: reused.has(String(document.id)) ? requireDocument(document.id)._data.layers : []
          }))
        });
        const owners = new Map(snapshot.documents.map(document => [String(document.id), document]));
        const layers = new Map();
        let count = 0;
        for (; !begin.done;) {
          await yieldHost();
          checkCurrent(isCurrent);
          const page = await request('statePage', { token: begin.token });
          checkCurrent(isCurrent);
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
        checkCurrent(isCurrent);
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
    if (['probe', 'notificationEvents', 'getXmp', 'readManifest', 'readVisibility', 'readGeometry', 'chooseFolder', 'beginHistory'].indexOf(method) < 0) {
      // 旧宿主不读取后台文档历史；跨文档复制已知写入目标，必须明确更新它。
      if (method === 'duplicate' && params.targetDocumentId != null) await readState([params.targetDocumentId]);
      else await synchronize(await request('probe', {}));
      // 激活已有文档不会改变历史；调用方随后读取的组边界必须属于新活动文档。
      if (method === 'activate' || method === 'open') await reconcileActivation();
      // XMP changes may not advance Photoshop's pixel history. Invalidate only
      // the panel projection; reading metadata does not require a layer rescan.
      if (['setXmp', 'writeManifest'].indexOf(method) >= 0) {
        const document = requireDocument(params.documentId != null ? params.documentId : params.documentID);
        document._revision = document._metadataRevision = ++contentRevision;
      }
    }
    return value;
  }

  async function reconcileActivation() {
    if (!app.activeDocument) return;
    if (!await synchronizePresentation(snapshotProbe, { visibility: true, allLayers: true }) && app.activeDocument.layers.length) {
      await readState([app.activeDocument.id]);
    }
    await refreshGeometry();
  }

  async function drainWrites() {
    let changed = false;
    let activated = false;
    while (pendingWrites.length) {
      const write = pendingWrites.shift();
      try {
        await request(write.method, write.params);
        if (write.committed) write.committed();
        if (write.method === 'activate') activated = true;
        changed = true;
      } catch (error) {
        pendingWrites = [];
        // A failed setter can leave optimistic cache values behind. Read once;
        // never repeat a mutation whose completion is unknown.
        try { await send('state', {}); } catch (refreshError) { error.refreshError = refreshError.message; }
        throw error;
      }
    }
    if (changed) {
      await readState();
      if (activated) await reconcileActivation();
    }
  }

  function invoke(method, params) {
    return schedule(async () => {
      await drainWrites();
      return send(method, params || {});
    });
  }

  function flush() { return schedule(drainWrites); }
  function refresh(hint, isCurrent) { return schedule(async () => {
    checkCurrent(isCurrent);
    await drainWrites();
    const previousDocumentId = activeDocumentId;
    const result = await synchronize(await request('probe', {}), hint, isCurrent);
    const switchedDocument = previousDocumentId != null && String(previousDocumentId) !== String(activeDocumentId);
    // 保存/导出前核对无历史记录的显隐变化，避免漏通知或刚切回面板时使用旧值。
    // 合并期间切换文档时，无 documentId 的旧通知无法可靠归属；切回即轻量核对。
    if ((switchedDocument || hint && (hint.verifyVisibility || hint.reconcileVisibility)) && app.activeDocument) {
      if (!await synchronizePresentation(snapshotProbe, { visibility: true, allLayers: true }, isCurrent) && app.activeDocument.layers.length) {
        return readState([app.activeDocument.id], isCurrent, Boolean(hint && hint.interactive));
      }
    }
    if (!hint || (!hint.interactive && !hint.metadataOnly)) await refreshGeometry(isCurrent);
    return result;
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
        for (let index = 0; index < commands.length; index++) {
          const command = commands[index];
          const target = targetFor(command);
          if (command._obj === 'get') {
            if (target.property === 'XMPMetadataAsUTF8') {
              results.push({ XMPMetadataAsUTF8: await send('getXmp', { documentId: target.document.id }) });
            } else results.push(cachedGet(command));
          } else if (command._obj === 'set' && target.property === 'XMPMetadataAsUTF8') {
            await send('setXmp', { documentId: target.document.id, xmp: command.to.XMPMetadataAsUTF8 });
            results.push({});
          } else if (command._obj === 'select' && target.layer) {
            const ids = [target.layer.id];
            // 连续的追加选择只跨一次 CEP 边界，读回也只做一次。
            while (index + 1 < commands.length) {
              const next = commands[index + 1];
              if (next._obj !== 'select' || !next.selectionModifier || next.selectionModifier._value !== 'addToSelection') break;
              const nextTarget = targetFor(next);
              if (!nextTarget.layer || nextTarget.document !== target.document) break;
              ids.push(nextTarget.layer.id); results.push({}); index++;
            }
            await send('select', { documentId: target.document.id, layerIds: ids,
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
    recordPerformance: require('./performance').record,
    readPngSize(file) { return (configuration.imaging || require('./imaging')).readPngSize(file); },
    samePngContent(first, second) { return (configuration.imaging || require('./imaging')).samePngContent(first, second); },
    getExportSourceCheckpoint(documentId) {
      const source = requireDocument(documentId);
      const known = snapshotProbe && snapshotProbe.documents.find(document => String(document.id) === String(source.id));
      if (!known || String(activeDocumentId) !== String(source.id) || pendingWrites.length) {
        const error = new Error('[PSD2UI_EXPORT_SOURCE_CHANGED] 导出源文档状态尚未同步，请重新导出。');
        error.code = 'PSD2UI_EXPORT_SOURCE_CHANGED';
        throw error;
      }
      const visibility = [];
      const visit = layers => layers.forEach(layer => {
        visibility.push([String(layer.id), layer.visible]);
        visit(layer.layers);
      });
      visit(source.layers);
      visibility.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
      // 临时工作台和完整重读会改变缓存版本；仅比较源内容与无历史记录的显隐。
      return JSON.stringify([String(source.id), known.historyId, known.path, known.name,
        known.width, known.height, known.resolution, visibility]);
    },
    async verifyExportSourceCheckpoint(documentId, checkpoint) {
      await refresh({ verifyVisibility: true });
      if (typeof checkpoint !== 'string' || core.getExportSourceCheckpoint(documentId) !== checkpoint) {
        const error = new Error('[PSD2UI_EXPORT_SOURCE_CHANGED] 导出期间源 PSD 已变化，输出尚未写入，请重新导出。');
        error.code = 'PSD2UI_EXPORT_SOURCE_CHANGED';
        throw error;
      }
    },
    exportLayerPng(input) {
      return schedule(async () => {
        await drainWrites();
        const source = requireDocument(input.documentId);
        const layer = requireLayer(source.id, input.layerId);
        const known = snapshotProbe && snapshotProbe.documents.find(document => String(document.id) === String(source.id));
        if (!known || String(activeDocumentId) !== String(source.id)) throw new Error('导出源文档状态已变化，请重新导出。');
        const path = nativePath(input.path);
        const value = await request('exportLayerPng', { documentId: source.id, layerId: layer.id, path,
          compression: input.compression == null ? 6 : input.compression, expectedHistoryId: known.historyId,
          sourceBounds: { left: Number(layer.bounds.left), top: Number(layer.bounds.top) } });
        const normalize = name => String(name || '').replace(/\\/g, '/').toLowerCase();
        const stamp = value && value.stamp;
        const returnedSource = stamp && Array.isArray(stamp.documents)
          && stamp.documents.find(document => String(document.id) === String(source.id));
        if (!value || value.closed !== true || String(value.documentId) !== String(source.id)
            || String(value.layerId) !== String(layer.id) || normalize(value.path) !== normalize(path)
            || !Number.isInteger(value.width) || value.width <= 0 || !Number.isInteger(value.height) || value.height <= 0
            || value.temporaryDocumentId == null || String(value.temporaryDocumentId) === String(source.id)
            || String(value.activeDocumentId) !== String(source.id) || !returnedSource
            || String(stamp.activeDocumentId) !== String(source.id)
            || stamp.documents.some(document => String(document.id) === String(value.temporaryDocumentId))) {
          throw new Error('Photoshop 图片导出回执不完整，已停止发布输出。');
        }
        if (contentSignature({ documents: [known] }) !== contentSignature({ documents: [returnedSource] })) {
          throw new Error('导出期间源 PSD 已变化，已停止发布输出。');
        }
        // 临时工作台在单次宿主调用内创建并关闭，只合并最终轻量状态。
        await synchronize(stamp);
        return value;
      });
    },
    // A selection change keeps the revision. Complete snapshots (including XMP
    // writes/undo) invalidate panel projections; optimistic writes are never cached.
    getDocumentRevision() {
      const document = app.activeDocument;
      return document && !operations && !pendingWrites.length && !modalRunning && !modalPending ? document._revision : null;
    },
    // 显隐会使图层投影失效，但不会使已保存的组件配置失效。
    getSnapshotRevision() {
      const document = app.activeDocument;
      return document && !operations && !pendingWrites.length && !modalRunning && !modalPending ? document._snapshotRevision : null;
    },
    getLayerRevision(layer) { return layer && !operations && !pendingWrites.length ? layer._revision : null; },
    getMetadataRevision(document) { return (document || app.activeDocument)._metadataRevision; },
    getContentToken(document) {
      const source = document || app.activeDocument;
      return source && !pendingWrites.length ? [source.id, source.path, source._snapshotRevision].join('|') : null;
    },
    invalidateMetadata() { if (app.activeDocument) app.activeDocument._metadataRevision = app.activeDocument._revision = ++contentRevision; },
    hasDeferredSnapshot() { const dirty = app.activeDocument && geometryDirty.get(String(app.activeDocument.id)); return Boolean(dirty && dirty.size); },
    isBusy() { return modalRunning || modalPending > 0 || operations > 0 || pendingWrites.length > 0; },
    // Serializes this plugin's work only. CEP cannot acquire UXP's native modal
    // lock; host methods validate document/layer identity on every mutation.
    executeAsModal(callback, options) {
      modalPending += 1;
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
          await refresh(options && options.metadataOnly ? { metadataOnly: true } : undefined);
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
      const finished = () => { modalPending -= 1; notifyIdle(); };
      modalTail = result.then(finished, finished);
      return result;
    }
  };

  async function poll(hint, isCurrent) {
    if (modalRunning || modalPending || operations || pendingWrites.length) return { skipped: true };
    await refresh(Object.assign({}, hint, { interactive: true }), isCurrent);
    const next = snapshotStamp + '|' + contentRevision;
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
    addIdleListener(listener) { idleListeners.add(listener); return () => idleListeners.delete(listener); },
    async initialize() { const value = await refresh(); stateSignature = snapshotStamp + '|' + contentRevision; return value; },
    isBusy() { return modalRunning || modalPending > 0 || operations > 0 || pendingWrites.length > 0; }
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
