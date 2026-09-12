'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { discover, invokeCepRunner } = require('../../PS-MCP/src/cepTransport');

class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.attributes = {}; this.value = '';
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  addEventListener(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
}

test('generated CEP panel boots the real shared UI and exposes a discoverable read-only bridge without a PSD', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'psd2ui-cep-bundle-'));
  const cepRoot = path.resolve(__dirname, '../../Plus-ins/PSD2UI-CEP');
  const elements = {};
  for (const match of fs.readFileSync(path.join(cepRoot, 'index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g)) elements[match[1]] = new Element();
  const errors = [], calls = [], events = {}, cepEvents = {}, dispatched = [];
  const nodeRequire = name => name === 'os' ? { ...os, homedir: () => directory } : require(name);
  const sandbox = {
    Buffer, process, require: nodeRequire, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval() {},
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: { getElementById: id => elements[id] || null, createElement: () => new Element() },
    addEventListener: (name, fn) => { events[name] = fn; },
    cep_node: { require: nodeRequire },
    __adobe_cep__: {
      getExtensionId: () => 'com.yoyoengine.psd2ui.cep.panel',
      getHostEnvironment: () => JSON.stringify({ appId: 'PHXS' }),
      addEventListener: (name, fn) => { cepEvents[name] = fn; },
      removeEventListener: name => { delete cepEvents[name]; },
      dispatchEvent: event => dispatched.push(event),
      evalScript(script, callback) {
      const raw = JSON.parse(script.slice('$.PSD2UIHost.dispatch('.length, -1));
      const request = JSON.parse(raw); calls.push(request.method);
      assert.equal(request.deferState, true, 'RPC must not trigger an implicit synchronous tree scan');
      const state = { activeDocumentId: null, documents: [], version: '20.0.4' };
      const values = { beginState: { token: 'read', stamp: state }, statePage: { items: [], done: true }, probe: state, notificationEvents: [1936483188] };
      assert.ok(values[request.method], 'boot must not mutate or require an open document');
      callback(JSON.stringify({ ok: true, value: values[request.method] }));
    } }
  };
  sandbox.window = sandbox;
  try {
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(cepRoot, 'panel.js'), 'utf8'), sandbox);
    for (let count = 0; count < 50 && !events.beforeunload && !errors.length; count++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(errors, []);
    assert.equal(typeof events.beforeunload, 'function');
    assert.equal(typeof sandbox.__PSD2UI_DEV__.inspect, 'function');
    assert.equal(typeof sandbox.__PSD2UI_RUN__, 'function');
    assert.match(elements['current-document'].textContent, /没有|未/);
    const sessionDirectory = path.join(directory, '.psd2ui/cep/sessions');
    const status = await invokeCepRunner({ operation: 'status', sessionDirectory });
    assert.equal(status.photoshopVersion, '20.0.4');
    assert.equal(status.documentCount, 0);
    assert.equal(status.pluginVersion, '0.3.8');
    assert.deepEqual(calls, ['probe', 'beginState', 'statePage', 'notificationEvents']);
    assert.equal(typeof cepEvents['com.adobe.PhotoshopJSONCallbackcom.yoyoengine.psd2ui.cep.panel'], 'function');
    assert.equal(dispatched[0].type, 'com.adobe.PhotoshopRegisterEvent');
  } finally {
    if (events.beforeunload) events.beforeunload();
    await new Promise(setImmediate);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
