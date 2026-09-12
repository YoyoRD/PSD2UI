'use strict';

const { fail } = require('./errors');
const { createId } = require('./ids');
const { parseResourceLayerName } = require('./naming');

const ResourceKinds = Object.freeze({
  SPRITE: 'sprite',
  TEXTURE: 'texture'
});

function normalizeLayerId(layerId) {
  const value = String(layerId == null ? '' : layerId).trim();
  if (!value) {
    fail('PSD2UI_LAYER_ID_REQUIRED', '资源操作必须提供 Photoshop 图层 ID。');
  }
  return value;
}

function normalizeModule(moduleName) {
  const value = String(moduleName || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(value)) {
    fail(
      'PSD2UI_MODULE_INVALID',
      `module '${moduleName || ''}' 无效；必须以小写字母开头，且只包含小写字母、数字、下划线或连字符。`);
  }
  return value;
}

function normalizeSubmodule(submoduleName) {
  const value = String(submoduleName || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*$/.test(value)) {
    fail(
      'PSD2UI_SUBMODULE_INVALID',
      `submodule '${submoduleName || ''}' 无效；必须以小写字母开头，且只包含小写字母和数字。`);
  }
  return value;
}

function normalizeKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  if (value !== ResourceKinds.SPRITE && value !== ResourceKinds.TEXTURE) {
    fail('PSD2UI_RESOURCE_KIND_INVALID', `资源类型 '${kind || ''}' 无效；只允许 sprite 或 texture。`);
  }
  return value;
}

function ensureRegistry(manifest) {
  if (!manifest.resourceRegistry) {
    manifest.resourceRegistry = {
      counters: {},
      resources: {},
      layerBindings: {}
    };
  }
  manifest.resourceRegistry.counters = manifest.resourceRegistry.counters || {};
  manifest.resourceRegistry.resources = manifest.resourceRegistry.resources || {};
  manifest.resourceRegistry.layerBindings = manifest.resourceRegistry.layerBindings || {};
  return manifest.resourceRegistry;
}

function counterKey(moduleName, kind, submodule) {
  return submodule
    ? `${moduleName}|${submodule}|${kind}`
    : `${moduleName}|${kind}`;
}

function formatFileName(moduleName, kind, number, submodule) {
  if (!Number.isInteger(number) || number < 1 || number > 9999) {
    const scope = submodule ? `${moduleName}/${submodule}/${kind}` : `${moduleName}/${kind}`;
    fail('PSD2UI_RESOURCE_NUMBER_EXHAUSTED', `${scope} 的四位资源编号已耗尽。`);
  }
  const token = kind === ResourceKinds.SPRITE ? 'sp' : 'tex';
  const ownerModule = normalizeModule(moduleName);
  const prefix = submodule
    ? `${ownerModule}_${normalizeSubmodule(submodule)}`
    : ownerModule;
  return `${prefix}_${token}_${String(number).padStart(4, '0')}.png`;
}

function documentSubmodule(manifest) {
  const value = manifest && manifest.document && manifest.document.submodule;
  return value ? normalizeSubmodule(value) : null;
}

function allocateNumber(registry, moduleName, kind, submodule) {
  const key = counterKey(moduleName, kind, submodule);
  const next = Number.isInteger(registry.counters[key]) ? registry.counters[key] : 1;
  registry.counters[key] = next + 1;
  return next;
}

function formatManifestResourceFileName(
  manifest,
  kind,
  number,
  resourceModule,
  resourceSubmodule) {
  const manifestSubmodule = documentSubmodule(manifest);
  return formatFileName(
    normalizeModule(resourceModule || manifest.document.module),
    kind,
    number,
    manifestSubmodule ? normalizeSubmodule(resourceSubmodule) : null);
}

function getResourceByLayer(manifest, layerId) {
  const registry = ensureRegistry(manifest);
  const resourceId = registry.layerBindings[normalizeLayerId(layerId)];
  return resourceId ? registry.resources[resourceId] || null : null;
}

function allocateResource(manifest, input, options) {
  if (manifest.resourceNaming === 'source') return allocateSourceResource(manifest, input, options);
  const registry = ensureRegistry(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const kind = normalizeKind(input.kind);
  const moduleName = normalizeModule(input.module || manifest.document.module);
  const manifestSubmodule = documentSubmodule(manifest);
  const submodule = manifestSubmodule
    ? normalizeSubmodule(input.submodule || manifest.document.submodule)
    : null;
  const existing = getResourceByLayer(manifest, layerId);

  if (existing) {
    if (existing.status !== 'active') {
      fail('PSD2UI_RESOURCE_RETIRED', `图层 ${layerId} 绑定的资源已停用，不能隐式恢复。`);
    }
    if (existing.kind !== kind
        || existing.module !== moduleName
        || (manifestSubmodule && existing.submodule !== submodule)) {
      fail(
        'PSD2UI_RESOURCE_MIGRATION_REQUIRED',
        `图层 ${layerId} 已绑定 ${existing.fileName}；改变 module 或类型必须执行显式迁移。`);
    }
    return existing;
  }

  const number = allocateNumber(registry, moduleName, kind, submodule);
  const idFactory = options && options.idFactory ? options.idFactory : createId;
  const resourceId = idFactory('resource');
  if (!resourceId || registry.resources[resourceId]) {
    fail('PSD2UI_RESOURCE_ID_COLLISION', '无法分配唯一的资源 ID。');
  }

  const resource = {
    id: resourceId,
    kind,
    scope: moduleName === 'common' ? 'common' : 'module',
    module: moduleName,
    ...(submodule ? { submodule } : {}),
    number,
    fileName: formatManifestResourceFileName(manifest, kind, number, moduleName, submodule),
    status: 'active',
    sourceLayerId: layerId,
    history: []
  };
  registry.resources[resourceId] = resource;
  registry.layerBindings[layerId] = resourceId;
  return resource;
}

function allocateSourceResource(manifest, input, options) {
  const registry = ensureRegistry(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const kind = normalizeKind(input.kind);
  const node = manifest.nodes && manifest.nodes[layerId];
  const parsed = parseResourceLayerName(input.layerName == null ? node && node.name : input.layerName, layerId);
  let existing = getResourceByLayer(manifest, layerId);
  if (existing && existing.status !== 'active') {
    fail('PSD2UI_RESOURCE_RETIRED', `图层 ${layerId} 绑定的资源已停用。`);
  }
  if (existing && existing.fileName === parsed.fileName && existing.kind === kind) {
    existing.module = parsed.group;
    existing.scope = 'module';
    delete existing.submodule;
    return existing;
  }
  const sourceCandidates = options && options.sourceCandidates;
  function currentSources(resource) {
    if (!sourceCandidates) return null;
    return Object.keys(registry.layerBindings).filter((id) => {
      const candidate = sourceCandidates[id];
      return registry.layerBindings[id] === resource.id && candidate
        && parseResourceLayerName(candidate.layerName, id).fileName.toLowerCase() === parsed.fileName.toLowerCase();
    }).map((id) => ({ layerId: id, ...sourceCandidates[id] }));
  }
  const collision = Object.values(registry.resources).find((resource) => resource
    && resource.status === 'active' && resource.id !== (existing && existing.id)
    && String(resource.fileName || '').toLowerCase() === parsed.fileName.toLowerCase()
    && (!sourceCandidates || currentSources(resource).length > 0));
  const conflictingKind = collision && (sourceCandidates
    ? currentSources(collision).some((candidate) => candidate.kind !== kind)
    : collision.kind !== kind);
  if (collision && (conflictingKind || collision.fileName !== parsed.fileName)) {
    fail('PSD2UI_RESOURCE_NAME_CONFLICT',
      `图片图层 ${layerId} 与 ${collision.sourceLayerId} 的资源 '${parsed.fileName}' 大小写或图片类型冲突。`,
      { layerId, otherLayerId: collision.sourceLayerId, fileName: parsed.fileName });
  }
  if (existing) {
    const others = Object.keys(registry.layerBindings).filter((id) => id !== layerId
      && registry.layerBindings[id] === existing.id);
    const conflictingOther = others.find((id) => !sourceCandidates || sourceCandidates[id]
      && parseResourceLayerName(sourceCandidates[id].layerName, id).fileName === parsed.fileName
      && sourceCandidates[id].kind !== kind);
    if (conflictingOther && existing.fileName === parsed.fileName && existing.kind !== kind) {
      fail('PSD2UI_RESOURCE_NAME_CONFLICT',
        `图片图层 ${layerId} 与 ${conflictingOther} 共享 '${parsed.fileName}'，但图片类型不一致。`,
        { layerId, otherLayerId: conflictingOther, fileName: parsed.fileName });
    }
    const sharedTypeChange = existing.fileName === parsed.fileName && sourceCandidates
      && others.every((id) => sourceCandidates[id] && sourceCandidates[id].kind === kind
        && parseResourceLayerName(sourceCandidates[id].layerName, id).fileName === parsed.fileName);
    if ((!others.length || sharedTypeChange) && !collision) {
      existing.history = existing.history || [];
      existing.history.push({ fileName: existing.fileName, module: existing.module,
        kind: existing.kind, number: existing.number, reason: 'source-layer-edited' });
      existing.fileName = parsed.fileName;
      existing.module = parsed.group;
      existing.scope = 'module';
      existing.kind = kind;
      delete existing.submodule;
      return existing;
    }
    delete registry.layerBindings[layerId];
    if (!others.length) existing.status = 'retired';
    else if (String(existing.sourceLayerId) === layerId) existing.sourceLayerId = others[0];
    existing = null;
  }
  if (collision) {
    // 同名只登记候选来源；导出器逐层比较实际像素后才能交付共享资源。
    collision.module = parsed.group;
    collision.scope = 'module';
    collision.kind = kind;
    delete collision.submodule;
    registry.layerBindings[layerId] = collision.id;
    return collision;
  }
  const idFactory = options && options.idFactory ? options.idFactory : createId;
  const id = idFactory('resource');
  if (!id || registry.resources[id]) fail('PSD2UI_RESOURCE_ID_COLLISION', '无法分配唯一的资源 ID。');
  const resource = { id, kind, scope: 'module', module: parsed.group,
    number: allocateNumber(registry, parsed.group, kind, null), fileName: parsed.fileName,
    status: 'active', sourceLayerId: layerId, history: [] };
  registry.resources[id] = resource;
  registry.layerBindings[layerId] = id;
  return resource;
}

function reuseResource(manifest, input) {
  const registry = ensureRegistry(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const resource = registry.resources[String(input.resourceId || '')];
  if (!resource || resource.status !== 'active') {
    fail('PSD2UI_RESOURCE_NOT_FOUND', `找不到可复用资源 '${input.resourceId || ''}'。`);
  }
  const existing = getResourceByLayer(manifest, layerId);
  if (existing && existing.id !== resource.id) {
    fail(
      'PSD2UI_LAYER_RESOURCE_STABLE',
      `图层 ${layerId} 已绑定 ${existing.fileName}；普通迭代不能通过复用命令改变既有资源名称。`);
  }
  registry.layerBindings[layerId] = resource.id;
  return resource;
}

function retireResource(manifest, input) {
  const registry = ensureRegistry(manifest);
  const resource = registry.resources[String(input.resourceId || '')];
  if (!resource || resource.status !== 'active') {
    fail('PSD2UI_RESOURCE_NOT_FOUND', `找不到可停用资源 '${input.resourceId || ''}'。`);
  }
  resource.status = 'retired';
  Object.keys(registry.layerBindings).forEach((layerId) => {
    if (registry.layerBindings[layerId] === resource.id) {
      delete registry.layerBindings[layerId];
    }
  });
  return resource;
}

function migrateResource(manifest, input) {
  const registry = ensureRegistry(manifest);
  const resource = registry.resources[String(input.resourceId || '')];
  if (!resource || resource.status !== 'active') {
    fail('PSD2UI_RESOURCE_NOT_FOUND', `找不到可迁移资源 '${input.resourceId || ''}'。`);
  }
  if (manifest.resourceNaming === 'source') {
    const parsed = parseResourceLayerName(resource.fileName.replace(/\.png$/, ''), resource.sourceLayerId);
    if (input.module && input.module !== parsed.group) {
      fail('PSD2UI_SOURCE_RESOURCE_RENAME_REQUIRED', '资源分组来自图片基础名首段；请先修改美术图片名。');
    }
    resource.kind = normalizeKind(input.kind || resource.kind);
    return resource;
  }
  const targetModule = normalizeModule(input.module);
  const targetKind = normalizeKind(input.kind);
  const manifestSubmodule = documentSubmodule(manifest);
  const targetSubmodule = manifestSubmodule
    ? normalizeSubmodule(
      input.submodule
      || (targetModule === normalizeModule(manifest.document.module)
        ? manifest.document.submodule
        : null))
    : null;
  if (resource.module === targetModule
      && resource.kind === targetKind
      && (!manifestSubmodule || resource.submodule === targetSubmodule)) {
    return resource;
  }

  resource.history.push({
    module: resource.module,
    ...(resource.submodule ? { submodule: resource.submodule } : {}),
    kind: resource.kind,
    number: resource.number,
    fileName: resource.fileName,
    reason: String(input.reason || 'explicit-migration')
  });
  const number = allocateNumber(registry, targetModule, targetKind, targetSubmodule);
  resource.module = targetModule;
  if (targetSubmodule) resource.submodule = targetSubmodule;
  else delete resource.submodule;
  resource.kind = targetKind;
  resource.scope = targetModule === 'common' ? 'common' : 'module';
  resource.number = number;
  resource.fileName = formatManifestResourceFileName(
    manifest,
    targetKind,
    number,
    targetModule,
    targetSubmodule);
  return resource;
}

function reconcileResourceBindings(manifest, activeLayerIdsInOrder) {
  const registry = ensureRegistry(manifest);
  const orderedLayerIds = Array.from(new Set((activeLayerIdsInOrder || [])
    .map((layerId) => String(layerId == null ? '' : layerId).trim())
    .filter(Boolean)));
  const activeLayerIds = new Set(orderedLayerIds);
  const removedLayerBindings = [];

  orderedLayerIds.forEach((layerId) => {
    const node = manifest.nodes && manifest.nodes[layerId];
    const referencedResourceId = node && (
      node.image && node.image.resourceId
      || node.rawImage && node.rawImage.resourceId
    );
    const boundResourceId = registry.layerBindings[layerId];
    if (boundResourceId && boundResourceId !== referencedResourceId) {
      delete registry.layerBindings[layerId];
      removedLayerBindings.push(layerId);
    }
    const referencedResource = referencedResourceId && registry.resources[referencedResourceId];
    if (referencedResource && referencedResource.status === 'active') {
      registry.layerBindings[layerId] = referencedResourceId;
    }
  });

  Object.keys(registry.layerBindings).forEach((layerId) => {
    const resourceId = registry.layerBindings[layerId];
    const resource = registry.resources[resourceId];
    if (!activeLayerIds.has(String(layerId)) || !resource || resource.status !== 'active') {
      delete registry.layerBindings[layerId];
      if (!removedLayerBindings.includes(String(layerId))) {
        removedLayerBindings.push(String(layerId));
      }
    }
  });

  const bindingsByResource = new Map();
  orderedLayerIds.forEach((layerId) => {
    const resourceId = registry.layerBindings[layerId];
    if (!resourceId) return;
    if (!bindingsByResource.has(resourceId)) bindingsByResource.set(resourceId, []);
    bindingsByResource.get(resourceId).push(layerId);
  });

  const retiredResourceIds = [];
  const reassignedResourceSources = [];
  Object.keys(registry.resources).forEach((resourceId) => {
    const resource = registry.resources[resourceId];
    if (!resource || resource.status !== 'active') return;
    const survivingLayerIds = bindingsByResource.get(resourceId) || [];
    if (survivingLayerIds.length === 0) {
      resource.status = 'retired';
      retiredResourceIds.push(resourceId);
      return;
    }
    if (!survivingLayerIds.includes(String(resource.sourceLayerId))) {
      const previousSourceLayerId = String(resource.sourceLayerId || '');
      resource.sourceLayerId = survivingLayerIds[0];
      reassignedResourceSources.push({
        resourceId,
        previousSourceLayerId,
        sourceLayerId: resource.sourceLayerId
      });
    }
  });

  return {
    removedLayerBindings,
    retiredResourceIds,
    reassignedResourceSources
  };
}

function migrateDocumentSubmodule(manifest, input) {
  const registry = ensureRegistry(manifest);
  const targetSubmodule = normalizeSubmodule(input && input.submodule);
  if (manifest.resourceNaming === 'source') {
    manifest.document.submodule = targetSubmodule;
    manifest.manifestVersion = '1.1.0';
    return { document: manifest.document, migratedResources: [] };
  }
  const previousSubmodule = documentSubmodule(manifest);
  if (previousSubmodule === targetSubmodule) {
    return { document: manifest.document, migratedResources: [] };
  }

  const ownerModule = normalizeModule(manifest.document.module);
  const externalActive = Object.values(registry.resources).filter((resource) => resource
    && resource.status === 'active'
    && (normalizeModule(resource.module) !== ownerModule || resource.scope !== 'module'));
  if (externalActive.length > 0) {
    fail(
      'PSD2UI_EXTERNAL_RESOURCE_SUBMODULE_REQUIRED',
      `文档存在 ${externalActive.length} 个不属于 '${ownerModule}' 本地 module scope 的活动资源；本次 document submodule 迁移已阻断。`);
  }

  const activeByKindAndNumber = new Set();
  Object.values(registry.resources).forEach((resource) => {
    if (!resource
        || resource.status !== 'active'
        || normalizeModule(resource.module) !== ownerModule) return;
    const key = `${resource.kind}|${resource.number}`;
    if (activeByKindAndNumber.has(key)) {
      fail(
        'PSD2UI_SUBMODULE_NUMBER_COLLISION',
        `资源迁移到 submodule '${targetSubmodule}' 时发现重复编号 ${resource.kind}/${resource.number}；请先人工迁移冲突资源。`);
    }
    activeByKindAndNumber.add(key);
  });

  const migratedResources = [];
  Object.values(registry.resources).forEach((resource) => {
    if (!resource
        || resource.status !== 'active'
        || normalizeModule(resource.module) !== ownerModule
        || !resource.fileName) return;
    resource.history = resource.history || [];
    resource.history.push({
      module: resource.module,
      ...(resource.submodule ? { submodule: resource.submodule } : {}),
      kind: resource.kind,
      number: resource.number,
      fileName: resource.fileName,
      reason: String(input && input.reason || 'document-submodule-migration')
    });
    resource.submodule = targetSubmodule;
    resource.fileName = formatFileName(ownerModule, resource.kind, resource.number, targetSubmodule);
    migratedResources.push(resource.id);
  });

  [ResourceKinds.SPRITE, ResourceKinds.TEXTURE].forEach((kind) => {
    const numbers = Object.values(registry.resources)
      .filter((resource) => resource
        && normalizeModule(resource.module) === ownerModule
        && resource.kind === kind
        && Number.isInteger(resource.number))
      .map((resource) => resource.number);
    if (numbers.length > 0) {
      const legacyNext = Number.isInteger(registry.counters[counterKey(ownerModule, kind)])
        ? registry.counters[counterKey(ownerModule, kind)]
        : 1;
      registry.counters[counterKey(ownerModule, kind, targetSubmodule)] = Math.max(
        legacyNext,
        Math.max(...numbers) + 1);
    }
  });
  manifest.document.submodule = targetSubmodule;
  manifest.manifestVersion = '1.1.0';
  return { document: manifest.document, migratedResources };
}

module.exports = {
  ResourceKinds,
  normalizeLayerId,
  normalizeModule,
  normalizeSubmodule,
  normalizeKind,
  ensureRegistry,
  formatFileName,
  formatManifestResourceFileName,
  getResourceByLayer,
  allocateResource,
  reuseResource,
  retireResource,
  reconcileResourceBindings,
  migrateResource,
  migrateDocumentSubmodule
};
