'use strict';

const { createPreset } = require('./defaults');
const { createId } = require('./ids');
const { fail } = require('./errors');
const {
  normalizeLayerId,
  normalizeModule,
  normalizeSubmodule,
  allocateResource,
  reuseResource,
  retireResource,
  migrateResource,
  migrateDocumentSubmodule,
  ensureRegistry
} = require('./resourceRegistry');
const { validateManifest } = require('./validation');
const { requiresStructure, structureRoleContract, validateStructureLayout, validateVisualStates,
  planStructuredGroup } = require('./structure');
const { prepareManifestForExport, captureBaseline } = require('./snapshot');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireManifest(manifest) {
  if (!manifest || !manifest.document) {
    fail('PSD2UI_MANIFEST_REQUIRED', '请先初始化当前 PSD 文档。');
  }
  return manifest;
}

function requireHuman(context, operation) {
  const panelAction = context && context.actor === 'human-panel';
  const confirmedStructurePlan = context
    && context.actor === 'human-approved-plan'
    && operation === '组件结构化'
    && String(context.confirmationId || '').trim();
  const confirmedSubmodulePlan = context
    && context.actor === 'human-approved-plan'
    && operation === 'PSD 文档 submodule 迁移'
    && String(context.confirmationId || '').trim();
  if (panelAction || confirmedStructurePlan || confirmedSubmodulePlan) return;
  fail(
    'PSD2UI_HUMAN_CONFIRMATION_REQUIRED',
    `${operation} 只能由 Photoshop 面板中的人工操作，或由用户明确确认的结构计划执行。`);
}

function normalizeDocumentModule(moduleName) {
  const value = normalizeModule(moduleName);
  if (value === 'common') {
    fail('PSD2UI_DOCUMENT_MODULE_COMMON', 'PSD 文档必须绑定业务 module；Common 只能由人工提升具体资源。');
  }
  return value;
}

function initializeDocument(input, options) {
  const moduleName = normalizeDocumentModule(input.module || (input.resourceNaming === 'source' ? 'ui' : ''));
  const submodule = input.submodule == null || String(input.submodule).trim() === ''
    ? null
    : normalizeSubmodule(input.submodule);
  const rootLayerId = normalizeLayerId(input.rootLayerId);
  const idFactory = options && options.idFactory ? options.idFactory : createId;
  const width = Number(input.width);
  const height = Number(input.height);
  if (!(width > 0) || !(height > 0)) {
    fail('PSD2UI_DESIGN_SIZE_INVALID', '初始化文档时必须提供大于 0 的 width/height。');
  }
  const name = String(input.name || '').trim();
  if (!name) {
    fail('PSD2UI_DOCUMENT_NAME_REQUIRED', '初始化文档时必须填写界面名称。');
  }

  const rootPreset = createPreset('view');
  rootPreset.id = idFactory('node');
  rootPreset.layerId = rootLayerId;
  rootPreset.name = String(input.rootLayerName || name).trim();

  let manifest = {
    manifestVersion: submodule ? '1.1.0' : '1.0.0',
    revision: 1,
    document: {
      id: idFactory('document'),
      name,
      module: moduleName,
      ...(submodule ? { submodule } : {}),
      width,
      height,
      coordSpace: 'parent-top-left-px',
      rootLayerId
    },
    nodes: { [rootLayerId]: rootPreset },
    resourceRegistry: {
      counters: {},
      resources: {},
      layerBindings: {}
    }
  };
  if (input.resourceNaming === 'source') manifest.resourceNaming = 'source';
  if (input.snapshot) {
    const snapshotRootId = input.snapshot.root && normalizeLayerId(input.snapshot.root.layerId);
    if (!snapshotRootId || snapshotRootId !== rootLayerId) {
      fail(
        'PSD2UI_INITIAL_SNAPSHOT_ROOT_MISMATCH',
        `初始化快照根图层必须是 ${rootLayerId}，当前为 ${snapshotRootId || '空'}。`);
    }
    manifest = prepareManifestForExport(manifest, input.snapshot, {
      ...(options || {}),
      allocateResources: false
    }).manifest;
  }
  return manifest;
}

function applyNodePreset(manifest, input, options) {
  requireManifest(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const preset = createPreset(String(input.semantic || '').trim());
  if (!preset) {
    fail('PSD2UI_SEMANTIC_UNSUPPORTED', `语义 '${input.semantic || ''}' 没有确定性组件预设。`);
  }
  const idFactory = options && options.idFactory ? options.idFactory : createId;
  const existing = manifest.nodes[layerId];
  preset.id = existing && existing.id ? existing.id : idFactory('node');
  preset.layerId = layerId;
  preset.name = String(input.name || (existing && existing.name) || '').trim();
  if (!preset.name) {
    fail('PSD2UI_NODE_NAME_REQUIRED', `图层 ${layerId} 缺少可见节点名称。`);
  }
  if (existing && existing.visualStates) preset.visualStates = clone(existing.visualStates);
  if (existing && existing.viewport && ['list', 'grid'].includes(preset.semantic)) {
    preset.viewport = clone(existing.viewport);
    if (existing.viewportSourceBounds) preset.viewportSourceBounds = clone(existing.viewportSourceBounds);
  }
  manifest.nodes[layerId] = preset;
  return preset;
}

function applyStructuredGroup(manifest, input, options) {
  requireManifest(manifest);
  const semantic = String(input.semantic || '').trim();
  if (!requiresStructure(semantic)) {
    fail('PSD2UI_STRUCTURE_SEMANTIC_REQUIRED', `语义 '${semantic}' 不支持结构化。`);
  }
  const structure = clone(input.structure);
  if (!structure || structure.version !== 1 || !Array.isArray(structure.roles)) {
    fail('PSD2UI_STRUCTURE_REQUIRED', '结构化组件必须提供版本 1 的角色映射。');
  }
  const seenRoles = new Set();
  structure.roles.forEach((role, index) => {
    if (!role || !String(role.name || '').trim() || !String(role.layerId || '').trim()) {
      fail('PSD2UI_STRUCTURE_ROLE_INVALID', `第 ${index + 1} 个结构角色缺少 name 或 layerId。`);
    }
    const key = String(role.name).trim();
    if (seenRoles.has(key)) {
      fail('PSD2UI_STRUCTURE_ROLE_DUPLICATE', `结构角色 '${role.name}' 重复指向图层 ${role.layerId}。`);
    }
    seenRoles.add(key);
    role.name = String(role.name).trim();
    role.layerId = normalizeLayerId(role.layerId);
    if (!structureRoleContract(semantic, role.name)) {
      fail('PSD2UI_STRUCTURE_ROLE_INVALID', `${semantic} 不支持角色 '${role.name}'。`);
    }
    delete role.nodeId;
  });
  structure.previewLayerIds = Array.isArray(structure.previewLayerIds)
    ? structure.previewLayerIds.map(normalizeLayerId)
    : [];
  if (structure.layoutSource != null && !['explicit', 'inferred'].includes(structure.layoutSource)) {
    fail('PSD2UI_STRUCTURE_LAYOUT_INVALID', 'layoutSource 必须是 explicit 或 inferred。');
  }
  if (structure.layout) validateStructureLayout(semantic, structure.layout);
  const roleSemantics = semantic === 'button'
    ? { background: ['image', 'raw-image'], label: ['text'] }
    : semantic === 'input-field'
      ? { background: ['image'], text: ['text'], placeholder: ['text'] }
      : semantic === 'toggle'
        ? { background: ['image'], 'on-graphic': ['image'], label: ['text'] }
        : null;
  if (roleSemantics) {
    structure.roles.forEach((role) => {
      const allowedSemantics = roleSemantics[role.name];
      const existing = manifest.nodes[role.layerId];
      if (!allowedSemantics || !existing || allowedSemantics.includes(existing.semantic)) return;
      if (existing.structure) {
        fail('PSD2UI_STRUCTURE_ROLE_CROSSES_COMPONENT', `不能把已配置组件 ${role.layerId} 隐式改为视觉角色。`);
      }
      applyNodePreset(manifest, {
        layerId: role.layerId,
        name: existing.name,
        semantic: allowedSemantics[0]
      }, options);
    });
  }
  const preset = applyNodePreset(manifest, {
    layerId: input.layerId,
    name: input.name,
    semantic
  }, options);
  preset.authoringSource = 'structured';
  preset.structure = structure;
  return preset;
}

function updateNodeParameters(manifest, input) {
  requireManifest(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const node = manifest.nodes[layerId];
  if (!node) {
    fail('PSD2UI_NODE_NOT_INITIALIZED', `图层 ${layerId} 尚未应用组件预设。`);
  }
  const parameters = clone(input.parameters || {});
  const targetKey = node.semantic === 'image' ? 'image'
    : node.semantic === 'raw-image' ? 'rawImage'
    : node.semantic === 'text' ? 'text'
      : node.semantic === 'button' ? 'button'
        : null;
  if (!targetKey) {
    const allowed = ['visible', 'opacity', 'rotationClockwiseDegrees'];
    Object.keys(parameters).forEach((key) => {
      if (!allowed.includes(key)) {
        fail('PSD2UI_PARAMETER_NOT_ALLOWED', `${node.semantic} 节点不允许参数 '${key}'。`);
      }
      node[key] = parameters[key];
    });
    return node;
  }

  const componentPatch = parameters[targetKey] || {};
  Object.keys(componentPatch).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(node[targetKey], key)) {
      fail('PSD2UI_PARAMETER_NOT_ALLOWED', `${node.semantic} 预设不允许参数 '${key}'。`);
    }
    if ((targetKey === 'image' || targetKey === 'rawImage') && key === 'resourceId') {
      fail('PSD2UI_RESOURCE_BIND_COMMAND_REQUIRED', 'resourceId 只能通过分配资源或明确复用命令修改。');
    }
    node[targetKey][key] = componentPatch[key];
  });
  ['visible', 'opacity', 'rotationClockwiseDegrees'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(parameters, key)) {
      node[key] = parameters[key];
    }
  });
  return node;
}

function requireVisualResourceTarget(manifest, layerId) {
  const node = manifest.nodes[normalizeLayerId(layerId)];
  if (!node || (node.semantic !== 'image' && node.semantic !== 'raw-image')) {
    fail('PSD2UI_IMAGE_NODE_REQUIRED', '分配图片资源前必须先为图层应用 image 或 raw-image 预设。');
  }
  return {
    node,
    componentKey: node.semantic === 'image' ? 'image' : 'rawImage',
    resourceKind: node.semantic === 'image' ? 'sprite' : 'texture'
  };
}

function setVisualStates(manifest, input) {
  requireManifest(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const node = manifest.nodes[layerId];
  if (!node) fail('PSD2UI_NODE_NOT_INITIALIZED', `图层 ${layerId} 尚未初始化。`);
  if (input.visualStates == null) {
    delete node.visualStates;
    return node;
  }
  node.visualStates = validateVisualStates(input.visualStates);
  return node;
}

function setNodeViewport(manifest, input) {
  requireManifest(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const node = manifest.nodes[layerId];
  if (!node || !['list', 'grid'].includes(node.semantic)) {
    fail('PSD2UI_VIEWPORT_NODE_INVALID', '可视区域尺寸只配置在列表或网格组件根上。');
  }
  if (input.viewport == null) {
    delete node.viewport;
    delete node.viewportSourceBounds;
    return node;
  }
  const viewport = input.viewport;
  if (Object.keys(viewport).some((key) => !['width', 'height'].includes(key))
      || !Number.isFinite(viewport.width) || viewport.width <= 0
      || !Number.isFinite(viewport.height) || viewport.height <= 0) {
    fail('PSD2UI_VIEWPORT_INVALID', '可视区域必须明确填写正的 width/height。');
  }
  node.viewport = { width: viewport.width, height: viewport.height };
  delete node.viewportSourceBounds;
  if (input.sourceBounds) {
    if (['left', 'top', 'right', 'bottom'].some((key) => !Number.isFinite(input.sourceBounds[key]))) {
      fail('PSD2UI_VIEWPORT_INVALID', 'sourceBounds 必须来自当前组的真实像素边界。');
    }
    node.viewportSourceBounds = clone(input.sourceBounds);
  }
  return node;
}

function setCollectionPreviews(manifest, input) {
  requireManifest(manifest);
  const layerId = normalizeLayerId(input.layerId);
  const node = manifest.nodes[layerId];
  if (!node || !['list', 'grid'].includes(node.semantic) || !node.structure
      || !Array.isArray(node.structure.roles)) {
    fail('PSD2UI_STRUCTURE_PREVIEW_NODE_INVALID', '仅预览条目必须配置在已有模板和布局的列表或网格上。');
  }
  if (!Array.isArray(input.previewLayerIds)) {
    fail('PSD2UI_STRUCTURE_PREVIEW_INVALID', '请明确提供 previewLayerIds 数组；空数组表示清除仅预览条目。');
  }
  validateStructureLayout(node.semantic, node.structure.layout);
  const snapshot = input.snapshot;
  if (!snapshot || !snapshot.root) {
    fail('PSD2UI_SNAPSHOT_REQUIRED', '配置仅预览条目需要当前 Photoshop 完整图层树快照。');
  }
  const documentRootId = normalizeLayerId(manifest.document.rootLayerId);
  function findDocumentRoot(layer) {
    if (normalizeLayerId(layer.layerId) === documentRootId) return layer;
    for (const child of layer.children || []) {
      const found = findDocumentRoot(child);
      if (found) return found;
    }
    return null;
  }
  const documentRoot = findDocumentRoot(snapshot.root);
  if (!documentRoot) fail('PSD2UI_SNAPSHOT_ROOT_MISMATCH', '当前快照中找不到已初始化的 PSD 根。');
  const layers = new Map();
  function decorate(layer, parentId) {
    const id = normalizeLayerId(layer.layerId);
    if (layers.has(id)) fail('PSD2UI_STRUCTURE_LAYER_ID_INVALID', `快照包含重复图层 ${id}。`);
    const authored = manifest.nodes[id] || {};
    const current = { ...layer, layerId: id, parentId,
      semantic: authored.semantic, structure: authored.structure, exportMode: authored.exportMode };
    layers.set(id, current);
    current.children = (layer.children || []).map(child => decorate(child, id));
    return current;
  }
  decorate(documentRoot, '');
  const group = layers.get(layerId);
  if (!group) fail('PSD2UI_STRUCTURE_PREVIEW_NODE_INVALID', `当前 PSD 根中找不到集合图层 ${layerId}。`);
  // Reuse the normal component scope checks, but retain the confirmed layout:
  // explicitly excluded artwork is not an equal-size sample for layout inference.
  const plan = planStructuredGroup(node.semantic, group, {
    roles: node.structure.roles,
    previewLayerIds: input.previewLayerIds,
    layout: node.structure.layout
  });
  const excluded = new Set();
  function exclude(layer) {
    excluded.add(layer.layerId);
    layer.children.forEach(exclude);
  }
  plan.structure.previewLayerIds.forEach(id => exclude(layers.get(id)));
  Object.entries(manifest.nodes).forEach(([ownerId, owner]) => {
    if (excluded.has(ownerId) || !layers.has(ownerId)) return;
    const references = [
      ...(owner.structure && owner.structure.roles || []),
      ...(owner.visualStates && owner.visualStates.states || [])
    ];
    references.forEach(reference => {
      const targetId = String(reference.layerId);
      if (excluded.has(targetId)) {
        fail('PSD2UI_STRUCTURE_PREVIEW_REFERENCED',
          `图层 ${targetId} 仍被组件 ${ownerId} 的角色或视觉状态 '${reference.name}' 引用，不能设为仅预览。`,
          { layerId, ownerLayerId: ownerId, targetLayerId: targetId });
      }
    });
  });
  node.structure.previewLayerIds = plan.structure.previewLayerIds;
  node.structure.layoutSource = 'explicit';
  return node;
}

function bindAllocatedResource(manifest, input, options) {
  const target = requireVisualResourceTarget(manifest, input.layerId);
  if (String(input.kind || '').trim().toLowerCase() !== target.resourceKind) {
    fail(
      'PSD2UI_NODE_RESOURCE_KIND',
      `${target.node.semantic} 节点只能分配 ${target.resourceKind} 资源。`);
  }
  if (input.module != null && normalizeModule(input.module) !== manifest.document.module) {
    fail('PSD2UI_RESOURCE_MODULE_FROM_DOCUMENT', '新资源默认归属当前 PSD 的 module；改变归属必须执行人工迁移。');
  }
  const resource = allocateResource(manifest, {
    layerId: input.layerId,
    layerName: input.layerName || target.node.sourceLayerName || target.node.name,
    kind: input.kind,
    module: manifest.document.module
  }, options);
  target.node[target.componentKey].resourceId = resource.id;
  return resource;
}

function bindReusedResource(manifest, input) {
  const target = requireVisualResourceTarget(manifest, input.layerId);
  const resource = reuseResource(manifest, input);
  if (resource.kind !== target.resourceKind) {
    fail(
      'PSD2UI_IMAGE_RESOURCE_KIND',
      `${target.node.semantic} 节点只能复用 ${target.resourceKind} 资源。`);
  }
  target.node[target.componentKey].resourceId = resource.id;
  return resource;
}

function setDocumentModule(manifest, input) {
  requireManifest(manifest);
  manifest.document.module = normalizeDocumentModule(input.module);
  return manifest.document;
}

function executeAuthoringCommand(currentManifest, envelope, context, options) {
  if (!envelope || !envelope.command) {
    fail('PSD2UI_COMMAND_REQUIRED', 'Authoring Command 名称不能为空。');
  }
  const command = envelope.command;
  const input = envelope.input || {};
  let manifest = clone(currentManifest);
  let value;

  if (command === 'initialize-document') {
    manifest = initializeDocument(input, options);
    value = manifest.document;
  } else {
    requireManifest(manifest);
    ensureRegistry(manifest);
    switch (command) {
      case 'set-document-module':
        requireHuman(context, 'PSD 文档 module 变更');
        value = setDocumentModule(manifest, input);
        break;
      case 'set-document-submodule':
        requireHuman(context, 'PSD 文档 submodule 迁移');
        value = migrateDocumentSubmodule(manifest, input);
        break;
      case 'apply-node-preset':
        value = applyNodePreset(manifest, input, options);
        break;
      case 'apply-structured-group':
        requireHuman(context, '组件结构化');
        value = applyStructuredGroup(manifest, input, options);
        break;
      case 'update-node-parameters':
        value = updateNodeParameters(manifest, input);
        break;
      case 'set-visual-states':
        value = setVisualStates(manifest, input);
        break;
      case 'set-node-viewport':
        value = setNodeViewport(manifest, input);
        break;
      case 'set-collection-previews':
        value = setCollectionPreviews(manifest, input);
        break;
      case 'allocate-resource':
        value = bindAllocatedResource(manifest, input, options);
        break;
      case 'reuse-resource':
        value = bindReusedResource(manifest, input);
        break;
      case 'retire-resource':
        value = retireResource(manifest, input);
        break;
      case 'migrate-resource':
        requireHuman(context, '资源 module/type 迁移');
        value = migrateResource(manifest, input);
        break;
      case 'promote-resource-to-common':
        requireHuman(context, '资源提升为 Common');
        value = migrateResource(manifest, {
          resourceId: input.resourceId,
          module: 'common',
          submodule: input.submodule,
          kind: input.kind,
          reason: 'human-promote-common'
        });
        break;
      case 'validate-for-export':
        value = { issues: validateManifest(manifest) };
        break;
      case 'prepare-default-export': {
        const prepared = prepareManifestForExport(manifest, input.snapshot, options);
        manifest = prepared.manifest;
        value = {
          diagnostics: prepared.diagnostics,
          reconciliation: prepared.reconciliation
        };
        break;
      }
      case 'sync-layer-tree': {
        const prepared = prepareManifestForExport(manifest, input.snapshot, {
          ...(options || {}),
          allocateResources: false
        });
        manifest = prepared.manifest;
        value = {
          diagnostics: prepared.diagnostics,
          reconciliation: prepared.reconciliation
        };
        break;
      }
      case 'capture-baseline':
        manifest = captureBaseline(manifest, input.snapshot);
        value = manifest.baseline;
        break;
      default:
        fail('PSD2UI_COMMAND_UNKNOWN', `未知 Authoring Command：${command}`);
    }
    manifest.revision = (Number(manifest.revision) || 0) + 1;
  }

  return { manifest, value };
}

module.exports = {
  initializeDocument,
  applyNodePreset,
  applyStructuredGroup,
  updateNodeParameters,
  setVisualStates,
  setNodeViewport,
  setCollectionPreviews,
  executeAuthoringCommand
};
