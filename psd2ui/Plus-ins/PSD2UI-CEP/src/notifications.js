'use strict';

const eventNames = ['select', 'open', 'close', 'make', 'delete', 'set', 'move', 'transform',
  'show', 'hide', 'undo', 'redo', 'historyStateChanged'];

function notificationHint(event, ids) {
  try {
    let data = event && event.data;
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data) return { full: true };
    const index = (ids || []).findIndex(id => String(id) === String(data.eventID));
    const name = index >= 0 ? eventNames[index] : String(data.eventID || '');
    if (name === 'select') return {};
    if (name === 'historyStateChanged') return { history: true };
    if (!['show', 'hide', 'set'].includes(name)) return { full: true };
    let descriptor = data.eventData;
    if (typeof descriptor === 'string') descriptor = JSON.parse(descriptor);
    const names = name === 'set';
    if (names && (!descriptor || !descriptor.to || descriptor.to._obj !== 'layer' || typeof descriptor.to.name !== 'string'
        || Object.keys(descriptor.to).some(key => key !== '_obj' && key !== 'name')
        || Object.keys(descriptor).some(key => !['_obj', '_target', 'null', 'to', '_options'].includes(key)))) return { full: true };
    const layerIds = [], documentIds = [];
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value._ref === 'layer' && value._id != null) layerIds.push(String(value._id));
      if (value._ref === 'document' && value._id != null) documentIds.push(String(value._id));
      Object.keys(value).forEach(key => visit(value[key]));
    }
    visit(descriptor);
    // 只有明确的改名命令可以复用几何；其它 set（样式、文字等）必须完整读取。
    if (names && !layerIds.length) return { full: true };
    return { visibility: !names, names, layerIds, documentIds, allLayers: layerIds.length === 0 };
  } catch (_) { return { full: true }; }
}

function mergeHints(left, right) {
  return { full: Boolean(left.full || right.full), history: Boolean(left.history || right.history),
    reconcileVisibility: Boolean(left.reconcileVisibility || right.reconcileVisibility),
    visibility: Boolean(left.visibility || right.visibility), names: Boolean(left.names || right.names),
    allLayers: Boolean(left.allLayers || right.allLayers),
    layerIds: Array.from(new Set([...(left.layerIds || []), ...(right.layerIds || [])])),
    documentIds: Array.from(new Set([...(left.documentIds || []), ...(right.documentIds || [])])) };
}

// Adobe CEP's extension-specific PhotoshopJSONCallback avoids global broadcasts.
// Register only edits/selection, never `get`: our own reads must not retrigger us.
async function startNotifications(options) {
  const { bridge, photoshop, document, window } = options;
  const later = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const now = options.now || Date.now;
  const report = options.onError || (error => console.error('PSD2UI 刷新失败：', error.message));
  let closed = false, running = false, dirty = false, timer = null, watchdog = null, generation = 0;
  let eventType, extensionId, eventIds, appId;
  let pending = {};
  let pendingSince = null;
  let hidden = document.hidden === true;
  let focused = false;
  function blocked() {
    return document.hidden === true || photoshop.isBusy() || options.isBusy() || options.isUncertain();
  }
  function schedule(delay) {
    if (closed) return;
    dirty = true;
    if (pendingSince == null) pendingSince = now();
    if (timer != null) cancel(timer);
    timer = null;
    if (document.hidden === true) {
      hidden = true; focused = false;
      cancel(watchdog); watchdog = null;
      return;
    }
    if (options.isUncertain()) return;
    // 连续选择可复用已有树，最多等半秒；内容编辑仍等操作稳定后再读取。
    const selectionOnly = !pending.full && !pending.history && !pending.visibility && !pending.names && !pending.reconcileVisibility;
    const wait = delay === 120 && selectionOnly ? Math.min(delay, Math.max(0, 500 - (now() - pendingSince))) : delay;
    timer = later(refresh, wait);
  }
  async function refresh() {
    timer = null;
    if (closed || options.isUncertain()) return;
    if (document.hidden === true) return; // visibilitychange will resume pending work
    if (running || blocked()) {
      dirty = true;
      // 宿主操作结束会主动唤醒；面板外层业务仍使用短轮询兜底。
      if (!removeIdle || !photoshop.isBusy()) schedule(200);
      return;
    }
    dirty = false;
    pendingSince = null;
    running = true;
    const hint = pending;
    const startedGeneration = generation;
    pending = {};
    try {
      const result = await photoshop.poll(hint, () => !closed && document.hidden !== true && generation === startedGeneration);
      if (result && result.skipped) { dirty = true; pending = mergeHints(hint, pending); }
    } catch (error) {
      if (error.code === 'PSD2UI_REFRESH_SUPERSEDED') {
        dirty = true; pending = mergeHints(hint, pending);
      } else { pending = { full: true }; report(error); }
    }
    finally { running = false; if (dirty && !closed && timer == null) schedule(120); }
  }
  function changed(event) {
    generation += 1;
    pending = mergeHints(pending, notificationHint(event, eventIds));
    schedule(120);
  }
  function reconcile() {
    pending = mergeHints(pending, { reconcileVisibility: true }); schedule(120);
    armWatchdog();
  }
  function focus() {
    if (document.hidden === true || focused) return;
    focused = true;
    reconcile();
  }
  function blur() { focused = false; }
  function visible() {
    const nextHidden = document.hidden === true;
    if (nextHidden === hidden) return;
    hidden = nextHidden;
    if (!hidden) { reconcile(); return; }
    focused = false;
    generation += 1;
    cancel(timer); timer = null;
    cancel(watchdog); watchdog = null;
  }
  const removeIdle = typeof photoshop.addIdleListener === 'function' ? photoshop.addIdleListener(() => {
    if (dirty && !running && timer == null && !closed) schedule(120);
  }) : null;
  function register(type) {
    bridge.dispatchEvent({ type, scope: 'APPLICATION', appId, extensionId, data: eventIds.join(',') });
  }
  let subscribed = false;
  try {
    if (bridge && bridge.addEventListener && bridge.removeEventListener && bridge.dispatchEvent && bridge.getExtensionId && bridge.getHostEnvironment) {
      eventIds = await photoshop.invoke('notificationEvents', {});
      if (!Array.isArray(eventIds) || !eventIds.length) throw new Error('Photoshop 未返回事件 ID。');
      extensionId = bridge.getExtensionId();
      appId = JSON.parse(bridge.getHostEnvironment()).appId;
      if (!appId) throw new Error('Photoshop 未返回事件目标应用 ID。');
      eventType = 'com.adobe.PhotoshopJSONCallback' + extensionId;
      bridge.addEventListener(eventType, changed);
      register('com.adobe.PhotoshopRegisterEvent');
      subscribed = true;
    }
  } catch (error) {
    if (eventType) bridge.removeEventListener(eventType, changed);
    report(error);
  }
  if (document.addEventListener) document.addEventListener('visibilitychange', visible);
  window.addEventListener('focus', focus);
  window.addEventListener('blur', blur);
  // Rare/unregistered PS events still reconcile. Normal selection does not wait
  // for this watchdog, and the timer never stacks work behind an active command.
  function check() {
    watchdog = null;
    if (closed || options.isUncertain()) return;
    if (!running && !blocked() && timer == null) schedule(0);
    armWatchdog();
  }
  function armWatchdog() {
    if (watchdog != null || closed || document.hidden === true || options.isUncertain()) return;
    watchdog = later(check, subscribed ? 15000 : 1500);
  }
  armWatchdog();
  return {
    close() {
      closed = true;
      cancel(timer); cancel(watchdog);
      if (document.removeEventListener) document.removeEventListener('visibilitychange', visible);
      if (window.removeEventListener) { window.removeEventListener('focus', focus); window.removeEventListener('blur', blur); }
      if (removeIdle) removeIdle();
      if (subscribed) {
        try { register('com.adobe.PhotoshopUnRegisterEvent'); } catch (error) { report(error); }
        bridge.removeEventListener(eventType, changed);
      }
    }
  };
}

module.exports = { startNotifications, notificationHint, mergeHints };
