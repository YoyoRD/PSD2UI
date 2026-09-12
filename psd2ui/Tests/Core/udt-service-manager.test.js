'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensureService, waitForPhotoshop } = require('../../scripts/udt-service-manager');

async function serveVersion(t, statusCode, value) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { port: server.address().port, requests };
}

function startupFixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const prefix = 'psd2ui-udt-service-test-';
  const logDirectory = fs.mkdtempSync(path.join(temporaryRoot, prefix));
  t.after(() => {
    const resolved = path.resolve(logDirectory);
    assert.equal(path.dirname(resolved), temporaryRoot);
    assert.ok(path.basename(resolved).startsWith(prefix));
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const child = new EventEmitter();
  child.pid = 43210;
  child.killCount = 0;
  child.unrefCount = 0;
  child.kill = () => { child.killCount += 1; return true; };
  child.unref = () => { child.unrefCount += 1; };
  let elapsed = 0;
  const calls = [];
  const options = {
    port: 14001,
    executable: path.join(logDirectory, 'fake-udt.exe'),
    udtRoot: path.join(logDirectory, 'fake-udt'),
    workerPath: path.join(logDirectory, 'fake-worker.js'),
    logDirectory,
    timeoutMilliseconds: 250,
    idleMilliseconds: 12345
  };
  const dependencies = {
    spawn(executable, args, spawnOptions) {
      calls.push({ executable, args, options: spawnOptions });
      return child;
    },
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; }
  };
  return { child, calls, options, dependencies };
}

test('UDT manager reuses an HTTP-identified Adobe service without spawning or stopping it', async (t) => {
  const { port, requests } = await serveVersion(t, 200, { Browser: 'Adobe UXP/6.0.0' });
  let spawnCount = 0;
  const result = await ensureService({ port }, {
    spawn() { spawnCount += 1; throw new Error('Existing service must be reused.'); }
  });

  assert.equal(result.started, false);
  assert.equal(result.browser, 'Adobe UXP/6.0.0');
  assert.equal(spawnCount, 0);
  assert.deepEqual(requests, ['/json/version']);
  const second = await ensureService({ port, autoStart: false });
  assert.equal(second.started, false, 'Reusing the service must leave it running.');
});

test('UDT manager rejects an occupied non-Adobe HTTP service without spawning a replacement', async (t) => {
  const { port } = await serveVersion(t, 200, { Browser: 'Other application/1.0' });
  let spawnCount = 0;
  await assert.rejects(ensureService({ port }, {
    spawn() { spawnCount += 1; }
  }), /非 UDT 服务占用/);
  assert.equal(spawnCount, 0);
});

test('UDT manager starts a hidden Node worker and preserves its diagnostic output outside runner stdout', async (t) => {
  const fixture = startupFixture(t);
  const { child, calls, options, dependencies } = fixture;
  let probes = 0;
  const spawn = dependencies.spawn;
  dependencies.spawn = (...args) => {
    const spawned = spawn(...args);
    fs.writeSync(args[2].stdio[2], 'Worker startup diagnostic\n');
    return spawned;
  };
  dependencies.probe = async (port) => {
    assert.equal(port, options.port);
    probes += 1;
    return probes < 3 ? null : { port, browser: 'Adobe UXP/test' };
  };

  const result = await ensureService(options, dependencies);
  assert.equal(result.browser, 'Adobe UXP/test');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, options.executable);
  assert.deepEqual(calls[0].args, [
    options.workerPath, '--udt-root', options.udtRoot,
    '--port', String(options.port), '--idle-ms', String(options.idleMilliseconds)
  ]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio[0], 'ignore');
  assert.equal(calls[0].options.stdio[1], 'ignore');
  assert.match(fs.readFileSync(result.logPath, 'utf8'), /Worker startup diagnostic/);
  assert.equal(child.killCount, 0, 'A ready worker must survive the invoking runner.');
  assert.equal(child.unrefCount, 1);
});

test('UDT manager returns an exited worker error with its diagnostics and does not kill it again', async (t) => {
  const { child, options, dependencies } = startupFixture(t);
  let probes = 0;
  const spawn = dependencies.spawn;
  dependencies.spawn = (...args) => {
    const spawned = spawn(...args);
    fs.writeSync(args[2].stdio[2], 'Cannot load Adobe native helper\n');
    return spawned;
  };
  dependencies.probe = async () => {
    probes += 1;
    if (probes === 2) child.emit('exit', 7, null);
    return null;
  };

  await assert.rejects(ensureService(options, dependencies), (error) => {
    assert.match(error.message, /后台服务退出.*code=7/);
    assert.match(error.message, /Cannot load Adobe native helper/);
    assert.match(error.message, /诊断日志/);
    return true;
  });
  assert.equal(child.killCount, 0);
  assert.equal(child.unrefCount, 0);
});

test('UDT manager reports asynchronous spawn failure without trying to kill a process that did not start', async (t) => {
  const { child, options, dependencies } = startupFixture(t);
  let probes = 0;
  dependencies.probe = async () => {
    probes += 1;
    if (probes === 2) child.emit('error', new Error('spawn ENOENT'));
    return null;
  };

  await assert.rejects(ensureService(options, dependencies), /无法启动 UDT 后台服务.*spawn ENOENT/);
  assert.equal(child.killCount, 0);
  assert.equal(child.unrefCount, 0);
});

test('UDT manager kills only its own live worker when startup times out', async (t) => {
  const { child, calls, options, dependencies } = startupFixture(t);
  dependencies.probe = async () => null;

  await assert.rejects(ensureService(options, dependencies), /后台服务启动超时.*250 ms/);
  assert.equal(calls.length, 1);
  assert.equal(child.killCount, 1);
  assert.equal(child.unrefCount, 0);
});

test('UDT manager cleans up its own worker if readiness probing fails after spawning', async (t) => {
  const { child, options, dependencies } = startupFixture(t);
  let probes = 0;
  dependencies.probe = async () => {
    if (++probes === 1) return null;
    throw new Error('Port became occupied by another application');
  };

  await assert.rejects(ensureService(options, dependencies), /Port became occupied by another application/);
  assert.equal(child.killCount, 1);
  assert.equal(child.unrefCount, 0);
});

test('UDT manager accepts a concurrent winner even when its own worker has exited', async (t) => {
  const { child, options, dependencies } = startupFixture(t);
  let probes = 0;
  dependencies.probe = async (port) => {
    if (++probes === 1) return null;
    child.emit('exit', 0, null);
    return { port, browser: 'Adobe UXP/concurrent-winner' };
  };

  const result = await ensureService(options, dependencies);
  assert.equal(result.browser, 'Adobe UXP/concurrent-winner');
  assert.equal(child.killCount, 0, 'Losing startup must not terminate the winning service.');
});

test('UDT manager honors disabled automatic startup when no service is available', async () => {
  let spawnCount = 0;
  await assert.rejects(ensureService({ port: 14001, autoStart: false }, {
    probe: async () => null,
    spawn() { spawnCount += 1; }
  }), /后台自动启动已禁用/);
  assert.equal(spawnCount, 0);
});

test('Photoshop readiness returns immediately when PS is already connected', async () => {
  let queries = 0;
  let sleeps = 0;
  const manager = {
    getConnectedApps() {
      queries += 1;
      return [{ id: 'XD' }, { id: 'PS', name: 'Adobe Photoshop' }];
    }
  };

  await waitForPhotoshop(manager, 1000, {
    now: () => 0,
    sleep: async () => { sleeps += 1; }
  });
  assert.equal(queries, 1);
  assert.equal(sleeps, 0);
});

test('Photoshop readiness waits for the app discovery connection after the CLI service is ready', async () => {
  let elapsed = 0;
  let queries = 0;
  const manager = {
    getConnectedApps() {
      queries += 1;
      return elapsed >= 350 ? [{ id: 'PS' }] : [{ id: 'XD' }];
    }
  };

  await waitForPhotoshop(manager, 1000, {
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; }
  });
  assert.ok(queries > 1, 'An available CLI service must not count as an attached Photoshop app.');
  assert.ok(elapsed >= 350);
  assert.ok(elapsed <= 1000);
});

test('Photoshop readiness times out explicitly when only another Adobe app is connected', async () => {
  let elapsed = 0;
  const manager = { getConnectedApps: () => [{ id: 'XD' }] };

  await assert.rejects(waitForPhotoshop(manager, 550, {
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; }
  }), (error) => {
    assert.match(error.message, /UDT 后台服务已就绪/);
    assert.match(error.message, /Photoshop 在 550 ms 内尚未连接/);
    assert.match(error.message, /不会启动前台应用/);
    return true;
  });
  assert.equal(elapsed, 550);
});
