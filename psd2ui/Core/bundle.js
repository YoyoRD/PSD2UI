'use strict';

const { assertManifestValid } = require('./validation');
const { fail } = require('./errors');
const { ensureRegistry } = require('./resourceRegistry');
const { prepareManifestForExport, collectUnconfiguredEmptyGroupIds } = require('./snapshot');
const { normalizeSliceBorder } = require('./nineSlice');
const { collectInvalidImageLayerNames, collectInvalidLayerNames, stripLegacyLayerSuffix } = require('./naming');

function prepareSourceManifest(manifest, snapshot, options) {
  const source = JSON.parse(JSON.stringify(manifest || null));
  if (!source || !source.document) fail('PSD2UI_MANIFEST_REQUIRED', '源命名升级需要已初始化的文档。');
  source.resourceNaming = 'source';
  const issues = collectInvalidImageLayerNames(snapshot, source);
  if (issues.length) fail('PSD2UI_IMAGE_NAMES_INVALID', '图片命名检查未通过；源命名草稿未保存。', { diagnostics: issues });
  return prepareManifestForExport(source, snapshot, { ...(options || {}), allocateResources: true });
}

function preflightBundle(manifest, snapshot) {
  const namingIssues = manifest && manifest.resourceNaming === 'source'
    ? collectInvalidImageLayerNames(snapshot, manifest) : [];
  if (namingIssues.length) return { status: 'blocked', issues: namingIssues, bundle: null };
  try { return { status: 'ready', issues: [], bundle: buildBundle(manifest, snapshot) }; }
  catch (error) {
    const issues = error.issues || error.details && error.details.diagnostics
      || [{ severity: 'error', code: error.code || 'PSD2UI_PREFLIGHT_FAILED', message: error.message,
        ...(error.details || {}) }];
    return { status: 'blocked', issues, bundle: null };
  }
}

function number(value, label, details) {
  const parsed = value && typeof value === 'object' && 'value' in value ? Number(value.value) : Number(value);
  if (!Number.isFinite(parsed)) {
    fail('PSD2UI_GEOMETRY_INVALID', `${label} 不是有效数值。`, details);
  }
  return parsed;
}

function normalizeBounds(bounds, label, details) {
  if (!bounds) {
    fail('PSD2UI_BOUNDS_REQUIRED', `${label} 缺少 bounds。`, details);
  }
  const left = number(bounds.left, `${label}.left`, details);
  const top = number(bounds.top, `${label}.top`, details);
  const right = number(bounds.right, `${label}.right`, details);
  const bottom = number(bounds.bottom, `${label}.bottom`, details);
  if (right < left || bottom < top) {
    fail('PSD2UI_BOUNDS_INVALID', `${label} 的 bounds 顺序无效。`, details);
  }
  return { left, top, right, bottom };
}

function indexSnapshot(root) {
  const byId = {};
  function visit(layer) {
    if (!layer) return;
    const id = String(layer.layerId == null ? '' : layer.layerId);
    if (!id) {
      fail('PSD2UI_SNAPSHOT_LAYER_ID_REQUIRED', 'Photoshop 快照中存在缺少 layerId 的图层。');
    }
    byId[id] = layer;
    (layer.children || []).forEach(visit);
  }
  visit(root);
  return byId;
}

function cloneComponent(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function buildBundle(manifest, snapshot) {
  if (!snapshot || !snapshot.root) {
    fail('PSD2UI_SNAPSHOT_REQUIRED', '导出时必须提供当前 Photoshop 图层树快照。');
  }
  if (manifest && manifest.resourceNaming === 'source') {
    const issues = collectInvalidImageLayerNames(snapshot, manifest);
    if (issues.length) fail('PSD2UI_IMAGE_NAMES_INVALID', '图片命名检查未通过；请定位并修正图片图层。', { diagnostics: issues });
  } else if (collectInvalidLayerNames(snapshot).length) {
    fail('PSD2UI_LAYER_NAME_ENGLISH_REQUIRED', '旧版资源编号模式仅支持英文标识符图层名：'
      + collectInvalidLayerNames(snapshot).map((entry) => `${entry.layerId}:${entry.name}`).join('、'));
  }
  const prepared = prepareManifestForExport(manifest, snapshot);
  const exportManifest = prepared.manifest;
  const blockingDiagnostics = prepared.diagnostics
    .filter((entry) => entry && entry.severity === 'error');
  if (blockingDiagnostics.length > 0) {
    fail(
      'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT',
      `组件结构不完整，共 ${blockingDiagnostics.length} 项；请在 Photoshop 面板重新结构化后再导出。`,
      { diagnostics: blockingDiagnostics });
  }
  const registry = ensureRegistry(exportManifest);
  const rootLayerId = String(exportManifest.document.rootLayerId);
  const byId = indexSnapshot(snapshot.root);
  const snapshotRoot = byId[rootLayerId];
  if (!snapshotRoot) {
    fail('PSD2UI_ROOT_LAYER_MISSING', `当前 PSD 中找不到根图层 ${rootLayerId}。`, { layerId: rootLayerId });
  }
  const usedResources = new Map();
  const resourceSourceLayers = new Map();
  const sourceNaming = exportManifest.resourceNaming === 'source';
  const diagnostics = prepared.diagnostics.slice();
  const previewLayerIds = new Set();
  const stateVisibility = new Map();
  const runtimeNodes = new Map();
  const emptyGroupIds = collectUnconfiguredEmptyGroupIds(snapshotRoot, exportManifest);
  function collectRuntimeNodes(layer) {
    const layerId = String(layer.layerId);
    const authored = exportManifest.nodes[layerId];
    if (previewLayerIds.has(layerId) || emptyGroupIds.has(layerId) || authored.semantic === 'ignore'
        || authored.exportMode === 'preview-only') return;
    runtimeNodes.set(layerId, authored);
    const structure = authored.structure;
    (structure && structure.previewLayerIds || []).forEach((previewLayerId) => {
      previewLayerIds.add(String(previewLayerId));
    });
    (layer.children || []).forEach(collectRuntimeNodes);
  }
  collectRuntimeNodes(snapshotRoot);
  runtimeNodes.forEach((authored) => {
    if (sourceNaming && authored.visualStates) {
      const visualStates = authored.visualStates;
      if (!Array.isArray(visualStates.states) || !visualStates.states.length
          || !visualStates.states.some((state) => state.name === visualStates.defaultState)) {
        fail('PSD2UI_VISUAL_STATES_INVALID', `节点 '${authored.name}' 的默认状态必须引用一个已声明状态。`, { layerId: authored.layerId, nodeId: authored.id });
      }
      const names = new Set();
      const ids = new Set();
      visualStates.states.forEach((state) => {
        const id = String(state.layerId);
        if (!state.name || names.has(state.name) || ids.has(id)
            || !runtimeNodes.has(id)) {
          fail('PSD2UI_VISUAL_STATES_INVALID', `节点 '${authored.name}' 存在重复或缺失的状态组 ${id}。`, { layerId: authored.layerId, nodeId: authored.id, otherLayerId: id });
        }
        names.add(state.name);
        ids.add(id);
        if (stateVisibility.has(id)) fail('PSD2UI_VISUAL_STATE_OWNER_CONFLICT', `状态组 ${id} 同时属于多个状态集合。`, { layerId: id, nodeId: authored.id });
        stateVisibility.set(id, state.name === visualStates.defaultState ? 'enabled' : 'disabled');
      });
    }
  });

  if (sourceNaming) {
    const nodes = {};
    const referenced = new Set();
    runtimeNodes.forEach((node, id) => {
      nodes[id] = node;
      [node.image && node.image.resourceId, node.rawImage && node.rawImage.resourceId]
        .filter(Boolean).forEach((resourceId) => referenced.add(resourceId));
    });
    const resources = {};
    referenced.forEach((resourceId) => { if (registry.resources[resourceId]) resources[resourceId] = registry.resources[resourceId]; });
    assertManifestValid({ ...exportManifest, nodes,
      resourceRegistry: { ...registry, resources } });
  } else assertManifestValid(exportManifest);

  function compileStructure(authored) {
    if (!authored.structure) return null;
    let complete = true;
    const roles = authored.structure.roles.map((role) => {
      const target = exportManifest.nodes[String(role.layerId)];
      if (!target || !runtimeNodes.has(String(role.layerId))) {
        complete = false;
        diagnostics.push({
          severity: 'warning',
          code: 'PSD2UI_STRUCTURE_ROLE_MISSING',
          nodeId: authored.id || '',
          message: `组件 '${authored.name}' 的角色 '${role.name}' 指向的图层 ${role.layerId} 已缺失或不可导出。`
        });
      }
      return {
        name: role.name,
        nodeId: target && runtimeNodes.has(String(role.layerId)) ? target.id : null
      };
    });
    return {
      version: 1, status: complete ? 'complete' : 'incomplete', roles,
      ...(authored.structure.layout ? { layout: cloneComponent(authored.structure.layout) } : {})
    };
  }

  function useResource(resourceId, sliceBorder, width, height, layerId) {
    if (!resourceId) return;
    if (!resourceSourceLayers.has(resourceId)) resourceSourceLayers.set(resourceId, new Set());
    resourceSourceLayers.get(resourceId).add(layerId);
    let normalizedSlice = null;
    if (sliceBorder) {
      try {
        normalizedSlice = normalizeSliceBorder(sliceBorder, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
      } catch (error) {
        error.details = { ...(error.details || {}), layerId, resourceId };
        throw error;
      }
    }
    if (usedResources.has(resourceId)) {
      const existing = usedResources.get(resourceId);
      if (JSON.stringify(existing) !== JSON.stringify(normalizedSlice)) {
        fail('PSD2UI_SLICE_RESOURCE_CONFLICT', `资源 '${resourceId}' 被多个节点以不同九宫参数复用。`, { resourceId, layerIds: [...resourceSourceLayers.get(resourceId)] });
      }
      return;
    }
    usedResources.set(resourceId, normalizedSlice);
  }

  function compile(layer, parentBounds, isRoot) {
    const layerId = String(layer.layerId);
    if (!runtimeNodes.has(layerId)) return null;
    const authored = exportManifest.nodes[layerId];
    if (authored.semantic === 'ignore') {
      return null;
    }
    const bounds = normalizeBounds(layer.bounds, `layer:${layerId}`, { layerId, nodeId: authored.id, name: layer.name });
    const reference = isRoot
      ? { left: bounds.left, top: bounds.top }
      : parentBounds;
    const node = {
      id: authored.id,
      sourceLayerId: layerId,
      // Bundle 保留美术维护的 Photoshop 基础名；Unity Adapter 可根据明确语义添加组件前缀。
      name: stripLegacyLayerSuffix(authored.name || layer.name),
      semantic: authored.semantic,
      authoringSource: authored.authoringSource || 'explicit',
      structure: compileStructure(authored),
      defaultsVersion: authored.presetVersion,
      rect: {
        x: isRoot ? 0 : bounds.left - reference.left,
        y: isRoot ? 0 : bounds.top - reference.top,
        width: isRoot ? exportManifest.document.width : bounds.right - bounds.left,
        height: isRoot ? exportManifest.document.height : bounds.bottom - bounds.top
      },
      visible: stateVisibility.has(layerId) ? stateVisibility.get(layerId) : authored.visible,
      opacity: authored.opacity,
      rotationClockwiseDegrees: authored.rotationClockwiseDegrees,
      image: cloneComponent(authored.image),
      rawImage: cloneComponent(authored.rawImage),
      text: cloneComponent(authored.text),
      button: cloneComponent(authored.button),
      children: []
    };
    if (!sourceNaming && node.text) delete node.text.layoutMode;
    if (sourceNaming && authored.viewport) {
      node.rect.width = authored.viewport.width;
      node.rect.height = authored.viewport.height;
    }
    if (sourceNaming && authored.visualStates) {
      node.visualStates = {
        defaultState: authored.visualStates.defaultState,
        states: authored.visualStates.states.map((state) => ({
          name: state.name, nodeId: exportManifest.nodes[String(state.layerId)].id
        }))
      };
    }
    if (node.image && node.image.resourceId) {
      useResource(node.image.resourceId, node.image.sliceBorder, node.rect.width, node.rect.height, layerId);
    }
    if (node.rawImage && node.rawImage.resourceId) useResource(node.rawImage.resourceId, null, 0, 0, layerId);
    if (node.semantic === 'list' || node.semantic === 'grid') {
      diagnostics.push({
        severity: 'warning',
        code: 'PSD2UI_MODULE_INCOMPLETE',
        nodeId: node.id,
        message: `节点 '${node.name}' 已导出模板与布局，业务数据及条目交互仍需在目标项目绑定。`
      });
    }
    (layer.children || []).forEach((child) => {
      const compiled = compile(child, bounds, false);
      if (compiled) node.children.push(compiled);
    });
    return node;
  }

  const root = compile(snapshotRoot, null, true);
  const submodule = exportManifest.document.submodule || null;
  const resources = Array.from(usedResources.keys()).map((resourceId) => {
    const resource = registry.resources[resourceId];
    if (!resource || resource.status !== 'active') {
      fail('PSD2UI_BUNDLE_RESOURCE_MISSING', `Bundle 引用了无效资源 '${resourceId}'。`, { resourceId, layerIds: [...resourceSourceLayers.get(resourceId) || []] });
    }
    const sourceLayerIds = Array.from(resourceSourceLayers.get(resourceId) || []);
    const sourceLayerId = sourceLayerIds.includes(String(resource.sourceLayerId))
      ? String(resource.sourceLayerId) : sourceLayerIds[0];
    return {
      id: resource.id,
      kind: resource.kind,
      scope: resource.scope,
      module: resource.module,
      ...(!sourceNaming && submodule ? { submodule: resource.submodule } : {}),
      number: resource.number,
      fileName: resource.fileName,
      sourceLayerId: sourceNaming ? sourceLayerId : resource.sourceLayerId,
      ...(sourceNaming ? { sourceLayerIds } : {}),
      sliceBorder: usedResources.get(resourceId)
    };
  }).sort((left, right) => left.fileName.localeCompare(right.fileName));

  return {
    // 1.4 保留基础名契约，补齐 List/Grid 的结构布局；旧版本仍由 Reader 兼容。
    schemaVersion: sourceNaming ? '1.5.0' : '1.4.0',
    generator: 'YoyoEngine.PSD2UI',
    document: {
      id: exportManifest.document.id,
      name: exportManifest.document.name,
      module: exportManifest.document.module,
      ...(submodule ? { submodule } : {}),
      width: exportManifest.document.width,
      height: exportManifest.document.height,
      coordSpace: exportManifest.document.coordSpace
    },
    resources,
    diagnostics,
    root
  };
}

module.exports = { buildBundle, preflightBundle, prepareSourceManifest };
