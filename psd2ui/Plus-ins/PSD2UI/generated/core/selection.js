'use strict';

const {
  StructuredSemantics,
  isGroupLayer,
  normalizeLayerKind,
  planStructuredSelection,
  describeStructuredSelection
} = require('./structure');

const ComponentSemantics = Object.freeze([
  'image',
  'raw-image',
  'text',
  'button',
  'input-field',
  'toggle',
  'list',
  'grid',
  'red-point',
  'toggle-page-group',
  'list-page-group',
  'ignore'
]);

const SemanticLabels = Object.freeze({
  image: '图片',
  'raw-image': '大图',
  text: '文本',
  button: '按钮',
  'input-field': '输入框',
  toggle: '开关',
  list: '列表',
  grid: '网格',
  'red-point': '红点',
  'toggle-page-group': '页签页面组',
  'list-page-group': '列表页面组',
  ignore: '忽略子树'
});

const DirectPolicies = Object.freeze({
  image: Object.freeze({ kinds: ['image'], requirement: '1 张图片图层' }),
  'raw-image': Object.freeze({ kinds: ['image'], requirement: '1 张图片图层' }),
  text: Object.freeze({ kinds: ['text'], requirement: '1 个文本图层' }),
  button: Object.freeze({ kinds: ['image'], requirement: '1 张图片图层' }),
  'red-point': Object.freeze({ kinds: ['image', 'group'], requirement: '1 张图片或 1 个组' }),
  ignore: Object.freeze({ kinds: ['image', 'text', 'group'], requirement: '1 个图层或组' })
});

function summarizeSelection(layers) {
  const counts = { image: 0, text: 0, group: 0 };
  layers.forEach((layer) => { counts[normalizeLayerKind(layer)] += 1; });
  return `${layers.length} 个图层（${counts.image} 张图片、${counts.text} 个文本、${counts.group} 个组）`;
}

function evaluateDirect(semantic, layers) {
  const policy = DirectPolicies[semantic];
  if (!policy) {
    return {
      canApply: false,
      applyReason: `${SemanticLabels[semantic]}必须通过“结构化所选图层”创建，不能直接写入单个图层。`
    };
  }
  const valid = layers.length === 1 && policy.kinds.includes(normalizeLayerKind(layers[0]));
  return {
    canApply: valid,
    applyReason: valid
      ? `当前选择可直接写入${SemanticLabels[semantic]}语义。`
      : `${SemanticLabels[semantic]}直接写入要求 ${policy.requirement}；当前选择了 ${summarizeSelection(layers)}。`
  };
}

function evaluateStructure(semantic, layers, options) {
  if (!StructuredSemantics.has(semantic)) {
    return {
      canStructure: false,
      structureReason: `${SemanticLabels[semantic]}不使用结构化建组。`
    };
  }
  if (semantic === 'button' && layers.length === 1 && normalizeLayerKind(layers[0]) === 'image') {
    return {
      canStructure: false,
      structureReason: '单图片按钮直接写入即可；选择“图片 + 文本”时再使用结构化。'
    };
  }
  if (layers.length === 0 || (layers.length === 1 && !isGroupLayer(layers[0]))) {
    return {
      canStructure: false,
      structureReason: `${SemanticLabels[semantic]}需要 1 个现有 Photoshop 组或至少 2 个同级图层；`
        + `当前选择了 ${summarizeSelection(layers)}。`
    };
  }
  try {
    const description = describeStructuredSelection(semantic, layers, options);
    if (description.needsConfiguration) {
      return { canStructure: false,
        canConfigure: description.roles.every((entry) => !entry.required || entry.candidates.length > 0),
        requiresGroup: description.requiresGroup,
        configuration: description,
        structureReason: description.issues.map((issue) => issue.message).join(' ') };
    }
    return {
      canStructure: true,
      canConfigure: true,
      requiresGroup: description.requiresGroup,
      configuration: description,
      structureReason: description.requiresGroup
        ? `可把当前同级图层组合为${SemanticLabels[semantic]}。`
        : `当前组可配置为${SemanticLabels[semantic]}。`
    };
  } catch (error) {
    return {
      canStructure: false,
      structureReason: error && error.message
        ? error.message
        : `当前选择不能结构化为${SemanticLabels[semantic]}。`
    };
  }
}

function isCurrentStructuredRoot(semantic, layers) {
  return layers.length === 1
    && isGroupLayer(layers[0])
    && layers[0].semantic === semantic
    && layers[0].structure
    && Array.isArray(layers[0].structure.roles);
}

function evaluateSemanticAvailability(selectedLayers, options) {
  const layers = Array.isArray(selectedLayers) ? selectedLayers.filter(Boolean) : [];
  return ComponentSemantics.map((semantic) => {
    const direct = evaluateDirect(semantic, layers);
    const settings = options && options.bySemantic ? options.bySemantic[semantic] : options;
    const structured = evaluateStructure(semantic, layers, settings);
    const currentStructuredRoot = isCurrentStructuredRoot(semantic, layers);
    let reason;
    if (direct.canApply && structured.canStructure) {
      reason = `${direct.applyReason} ${structured.structureReason}`;
    } else if (direct.canApply) {
      reason = direct.applyReason;
    } else if (structured.canStructure) {
      reason = structured.structureReason;
    } else if (currentStructuredRoot) {
      reason = `当前组已经配置为${SemanticLabels[semantic]}。${structured.structureReason}`;
    } else {
      reason = StructuredSemantics.has(semantic)
        ? structured.structureReason
        : direct.applyReason;
    }
    return {
      semantic,
      canApply: direct.canApply,
      canStructure: structured.canStructure,
      canConfigure: Boolean(structured.canConfigure),
      requiresGroup: Boolean(structured.requiresGroup),
      configuration: structured.configuration || null,
      applyReason: direct.applyReason,
      structureReason: structured.structureReason,
      currentStructuredRoot: Boolean(currentStructuredRoot),
      enabled: direct.canApply || structured.canStructure || Boolean(structured.canConfigure) || Boolean(currentStructuredRoot),
      reason
    };
  });
}

function requireSemanticAction(selectedLayers, semantic, actionName, options) {
  const entry = evaluateSemanticAvailability(selectedLayers, { bySemantic: { [semantic]: options } })
    .find((candidate) => candidate.semantic === semantic);
  const property = actionName === 'configure' ? 'canConfigure' : actionName === 'structure' ? 'canStructure' : 'canApply';
  if (!entry || !entry[property]) {
    const actionReason = actionName === 'structure'
      ? entry && entry.structureReason
      : entry && entry.applyReason;
    const error = new Error(actionReason || entry && entry.reason || `组件类型 '${semantic}' 未注册。`);
    error.code = actionName === 'structure'
      ? 'PSD2UI_STRUCTURE_SELECTION_INVALID'
      : 'PSD2UI_DIRECT_SELECTION_INVALID';
    throw error;
  }
  if (actionName === 'structure') planStructuredSelection(semantic, selectedLayers, options);
  return entry;
}

module.exports = {
  ComponentSemantics,
  SemanticLabels,
  evaluateSemanticAvailability,
  requireSemanticAction,
  summarizeSelection
};
