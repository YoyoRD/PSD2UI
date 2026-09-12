'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommandService } = require('../../PS-MCP/src/commandService');

function createStorage() {
  let value = null;
  return {
    readManifest: async () => value,
    writeManifest: async (manifest) => { value = manifest; },
    get value() { return value; }
  };
}

test('MCP 与面板复用同一套确定性预设', async () => {
  const storage = createStorage();
  let sequence = 0;
  const service = createCommandService(storage, { idFactory: (prefix) => `${prefix}-mcp-${++sequence}` });
  await service.execute({
    command: 'initialize-document',
    input: {
      module: 'login',
      name: 'LoginView',
      width: 1280,
      height: 720,
      rootLayerId: 1,
      rootLayerName: 'LoginView'
    }
  });
  await service.execute({
    command: 'apply-node-preset',
    input: { layerId: 2, name: 'txtTitle', semantic: 'text' }
  });

  assert.equal(storage.value.nodes['2'].text.fontSize, 24);
  assert.equal(storage.value.nodes['2'].text.alignment, 'middle-center');
  assert.equal(storage.value.nodes['2'].presetVersion, 1);
});

test('MCP 不能执行人工 Common 提升', async () => {
  const storage = createStorage();
  let sequence = 0;
  const service = createCommandService(storage, { idFactory: (prefix) => `${prefix}-mcp-${++sequence}` });
  await service.execute({
    command: 'initialize-document',
    input: {
      module: 'login',
      name: 'LoginView',
      width: 1280,
      height: 720,
      rootLayerId: 1,
      rootLayerName: 'LoginView'
    }
  });
  await service.execute({
    command: 'apply-node-preset',
    input: { layerId: 2, name: 'imgLogo', semantic: 'image' }
  });
  const resource = await service.execute({
    command: 'allocate-resource',
    input: { layerId: 2, kind: 'sprite' }
  });

  await assert.rejects(
    () => service.execute({
      command: 'promote-resource-to-common',
      input: { resourceId: resource.id, kind: resource.kind }
    }),
    (error) => error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');
});

test('MCP 不能改变文档 module 或绕过资源绑定命令', async () => {
  const storage = createStorage();
  let sequence = 0;
  const service = createCommandService(storage, { idFactory: (prefix) => `${prefix}-guard-${++sequence}` });
  await service.execute({
    command: 'initialize-document',
    input: {
      module: 'login',
      name: 'LoginView',
      width: 1280,
      height: 720,
      rootLayerId: 1,
      rootLayerName: 'LoginView'
    }
  });
  await service.execute({
    command: 'apply-node-preset',
    input: { layerId: 2, name: 'imgLogo', semantic: 'image' }
  });

  await assert.rejects(
    () => service.execute({ command: 'set-document-module', input: { module: 'home' } }),
    (error) => error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');
  await assert.rejects(
    () => service.execute({
      command: 'update-node-parameters',
      input: { layerId: 2, parameters: { image: { resourceId: 'invented-resource' } } }
    }),
    (error) => error.code === 'PSD2UI_RESOURCE_BIND_COMMAND_REQUIRED');
  await assert.rejects(
    () => service.execute({
      command: 'allocate-resource',
      input: { layerId: 2, kind: 'sprite', module: 'common' }
    }),
    (error) => error.code === 'PSD2UI_RESOURCE_MODULE_FROM_DOCUMENT');
});
