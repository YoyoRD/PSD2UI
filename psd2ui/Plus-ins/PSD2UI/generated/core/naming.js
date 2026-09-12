'use strict';

const EnglishNodeNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
const ResourceBaseNamePattern = /^[a-z][a-z0-9]*(?:_[A-Za-z0-9]+)+$/;

function stripLegacyLayerSuffix(value) {
  return String(value == null ? '' : value).split('@', 1)[0].trim();
}

function parseResourceLayerName(value, layerId) {
  const baseName = stripLegacyLayerSuffix(value);
  if (!ResourceBaseNamePattern.test(baseName)) {
    const { fail } = require('./errors');
    fail('PSD2UI_IMAGE_NAME_INVALID',
      `图片图层 ${layerId == null ? '' : layerId} '${String(value || '')}' 命名无效；`
      + '基础名须为小写资源分组前缀及下划线分隔的英文字母/数字，例如 comm_sp_0017、comm_bt_0032、i_diamond_small。',
      { layerId: String(layerId == null ? '' : layerId), name: String(value || ''), baseName });
  }
  return { baseName, fileName: `${baseName}.png`, group: baseName.split('_')[0] };
}

function collectInvalidImageLayerNames(snapshot, manifest) {
  const { normalizeLayerKind } = require('./structure');
  const issues = [];
  const previews = new Set();
  function visit(layer, path, isRoot) {
    if (!layer) return;
    const layerId = String(layer.layerId == null ? '' : layer.layerId);
    const node = manifest && manifest.nodes && manifest.nodes[layerId];
    if (previews.has(layerId) || node && (node.semantic === 'ignore' || node.exportMode === 'preview-only')) return;
    if (node && node.structure && node.structure.previewLayerIds) {
      const descendants = new Set();
      function collect(child) {
        descendants.add(String(child.layerId));
        (child.children || []).forEach(collect);
      }
      (layer.children || []).forEach(collect);
      node.structure.previewLayerIds.forEach((id) => { if (descendants.has(String(id))) previews.add(String(id)); });
    }
    if (!isRoot && normalizeLayerKind(layer) === 'image') {
      try { parseResourceLayerName(layer.name, layerId); }
      catch (error) {
        issues.push({ severity: 'error', code: error.code, message: error.message,
          layerId, name: String(layer.name || ''), path: `${path}.name` });
      }
    }
    (layer.children || []).forEach((child, index) => visit(child, `${path}.children[${index}]`, false));
  }
  visit(snapshot && snapshot.root, 'root', true);
  return issues;
}

function isEnglishNodeName(value) {
  return EnglishNodeNamePattern.test(String(value || '').trim());
}

function collectInvalidLayerNames(snapshot) {
  const invalid = [];
  function visit(layer) {
    if (!layer) return;
    const name = String(layer.name || '').trim();
    if (!isEnglishNodeName(name)) {
      invalid.push({
        layerId: String(layer.layerId == null ? '' : layer.layerId),
        name
      });
    }
    (layer.children || []).forEach(visit);
  }
  visit(snapshot && snapshot.root);
  return invalid;
}

function resolveNodeName(node, photoshopLayerName) {
  const fallback = stripLegacyLayerSuffix(photoshopLayerName || node && node.name || '');
  // Photoshop 图层名由美术维护，是跨工具传递的基础名。这里禁止根据语义补前缀、
  // 根据 layerId 补后缀或隐式去重；Unity Adapter 在拥有组件语义后再生成 btn/img/txt 名称。
  return fallback;
}

function applyManifestNodeNames(manifest, snapshot) {
  const nodes = manifest && manifest.nodes || {};
  const layers = [];
  function collect(layer) {
    if (!layer) return;
    layers.push(layer);
    (layer.children || []).forEach(collect);
  }
  collect(snapshot && snapshot.root);

  // Photoshop 图层名是所有导出节点的命名事实源；Manifest 只镜像美术给出的基础名。
  layers.forEach((layer) => {
    const node = nodes[String(layer.layerId)];
    if (node) {
      node.name = stripLegacyLayerSuffix(layer.name || node.name || `Layer-${layer.layerId}`);
    }
  });
  return manifest;
}

module.exports = {
  ResourceBaseNamePattern,
  stripLegacyLayerSuffix,
  parseResourceLayerName,
  collectInvalidImageLayerNames,
  isEnglishNodeName,
  collectInvalidLayerNames,
  resolveNodeName,
  applyManifestNodeNames
};
