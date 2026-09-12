'use strict';

// Local dependency check only; does not discover or connect to Photoshop.
function checkRuntime() {
  const { Client } = require('@modelcontextprotocol/client');
  const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
  const { McpServer } = require('@modelcontextprotocol/server');
  const { z } = require('zod/v4');
  if ([Client, StdioClientTransport, McpServer, z.object].some(value => typeof value !== 'function')) {
    throw new Error('PS-MCP runtime dependencies are incomplete.');
  }
  return { node: process.versions.node, dependenciesReady: true, photoshopChecked: false };
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(checkRuntime()) + '\n'); }
  catch (error) {
    process.stdout.write(JSON.stringify({ dependenciesReady: false, error: error.message }) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { checkRuntime };
