'use strict';

const { executeAuthoringCommand, planStructure, buildBundle } = require('../../../Core');

function layoutFixture(semantic = 'list') {
  let sequence = 0;
  let manifest = null;
  const run = (command, input) => {
    manifest = executeAuthoringCommand(manifest, { command, input }, { actor: 'human-panel' },
      { idFactory: (prefix) => `${prefix}-layout-${++sequence}` }).manifest;
  };
  const group = (layerId, name, left, top, width, height, parentId, children = []) => ({
    layerId, name, kind: 'group', parentId,
    bounds: { left, top, right: left + width, bottom: top + height }, children
  });
  const samples = semantic === 'list'
    ? [group(3, 'ItemTemplate', 0, 0, 100, 30, 2), group(4, 'PreviewItem', 0, 40, 100, 30, 2)]
    : [group(3, 'ItemTemplate', 0, 0, 20, 10, 2), group(4, 'PreviewItem', 25, 0, 20, 10, 2),
      group(5, 'PreviewSecondRow', 0, 15, 20, 10, 2), group(6, 'PreviewLast', 25, 15, 20, 10, 2)];
  const snapshot = { root: group(1, 'LayoutView', 0, 0, 400, 300, null, [
    group(2, 'Entries', 0, 0, 200, 200, 1, samples)
  ]) };
  run('initialize-document', { module: 'layout', name: 'LayoutView', width: 400, height: 300,
    rootLayerId: 1, rootLayerName: 'LayoutView' });
  for (const sample of samples) run('apply-node-preset', { layerId: sample.layerId, name: sample.name, semantic: 'group' });
  const plan = planStructure(semantic, samples, {
    templateLayerId: samples[0].layerId,
    previewLayerIds: samples.slice(1).map((sample) => sample.layerId)
  });
  run('apply-structured-group', { layerId: 2, name: 'Entries', semantic, structure: plan.structure });
  return { manifest, snapshot, layout: plan.structure.layout,
    bundle: () => buildBundle(manifest, snapshot) };
}

module.exports = { layoutFixture };
