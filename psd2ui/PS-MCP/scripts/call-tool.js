'use strict';

const path = require('node:path');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');

function parseArguments(argumentsList) {
  const values = argumentsList.slice();
  const maintenance = values[values.length - 1] === '--maintenance';
  if (maintenance) values.pop();
  const toolName = String(values[0] || '').trim();
  if (!toolName || toolName.startsWith('--') || values.length > 2
      || (values[1] && values[1].startsWith('--'))) {
    throw new Error('用法：node scripts/call-tool.js <tool-name> [arguments-json] [--maintenance]；不接受未知或重复参数。');
  }
  let argumentsValue = {};
  if (values[1]) {
    const rawArguments = values[1].startsWith('base64:')
      ? Buffer.from(values[1].slice('base64:'.length), 'base64').toString('utf8')
      : values[1];
    argumentsValue = JSON.parse(rawArguments);
  }
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    throw new Error('工具参数顶层必须是 JSON 对象。');
  }
  return { toolName, argumentsValue, maintenance };
}

async function main(argumentsList = process.argv.slice(2)) {
  const { toolName, argumentsValue, maintenance } = parseArguments(argumentsList);
  const packageRoot = path.resolve(__dirname, '..');
  // The SDK's default subprocess environment only includes a small OS allowlist.
  // Forward our explicit host configuration without widening the PSD/UIRes permissions.
  const hostEnvironment = Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) => /^PSD2UI_/.test(key) && value != null));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, 'src', 'server.js'), ...(maintenance ? ['--maintenance'] : [])],
    cwd: packageRoot,
    env: hostEnvironment,
    stderr: 'inherit'
  });
  const client = new Client({ name: 'psd2ui-local-client', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool(
      { name: toolName, arguments: argumentsValue },
      { timeout: 900000 });
    if (result.isError) {
      const message = (result.content || [])
        .filter((entry) => entry.type === 'text')
        .map((entry) => entry.text)
        .join('\n');
      throw new Error(message || `MCP 工具 ${toolName} 执行失败。`);
    }
    process.stdout.write(`${JSON.stringify(result.structuredContent || result, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, main };
