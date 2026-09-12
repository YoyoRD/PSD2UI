'use strict';

const { app, action, core } = require('photoshop');
const fileSystem = require('fs');

const NamespaceUri = 'https://yoyoengine.dev/psd2ui/1.0/';
const NamespacePrefix = 'yoyoPsd2ui';
const PropertyName = 'Manifest';

function requireLocalDocument() {
  const document = app.activeDocument;
  if (!document) throw new Error('当前没有打开的 Photoshop 文档。');
  const nativePath = String(document.path || '');
  if (!nativePath || /^cloud:/i.test(nativePath)) {
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
    : `${nativePath}.psd2ui.authoring.json`;
}

function toFileUrl(nativePath) {
  const normalized = String(nativePath).replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) ? `file:/${normalized}` : `file:${normalized}`;
}

async function getDocumentXmp() {
  const document = requireLocalDocument();
  const result = await action.batchPlay([{
    _obj: 'get',
    _target: {
      _ref: [
        { _property: 'XMPMetadataAsUTF8' },
        { _ref: 'document', _id: document.id }
      ]
    }
  }], {});
  return result && result[0] ? result[0].XMPMetadataAsUTF8 || '' : '';
}

async function setDocumentXmp(rawXmp) {
  const document = requireLocalDocument();
  await action.batchPlay([{
    _obj: 'set',
    _target: [
      { _ref: 'property', _property: 'XMPMetadataAsUTF8' },
      { _ref: 'document', _id: document.id }
    ],
    to: {
      _obj: 'document',
      XMPMetadataAsUTF8: rawXmp
    },
    _options: { dialogOptions: 'dontDisplay' }
  }], {});
}

function getXmpApi() {
  const xmpApi = require('uxp').xmp;
  if (!xmpApi || !xmpApi.XMPMeta) {
    throw new Error('当前 Photoshop 未提供 UXP XMP API；最低要求为 Photoshop 25.0。');
  }
  xmpApi.XMPMeta.registerNamespace(NamespaceUri, NamespacePrefix);
  return xmpApi;
}

async function readManifest() {
  const raw = await getDocumentXmp();
  if (!raw) return null;
  const { XMPMeta } = getXmpApi();
  const metadata = new XMPMeta(raw);
  const property = metadata.getProperty(NamespaceUri, PropertyName);
  if (!property || !property.value) return null;
  return JSON.parse(property.value);
}

async function writeSidecar(manifest, document) {
  const sidecarPath = getSidecarPath(document);
  const serialized = JSON.stringify(manifest, null, 2);
  const url = toFileUrl(sidecarPath);
  await fileSystem.writeFile(url, serialized, { encoding: 'utf-8' });
  const verified = await fileSystem.readFile(url, { encoding: 'utf-8' });
  if (verified !== serialized) {
    throw new Error(`同目录配置文件写入后读回不一致：${sidecarPath}`);
  }
  return sidecarPath;
}

async function readSidecarManifest(document) {
  const sidecarPath = getSidecarPath(document);
  try {
    const serialized = await fileSystem.readFile(toFileUrl(sidecarPath), { encoding: 'utf-8' });
    return { path: sidecarPath, manifest: JSON.parse(serialized) };
  } catch (error) {
    return { path: sidecarPath, manifest: null };
  }
}

async function readSidecarRaw(document) {
  const sidecarPath = getSidecarPath(document);
  try {
    const serialized = await fileSystem.readFile(toFileUrl(sidecarPath), { encoding: 'utf-8' });
    return { path: sidecarPath, exists: true, serialized };
  } catch (error) {
    return { path: sidecarPath, exists: false, serialized: null };
  }
}

async function restoreSidecarRaw(backup) {
  if (!backup || !backup.path) throw new Error('恢复同目录配置时缺少备份路径。');
  const url = toFileUrl(backup.path);
  if (!backup.exists) {
    try {
      await fileSystem.unlink(url);
    } catch (error) {
      // 原文件本来不存在；重复恢复保持幂等。
    }
    return;
  }
  await fileSystem.writeFile(url, backup.serialized, { encoding: 'utf-8' });
  const verified = await fileSystem.readFile(url, { encoding: 'utf-8' });
  if (verified !== backup.serialized) {
    throw new Error(`恢复同目录配置后读回不一致：${backup.path}`);
  }
}

async function writeManifestInCurrentModal(manifest, saveDocument) {
  const document = requireLocalDocument();
  const raw = await getDocumentXmp();
  assertActiveDocument(document);
  const { XMPMeta } = getXmpApi();
  const metadata = raw ? new XMPMeta(raw) : new XMPMeta();
  const serializedManifest = JSON.stringify(manifest);
  metadata.setProperty(NamespaceUri, PropertyName, serializedManifest);
  await setDocumentXmp(metadata.serialize());

  const verifiedRaw = await getDocumentXmp();
  const verifiedMetadata = new XMPMeta(verifiedRaw);
  const verifiedProperty = verifiedMetadata.getProperty(NamespaceUri, PropertyName);
  if (!verifiedProperty || verifiedProperty.value !== serializedManifest) {
    throw new Error('PSD Manifest 写入后读回不一致，已停止保存文档。');
  }

  const sidecarPath = await writeSidecar(manifest, document);
  if (saveDocument !== false) await document.save();
  return { sidecarPath };
}

async function writeManifest(manifest, saveDocument) {
  const document = requireLocalDocument();
  const originalXmp = await getDocumentXmp();
  assertActiveDocument(document);
  const originalSidecar = await readSidecarRaw(document);
  return core.executeAsModal(async () => {
    assertActiveDocument(document);
    let saveAttempted = false;
    try {
      const result = await writeManifestInCurrentModal(manifest, false);
      if (saveDocument !== false) {
        saveAttempted = true;
        await document.save();
      }
      return result;
    } catch (error) {
      const rollbackErrors = [];
      try { await setDocumentXmp(originalXmp); } catch (rollbackError) {
        rollbackErrors.push(`PSD XMP：${rollbackError.message || rollbackError}`);
      }
      try { await restoreSidecarRaw(originalSidecar); } catch (rollbackError) {
        rollbackErrors.push(`同目录配置镜像：${rollbackError.message || rollbackError}`);
      }
      if (saveAttempted) {
        try { await document.save(); } catch (rollbackError) {
          rollbackErrors.push(`PSD 保存：${rollbackError.message || rollbackError}`);
        }
      }
      try {
        const restoredXmp = await getDocumentXmp();
        if (restoredXmp !== originalXmp) throw new Error('原始 XMP 字节不一致。');
        const restoredSidecar = await readSidecarRaw(document);
        if (restoredSidecar.exists !== originalSidecar.exists
          || restoredSidecar.serialized !== originalSidecar.serialized) {
          throw new Error('原始同目录配置镜像不一致。');
        }
      } catch (rollbackError) {
        rollbackErrors.push(`回滚读回：${rollbackError.message || rollbackError}`);
      }
      if (rollbackErrors.length > 0) {
        throw new Error(`${error.message || error}\nManifest 回滚失败：${rollbackErrors.join('；')}`);
      }
      throw error;
    }
  }, { commandName: 'PSD2UI：保存文档配置与同目录镜像' });
}

module.exports = {
  NamespaceUri,
  getSidecarPath,
  getDocumentXmp,
  setDocumentXmp,
  readManifest,
  readSidecarManifest,
  readSidecarRaw,
  restoreSidecarRaw,
  writeManifest,
  writeManifestInCurrentModal
};
