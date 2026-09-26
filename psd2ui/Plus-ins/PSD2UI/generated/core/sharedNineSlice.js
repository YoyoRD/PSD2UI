'use strict';

const { fail } = require('./errors');
const { normalizeSliceBorder } = require('./nineSlice');
const { parseResourceLayerName } = require('./naming');

function sharedNineSliceLayers(manifest, snapshot) {
  if (!snapshot || !snapshot.root) fail('PSD2UI_SNAPSHOT_REQUIRED', '指定共用九宫源图需要当前图层树快照。');
  const layers = {};
  const index = layer => {
    layers[String(layer.layerId)] = layer;
    (layer.children || []).forEach(index);
  };
  index(snapshot.root);
  const runtimeIds = new Set();
  const previews = new Set();
  const visit = layer => {
    if (!layer) return;
    const id = String(layer.layerId);
    const node = manifest.nodes[id];
    if (!node || node.semantic === 'ignore' || node.exportMode === 'preview-only' || previews.has(id)) return;
    runtimeIds.add(id);
    (node.structure && node.structure.previewLayerIds || []).forEach(previewId => previews.add(String(previewId)));
    (layer.children || []).forEach(visit);
  };
  visit(layers[String(manifest.document.rootLayerId)]);
  return { layers, runtimeIds };
}

// 显式指定的源图不会随普通资源来源的自动重定向而改变。
function sharedNineSliceSource(manifest, resource, layersById, runtimeIds) {
  if (!resource || resource.exportSourceLayerId == null) return null;
  const id = String(resource.exportSourceLayerId);
  const node = manifest.nodes[id];
  const layer = layersById[id];
  if (manifest.resourceNaming !== 'source' || resource.kind !== 'sprite' || !layer || !node
      || !runtimeIds.has(id) || !node.image || node.image.imageType !== 'sliced'
      || node.image.resourceId !== resource.id
      || parseResourceLayerName(layer.name, id).fileName !== resource.fileName) {
    fail('PSD2UI_SHARED_SLICE_SOURCE_INVALID',
      `共用九宫 '${resource.fileName}' 的指定源图 ${id} 已缺失、改名或不再是可导出的九宫图片，请重新指定源图。`,
      { resourceId: resource.id, layerId: id });
  }
  const bounds = layer.bounds;
  const border = normalizeSliceBorder(node.image.sliceBorder,
    Math.max(1, Math.round(bounds.right - bounds.left)), Math.max(1, Math.round(bounds.bottom - bounds.top)));
  if (!border) fail('PSD2UI_SLICE_BORDER_REQUIRED', '共用九宫源图必须填写边距。', { layerId: id });
  return { layerId: id, border };
}

module.exports = { sharedNineSliceSource, sharedNineSliceLayers };
