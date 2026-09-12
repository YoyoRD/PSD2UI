'use strict';

const { McpServer } = require('@modelcontextprotocol/server');
const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const { z } = require('zod/v4');
const {
  AllowedAuthoringCommands,
  ConfirmedPreinitializeRenamesText,
  ConfirmedStructurePlanText,
  ConfirmedSubmoduleMigrationText,
  createPhotoshopHost
} = require('./hostBridge');

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function createPsd2UiMcpServer(host, options = {}) {
  const photoshopHost = host || createPhotoshopHost();
  const server = new McpServer(
    { name: 'psd2ui-photoshop', version: '0.3.0' },
    { capabilities: { tools: {} } });

  server.registerTool('psd2ui_photoshop_status', {
    title: '读取 Photoshop PSD2UI 状态',
    description: '读取 Photoshop PSD2UI 状态。默认 CEP：只发现已经打开的 PSD2UI 面板，无需 PSD，不安装或启动任何服务。requestId 和 instanceId 可查询超时操作回执；结果未知时不能重发写操作。显式 UXP 模式的 workflow 传 checkOnly:true，只检查现有连接。',
    inputSchema: z.object({ checkOnly: z.boolean().optional(), requestId: z.string().optional(), instanceId: z.string().optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async (input) => toolResult(await photoshopHost.status(input)));

  server.registerTool('psd2ui_open_document', {
    title: '打开已授权目录中的 PSD',
    description: '在 Photoshop 中打开或激活显式授权创作目录下的 PSD，不关闭其他文档。',
    inputSchema: z.object({ documentPath: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async ({ documentPath }) => toolResult(await photoshopHost.openDocument(documentPath)));

  server.registerTool('psd2ui_inspect_document', {
    title: '检查 PSD2UI 文档',
    description: '在精确路径校验后读取文档、顶层图层、完整已保存 Manifest、同目录配置镜像和已加载的导出目录信息。',
    inputSchema: z.object({ expectedDocumentPath: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ expectedDocumentPath }) => toolResult(
    await photoshopHost.inspect(expectedDocumentPath)));

  server.registerTool('psd2ui_snapshot', {
    title: '读取 PSD 图层快照',
    description: '读取指定根图层的完整确定性快照，不修改 PSD。',
    inputSchema: z.object({
      expectedDocumentPath: z.string().min(1),
      rootLayerId: z.string().min(1)
    }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ expectedDocumentPath, rootLayerId }) => toolResult(
    await photoshopHost.snapshot(expectedDocumentPath, rootLayerId)));

  server.registerTool('psd2ui_wrap_document_root', {
    title: '创建 PSD2UI 文档根组',
    description: '把调用方明确列出的全部顶层图层包入一个普通文档根组；这不是组件结构化。',
    inputSchema: z.object({
      expectedDocumentPath: z.string().min(1),
      layerIds: z.array(z.string().min(1)).min(1),
      groupName: z.string().min(1)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, async (input) => toolResult(await photoshopHost.wrapDocumentRoot(input)));

  server.registerTool('psd2ui_initialize_document', {
    title: '初始化 PSD2UI 文档',
    description: '在人工确认后，按完整图层快照和 source 命名初始化，写入 PSD XMP 与同目录配置镜像；rootLayerId 支持 document-root 虚拟根，不要求包组或改名。已有文档无需为新增配置重新初始化。',
    inputSchema: z.object({
      expectedDocumentPath: z.string().min(1),
      rootLayerId: z.string().min(1),
      module: z.string().min(1),
      submodule: z.string().min(1).optional(),
      name: z.string().min(1),
      allowReinitialize: z.boolean().optional().default(false)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, async (input) => toolResult(await photoshopHost.initialize(input)));

  server.registerTool('psd2ui_execute_authoring', {
    title: '执行 PSD2UI 图层配置命令',
    description: '执行节点预设、参数、set-visual-states、set-collection-previews、set-node-viewport 或资源命令；状态与预览基于当前 PSD 校验并保存。不开放结构化、module 修改和资源迁移；状态普通组通过已确认结构计划 containers 创建。',
    inputSchema: z.object({
      expectedDocumentPath: z.string().min(1),
      command: z.enum(AllowedAuthoringCommands),
      input: z.record(z.string(), z.unknown())
    }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async (input) => toolResult(await photoshopHost.executeAuthoring(input)));

  server.registerTool('psd2ui_apply_confirmed_structure_plan', {
    title: '应用用户确认的 PSD2UI 结构计划',
    description: '按精确 PSD 路径、图层前置条件 preconditions 与 confirmationId 执行确认计划并在失败时请求恢复；支持 containers/copies/renames/groups/moves/ungroups/deletes/adopt/presets。moves/ungroups/deletes 必须 allowAppearanceChange:true；解组和删除须列出 expectedDescendantIds。普通组返回真实 ID 可用于视觉状态。CEP 历史恢复不是原生 modal 锁，结果未知时必须查询回执、检查文档。不会开放 module、Common 或资源迁移权限。',
    inputSchema: z.object({
      expectedDocumentPath: z.string().min(1),
      confirmationId: z.string().min(1),
      confirmationText: z.literal(ConfirmedStructurePlanText),
      plan: z.object({
        version: z.literal(1),
        confirmationId: z.string().min(1)
      }).passthrough()
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
  }, async (input) => toolResult(await photoshopHost.applyConfirmedStructurePlan(input)));

  if (options.maintenance === true) {
    server.registerTool('psd2ui_apply_confirmed_preinitialize_renames', {
      title: '应用用户确认的 PSD2UI 初始化前命名',
      description: '仅在 Manifest 不存在时，按精确 PSD 路径、根图层、图层前置条件与 confirmationId 原子应用已确认重命名；不会创建组件结构或写入 Manifest。',
      inputSchema: z.object({
        expectedDocumentPath: z.string().min(1),
        rootLayerId: z.string().min(1),
        confirmationId: z.string().min(1),
        confirmationText: z.literal(ConfirmedPreinitializeRenamesText),
        repairPreservedState: z.boolean().optional().default(false),
        plan: z.object({
          version: z.literal(1),
          confirmationId: z.string().min(1)
        }).passthrough()
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    }, async (input) => toolResult(
      await photoshopHost.applyConfirmedPreinitializeRenames(input)));

    server.registerTool('psd2ui_apply_confirmed_submodule_migration', {
      title: '应用用户确认的 PSD2UI submodule 迁移',
      description: '按精确 PSD 路径、Manifest 前置条件与 confirmationId 事务迁移文档和本地活动资源命名；XMP、sidecar 或保存任一步失败都会补偿恢复。',
      inputSchema: z.object({
        expectedDocumentPath: z.string().min(1),
        confirmationId: z.string().min(1),
        confirmationText: z.literal(ConfirmedSubmoduleMigrationText),
        plan: z.object({
          version: z.literal(1),
          confirmationId: z.string().min(1),
          submodule: z.string().min(1),
          expected: z.record(z.string(), z.unknown())
        }).passthrough()
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    }, async (input) => toolResult(
      await photoshopHost.applyConfirmedSubmoduleMigration(input)));
  }

  server.registerTool('psd2ui_preflight_export', {
    title: '预检 PSD2UI 导出',
    description: '生成默认资源绑定并返回诊断和待导出资源，但不写 UIRes。',
    inputSchema: z.object({ expectedDocumentPath: z.string().min(1) }),
    annotations: { readOnlyHint: true, destructiveHint: false }
  }, async ({ expectedDocumentPath }) => toolResult(
    await photoshopHost.preflight(expectedDocumentPath)));

  server.registerTool('psd2ui_export_bundle', {
    title: '导出 PSD2UI JSON 与 PNG',
    description: '通过 Photoshop 插件将当前 PSD 导出到调用方显式提供且已授权的 UIRes。',
    inputSchema: z.object({
      expectedDocumentPath: z.string().min(1),
      uiResPath: z.string().min(1)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  }, async ({ expectedDocumentPath, uiResPath }) => toolResult(
    await photoshopHost.exportBundle(expectedDocumentPath, uiResPath)));

  return server;
}

function main(argumentsList = process.argv.slice(2)) {
  if (argumentsList.length > 1 || argumentsList.some((value) => value !== '--maintenance')) {
    throw new Error('用法：node src/server.js [--maintenance]；不接受其他启动参数。');
  }
  serveStdio(() => createPsd2UiMcpServer(null, { maintenance: argumentsList[0] === '--maintenance' }), {
    onerror: (error) => console.error(error && error.stack ? error.stack : error)
  });
}

if (require.main === module) main();

module.exports = { createPsd2UiMcpServer, main, toolResult };
