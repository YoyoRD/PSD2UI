'use strict';

const {
  buildBundle,
  executeAuthoringCommand,
  validateManifest
} = require('../../Core');

/**
 * 创建可选自动操作者的命令服务。它不拥有第二套语义，也不能绕过人工权限。
 */
function createCommandService(storage, options) {
  if (!storage || typeof storage.readManifest !== 'function' || typeof storage.writeManifest !== 'function') {
    throw new TypeError('PS-MCP 必须提供 readManifest/writeManifest 存储适配器。');
  }

  return {
    async execute(envelope) {
      const current = await storage.readManifest();
      const result = executeAuthoringCommand(current, envelope, { actor: 'mcp' }, options);
      await storage.writeManifest(result.manifest);
      return result.value;
    },

    async preflight(snapshot) {
      const manifest = await storage.readManifest();
      const issues = validateManifest(manifest);
      if (issues.length > 0) {
        return { valid: false, issues };
      }
      return { valid: true, bundle: buildBundle(manifest, snapshot) };
    }
  };
}

module.exports = { createCommandService };
