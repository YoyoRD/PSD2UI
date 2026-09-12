'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyExtendScript } = require('../../scripts/build-cep');

test('ExtendScript validation catches parser differences reproduced in real Photoshop', () => {
  assert.throws(() => verifyExtendScript('var x = a ? b : c ? d : e;'), /嵌套条件/);
  assert.doesNotThrow(() => verifyExtendScript('var x = a ? b : (c ? d : e);'));
  assert.throws(() => verifyExtendScript('var x = /[/]/;'), /正则字符类/);
  assert.doesNotThrow(() => verifyExtendScript('var x = /[\\/]/;'));
  assert.throws(() => verifyExtendScript('var x = () => 1;'));
});
