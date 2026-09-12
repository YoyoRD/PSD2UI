'use strict';

class Psd2UiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'Psd2UiError';
    this.code = code;
    this.details = details || null;
  }
}

function fail(code, message, details) {
  throw new Psd2UiError(code, message, details);
}

module.exports = { Psd2UiError, fail };
