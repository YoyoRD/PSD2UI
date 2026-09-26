'use strict';

const fs = require('./native').requireNative('fs');
const NamespaceUri = 'https://yoyoengine.dev/psd2ui/1.0/';
const NamespacePrefix = 'yoyoPsd2ui';
const PropertyName = 'Manifest';
const manifests = new WeakMap();

function metadataRevision(document) {
  const core = photoshop().core;
  return core && typeof core.getMetadataRevision === 'function' ? core.getMetadataRevision(document) : null;
}
function contentToken(document) {
  const core = photoshop().core;
  return core && typeof core.getContentToken === 'function' ? core.getContentToken(document) : null;
}
function remember(document, manifest, serialized) {
  const revision = metadataRevision(document);
  if (revision != null) manifests.set(document, { path: document.path, revision,
    serialized: serialized === undefined ? JSON.stringify(manifest) : serialized });
}
function assertManifestUnchanged(manifest, serialized) {
  if (JSON.stringify(manifest) !== serialized) throw new Error('保存期间组件配置已变化，已停止发布保存结果，请重新保存。');
}
function receipt(document, manifest, sidecarPath, serialized) {
  assertManifestUnchanged(manifest, serialized);
  remember(document, manifest, serialized);
  const result = { sidecarPath };
  // 只在进程内传递已校验结果，避免再次跨宿主读取整份配置。
  Object.defineProperty(result, 'verifiedManifest', { get() {
    return JSON.stringify(manifest) === serialized ? manifest : null;
  } });
  return result;
}

function photoshop() { return require('./photoshop'); }
function fileCall(method, args) {
  return new Promise(function (resolve, reject) {
    fs[method].apply(fs, args.concat(function (error, result) {
      if (error) reject(error); else resolve(result);
    }));
  });
}

function requireLocalDocument() {
  const document = photoshop().app.activeDocument;
  if (!document) throw new Error('当前没有打开的 Photoshop 文档。');
  if (!String(document.path || '') || /^cloud:/i.test(document.path)) {
    throw new Error('PSD2UI 配置镜像要求先把 PSD 保存为本地文件。');
  }
  return document;
}

function assertActiveDocument(document) {
  if (String(requireLocalDocument().id) !== String(document.id)) {
    throw new Error('保存配置期间切换了 PSD，已停止写入，请回到原文档重试。');
  }
}

function getSidecarPath(document) {
  const nativePath = String((document || requireLocalDocument()).path || '');
  if (!nativePath) throw new Error('无法取得当前 PSD 的本地路径。');
  return /\.[^./\\]+$/.test(nativePath)
    ? nativePath.replace(/\.[^./\\]+$/, '.psd2ui.authoring.json')
    : nativePath + '.psd2ui.authoring.json';
}

async function getDocumentXmp(document) {
  const source = document || requireLocalDocument();
  const result = await photoshop().invoke('getXmp', { documentID: source.id });
  return typeof result === 'string' ? result : result && result.rawXmp || '';
}

async function setDocumentXmp(rawXmp, document) {
  const source = document || requireLocalDocument();
  manifests.delete(source);
  await photoshop().invoke('setXmp', { documentID: source.id, rawXmp: String(rawXmp || '') });
}

async function readManifest(document, options) {
  const source = document || requireLocalDocument();
  const revision = metadataRevision(source), cached = manifests.get(source);
  if (!(options && options.fresh) && revision != null && cached && cached.path === source.path && cached.revision === revision) {
    return JSON.parse(cached.serialized);
  }
  const result = await photoshop().invoke('readManifest', { documentID: source.id, serialized: true });
  const manifest = typeof result === 'string' ? JSON.parse(result) : result || null;
  if (revision === metadataRevision(source)) remember(source, manifest);
  return manifest;
}

async function writeSidecar(manifest, document) {
  const sidecarPath = getSidecarPath(document);
  const serialized = JSON.stringify(manifest, null, 2);
  await fileCall('writeFile', [sidecarPath, serialized, { encoding: 'utf8' }]);
  if (await fileCall('readFile', [sidecarPath, 'utf8']) !== serialized) {
    throw new Error('同目录配置文件写入后读回不一致：' + sidecarPath);
  }
  return sidecarPath;
}

async function readSidecarManifest(document) {
  const sidecarPath = getSidecarPath(document);
  try {
    return { path: sidecarPath, manifest: JSON.parse(await fileCall('readFile', [sidecarPath, 'utf8'])) };
  } catch (_) { return { path: sidecarPath, manifest: null }; }
}

async function readSidecarRaw(document) {
  const sidecarPath = getSidecarPath(document);
  try {
    return { path: sidecarPath, exists: true, serialized: await fileCall('readFile', [sidecarPath, 'utf8']) };
  } catch (error) {
    // An unreadable existing mirror cannot be treated as a nonexistent backup.
    if (error.code !== 'ENOENT') throw error;
    return { path: sidecarPath, exists: false, serialized: null };
  }
}

async function restoreSidecarRaw(backup) {
  if (!backup || !backup.path) throw new Error('恢复同目录配置时缺少备份路径。');
  if (!backup.exists) {
    try { await fileCall('unlink', [backup.path]); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  await fileCall('writeFile', [backup.path, backup.serialized, { encoding: 'utf8' }]);
  if (await fileCall('readFile', [backup.path, 'utf8']) !== backup.serialized) {
    throw new Error('恢复同目录配置后读回不一致：' + backup.path);
  }
}

async function writeManifestInCurrentModal(manifest, saveDocument) {
  const document = requireLocalDocument();
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('组件配置必须是 JSON 对象。');
  const serializedManifest = JSON.stringify(manifest);
  assertActiveDocument(document);
  manifests.delete(document);
  const acknowledged = await photoshop().invoke('writeManifest', {
    documentID: document.id, serializedManifest, namespaceUri: NamespaceUri,
    namespacePrefix: NamespacePrefix, propertyName: PropertyName, validated: true
  });
  assertActiveDocument(document);
  if (!acknowledged || acknowledged.verified !== true || String(acknowledged.documentId) !== String(document.id)
      || acknowledged.serializedLength !== serializedManifest.length) {
    const verified = await readManifest(document, { fresh: true });
    if (JSON.stringify(verified) !== serializedManifest) {
      throw new Error('PSD Manifest 写入后读回不一致，已停止保存文档。');
    }
  }
  assertActiveDocument(document);
  assertManifestUnchanged(manifest, serializedManifest);
  const sidecarPath = await writeSidecar(JSON.parse(serializedManifest), document);
  assertActiveDocument(document);
  if (saveDocument !== false) await document.save();
  return receipt(document, manifest, sidecarPath, serializedManifest);
}

async function writeManifest(manifest, saveDocument) {
  const document = requireLocalDocument();
  const expectedToken = contentToken(document);
  const serializedManifest = JSON.stringify(manifest);
  const originalXmp = await getDocumentXmp(document);
  assertActiveDocument(document);
  const originalSidecar = await readSidecarRaw(document);
  return photoshop().core.executeAsModal(async function () {
    assertActiveDocument(document);
    if (expectedToken != null && contentToken(document) !== expectedToken) {
      throw new Error('等待保存期间 PSD 图层已变化，已停止写入，请重新保存组件配置。');
    }
    assertManifestUnchanged(manifest, serializedManifest);
    let saveAttempted = false;
    try {
      const result = await writeManifestInCurrentModal(manifest, false);
      if (saveDocument !== false) {
        assertActiveDocument(document);
        saveAttempted = true;
        await document.save();
      }
      return receipt(document, manifest, result.sidecarPath, serializedManifest);
    } catch (error) {
      manifests.delete(document);
      const rollbackErrors = [];
      // The original document ID is pinned even if another document became active.
      try { await setDocumentXmp(originalXmp, document); }
      catch (rollbackError) { rollbackErrors.push('PSD XMP：' + (rollbackError.message || rollbackError)); }
      try { await restoreSidecarRaw(originalSidecar); }
      catch (rollbackError) { rollbackErrors.push('同目录配置镜像：' + (rollbackError.message || rollbackError)); }
      if (saveAttempted) {
        try { await document.save(); }
        catch (rollbackError) { rollbackErrors.push('PSD 保存：' + (rollbackError.message || rollbackError)); }
      }
      try {
        if (await getDocumentXmp(document) !== originalXmp) throw new Error('原始 XMP 字节不一致。');
        const restoredSidecar = await readSidecarRaw(document);
        if (restoredSidecar.exists !== originalSidecar.exists || restoredSidecar.serialized !== originalSidecar.serialized) {
          throw new Error('原始同目录配置镜像不一致。');
        }
      } catch (rollbackError) { rollbackErrors.push('回滚读回：' + (rollbackError.message || rollbackError)); }
      if (rollbackErrors.length) {
        throw new Error((error.message || error) + '\nManifest 回滚失败：' + rollbackErrors.join('；'));
      }
      throw error;
    }
  }, { commandName: 'PSD2UI：保存文档配置与同目录镜像', metadataOnly: true });
}

module.exports = {
  NamespaceUri, getSidecarPath, getDocumentXmp, setDocumentXmp,
  readManifest, readSidecarManifest, readSidecarRaw, restoreSidecarRaw,
  writeManifest, writeManifestInCurrentModal
};
