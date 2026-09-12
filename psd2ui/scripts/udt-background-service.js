'use strict';

const path = require('path');

function argumentsFrom(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index].startsWith('--') || values[index + 1] == null) {
      throw new Error(`无效后台服务参数：${values[index]}`);
    }
    options[values[index].slice(2)] = values[index + 1];
  }
  return options;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const port = Number(options.port);
  const idleMilliseconds = Number(options['idle-ms'] || 900000);
  if (!options['udt-root'] || !Number.isInteger(port) || port <= 0 || port > 65535
      || !Number.isInteger(idleMilliseconds) || idleMilliseconds <= 0) {
    throw new Error('后台 UDT 服务要求有效的 udt-root、port 和 idle-ms。');
  }
  const adobeModules = path.join(path.resolve(options['udt-root']), 'resources', 'app.asar', 'node_modules', '@adobe');
  const log = (...values) => console.error(...values);
  global.UxpLogger = { log, verbose: log, warn: log, error: log };

  // UDTServer.startServer performs these same two operations. Loading only these modules
  // avoids DevToolsHelper's unrelated electron.shell and host-launching dependencies.
  // UTDS / 1.0.0 and the discovery payload are Adobe's installed helper protocol values.
  const ServiceMgr = require(path.join(adobeModules, 'uxp-devtools-core/src/core/service/ServiceMgr.js'));
  const { VulcanAdapter } = require(path.join(adobeModules, 'uxp-devtools-helper/src/DevToolNativeLib.js'));
  const service = new ServiceMgr();
  const discovery = new VulcanAdapter('UTDS', '1.0.0');
  let stopping = false;
  let advertised = false;
  function stop(exitCode) {
    if (stopping) return;
    stopping = true;
    try { if (advertised) discovery.setServerDetails(false, JSON.stringify({ port })); }
    catch (error) { log(error.stack || String(error)); }
    try { service.handleAppQuit(); } catch (error) { log(error.stack || String(error)); }
    try { discovery.disconnect(); } catch (error) { log(error.stack || String(error)); }
    // Adobe's shutdown closes client sockets but not its HTTP listener.
    setTimeout(() => process.exit(exitCode), 150);
  }
  process.on('SIGTERM', () => stop(0));
  process.on('SIGINT', () => stop(0));
  process.on('uncaughtException', (error) => { log(error.stack || String(error)); stop(1); });
  process.on('unhandledRejection', (error) => { log(error.stack || String(error)); stop(1); });

  const started = service.start(port);
  // The bundled ServiceMgr does not reject asynchronous HTTP bind failures itself.
  service._server._httpServer.once('error', (error) => {
    log(error.stack || String(error));
    stop(error.code === 'EADDRINUSE' ? 0 : 1);
  });
  await started;
  discovery.setServerDetails(true, JSON.stringify({ port }));
  advertised = true;

  let activeCalls = 0;
  let lastActivity = Date.now();
  service._server._io.on('connection', (socket, request) => {
    if (!request || request.url !== '/socket/cli') return;
    activeCalls += 1;
    lastActivity = Date.now();
    socket.on('message', () => { lastActivity = Date.now(); });
    socket.once('close', () => { activeCalls -= 1; lastActivity = Date.now(); });
  });
  // Photoshop keeps its discovery connection open. Only CLI activity extends this worker's life.
  setInterval(() => {
    if (activeCalls === 0 && Date.now() - lastActivity >= idleMilliseconds) stop(0);
  }, Math.min(idleMilliseconds, 10000));
  service._server._app.get('/psd2ui/service', (request, response) => response.json({
    managedBy: 'psd2ui', pid: process.pid, port, idleMilliseconds, activeCalls
  }));
  log(`PSD2UI UDT background service ready: pid=${process.pid}, port=${port}`);
}

main().catch((error) => {
  console.error(error && error.stack || String(error));
  process.exit(1);
});
