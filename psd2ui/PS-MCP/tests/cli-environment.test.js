'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('本地 MCP 客户端把显式创作目录传给 stdio 服务并继续拒绝目录外 PSD', { timeout: 15000 }, () => {
  const packageRoot = path.resolve(__dirname, '..');
  const allowedRoot = path.join(packageRoot, '.test-authoring-root');
  const rejectedFile = path.join(packageRoot, '.outside-authoring-root', 'Rejected.psd');
  const result = childProcess.spawnSync(process.execPath, [
    path.join(packageRoot, 'scripts/call-tool.js'),
    'psd2ui_open_document', JSON.stringify({ documentPath: rejectedFile })
  ], {
    cwd: packageRoot,
    env: { ...process.env, PSD2UI_AUTHORING_ROOTS: allowedRoot },
    windowsHide: true,
    encoding: 'utf8',
    timeout: 10000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须位于已授权创作目录/);
  assert.ok(result.stderr.includes(allowedRoot));
  assert.doesNotMatch(result.stderr, /尚未配置允许访问/);
  assert.doesNotMatch(result.stderr, /宿主调用失败/);
});
