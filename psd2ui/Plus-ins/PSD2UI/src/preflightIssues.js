'use strict';

// Resolve diagnostic identities against the inspected PSD, never against display names.
function describePreflightIssues(error, manifest, snapshot) {
  const byLayerId = new Map();
  function visit(layer, parents) {
    if (!layer) return;
    const id = String(layer.layerId || layer.id || '');
    const path = [...parents, String(layer.name || id)];
    byLayerId.set(id, { id, name: String(layer.name || id), path: path.join(' / '), layer });
    (layer.children || []).forEach(child => visit(child, path));
  }
  visit(snapshot && snapshot.root, []);
  const nodes = manifest && manifest.nodes || {};
  const nodeIds = new Map(Object.entries(nodes).map(([id, node]) => [String(node.id), id]));
  const resources = manifest && manifest.resourceRegistry && manifest.resourceRegistry.resources || {};
  const details = error && error.details || {};
  const entries = error && Array.isArray(error.issues) && error.issues.length ? error.issues
    : Array.isArray(details.diagnostics) && details.diagnostics.length ? details.diagnostics : [error || {}];
  return entries.map(entry => {
    const issue = { ...(entry.details || {}), ...entry, message: entry.message };
    const ids = new Set();
    const add = id => { if (id != null && String(id)) ids.add(String(id)); };
    [issue.layerId, issue.sourceLayerId, issue.otherLayerId].forEach(add);
    [issue.layerIds, issue.sourceLayerIds].forEach(values => { if (Array.isArray(values)) values.forEach(add); });
    if (issue.nodeId && nodeIds.has(String(issue.nodeId))) add(nodeIds.get(String(issue.nodeId)));
    const path = String(issue.path || '');
    const nodePath = /^nodes\.([^.\[]+)/.exec(path);
    if (nodePath) add(nodePath[1]);
    if (path === 'document.rootLayerId') add(manifest && manifest.document && manifest.document.rootLayerId);
    const resourcePath = /^resourceRegistry\.resources\.([^.\[]+)/.exec(path);
    const resourceId = issue.resourceId || resourcePath && resourcePath[1];
    if (resourceId) {
      const resource = resources[resourceId];
      if (resource) { add(resource.sourceLayerId); (resource.sourceLayerIds || []).forEach(add); }
      Object.entries(nodes).forEach(([id, node]) => {
        if (node.image && node.image.resourceId === resourceId || node.rawImage && node.rawImage.resourceId === resourceId) add(id);
      });
    }
    // Compatibility for older geometry errors without structured layer metadata.
    const legacyLayer = /\blayer:([^\s.]+)/.exec(String(issue.message || ''));
    if (!ids.size && legacyLayer) add(legacyLayer[1]);
    const layers = [...ids].map(id => {
      const found = byLayerId.get(id);
      return found ? { id, name: found.name, path: found.path, canLocate: id !== 'document-root' }
        : { id, name: nodes[id] && nodes[id].name || `图层 ${id}`, path: '此图层已删除或不在当前文档中', canLocate: false };
    });
    const code = issue.code || error && error.code || 'PSD2UI_PREFLIGHT_FAILED';
    let message = issue.message || error && error.message || String(error);
    let hint = layers.some(layer => layer.canLocate)
      ? '点击定位后检查该图层；修改完成请重新预检。'
      : layers.length ? '请检查引用此图层的组件，重新指定角色后再预检。'
        : '这是文档或导出设置问题，没有可定位的单个图层。';
    if (['PSD2UI_GEOMETRY_INVALID', 'PSD2UI_BOUNDS_REQUIRED', 'PSD2UI_BOUNDS_INVALID'].includes(code)) {
      const emptyGroup = layers.some(target => {
        const found = byLayerId.get(target.id);
        return found && String(found.layer.kind).toLowerCase() === 'group' && !(found.layer.children || []).length;
      });
      message = emptyGroup ? '这是一个空图层组，Photoshop 没有提供有效的图层边界。'
        : '图层的位置或尺寸无效，无法计算导出区域。';
      hint = emptyGroup ? '不需要导出时可设为「忽略子树」；需要使用时请补齐组内内容，然后重新预检。'
        : '定位后检查图层内容、位置和尺寸，然后重新预检。';
    }
    return { code, message, hint, layers, rawMessage: issue.message || error && error.message || '', path };
  });
}

module.exports = { describePreflightIssues };
