'use strict';
// CEP 9 is Chromium 61 / Node 8.6. Keep modern source in the shared package.
if (typeof window !== 'undefined' && typeof window.globalThis === 'undefined') window.globalThis = window;
if (!Object.fromEntries) Object.fromEntries = function (entries) {
  const result = {};
  for (const entry of entries) Object.defineProperty(result, entry[0], { value: entry[1], enumerable: true, writable: true, configurable: true });
  return result;
};
if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, 'flatMap', { configurable: true, writable: true, value: function (fn, receiver) {
  return this.reduce((result, value, index) => result.concat(fn.call(receiver, value, index, this)), []);
} });
