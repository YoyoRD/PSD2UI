'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  AllowedAuthoringCommands,
  ConfirmedPreinitializeRenamesText,
  ConfirmedStructurePlanText,
  ConfirmedSubmoduleMigrationText,
  createPhotoshopHost
} = require('../../PS-MCP/src/hostBridge');

function createHost() {
  const calls = [];
  const repositoryRoot = path.resolve('F:/Workspace/YoyoEngine');
  const authoringRoot = path.join(repositoryRoot, '美术目录');
  const uiResPath = path.resolve('F:/DMWK_Client/trunk/Project/UIRes');
  const host = createPhotoshopHost({
    toolRoot: path.resolve('F:/Tools/psd2ui'),
    authoringRoots: [authoringRoot],
    uiResPath,
    runner: async (input) => {
      calls.push(input);
      return { method: input.method || input.operation, payload: input.payload || null };
    }
  });
  return { calls, host, repositoryRoot, authoringRoot, uiResPath };
}

async function withEnvironment(values, callback) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('PS-MCP 忽略旧仓库参数和环境，不推导工具根、创作根或 UDT 配置', async () => {
  const legacyRoot = path.join(os.tmpdir(), 'psd2ui-host-legacy-project');
  const programFiles = path.join(os.tmpdir(), 'psd2ui-host-program-files');
  await withEnvironment({
    PSD2UI_TOOL_ROOT: null,
    PSD2UI_AUTHORING_ROOTS: null,
    PSD2UI_UIRES_PATH: null,
    PSD2UI_UDT_ROOT: null,
    PSD2UI_UDT_PORT: null,
    YOYO_PSD2UI_REPOSITORY_ROOT: legacyRoot,
    YOYO_PSD2UI_UDT_ROOT: path.join(legacyRoot, 'Adobe'),
    YOYO_PSD2UI_UDT_PORT: '19999',
    ProgramFiles: programFiles
  }, async () => {
    const calls = [];
    const host = createPhotoshopHost({
      repositoryRoot: path.join(legacyRoot, 'explicit-legacy-root'),
      runner: async (input) => { calls.push(input); return {}; }
    });
    const sourceToolRoot = path.resolve(__dirname, '../..');
    assert.equal(host.toolRoot, sourceToolRoot);
    assert.deepEqual(host.authoringRoots, []);
    assert.equal(host.uiResPath, null);
    assert.throws(() => host.openDocument(path.join(legacyRoot, '美术目录', 'UI.psd')),
      /尚未配置允许访问的 PSD 创作目录/);
    assert.equal(calls.length, 0);
    await host.status({ checkOnly: true });
    assert.equal(calls[0].manifestPath, path.join(sourceToolRoot, 'Plus-ins', 'PSD2UI', 'manifest.json'));
    assert.equal(calls[0].udtRoot, path.join(programFiles, 'Adobe', 'Adobe UXP Developer Tools'));
    assert.equal(calls[0].servicePort, 14001);
  });
});

test('PS-MCP UDT 优先使用明确配置和当前环境变量', async () => {
  const testRoot = path.join(os.tmpdir(), 'psd2ui-host-explicit-options');
  await withEnvironment({
    PSD2UI_TOOL_ROOT: path.join(testRoot, 'environment-tools'),
    PSD2UI_AUTHORING_ROOTS: path.join(testRoot, 'environment-art'),
    PSD2UI_UDT_ROOT: path.join(testRoot, 'environment-udt'),
    PSD2UI_UDT_PORT: '14002',
    ProgramFiles: path.join(testRoot, 'program-files')
  }, async () => {
    const calls = [];
    const runner = async (input) => { calls.push(input); return {}; };
    const explicitHost = createPhotoshopHost({
      toolRoot: path.join(testRoot, 'explicit-tools'),
      artSourceRoot: path.join(testRoot, 'explicit-art'),
      udtRoot: path.join(testRoot, 'explicit-udt'),
      servicePort: 14003,
      runner
    });
    assert.equal(explicitHost.toolRoot, path.join(testRoot, 'explicit-tools'));
    assert.deepEqual(explicitHost.authoringRoots, [path.join(testRoot, 'explicit-art')]);
    await explicitHost.status({ checkOnly: true });
    assert.equal(calls[0].udtRoot, path.join(testRoot, 'explicit-udt'));
    assert.equal(calls[0].servicePort, 14003);

    const environmentHost = createPhotoshopHost({ runner });
    assert.equal(environmentHost.toolRoot, path.join(testRoot, 'environment-tools'));
    assert.deepEqual(environmentHost.authoringRoots, [path.join(testRoot, 'environment-art')]);
    await environmentHost.status({ checkOnly: true });
    assert.equal(calls[1].udtRoot, path.join(testRoot, 'environment-udt'));
    assert.equal(calls[1].servicePort, 14002);
  });
});

test('PS-MCP 缺少 ProgramFiles 时从 SystemDrive 定位 UDT', async () => {
  const systemRoot = process.platform === 'win32' ? 'Q:\\' : '/psd2ui-test-system';
  await withEnvironment({
    PSD2UI_UDT_ROOT: null,
    ProgramFiles: null,
    SystemDrive: process.platform === 'win32' ? 'Q:' : systemRoot
  }, async () => {
    const calls = [];
    const host = createPhotoshopHost({ runner: async (input) => { calls.push(input); return {}; } });
    await host.status({ checkOnly: true });
    const expectedRoot = path.join(systemRoot, 'Program Files', 'Adobe', 'Adobe UXP Developer Tools');
    assert.equal(calls[0].udtRoot, expectedRoot);
    assert.equal(calls[0].udtExecutable, path.join(expectedRoot, 'Adobe UXP Developer Tools.exe'));
  });
});

test('环境检查只调用 status 且限制等待，默认状态查询保留原超时', async () => {
  const { calls, host } = createHost();
  await host.status({ checkOnly: true });
  await host.status();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, 'status');
  assert.equal(calls[0].checkOnly, true);
  assert.equal(calls[0].timeoutMilliseconds, 15000);
  assert.equal(calls[1].checkOnly, false);
  assert.equal(calls[1].timeoutMilliseconds, 600000);
});

test('环境检查失败原样上报且不重试准备连接', async () => {
  const failure = new Error('UDT 服务未运行');
  const calls = [];
  const host = createPhotoshopHost({
    timeoutMilliseconds: 2000,
    runner: async (input) => {
      calls.push(input);
      throw failure;
    }
  });
  await assert.rejects(host.status({ checkOnly: true }), (error) => error === failure);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeoutMilliseconds, 2000);
});

test('PS-MCP Photoshop Host 只允许显式配置的创作目录中的 PSD', async () => {
  const { calls, host, authoringRoot } = createHost();
  const target = path.join(authoringRoot, 'UI', '主界面.psd');
  await host.openDocument(target);
  assert.equal(calls[0].method, 'openDocument');
  assert.equal(calls[0].payload.documentPath, target);

  assert.throws(
    () => host.openDocument('F:/Workspace/uglyduck/美术目录/UI/主界面.psd'),
    /必须位于/);
  assert.throws(
    () => host.openDocument(path.join(authoringRoot, 'UI', 'readme.txt')),
    /只允许操作 \.psd/);
});

test('PS-MCP 导出目录匹配显式配置且可与 PSD 跨仓', async () => {
  const { calls, host, repositoryRoot, uiResPath } = createHost();
  const target = path.join(repositoryRoot, '美术目录', 'UI', '主界面.psd');
  await host.exportBundle(target);
  assert.equal(calls[0].method, 'exportBundle');
  assert.equal(calls[0].payload.uiResPath, uiResPath);

  assert.throws(
    () => host.exportBundle(target, path.join(repositoryRoot, 'Project', 'Assets')),
    /匹配已配置的 UIRes/);
});

test('PS-MCP 不从旧仓库根推导 UIRes', () => {
  const repositoryRoot = path.resolve('F:/Workspace/YoyoEngine');
  const host = createPhotoshopHost({
    repositoryRoot,
    authoringRoots: [path.join(repositoryRoot, '美术目录')],
    runner: async () => ({})
  });

  assert.equal(host.uiResPath, null);
  assert.throws(
    () => host.exportBundle(path.join(repositoryRoot, '美术目录', 'UI', '主界面.psd')),
    /必须显式提供.*UIRes/);
});

test('创建文档根组要求调用方显式提供全部候选图层', async () => {
  const { calls, host, repositoryRoot } = createHost();
  const target = path.join(repositoryRoot, '美术目录', 'UI', '主界面.psd');
  await host.wrapDocumentRoot({
    expectedDocumentPath: target,
    layerIds: ['99', '80'],
    groupName: 'MainView'
  });
  assert.equal(calls[0].method, 'wrapDocumentRoot');
  assert.deepEqual(calls[0].payload.layerIds, ['99', '80']);
  assert.equal(calls[0].payload.groupName, 'MainView');
  assert.throws(
    () => host.wrapDocumentRoot({ expectedDocumentPath: target, layerIds: [], groupName: 'MainView' }),
    /layerIds/);
});

test('PS-MCP Host 不开放结构化和人工权限命令', async () => {
  const { calls, host, repositoryRoot } = createHost();
  const target = path.join(repositoryRoot, '美术目录', 'UI', '主界面.psd');
  assert.deepEqual(AllowedAuthoringCommands, [
    'apply-node-preset',
    'update-node-parameters',
    'set-visual-states',
    'set-collection-previews',
    'set-node-viewport',
    'allocate-resource',
    'reuse-resource',
    'retire-resource'
  ]);
  await host.executeAuthoring({
    expectedDocumentPath: target,
    command: 'apply-node-preset',
    input: { layerId: '2', name: 'Title', semantic: 'text' }
  });
  assert.equal(calls[0].method, 'execute');

  assert.throws(
    () => host.executeAuthoring({
      expectedDocumentPath: target,
      command: 'apply-structured-group',
      input: {}
    }),
    (error) => {
      assert.match(error.message, /不开放/);
      assert.match(error.message, /psd2ui_apply_confirmed_structure_plan/);
      assert.doesNotMatch(error.message, /必须在 Photoshop 面板/);
      return true;
    });
  assert.throws(
    () => host.executeAuthoring({
      expectedDocumentPath: target,
      command: 'set-document-module',
      input: { module: 'other' }
    }),
    /不开放/);
});

test('PS-MCP 可转发已确认的视觉状态、集合预览和可视区域配置', async () => {
  const { calls, host, authoringRoot } = createHost();
  const expectedDocumentPath = path.join(authoringRoot, 'UI.psd');
  const settings = [
    { command: 'set-visual-states', input: { layerId: '2', visualStates: {
      defaultState: 'normal', states: [{ name: 'normal', layerId: '3' }, { name: 'selected', layerId: '4' }]
    } } },
    { command: 'set-collection-previews', input: { layerId: '5', previewLayerIds: ['6', '7'] } },
    { command: 'set-node-viewport', input: { layerId: '5', viewport: { width: 995, height: 1543 } } }
  ];
  for (const setting of settings) await host.executeAuthoring({ expectedDocumentPath, ...setting });
  assert.equal(calls.length, settings.length);
  settings.forEach((setting, index) => {
    assert.equal(calls[index].method, 'execute');
    assert.deepEqual(calls[index].payload, { expectedDocumentPath, ...setting });
  });
});

test('PS-MCP 只通过独立入口应用用户确认的精确结构计划', async () => {
  const { calls, host, repositoryRoot } = createHost();
  const target = path.join(repositoryRoot, '美术目录', 'UI', '主界面.psd');
  const plan = {
    version: 1,
    confirmationId: 'main-structure-v1',
    preconditions: [{ layerId: '29', name: '开始游戏' }],
    adopt: [{
      ref: '29',
      semantic: 'button',
      roles: [{ name: 'background', ref: '22' }]
    }]
  };
  await host.applyConfirmedStructurePlan({
    expectedDocumentPath: target,
    confirmationId: plan.confirmationId,
    confirmationText: ConfirmedStructurePlanText,
    plan
  });
  assert.equal(calls[0].method, 'applyConfirmedStructurePlan');
  assert.equal(calls[0].payload.expectedDocumentPath, target);
  assert.equal(calls[0].payload.plan, plan);

  assert.throws(
    () => host.applyConfirmedStructurePlan({
      expectedDocumentPath: target,
      confirmationId: plan.confirmationId,
      confirmationText: 'YES',
      plan
    }),
    /明确的用户确认标记/);
  assert.throws(
    () => host.applyConfirmedStructurePlan({
      expectedDocumentPath: target,
      confirmationId: 'other-plan',
      confirmationText: ConfirmedStructurePlanText,
      plan
    }),
    /confirmationId/);
});

test('PS-MCP 只通过独立入口应用用户确认的初始化前命名', async () => {
  const { calls, host, repositoryRoot } = createHost();
  const target = path.join(repositoryRoot, '美术目录', 'UI', '技能三选一.psd');
  const plan = {
    version: 1,
    confirmationId: 'skill-choice-v1',
    preconditions: [{ layerId: '42', name: 'safe' }],
    renames: [{ ref: '42', name: 'SkillChoiceView' }]
  };
  await host.applyConfirmedPreinitializeRenames({
    expectedDocumentPath: target,
    rootLayerId: '42',
    confirmationId: plan.confirmationId,
    confirmationText: ConfirmedPreinitializeRenamesText,
    plan
  });
  assert.equal(calls[0].method, 'applyConfirmedPreinitializeRenames');
  assert.equal(calls[0].payload.rootLayerId, '42');
  assert.equal(calls[0].payload.repairPreservedState, false);
  assert.equal(calls[0].payload.plan, plan);

  await host.applyConfirmedPreinitializeRenames({
    expectedDocumentPath: target,
    rootLayerId: '42',
    confirmationId: plan.confirmationId,
    confirmationText: ConfirmedPreinitializeRenamesText,
    repairPreservedState: true,
    plan
  });
  assert.equal(calls[1].payload.repairPreservedState, true);

  assert.throws(
    () => host.applyConfirmedPreinitializeRenames({
      expectedDocumentPath: target,
      rootLayerId: '',
      confirmationId: plan.confirmationId,
      confirmationText: ConfirmedPreinitializeRenamesText,
      plan
    }),
    /rootLayerId/);
  assert.throws(
    () => host.applyConfirmedPreinitializeRenames({
      expectedDocumentPath: target,
      rootLayerId: '42',
      confirmationId: plan.confirmationId,
      confirmationText: 'YES',
      plan
    }),
    /明确的用户确认标记/);
});

test('PS-MCP 只通过独立入口应用用户确认的 submodule 事务迁移', async () => {
  const { calls, host, repositoryRoot } = createHost();
  const target = path.join(repositoryRoot, '美术目录', 'UI', '战斗界面.psd');
  const plan = {
    version: 1,
    confirmationId: 'battle-ui-submodule-v1',
    submodule: 'hud',
    expected: {
      manifestVersion: '1.0.0',
      revision: 7,
      documentId: 'document-hud',
      documentName: 'BattleHudView',
      module: 'battle',
      rootLayerId: '99',
      nodeCount: 70,
      resourceCount: 48,
      activeResourceCount: 48,
      counters: { 'battle|sprite': 49 }
    }
  };
  await host.applyConfirmedSubmoduleMigration({
    expectedDocumentPath: target,
    confirmationId: plan.confirmationId,
    confirmationText: ConfirmedSubmoduleMigrationText,
    plan
  });
  assert.equal(calls[0].method, 'applyConfirmedSubmoduleMigration');
  assert.equal(calls[0].payload.expectedDocumentPath, target);
  assert.equal(calls[0].payload.plan, plan);

  assert.throws(
    () => host.applyConfirmedSubmoduleMigration({
      expectedDocumentPath: target,
      confirmationId: plan.confirmationId,
      confirmationText: 'YES',
      plan
    }),
    /明确的用户确认标记/);
});
