'use strict';

const { createId } = require('./ids');

function normalizeDocumentPath(path) {
  return String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function bindDocumentIdentity(manifest, documentInfo, options) {
  if (!manifest || !manifest.document) throw new Error('PSD 配置缺少 document。');
  const path = normalizeDocumentPath(documentInfo && documentInfo.path);
  const name = String(documentInfo && documentInfo.name || '').trim();
  if (!path || !name) throw new Error('PSD 文件路径或名称不可用，无法绑定文档身份。');
  const source = manifest.document;
  const previousPath = normalizeDocumentPath(source.sourcePath);
  const copied = previousPath ? previousPath !== path : String(source.name || '') !== name;
  const changed = copied || source.name !== name || source.sourcePath !== path;
  if (!changed) return { manifest, copied: false, changed: false };
  const idFactory = options && options.idFactory || createId;
  const document = { ...source, name, sourcePath: path };
  if (copied) document.id = idFactory('document');
  return { manifest: { ...manifest, document }, copied, changed: true };
}

module.exports = { bindDocumentIdentity, normalizeDocumentPath };
