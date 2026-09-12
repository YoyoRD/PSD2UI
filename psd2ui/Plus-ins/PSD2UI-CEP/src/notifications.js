'use strict';

// Adobe CEP's extension-specific PhotoshopJSONCallback avoids global broadcasts.
// Register only edits/selection, never `get`: our own reads must not retrigger us.
async function startNotifications(options) {
  const { bridge, photoshop, document, window } = options;
  const later = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const report = options.onError || (error => console.error('PSD2UI 刷新失败：', error.message));
  let closed = false, running = false, dirty = false, timer = null, watchdog = null;
  let eventType, extensionId, eventIds, appId;
  function blocked() {
    return document.hidden === true || photoshop.isBusy() || options.isBusy() || options.isUncertain();
  }
  function schedule(delay) {
    if (closed) return;
    dirty = true;
    if (timer != null) cancel(timer);
    timer = later(refresh, delay);
  }
  async function refresh() {
    timer = null;
    if (closed || options.isUncertain()) return;
    if (document.hidden === true) return; // visibilitychange will resume pending work
    if (running || blocked()) { schedule(200); return; }
    dirty = false;
    running = true;
    try {
      const result = await photoshop.poll();
      if (result && result.skipped) dirty = true;
    } catch (error) { report(error); }
    finally { running = false; if (dirty && !closed) schedule(120); }
  }
  function changed() { schedule(120); }
  function visible() { if (document.hidden !== true) changed(); }
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
  window.addEventListener('focus', visible);
  // Rare/unregistered PS events still reconcile. Normal selection does not wait
  // for this watchdog, and the timer never stacks work behind an active command.
  function check() {
    if (closed || options.isUncertain()) return;
    if (!running && !blocked() && timer == null) schedule(0);
    watchdog = later(check, subscribed ? 15000 : 1500);
  }
  watchdog = later(check, subscribed ? 15000 : 1500);
  return {
    close() {
      closed = true;
      cancel(timer); cancel(watchdog);
      if (document.removeEventListener) document.removeEventListener('visibilitychange', visible);
      if (window.removeEventListener) window.removeEventListener('focus', visible);
      if (subscribed) {
        try { register('com.adobe.PhotoshopUnRegisterEvent'); } catch (error) { report(error); }
        bridge.removeEventListener(eventType, changed);
      }
    }
  };
}

module.exports = { startNotifications };
