'use strict';

// This transport is the CEP host API, not a developer-tools/debugging connection.
function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requestJson(method, params) {
  if (typeof method !== 'string' || !method) throw new TypeError('Photoshop RPC method 不能为空。');
  return JSON.stringify({ method, params: params || {}, deferState: true });
}
function inlineScript(json) {
  // The outer JSON literal is parsed by ES3 ExtendScript, where these two
  // characters are line terminators even inside a quoted string.
  const literal = JSON.stringify(json).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '$.PSD2UIHost.dispatch(' + literal + ')';
}
function scriptForRequest(method, params) { return inlineScript(requestJson(method, params)); }

function parseResponse(raw) {
  let response;
  try { response = JSON.parse(String(raw)); } catch (error) {
    throw errorWithCode('Photoshop CEP 宿主未返回有效 JSON：' + String(raw).slice(0, 500), 'CEP_HOST_RESPONSE_INVALID');
  }
  if (!response || typeof response.ok !== 'boolean') {
    throw errorWithCode('Photoshop CEP 宿主响应缺少 ok 字段。', 'CEP_HOST_RESPONSE_INVALID');
  }
  return response;
}

function prepareRequest(json) {
  if (json.length < 32768) return { script: inlineScript(json), dispose() {} };
  // ExtendScript compiles large escaped literals very slowly. Pass JSON as data
  // through a private temporary file; only the short path is compiled as script.
  const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
  const directory = path.join(os.tmpdir(), 'PSD2UI-CEP-rpc');
  try { fs.mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const file = path.join(directory, crypto.randomBytes(16).toString('hex') + '.json');
  fs.writeFileSync(file, json, { encoding: 'utf8', flag: 'wx' });
  return {
    script: '$.PSD2UIHost.dispatchFile(' + JSON.stringify(file.replace(/\\/g, '/')).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ')',
    dispose() { try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') console.error('CEP 请求临时文件清理失败：', error.message); } }
  };
}

function createHostRpc(options) {
  const configuration = options || {};
  const timeoutMilliseconds = configuration.timeoutMilliseconds == null ? 600000 : Number(configuration.timeoutMilliseconds);
  if (!(timeoutMilliseconds > 0 && Number.isFinite(timeoutMilliseconds))) {
    throw new TypeError('Photoshop RPC timeoutMilliseconds 必须为正数。');
  }
  let tail = Promise.resolve();
  let uncertain = null;

  function evaluate(script) {
    if (uncertain) return Promise.reject(uncertain);
    const bridge = configuration.evalScript || (typeof window !== 'undefined'
      && window.__adobe_cep__ && window.__adobe_cep__.evalScript.bind(window.__adobe_cep__));
    if (typeof bridge !== 'function') {
      return Promise.reject(errorWithCode('Photoshop CEP evalScript 接口不可用，请在 Photoshop 中打开 PSD2UI CEP 面板。', 'CEP_HOST_UNAVAILABLE'));
    }
    return new Promise((resolve, reject) => {
      let completed = false;
      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        uncertain = errorWithCode(
          'Photoshop 宿主调用超时，操作结果未知；未取消或重发操作。请检查 Photoshop 和 PSD 后重新连接。',
          'CEP_HOST_RESULT_UNKNOWN');
        reject(uncertain);
      }, timeoutMilliseconds);
      try {
        bridge(script, (raw) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          try { resolve(parseResponse(raw)); } catch (error) {
            uncertain = errorWithCode('Photoshop 返回无法识别的操作结果，结果未知；未重发操作。'
              + error.message, 'CEP_HOST_RESULT_UNKNOWN');
            reject(uncertain);
          }
        });
      } catch (error) {
        completed = true;
        clearTimeout(timer);
        reject(errorWithCode('Photoshop CEP 调用失败：' + error.message, 'CEP_HOST_UNAVAILABLE'));
      }
    });
  }

  return {
    invoke(method, params) {
      let json;
      try { json = requestJson(method, params); } catch (error) { return Promise.reject(error); }
      const result = tail.then(async () => {
        if (uncertain) throw uncertain;
        const request = prepareRequest(json);
        try { return await evaluate(request.script); }
        finally {
          // A timed-out host may still be reading. Retain its request rather than
          // turn an unknown result into an input-file race or retry the mutation.
          if (!uncertain) request.dispose();
        }
      });
      tail = result.catch(() => {});
      return result;
    },
    isUncertain() { return Boolean(uncertain); }
  };
}

const defaultRpc = createHostRpc();
module.exports = { createHostRpc, scriptForRequest, parseResponse, invoke: defaultRpc.invoke,
  isUncertain: defaultRpc.isUncertain };
