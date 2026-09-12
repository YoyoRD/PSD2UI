'use strict';

const { app, core, constants, imaging } = require('photoshop');
const { storage } = require('uxp');
const { findLayerById, openLocalDocument, asNumber } = require('./photoshopDocument');
const { assertUiResFolder } = require('./uiResPath');
const { collapseNineSlicePixels } = require('../generated/core/nineSlice');
const { parseResourceLayerName } = require('../generated/core/naming');

const FolderTokenKey = 'psd2ui.uires-token.v1';
const LegacyFolderTokenKey = 'yoyoengine.psd2ui.uires-token';
let exportInProgress = false;

function toFileUrl(nativePath) {
  const normalized = String(nativePath || '').replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) ? `file:/${normalized}` : `file:${normalized}`;
}

async function getRememberedUiResFolder() {
  const fileSystem = storage.localFileSystem;
  const token = localStorage.getItem(FolderTokenKey)
    || localStorage.getItem(LegacyFolderTokenKey);
  if (token) {
    try {
      const folder = assertUiResFolder(await fileSystem.getEntryForPersistentToken(token));
      if (!localStorage.getItem(FolderTokenKey)) {
        localStorage.setItem(FolderTokenKey, token);
        localStorage.removeItem(LegacyFolderTokenKey);
      }
      return folder;
    } catch (error) {
      localStorage.removeItem(FolderTokenKey);
      localStorage.removeItem(LegacyFolderTokenKey);
    }
  }
  return null;
}

async function chooseUiResFolder() {
  const fileSystem = storage.localFileSystem;
  const folder = assertUiResFolder(await fileSystem.getFolder());
  const persistentToken = await fileSystem.createPersistentToken(folder);
  localStorage.setItem(FolderTokenKey, persistentToken);
  localStorage.removeItem(LegacyFolderTokenKey);
  return folder;
}

function clearRememberedUiResFolder() {
  localStorage.removeItem(FolderTokenKey);
  localStorage.removeItem(LegacyFolderTokenKey);
}

async function resolveUiResFolder(options) {
  const input = options || {};
  if (input.uiResFolder) return assertUiResFolder(input.uiResFolder);

  if (String(input.uiResPath || '').trim()) {
    const explicitFolder = await storage.localFileSystem.getEntryWithUrl(
      toFileUrl(input.uiResPath));
    return assertUiResFolder(explicitFolder);
  }

  const remembered = await getRememberedUiResFolder();
  if (remembered) return remembered;
  throw new Error('请先在 PSD2UI 插件中选择并授权输出目录。');
}

function assertOutputName(name) {
  if (!name || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error(`[PSD2UI_OUTPUT_NAME_INVALID] 输出文件名无效：'${name || ''}'。`);
  }
}

function assertBundleOutputNames(bundle) {
  if (!bundle || !bundle.document || !bundle.document.id || !Array.isArray(bundle.resources)) {
    throw new Error('[PSD2UI_BUNDLE_INVALID] 缺少 Bundle 文档身份或资源数组。');
  }
  const jsonName = `${bundle.document.name}.psd2ui.json`;
  assertOutputName(jsonName);
  if (!String(bundle.document.name || '').trim()) throw new Error('[PSD2UI_OUTPUT_NAME_INVALID] 文档名不能为空。');
  const names = new Set([jsonName.toLowerCase()]);
  bundle.resources.forEach((resource) => {
    if (!['sprite', 'texture'].includes(resource.kind)) throw new Error('[PSD2UI_RESOURCE_KIND_INVALID] 图片类型必须为 sprite 或 texture。');
    resourceDirectory(resource);
    assertOutputName(resource.fileName);
    if (!resource.fileName.endsWith('.png') || names.has(resource.fileName.toLowerCase())) {
      throw new Error(`[PSD2UI_RESOURCE_NAME_CONFLICT] 输出图片名重复或扩展名无效：${resource.fileName}。`);
    }
    names.add(resource.fileName.toLowerCase());
    if (bundle.schemaVersion === '1.5.0') {
      const parsed = parseResourceLayerName(resource.fileName.slice(0, -4), resource.sourceLayerId);
      if (parsed.fileName !== resource.fileName || parsed.group !== resource.module || resource.scope !== 'module') {
        throw new Error(`[PSD2UI_SOURCE_RESOURCE_INVALID] '${resource.fileName}' 未保留源图片分组。`);
      }
      const ids = resource.sourceLayerIds;
      if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id)
          || new Set(ids).size !== ids.length || !ids.includes(resource.sourceLayerId)) {
        throw new Error(`[PSD2UI_RESOURCE_SOURCES_INVALID] '${resource.fileName}' 缺少唯一且包含主来源的 sourceLayerIds。`);
      }
    }
  });
}

function resourceIssue(code, message, resource) {
  const error = new Error(`[${code}] ${message}`);
  error.code = code;
  error.details = { resourceId: resource.id, sourceLayerId: resource.sourceLayerId,
    sourceLayerIds: resource.sourceLayerIds, fileName: resource.fileName };
  return error;
}

async function childFolder(parent, name, create = false) {
  if (!parent) return null;
  const found = (await parent.getEntries()).find(entry => entry.name.toLowerCase() === name.toLowerCase());
  if (found && !found.isFolder) throw new Error(`[PSD2UI_OUTPUT_PATH_CONFLICT] '${found.nativePath}' 应为目录。`);
  return found || (create ? await parent.createFolder(name) : null);
}

async function childFile(parent, name) {
  if (!parent) return null;
  const found = (await parent.getEntries()).find(entry => entry.name.toLowerCase() === name.toLowerCase());
  if (found && !found.isFile) throw new Error(`[PSD2UI_OUTPUT_PATH_CONFLICT] '${found.nativePath}' 应为文件。`);
  return found || null;
}

function resourceDirectory(resource) {
  if (!['sprite', 'texture'].includes(resource.kind)) throw new Error('[PSD2UI_RESOURCE_KIND_INVALID] 图片类型必须为 sprite 或 texture。');
  assertOutputName(resource.module);
  if (!/^[a-z][a-z0-9_-]*$/.test(resource.module)) {
    throw resourceIssue('PSD2UI_RESOURCE_MODULE_INVALID', `资源 '${resource.fileName}' 的模块目录无效：'${resource.module}'。`, resource);
  }
  return `${resource.kind}/${resource.module}`;
}

async function relativeFolder(parent, relative, create = false, created = []) {
  let current = parent;
  if (!relative) return current;
  for (const segment of relative.split('/')) {
    assertOutputName(segment);
    let next = await childFolder(current, segment);
    if (!next && create) { next = await childFolder(current, segment, true); created.push(next); }
    if (!next) return null;
    current = next;
  }
  return current;
}

// Match both Unity readers: root JSON prefers its legacy neighbour; json/ prefers module folders.
async function existingResourceFile(folder, resource, legacyJson) {
  const directory = resourceDirectory(resource);
  assertOutputName(resource.fileName);
  if (legacyJson) {
    const legacy = await childFile(folder, resource.fileName);
    if (legacy) return legacy;
  }
  return await childFile(await relativeFolder(folder, directory), resource.fileName)
    || await childFile(await childFolder(folder, resource.kind), resource.fileName);
}

function sameResourceSettings(left, right) {
  return left.kind === right.kind && ['left', 'top', 'right', 'bottom'].every(
    key => Number(left.sliceBorder && left.sliceBorder[key] || 0) === Number(right.sliceBorder && right.sliceBorder[key] || 0));
}

async function assertBundleOwnership(folder, bundle) {
  assertBundleOutputNames(bundle);
  const jsonName = `${bundle.document.name}.psd2ui.json`;
  const directories = { sprite: await childFolder(folder, 'sprite'), texture: await childFolder(folder, 'texture'),
    json: await childFolder(folder, 'json') };
  const records = [];
  const legacyJson = [];
  const entries = [...(await folder.getEntries()).map(entry => ({ entry, legacy: true })),
    ...(directories.json ? await directories.json.getEntries() : []).map(entry => ({ entry, legacy: false }))];
  for (const { entry, legacy } of entries) {
    const entryName = String(entry && entry.name || '');
    if (!entry || !entry.isFile || !entryName.toLowerCase().endsWith('.psd2ui.json')) continue;
    let existing;
    try {
      existing = JSON.parse(await entry.read({ format: storage.formats.utf8 }));
    } catch (error) {
      throw new Error(
        `[PSD2UI_EXISTING_BUNDLE_INVALID] 无法读取既有 Bundle '${entryName}'：${error.message}`);
    }
    if (!existing || !existing.document || !Array.isArray(existing.resources)) {
      throw new Error(`[PSD2UI_EXISTING_BUNDLE_INVALID] 既有 Bundle '${entryName}' 缺少文档或资源字段。`);
    }
    const sameDocument = String(existing.document.id || '') === String(bundle.document.id || '');
    if (sameDocument && entryName !== jsonName) {
      throw new Error(
        `[PSD2UI_DOCUMENT_ID_CONFLICT] document.id '${bundle.document.id}' 已属于 '${entryName}'。`);
    }
    if (entryName === jsonName && !sameDocument) {
      throw new Error(
        `[PSD2UI_BUNDLE_NAME_CONFLICT] '${jsonName}' 已属于另一个 document.id。`);
    }
    if (sameDocument) {
      if (legacy) legacyJson.push(entry);
    }

    if (!sameDocument && bundle.schemaVersion !== '1.5.0' && bundle.document.submodule
        && String(existing.document.module || '') === String(bundle.document.module || '')
        && String(existing.document.submodule || '') === String(bundle.document.submodule || '')) {
      throw new Error(
        `[PSD2UI_BUNDLE_SUBMODULE_CONFLICT] module/submodule `
        + `'${bundle.document.module}/${bundle.document.submodule}' 已属于 '${entryName}'。`);
    }
    records.push({ existing, entry, legacy, sameDocument });
  }
  const checks = new Map();
  for (const resource of bundle.resources) {
    const target = await childFile(await relativeFolder(folder, resourceDirectory(resource)), resource.fileName);
    const comparisons = new Map();
    let ownsTarget = false;
    for (const record of records) {
      const prior = record.existing.resources.find(value => value && value.kind === resource.kind
        && String(value.fileName).toLowerCase() === resource.fileName.toLowerCase());
      if (!prior) continue;
      const priorFile = await existingResourceFile(folder, prior, record.legacy);
      if (record.sameDocument) {
        if (target && priorFile && target.nativePath === priorFile.nativePath) ownsTarget = true;
        continue;
      }
      if (!sameResourceSettings(resource, prior)) throw resourceIssue('PSD2UI_RESOURCE_SETTINGS_CONFLICT',
        `公共图片 '${resource.fileName}' 与 '${record.entry.name}' 的九宫边框设置不同，无法共享同一 Unity 资源。`, resource);
      if (!priorFile) throw resourceIssue('PSD2UI_SHARED_RESOURCE_MISSING',
        `'${record.entry.name}' 引用的公共图片 '${resource.fileName}' 不存在，无法比较图片内容。`, resource);
      comparisons.set(priorFile.nativePath, { file: priorFile, owner: record.entry.name });
    }
    // 自己独占的资源可以正常迭代；共享资源和已有的无归属图片必须先比像素。
    if (target && (!ownsTarget || comparisons.size)) comparisons.set(target.nativePath,
      comparisons.get(target.nativePath) || { file: target, owner: '已有输出图片' });
    checks.set(resource.id, { comparisons: Array.from(comparisons.values()), target });
  }
  return { checks, legacyJson, signature: JSON.stringify({
    records: records.map(record => [record.entry.nativePath, record.existing]).sort((a, b) => a[0].localeCompare(b[0])),
    targets: Array.from(checks, ([id, check]) => [id, check.target && check.target.nativePath,
      check.comparisons.map(value => value.file.nativePath)])
  }) };
}

async function preflightExport(folder, bundle, sourceDocument) {
  assertUiResFolder(folder);
  assertBundleOutputNames(bundle);
  if (!sourceDocument) throw new Error('当前没有打开的 Photoshop 文档。');
  const referencedSources = new Map();
  function visit(node) {
    if (!node) return;
    [node.image && node.image.resourceId, node.rawImage && node.rawImage.resourceId].filter(Boolean).forEach((id) => {
      if (!referencedSources.has(id)) referencedSources.set(id, new Set());
      referencedSources.get(id).add(String(node.sourceLayerId));
    });
    (node.children || []).forEach(visit);
  }
  visit(bundle.root);
  for (const resource of bundle.resources) {
    const ids = bundle.schemaVersion === '1.5.0' ? resource.sourceLayerIds : [String(resource.sourceLayerId)];
    if (bundle.schemaVersion === '1.5.0') {
      const expected = referencedSources.get(resource.id) || new Set();
      if (expected.size !== ids.length || ids.some((id) => !expected.has(id))) {
        throw new Error(`[PSD2UI_RESOURCE_SOURCES_INVALID] '${resource.fileName}' 的像素校验来源与节点引用不一致。`);
      }
    }
    ids.forEach((id) => {
      const layer = findLayerById(sourceDocument.layers || [], id);
      if (!layer) throw new Error(`[PSD2UI_RESOURCE_SOURCE_MISSING] 资源 '${resource.fileName}' 的源图层 ${id} 不存在。`);
      if (bundle.schemaVersion === '1.5.0' && parseResourceLayerName(layer.name, id).fileName !== resource.fileName) {
        throw new Error(`[PSD2UI_SOURCE_NAME_CHANGED] 图片图层 ${id} '${layer.name}' 已变更，请重新检查后导出。`);
      }
    });
  }
  await assertBundleOwnership(folder, bundle);
  return { status: 'ready', resourceCount: bundle.resources.length };
}

async function closeWithoutSaving(document) {
  if (!document) return;
  // Photoshop 26.x 的 Document.close/closeWithoutSaving 在跨文档导出后可能
  // 仍作用于当前活动文档；关闭前必须重新激活精确的临时文档，避免误关源 PSD。
  if (!app.activeDocument || String(app.activeDocument.id) !== String(document.id)) {
    app.activeDocument = document;
  }
  if (typeof document.closeWithoutSaving === 'function') {
    await document.closeWithoutSaving();
    return;
  }
  await document.close(constants.SaveOptions.DONOTSAVECHANGES);
}

function findOpenDocument(documentId) {
  return Array.from(app.documents || [])
    .find((document) => String(document.id) === String(documentId)) || null;
}

function requireOpenDocument(documentId, label) {
  const document = findOpenDocument(documentId);
  if (document) return document;
  const openDocuments = Array.from(app.documents || [])
    .map((entry) => (
      `${entry.id}:${entry.title || entry.name || '<untitled>'}:${entry.path || '<unsaved>'}`))
    .join(', ');
  throw new Error(`${label}文档 ${documentId} 已不在 Photoshop 中；当前文档：${openDocuments || '<empty>'}。`);
}

function isInternalTemporaryDocument(document) {
  const title = String(document && (document.title || document.name) || '');
  return !String(document && document.path || '').trim()
    && (title === 'PSD2UI_Resource_Workbench' || title === 'PSD2UI_NineSlice_Output');
}

async function closeStaleTemporaryDocuments() {
  const stale = Array.from(app.documents || []).filter(isInternalTemporaryDocument);
  for (const document of stale) await closeWithoutSaving(document);
}

async function createTemporaryDocument(width, height, name) {
  await app.documents.add({
    width,
    height,
    resolution: 72,
    mode: 'RGBColorMode',
    fill: 'transparent',
    depth: 8,
    name
  });
  // Photoshop 26.x 在跨文档 modal 中可能让 documents.add 的返回包装器仍携带
  // 旧活动文档的 id；新文档身份必须从创建后的 activeDocument 读回。
  const document = app.activeDocument;
  const actualName = String(document && (document.title || document.name) || '');
  if (!document || actualName !== name || String(document.path || '').trim()) {
    throw new Error(
      `[PSD2UI_TEMP_DOCUMENT_CREATE_FAILED] 临时文档创建后读回不符：`
      + `期望=${name}，实际=${actualName || '<empty>'}。`);
  }
  return String(document.id);
}

async function exportCollapsedNineSlice(
  workbenchId,
  outputFile,
  sliceBorder,
  verifyPixels) {
  const workbench = requireOpenDocument(workbenchId, '九宫工作台');
  const width = Math.round(asNumber(workbench.width));
  const height = Math.round(asNumber(workbench.height));
  const sourceResult = await imaging.getPixels({
    documentID: workbench.id,
    sourceBounds: { left: 0, top: 0, width, height },
    colorSpace: 'RGB',
    componentSize: 8
  });
  let outputDocumentId = null;
  let outputImageData = null;
  try {
    const sourceImageData = sourceResult.imageData;
    const pixels = await sourceImageData.getData({ chunky: true });
    const collapsed = collapseNineSlicePixels(
      pixels,
      sourceImageData.width,
      sourceImageData.height,
      sourceImageData.components,
      sliceBorder);
    outputDocumentId = await createTemporaryDocument(
      collapsed.width,
      collapsed.height,
      'PSD2UI_NineSlice_Output');
    const outputDocument = requireOpenDocument(outputDocumentId, '九宫输出');
    app.activeDocument = outputDocument;
    const targetLayer = outputDocument.layers && outputDocument.layers[0];
    if (!targetLayer) throw new Error('九宫输出文档没有可写入的像素图层。');
    outputImageData = await imaging.createImageDataFromBuffer(collapsed.pixels, {
      width: collapsed.width,
      height: collapsed.height,
      components: sourceImageData.components,
      chunky: true,
      colorSpace: sourceImageData.colorSpace || 'RGB',
      colorProfile: sourceImageData.colorProfile || 'sRGB IEC61966-2.1'
    });
    await imaging.putPixels({
      documentID: outputDocument.id,
      layerID: targetLayer.id,
      imageData: outputImageData,
      replace: true,
      targetBounds: { left: 0, top: 0, width: collapsed.width, height: collapsed.height }
    });
    await outputDocument.saveAs.png(outputFile, { compression: 6 }, true);
    return verifyPixels ? {
      width: collapsed.width, height: collapsed.height, components: sourceImageData.components,
      colorSpace: sourceImageData.colorSpace || 'RGB', colorProfile: sourceImageData.colorProfile || '',
      pixels: new Uint8Array(collapsed.pixels)
    } : null;
  } finally {
    if (sourceResult && sourceResult.imageData) sourceResult.imageData.dispose();
    if (outputImageData) outputImageData.dispose();
    if (outputDocumentId) {
      await closeWithoutSaving(findOpenDocument(outputDocumentId));
    }
    app.activeDocument = requireOpenDocument(workbenchId, '九宫工作台');
  }
}

async function capturePixels(document) {
  const result = await imaging.getPixels({ documentID: document.id,
    sourceBounds: { left: 0, top: 0, width: Math.round(asNumber(document.width)), height: Math.round(asNumber(document.height)) },
    colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1', componentSize: 8, applyAlpha: false });
  try {
    const data = result.imageData;
    return { width: data.width, height: data.height, components: data.components,
      canvasWidth: Math.round(asNumber(document.width)), canvasHeight: Math.round(asNumber(document.height)),
      left: result.sourceBounds && result.sourceBounds.left || 0, top: result.sourceBounds && result.sourceBounds.top || 0,
      colorSpace: data.colorSpace || 'RGB', colorProfile: data.colorProfile || '',
      pixels: new Uint8Array(await data.getData({ chunky: true })) };
  } finally { if (result && result.imageData) result.imageData.dispose(); }
}

function pixelsEqual(left, right) {
  if (!left || !right || left.width !== right.width || left.height !== right.height
      || left.canvasWidth !== right.canvasWidth || left.canvasHeight !== right.canvasHeight
      || left.left !== right.left || left.top !== right.top || left.colorSpace !== right.colorSpace
      || left.colorProfile !== right.colorProfile || ![3, 4].includes(left.components)
      || ![3, 4].includes(right.components)
      || left.pixels.length !== left.width * left.height * left.components
      || right.pixels.length !== right.width * right.height * right.components) return false;
  for (let index = 0; index < left.width * left.height; index += 1) {
    const a = index * left.components, b = index * right.components;
    const alphaLeft = left.components === 4 ? left.pixels[a + 3] : 255;
    const alphaRight = right.components === 4 ? right.pixels[b + 3] : 255;
    if (alphaLeft !== alphaRight) return false;
    for (let channel = 0; channel < 3; channel += 1) {
      if (alphaLeft && left.pixels[a + channel] !== right.pixels[b + channel]) return false;
    }
  }
  return true;
}

// 只打开临时副本，避免关闭美术已打开的同名 PNG。
async function readPngPixels(file) {
  const previous = app.activeDocument;
  const openIds = new Set(Array.from(app.documents || []).map(document => String(document.id)));
  let opened;
  try {
    await app.open(file);
    opened = app.activeDocument;
    if (!opened || openIds.has(String(opened.id))) throw new Error('读取 PNG 时未创建独立临时文档。');
    return await capturePixels(opened);
  } finally {
    if (opened && !openIds.has(String(opened.id))) await closeWithoutSaving(opened);
    if (previous && findOpenDocument(previous.id)) app.activeDocument = previous;
  }
}

async function exportResourcePng(
  sourceDocumentId,
  sourceLayerId,
  outputFile,
  sliceBorder,
  verifyPixels) {
  let sourceDocument = requireOpenDocument(sourceDocumentId, '资源源');
  let layer = findLayerById(sourceDocument.layers || [], sourceLayerId);
  if (!layer) throw new Error(`资源源图层 ${sourceLayerId} 不存在。`);
  const sourceWidth = asNumber(sourceDocument.width);
  const sourceHeight = asNumber(sourceDocument.height);
  const sourceBounds = layer.bounds;
  let workbenchId = null;

  try {
    sourceDocument = requireOpenDocument(sourceDocumentId, '资源源');
    layer = findLayerById(sourceDocument.layers || [], sourceLayerId);
    if (!layer) throw new Error(`资源源图层 ${sourceLayerId} 不存在。`);
    // 每张资源使用独立工作台。跨资源复用会让 Photoshop 的图层或画布状态
    // 泄漏到后续导出，最终把整张界面保存成每一张 Sprite/Texture。
    workbenchId = await createTemporaryDocument(
      sourceWidth,
      sourceHeight,
      'PSD2UI_Resource_Workbench');
    const workbench = requireOpenDocument(workbenchId, '资源工作台');
    app.activeDocument = sourceDocument;
    const placement = constants.ElementPlacement
      ? constants.ElementPlacement.PLACEATBEGINNING
      : undefined;
    const copied = placement == null
      ? await layer.duplicate(requireOpenDocument(workbenchId, '资源工作台'))
      : await layer.duplicate(requireOpenDocument(workbenchId, '资源工作台'), placement);
    // 隐藏状态仍需导出完整图片；visible 属于最终节点外观，不是跳过资源的依据。
    copied.visible = true;
    app.activeDocument = requireOpenDocument(workbenchId, '资源工作台');
    await copied.translate(-asNumber(sourceBounds.left), -asNumber(sourceBounds.top));
    const liveWorkbench = requireOpenDocument(workbenchId, '资源工作台');
    if (constants.TrimType && typeof liveWorkbench.trim === 'function') {
      await liveWorkbench.trim(constants.TrimType.TRANSPARENT);
    }
    if (sliceBorder) {
      return await exportCollapsedNineSlice(
        workbenchId,
        outputFile,
        sliceBorder,
        verifyPixels);
    } else {
      await liveWorkbench.saveAs.png(outputFile, { compression: 6 }, true);
      return verifyPixels ? await capturePixels(liveWorkbench) : null;
    }
  } finally {
    if (workbenchId) {
      if (!findOpenDocument(sourceDocumentId)) {
        throw new Error(
          `[PSD2UI_SOURCE_DOCUMENT_LOST_BEFORE_WORKBENCH_CLOSE] `
          + `关闭资源工作台 ${workbenchId} 前，源 PSD ${sourceDocumentId} 已不在 Photoshop 中。`);
      }
      await closeWithoutSaving(findOpenDocument(workbenchId));
      if (findOpenDocument(workbenchId)) {
        throw new Error(
          `[PSD2UI_WORKBENCH_CLOSE_FAILED] 资源工作台 ${workbenchId} 关闭后仍然存在。`);
      }
      if (!findOpenDocument(sourceDocumentId)) {
        throw new Error(
          `[PSD2UI_SOURCE_DOCUMENT_CLOSED_WITH_WORKBENCH] `
          + `关闭资源工作台 ${workbenchId} 时误关了源 PSD ${sourceDocumentId}。`);
      }
    }
    app.activeDocument = requireOpenDocument(sourceDocumentId, '资源源');
  }
}

async function commitStagedFiles(folder, files, backupFolder, requiredDirectories = []) {
  const items = files.map(value => value.file || value.remove
    ? { ...value, name: value.name || value.file.name, directory: value.directory || '' }
    : { file: value, name: value.name, directory: '' });
  const folders = new Map([['', folder]]);
  const created = [];
  const key = item => `${item.directory}/${item.name}`;
  const backups = new Map();
  try {
    for (const directory of new Set([...requiredDirectories, ...items.map(item => item.directory).filter(Boolean)])) {
      const target = await relativeFolder(folder, directory, true, created);
      folders.set(directory, target);
    }
    // 保留目录结构备份，平铺旧 JSON 的迁移也参加同一事务。
    for (const item of items) {
      const prior = await childFile(folders.get(item.directory), item.name);
      if (prior) {
        const destination = await relativeFolder(backupFolder, item.directory, true);
        backups.set(key(item), await prior.copyTo(destination, { overwrite: false }));
      }
    }
    const manifests = items.filter(item => item.name.toLowerCase().endsWith('.psd2ui.json'));
    const assets = items.filter(item => !manifests.includes(item));
    const attempted = [];
    async function removePublished(item) {
      const target = await childFile(folders.get(item.directory), item.name);
      if (target) await target.delete();
    }
    try {
      // 资源替换期间撤下消费入口；旧 JSON 不能继续指向正在替换的图片。
      for (const item of manifests) await removePublished(item);
      for (const item of assets.concat(manifests)) {
        if (item.remove) continue;
        attempted.push(key(item));
        await item.file.copyTo(folders.get(item.directory), { overwrite: true });
      }
    } catch (error) {
      const recoveryFailures = [];
      for (const item of manifests) {
        try { await removePublished(item); }
        catch (recoveryError) { recoveryFailures.push(`${key(item)}: 无法撤下发布入口：${recoveryError.message}`); }
      }
      let assetRecoveryFailed = false;
      for (const item of assets.slice().reverse()) {
        const name = key(item);
        if (!attempted.includes(name)) continue;
        try {
          const backup = backups.get(name);
          if (backup) await backup.copyTo(folders.get(item.directory), { overwrite: true });
          else await removePublished(item);
        } catch (recoveryError) {
          assetRecoveryFailed = true;
          recoveryFailures.push(`${name}: ${recoveryError.message}`);
        }
      }
      // 只有全部资源恢复成功才重新发布旧 JSON；失败时保留离线备份供恢复。
      if (!assetRecoveryFailed) {
        for (const item of manifests) {
          const prior = backups.get(key(item));
          if (!prior) continue;
          try { await prior.copyTo(folders.get(item.directory), { overwrite: true }); }
          catch (recoveryError) {
            recoveryFailures.push(`${key(item)}: ${recoveryError.message}`);
            try { await removePublished(item); }
            catch (removeError) { recoveryFailures.push(`${key(item)}: 无法撤下失败的 JSON：${removeError.message}`); }
          }
        }
      }
      if (recoveryFailures.length) {
        const recovery = new Error(`[PSD2UI_EXPORT_RECOVERY_FAILED] 导出失败且部分资源恢复失败；备份位于 ${backupFolder.nativePath}。`
          + `原错误：${error.message}；恢复错误：${recoveryFailures.join('；')}`);
        recovery.preserveExportBackup = true;
        throw recovery;
      }
      throw error;
    }
    } catch (error) {
    for (const directory of created.slice().reverse()) {
      try { if (!(await directory.getEntries()).length) await directory.delete(); }
      catch (_) { /* 空目录清理不影响文件恢复诊断。 */ }
    }
    throw error;
  }
}

async function writeBundle(bundle, options) {
  if (exportInProgress) throw new Error('[PSD2UI_EXPORT_BUSY] 已有导出正在执行，请等待完成后重试。');
  exportInProgress = true;
  try { return await writeBundleUnlocked(JSON.parse(JSON.stringify(bundle)), options); }
  finally { exportInProgress = false; }
}

async function verifyBundle(bundle, options) {
  return writeBundle(bundle, { ...options, checkOnly: true });
}

function sameBytes(left, right) {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  const a = new Uint8Array(left), b = new Uint8Array(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

async function writeBundleUnlocked(bundle, options) {
  const sourceDocument = app.activeDocument;
  if (!sourceDocument) throw new Error('当前没有打开的 Photoshop 文档。');
  const sourceDocumentPath = String(sourceDocument.path || '');
  const folder = await resolveUiResFolder(options);
  await preflightExport(folder, bundle, sourceDocument);
  const temporaryRoot = await storage.localFileSystem.getTemporaryFolder();
  const transactionFolder = await temporaryRoot.createFolder(`psd2ui-export-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const stage = await transactionFolder.createFolder('staged');
  const backup = await transactionFolder.createFolder('backup');
  const files = [];
  const stagedResources = new Map();
  let reusedResourceCount = 0;
  let checkedOwnership;
  const checkedFiles = new Map();
  let preserveBackup = false;
  try {
    await core.executeAsModal(
      closeStaleTemporaryDocuments,
      { commandName: 'PSD2UI：清理残留图片导出工作台' });
    if (sourceDocumentPath) await openLocalDocument(sourceDocumentPath);
    const sourceDocumentId = String(app.activeDocument.id);

    try {
      await core.executeAsModal(async () => {
        for (let index = 0; index < bundle.resources.length; index += 1) {
          const resource = bundle.resources[index];
          const sourceIds = bundle.schemaVersion === '1.5.0'
            ? resource.sourceLayerIds : [String(resource.sourceLayerId)];
          let referencePixels = null;
          for (let candidateIndex = 0; candidateIndex < sourceIds.length; candidateIndex += 1) {
            const liveSourceDocument = requireOpenDocument(sourceDocumentId, '导出源');
            const layer = findLayerById(liveSourceDocument.layers || [], sourceIds[candidateIndex]);
            if (!layer) throw new Error(`资源 ${resource.fileName} 的源图层 ${sourceIds[candidateIndex]} 不存在。`);
            const file = await stage.createFile(candidateIndex === 0
              ? resource.fileName : `verify-${index}-${candidateIndex}.png`, { overwrite: false });
            await exportResourcePng(sourceDocumentId, String(layer.id), file, resource.sliceBorder, false);
            const pixels = sourceIds.length > 1 ? await readPngPixels(file) : null;
            if (candidateIndex === 0) {
              referencePixels = pixels;
              stagedResources.set(resource.id, file);
            } else if (!pixelsEqual(referencePixels, pixels)) {
              throw resourceIssue('PSD2UI_RESOURCE_CONTENT_CONFLICT', `同名图片 '${resource.fileName}' 的实际像素不同：`
                + `图层 ${sourceIds[0]} 与 ${sourceIds[candidateIndex]}。输出目录尚未写入。`, resource);
            }
          }
        }
        // 用生成后的 PNG 与现有 PNG 比较，避免压缩、元数据或九宫收缩影响判断。
        const ownership = await assertBundleOwnership(folder, bundle);
        checkedOwnership = ownership.signature;
        for (let index = 0; index < bundle.resources.length; index += 1) {
          const resource = bundle.resources[index];
          let file = stagedResources.get(resource.id);
          const check = ownership.checks.get(resource.id);
          if (check.target) checkedFiles.set(check.target.nativePath, { file: check.target,
            bytes: await check.target.read({ format: storage.formats.binary }) });
          const reference = check.comparisons.length ? await readPngPixels(file) : null;
          let equalFile = null;
          for (let candidateIndex = 0; candidateIndex < check.comparisons.length; candidateIndex += 1) {
            const comparison = check.comparisons[candidateIndex];
            const comparisonFolder = await transactionFolder.createFolder(`compare-${index}-${candidateIndex}`);
            const copy = await comparison.file.copyTo(comparisonFolder, { overwrite: false });
            checkedFiles.set(comparison.file.nativePath, { file: comparison.file,
              bytes: await copy.read({ format: storage.formats.binary }) });
            if (!pixelsEqual(reference, await readPngPixels(copy))) throw resourceIssue('PSD2UI_RESOURCE_CONTENT_CONFLICT',
              `公共图片 '${resource.fileName}' 与 '${comparison.owner}' 的现有 PNG 尺寸或像素不同。`
              + `当前来源图层：${resource.sourceLayerIds || resource.sourceLayerId}；已有图片：${comparison.file.nativePath}。输出目录尚未写入。`, resource);
            equalFile = copy;
          }
          if (equalFile) {
            reusedResourceCount += 1;
            // 已有分类目录资源完全不重写；旧平铺资源保留原编码复制到新目录。
            if (check.target) continue;
            file = equalFile;
          }
          files.push({ file, directory: resourceDirectory(resource) });
        }
        ownership.legacyJson.forEach(file => files.push({ remove: true, name: file.name }));
        app.activeDocument = requireOpenDocument(sourceDocumentId, '导出源');
      }, { commandName: 'PSD2UI：导出 UI 图片' });
    } finally {
      await core.executeAsModal(
        closeStaleTemporaryDocuments,
        { commandName: 'PSD2UI：关闭图片导出工作台' });
      if (sourceDocumentPath) await openLocalDocument(sourceDocumentPath);
    }
    if ((await assertBundleOwnership(folder, bundle)).signature !== checkedOwnership) {
      throw new Error('[PSD2UI_EXPORT_TARGET_CHANGED] 比较期间输出目录的资源声明发生变化，请重新预检。');
    }
    for (const { file, bytes } of checkedFiles.values()) {
      if (!sameBytes(bytes, await file.read({ format: storage.formats.binary }))) {
        throw new Error(`[PSD2UI_EXPORT_TARGET_CHANGED] 比较期间 '${file.nativePath}' 已被修改，请重新预检。`);
      }
    }
    if (options && options.checkOnly) return { status: 'ready', resourceCount: bundle.resources.length, reusedResourceCount };
    const jsonFile = await stage.createFile(`${bundle.document.name}.psd2ui.json`, { overwrite: false });
    await jsonFile.write(JSON.stringify(bundle, null, 2), { format: storage.formats.utf8 });
    files.push({ file: jsonFile, directory: 'json' });
    await commitStagedFiles(folder, files, backup, ['sprite', 'texture', 'json']);
    return { folder: folder.nativePath,
      json: `${folder.nativePath.replace(/[\\/]+$/, '')}/json/${jsonFile.name}`,
      resourceCount: bundle.resources.length, reusedResourceCount };
  } catch (error) {
    preserveBackup = Boolean(error.preserveExportBackup);
    throw error;
  } finally {
    if (!preserveBackup) {
      try { await transactionFolder.delete(); }
      catch (_) { /* 临时目录清理失败不会使已提交结果失效。 */ }
    }
  }
}

module.exports = {
  getRememberedUiResFolder,
  chooseUiResFolder,
  clearRememberedUiResFolder,
  resolveUiResFolder,
  assertBundleOwnership,
  assertBundleOutputNames,
  resourceDirectory,
  preflightExport,
  commitStagedFiles,
  pixelsEqual,
  verifyBundle,
  writeBundle
};
