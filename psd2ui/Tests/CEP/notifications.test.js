'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startNotifications } = require('../../Plus-ins/PSD2UI-CEP/src/notifications');

async function harness() {
  let now = 0, next = 0, polls = 0, busy = false, hostBusy = false, uncertain = false, pollAction = async () => {};
  const timers = new Map(), callbacks = new Map(), sent = [], errors = [], hints = [];
  const idleListeners = new Set();
  const document = { hidden: false, addEventListener: (name, fn) => callbacks.set(name, fn), removeEventListener: name => callbacks.delete(name) };
  const bridge = { getExtensionId: () => 'test.panel',
    getHostEnvironment: () => JSON.stringify({ appId: 'PHXS' }),
    addEventListener: (name, fn) => callbacks.set(name, fn), removeEventListener: name => callbacks.delete(name),
    dispatchEvent: event => sent.push(event) };
  const controller = await startNotifications({ bridge, document, window: document,
    photoshop: { isBusy: () => hostBusy, addIdleListener: listener => { idleListeners.add(listener); return () => idleListeners.delete(listener); },
      invoke: async method => { assert.equal(method, 'notificationEvents'); return [1936483188]; },
      poll: async (hint, isCurrent) => { polls++; hints.push(hint); await pollAction(isCurrent); return { skipped: false }; } },
    isBusy: () => busy, isUncertain: () => uncertain, onError: error => errors.push(error),
    now: () => now,
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  return { controller, document, callbacks, sent, errors, timers, hints, idleListeners, get polls() { return polls; },
    set busy(value) { busy = value; }, set uncertain(value) { uncertain = value; }, set pollAction(value) { pollAction = value; },
    set hostBusy(value) { hostBusy = value; if (!value) idleListeners.forEach(listener => listener()); },
    change(event) { callbacks.get('com.adobe.PhotoshopJSONCallbacktest.panel')(event); },
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const pending = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pending) break;
        const [id, timer] = pending; now = timer.at; timers.delete(id); await timer.fn();
      }
      now = end;
    }
  };
}

test('native selection bursts refresh once after settling instead of waiting on the idle watchdog', async () => {
  const h = await harness();
  assert.equal(h.sent[0].extensionId, 'test.panel');
  assert.equal(h.sent[0].appId, 'PHXS', 'APPLICATION events require the current host ID');
  assert.equal(h.sent[0].data, '1936483188');
  await h.tick(2000); assert.equal(h.polls, 0);
  h.change(); await h.tick(60); h.change(); await h.tick(119); assert.equal(h.polls, 0);
  await h.tick(1); assert.equal(h.polls, 1);
  await h.tick(2000); assert.equal(h.polls, 1);
  h.controller.close(); assert.equal(h.timers.size, 0);
  assert.equal(h.sent.at(-1).type, 'com.adobe.PhotoshopUnRegisterEvent');
  assert.equal(h.callbacks.size, 0);
});

test('focus reconciles history without forcing deferred geometry and superseded work retains its hints', async () => {
  const h = await harness();
  h.callbacks.get('focus')(); await h.tick(120);
  assert.equal(h.hints[0].full, false);
  assert.equal(h.hints[0].reconcileVisibility, true);
  h.pollAction = async isCurrent => {
    if (h.polls !== 2) return;
    assert.equal(isCurrent(), true);
    h.change();
    assert.equal(isCurrent(), false);
    const error = new Error('superseded'); error.code = 'PSD2UI_REFRESH_SUPERSEDED'; throw error;
  };
  h.change(); await h.tick(120); await h.tick(120);
  assert.equal(h.polls, 3);
  assert.equal(h.hints[2].full, true);
  assert.deepEqual(h.errors, []);
  h.controller.close();
});

test('hidden, busy and uncertain hosts receive no queued reads; pending selection resumes when available', async () => {
  const h = await harness();
  h.document.hidden = true; h.change(); await h.tick(2000); assert.equal(h.polls, 0);
  h.document.hidden = false; h.callbacks.get('visibilitychange')();
  h.busy = true; await h.tick(500); assert.equal(h.polls, 0);
  h.busy = false; await h.tick(200); assert.equal(h.polls, 1);
  h.uncertain = true; h.change(); await h.tick(20000); assert.equal(h.polls, 1);
  h.controller.close(); assert.equal(h.timers.size, 0);
});

test('events delivered during a read are coalesced into a single subsequent reconciliation', async () => {
  const h = await harness();
  h.pollAction = async () => { if (h.polls === 1) { h.change(); h.change(); } };
  h.change(); await h.tick(120); assert.equal(h.polls, 1);
  await h.tick(120); assert.equal(h.polls, 2);
  h.controller.close();
});

test('visibility callback supports explicit IDs, targetEnum, JSON payloads and conservative unknown fallback', () => {
  const { notificationHint, mergeHints } = require('../../Plus-ins/PSD2UI-CEP/src/notifications');
  const event = eventData => ({ data: JSON.stringify({ eventID: 'hide', eventData }) });
  const explicit = notificationHint(event(JSON.stringify({ null: [{ _ref: 'layer', _id: 77 }, { _ref: 'document', _id: 10 }] })));
  assert.deepEqual(explicit.layerIds, ['77']); assert.deepEqual(explicit.documentIds, ['10']);
  assert.equal(explicit.allLayers, false);
  const target = notificationHint(event({ null: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' } }));
  assert.equal(target.allLayers, true, 'an eye click may target an unselected layer');
  assert.equal(mergeHints(explicit, target).allLayers, true);
  assert.equal(mergeHints(explicit, notificationHint({ data: 'bad json' })).full, true);
  assert.equal(mergeHints(explicit, notificationHint({ data: { eventID: 'historyStateChanged' } })).visibility, true);
});

test('only explicit name-only layer edits take the metadata path', () => {
  const { notificationHint } = require('../../Plus-ins/PSD2UI-CEP/src/notifications');
  const event = data => ({ data: { eventID: 'set', eventData: data } });
  const rename = { _obj: 'set', _target: [{ _ref: 'layer', _id: 7 }], to: { _obj: 'layer', name: 'New' } };
  assert.equal(notificationHint(event(rename)).names, true);
  assert.equal(notificationHint(event({ ...rename, to: { ...rename.to, opacity: 50 } })).full, true);
  assert.equal(notificationHint(event({ ...rename, _target: [{ _ref: 'layer', _value: 'targetEnum' }] })).full, true);
  assert.equal(notificationHint(event({ ...rename, extraEdit: true })).full, true);
});

test('duplicate focus events do not reread visibility, but blur and real visibility restoration do', async () => {
  const h = await harness();
  h.callbacks.get('focus')(); await h.tick(120);
  for (let index = 0; index < 5; index++) { h.callbacks.get('focus')(); await h.tick(200); }
  assert.equal(h.polls, 1);
  h.callbacks.get('blur')(); h.callbacks.get('focus')(); await h.tick(120);
  assert.equal(h.polls, 2);
  h.document.hidden = true; h.callbacks.get('visibilitychange')();
  assert.equal(h.timers.size, 0, 'hidden panels stop both refresh and watchdog timers');
  for (let index = 0; index < 100; index++) h.change();
  await h.tick(60000);
  assert.equal(h.polls, 2);
  assert.equal(h.timers.size, 0, 'hidden notification bursts accumulate without scheduling work');
  h.document.hidden = false; h.callbacks.get('visibilitychange')(); h.callbacks.get('focus')();
  await h.tick(120);
  assert.equal(h.polls, 3);
  assert.equal(h.hints[2].full, true, 'hidden edits are retained');
  assert.equal(h.hints[2].reconcileVisibility, true);
  h.callbacks.get('visibilitychange')(); await h.tick(120);
  assert.equal(h.polls, 3, 'duplicate visible notifications are ignored');
  h.controller.close(); assert.equal(h.idleListeners.size, 0);
});

test('busy host storms wait for idle and preserve full hints plus late history-free edits', async () => {
  const h = await harness();
  h.hostBusy = true;
  for (let index = 0; index < 100; index++) h.change({ data: { eventID: 'make' } });
  await h.tick(5000);
  assert.equal(h.polls, 0);
  assert.equal(h.timers.size, 1, 'only the idle watchdog remains, no 200ms busy retry loop');
  h.hostBusy = false;
  await h.tick(60);
  h.change({ data: { eventID: 'hide', eventData: { _target: [{ _ref: 'layer', _id: 77 }, { _ref: 'document', _id: 10 }] } } });
  await h.tick(120);
  assert.equal(h.polls, 1);
  assert.equal(h.hints[0].full, true, 'busy work is not assumed to belong to the plugin');
  assert.equal(h.hints[0].visibility, true);
  assert.deepEqual(h.hints[0].layerIds, ['77']);
  assert.deepEqual(h.hints[0].documentIds, ['10']);
  h.change({ data: { eventID: 'set', eventData: { _target: [{ _ref: 'layer', _id: 77 }], to: { _obj: 'layer', name: 'Later edit' } } } });
  await h.tick(120);
  assert.equal(h.polls, 2);
  assert.equal(h.hints[1].names, true, 'events arriving after idle reconciliation are still processed');
  h.controller.close();
});

test('continuous selection has a bounded debounce while content edits wait until settled', async () => {
  const h = await harness();
  for (let index = 0; index < 5; index++) {
    h.change({ data: { eventID: 'select' } }); await h.tick(100);
  }
  assert.equal(h.polls, 1, 'selection refresh is not postponed forever by continuous clicks');
  for (let index = 0; index < 8; index++) {
    h.change({ data: { eventID: 'transform' } }); await h.tick(100);
  }
  assert.equal(h.polls, 1, 'heavy content scans do not start while the user keeps editing');
  await h.tick(20);
  assert.equal(h.polls, 2);
  assert.equal(h.hints[1].full, true);
  h.controller.close();
});
