'use strict';

const { PRESET_VERSION, ENABLED, DISABLED } = require('./defaults');
const {
  ensureRegistry,
  normalizeModule,
  normalizeSubmodule,
  formatManifestResourceFileName
} = require('./resourceRegistry');
const { isEnglishNodeName, parseResourceLayerName } = require('./naming');
const { validateStructureLayout } = require('./structure');

const ToggleValues = new Set([ENABLED, DISABLED]);
const SemanticValues = new Set([
  'view', 'group', 'image', 'raw-image', 'text', 'button', 'input-field', 'toggle',
  'list', 'grid', 'red-point', 'toggle-page-group', 'list-page-group', 'ignore'
]);

function issue(code, message, path) {
  return { code, message, path: path || '' };
}

function validateColor(value, path, issues) {
  if (!value || ['r', 'g', 'b', 'a'].some((key) => typeof value[key] !== 'number')) {
    issues.push(issue('PSD2UI_COLOR_REQUIRED', '颜色必须显式包含 r/g/b/a 数值。', path));
    return;
  }
  ['r', 'g', 'b', 'a'].forEach((key) => {
    if (value[key] < 0 || value[key] > 1) {
      issues.push(issue('PSD2UI_COLOR_RANGE', `颜色分量 ${key} 必须位于 0 到 1。`, `${path}.${key}`));
    }
  });
}

function validateToggle(value, path, issues) {
  if (!ToggleValues.has(value)) {
    issues.push(issue('PSD2UI_TOGGLE_REQUIRED', "开关值必须显式填写为 'enabled' 或 'disabled'。", path));
  }
}

function validateSliceBorder(value, path, issues) {
  if (value == null) return;
  if (typeof value !== 'object') {
    issues.push(issue('PSD2UI_SLICE_BORDER_INVALID', '九宫参数必须是对象或 null。', path));
    return;
  }
  ['left', 'top', 'right', 'bottom'].forEach((key) => {
    if (!Number.isInteger(value[key]) || value[key] < 0) {
      issues.push(issue('PSD2UI_SLICE_BORDER_INVALID', `${key} 必须是大于或等于 0 的整数。`, `${path}.${key}`));
    }
  });
}

function validateStructure(value, path, issues) {
  if (value == null) return;
  if (value.version !== 1 || !Array.isArray(value.roles)) {
    issues.push(issue('PSD2UI_STRUCTURE_INVALID', '结构必须使用版本 1 并包含 roles 数组。', path));
    return;
  }
  value.roles.forEach((role, index) => {
    if (!role || !String(role.name || '').trim() || !String(role.layerId || '').trim()) {
      issues.push(issue('PSD2UI_STRUCTURE_ROLE_INVALID', '角色必须包含 name 和 layerId。', `${path}.roles[${index}]`));
    }
  });
  if (value.previewLayerIds != null && !Array.isArray(value.previewLayerIds)) {
    issues.push(issue('PSD2UI_STRUCTURE_PREVIEW_INVALID', 'previewLayerIds 必须是数组。', `${path}.previewLayerIds`));
  }
  if (value.layoutSource != null && !['explicit', 'inferred'].includes(value.layoutSource)) {
    issues.push(issue('PSD2UI_LAYOUT_SOURCE_INVALID', 'layoutSource 必须为 explicit 或 inferred。', `${path}.layoutSource`));
  }
}

function validateGradient(value, path, issues) {
  if (!value || typeof value.isVertical !== 'boolean'
      || !Array.isArray(value.colorKeys) || value.colorKeys.length < 2
      || !Array.isArray(value.alphaKeys) || value.alphaKeys.length < 2) {
    issues.push(issue('PSD2UI_TEXT_GRADIENT_INVALID', '文本渐变必须包含方向以及至少两个颜色键和 Alpha 键。', path));
    return;
  }
  value.colorKeys.forEach((key, index) => {
    if (!key || typeof key.time !== 'number' || key.time < 0 || key.time > 1) {
      issues.push(issue('PSD2UI_TEXT_GRADIENT_KEY_INVALID', '渐变颜色键 time 必须位于 0 到 1。', `${path}.colorKeys[${index}]`));
      return;
    }
    validateColor(key.color, `${path}.colorKeys[${index}].color`, issues);
  });
  value.alphaKeys.forEach((key, index) => {
    if (!key || typeof key.time !== 'number' || key.time < 0 || key.time > 1
        || typeof key.alpha !== 'number' || key.alpha < 0 || key.alpha > 1) {
      issues.push(issue('PSD2UI_TEXT_GRADIENT_ALPHA_INVALID', '渐变 Alpha 键的 time/alpha 必须位于 0 到 1。', `${path}.alphaKeys[${index}]`));
    }
  });
}

function validateMeshEffect(value, path, issues) {
  if (!value) return;
  validateColor(value.color, `${path}.color`, issues);
  if (typeof value.distanceX !== 'number' || typeof value.distanceY !== 'number') {
    issues.push(issue('PSD2UI_TEXT_MESH_EFFECT_DISTANCE_INVALID', '描边或阴影距离必须包含 distanceX/distanceY 数值。', path));
  }
}

function validateTextEffects(value, path, issues) {
  if (value == null) return;
  if (typeof value !== 'object') {
    issues.push(issue('PSD2UI_TEXT_EFFECTS_INVALID', '文本效果必须是对象或 null。', path));
    return;
  }
  if (value.gradient) validateGradient(value.gradient, `${path}.gradient`, issues);
  validateMeshEffect(value.outline, `${path}.outline`, issues);
  validateMeshEffect(value.shadow, `${path}.shadow`, issues);
}

function validateImage(image, path, registry, issues) {
  if (!['simple', 'sliced', 'tiled', 'filled'].includes(image.imageType)) {
    issues.push(issue('PSD2UI_IMAGE_TYPE_INVALID', 'imageType 必须显式填写为 simple/sliced/tiled/filled。', `${path}.imageType`));
  }
  validateSliceBorder(image.sliceBorder, `${path}.sliceBorder`, issues);
  if (image.imageType === 'sliced' && !image.sliceBorder) {
    issues.push(issue('PSD2UI_SLICE_BORDER_REQUIRED', 'sliced 图片必须填写左、上、右、下九宫参数。', `${path}.sliceBorder`));
  }
  validateToggle(image.preserveAspect, `${path}.preserveAspect`, issues);
  validateToggle(image.raycast, `${path}.raycast`, issues);
  validateColor(image.color, `${path}.color`, issues);
  const resource = registry.resources[image.resourceId];
  if (!resource || resource.status !== 'active') {
    issues.push(issue('PSD2UI_IMAGE_RESOURCE_REQUIRED', '图片视觉必须绑定一个有效资源。', `${path}.resourceId`));
  } else if (resource.kind !== 'sprite') {
    issues.push(issue('PSD2UI_IMAGE_RESOURCE_KIND', '图片视觉只能绑定 sprite 资源。', `${path}.resourceId`));
  }
}

function validateNode(node, path, registry, issues, sourceNaming) {
  if (!node || typeof node !== 'object') {
    issues.push(issue('PSD2UI_NODE_REQUIRED', '节点配置不存在。', path));
    return;
  }
  if (!SemanticValues.has(node.semantic)) {
    issues.push(issue('PSD2UI_SEMANTIC_UNSUPPORTED', `节点语义 '${node.semantic || ''}' 未注册。`, `${path}.semantic`));
  }
  if (node.presetVersion !== PRESET_VERSION) {
    issues.push(issue('PSD2UI_PRESET_VERSION', '节点必须由当前组件预设完整初始化。', `${path}.presetVersion`));
  }
  if (sourceNaming ? !String(node.name || '').trim() : !isEnglishNodeName(node.name)) {
    issues.push(issue(
      sourceNaming ? 'PSD2UI_NODE_NAME_REQUIRED' : 'PSD2UI_NODE_NAME_ENGLISH_REQUIRED',
      sourceNaming ? '导出节点名不能为空。' : '导出节点名必须以英文字母开头，并且只能包含英文字母、数字和下划线。',
      `${path}.name`));
  }
  if (node.authoringSource != null && !['default', 'explicit', 'structured'].includes(node.authoringSource)) {
    issues.push(issue('PSD2UI_AUTHORING_SOURCE_INVALID', 'authoringSource 必须是 default/explicit/structured。', `${path}.authoringSource`));
  }
  if (node.exportMode != null && !['runtime', 'preview-only'].includes(node.exportMode)) {
    issues.push(issue('PSD2UI_EXPORT_MODE_INVALID', 'exportMode 必须是 runtime 或 preview-only。', `${path}.exportMode`));
  }
  validateStructure(node.structure, `${path}.structure`, issues);
  if (node.structure && node.structure.layout != null) {
    try { validateStructureLayout(node.semantic, node.structure.layout); }
    catch (error) { issues.push(issue(error.code, error.message, `${path}.structure.layout`)); }
  }
  validateToggle(node.visible, `${path}.visible`, issues);
  if (typeof node.opacity !== 'number' || node.opacity < 0 || node.opacity > 1) {
    issues.push(issue('PSD2UI_OPACITY_RANGE', 'opacity 必须显式填写为 0 到 1。', `${path}.opacity`));
  }
  if (typeof node.rotationClockwiseDegrees !== 'number') {
    issues.push(issue('PSD2UI_ROTATION_REQUIRED', 'rotationClockwiseDegrees 必须显式填写。', `${path}.rotationClockwiseDegrees`));
  }

  if (node.semantic === 'image') {
    if (!node.image) {
      issues.push(issue('PSD2UI_IMAGE_PRESET_REQUIRED', 'image 节点缺少完整图片预设。', `${path}.image`));
      return;
    }
    validateImage(node.image, `${path}.image`, registry, issues);
  } else if (node.image) {
    validateImage(node.image, `${path}.image`, registry, issues);
  }

  if (node.semantic === 'raw-image') {
    if (!node.rawImage) {
      issues.push(issue('PSD2UI_RAW_IMAGE_PRESET_REQUIRED', 'raw-image 节点缺少完整原始图片预设。', `${path}.rawImage`));
      return;
    }
    const uvRect = node.rawImage.uvRect;
    if (!uvRect || ['x', 'y', 'width', 'height'].some((key) => typeof uvRect[key] !== 'number')) {
      issues.push(issue('PSD2UI_RAW_IMAGE_UV_RECT_REQUIRED', 'uvRect 必须显式包含 x/y/width/height 数值。', `${path}.rawImage.uvRect`));
    } else if (uvRect.width < 0 || uvRect.height < 0) {
      issues.push(issue('PSD2UI_RAW_IMAGE_UV_RECT_INVALID', 'uvRect 的 width/height 不能为负数。', `${path}.rawImage.uvRect`));
    }
    validateToggle(node.rawImage.raycast, `${path}.rawImage.raycast`, issues);
    validateColor(node.rawImage.color, `${path}.rawImage.color`, issues);
    const resource = registry.resources[node.rawImage.resourceId];
    if (!resource || resource.status !== 'active') {
      issues.push(issue('PSD2UI_RAW_IMAGE_RESOURCE_REQUIRED', 'raw-image 节点必须绑定一个有效资源。', `${path}.rawImage.resourceId`));
    } else if (resource.kind !== 'texture') {
      issues.push(issue('PSD2UI_RAW_IMAGE_RESOURCE_KIND', 'raw-image 节点只能绑定 texture 资源。', `${path}.rawImage.resourceId`));
    }
  }

  if (node.semantic === 'text') {
    if (!node.text) {
      issues.push(issue('PSD2UI_TEXT_PRESET_REQUIRED', 'text 节点缺少完整文本预设。', `${path}.text`));
      return;
    }
    if (typeof node.text.value !== 'string') {
      issues.push(issue('PSD2UI_TEXT_VALUE_REQUIRED', '文本内容必须显式填写。', `${path}.text.value`));
    }
    if (typeof node.text.fontKey !== 'string' || !node.text.fontKey.trim()) {
      issues.push(issue('PSD2UI_FONT_KEY_REQUIRED', '文本必须提供 fontKey；未配置时使用 default。', `${path}.text.fontKey`));
    }
    validateTextEffects(node.text.effects, `${path}.text.effects`, issues);
    if (node.text.lineAdvance != null && (!Number.isFinite(node.text.lineAdvance) || node.text.lineAdvance <= 0)) {
      issues.push(issue('PSD2UI_LINE_ADVANCE_INVALID', 'lineAdvance 必须是正的像素行距。', `${path}.text.lineAdvance`));
    }
    if (node.text.photoshop != null) {
      const ps = node.text.photoshop;
      let valid = ps.version === 1 && typeof ps.descriptorJson === 'string';
      try { const raw = JSON.parse(ps.descriptorJson); valid = valid && raw != null && typeof raw === 'object' && !Array.isArray(raw) && raw.version === 1; }
      catch (error) { valid = false; }
      if (!valid) issues.push(issue('PSD2UI_PHOTOSHOP_TEXT_INVALID', 'photoshop 必须包含版本 1 的原始描述符 JSON。', `${path}.text.photoshop`));
    }
    if (Object.prototype.hasOwnProperty.call(node.text, 'layoutMode')
        && !['point', 'paragraph'].includes(node.text.layoutMode)) {
      issues.push(issue('PSD2UI_TEXT_LAYOUT_MODE_INVALID',
        'layoutMode 只能为 point 或 paragraph；无法确定文本类型时应省略。', `${path}.text.layoutMode`));
    }
    if (!Number.isInteger(node.text.fontSize) || node.text.fontSize < 1) {
      issues.push(issue('PSD2UI_FONT_SIZE_INVALID', 'fontSize 必须是大于 0 的整数。', `${path}.text.fontSize`));
    }
    if (!['upper-left', 'upper-center', 'upper-right', 'middle-left', 'middle-center', 'middle-right', 'lower-left', 'lower-center', 'lower-right'].includes(node.text.alignment)) {
      issues.push(issue('PSD2UI_TEXT_ALIGNMENT_INVALID', '文本对齐参数无效。', `${path}.text.alignment`));
    }
    validateToggle(node.text.richText, `${path}.text.richText`, issues);
    validateToggle(node.text.raycast, `${path}.text.raycast`, issues);
    validateColor(node.text.color, `${path}.text.color`, issues);
    if (typeof node.text.lineSpacing !== 'number' || node.text.lineSpacing <= 0) {
      issues.push(issue('PSD2UI_LINE_SPACING_INVALID', 'lineSpacing 必须大于 0。', `${path}.text.lineSpacing`));
    }
  }

  if (node.semantic === 'button') {
    if (!node.button) {
      issues.push(issue('PSD2UI_BUTTON_PRESET_REQUIRED', 'button 节点缺少完整按钮预设。', `${path}.button`));
      return;
    }
    validateToggle(node.button.interactable, `${path}.button.interactable`, issues);
    if (node.button.transition !== 'color-tint') {
      issues.push(issue('PSD2UI_BUTTON_TRANSITION_INVALID', "最小切片只支持显式 transition='color-tint'。", `${path}.button.transition`));
    }
  }
}

function validateManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') {
    return [issue('PSD2UI_MANIFEST_REQUIRED', 'PSD2UI Manifest 不存在。')];
  }
  if (manifest.manifestVersion !== '1.0.0' && manifest.manifestVersion !== '1.1.0') {
    issues.push(issue(
      'PSD2UI_MANIFEST_VERSION',
      "manifestVersion 只支持 '1.0.0' 或 '1.1.0'。",
      'manifestVersion'));
  }
  if (!manifest.document) {
    issues.push(issue('PSD2UI_DOCUMENT_REQUIRED', '文档参数不存在。', 'document'));
    return issues;
  }
  try {
    normalizeModule(manifest.document.module);
    if (manifest.document.module === 'common') {
      issues.push(issue(
        'PSD2UI_DOCUMENT_MODULE_COMMON',
        'PSD 文档必须绑定业务 module；Common 只用于具体资源。',
        'document.module'));
    }
  } catch (error) {
    issues.push(issue(error.code || 'PSD2UI_MODULE_INVALID', error.message, 'document.module'));
  }
  if (!manifest.document.id || !manifest.document.name || !manifest.document.rootLayerId) {
    issues.push(issue('PSD2UI_DOCUMENT_FIELDS_REQUIRED', 'document.id/name/rootLayerId 都必须显式填写。', 'document'));
  }
  const sourceNaming = manifest.resourceNaming === 'source';
  if (manifest.manifestVersion === '1.1.0') {
    try {
      normalizeSubmodule(manifest.document.submodule);
    } catch (error) {
      issues.push(issue(error.code || 'PSD2UI_SUBMODULE_INVALID', error.message, 'document.submodule'));
    }
  } else if (manifest.document.submodule != null) {
    issues.push(issue(
      'PSD2UI_SUBMODULE_VERSION_REQUIRED',
      "document.submodule 只能用于 manifestVersion='1.1.0'。",
      'document.submodule'));
  }
  if (sourceNaming ? !String(manifest.document.name || '').trim() : !isEnglishNodeName(manifest.document.name)) {
    issues.push(issue(
      sourceNaming ? 'PSD2UI_DOCUMENT_NAME_REQUIRED' : 'PSD2UI_DOCUMENT_NAME_ENGLISH_REQUIRED',
      sourceNaming ? '界面名称不能为空。' : '界面名称必须以英文字母开头，并且只能包含英文字母、数字和下划线。',
      'document.name'));
  }
  if (!(manifest.document.width > 0) || !(manifest.document.height > 0)) {
    issues.push(issue('PSD2UI_DESIGN_SIZE_INVALID', '文档 width/height 必须大于 0。', 'document'));
  }

  const registry = ensureRegistry(manifest);
  const activeFileNames = new Map();
  Object.keys(registry.resources).forEach((resourceId) => {
    const resource = registry.resources[resourceId];
    if (!resource || resource.status !== 'active') return;
    let expected;
    try {
      if (sourceNaming) {
        const parsed = parseResourceLayerName(String(resource.fileName || '').replace(/\.png$/, ''), resource.sourceLayerId);
        expected = parsed.fileName;
        if (resource.module !== parsed.group || resource.scope !== 'module'
            || !['sprite', 'texture'].includes(resource.kind)
            || !Number.isInteger(resource.number) || resource.number < 1) {
          issues.push(issue('PSD2UI_SOURCE_RESOURCE_INVALID',
            '资源须保留图片基础名首段分组、module scope、明确图片类型和正序身份编号。',
            `resourceRegistry.resources.${resourceId}`));
        }
      } else expected = formatManifestResourceFileName(
        manifest,
        resource.kind,
        resource.number,
        resource.module,
        resource.submodule);
    } catch (error) {
      issues.push(issue(
        error.code || 'PSD2UI_RESOURCE_FILENAME_INVALID',
        error.message,
        `resourceRegistry.resources.${resourceId}.fileName`));
      return;
    }
    if (resource.fileName !== expected) {
      issues.push(issue(
        'PSD2UI_RESOURCE_FILENAME_MISMATCH',
        `资源文件名 '${resource.fileName || ''}' 与当前 document module/submodule、kind、number 不一致；预期 '${expected}'。`,
        `resourceRegistry.resources.${resourceId}.fileName`));
    }
    if (resource.fileName) {
      const fileKey = resource.fileName.toLowerCase();
      const previousResourceId = activeFileNames.get(fileKey);
      if (previousResourceId) {
        issues.push(issue(
          'PSD2UI_RESOURCE_FILENAME_DUPLICATE',
          `活动资源 '${previousResourceId}' 与 '${resourceId}' 使用了同一文件名 '${resource.fileName}'。`,
          `resourceRegistry.resources.${resourceId}.fileName`));
      } else {
        activeFileNames.set(fileKey, resourceId);
      }
    }
    if (!sourceNaming && manifest.manifestVersion === '1.1.0'
        && resource.module === manifest.document.module
        && resource.submodule !== manifest.document.submodule) {
      issues.push(issue(
        'PSD2UI_RESOURCE_SUBMODULE_MISMATCH',
        `本地资源 submodule '${resource.submodule || ''}' 与 document.submodule '${manifest.document.submodule}' 不一致。`,
        `resourceRegistry.resources.${resourceId}.submodule`));
    }
  });
  const nodes = manifest.nodes || {};
  Object.keys(nodes).forEach((layerId) => validateNode(nodes[layerId], `nodes.${layerId}`, registry, issues, sourceNaming));
  const root = nodes[String(manifest.document.rootLayerId)];
  if (!root || root.semantic !== 'view') {
    issues.push(issue('PSD2UI_ROOT_VIEW_REQUIRED', '文档根图层必须使用完整 view 预设。', 'document.rootLayerId'));
  }
  return issues;
}

function assertManifestValid(manifest) {
  const issues = validateManifest(manifest);
  if (issues.length > 0) {
    const error = new Error(`PSD2UI 导出预检失败，共 ${issues.length} 项。`);
    error.name = 'Psd2UiValidationError';
    error.code = 'PSD2UI_PREFLIGHT_FAILED';
    error.issues = issues;
    throw error;
  }
  return manifest;
}

module.exports = { validateManifest, assertManifestValid };
