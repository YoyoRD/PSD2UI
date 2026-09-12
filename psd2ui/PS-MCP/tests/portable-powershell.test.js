'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const windows = process.platform === 'win32';
const sourceRoot = path.resolve(__dirname, '../..');
const ps = windows ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : '';
const quote = value => "'" + value.replace(/'/g, "''") + "'";

function fixture(t) {
  const prefix = path.join(os.tmpdir(), 'psd2ui-ps51-艺术 [目录] ');
  const root = fs.mkdtempSync(prefix);
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const scripts = path.join(root, 'scripts'), mcp = path.join(root, 'PS-MCP'), bin = path.join(root, 'bin');
  for (const dir of [scripts, path.join(mcp, 'scripts'), bin]) fs.mkdirSync(dir, { recursive: true });
  for (const name of ['Invoke-Psd2UiPortable.ps1', 'Invoke-Psd2UiMcpTool.ps1']) {
    fs.copyFileSync(path.join(sourceRoot, 'scripts', name), path.join(scripts, name));
  }
  fs.writeFileSync(path.join(mcp, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(mcp, 'scripts/call-tool.js'), `
    const fs = require('node:fs'), path = require('node:path');
    const root = path.resolve(__dirname, '..');
    fs.appendFileSync(path.join(root, 'calls'), 'call\\n');
    if (process.argv[2] === 'reject') process.exit(7);
    const value = { toolName: process.argv[2], payload: JSON.parse(Buffer.from(process.argv[3].slice(7), 'base64').toString('utf8')),
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PSD2UI_|YOYO_PSD2UI_)/.test(key))), text: '中文返回 🦆' };
    fs.writeFileSync(path.join(root, 'capture.json'), JSON.stringify(value));
    console.log(JSON.stringify(value));
  `);
  fs.writeFileSync(path.join(mcp, 'scripts/check-runtime.js'), `
    const ready = require('node:fs').existsSync(require('node:path').resolve(__dirname, '../installed'));
    console.log(JSON.stringify({ dependenciesReady: ready })); process.exitCode = ready ? 0 : 1;
  `);
  fs.writeFileSync(path.join(bin, 'npm.cmd'), '@echo off\r\nnode "%~dp0npm-stub.js" %*\r\nexit /b %ERRORLEVEL%\r\n');
  fs.writeFileSync(path.join(bin, 'npm-stub.js'), `
    const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
    assert.deepEqual(process.argv.slice(2), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
    fs.appendFileSync(path.join(process.cwd(), 'npm-calls'), 'install\\n');
    for (const name of ['server', 'client']) fs.mkdirSync(path.join(process.cwd(), 'node_modules/@modelcontextprotocol', name), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'installed'), 'ready');
  `);
  return { root, mcp, bin, entry: path.join(scripts, 'Invoke-Psd2UiPortable.ps1'), dependencies() {
    for (const name of ['server', 'client']) fs.mkdirSync(path.join(mcp, 'node_modules/@modelcontextprotocol', name), { recursive: true });
  } };
}

function run(f, script) {
  const encoded = Buffer.from("$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n" + script, 'utf16le').toString('base64');
  const result = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, PATH: f.bin + path.delimiter + process.env.PATH }
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

test('Windows PowerShell 5.1 preserves nested Unicode payloads and isolates/restores task environment', { skip: !windows }, t => {
  const f = fixture(t); f.dependencies();
  const payload = { expectedDocumentPath: path.join(f.root, '魂骨.psd'), input: { text: '引号" 换行\n反斜杠\\ 🦆', flag: false, values: [0, null, 0.9960600137710571] } };
  let child = payload.input;
  for (let i = 0; i < 30; i++) child = child.nested = { value: i };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64');
  const output = run(f, `
    $env:PSD2UI_TOOL_ROOT = 'foreign-tool'
    $env:PSD2UI_HOST = 'uxp'
    $env:YOYO_PSD2UI_OLD = 'foreign-config'
    $taskPayload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${raw}'))
    $taskResult = & ${quote(f.entry)} -Operation Call -AuthoringRoot ${quote(f.root)} -ToolName sample -PayloadJson $taskPayload | ConvertFrom-Json
    if ($env:PSD2UI_TOOL_ROOT -ne 'foreign-tool' -or $env:PSD2UI_HOST -ne 'uxp' -or $env:YOYO_PSD2UI_OLD -ne 'foreign-config') { throw 'Environment not restored' }
    if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Not Windows PowerShell 5.1' }
    $taskResult | ConvertTo-Json -Depth 100 -Compress
  `);
  const result = JSON.parse(output);
  assert.equal(result.text, '中文返回 🦆');
  assert.deepEqual(result.payload, payload);
  assert.equal(result.env.PSD2UI_HOST, 'cep');
  assert.equal(result.env.PSD2UI_TOOL_ROOT, f.root);
  assert.equal(result.env.YOYO_PSD2UI_OLD, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.mcp, 'capture.json'), 'utf8')).payload, payload);
});

test('Windows PowerShell 5.1 rejects ambiguous roots and restores configuration on child failure', { skip: !windows }, t => {
  const f = fixture(t); f.dependencies();
  run(f, `
    $env:PSD2UI_TOOL_ROOT = 'keep-original'
    foreach ($taskRoot in @('relative/path', 'C:relative', '${String.fromCharCode(92)}current-drive')) {
      $taskFailed = $false
      try { & ${quote(f.entry)} -Operation Call -AuthoringRoot $taskRoot -ToolName sample } catch { $taskFailed = $true }
      if (-not $taskFailed) { throw 'An ambiguous path was accepted' }
    }
    $taskFailed = $false
    try { & ${quote(f.entry)} -Operation Call -AuthoringRoot ${quote(f.root)} -ToolName reject } catch { $taskFailed = $true }
    if (-not $taskFailed -or $env:PSD2UI_TOOL_ROOT -ne 'keep-original') { throw 'Child failure was hidden or environment leaked' }
  `);
  assert.equal(fs.readFileSync(path.join(f.mcp, 'calls'), 'utf8'), 'call\n');
});

test('only explicit Prepare repairs dependencies; Check stays read-only and healthy Prepare works offline', { skip: !windows }, t => {
  const f = fixture(t);
  run(f, `
    $taskFailed = $false
    try { & ${quote(f.entry)} -Operation Check } catch { $taskFailed = $true }
    if (-not $taskFailed) { throw 'Incomplete environment passed Check' }
    if (Test-Path -LiteralPath ${quote(path.join(f.mcp, 'npm-calls'))}) { throw 'Check installed dependencies' }
    & ${quote(f.entry)} -Operation Prepare | Out-Null
    & ${quote(f.entry)} -Operation Prepare | Out-Null
  `);
  assert.equal(fs.readFileSync(path.join(f.mcp, 'npm-calls'), 'utf8'), 'install\n');
  assert.equal(fs.existsSync(path.join(f.mcp, 'calls')), false, 'Prepare must not contact Photoshop');
});
