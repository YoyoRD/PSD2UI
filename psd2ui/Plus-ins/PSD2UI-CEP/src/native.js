'use strict';

// CEP supplies its own Node runtime. Never resolve these modules through the
// panel's bundled CommonJS module table.
function requireNative(name) {
  if (typeof cep_node !== 'undefined' && cep_node && typeof cep_node.require === 'function') {
    return cep_node.require(name);
  }
  if (typeof window !== 'undefined' && window.cep_node && typeof window.cep_node.require === 'function') {
    return window.cep_node.require(name);
  }
  if (typeof require === 'function') return require(name);
  throw new Error('[PSD2UI_CEP_NODE_UNAVAILABLE] CEP 未启用内置 Node.js。');
}

module.exports = { requireNative };
