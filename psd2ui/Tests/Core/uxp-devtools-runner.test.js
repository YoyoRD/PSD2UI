'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CdpClient } = require('../../scripts/uxp-devtools-runner');

test('UDT waits for app.js automation registration after the UXP context becomes available', async () => {
  const client = Object.create(CdpClient.prototype);
  let attempts = 0;
  client.evaluate = async () => ++attempts >= 2;
  client._eventBacklog = new Map();
  await client.waitForAutomation(1000);
  assert.equal(attempts, 2);
});

test('UDT reports the real UXP startup exception when app.js never registers automation', async () => {
  const client = Object.create(CdpClient.prototype);
  client.evaluate = async () => false;
  client._eventBacklog = new Map([['Runtime.exceptionThrown', [{ exceptionDetails: {
    exception: { description: 'TypeError: Cannot read properties of null at app.js:42' }
  } }]]]);
  await assert.rejects(client.waitForAutomation(2), /面板启动未就绪[\s\S]*app.js:42/);
});
