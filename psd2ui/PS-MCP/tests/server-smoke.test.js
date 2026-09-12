'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { InMemoryTransport } = require('@modelcontextprotocol/server');
const { createPsd2UiMcpServer } = require('../src/server');
const { parseArguments } = require('../scripts/call-tool');

const DefaultTools = [
  'psd2ui_photoshop_status', 'psd2ui_open_document', 'psd2ui_inspect_document', 'psd2ui_snapshot',
  'psd2ui_wrap_document_root', 'psd2ui_initialize_document', 'psd2ui_execute_authoring',
  'psd2ui_apply_confirmed_structure_plan', 'psd2ui_preflight_export', 'psd2ui_export_bundle'
];
const MaintenanceTools = ['psd2ui_apply_confirmed_preinitialize_renames', 'psd2ui_apply_confirmed_submodule_migration'];

function maintenanceRequest(name) {
  const rename = name === MaintenanceTools[0];
  return { name, arguments: {
    expectedDocumentPath: path.resolve(__dirname, 'outside-authorized-root.psd'),
    confirmationId: 'maintenance-test',
    confirmationText: rename ? 'APPLY_CONFIRMED_PREINITIALIZE_RENAMES' : 'APPLY_CONFIRMED_SUBMODULE_MIGRATION',
    ...(rename ? { rootLayerId: 'document-root' } : {}),
    plan: { version: 1, confirmationId: 'maintenance-test', ...(rename ? {} : { submodule: 'test', expected: {} }) }
  } };
}

async function withMemoryClient(server, run) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'psd2ui-maintenance-test', version: '0.1.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test('MCP 环境检查传递严格模式，失败返回工具错误且不继续操作', { timeout: 5000 }, async () => {
  const calls = [];
  let failure = false;
  const server = createPsd2UiMcpServer({
    async status(input) {
      calls.push(input);
      if (failure) throw new Error('环境检查失败：插件会话不可用');
      return { automationAvailable: true, automationMethods: ['openDocument', 'inspect', 'snapshot'], document: null };
    }
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'psd2ui-environment-test', version: '0.1.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = { name: 'psd2ui_photoshop_status', arguments: { checkOnly: true } };
    const ready = await client.callTool(request);
    assert.notEqual(ready.isError, true);
    assert.equal(ready.structuredContent.document, null);
    failure = true;
    const failed = await client.callTool(request);
    assert.equal(failed.isError, true);
    assert.match(failed.content[0].text, /插件会话不可用/);
    assert.deepEqual(calls, [{ checkOnly: true }, { checkOnly: true }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('PS-MCP stdio 服务完成握手并公开受控工具集', { timeout: 15000 }, async () => {
  const packageRoot = path.resolve(__dirname, '..');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, 'src', 'server.js')],
    cwd: packageRoot,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'psd2ui-test-client', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name), DefaultTools);
    const authoring = result.tools.find((tool) => tool.name === 'psd2ui_execute_authoring');
    assert.ok(authoring);
    assert.match(authoring.description, /不开放结构化/);
    for (const command of ['set-visual-states', 'set-collection-previews', 'set-node-viewport']) {
      assert.ok(authoring.inputSchema.properties.command.enum.includes(command));
    }
    const confirmedPlan = result.tools.find(
      (tool) => tool.name === 'psd2ui_apply_confirmed_structure_plan');
    assert.ok(confirmedPlan);
    assert.match(confirmedPlan.description, /图层前置条件/);
  } finally {
    await client.close();
  }
});

test('默认模式不路由旧维护工具，只有 maintenance:true 才注册并调用宿主', async () => {
  for (const maintenance of [undefined, false, 'true', true]) {
    const calls = [];
    const host = {
      async applyConfirmedPreinitializeRenames(input) { calls.push(['rename', input]); return { called: 'rename' }; },
      async applyConfirmedSubmoduleMigration(input) { calls.push(['migration', input]); return { called: 'migration' }; }
    };
    await withMemoryClient(createPsd2UiMcpServer(host, { maintenance }), async (client) => {
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      assert.equal(tools.length, maintenance === true ? 12 : 10);
      for (const name of MaintenanceTools) {
        if (maintenance === true) {
          const result = await client.callTool(maintenanceRequest(name));
          assert.notEqual(result.isError, true);
          assert.ok(result.structuredContent.called);
        } else {
          await assert.rejects(client.callTool(maintenanceRequest(name)), /not found|Unknown tool/i);
        }
      }
      assert.equal(calls.length, maintenance === true ? 2 : 0);
    });
  }
});

test('显式 --maintenance stdio 服务公开两项维护工具并路由到宿主路径校验', { timeout: 15000 }, async () => {
  const packageRoot = path.resolve(__dirname, '..');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(packageRoot, 'src', 'server.js'), '--maintenance'], cwd: packageRoot, stderr: 'pipe',
    env: { PSD2UI_AUTHORING_ROOTS: path.join(packageRoot, 'authorized-test-only') }
  });
  const client = new Client({ name: 'psd2ui-maintenance-stdio-test', version: '0.1.0' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((tool) => tool.name), [...DefaultTools.slice(0, 8), ...MaintenanceTools, ...DefaultTools.slice(8)]);
    assert.match(tools.find((tool) => tool.name === MaintenanceTools[0]).description, /Manifest 不存在/);
    assert.match(tools.find((tool) => tool.name === MaintenanceTools[1]).description, /补偿恢复/);
    for (const name of MaintenanceTools) {
      const result = await client.callTool(maintenanceRequest(name));
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /已授权创作目录/);
    }
  } finally {
    await client.close();
  }
});

test('本地 CLI 仅接受末尾显式维护开关，不根据工具名或环境变量自动开启', { timeout: 20000 }, () => {
  assert.deepEqual(parseArguments(['tool']), { toolName: 'tool', argumentsValue: {}, maintenance: false });
  assert.deepEqual(parseArguments(['tool', '--maintenance']), { toolName: 'tool', argumentsValue: {}, maintenance: true });
  assert.deepEqual(parseArguments(['tool', '{"key":1}', '--maintenance']), { toolName: 'tool', argumentsValue: { key: 1 }, maintenance: true });
  assert.deepEqual(parseArguments(['tool', `base64:${Buffer.from('{"key":1}').toString('base64')}`]),
    { toolName: 'tool', argumentsValue: { key: 1 }, maintenance: false });
  for (const value of ['null', '[]', 'true', '1', '"text"']) {
    assert.throws(() => parseArguments(['tool', value]), /顶层必须是 JSON 对象/);
  }
  for (const argumentsList of [[], ['--maintenance'], ['tool', '--unknown'], ['tool', '{}', '--unknown'],
    ['tool', '--maintenance', '{}'], ['tool', '{}', '--maintenance', '--maintenance']]) {
    assert.throws(() => parseArguments(argumentsList), /用法/);
  }
  const script = path.resolve(__dirname, '../scripts/call-tool.js');
  for (const name of MaintenanceTools) {
    const args = [script, name, JSON.stringify(maintenanceRequest(name).arguments)];
    const options = { encoding: 'utf8', timeout: 8000, windowsHide: true, env: { ...process.env,
      PSD2UI_AUTHORING_ROOTS: path.resolve(__dirname, '../authorized-test-only'), PSD2UI_MAINTENANCE: 'true'
    } };
    const normal = spawnSync(process.execPath, args, options);
    assert.equal(normal.status, 1, normal.stderr);
    assert.match(normal.stderr, /not found|Unknown tool/i);
    const maintenance = spawnSync(process.execPath, [...args, '--maintenance'], options);
    assert.equal(maintenance.status, 1, maintenance.stderr);
    assert.match(maintenance.stderr, /已授权创作目录/);
  }
  const server = path.resolve(__dirname, '../src/server.js');
  const unknown = spawnSync(process.execPath, [server, '--unknown'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /不接受其他启动参数/);
});
