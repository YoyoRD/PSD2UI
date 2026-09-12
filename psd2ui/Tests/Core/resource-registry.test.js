'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeAuthoringCommand,
  allocateResource,
  retireResource,
  validateManifest,
  Psd2UiError
} = require('../../Core');

function idFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-test-${++sequence}`;
}

function execute(manifest, command, input, actor, ids) {
  return executeAuthoringCommand(
    manifest,
    { command, input },
    { actor: actor || 'human-panel' },
    { idFactory: ids });
}

function initialize(ids) {
  return execute(null, 'initialize-document', {
    module: 'login',
    name: 'LoginView',
    width: 1280,
    height: 720,
    rootLayerId: 1,
    rootLayerName: 'LoginView'
  }, 'human-panel', ids).manifest;
}

test('module/type 分开计数，删除后不复用编号', () => {
  const ids = idFactory();
  const manifest = initialize(ids);

  const first = allocateResource(manifest, { layerId: 10, kind: 'sprite' }, { idFactory: ids });
  const texture = allocateResource(manifest, { layerId: 11, kind: 'texture' }, { idFactory: ids });
  const second = allocateResource(manifest, { layerId: 12, kind: 'sprite' }, { idFactory: ids });
  retireResource(manifest, { resourceId: first.id });
  const third = allocateResource(manifest, { layerId: 13, kind: 'sprite' }, { idFactory: ids });

  assert.equal(first.fileName, 'login_sp_0001.png');
  assert.equal(texture.fileName, 'login_tex_0001.png');
  assert.equal(second.fileName, 'login_sp_0002.png');
  assert.equal(third.fileName, 'login_sp_0003.png');
  assert.equal(manifest.resourceRegistry.counters['login|sprite'], 4);
});

test('submodule 文档按 module/submodule/kind 分配稳定资源名和编号', () => {
  const ids = idFactory();
  let manifest = execute(null, 'initialize-document', {
    module: 'battle',
    submodule: 'hud',
    name: 'BattleHudView',
    width: 720,
    height: 1660,
    rootLayerId: 1,
    rootLayerName: 'BattleHudView'
  }, 'human-panel', ids).manifest;

  const sprite = allocateResource(manifest, { layerId: 10, kind: 'sprite' }, { idFactory: ids });
  const texture = allocateResource(manifest, { layerId: 11, kind: 'texture' }, { idFactory: ids });
  assert.equal(manifest.manifestVersion, '1.1.0');
  assert.equal(sprite.fileName, 'battle_hud_sp_0001.png');
  assert.equal(texture.fileName, 'battle_hud_tex_0001.png');
  assert.equal(manifest.resourceRegistry.counters['battle|hud|sprite'], 2);
  assert.equal(manifest.resourceRegistry.counters['battle|hud|texture'], 2);

  const promoted = execute(manifest, 'promote-resource-to-common', {
    resourceId: sprite.id,
    submodule: 'battlehud',
    kind: 'sprite'
  }, 'human-panel', ids);
  manifest = promoted.manifest;
  assert.equal(promoted.value.module, 'common');
  assert.equal(promoted.value.submodule, 'battlehud');
  assert.equal(promoted.value.number, 1);
  assert.equal(promoted.value.fileName, 'common_battlehud_sp_0001.png');
  assert.equal(manifest.resourceRegistry.counters['common|battlehud|sprite'], 2);
});

test('用户确认的 submodule 迁移保留资源 ID 和既有编号', () => {
  const ids = idFactory();
  let manifest = initialize(ids);
  const sprite = allocateResource(manifest, { layerId: 10, kind: 'sprite' }, { idFactory: ids });
  const texture = allocateResource(manifest, { layerId: 11, kind: 'texture' }, { idFactory: ids });

  assert.throws(
    () => execute(manifest, 'set-document-submodule', {
      submodule: 'hud'
    }, 'mcp', ids),
    (error) => error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');

  const result = executeAuthoringCommand(manifest, {
    command: 'set-document-submodule',
    input: { submodule: 'hud', reason: 'confirmed-battle-submodule-plan' }
  }, {
    actor: 'human-approved-plan',
    confirmationId: 'battle-submodules-v1'
  }, { idFactory: ids });
  manifest = result.manifest;

  assert.equal(manifest.manifestVersion, '1.1.0');
  assert.equal(manifest.document.submodule, 'hud');
  assert.equal(manifest.resourceRegistry.resources[sprite.id].id, sprite.id);
  assert.equal(manifest.resourceRegistry.resources[sprite.id].number, 1);
  assert.equal(manifest.resourceRegistry.resources[sprite.id].submodule, 'hud');
  assert.equal(manifest.resourceRegistry.resources[sprite.id].fileName, 'login_hud_sp_0001.png');
  assert.equal(manifest.resourceRegistry.resources[texture.id].number, 1);
  assert.equal(manifest.resourceRegistry.resources[texture.id].fileName, 'login_hud_tex_0001.png');
  assert.equal(manifest.resourceRegistry.resources[sprite.id].history[0].fileName, 'login_sp_0001.png');
  assert.equal(manifest.resourceRegistry.counters['login|hud|sprite'], 2);
  assert.equal(manifest.resourceRegistry.counters['login|hud|texture'], 2);
  assert.deepEqual(validateManifest(manifest), []);
});

test('同一图层迭代保持文件名，复制图层默认分配新资源，显式复用才共享', () => {
  const ids = idFactory();
  let manifest = initialize(ids);

  manifest = execute(manifest, 'apply-node-preset', {
    layerId: 10,
    name: 'imgPortrait',
    semantic: 'image'
  }, 'human-panel', ids).manifest;
  let result = execute(manifest, 'allocate-resource', {
    layerId: 10,
    kind: 'sprite'
  }, 'human-panel', ids);
  manifest = result.manifest;
  const source = result.value;

  result = execute(manifest, 'allocate-resource', {
    layerId: 10,
    kind: 'sprite'
  }, 'human-panel', ids);
  manifest = result.manifest;
  assert.equal(result.value.id, source.id);
  assert.equal(result.value.fileName, 'login_sp_0001.png');

  manifest = execute(manifest, 'apply-node-preset', {
    layerId: 11,
    name: 'imgPortraitCopy',
    semantic: 'image'
  }, 'human-panel', ids).manifest;
  result = execute(manifest, 'allocate-resource', {
    layerId: 11,
    kind: 'sprite'
  }, 'human-panel', ids);
  manifest = result.manifest;
  assert.notEqual(result.value.id, source.id);
  assert.equal(result.value.fileName, 'login_sp_0002.png');

  manifest = execute(manifest, 'apply-node-preset', {
    layerId: 12,
    name: 'imgPortraitReuse',
    semantic: 'image'
  }, 'human-panel', ids).manifest;
  result = execute(manifest, 'reuse-resource', {
    layerId: 12,
    resourceId: source.id
  }, 'human-panel', ids);
  assert.equal(result.value.id, source.id);
  assert.equal(result.manifest.nodes['12'].image.resourceId, source.id);

  assert.throws(
    () => execute(manifest, 'reuse-resource', {
      layerId: 11,
      resourceId: source.id
    }, 'human-panel', ids),
    (error) => error.code === 'PSD2UI_LAYER_RESOURCE_STABLE');
});

test('Common 提升和 module/type 迁移只接受人工面板 actor', () => {
  const ids = idFactory();
  let manifest = initialize(ids);
  manifest = execute(manifest, 'apply-node-preset', {
    layerId: 10,
    name: 'imgLogo',
    semantic: 'image'
  }, 'human-panel', ids).manifest;
  let result = execute(manifest, 'allocate-resource', {
    layerId: 10,
    kind: 'sprite'
  }, 'human-panel', ids);
  manifest = result.manifest;
  const resourceId = result.value.id;

  assert.throws(
    () => execute(manifest, 'promote-resource-to-common', {
      resourceId,
      kind: 'sprite'
    }, 'mcp', ids),
    (error) => error instanceof Psd2UiError
      && error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');

  result = execute(manifest, 'promote-resource-to-common', {
    resourceId,
    kind: 'sprite'
  }, 'human-panel', ids);
  manifest = result.manifest;
  assert.equal(result.value.fileName, 'common_sp_0001.png');
  assert.equal(result.value.scope, 'common');
  assert.equal(result.value.history[0].fileName, 'login_sp_0001.png');

  assert.throws(
    () => execute(manifest, 'migrate-resource', {
      resourceId,
      module: 'inventory',
      kind: 'texture'
    }, 'mcp', ids),
    (error) => error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');
});

test('缺少图片资源时导出预检明确失败', () => {
  const ids = idFactory();
  let manifest = initialize(ids);
  manifest = execute(manifest, 'apply-node-preset', {
    layerId: 10,
    name: 'imgMissing',
    semantic: 'image'
  }, 'human-panel', ids).manifest;

  const issues = validateManifest(manifest);
  assert.ok(issues.some((entry) => entry.code === 'PSD2UI_IMAGE_RESOURCE_REQUIRED'));
});

test('文档不能绑定 common，新资源也不能绕过文档 module 直接分配 Common', () => {
  const ids = idFactory();
  assert.throws(
    () => execute(null, 'initialize-document', {
      module: 'common',
      name: 'InvalidView',
      width: 100,
      height: 100,
      rootLayerId: 1,
      rootLayerName: 'InvalidView'
    }, 'human-panel', ids),
    (error) => error.code === 'PSD2UI_DOCUMENT_MODULE_COMMON');

  let manifest = initialize(ids);
  manifest = execute(manifest, 'apply-node-preset', {
    layerId: 10,
    name: 'imgLogo',
    semantic: 'image'
  }, 'human-panel', ids).manifest;
  assert.throws(
    () => execute(manifest, 'allocate-resource', {
      layerId: 10,
      kind: 'sprite',
      module: 'common'
    }, 'mcp', ids),
    (error) => error.code === 'PSD2UI_RESOURCE_MODULE_FROM_DOCUMENT');
});
