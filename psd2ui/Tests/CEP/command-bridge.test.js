'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startCommandServer } = require('../../Plus-ins/PSD2UI-CEP/src/commandServer');
const { discover, invokeCepRunner, queryOperation } = require('../../PS-MCP/src/cepTransport');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function send(session, method, route, body, headers) {
  return new Promise((resolve, reject) => {
    const text = body == null ? null : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1', port: session.port, path: route, method,
      agent: false,
      headers: Object.assign({ Authorization: 'Bearer ' + session.token },
        text ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } : {}, headers)
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.setTimeout(3000, () => request.destroy(new Error('Test HTTP timeout')));
    request.on('error', reject);
    request.end(text);
  });
}

async function fixture(t, automation, hostOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'psd2ui-cep-bridge-test-'));
  const servers = [];
  t.after(async () => {
    servers.forEach((server) => server.close());
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir())
        || !path.basename(directory).startsWith('psd2ui-cep-bridge-test-')) {
      throw new Error('Refusing to remove a directory outside this test fixture.');
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function start(methods) {
    const server = await startCommandServer({ ...hostOptions, directory, automation: methods || automation || {},
      status: () => ({ document: null, automationAvailable: true }) });
    servers.push(server);
    return server;
  }
  const server = await start(automation);
  return { directory, server, start,
    options: { sessionDirectory: directory, instanceId: server.session.instanceId } };
}

async function completed(session, id) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const response = await send(session, 'GET', '/operations/' + id);
    if (!['queued', 'running'].includes(response.body.state)) return response.body;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Operation did not complete: ' + id);
}

test('HTTP bridge refuses absent credentials, browser origins and unknown methods before invoking automation', async (t) => {
  let calls = 0;
  const { server } = await fixture(t, { inspect() { calls += 1; return {}; } });
  const { session } = server;
  const body = { id: 'request_auth_01', method: 'inspect', payload: {} };
  assert.equal((await send(session, 'POST', '/invoke', body, { Authorization: '' })).status, 403);
  assert.equal((await send(session, 'POST', '/invoke', body, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await send(session, 'POST', '/invoke', body, { Origin: 'null' })).status, 403);
  assert.equal((await send(session, 'POST', '/invoke', { ...body, method: 'evalScript' })).status, 400);
  assert.equal((await send(session, 'GET', '/not-a-route')).status, 404);
  assert.equal(calls, 0);
});

test('same request ID returns the original operation and rejects different payloads without duplicate mutation', async (t) => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const { server } = await fixture(t, { async applyConfirmedStructurePlan(payload) {
    calls += 1; entered.resolve(); await release.promise; return { layers: [42], confirmationId: payload.confirmationId };
  } });
  const body = { id: 'request_once_01', method: 'applyConfirmedStructurePlan', payload: { confirmationId: 'confirmed' } };
  const accepted = await send(server.session, 'POST', '/invoke', body);
  assert.equal(accepted.status, 202);
  await entered.promise;
  const duplicate = await send(server.session, 'POST', '/invoke', body);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.id, body.id);
  assert.equal((await send(server.session, 'POST', '/invoke', { ...body, payload: { confirmationId: 'different' } })).status, 409);
  assert.equal(calls, 1);
  release.resolve();
  const result = await completed(server.session, body.id);
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(result.result, { layers: [42], confirmationId: 'confirmed' });
  const replay = await send(server.session, 'POST', '/invoke', body);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.result, result.result);
  assert.equal(calls, 1);
});

test('command execution stays serial while requests are accepted concurrently', async (t) => {
  const entered = deferred();
  const release = deferred();
  const order = [];
  const { server } = await fixture(t, { async execute(payload) {
    order.push('start:' + payload.name);
    if (payload.name === 'one') { entered.resolve(); await release.promise; }
    order.push('end:' + payload.name);
    return payload.name;
  } });
  await send(server.session, 'POST', '/invoke', { id: 'serial_request_1', method: 'execute', payload: { name: 'one' } });
  await entered.promise;
  const second = await send(server.session, 'POST', '/invoke', { id: 'serial_request_2', method: 'execute', payload: { name: 'two' } });
  assert.equal(second.status, 202);
  assert.equal(second.body.state, 'queued');
  assert.deepEqual(order, ['start:one']);
  release.resolve();
  await completed(server.session, 'serial_request_2');
  assert.deepEqual(order, ['start:one', 'end:one', 'start:two', 'end:two']);
});

test('MCP discovery and check only read existing sessions without creating a host or session directory', async (t) => {
  let mutations = 0;
  const { server, directory, options } = await fixture(t, { inspect() { mutations += 1; } });
  const found = await discover(options);
  assert.equal(found.session.instanceId, server.session.instanceId);
  const status = await invokeCepRunner({ ...options, operation: 'status', checkOnly: true });
  assert.equal(status.transport, 'cep');
  assert.equal(status.ready, true);
  assert.equal(mutations, 0);
  const absentDirectory = path.join(directory, 'does-not-exist');
  await assert.rejects(invokeCepRunner({ sessionDirectory: absentDirectory, operation: 'status', checkOnly: true }), /检查不会启动/);
  await assert.rejects(fs.stat(absentDirectory), { code: 'ENOENT' });
});

test('MCP rejects ambiguous instances and accepts an explicitly selected instance', async (t) => {
  const { server, start, directory } = await fixture(t, {});
  await start({});
  await assert.rejects(discover({ sessionDirectory: directory }), /多个 PSD2UI CEP 实例/);
  const selected = await discover({ sessionDirectory: directory, instanceId: server.session.instanceId });
  assert.equal(selected.session.instanceId, server.session.instanceId);
});

test('a client timeout keeps request identity and the completed receipt can be queried after disconnect', async (t) => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const { server, options } = await fixture(t, { async exportBundle() {
    calls += 1; entered.resolve(); await release.promise; return { bundle: 'complete.json' };
  } });
  const requestId = 'timeout_request_1';
  const invocation = invokeCepRunner({ ...options, operation: 'invoke', method: 'exportBundle',
    payload: {}, requestId, timeoutMilliseconds: 10 });
  const rejected = assert.rejects(invocation, (error) =>
    error.code === 'PSD2UI_RESULT_UNKNOWN' && error.requestId === requestId
      && error.instanceId === server.session.instanceId);
  await entered.promise;
  await rejected;
  assert.equal(calls, 1);
  release.resolve();
  await completed(server.session, requestId);
  server.close();
  const receipt = await queryOperation({ ...options, requestId });
  assert.equal(receipt.state, 'succeeded');
  assert.deepEqual(receipt.result, { bundle: 'complete.json' });
  assert.equal(calls, 1);
});

test('a disconnected active operation is never resubmitted and remains queryable from its receipt', async (t) => {
  const entered = deferred();
  const release = deferred();
  const finished = deferred();
  let calls = 0;
  const { server, options } = await fixture(t, { async execute() {
    calls += 1; entered.resolve(); await release.promise; finished.resolve(); return { changed: true };
  } });
  const requestId = 'disconnect_request_1';
  const invocation = invokeCepRunner({ ...options, operation: 'invoke', method: 'execute', payload: {}, requestId });
  const rejected = assert.rejects(invocation, (error) => error.code === 'PSD2UI_RESULT_UNKNOWN');
  await entered.promise;
  // The accepted operation continues independently of the HTTP connection.
  server.close();
  release.resolve();
  await finished.promise;
  await rejected;
  const receipt = await queryOperation({ ...options, requestId });
  assert.equal(receipt.state, 'succeeded');
  assert.deepEqual(receipt.result, { changed: true });
  assert.equal(calls, 1);
});

test('old queued/running receipts are unknown and completed errors retain their failure details', async (t) => {
  const { server, options } = await fixture(t, {});
  const id = 'orphan_request_1';
  const receiptPath = path.join(server.journal, id + '.json');
  server.close();
  for (const state of ['queued', 'running', 'unknown']) {
    await fs.writeFile(receiptPath, JSON.stringify({ id, state }));
    assert.equal((await queryOperation({ ...options, requestId: id })).state, 'unknown');
  }
  await fs.writeFile(receiptPath, JSON.stringify({ id, state: 'failed', error: { code: 'PLAN_INVALID', message: 'Selection changed' } }));
  const failed = await queryOperation({ ...options, requestId: id });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error.code, 'PLAN_INVALID');
  await assert.rejects(queryOperation({ ...options, requestId: 'missing_receipt' }), (error) => error.code === 'PSD2UI_RESULT_UNKNOWN');
});

test('host completion uncertainty remains unknown in both HTTP and journal responses', async (t) => {
  const { server, options } = await fixture(t, { execute() {
    const error = new Error('Photoshop callback timed out after command submission');
    error.code = 'CEP_HOST_RESULT_UNKNOWN';
    throw error;
  } });
  const requestId = 'uncertain_host_1';
  await send(server.session, 'POST', '/invoke', { id: requestId, method: 'execute', payload: {} });
  const operation = await completed(server.session, requestId);
  assert.equal(operation.state, 'unknown');
  server.close();
  assert.equal((await queryOperation({ ...options, requestId })).state, 'unknown');
});

for (const wrapperThrows of [true, false]) test(`host uncertainty survives swallowed or replaced errors: ${wrapperThrows}`, async (t) => {
  const { server } = await fixture(t, { execute() {
    if (wrapperThrows) throw new Error('Manifest recovery failed');
    return { partial: true };
  } }, { isUncertain: () => true });
  const id = 'wrapped_unknown_1';
  await send(server.session, 'POST', '/invoke', { id, method: 'execute', payload: {} });
  assert.equal((await completed(server.session, id)).state, 'unknown');
});

test('structural diagnostics survive the receipt and reach the MCP error', async (t) => {
  const issue = { code: 'PSD2UI_STRUCTURE_ROLE_MISSING', nodeId: 'button-7', message: '按钮背景图层已删除。' };
  const { server, options } = await fixture(t, { execute() {
    const error = new Error('结构操作新增了组件引用错误。');
    error.code = 'PSD2UI_STRUCTURE_EDIT_INVALID'; error.issues = [issue]; throw error;
  } });
  const requestId = 'structure_error_1';
  await assert.rejects(invokeCepRunner({ ...options, requestId, operation: 'invoke', method: 'execute', payload: {} }), error => {
    assert.equal(error.code, 'PSD2UI_STRUCTURE_EDIT_INVALID');
    assert.deepEqual(error.issues, [issue]);
    assert.match(error.message, /button-7.*按钮背景/);
    return true;
  });
  assert.deepEqual((await queryOperation({ ...options, requestId })).error.issues, [issue]);
});
