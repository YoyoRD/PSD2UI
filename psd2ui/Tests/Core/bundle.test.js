'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeAuthoringCommand, buildBundle, preflightBundle } = require('../../Core');

function idFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-bundle-${++sequence}`;
}

function run(manifest, ids, command, input) {
  return executeAuthoringCommand(
    manifest,
    { command, input },
    { actor: 'human-panel' },
    { idFactory: ids });
}

test('预检边界错误携带图层和节点身份，供面板准确定位', () => {
  const ids = idFactory();
  let manifest = run(null, ids, 'initialize-document', {
    module: 'test', name: 'View', width: 100, height: 100, rootLayerId: 1, rootLayerName: 'View'
  }).manifest;
  manifest = run(manifest, ids, 'apply-node-preset', {
    layerId: 6330, name: 'EmptyGroup', semantic: 'group'
  }).manifest;
  const snapshot = { root: {
    layerId: 1, name: 'View', kind: 'group', bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    children: [{ layerId: 6330, name: 'EmptyGroup', kind: 'group',
      bounds: { left: NaN, top: NaN, right: NaN, bottom: NaN }, children: [] }]
  } };
  const result = preflightBundle(manifest, snapshot);
  assert.equal(result.status, 'blocked');
  assert.equal(result.issues[0].code, 'PSD2UI_GEOMETRY_INVALID');
  assert.equal(result.issues[0].layerId, '6330');
  assert.equal(result.issues[0].nodeId, manifest.nodes['6330'].id);
  assert.equal(result.issues[0].name, 'EmptyGroup');
});

test('Bundle 使用引擎无关语义、父节点左上角坐标和稳定资源名', () => {
  const ids = idFactory();
  let manifest = run(null, ids, 'initialize-document', {
    module: 'login',
    name: 'LoginView',
    width: 1280,
    height: 720,
    rootLayerId: 1,
    rootLayerName: 'LoginView'
  }).manifest;

  for (const node of [
    { layerId: 2, name: 'grpCard', semantic: 'group' },
    { layerId: 4, name: 'imgLogin', semantic: 'image' },
    { layerId: 5, name: 'txtLogin', semantic: 'text' }
  ]) {
    manifest = run(manifest, ids, 'apply-node-preset', node).manifest;
  }
  manifest = run(manifest, ids, 'apply-structured-group', {
    layerId: 3,
    name: 'btnLogin',
    semantic: 'button',
    structure: {
      version: 1,
      roles: [
        { name: 'background', layerId: 4 },
        { name: 'label', layerId: 5 }
      ],
      previewLayerIds: []
    }
  }).manifest;

  let result = run(manifest, ids, 'allocate-resource', { layerId: 4, kind: 'sprite' });
  manifest = result.manifest;
  manifest = run(manifest, ids, 'update-node-parameters', {
    layerId: 5,
    parameters: {
      text: {
        value: '登录',
        fontSize: 32,
        alignment: 'middle-center'
      }
    }
  }).manifest;

  const snapshot = {
    root: {
      layerId: 1,
      name: 'LoginView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 1280, bottom: 720 },
      children: [{
        layerId: 2,
        name: 'grpCard',
        kind: 'group',
        bounds: { left: 300, top: 100, right: 980, bottom: 620 },
        children: [{
          layerId: 3,
          name: 'btnLogin',
          kind: 'group',
          bounds: { left: 420, top: 460, right: 860, bottom: 540 },
          children: [
            {
              layerId: 5,
              name: 'txtLogin',
              kind: 'text',
              bounds: { left: 520, top: 475, right: 760, bottom: 525 },
              children: []
            },
            {
              layerId: 4,
              name: 'imgLogin',
              kind: 'pixel',
              bounds: { left: 420, top: 460, right: 860, bottom: 540 },
              children: []
            }
          ]
        }]
      }]
    }
  };

  const bundle = buildBundle(manifest, snapshot);
  assert.equal(bundle.schemaVersion, '1.4.0');
  assert.equal(bundle.root.defaultsVersion, 1);
  assert.equal(bundle.document.coordSpace, 'parent-top-left-px');
  assert.equal(bundle.resources[0].fileName, 'login_sp_0001.png');
  assert.equal(bundle.root.children[0].rect.x, 300);
  assert.deepEqual(bundle.root.children[0].children[0].rect, {
    x: 120,
    y: 360,
    width: 440,
    height: 80
  }, '结构化组根必须保留相对父级坐标和完整正尺寸');
  assert.equal(bundle.root.children[0].children[0].semantic, 'button');
  assert.equal(bundle.root.children[0].children[0].authoringSource, 'structured');
  assert.deepEqual(
    bundle.root.children[0].children[0].children.map((node) => node.name),
    ['txtLogin', 'imgLogin'],
    'Bundle 必须保留 Photoshop 前景到背景层序');
  assert.equal(bundle.root.children[0].children[0].children[0].rect.x, 100);
  assert.equal(bundle.root.children[0].children[0].children[0].text.value, '登录');
  assert.equal(JSON.stringify(bundle).includes('Yoyo.UI'), false);
  assert.equal(JSON.stringify(bundle).includes('SGEngine'), false);
});

test('submodule 文档输出 Schema 1.4 和 module_submodule 资源名', () => {
  const ids = idFactory();
  let manifest = run(null, ids, 'initialize-document', {
    module: 'battle',
    submodule: 'inventory',
    name: 'BattleInventoryView',
    width: 720,
    height: 1660,
    rootLayerId: 1,
    rootLayerName: 'BattleInventoryView'
  }).manifest;
  manifest = run(manifest, ids, 'apply-node-preset', {
    layerId: 2,
    name: 'imgInventoryPanel',
    semantic: 'image'
  }).manifest;
  manifest = run(manifest, ids, 'allocate-resource', {
    layerId: 2,
    kind: 'sprite'
  }).manifest;

  const bundle = buildBundle(manifest, {
    root: {
      layerId: 1,
      name: 'BattleInventoryView',
      bounds: { left: 0, top: 0, right: 720, bottom: 1660 },
      children: [{
        layerId: 2,
        name: 'imgInventoryPanel',
        bounds: { left: 20, top: 20, right: 220, bottom: 220 },
        children: []
      }]
    }
  });

  assert.equal(bundle.schemaVersion, '1.4.0');
  assert.equal(bundle.document.module, 'battle');
  assert.equal(bundle.document.submodule, 'inventory');
  assert.equal(bundle.resources[0].submodule, 'inventory');
  assert.equal(bundle.resources[0].fileName, 'battle_inventory_sp_0001.png');
});

test('raw-image 只绑定 texture 并导出显式 UV 参数', () => {
  const ids = idFactory();
  let manifest = run(null, ids, 'initialize-document', {
    module: 'startup',
    name: 'StartupPage',
    width: 720,
    height: 1660,
    rootLayerId: 1,
    rootLayerName: 'StartupPage'
  }).manifest;

  manifest = run(manifest, ids, 'apply-node-preset', {
    layerId: 2,
    name: 'imgBackground',
    semantic: 'raw-image'
  }).manifest;
  assert.throws(
    () => run(manifest, ids, 'allocate-resource', { layerId: 2, kind: 'sprite' }),
    (error) => error.code === 'PSD2UI_NODE_RESOURCE_KIND');
  manifest = run(manifest, ids, 'allocate-resource', {
    layerId: 2,
    kind: 'texture'
  }).manifest;

  const bundle = buildBundle(manifest, {
    root: {
      layerId: 1,
      name: 'StartupPage',
      bounds: { left: 0, top: 0, right: 720, bottom: 1660 },
      children: [{
        layerId: 2,
        name: 'imgBackground',
        bounds: { left: 0, top: 0, right: 720, bottom: 1660 },
        children: []
      }]
    }
  });

  assert.equal(bundle.resources.length, 1);
  assert.equal(bundle.resources[0].kind, 'texture');
  assert.equal(bundle.resources[0].fileName, 'startup_tex_0001.png');
  assert.equal(bundle.root.children[0].semantic, 'raw-image');
  assert.equal(bundle.root.children[0].image, null);
  assert.deepEqual(bundle.root.children[0].rawImage.uvRect, {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  });
});

test('快照包含英文未配置图层时使用默认语义并保持可导出', () => {
  const ids = idFactory();
  const manifest = run(null, ids, 'initialize-document', {
    module: 'login',
    name: 'LoginView',
    width: 1280,
    height: 720,
    rootLayerId: 1,
    rootLayerName: 'LoginView'
  }).manifest;

  const bundle = buildBundle(manifest, {
    root: {
      layerId: 1,
      name: 'LoginView',
      bounds: { left: 0, top: 0, right: 1280, bottom: 720 },
      children: [{
        layerId: 99,
        name: 'UninitializedArtwork',
        bounds: { left: 0, top: 0, right: 10, bottom: 10 },
        children: []
      }]
    }
  });
  assert.equal(bundle.root.children[0].semantic, 'image');
  assert.equal(bundle.root.children[0].authoringSource, 'default');
  assert.equal(bundle.resources.length, 1);
  assert.equal(bundle.diagnostics[0].code, 'PSD2UI_DEFAULT_SEMANTICS_APPLIED');
});

test('Bundle 原样保留美术维护的 Photoshop 基础名，不补前缀或去重后缀', () => {
  const ids = idFactory();
  let manifest = run(null, ids, 'initialize-document', {
    module: 'main',
    name: 'MainView',
    width: 720,
    height: 1660,
    rootLayerId: 1,
    rootLayerName: 'MainView'
  }).manifest;
  manifest = run(manifest, ids, 'apply-node-preset', {
    layerId: 2,
    name: 'StartGame',
    semantic: 'button'
  }).manifest;
  manifest = run(manifest, ids, 'apply-node-preset', {
    layerId: 3,
    name: 'StartGame',
    semantic: 'button'
  }).manifest;
  manifest = run(manifest, ids, 'apply-node-preset', {
    layerId: 4,
    name: 'BattleIcon',
    semantic: 'image'
  }).manifest;

  const bundle = buildBundle(manifest, {
    root: {
      layerId: 1,
      name: 'MainView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 720, bottom: 1660 },
      children: [
        {
          layerId: 2,
          name: 'StartGame',
          kind: 'pixel',
          bounds: { left: 10, top: 10, right: 110, bottom: 60 },
          children: []
        },
        {
          layerId: 3,
          name: 'StartGame',
          kind: 'pixel',
          bounds: { left: 120, top: 10, right: 220, bottom: 60 },
          children: []
        },
        {
          layerId: 4,
          name: 'BattleIcon',
          kind: 'pixel',
          bounds: { left: 10, top: 100, right: 74, bottom: 164 },
          children: []
        },
        {
          layerId: 5,
          name: 'LobbyBackground',
          kind: 'pixel',
          bounds: { left: 0, top: 200, right: 720, bottom: 1000 },
          children: []
        }
      ]
    }
  });

  assert.deepEqual(bundle.root.children.map((node) => node.name), [
    'StartGame',
    'StartGame',
    'BattleIcon',
    'LobbyBackground'
  ]);
  assert.equal(bundle.root.children[3].semantic, 'raw-image');
  assert.equal(bundle.root.children[3].authoringSource, 'default');
});

test('导出会阻止中文或非标识符 Photoshop 图层名', () => {
  const ids = idFactory();
  const manifest = run(null, ids, 'initialize-document', {
    module: 'main',
    name: 'MainView',
    width: 720,
    height: 1660,
    rootLayerId: 1,
    rootLayerName: 'MainView'
  }).manifest;

  assert.throws(
    () => buildBundle(manifest, {
      root: {
        layerId: 1,
        name: 'MainView',
        kind: 'group',
        bounds: { left: 0, top: 0, right: 720, bottom: 1660 },
        children: [{
          layerId: 2,
          name: '大厅背景',
          kind: 'pixel',
          bounds: { left: 0, top: 0, right: 720, bottom: 1660 },
          children: []
        }]
      }
    }),
    (error) => error && error.code === 'PSD2UI_LAYER_NAME_ENGLISH_REQUIRED'
      && /2:大厅背景/.test(error.message));
});
