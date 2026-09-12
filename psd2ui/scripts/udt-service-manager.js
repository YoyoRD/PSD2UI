'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function probeService(port, timeoutMilliseconds = 750) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/json/version' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) request.destroy(new Error('服务探测响应过大。'));
      });
      response.on('end', () => {
        try {
          const value = JSON.parse(body);
          if (response.statusCode !== 200 || !/^Adobe UXP\//.test(String(value.Browser || ''))) {
            throw new Error('不是 Adobe UXP 服务');
          }
          resolve({ port, browser: value.Browser });
        } catch (error) {
          reject(new Error(`端口 ${port} 已被非 UDT 服务占用：${error.message}`));
        }
      });
      response.on('error', reject);
    });
    request.setTimeout(timeoutMilliseconds, () => {
      request.destroy(new Error(`UDT 服务端口 ${port} 在 ${timeoutMilliseconds} ms 内没有响应。`));
    });
    request.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(null);
      else reject(error);
    });
  });
}

function readLogTail(logPath) {
  try { return fs.readFileSync(logPath, 'utf8').slice(-6000).trim(); }
  catch (error) { return ''; }
}

async function ensureService(options, dependencies = {}) {
  const probe = dependencies.probe || probeService;
  const spawn = dependencies.spawn || childProcess.spawn;
  const sleep = dependencies.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now || Date.now;
  const port = options.port;
  const existing = await probe(port);
  if (existing) return { ...existing, started: false };
  if (options.autoStart === false) {
    throw new Error(`UDT 服务未运行（127.0.0.1:${port}），后台自动启动已禁用。`);
  }

  const timeoutMilliseconds = options.timeoutMilliseconds || 20000;
  const logPath = path.join(options.logDirectory || os.tmpdir(),
    `psd2ui-udt-${port}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`);
  const logFile = fs.openSync(logPath, 'a');
  let child;
  try {
    child = spawn(options.executable, [
      options.workerPath || path.join(__dirname, 'udt-background-service.js'),
      '--udt-root', options.udtRoot,
      '--port', String(port),
      '--idle-ms', String(options.idleMilliseconds || 900000)
    ], {
      cwd: __dirname,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'ignore', logFile]
    });
  } finally {
    fs.closeSync(logFile);
  }

  let exit = null;
  let spawnError = null;
  child.once('error', (error) => { spawnError = error; });
  child.once('exit', (code, signal) => { exit = { code, signal }; });
  const deadline = now() + timeoutMilliseconds;
  let ready = false;
  try {
    while (now() < deadline) {
      // Another concurrent runner may win the bind; the losing worker exits on EADDRINUSE.
      const service = await probe(port);
      if (service) {
        ready = true;
        child.unref();
        return { ...service, started: true, startupProcessId: child.pid, logPath };
      }
      if (spawnError || exit) {
        throw new Error(spawnError ? spawnError.message
          : `后台服务退出（code=${exit.code}, signal=${exit.signal || 'none'}）。`);
      }
      await sleep(100);
    }
    throw new Error(`后台服务启动超时（${timeoutMilliseconds} ms）。`);
  } catch (error) {
    const log = readLogTail(logPath);
    throw new Error(`无法启动 UDT 后台服务：${error.message}`
      + (log ? `\n${log}` : '') + `\n诊断日志：${logPath}`);
  } finally {
    // Never terminate an existing UDT service or Photoshop by process name.
    if (!ready && exit === null && !spawnError) child.kill();
  }
}

async function waitForPhotoshop(manager, timeoutMilliseconds, dependencies = {}) {
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMilliseconds;
  do {
    const apps = manager.getConnectedApps();
    if (apps.some((app) => app.id === 'PS')) return;
    if (now() >= deadline) break;
    await sleep(Math.min(200, Math.max(1, deadline - now())));
  } while (now() <= deadline);
  throw new Error(`UDT 后台服务已就绪，但 Photoshop 在 ${timeoutMilliseconds} ms 内尚未连接。`
    + '请保持 Photoshop 运行后重试；工具不会启动前台应用。');
}

module.exports = { ensureService, probeService, waitForPhotoshop };
