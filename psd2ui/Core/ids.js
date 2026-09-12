'use strict';

let sequence = 0;

function createId(prefix) {
  sequence += 1;
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0');
  return `${prefix}-${time}-${sequence.toString(36)}-${random}`;
}

module.exports = { createId };
