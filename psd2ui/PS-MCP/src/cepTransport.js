'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const PluginId = 'com.yoyoengine.psd2ui.cep';
function sessionsDirectory(options) {
  return path.resolve(options.sessionDirectory || process.env.PSD2UI_CEP_SESSION_DIR || path.join(os.homedir(), '.psd2ui', 'cep', 'sessions'));
}
function request(session, method, route, body, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const serialized = body == null ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: session.port, method, path: route,
      headers: { Authorization: `Bearer ${session.token}`, ...(serialized ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) } : {}) } }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 64 * 1024 * 1024) req.destroy(new Error('CEP 响应超过 64 MiB。')); else chunks.push(chunk); });
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode >= 400 && response.statusCode !== 404) throw new Error(value.error || `CEP HTTP ${response.statusCode}`);
          resolve(value);
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('CEP 本地连接超时。')));
    req.on('error', reject);
    req.end(serialized);
  });
}
async function discover(options = {}) {
  const directory = sessionsDirectory(options);
  let files;
  try { files = await fs.readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
  const requested = options.instanceId || process.env.PSD2UI_CEP_INSTANCE_ID;
  const matches = [];
  for (const file of files.filter(name => /^[a-f0-9]{32}\.json$/.test(name))) {
    if (requested && file !== requested + '.json') continue;
    try {
      const session = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
      if (session.protocol !== 1 || session.pluginId !== PluginId || session.instanceId + '.json' !== file
          || !Number.isInteger(session.port) || session.port < 1 || session.port > 65535
          || !/^[a-f0-9]{64}$/.test(session.token || '')) continue;
      const status = await request(session, 'GET', '/status', null, 1200);
      if (status.protocol === 1 && status.pluginId === PluginId && status.instanceId === session.instanceId) matches.push({ session, status });
    } catch (_) { /* Stale discovery files do not authorize starting a host. */ }
  }
  if (!matches.length) throw new Error('未连接 PSD2UI CEP 面板。请在 Photoshop 的“窗口 → 扩展功能”打开 PSD2UI；检查不会启动 Photoshop、安装或重载插件。');
  if (matches.length > 1) throw new Error('发现多个 PSD2UI CEP 实例，请通过 PSD2UI_CEP_INSTANCE_ID 指定目标：' + matches.map(match => match.session.instanceId).join(', '));
  return matches[0];
}
function uncertain(session, id, reason) {
  const error = new Error(`CEP 操作结果尚未确认：${reason}。不要重复提交修改。请调用 psd2ui_photoshop_status 查询 requestId="${id}"、instanceId="${session.instanceId}"。`);
  error.code = 'PSD2UI_RESULT_UNKNOWN'; error.requestId = id; error.instanceId = session.instanceId;
  return error;
}
async function queryOperation(options) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(options.requestId || '') || !/^[a-f0-9]{32}$/.test(options.instanceId || '')) throw new Error('查询操作必须提供有效的 requestId 和 instanceId。');
  try {
    const { session } = await discover(options);
    return await request(session, 'GET', '/operations/' + options.requestId);
  } catch (connectionError) {
    // A journal confirms completed work; an interrupted queued/running receipt
    // never authorizes replay after the Photoshop/CEP process has disappeared.
    try {
      const receipt = JSON.parse(await fs.readFile(path.join(sessionsDirectory(options), options.instanceId + '.operations', options.requestId + '.json'), 'utf8'));
      return { id: receipt.id, instanceId: options.instanceId,
        state: ['succeeded', 'failed'].includes(receipt.state) ? receipt.state : 'unknown', result: receipt.result, error: receipt.error };
    } catch (_) { throw uncertain({ instanceId: options.instanceId }, options.requestId, connectionError.message); }
  }
}
async function invokeCepRunner(options = {}) {
  if (options.requestId && options.operation === 'status') return queryOperation(options);
  const { session, status } = await discover(options);
  if (options.operation === 'status') return { ...status, connected: true, ready: true };
  if (!status.methods.includes(options.method)) throw new Error('CEP 插件未实现命令：' + options.method);
  const id = options.requestId || crypto.randomUUID();
  const deadline = Date.now() + (options.timeoutMilliseconds || 600000);
  let result;
  try { result = await request(session, 'POST', '/invoke', { id, method: options.method, payload: options.payload || {} }); }
  catch (error) { throw uncertain(session, id, error.message); }
  while (result.state === 'queued' || result.state === 'running') {
    if (Date.now() >= deadline) throw uncertain(session, id, '等待超时，Photoshop 可能仍在执行');
    await new Promise(resolve => setTimeout(resolve, 200));
    try { result = await request(session, 'GET', '/operations/' + id); }
    catch (error) { throw uncertain(session, id, error.message); }
  }
  if (result.state === 'succeeded') return result.result;
  if (result.state === 'unknown') throw uncertain(session, id, result.error && result.error.message || '宿主状态未知');
  const issues = result.error && Array.isArray(result.error.issues) ? result.error.issues : [];
  const details = issues.map(issue => `${issue.code || ''}${issue.nodeId ? ' [' + issue.nodeId + ']' : ''}: ${issue.message || ''}`).join('\n');
  const error = new Error((result.error && result.error.message || 'CEP 操作失败。') + (details ? '\n' + details : ''));
  error.code = result.error && result.error.code || 'PSD2UI_COMMAND_FAILED';
  error.issues = issues;
  throw error;
}
module.exports = { invokeCepRunner, discover, request, queryOperation, sessionsDirectory };
