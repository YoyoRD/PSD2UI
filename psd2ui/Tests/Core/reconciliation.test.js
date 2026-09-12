'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeAuthoringCommand,
  prepareManifestForExport,
  buildBundle
} = require('../../Core');

function idFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-reconcile-${++sequence}`;
}

function imageLayer(layerId, name) {
  return {
    layerId,
    name,
    kind: 'pixel',
    bounds: { left: 0, top: 0, right: 64, bottom: 64 },
    children: []
  };
}

function snapshot(children) {
  return {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 720, bottom: 1280 },
      children: children || []
    }
  };
}

function initialize(currentSnapshot, ids) {
  return executeAuthoringCommand(null, {
    command: 'initialize-document',
    input: {
      module: 'demo',
      name: 'DemoView',
      width: 720,
      height: 1280,
      rootLayerId: 1,
      rootLayerName: 'DemoView',
      snapshot: currentSnapshot
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
}

test('同步图层树会删除失效节点并停用资源，后续分配不会复用旧编号', () => {
  const ids = idFactory();
  const initialSnapshot = snapshot([
    imageLayer(2, 'FirstIcon'),
    imageLayer(3, 'SecondIcon')
  ]);
  let manifest = initialize(initialSnapshot, ids);
  manifest = prepareManifestForExport(manifest, initialSnapshot, { idFactory: ids }).manifest;
  assert.deepEqual(
    Object.values(manifest.resourceRegistry.resources).map((resource) => resource.fileName).sort(),
    ['demo_sp_0001.png', 'demo_sp_0002.png']);

  const synced = executeAuthoringCommand(manifest, {
    command: 'sync-layer-tree',
    input: { snapshot: snapshot([]) }
  }, { actor: 'human-panel' }, { idFactory: ids });
  manifest = synced.manifest;
  assert.deepEqual(synced.value.reconciliation.removedLayerIds.sort(), ['2', '3']);
  assert.equal(synced.value.reconciliation.retiredResourceIds.length, 2);
  assert.deepEqual(Object.keys(manifest.nodes), ['1']);
  assert.ok(Object.values(manifest.resourceRegistry.resources)
    .every((resource) => resource.status === 'retired'));

  const nextSnapshot = snapshot([imageLayer(4, 'ThirdIcon')]);
  const prepared = prepareManifestForExport(manifest, nextSnapshot, { idFactory: ids });
  const active = Object.values(prepared.manifest.resourceRegistry.resources)
    .filter((resource) => resource.status === 'active');
  assert.equal(active.length, 1);
  assert.equal(active[0].fileName, 'demo_sp_0003.png');
});

test('共享资源的来源图层删除后会重挂到仍在使用它的图层', () => {
  const ids = idFactory();
  const initialSnapshot = snapshot([
    imageLayer(2, 'AvatarSource'),
    imageLayer(3, 'AvatarReuse')
  ]);
  let manifest = initialize(initialSnapshot, ids);
  for (const layerId of [2, 3]) {
    manifest = executeAuthoringCommand(manifest, {
      command: 'apply-node-preset',
      input: { layerId, name: layerId === 2 ? 'AvatarSource' : 'AvatarReuse', semantic: 'image' }
    }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
  }
  const allocated = executeAuthoringCommand(manifest, {
    command: 'allocate-resource',
    input: { layerId: 2, kind: 'sprite' }
  }, { actor: 'human-panel' }, { idFactory: ids });
  manifest = allocated.manifest;
  const resourceId = allocated.value.id;
  manifest = executeAuthoringCommand(manifest, {
    command: 'reuse-resource',
    input: { layerId: 3, resourceId }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const remainingSnapshot = snapshot([imageLayer(3, 'AvatarReuse')]);
  const prepared = prepareManifestForExport(manifest, remainingSnapshot, { idFactory: ids });
  const resource = prepared.manifest.resourceRegistry.resources[resourceId];
  assert.equal(resource.status, 'active');
  assert.equal(resource.sourceLayerId, '3');
  assert.deepEqual(prepared.reconciliation.reassignedResourceSources, [{
    resourceId,
    previousSourceLayerId: '2',
    sourceLayerId: '3'
  }]);
  assert.equal(buildBundle(prepared.manifest, remainingSnapshot).resources[0].sourceLayerId, '3');
});

test('结构角色图层被删除后同步配置但阻断发布，要求美术重新结构化', () => {
  const ids = idFactory();
  const component = {
    layerId: 2,
    name: 'LoginButton',
    kind: 'group',
    bounds: { left: 100, top: 100, right: 300, bottom: 180 },
    children: [
      imageLayer(3, 'Background'),
      {
        layerId: 4,
        name: 'Label',
        kind: 'text',
        text: { value: 'Login', fontSize: 24 },
        bounds: { left: 120, top: 120, right: 280, bottom: 160 },
        children: []
      }
    ]
  };
  let manifest = initialize(snapshot([component]), ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'LoginButton',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [
          { name: 'background', layerId: 3 },
          { name: 'label', layerId: 4 }
        ],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const brokenSnapshot = snapshot([{
    ...component,
    children: [imageLayer(3, 'Background')]
  }]);
  const prepared = prepareManifestForExport(manifest, brokenSnapshot, { idFactory: ids });
  assert.equal(prepared.manifest.nodes['4'], undefined);
  assert.ok(prepared.diagnostics.some((entry) => entry.severity === 'error'
    && entry.code === 'PSD2UI_STRUCTURE_ROLE_MISSING'));
  assert.throws(
    () => buildBundle(prepared.manifest, brokenSnapshot),
    (error) => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT'
      && error.details.diagnostics.some((entry) => entry.code === 'PSD2UI_STRUCTURE_ROLE_MISSING'));
});

test('结构角色的 Photoshop 类型变化后阻断发布', () => {
  const ids = idFactory();
  const component = {
    layerId: 2,
    name: 'LoginButton',
    kind: 'group',
    bounds: { left: 100, top: 100, right: 300, bottom: 180 },
    children: [imageLayer(3, 'Background')]
  };
  let manifest = initialize(snapshot([component]), ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'LoginButton',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [{ name: 'background', layerId: 3 }],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const changedSnapshot = snapshot([{
    ...component,
    children: [{
      ...imageLayer(3, 'Background'),
      kind: 'text',
      text: { value: 'NotAnImage', fontSize: 24 }
    }]
  }]);
  const prepared = prepareManifestForExport(manifest, changedSnapshot, { idFactory: ids });
  assert.ok(prepared.diagnostics.some((entry) => entry.severity === 'error'
    && entry.code === 'PSD2UI_STRUCTURE_ROLE_TYPE_MISMATCH'));
  assert.throws(
    () => buildBundle(prepared.manifest, changedSnapshot),
    (error) => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT');
});

test('结构角色移入普通内层子组后保持稳定引用并正常导出', () => {
  const ids = idFactory();
  const background = imageLayer(3, 'Background');
  const component = {
    layerId: 2,
    name: 'ActionButton',
    kind: 'group',
    bounds: { left: 100, top: 100, right: 300, bottom: 180 },
    children: [background]
  };
  let manifest = initialize(snapshot([component]), ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'ActionButton',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [{ name: 'background', layerId: 3 }],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const nestedSnapshot = snapshot([{
    ...component,
    children: [{
      layerId: 4,
      name: 'VisualContainer',
      kind: 'group',
      bounds: { left: 100, top: 100, right: 300, bottom: 180 },
      children: [background]
    }]
  }]);
  const prepared = prepareManifestForExport(manifest, nestedSnapshot, { idFactory: ids });
  assert.equal(prepared.diagnostics.some((entry) => entry.severity === 'error'), false);
  const bundle = buildBundle(prepared.manifest, nestedSnapshot);
  const button = bundle.root.children[0];
  assert.equal(button.structure.roles[0].nodeId, button.children[0].children[0].id);
});

test('结构化组件只接受非空且具有正尺寸的 Photoshop 组根', () => {
  const ids = idFactory();
  const background = imageLayer(3, 'Background');
  const component = {
    layerId: 2,
    name: 'ActionButton',
    kind: 'group',
    bounds: { left: 100, top: 100, right: 300, bottom: 180 },
    children: [background]
  };
  let manifest = initialize(snapshot([component]), ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'ActionButton',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [{ name: 'background', layerId: 3 }],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const cases = [
    {
      code: 'PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED',
      current: snapshot([{ ...component, kind: 'pixel', children: [] }])
    },
    {
      code: 'PSD2UI_STRUCTURE_ROOT_EMPTY',
      current: snapshot([{ ...component, children: [] }])
    },
    {
      code: 'PSD2UI_STRUCTURE_ROOT_BOUNDS_INVALID',
      current: snapshot([{
        ...component,
        bounds: { left: 100, top: 100, right: 100, bottom: 180 }
      }])
    }
  ];

  cases.forEach(({ code, current }) => {
    const prepared = prepareManifestForExport(manifest, current, { idFactory: ids });
    assert.ok(prepared.diagnostics.some((entry) => entry.severity === 'error' && entry.code === code), code);
    assert.throws(
      () => buildBundle(prepared.manifest, current),
      (error) => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT'
        && error.details.diagnostics.some((entry) => entry.code === code));
  });
});

test('结构缺少必需角色时在 Core 预检阻断', () => {
  const ids = idFactory();
  const component = {
    layerId: 2,
    name: 'LoginButton',
    kind: 'group',
    bounds: { left: 100, top: 100, right: 300, bottom: 180 },
    children: [{
      layerId: 4,
      name: 'Label',
      kind: 'text',
      text: { value: 'Login', fontSize: 24 },
      bounds: { left: 120, top: 120, right: 280, bottom: 160 },
      children: []
    }]
  };
  let manifest = initialize(snapshot([component]), ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'LoginButton',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [{ name: 'label', layerId: 4 }],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const prepared = prepareManifestForExport(manifest, snapshot([component]), { idFactory: ids });
  assert.ok(prepared.diagnostics.some((entry) => entry.severity === 'error'
    && entry.code === 'PSD2UI_STRUCTURE_ROLE_INVALID'
    && entry.message.includes("'background'")));
});

test('结构化会把输入框和开关的图片角色收敛为 image', () => {
  const ids = idFactory();
  const largeBackground = {
    ...imageLayer(3, 'LargeBackground'),
    bounds: { left: 0, top: 0, right: 600, bottom: 80 }
  };
  const inputComponent = {
    layerId: 2,
    name: 'AccountInput',
    kind: 'group',
    bounds: { left: 0, top: 0, right: 600, bottom: 80 },
    children: [largeBackground, {
      layerId: 4,
      name: 'ContentText',
      kind: 'text',
      text: { value: '', fontSize: 24 },
      bounds: { left: 10, top: 10, right: 590, bottom: 70 },
      children: []
    }]
  };
  const currentSnapshot = snapshot([inputComponent]);
  let manifest = initialize(currentSnapshot, ids);
  assert.equal(manifest.nodes['3'].semantic, 'raw-image');

  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'AccountInput',
      semantic: 'input-field',
      structure: {
        version: 1,
        roles: [
          { name: 'background', layerId: 3 },
          { name: 'text', layerId: 4 }
        ],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
  assert.equal(manifest.nodes['3'].semantic, 'image');

  const prepared = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids });
  assert.equal(prepared.diagnostics.some((entry) => entry.severity === 'error'), false);
  assert.equal(prepared.manifest.nodes['3'].image.resourceId != null, true);
});

test('初始化后新增的超宽输入框角色先同步再结构化不会产生类型错配', () => {
  const ids = idFactory();
  let manifest = initialize(snapshot([]), ids);
  const largeBackground = {
    ...imageLayer(3, 'LargeBackground'),
    bounds: { left: 0, top: 0, right: 600, bottom: 80 }
  };
  const contentText = {
    layerId: 4,
    name: 'ContentText',
    kind: 'text',
    text: { value: '', fontSize: 24 },
    bounds: { left: 10, top: 10, right: 590, bottom: 70 },
    children: []
  };

  manifest = executeAuthoringCommand(manifest, {
    command: 'sync-layer-tree',
    input: { snapshot: snapshot([largeBackground, contentText]) }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
  assert.equal(manifest.nodes['3'].semantic, 'raw-image');

  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'AccountInput',
      semantic: 'input-field',
      structure: {
        version: 1,
        roles: [
          { name: 'background', layerId: 3 },
          { name: 'text', layerId: 4 }
        ],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const groupedSnapshot = snapshot([{
    layerId: 2,
    name: 'AccountInput',
    kind: 'group',
    bounds: { left: 0, top: 0, right: 600, bottom: 80 },
    children: [largeBackground, contentText]
  }]);
  const prepared = prepareManifestForExport(manifest, groupedSnapshot, { idFactory: ids });
  assert.equal(prepared.manifest.nodes['3'].semantic, 'image');
  assert.equal(prepared.diagnostics.some((entry) => entry.severity === 'error'), false);
});

test('结构角色位于 Ignore 祖先下时视为不可导出并阻断发布', () => {
  const ids = idFactory();
  const currentSnapshot = snapshot([{
    layerId: 2,
    name: 'LoginButton',
    kind: 'group',
    bounds: { left: 100, top: 100, right: 300, bottom: 180 },
    children: [{
      layerId: 3,
      name: 'IgnoredVisuals',
      kind: 'group',
      bounds: { left: 100, top: 100, right: 300, bottom: 180 },
      children: [imageLayer(4, 'Background')]
    }]
  }]);
  let manifest = initialize(currentSnapshot, ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-node-preset',
    input: { layerId: 3, name: 'IgnoredVisuals', semantic: 'ignore' }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'LoginButton',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [{ name: 'background', layerId: 4 }],
        previewLayerIds: []
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const prepared = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids });
  assert.ok(prepared.diagnostics.some((entry) => entry.severity === 'error'
    && entry.code === 'PSD2UI_STRUCTURE_ROLE_MISSING'));
  assert.throws(
    () => buildBundle(prepared.manifest, currentSnapshot),
    (error) => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT');
});

test('Preview 样例子树内部的未完成组件不会误阻断正式发布', () => {
  const ids = idFactory();
  const group = (layerId, name, children) => ({
    layerId,
    name,
    kind: 'group',
    bounds: { left: 0, top: 0, right: 100, bottom: 40 },
    children: children || []
  });
  const currentSnapshot = snapshot([group(2, 'RewardList', [
    group(3, 'ItemTemplate'),
    { ...group(5, 'PreviewItem', [group(6, 'PreviewButton')]),
      bounds: { left: 0, top: 50, right: 100, bottom: 90 } }
  ])]);
  let manifest = initialize(currentSnapshot, ids);
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'RewardList',
      semantic: 'list',
      structure: {
        version: 1,
        roles: [{ name: 'item-template', layerId: 3 }],
        previewLayerIds: [5]
      }
    }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-node-preset',
    input: { layerId: 6, name: 'PreviewButton', semantic: 'button' }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;

  const prepared = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids });
  assert.equal(prepared.diagnostics.some((entry) => entry.severity === 'error'), false);
  const bundle = buildBundle(prepared.manifest, currentSnapshot);
  assert.deepEqual(bundle.root.children[0].children.map((node) => node.name), ['ItemTemplate']);
});

test('重复写入兼容图片语义时恢复同层资源绑定并保持 ID 与编号', () => {
  const ids = idFactory();
  const currentSnapshot = snapshot([imageLayer(2, 'ActionVisual')]);
  let manifest = initialize(currentSnapshot, ids);
  manifest = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids }).manifest;
  const original = Object.values(manifest.resourceRegistry.resources)
    .find((resource) => resource.status === 'active');

  for (const semantic of ['image', 'button', 'red-point', 'image']) {
    manifest = executeAuthoringCommand(manifest, {
      command: 'apply-node-preset',
      input: { layerId: 2, name: 'ActionVisual', semantic }
    }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
    const synchronized = executeAuthoringCommand(manifest, {
      command: 'sync-layer-tree',
      input: { snapshot: currentSnapshot }
    }, { actor: 'human-panel' }, { idFactory: ids });
    manifest = synchronized.manifest;
    assert.equal(manifest.nodes['2'].image.resourceId, original.id);
    assert.deepEqual(synchronized.value.reconciliation.retiredResourceIds, []);
  }

  const prepared = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids });
  const active = Object.values(prepared.manifest.resourceRegistry.resources)
    .filter((resource) => resource.status === 'active');
  assert.equal(active.length, 1);
  assert.equal(active[0].id, original.id);
  assert.equal(active[0].fileName, 'demo_sp_0001.png');
});

test('sprite 与 texture 类型切换不会误复用不兼容的同层资源', () => {
  const ids = idFactory();
  const currentSnapshot = snapshot([imageLayer(2, 'LargeVisual')]);
  let manifest = initialize(currentSnapshot, ids);
  manifest = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids }).manifest;
  const sprite = Object.values(manifest.resourceRegistry.resources)
    .find((resource) => resource.status === 'active');

  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-node-preset',
    input: { layerId: 2, name: 'LargeVisual', semantic: 'raw-image' }
  }, { actor: 'human-panel' }, { idFactory: ids }).manifest;
  const synchronized = executeAuthoringCommand(manifest, {
    command: 'sync-layer-tree',
    input: { snapshot: currentSnapshot }
  }, { actor: 'human-panel' }, { idFactory: ids });
  manifest = synchronized.manifest;
  assert.equal(manifest.nodes['2'].rawImage.resourceId, null);
  assert.deepEqual(synchronized.value.reconciliation.retiredResourceIds, [sprite.id]);

  const prepared = prepareManifestForExport(manifest, currentSnapshot, { idFactory: ids });
  const texture = Object.values(prepared.manifest.resourceRegistry.resources)
    .find((resource) => resource.status === 'active');
  assert.notEqual(texture.id, sprite.id);
  assert.equal(texture.kind, 'texture');
  assert.equal(texture.fileName, 'demo_tex_0001.png');
  assert.equal(prepared.manifest.nodes['2'].rawImage.resourceId, texture.id);
});
