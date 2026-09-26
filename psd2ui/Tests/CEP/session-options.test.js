'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSessionOptions, verifySessionIdentity } = require('../../scripts/cep-session-options');

test('session acceptance selects the explicit Photoshop COM version before any fixture work', () => {
  assert.deepEqual(parseSessionOptions(['--prog-id', 'Photoshop.Application.140', 'output']),
    { output: 'output', progId: 'Photoshop.Application.140', expectedVersionMajor: 21 });
  assert.deepEqual(parseSessionOptions(['output', '--prog-id', 'Photoshop.Application.190']),
    { output: 'output', progId: 'Photoshop.Application.190', expectedVersionMajor: 26 });
  assert.equal(parseSessionOptions([]).progId, 'Photoshop.Application');
  for (const args of [['--prog-id'], ['--prog-id', 'Photoshop.Application.190.1'], ['--unknown'], ['first', 'second'],
    ['--prog-id', 'Photoshop.Application.140', '--prog-id', 'Photoshop.Application.190']]) {
    assert.throws(() => parseSessionOptions(args));
  }
});

test('session acceptance rejects wrong versions and incomplete running application identities', () => {
  const options = parseSessionOptions(['--prog-id', 'Photoshop.Application.140']);
  const identity = { type: 'ready', progId: options.progId, photoshopVersion: '21.2', photoshopPath: 'D:/Photoshop2020/' };
  assert.equal(verifySessionIdentity(options, identity), identity);
  assert.throws(() => verifySessionIdentity(options, { ...identity, photoshopVersion: '26.8.0' }), /version mismatch/);
  assert.throws(() => verifySessionIdentity(options, { ...identity, progId: 'Photoshop.Application.190' }), /identify/);
  assert.throws(() => verifySessionIdentity(options, { ...identity, photoshopPath: '' }), /identify/);
  assert.throws(() => verifySessionIdentity(options, { ...identity, photoshopVersion: 'unknown' }), /identify/);
});
