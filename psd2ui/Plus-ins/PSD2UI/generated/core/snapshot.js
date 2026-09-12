'use strict';

const { createPreset, ENABLED, DISABLED } = require('./defaults');
const { createId } = require('./ids');
const { fail } = require('./errors');
const {
  allocateResource,
  ensureRegistry,
  reconcileResourceBindings
} = require('./resourceRegistry');
const { isGroupLayer, normalizeLayerKind, requiresStructure, planCollectionLayout,
  validateStructureLayout, validateTemplateSize, isWithinComponent,
  StructureRoleContracts, structureRoleContract, validateVisualStates } = require('./structure');
const { applyManifestNodeNames } = require('./naming');

const ImplicitImageSemantics = new Set([
  'button', 'input-field', 'toggle', 'list', 'grid', 'red-point',
  'toggle-page-group', 'list-page-group'
]);
const StructureRecoveryHint = '请在当前组件的设置中核对角色、模板和布局；普通嵌套组无需移回直属层。';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundsSize(layer) {
  const bounds = layer && layer.bounds || {};
  return {
    width: Math.max(0, number(bounds.right, 0) - number(bounds.left, 0)),
    height: Math.max(0, number(bounds.bottom, 0) - number(bounds.top, 0))
  };
}

function inferSemantic(layer, isRoot, threshold) {
  if (isRoot) return 'view';
  const kind = normalizeLayerKind(layer);
  if (kind === 'group') return 'group';
  if (kind === 'text') return 'text';
  const size = boundsSize(layer);
  return size.width > threshold || size.height > threshold ? 'raw-image' : 'image';
}

// Project defaults, not Unity limits. Keep the legacy numbered workflow's inference above.
// Reserve a conservative four pixels on either side for a 2048 atlas.
const AutomaticImagePolicy = Object.freeze({ textureMinArea: 512 * 512, spriteMaxSide: 2040 });

function inferSourceSemantic(layer, isRoot) {
  const semantic = inferSemantic(layer, isRoot, Infinity);
  if (semantic !== 'image') return semantic;
  const size = boundsSize(layer);
  return size.width * size.height >= AutomaticImagePolicy.textureMinArea
    || Math.max(size.width, size.height) > AutomaticImagePolicy.spriteMaxSide
    ? 'raw-image' : 'image';
}

function applyAutomaticImagePolicy(manifest, root) {
  if (manifest.resourceNaming !== 'source') return;
  const nodes = manifest.nodes || {};
  const spriteRequired = new Set();
  Object.values(nodes).forEach(owner => {
    (owner.structure && owner.structure.roles || []).forEach(role => {
      const contract = structureRoleContract(owner.semantic, role.name);
      if (contract && contract.semantics.includes('image') && !contract.semantics.includes('raw-image')) {
        spriteRequired.add(String(role.layerId));
      }
    });
  });
  function visit(layer) {
    if (!layer) return;
    const id = String(layer.layerId == null ? layer.id : layer.layerId);
    const node = nodes[id];
    if (node && node.authoringSource === 'default' && normalizeLayerKind(layer) === 'image'
        && ['image', 'raw-image'].includes(node.semantic) && !node.structure && !node.visualStates) {
      const oldKey = node.semantic === 'image' ? 'image' : 'rawImage';
      const previous = node[oldKey] || {};
      // Even older default nodes may have saved Image-only or UV settings. Never discard those.
      const specificSettings = oldKey === 'image'
        ? previous.imageType && previous.imageType !== 'simple' || previous.sliceBorder
          || previous.preserveAspect === ENABLED
        : previous.uvRect && Object.entries({ x: 0, y: 0, width: 1, height: 1 })
          .some(([key, value]) => previous.uvRect[key] !== value);
      const semantic = spriteRequired.has(id) ? 'image' : inferSourceSemantic(layer, false);
      if (!specificSettings && semantic !== node.semantic) {
        const key = semantic === 'image' ? 'image' : 'rawImage';
        node[key] = createPreset(semantic)[key];
        for (const field of ['resourceId', 'raycast', 'color']) {
          if (Object.prototype.hasOwnProperty.call(previous, field)) node[key][field] = previous[field];
        }
        delete node[oldKey];
        node.semantic = semantic;
      }
    }
    (layer.children || []).forEach(visit);
  }
  visit(root);
}

// Read-only panel projection: selection refresh must agree with export without saving the PSD.
function projectAutomaticImageSemantics(currentManifest, snapshot) {
  const manifest = clone(currentManifest);
  if (manifest && snapshot) applyAutomaticImagePolicy(manifest, snapshot.root);
  return manifest;
}

// This is an export decision, not a persisted Ignore preset: adding content makes the group export again.
function collectUnconfiguredEmptyGroupIds(root, manifest) {
  const emptyIds = new Set();
  const nodes = manifest && manifest.nodes || {};
  const rootId = String(manifest && manifest.document && manifest.document.rootLayerId || '');
  const referencedIds = new Set();
  Object.values(nodes).forEach(node => {
    (node.structure && node.structure.roles || []).forEach(role => referencedIds.add(String(role.layerId)));
    (node.visualStates && node.visualStates.states || []).forEach(state => referencedIds.add(String(state.layerId)));
  });
  function visit(layer) {
    if (!layer) return;
    const children = layer.children || [];
    children.forEach(visit);
    const id = String(layer.layerId == null ? layer.id : layer.layerId);
    const node = nodes[id];
    if (id !== rootId && !referencedIds.has(id) && isGroupLayer(layer)
        && (!node || node.authoringSource === 'default' && !node.structure && !node.visualStates && !node.viewport)
        && children.every(child => emptyIds.has(String(child.layerId == null ? child.id : child.layerId)))) {
      emptyIds.add(id);
    }
  }
  visit(root);
  return emptyIds;
}

function normalizeColor(value) {
  if (!value) return null;
  const result = {};
  for (const key of ['r', 'g', 'b', 'a']) {
    if (!Number.isFinite(Number(value[key]))) return null;
    result[key] = Math.max(0, Math.min(1, Number(value[key])));
  }
  return result;
}

function applyPhotoshopOwnedValues(node, layer) {
  if (typeof layer.visible === 'boolean') node.visible = layer.visible ? ENABLED : DISABLED;
  if (Number.isFinite(Number(layer.opacity))) node.opacity = Math.max(0, Math.min(1, Number(layer.opacity)));
  if (Number.isFinite(Number(layer.rotationClockwiseDegrees))) {
    node.rotationClockwiseDegrees = Number(layer.rotationClockwiseDegrees);
  }
  if (node.semantic !== 'text' || !node.text) return;
  if (!layer.text) {
    delete node.text.layoutMode;
    return;
  }
  if (typeof layer.text.value === 'string') node.text.value = layer.text.value;
  if (Number.isFinite(Number(layer.text.fontSize)) && Number(layer.text.fontSize) > 0) {
    node.text.fontSize = Math.max(1, Math.round(Number(layer.text.fontSize)));
  }
  if (typeof layer.text.alignment === 'string' && layer.text.alignment) {
    node.text.alignment = layer.text.alignment;
  }
  if (['point', 'paragraph'].includes(layer.text.layoutMode)) {
    node.text.layoutMode = layer.text.layoutMode;
  } else {
    delete node.text.layoutMode;
  }
  if (Number.isFinite(Number(layer.text.lineSpacing)) && Number(layer.text.lineSpacing) > 0) {
    node.text.lineSpacing = Number(layer.text.lineSpacing);
  }
  if (Number.isFinite(layer.text.lineAdvance) && layer.text.lineAdvance > 0) node.text.lineAdvance = layer.text.lineAdvance;
  else delete node.text.lineAdvance;
  if (layer.text.photoshop) node.text.photoshop = clone(layer.text.photoshop);
  else delete node.text.photoshop;
  const color = normalizeColor(layer.text.color);
  if (color) node.text.color = color;
  node.text.effects = layer.text.effects ? clone(layer.text.effects) : null;
}

function ensureNodeShape(node) {
  if (!node.authoringSource) node.authoringSource = 'explicit';
  if (!node.exportMode) node.exportMode = 'runtime';
  if (!Object.prototype.hasOwnProperty.call(node, 'structure')) node.structure = null;
  if (node.semantic === 'image' && node.image
      && !Object.prototype.hasOwnProperty.call(node.image, 'sliceBorder')) {
    node.image.sliceBorder = null;
  }
  if (node.semantic === 'text' && node.text && !node.text.fontKey) node.text.fontKey = 'default';
  return node;
}

function collectSnapshotTopology(root) {
  const parentById = {};
  const layersById = {};
  const layerIdsInOrder = [];
  function visit(layer, parentLayerId) {
    if (!layer) return;
    const layerId = String(layer.layerId == null ? '' : layer.layerId);
    if (!layerId) fail('PSD2UI_SNAPSHOT_LAYER_ID_REQUIRED', 'Photoshop 快照中存在缺少 layerId 的图层。');
    parentById[layerId] = parentLayerId || '';
    layersById[layerId] = layer;
    layerIdsInOrder.push(layerId);
    (layer.children || []).forEach((child) => visit(child, layerId));
  }
  visit(root, '');
  return { parentById, layersById, layerIdsInOrder };
}

function requiredStructureRoleNames(semantic, roles) {
  if (semantic === 'toggle-page-group') {
    const indexes = (roles || []).map((role) => /^toggle-(0|[1-9][0-9]*)$/.exec(String(role && role.name || '')))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    if (indexes.length === 0) return ['toggle-0'];
    const maximum = Math.max(...indexes);
    return Array.from({ length: maximum + 1 }, (_entry, index) => `toggle-${index}`);
  }
  const contracts = StructureRoleContracts[semantic] || {};
  return Object.keys(contracts).filter((roleName) => contracts[roleName].required);
}

function isDescendantLayer(layerId, ancestorLayerId, parentById) {
  let current = String(layerId || '');
  const ancestor = String(ancestorLayerId || '');
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    current = String(parentById[current] || '');
    if (current === ancestor) return true;
  }
  return false;
}

function prepareManifestForExport(currentManifest, snapshot, options) {
  if (!currentManifest || !currentManifest.document) {
    fail('PSD2UI_MANIFEST_REQUIRED', '请先初始化当前 PSD 文档，再执行默认导出。');
  }
  if (!snapshot || !snapshot.root) {
    fail('PSD2UI_SNAPSHOT_REQUIRED', '默认导出需要当前 Photoshop 图层树快照。');
  }
  const manifest = clone(currentManifest);
  manifest.nodes = manifest.nodes || {};
  const registry = ensureRegistry(manifest);
  const topology = collectSnapshotTopology(snapshot.root);
  const activeLayerIds = new Set(topology.layerIdsInOrder);
  const removedLayerIds = Object.keys(manifest.nodes)
    .filter((layerId) => !activeLayerIds.has(String(layerId)));
  removedLayerIds.forEach((layerId) => delete manifest.nodes[layerId]);
  const removedPreviewLayerIds = [];
  Object.keys(manifest.nodes).forEach((layerId) => {
    const structure = manifest.nodes[layerId] && manifest.nodes[layerId].structure;
    if (!structure || !Array.isArray(structure.previewLayerIds)) return;
    structure.previewLayerIds = structure.previewLayerIds.filter((previewLayerId) => {
      const previewId = String(previewLayerId);
      const keep = activeLayerIds.has(previewId)
        && isDescendantLayer(previewId, layerId, topology.parentById);
      if (!keep) removedPreviewLayerIds.push(previewId);
      return keep;
    });
  });
  const idFactory = options && options.idFactory ? options.idFactory : createId;
  const threshold = options && Number.isFinite(options.largeImageThreshold)
    ? options.largeImageThreshold
    : 512;
  const allocateResources = !options || options.allocateResources !== false;
  let defaultedCount = 0;
  let defaultSemanticCount = 0;

  function ensureVisualResourceTarget(node, layer) {
    const implicitImage = ImplicitImageSemantics.has(node.semantic)
      && normalizeLayerKind(layer) === 'image';
    if (implicitImage && !node.image) {
      node.image = createPreset('image').image;
    }
    if (node.semantic !== 'image' && node.semantic !== 'raw-image' && !implicitImage) {
      return null;
    }
    const componentKey = node.semantic === 'raw-image' ? 'rawImage' : 'image';
    const resourceKind = node.semantic === 'raw-image' ? 'texture' : 'sprite';
    if (!node[componentKey]) {
      const replacement = createPreset(node.semantic === 'raw-image' ? 'raw-image' : 'image');
      node[componentKey] = replacement[componentKey];
    }
    return { componentKey, resourceKind };
  }

  function visit(layer, isRoot) {
    const layerId = String(layer.layerId == null ? '' : layer.layerId);
    if (!layerId) fail('PSD2UI_SNAPSHOT_LAYER_ID_REQUIRED', 'Photoshop 快照中存在缺少 layerId 的图层。');
    let node = manifest.nodes[layerId];
    if (!node) {
      const semantic = manifest.resourceNaming === 'source'
        ? inferSourceSemantic(layer, isRoot) : inferSemantic(layer, isRoot, threshold);
      node = createPreset(semantic);
      node.id = idFactory('node');
      node.layerId = layerId;
      node.name = String(layer.name || `Layer-${layerId}`);
      node.authoringSource = 'default';
      manifest.nodes[layerId] = node;
      defaultedCount += 1;
    }
    ensureNodeShape(node);
    applyPhotoshopOwnedValues(node, layer);
    if (node.authoringSource === 'default') defaultSemanticCount += 1;

    const visualTarget = ensureVisualResourceTarget(node, layer);
    if (visualTarget && !node[visualTarget.componentKey].resourceId) {
      const boundResourceId = registry.layerBindings[layerId];
      const boundResource = boundResourceId && registry.resources[boundResourceId];
      if (boundResource
          && boundResource.status === 'active'
          && boundResource.kind === visualTarget.resourceKind) {
        node[visualTarget.componentKey].resourceId = boundResource.id;
      }
    }

    (layer.children || []).forEach((child) => visit(child, false));
  }

  visit(snapshot.root, true);
  applyAutomaticImagePolicy(manifest, snapshot.root);
  const resourceReconciliation = reconcileResourceBindings(
    manifest,
    topology.layerIdsInOrder);
  const previewLayerIdSet = new Set();
  const runtimeLayerIds = new Set();
  const emptyGroupIds = collectUnconfiguredEmptyGroupIds(snapshot.root, manifest);
  const sourceCandidates = manifest.resourceNaming === 'source' ? Object.create(null) : undefined;
  function collectRuntimeLayers(layer) {
    if (!layer) return;
    const layerId = String(layer.layerId);
    const node = manifest.nodes[layerId];
    if (!node || node.semantic === 'ignore' || node.exportMode === 'preview-only'
        || previewLayerIdSet.has(layerId) || emptyGroupIds.has(layerId)) return;
    runtimeLayerIds.add(layerId);
    (node.structure && node.structure.previewLayerIds || [])
      .forEach((previewLayerId) => previewLayerIdSet.add(String(previewLayerId)));
    if (sourceCandidates) {
      const visualTarget = ensureVisualResourceTarget(node, layer);
      if (visualTarget) sourceCandidates[layerId] = { layerName: layer.name, kind: visualTarget.resourceKind };
    }
    (layer.children || []).forEach(collectRuntimeLayers);
  }
  collectRuntimeLayers(snapshot.root);
  if (allocateResources) {
    function allocateMissingResources(layer) {
      const layerId = String(layer.layerId);
      if (sourceCandidates && !runtimeLayerIds.has(layerId)) return;
      const node = manifest.nodes[layerId];
      const visualTarget = ensureVisualResourceTarget(node, layer);
      if (visualTarget && (manifest.resourceNaming === 'source' || !node[visualTarget.componentKey].resourceId)) {
        const resource = allocateResource(manifest, {
          layerId,
          layerName: layer.name,
          kind: visualTarget.resourceKind,
          module: manifest.document.module
        }, { idFactory, sourceCandidates });
        node[visualTarget.componentKey].resourceId = resource.id;
      }
      (layer.children || []).forEach(allocateMissingResources);
    }
    allocateMissingResources(snapshot.root);
  }
  applyManifestNodeNames(manifest, snapshot);
  const diagnostics = [];
  if (removedLayerIds.length > 0
      || resourceReconciliation.retiredResourceIds.length > 0
      || resourceReconciliation.reassignedResourceSources.length > 0
      || removedPreviewLayerIds.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'PSD2UI_LAYER_TREE_RECONCILED',
      nodeId: '',
      message: `已按当前 Photoshop 图层树同步配置：删除 ${removedLayerIds.length} 个失效节点，`
        + `停用 ${resourceReconciliation.retiredResourceIds.length} 个无引用资源，`
        + `重定向 ${resourceReconciliation.reassignedResourceSources.length} 个资源来源。`
    });
  }
  if (defaultSemanticCount > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'PSD2UI_DEFAULT_SEMANTICS_APPLIED',
      nodeId: '',
      message: `有 ${defaultSemanticCount} 个图层没有人工语义配置，已按 Photoshop 类型和尺寸使用默认投影。`
    });
  }
  Object.keys(manifest.nodes).forEach((layerId) => {
    const node = manifest.nodes[layerId];
    if (!runtimeLayerIds.has(String(layerId))) return;
    const layer = topology.layersById[String(layerId)];
    const layerKind = normalizeLayerKind(layer);
    if (node.visualStates) {
      try {
        if (!isGroupLayer(layer)) fail('PSD2UI_VISUAL_STATE_ROOT_INVALID', '视觉状态只能配置在 Photoshop 组上。');
        const settings = validateVisualStates(node.visualStates);
        settings.states.forEach((state) => {
          const target = topology.layersById[state.layerId];
          if (!target || !isGroupLayer(target) || !runtimeLayerIds.has(state.layerId)
              || !isWithinComponent(state.layerId, layerId, topology.parentById, manifest.nodes)) {
            fail('PSD2UI_VISUAL_STATE_SCOPE_INVALID', `状态 '${state.name}' 必须指向当前组件内可导出的组，不能穿越其他组件。`);
          }
          if (settings.states.some((other) => other.layerId !== state.layerId
              && isDescendantLayer(state.layerId, other.layerId, topology.parentById))) {
            fail('PSD2UI_VISUAL_STATE_OVERLAP', '不同状态组不能互相嵌套。');
          }
        });
      } catch (error) {
        diagnostics.push({ severity: 'error', code: error.code || 'PSD2UI_VISUAL_STATES_INVALID',
          nodeId: node.id || '', message: `节点 '${node.name || layerId}'：${error.message}` });
      }
    }
    if (node.viewport) {
      const viewport = node.viewport;
      if (!['list', 'grid'].includes(node.semantic) || !isGroupLayer(layer)
          || !Number.isFinite(viewport.width) || viewport.width <= 0
          || !Number.isFinite(viewport.height) || viewport.height <= 0
          || Object.keys(viewport).some((key) => !['width', 'height'].includes(key))) {
        diagnostics.push({ severity: 'error', code: 'PSD2UI_VIEWPORT_INVALID', nodeId: node.id || '',
          message: '可视区域必须位于列表或网格组根，并填写正的 width/height。' });
      } else {
        const currentBounds = Object.fromEntries(['left', 'top', 'right', 'bottom']
          .map((key) => [key, number(layer.bounds && layer.bounds[key], 0)]));
        if (!node.viewportSourceBounds) node.viewportSourceBounds = currentBounds;
        else if (Object.keys(currentBounds).some((key) => Math.abs(currentBounds[key] - node.viewportSourceBounds[key]) > 0.01)) {
          diagnostics.push({ severity: 'warning', code: 'PSD2UI_VIEWPORT_SOURCE_CHANGED', nodeId: node.id || '',
            message: `组件 '${node.name || layerId}' 的 PSD 范围已变化；保留明确设置的可视区域 ${viewport.width} × ${viewport.height}，请核对预览。` });
        }
      }
    }
    const directImageButton = node.semantic === 'button'
      && node.image
      && !node.structure
      && layerKind === 'image';
    const structuredComponent = requiresStructure(node.semantic) && !directImageButton;
    if (structuredComponent && !isGroupLayer(layer)) {
      diagnostics.push({
        severity: 'error',
        code: 'PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED',
        nodeId: node.id || '',
        message: `组件 '${node.name || layerId}' 的结构根必须是 Photoshop 组，当前类型为 ${layerKind}。`
          + '请先在 Photoshop 图层面板中建立组，再选择该组执行结构化。'
      });
      return;
    }
    if (structuredComponent && (!Array.isArray(layer.children) || layer.children.length === 0)) {
      diagnostics.push({
        severity: 'error',
        code: 'PSD2UI_STRUCTURE_ROOT_EMPTY',
        nodeId: node.id || '',
        message: `组件 '${node.name || layerId}' 的 Photoshop 组根没有直属子图层，不能导出为空组件节点。`
          + '请补齐直属子图层后，在同一组重新结构化。'
      });
      return;
    }
    if (structuredComponent) {
      const size = boundsSize(layer);
      if (size.width <= 0 || size.height <= 0) {
        diagnostics.push({
          severity: 'error',
          code: 'PSD2UI_STRUCTURE_ROOT_BOUNDS_INVALID',
          nodeId: node.id || '',
          message: `组件 '${node.name || layerId}' 的 Photoshop 组根必须具有正的像素宽高，`
            + `当前为 ${size.width} × ${size.height}；不会导出为丢失坐标或尺寸的空节点。`
        });
        return;
      }
    }
    if (structuredComponent
        && (!node.structure
          || !Array.isArray(node.structure.roles)
          || node.structure.roles.length === 0)) {
      diagnostics.push({
        severity: 'error',
        code: 'PSD2UI_STRUCTURE_INCOMPLETE',
        nodeId: node.id || '',
        message: `节点 '${node.name || layerId}' 已标记为 ${node.semantic}，但没有组件结构角色。${StructureRecoveryHint}`
      });
      return;
    }
    if (!node.structure || !Array.isArray(node.structure.roles)) return;
    const rolesByName = new Map();
    const roleTargetIds = new Set();
    node.structure.roles.forEach((role) => {
      const roleName = String(role && role.name || '');
      if (rolesByName.has(roleName)) {
        diagnostics.push({
          severity: 'error',
          code: 'PSD2UI_STRUCTURE_ROLE_INVALID',
          nodeId: node.id || '',
          message: `组件 '${node.name || layerId}' 的角色 '${roleName || '<empty>'}' 重复。${StructureRecoveryHint}`
        });
      } else {
        rolesByName.set(roleName, role);
      }
      const roleId = String(role && role.layerId || '');
      if (roleTargetIds.has(roleId)) {
        diagnostics.push({ severity: 'error', code: 'PSD2UI_STRUCTURE_ROLE_DUPLICATE', nodeId: node.id || '',
          message: `组件 '${node.name || layerId}' 多个角色指向同一个图层 ${roleId}。` });
      }
      roleTargetIds.add(roleId);
    });
    requiredStructureRoleNames(node.semantic, node.structure.roles).forEach((roleName) => {
      if (rolesByName.has(roleName)) return;
      diagnostics.push({
        severity: 'error',
        code: 'PSD2UI_STRUCTURE_ROLE_INVALID',
        nodeId: node.id || '',
        message: `组件 '${node.name || layerId}' 缺少必需角色 '${roleName}'。${StructureRecoveryHint}`
      });
    });
    node.structure.roles.forEach((role) => {
      const roleName = String(role && role.name || '');
      const contract = structureRoleContract(node.semantic, roleName);
      if (!contract) {
        diagnostics.push({
          severity: 'error',
          code: 'PSD2UI_STRUCTURE_ROLE_INVALID',
          nodeId: node.id || '',
          message: `组件 '${node.name || layerId}' 的语义 ${node.semantic} 不支持角色 '${roleName || '<empty>'}'。${StructureRecoveryHint}`
        });
      }
      const roleLayerId = String(role && role.layerId || '');
      const targetIsValid = activeLayerIds.has(roleLayerId)
        && runtimeLayerIds.has(roleLayerId)
        && isDescendantLayer(roleLayerId, layerId, topology.parentById);
      if (!targetIsValid) {
        diagnostics.push({
          severity: 'error',
          code: 'PSD2UI_STRUCTURE_ROLE_MISSING',
          nodeId: node.id || '',
          message: `组件 '${node.name || layerId}' 的角色 '${roleName}' 指向图层 ${roleLayerId || '<empty>'}，`
            + `但该图层已删除、移出组件组或不再参与导出。${StructureRecoveryHint}`
        });
        return;
      }
      if (!isWithinComponent(roleLayerId, layerId, topology.parentById, manifest.nodes)) {
        diagnostics.push({
          severity: 'error',
          code: 'PSD2UI_STRUCTURE_ROLE_CROSSES_COMPONENT',
          nodeId: node.id || '',
          message: `组件 '${node.name || layerId}' 的角色 '${roleName}' 指向图层 ${roleLayerId}，`
            + `但该引用穿越了另一个已配置组件的内部。${StructureRecoveryHint}`
        });
        return;
      }
      if (!contract) return;
      const targetLayer = topology.layersById[roleLayerId];
      const targetNode = manifest.nodes[roleLayerId];
      const targetKind = normalizeLayerKind(targetLayer);
      const kindMatches = contract.kinds.length === 0 || contract.kinds.includes(targetKind);
      const semanticMatches = contract.semantics.length === 0
        || contract.semantics.includes(String(targetNode && targetNode.semantic || ''));
      if (kindMatches && semanticMatches) return;
      diagnostics.push({
        severity: 'error',
        code: 'PSD2UI_STRUCTURE_ROLE_TYPE_MISMATCH',
        nodeId: node.id || '',
        message: `组件 '${node.name || layerId}' 的角色 '${roleName}' 指向图层 ${roleLayerId}，`
          + `当前 Photoshop 类型为 ${targetKind}、语义为 ${targetNode && targetNode.semantic || '<missing>'}，`
          + `已不符合原组件结构。${StructureRecoveryHint}`
      });
    });
    if (node.semantic === 'list' || node.semantic === 'grid') {
      try {
        const templateName = node.semantic === 'list' ? 'item-template' : 'cell-template';
        const template = rolesByName.get(templateName);
        const sampleIds = [...new Set([
          String(template && template.layerId || ''), ...(node.structure.previewLayerIds || []).map(String)
        ])];
        const templateId = String(template && template.layerId || '');
        const samples = sampleIds.map((id) => topology.layersById[id]).filter(Boolean);
        (node.structure.previewLayerIds || []).forEach((id) => {
          const sampleId = String(id);
          const sample = topology.layersById[sampleId];
          if (sampleId === templateId || !sample || !isGroupLayer(sample)
              || topology.parentById[sampleId] !== topology.parentById[templateId]
              || !isWithinComponent(sampleId, layerId, topology.parentById, manifest.nodes)) {
            fail('PSD2UI_STRUCTURE_PREVIEW_INVALID', '预览样例必须是当前模板的同级组，不能穿越其他组件。');
          }
        });
        if (samples.length >= 2 && node.structure.layoutSource !== 'explicit') {
          node.structure.layout = planCollectionLayout(node.semantic, samples);
        }
        const templateLayer = topology.layersById[String(template && template.layerId || '')];
        validateTemplateSize(node.semantic, node.structure.layout, templateLayer || {});
      } catch (error) {
        diagnostics.push({ severity: 'error', code: error.code || 'PSD2UI_STRUCTURE_LAYOUT_INVALID',
          nodeId: node.id || '', message: `组件 '${node.name || layerId}'：${error.message} ${StructureRecoveryHint}` });
      }
    }
  });
  return {
    manifest,
    diagnostics,
    defaultedCount,
    defaultSemanticCount,
    reconciliation: {
      removedLayerIds,
      removedPreviewLayerIds,
      ...resourceReconciliation
    }
  };
}

function normalizedLayerState(layer) {
  const bounds = layer.bounds || {};
  const state = {
    name: String(layer.name || ''),
    kind: normalizeLayerKind(layer),
    bounds: {
      left: number(bounds.left, 0),
      top: number(bounds.top, 0),
      right: number(bounds.right, 0),
      bottom: number(bounds.bottom, 0)
    },
    visible: layer.visible !== false,
    opacity: number(layer.opacity, 1),
    text: null,
    styleSignature: String(layer.styleSignature || '')
  };
  if (layer.text) {
    state.text = {
      value: String(layer.text.value || ''),
      fontSize: number(layer.text.fontSize, 0),
      alignment: String(layer.text.alignment || ''),
      lineSpacing: number(layer.text.lineSpacing, 0),
      lineAdvance: number(layer.text.lineAdvance, 0),
      photoshop: layer.text.photoshop ? clone(layer.text.photoshop) : null,
      color: normalizeColor(layer.text.color)
    };
    if (['point', 'paragraph'].includes(layer.text.layoutMode)) {
      state.text.layoutMode = layer.text.layoutMode;
    }
  }
  return state;
}

function captureBaseline(currentManifest, snapshot) {
  const manifest = clone(currentManifest);
  const layers = {};
  function visit(layer) {
    layers[String(layer.layerId)] = normalizedLayerState(layer);
    (layer.children || []).forEach(visit);
  }
  if (snapshot && snapshot.root) visit(snapshot.root);
  manifest.baseline = {
    revision: Number(manifest.revision) || 0,
    capturedAt: new Date().toISOString(),
    layers
  };
  return manifest;
}

function diffLayerFromBaseline(manifest, layer) {
  const baseline = manifest && manifest.baseline && manifest.baseline.layers
    ? manifest.baseline.layers[String(layer.layerId)]
    : null;
  if (!baseline) return ['尚未保存该图层的比较基线'];
  const current = normalizedLayerState(layer);
  const changes = [];
  if (baseline.name !== current.name) changes.push(`名称：${baseline.name} → ${current.name}`);
  if (baseline.kind !== current.kind) changes.push(`类型：${baseline.kind} → ${current.kind}`);
  if (JSON.stringify(baseline.bounds) !== JSON.stringify(current.bounds)) changes.push('位置或尺寸已改变');
  if (baseline.visible !== current.visible) changes.push(`可见性：${baseline.visible ? '可见' : '隐藏'} → ${current.visible ? '可见' : '隐藏'}`);
  if (baseline.opacity !== current.opacity) changes.push(`不透明度：${baseline.opacity} → ${current.opacity}`);
  if (JSON.stringify(baseline.text) !== JSON.stringify(current.text)) changes.push('文本内容或排版已改变');
  if (baseline.styleSignature !== current.styleSignature) changes.push('图层样式已改变');
  return changes;
}

function diffSnapshotFromBaseline(manifest, snapshot) {
  const changedLayers = [];
  const currentLayerIds = new Set();
  function visit(layer) {
    const layerId = String(layer.layerId);
    currentLayerIds.add(layerId);
    const changes = diffLayerFromBaseline(manifest, layer);
    if (changes.length > 0) {
      changedLayers.push({ layerId, name: String(layer.name || layerId), changes });
    }
    (layer.children || []).forEach(visit);
  }
  if (snapshot && snapshot.root) visit(snapshot.root);
  const baselineLayers = manifest && manifest.baseline && manifest.baseline.layers || {};
  Object.keys(baselineLayers).forEach((layerId) => {
    if (!currentLayerIds.has(layerId)) {
      changedLayers.push({
        layerId,
        name: String(baselineLayers[layerId].name || layerId),
        changes: ['图层已删除或移出界面根组']
      });
    }
  });
  return changedLayers;
}

module.exports = {
  inferSemantic,
  AutomaticImagePolicy,
  inferSourceSemantic,
  projectAutomaticImageSemantics,
  collectUnconfiguredEmptyGroupIds,
  prepareManifestForExport,
  captureBaseline,
  diffLayerFromBaseline,
  diffSnapshotFromBaseline
};
