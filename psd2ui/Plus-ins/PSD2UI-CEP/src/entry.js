'use strict';
require('./polyfills');
const photoshop = require('./photoshop');
const { startCommandServer } = require('./commandServer');
const { startNotifications } = require('./notifications');

async function start() {
  require('../../PSD2UI/uiShell');
  const summary = document.getElementById('status-summary');
  if (summary) summary.textContent = '正在连接 Photoshop…';
  globalThis.__PSD2UI_HOST_PROGRESS__ = count => {
    if (summary) summary.textContent = `正在读取 PSD，已读取 ${count} 个图层…`;
  };
  // Let CEP finish initializing/painting before the first evalScript call.
  await new Promise(resolve => setTimeout(resolve, 100));
  await photoshop.initialize();
  delete globalThis.__PSD2UI_HOST_PROGRESS__;
  globalThis.__PSD2UI_REFRESH_HOST__ = () => photoshop.refresh();
  require('../../PSD2UI/app');
  const commandServer = await startCommandServer({
    automation: globalThis.__PSD2UI_DEV__,
    isUncertain: () => require('./hostRpc').isUncertain(),
    beforeInvoke: () => photoshop.refresh(),
    run: (label, action) => globalThis.__PSD2UI_RUN__(label, action),
    status: () => ({ photoshopVersion: photoshop.app.version || '', documentCount: photoshop.app.documents.length })
  });
  const notifications = await startNotifications({
    bridge: window.__adobe_cep__, photoshop, document, window,
    isBusy: () => Boolean(globalThis.__PSD2UI_BUSY__ && globalThis.__PSD2UI_BUSY__()),
    isUncertain: () => require('./hostRpc').isUncertain()
  });
  window.addEventListener('beforeunload', () => { notifications.close(); commandServer.close(); });
}
start().catch(error => {
  console.error(error);
  const target = document.getElementById('status');
  if (target) target.value = `PSD2UI 启动失败：${error.message || error}`;
  const summary = document.getElementById('status-summary');
  if (summary) summary.textContent = '插件启动失败，请查看详情';
});
