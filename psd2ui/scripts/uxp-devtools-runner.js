'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureService, waitForPhotoshop } = require('./udt-service-manager');

function withTimeout(action, milliseconds, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(action),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${milliseconds} ms）。`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) throw new Error(`无法识别参数：${key}`);
    const value = values[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`参数 ${key} 缺少值。`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function requireValue(options, name) {
  const value = String(options[name] || '').trim();
  if (!value) throw new Error(`缺少 --${name}。`);
  return value;
}

function readCheckOnlyOption(options, operation) {
  const value = options['check-only'];
  if (value != null && value !== 'true' && value !== 'false') {
    throw new Error('--check-only 只接受 true 或 false。');
  }
  const checkOnly = value === 'true';
  if (checkOnly && operation !== 'status') {
    throw new Error('--check-only true 只允许 operation=status。');
  }
  return checkOnly;
}

function normalizeDebugUrl(value) {
  const raw = String(value || '').trim().replace(/^ws=/, '');
  if (!raw) throw new Error('UXP Developer Tool 没有返回插件调试地址。');
  return /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`;
}

function collectPluginFiles(directory, root, output) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collectPluginFiles(fullPath, root, output);
      return;
    }
    if (!entry.isFile()) return;
    const stats = fs.statSync(fullPath);
    output.push([
      path.relative(root, fullPath).replace(/\\/g, '/'),
      stats.size,
      Math.floor(stats.mtimeMs)
    ].join(':'));
  });
}

function pluginFingerprint(manifestPath) {
  const pluginRoot = path.dirname(manifestPath);
  const entries = [];
  collectPluginFiles(pluginRoot, pluginRoot, entries);
  return crypto.createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}

function defaultSessionCachePath(manifestPath) {
  const key = crypto.createHash('sha1')
    .update(path.resolve(manifestPath).toLowerCase())
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `yoyoengine-psd2ui-uxp-session-${key}.json`);
}

function readCachedSession(cachePath, manifestPath, fingerprint, PluginSession) {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (path.resolve(cached.manifestPath) !== path.resolve(manifestPath)) return null;
    if (!Array.isArray(cached.sessions) || cached.sessions.length === 0) return null;
    return {
      fingerprintMatches: cached.fingerprint === fingerprint,
      session: new PluginSession(cached.sessions, cached.pluginInfo)
    };
  } catch (error) {
    return null;
  }
}

function writeCachedSession(cachePath, manifestPath, fingerprint, session) {
  fs.writeFileSync(cachePath, JSON.stringify({
    manifestPath: path.resolve(manifestPath),
    fingerprint,
    sessions: session.sessions,
    pluginInfo: session.pluginInfo
  }, null, 2), 'utf8');
}

function discardCachedSession(cachePath) {
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch (error) {
    console.error(`清理失效 UXP Session 缓存失败：${error.message}`);
  }
}

async function connectPlugin(manager, configuration) {
  const cached = readCachedSession(
    configuration.cachePath,
    configuration.manifest,
    configuration.fingerprint,
    configuration.PluginSession);
  if (configuration.checkOnly) {
    if (configuration.forceReload) {
      throw new Error('环境检查不允许重新加载 PSD2UI 插件。');
    }
    if (!cached) {
      throw new Error('环境检查失败：没有可复用的 PSD2UI UXP Session 缓存；检查不会加载插件。');
    }
    if (!cached.fingerprintMatches) {
      throw new Error('环境检查失败：PSD2UI 插件文件与已加载会话的指纹不一致；检查不会重新加载插件。');
    }
    let debugTargets;
    try {
      debugTargets = await manager.debugPlugin(cached.session, { apps: [] });
    } catch (error) {
      throw new Error(`环境检查失败：已缓存的 PSD2UI UXP Session 不可用：${error.message}；检查不会重新加载插件或改写缓存。`);
    }
    return { session: cached.session, debugTargets, reusedSession: true };
  }
  if (cached) {
    try {
      if (configuration.forceReload || !cached.fingerprintMatches) {
        await manager.reloadPlugin(cached.session, { apps: [] });
      }
      const debugTargets = await manager.debugPlugin(cached.session, { apps: [] });
      writeCachedSession(
        configuration.cachePath,
        configuration.manifest,
        configuration.fingerprint,
        cached.session);
      return { session: cached.session, debugTargets, reusedSession: true };
    } catch (error) {
      console.error(`缓存的 PSD2UI UXP Session 已失效，将重新加载插件：${error.message}`);
      discardCachedSession(configuration.cachePath);
    }
  }

  const session = await manager.loadPlugin({
    manifest: configuration.manifest,
    apps: [],
    breakOnStart: false,
    isPlaygroundPlugin: false
  });
  writeCachedSession(
    configuration.cachePath,
    configuration.manifest,
    configuration.fingerprint,
    session);
  const debugTargets = await manager.debugPlugin(session, { apps: [] });
  return { session, debugTargets, reusedSession: false };
}

function statusExpression() {
  return `
    (() => {
      const photoshop = require('photoshop');
      const activeDocument = photoshop.app.activeDocument;
      const automation = globalThis.__PSD2UI_DEV__ || globalThis.__YOYO_PSD2UI_DEV__;
      const automationStatus = {
        automationAvailable: Boolean(automation),
        automationMethods: automation
          ? Object.keys(automation).filter((name) => typeof automation[name] === 'function').sort()
          : []
      };
      if (!activeDocument) {
        return { ...automationStatus, document: null };
      }
      const number = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const layerSummary = (layer) => ({
        id: String(layer.id),
        name: String(layer.name || ''),
        kind: String(layer.kind || ''),
        visible: layer.visible !== false,
        childCount: layer.layers ? layer.layers.length : 0,
        bounds: layer.bounds ? {
          left: number(layer.bounds.left),
          top: number(layer.bounds.top),
          right: number(layer.bounds.right),
          bottom: number(layer.bounds.bottom)
        } : null
      });
      return {
        ...automationStatus,
        document: {
          id: String(activeDocument.id),
          title: String(activeDocument.title || ''),
          path: String(activeDocument.path || ''),
          width: number(activeDocument.width),
          height: number(activeDocument.height),
          activeLayers: Array.from(activeDocument.activeLayers || []).map(layerSummary),
          topLevelLayers: Array.from(activeDocument.layers || []).map(layerSummary)
        }
      };
    })()
  `;
}

function assertEnvironmentStatus(value) {
  if (!value || value.automationAvailable !== true) {
    throw new Error('环境检查失败：PSD2UI 开发自动化入口尚未注册。');
  }
  const methods = Array.isArray(value.automationMethods) ? value.automationMethods : [];
  const missing = ['openDocument', 'inspect', 'snapshot'].filter((method) => !methods.includes(method));
  if (missing.length > 0) {
    throw new Error(`环境检查失败：PSD2UI 开发自动化入口缺少方法：${missing.join(', ')}。`);
  }
}

function debugTargetUrl(debugTargets, checkOnly) {
  if (!Array.isArray(debugTargets) || debugTargets.length !== 1 || !debugTargets[0]) {
    throw new Error(`期望 1 个 Photoshop 调试目标，实际得到 ${Array.isArray(debugTargets) ? debugTargets.length : 0} 个。`);
  }
  const url = normalizeDebugUrl(debugTargets[0].cdtDebugWsUrl);
  if (checkOnly) {
    const raw = String(debugTargets[0].cdtDebugWsUrl).trim().replace(/^ws=/, '');
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw) && !/^wss?:\/\//i.test(raw)) {
      throw new Error('环境检查失败：Photoshop 插件调试地址无效。');
    }
    let parsed;
    try { parsed = new URL(url); } catch (error) { /* Report the invalid target below. */ }
    if (!parsed || !['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname) {
      throw new Error('环境检查失败：Photoshop 插件调试地址无效。');
    }
  }
  return url;
}

function beginInvocationExpression(invocationKey, method, payload) {
  const keyLiteral = JSON.stringify(invocationKey);
  const methodLiteral = JSON.stringify(method);
  const payloadLiteral = JSON.stringify(payload == null ? {} : payload);
  return `
    (() => {
      const api = globalThis.__PSD2UI_DEV__ || globalThis.__YOYO_PSD2UI_DEV__;
      if (!api) throw new Error('当前插件版本没有加载 PSD2UI 开发自动化入口。');
      const method = api[${methodLiteral}];
      if (typeof method !== 'function') throw new Error('PSD2UI 开发自动化方法不存在：' + ${methodLiteral});
      const key = ${keyLiteral};
      globalThis[key] = { done: false };
      Promise.resolve()
        .then(() => method(${payloadLiteral}))
        .then(
          (value) => { globalThis[key] = { done: true, success: true, value }; },
          (error) => {
            globalThis[key] = {
              done: true,
              success: false,
              error: {
                message: error && error.message ? error.message : String(error),
                stack: error && error.stack ? error.stack : '',
                code: error && error.code ? error.code : '',
                issues: error && error.issues ? error.issues : null
              }
            };
          });
      return { started: true, key };
    })()
  `;
}

function pollInvocationExpression(invocationKey) {
  const keyLiteral = JSON.stringify(invocationKey);
  return `
    (() => {
      const key = ${keyLiteral};
      const state = globalThis[key];
      if (!state) return { done: true, success: false, error: { message: 'PSD2UI 自动化调用状态已丢失。' } };
      if (!state.done) return { done: false };
      delete globalThis[key];
      return state;
    })()
  `;
}

class CdpClient {
  constructor(WebSocket, url) {
    this._socket = new WebSocket(url);
    this._nextId = 1;
    this._pending = new Map();
    this._eventBacklog = new Map();
    this._eventWaiters = new Map();
    this._executionContexts = [];
    this._executionContextId = null;
    this._ready = new Promise((resolve, reject) => {
      this._socket.once('open', resolve);
      this._socket.once('error', reject);
    });
    this._socket.on('message', (data) => this._handleMessage(data));
    this._socket.on('error', (error) => this._rejectAll(error));
    this._socket.on('close', () => this._rejectAll(new Error('UXP 插件调试连接已关闭。')));
  }

  _handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch (error) {
      return;
    }
    if (message.id == null) {
      if (message.method) this._handleEvent(message.method, message.params || {});
      return;
    }
    const pending = this._pending.get(message.id);
    if (!pending) return;
    this._pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`CDP ${message.error.code || ''}：${message.error.message || '未知错误'}`));
      return;
    }
    pending.resolve(message.result || {});
  }

  _handleEvent(method, params) {
    if (method === 'Runtime.executionContextCreated' && params.context) {
      this._executionContexts.push(params.context);
    } else if (method === 'Runtime.executionContextsCleared') {
      this._executionContexts = [];
      this._executionContextId = null;
    } else if (method === 'Runtime.executionContextDestroyed') {
      this._executionContexts = this._executionContexts
        .filter((context) => context.id !== params.executionContextId);
      if (this._executionContextId === params.executionContextId) this._executionContextId = null;
    }
    const waiters = this._eventWaiters.get(method);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiters.length === 0) this._eventWaiters.delete(method);
      waiter.resolve(params);
      return;
    }
    const backlog = this._eventBacklog.get(method) || [];
    backlog.push(params);
    this._eventBacklog.set(method, backlog);
  }

  _rejectAll(error) {
    for (const pending of this._pending.values()) pending.reject(error);
    this._pending.clear();
  }

  async request(method, params) {
    await this._ready;
    const id = this._nextId;
    this._nextId += 1;
    const response = new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
    this._socket.send(JSON.stringify({ id, method, params: params || {} }));
    return response;
  }

  waitForEvent(method, timeoutMilliseconds) {
    const backlog = this._eventBacklog.get(method);
    if (backlog && backlog.length > 0) {
      const value = backlog.shift();
      if (backlog.length === 0) this._eventBacklog.delete(method);
      return Promise.resolve(value);
    }

    return new Promise((resolve, reject) => {
      const waiters = this._eventWaiters.get(method) || [];
      const entry = { resolve, reject };
      waiters.push(entry);
      this._eventWaiters.set(method, waiters);
      const timeout = setTimeout(() => {
        const current = this._eventWaiters.get(method) || [];
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) this._eventWaiters.delete(method);
        reject(new Error(`等待 CDP 事件 ${method} 超时。请确认 PSD2UI 面板已经打开。`));
      }, timeoutMilliseconds);
      entry.resolve = (value) => {
        clearTimeout(timeout);
        resolve(value);
      };
    });
  }

  async _selectPluginContext() {
    if (this._executionContextId != null) return this._executionContextId;
    await this.request('Runtime.enable');
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const context of this._executionContexts) {
      try {
        const probe = await this.request('Runtime.evaluate', {
          expression: 'typeof require === "function"',
          returnByValue: true,
          contextId: context.id
        });
        if (probe && probe.result && probe.result.value === true) {
          this._executionContextId = context.id;
          return context.id;
        }
      } catch (error) {
        // 调试端可能在探测期间销毁内部上下文，继续尝试剩余上下文。
      }
    }
    const contexts = this._executionContexts.map((context) => ({
      id: context.id,
      name: context.name,
      origin: context.origin,
      auxData: context.auxData
    }));
    throw new Error(`没有找到 PSD2UI 插件执行上下文：${JSON.stringify(contexts)}`);
  }

  async evaluate(expression) {
    const contextId = await this._selectPluginContext();
    const evaluation = await this.request('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      contextId
    });
    if (evaluation.exceptionDetails) {
      const exception = evaluation.exceptionDetails.exception || {};
      throw new Error(
        exception.description
        || exception.value
        || evaluation.exceptionDetails.text
        || 'UXP 插件执行表达式失败。');
    }
    const remote = evaluation.result || {};
    if (remote.subtype === 'error') throw new Error(remote.description || 'UXP 插件返回错误。');
    return remote.value;
  }

  async invoke(method, payload, timeoutMilliseconds) {
    const invocationKey = `__PSD2UI_INVOCATION_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await this.evaluate(beginInvocationExpression(invocationKey, method, payload));
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const state = await this.evaluate(pollInvocationExpression(invocationKey));
      if (state && state.done) {
        if (state.success) return state.value;
        const details = state.error || {};
        const error = new Error(details.message || 'PSD2UI Photoshop 自动化调用失败。');
        if (details.code) error.code = details.code;
        if (details.issues) error.issues = details.issues;
        if (details.stack) error.stack = details.stack;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`PSD2UI Photoshop 自动化调用超时（${timeoutMilliseconds} ms）。`);
  }

  async waitForAutomation(timeoutMilliseconds) {
    const deadline = Date.now() + timeoutMilliseconds;
    do {
      const ready = await this.evaluate(
        'Boolean(globalThis.__PSD2UI_DEV__ || globalThis.__YOYO_PSD2UI_DEV__)');
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    } while (Date.now() < deadline);
    const errors = this._eventBacklog.get('Runtime.exceptionThrown') || [];
    const latest = errors.length > 0 && errors[errors.length - 1].exceptionDetails;
    const exception = latest && latest.exception;
    const detail = exception && (exception.description || exception.value) || latest && latest.text;
    throw new Error(`PSD2UI 面板启动未就绪（${timeoutMilliseconds} ms）：开发自动化入口尚未注册。`
      + (detail ? `\n${detail}` : '请检查 UXP 面板控制台。'));
  }

  close() {
    if (this._socket && this._socket.readyState < 2) this._socket.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = path.resolve(requireValue(options, 'manifest'));
  const udtRoot = path.resolve(requireValue(options, 'udt-root'));
  const servicePort = Number(options['service-port'] || 14001);
  if (!Number.isInteger(servicePort) || servicePort <= 0 || servicePort > 65535) {
    throw new Error(`UXP Developer Tool 服务端口无效：${options['service-port'] || ''}`);
  }

  const operation = String(options.operation || 'status').toLowerCase();
  const checkOnly = readCheckOnlyOption(options, operation);
  const timeoutMilliseconds = Number(options['timeout-ms'] || 600000);
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new Error(`调用超时参数无效：${options['timeout-ms'] || ''}`);
  }
  global.UxpLogger = {
    log: (...values) => console.error(...values),
    verbose: (...values) => console.error(...values),
    warn: (...values) => console.error(...values),
    error: (...values) => console.error(...values)
  };

  const appAsar = path.join(udtRoot, 'resources', 'app.asar');
  const PluginMgr = require(path.join(
    appAsar,
    'node_modules',
    '@adobe',
    'uxp-devtools-core',
    'src',
    'core',
    'client',
    'PluginMgr.js'));
  const PluginSession = require(path.join(
    appAsar,
    'node_modules',
    '@adobe',
    'uxp-devtools-core',
    'src',
    'core',
    'client',
    'plugin',
    'PluginSession.js'));
  const WebSocket = require(path.join(appAsar, 'node_modules', 'ws'));

  const keepAlive = setInterval(() => {}, 1000);
  const manager = new PluginMgr();
  let cdp = null;
  try {
    await ensureService({
      port: servicePort,
      udtRoot,
      executable: process.execPath,
      autoStart: !checkOnly && process.env.PSD2UI_UDT_AUTOSTART !== 'false',
      timeoutMilliseconds: Math.min(timeoutMilliseconds, 20000)
    });
    const connectionTimeout = Math.min(timeoutMilliseconds, 30000);
    await withTimeout(() => manager.connectToService(servicePort), connectionTimeout, '连接 UDT 服务');
    await waitForPhotoshop(manager, connectionTimeout);
    const connection = await withTimeout(() => connectPlugin(manager, {
      manifest,
      fingerprint: pluginFingerprint(manifest),
      cachePath: options['session-cache']
        ? path.resolve(options['session-cache'])
        : defaultSessionCachePath(manifest),
      forceReload: operation === 'reload',
      checkOnly,
      PluginSession
    }), connectionTimeout, checkOnly ? '检查 Photoshop 插件会话' : '加载或连接 Photoshop 插件');
    const session = connection.session;
    const debugTargets = connection.debugTargets;
    cdp = new CdpClient(WebSocket, debugTargetUrl(debugTargets, checkOnly));
    if (!checkOnly) {
      await withTimeout(() => cdp.waitForAutomation(Math.min(connectionTimeout, 5000)),
        connectionTimeout, '等待 PSD2UI 面板启动');
    }

    let value;
    if (operation === 'invoke') {
      const method = requireValue(options, 'method');
      const payloadText = options['payload-base64']
        ? Buffer.from(options['payload-base64'], 'base64').toString('utf8')
        : '{}';
      value = await withTimeout(() => cdp.invoke(method, JSON.parse(payloadText), timeoutMilliseconds),
        timeoutMilliseconds, `Photoshop ${method} 调用`);
    } else if (operation !== 'status' && operation !== 'reload') {
      throw new Error(`不支持的操作：${operation}`);
    } else {
      value = await withTimeout(() => cdp.evaluate(statusExpression()), connectionTimeout, '读取 Photoshop 状态');
      if (checkOnly) assertEnvironmentStatus(value);
    }
    process.stdout.write(`${JSON.stringify({
      success: true,
      operation,
      reusedSession: connection.reusedSession,
      app: debugTargets[0].appInfo,
      plugin: session.pluginInfo,
      value
    }, null, 2)}\n`);
  } finally {
    clearInterval(keepAlive);
    try { if (cdp) cdp.close(); } catch (error) { console.error(error.message); }
    try { manager.disconnect(); } catch (error) { console.error(error.message); }
  }
}

module.exports = {
  CdpClient,
  normalizeDebugUrl,
  readCheckOnlyOption,
  connectPlugin,
  statusExpression,
  assertEnvironmentStatus,
  debugTargetUrl
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`, () => process.exit(1));
  });
}
