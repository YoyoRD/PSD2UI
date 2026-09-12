'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { invokeCepRunner } = require('./cepTransport');

const AllowedAuthoringCommands = Object.freeze([
  'apply-node-preset',
  'update-node-parameters',
  'set-visual-states',
  'set-collection-previews',
  'set-node-viewport',
  'allocate-resource',
  'reuse-resource',
  'retire-resource'
]);
const ConfirmedStructurePlanText = 'APPLY_CONFIRMED_STRUCTURE_PLAN';
const ConfirmedPreinitializeRenamesText = 'APPLY_CONFIRMED_PREINITIALIZE_RENAMES';
const ConfirmedSubmoduleMigrationText = 'APPLY_CONFIRMED_SUBMODULE_MIGRATION';

function normalizePath(value) {
  return path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();
}

function assertPathInside(candidate, parent, label) {
  const actual = normalizePath(candidate);
  const root = normalizePath(parent);
  if (actual !== root && !actual.startsWith(`${root}/`)) {
    throw new Error(`${label} 必须位于 ${parent} 内，实际为 ${candidate || '<empty>'}。`);
  }
  return path.resolve(candidate);
}

function normalizeRoots(values) {
  const source = Array.isArray(values) ? values : [values];
  return source
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
}

function assertDocumentPath(documentPath, authoringRoots) {
  const roots = normalizeRoots(authoringRoots);
  if (roots.length === 0) {
    throw new Error('PS-MCP 尚未配置允许访问的 PSD 创作目录。');
  }
  const resolved = path.resolve(documentPath);
  const allowed = roots.some((root) => {
    const actual = normalizePath(resolved);
    const normalizedRoot = normalizePath(root);
    return actual === normalizedRoot || actual.startsWith(`${normalizedRoot}/`);
  });
  if (!allowed) {
    throw new Error(
      `PSD 路径必须位于已授权创作目录内：${roots.join('; ')}；实际为 ${documentPath || '<empty>'}。`);
  }
  if (path.extname(resolved).toLowerCase() !== '.psd') {
    throw new Error(`PSD2UI 只允许操作 .psd 文档：${resolved}`);
  }
  return resolved;
}

function assertUiResPath(uiResPath, expectedUiResPath) {
  if (!String(uiResPath || '').trim()) {
    throw new Error('PS-MCP 导出必须显式提供已授权的 UIRes 路径。');
  }
  const resolved = path.resolve(uiResPath);
  if (String(expectedUiResPath || '').trim()
      && normalizePath(resolved) !== normalizePath(expectedUiResPath)) {
    throw new Error(`导出目录必须匹配已配置的 UIRes：${expectedUiResPath}`);
  }
  return resolved;
}

function invokeUdtRunner(options) {
  const operation = options.operation || 'status';
  const timeoutMilliseconds = Number(options.timeoutMilliseconds || 600000);
  const processTimeoutMilliseconds = timeoutMilliseconds + (options.checkOnly === true ? 1000 : 30000);
  const argumentsList = [
    options.runnerPath,
    '--operation', operation,
    '--manifest', options.manifestPath,
    '--udt-root', options.udtRoot,
    '--service-port', String(options.servicePort || 14001),
    '--timeout-ms', String(timeoutMilliseconds)
  ];
  if (options.checkOnly === true) argumentsList.push('--check-only', 'true');
  if (operation === 'invoke') {
    argumentsList.push('--method', options.method);
    argumentsList.push(
      '--payload-base64',
      Buffer.from(JSON.stringify(options.payload || {}), 'utf8').toString('base64'));
  }

  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(options.udtExecutable, argumentsList, {
      cwd: options.workingDirectory,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    const processTimeout = setTimeout(() => {
      child.kill();
      reject(new Error(`连接 Photoshop 的 UDT 子进程超时（${processTimeoutMilliseconds} ms）。`));
    }, processTimeoutMilliseconds);
    child.once('close', (exitCode) => {
      clearTimeout(processTimeout);
      const output = Buffer.concat(stdout).toString('utf8').trim();
      const diagnostics = Buffer.concat(stderr).toString('utf8').trim();
      if (exitCode !== 0) {
        reject(new Error(
          `PSD2UI Photoshop 宿主调用失败（exit=${exitCode}）。`
          + (diagnostics ? `\n${diagnostics}` : '')));
        return;
      }
      try {
        const response = JSON.parse(output);
        if (!response || response.success !== true) {
          throw new Error('UXP runner 没有返回成功结果。');
        }
        resolve(response.value);
      } catch (error) {
        reject(new Error(
          `无法解析 PSD2UI Photoshop 宿主结果：${error.message}`
          + (output ? `\nstdout: ${output}` : '')
          + (diagnostics ? `\nstderr: ${diagnostics}` : '')));
      }
    });
  });
}

function createPhotoshopHost(options) {
  const configuration = options || {};
  const toolRoot = path.resolve(
    configuration.toolRoot
    || process.env.PSD2UI_TOOL_ROOT
    || path.resolve(__dirname, '../..'));
  const configuredAuthoringRoots = configuration.authoringRoots
    || configuration.artSourceRoot
    || process.env.PSD2UI_AUTHORING_ROOTS
    || [];
  const authoringRoots = normalizeRoots(
    typeof configuredAuthoringRoots === 'string'
      ? configuredAuthoringRoots.split(path.delimiter)
      : configuredAuthoringRoots);
  const uiResPath = String(
    configuration.uiResPath
    || process.env.PSD2UI_UIRES_PATH
    || '').trim();
  const systemDrive = String(process.env.SystemDrive || '').trim();
  const systemRoot = systemDrive ? path.resolve(`${systemDrive}${path.sep}`) : path.parse(process.execPath).root;
  const programFiles = String(process.env.ProgramFiles || '').trim() || path.join(systemRoot, 'Program Files');
  const udtRoot = path.resolve(
    configuration.udtRoot
    || process.env.PSD2UI_UDT_ROOT
    || path.join(programFiles, 'Adobe', 'Adobe UXP Developer Tools'));
  const transport = configuration.transport || process.env.PSD2UI_HOST || 'cep';
  if (!['cep', 'uxp'].includes(transport)) throw new Error('PSD2UI_HOST 只能为 cep 或 uxp。');
  const runner = configuration.runner || (transport === 'cep' ? invokeCepRunner : invokeUdtRunner);
  const runnerOptions = {
    transport,
    sessionDirectory: configuration.sessionDirectory,
    instanceId: configuration.instanceId,
    workingDirectory: configuration.workingDirectory || toolRoot,
    runnerPath: configuration.runnerPath || path.join(toolRoot, 'scripts', 'uxp-devtools-runner.js'),
    manifestPath: configuration.manifestPath || path.join(toolRoot, 'Plus-ins', 'PSD2UI', 'manifest.json'),
    udtRoot,
    udtExecutable: configuration.udtExecutable || path.join(udtRoot, 'Adobe UXP Developer Tools.exe'),
    servicePort: Number(
      configuration.servicePort
      || process.env.PSD2UI_UDT_PORT
      || 14001),
    timeoutMilliseconds: Number(configuration.timeoutMilliseconds || 600000)
  };

  const invoke = (method, payload) => runner({
    ...runnerOptions,
    operation: 'invoke',
    method,
    payload
  });

  return Object.freeze({
    toolRoot,
    authoringRoots: [...authoringRoots],
    uiResPath: uiResPath || null,

    status(input = {}) {
      const checkOnly = input.checkOnly === true;
      return runner({
        ...runnerOptions,
        operation: 'status',
        checkOnly,
        ...(input.requestId ? { requestId: input.requestId, instanceId: input.instanceId } : {}),
        timeoutMilliseconds: checkOnly
          ? Math.min(runnerOptions.timeoutMilliseconds, 15000)
          : runnerOptions.timeoutMilliseconds
      });
    },

    openDocument(documentPath) {
      const target = assertDocumentPath(documentPath, authoringRoots);
      return invoke('openDocument', { documentPath: target });
    },

    inspect(expectedDocumentPath) {
      const target = assertDocumentPath(expectedDocumentPath, authoringRoots);
      return invoke('inspect', { expectedDocumentPath: target });
    },

    wrapDocumentRoot(input) {
      const target = assertDocumentPath(input.expectedDocumentPath, authoringRoots);
      const layerIds = Array.isArray(input.layerIds)
        ? input.layerIds.map((layerId) => String(layerId))
        : [];
      if (layerIds.length === 0) throw new Error('创建文档根组时必须提供 layerIds。');
      if (!String(input.groupName || '').trim()) throw new Error('创建文档根组时必须提供 groupName。');
      return invoke('wrapDocumentRoot', {
        expectedDocumentPath: target,
        layerIds,
        groupName: String(input.groupName).trim()
      });
    },

    snapshot(expectedDocumentPath, rootLayerId) {
      const target = assertDocumentPath(expectedDocumentPath, authoringRoots);
      return invoke('snapshot', { expectedDocumentPath: target, rootLayerId: String(rootLayerId) });
    },

    initialize(input) {
      const target = assertDocumentPath(input.expectedDocumentPath, authoringRoots);
      return invoke('initialize', {
        expectedDocumentPath: target,
        rootLayerId: String(input.rootLayerId),
        module: input.module,
        submodule: input.submodule,
        name: input.name,
        allowReinitialize: input.allowReinitialize === true
      });
    },

    executeAuthoring(input) {
      const target = assertDocumentPath(input.expectedDocumentPath, authoringRoots);
      if (!AllowedAuthoringCommands.includes(input.command)) {
        throw new Error(
          `PS-MCP 不开放 Authoring Command '${input.command}'。`
          + '已确认的结构调整请使用 psd2ui_apply_confirmed_structure_plan；'
          + '此配置入口不提供 module 修改、Common 提升或资源迁移。');
      }
      return invoke('execute', {
        expectedDocumentPath: target,
        command: input.command,
        input: input.input || {}
      });
    },

    applyConfirmedStructurePlan(input) {
      const target = assertDocumentPath(input.expectedDocumentPath, authoringRoots);
      const plan = input.plan;
      const confirmationId = String(input.confirmationId || '').trim();
      if (!plan || plan.version !== 1 || typeof plan !== 'object') {
        throw new Error('已确认结构计划必须是 version=1 的对象。');
      }
      if (!confirmationId || confirmationId !== String(plan.confirmationId || '').trim()) {
        throw new Error('结构计划 confirmationId 与调用确认不一致。');
      }
      if (input.confirmationText !== ConfirmedStructurePlanText) {
        throw new Error('应用结构计划前必须提供明确的用户确认标记。');
      }
      return invoke('applyConfirmedStructurePlan', {
        expectedDocumentPath: target,
        confirmationId,
        confirmationText: ConfirmedStructurePlanText,
        plan
      });
    },

    applyConfirmedPreinitializeRenames(input) {
      const target = assertDocumentPath(input.expectedDocumentPath, authoringRoots);
      const plan = input.plan;
      const confirmationId = String(input.confirmationId || '').trim();
      const rootLayerId = String(input.rootLayerId || '').trim();
      if (!plan || plan.version !== 1 || typeof plan !== 'object') {
        throw new Error('初始化前重命名计划必须是 version=1 的对象。');
      }
      if (!confirmationId || confirmationId !== String(plan.confirmationId || '').trim()) {
        throw new Error('初始化前重命名计划 confirmationId 与调用确认不一致。');
      }
      if (!rootLayerId) throw new Error('初始化前重命名必须提供 rootLayerId。');
      if (input.confirmationText !== ConfirmedPreinitializeRenamesText) {
        throw new Error('初始化前重命名前必须提供明确的用户确认标记。');
      }
      return invoke('applyConfirmedPreinitializeRenames', {
        expectedDocumentPath: target,
        rootLayerId,
        confirmationId,
        confirmationText: ConfirmedPreinitializeRenamesText,
        repairPreservedState: input.repairPreservedState === true,
        plan
      });
    },

    applyConfirmedSubmoduleMigration(input) {
      const target = assertDocumentPath(input.expectedDocumentPath, authoringRoots);
      const plan = input.plan;
      const confirmationId = String(input.confirmationId || '').trim();
      if (!plan || plan.version !== 1 || typeof plan !== 'object') {
        throw new Error('submodule 迁移计划必须是 version=1 的对象。');
      }
      if (!confirmationId || confirmationId !== String(plan.confirmationId || '').trim()) {
        throw new Error('submodule 迁移计划 confirmationId 与调用确认不一致。');
      }
      if (!String(plan.submodule || '').trim() || !plan.expected) {
        throw new Error('submodule 迁移计划必须提供目标 submodule 和 expected 前置条件。');
      }
      if (input.confirmationText !== ConfirmedSubmoduleMigrationText) {
        throw new Error('应用 submodule 迁移前必须提供明确的用户确认标记。');
      }
      return invoke('applyConfirmedSubmoduleMigration', {
        expectedDocumentPath: target,
        confirmationId,
        confirmationText: ConfirmedSubmoduleMigrationText,
        plan
      });
    },

    preflight(expectedDocumentPath) {
      const target = assertDocumentPath(expectedDocumentPath, authoringRoots);
      return invoke('preflight', { expectedDocumentPath: target });
    },

    exportBundle(expectedDocumentPath, requestedUiResPath) {
      const target = assertDocumentPath(expectedDocumentPath, authoringRoots);
      const output = assertUiResPath(requestedUiResPath || uiResPath, uiResPath);
      return invoke('exportBundle', {
        expectedDocumentPath: target,
        uiResPath: output
      });
    }
  });
}

module.exports = {
  AllowedAuthoringCommands,
  ConfirmedPreinitializeRenamesText,
  ConfirmedStructurePlanText,
  ConfirmedSubmoduleMigrationText,
  assertDocumentPath,
  assertUiResPath,
  createPhotoshopHost,
  invokeUdtRunner
};
