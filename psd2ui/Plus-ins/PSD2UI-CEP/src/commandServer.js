'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Protocol = 1;
const PluginId = 'com.yoyoengine.psd2ui.cep';
const AllowedMethods = ['openDocument', 'inspect', 'snapshot', 'initialize', 'wrapDocumentRoot',
  'execute', 'applyConfirmedStructurePlan', 'applyConfirmedPreinitializeRenames',
  'applyConfirmedSubmoduleMigration', 'preflight', 'exportBundle'];
function mkdir(directory) {
  if (fs.existsSync(directory)) return;
  const parent = path.dirname(directory);
  if (parent !== directory) mkdir(parent);
  try { fs.mkdirSync(directory, 448); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}
function sessionsDirectory() { return path.join(os.homedir(), '.psd2ui', 'cep', 'sessions'); }
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function readBody(request) {
  return new Promise((resolve, reject) => {
    let content = '', size = 0;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 8 * 1024 * 1024) { reject(new Error('结构计划超过 8 MiB。')); request.destroy(); }
      else content += chunk;
    });
    request.on('end', () => { try { resolve(JSON.parse(content)); } catch (error) { reject(error); } });
    request.on('error', reject);
  });
}

async function startCommandServer(options) {
  const input = options || {};
  const directory = input.directory || sessionsDirectory();
  mkdir(directory);
  const instanceId = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');
  const operations = new Map();
  const journal = path.join(directory, instanceId + '.operations');
  mkdir(journal);
  const sessionPath = path.join(directory, instanceId + '.json');
  let queue = Promise.resolve();
  let closed = false;
  function persist(job) {
    const target = path.join(journal, job.id + '.json');
    const staging = target + '.tmp';
    fs.writeFileSync(staging, JSON.stringify(job), { encoding: 'utf8', mode: 384 });
    fs.renameSync(staging, target);
  }
  function publicJob(job) {
    return { id: job.id, instanceId, state: job.state, result: job.result, error: job.error };
  }
  const server = http.createServer(async (request, response) => {
    try {
      // Never expose a browser origin or a remotely reachable command evaluator.
      if (request.headers.origin || request.headers.authorization !== 'Bearer ' + token) {
        json(response, 403, { error: '本地插件连接凭据无效。' }); return;
      }
      if (request.method === 'GET' && request.url === '/status') {
        json(response, 200, { protocol: Protocol, pluginId: PluginId, pluginVersion: '0.3.8',
          transport: 'cep', instanceId, methods: AllowedMethods, ...input.status && input.status() }); return;
      }
      const match = /^\/operations\/([a-zA-Z0-9_-]{8,100})$/.exec(request.url || '');
      if (request.method === 'GET' && match) {
        const job = operations.get(match[1]);
        json(response, job ? 200 : 404, job ? publicJob(job) : { state: 'unknown', id: match[1], instanceId }); return;
      }
      if (request.method !== 'POST' || request.url !== '/invoke') {
        json(response, 404, { error: '未知命令接口。' }); return;
      }
      const body = await readBody(request);
      if (!body || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.id || '') || AllowedMethods.indexOf(body.method) < 0
          || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
        json(response, 400, { error: '无效命令、请求 ID 或参数。' }); return;
      }
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify([body.method, body.payload])).digest('hex');
      const existing = operations.get(body.id);
      if (existing) {
        json(response, existing.fingerprint === fingerprint ? 200 : 409,
          existing.fingerprint === fingerprint ? publicJob(existing) : { error: '同一请求 ID 对应了不同操作。' }); return;
      }
      if (operations.size >= 2048) { json(response, 503, { error: '本次插件会话操作记录已满，请完成当前工作后重开面板。' }); return; }
      const job = { id: body.id, fingerprint, method: body.method, state: 'queued', createdAt: Date.now() };
      persist(job);
      operations.set(body.id, job);
      queue = queue.then(async () => {
        if (closed) { job.state = 'failed'; job.error = { message: '插件已关闭，计划未执行。' }; persist(job); return; }
        job.state = 'running'; persist(job);
        try {
          const action = async () => {
            if (input.beforeInvoke) await input.beforeInvoke();
            if (typeof input.automation[body.method] !== 'function') throw new Error('此版本插件不支持命令 ' + body.method);
            return input.automation[body.method](body.payload);
          };
          job.result = await (input.run ? input.run(body.method, action) : action());
          if (input.isUncertain && input.isUncertain()) {
            const unknown = new Error('Photoshop 宿主结果未知，请检查操作回执和文档，不能重发修改。');
            unknown.code = 'CEP_HOST_RESULT_UNKNOWN';
            throw unknown;
          }
          job.state = 'succeeded';
        } catch (error) {
          job.state = input.isUncertain && input.isUncertain()
            || ['PSD2UI_RESULT_UNKNOWN', 'CEP_HOST_RESULT_UNKNOWN', 'CEP_HOST_RESPONSE_INVALID'].indexOf(error.code) >= 0 ? 'unknown' : 'failed';
          job.error = { message: error.message || String(error), code: error.code || 'PSD2UI_COMMAND_FAILED' };
          if (Array.isArray(error.issues)) job.error.issues = error.issues;
        }
        persist(job);
      }).catch(error => { console.error('PSD2UI 操作记录保存失败：', error); });
      json(response, 202, publicJob(job));
    } catch (error) { if (!response.headersSent) json(response, 500, { error: error.message || String(error) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const session = { protocol: Protocol, pluginId: PluginId, instanceId, port: server.address().port, token, pid: process.pid };
  fs.writeFileSync(sessionPath, JSON.stringify(session), { encoding: 'utf8', mode: 384 });
  return { session, journal, close() {
    closed = true;
    server.close();
    try { fs.unlinkSync(sessionPath); } catch (error) { if (error.code !== 'ENOENT') console.error(error); }
    // Retain operation receipts for diagnosis after an interrupted connection.
  } };
}
module.exports = { startCommandServer, sessionsDirectory, PluginId, Protocol, AllowedMethods };
