'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startNotifications } = require('../../Plus-ins/PSD2UI-CEP/src/notifications');

async function harness() {
  let now = 0, next = 0, polls = 0, busy = false, uncertain = false, pollAction = async () => {};
  const timers = new Map(), callbacks = new Map(), sent = [], errors = [];
  const document = { hidden: false, addEventListener: (name, fn) => callbacks.set(name, fn), removeEventListener: name => callbacks.delete(name) };
  const bridge = { getExtensionId: () => 'test.panel',
    getHostEnvironment: () => JSON.stringify({ appId: 'PHXS' }),
    addEventListener: (name, fn) => callbacks.set(name, fn), removeEventListener: name => callbacks.delete(name),
    dispatchEvent: event => sent.push(event) };
  const controller = await startNotifications({ bridge, document, window: document,
    photoshop: { isBusy: () => busy, invoke: async method => { assert.equal(method, 'notificationEvents'); return [1936483188]; },
      poll: async () => { polls++; await pollAction(); return { skipped: false }; } },
    isBusy: () => busy, isUncertain: () => uncertain, onError: error => errors.push(error),
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  return { controller, document, callbacks, sent, errors, timers, get polls() { return polls; },
    set busy(value) { busy = value; }, set uncertain(value) { uncertain = value; }, set pollAction(value) { pollAction = value; },
    change() { callbacks.get('com.adobe.PhotoshopJSONCallbacktest.panel')(); },
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
