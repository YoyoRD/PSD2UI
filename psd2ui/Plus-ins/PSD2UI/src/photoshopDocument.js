'use strict';

const { app, core, action, constants } = require('photoshop');
const { normalizeLayerTextEffects } = require('./textEffects');

function asNumber(value) {
  if (value && typeof value === 'object' && value.value != null) {
    return Number(value.value);
  }
  return Number(value);
}

function requireDocument() {
  const document = app.activeDocument;
  if (!document) {
    throw new Error('当前没有打开的 Photoshop 文档。');
  }
  if (!document.path || /^cloud:/i.test(String(document.path))) {
    throw new Error('PSD2UI 第一版要求先把 PSD 保存为本地文件。');
  }
  return document;
}

function normalizeNativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function toFileUrl(nativePath) {
  const normalized = String(nativePath || '').replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) ? `file:/${normalized}` : `file:${normalized}`;
}

async function openLocalDocument(nativePath) {
  const requestedPath = String(nativePath || '').trim();
  if (!requestedPath) throw new Error('打开 Photoshop 文档时必须提供本地路径。');
  const normalizedRequestedPath = normalizeNativePath(requestedPath);
  const existing = Array.from(app.documents || [])
    .find((document) => normalizeNativePath(document.path) === normalizedRequestedPath);
  if (existing) {
    if (!app.activeDocument || String(app.activeDocument.id) !== String(existing.id)) {
      await core.executeAsModal(() => {
        app.activeDocument = existing;
      }, { commandName: 'PSD2UI：激活目标 PSD' });
    }
    return getDocumentInfo();
  }

  const file = await require('uxp').storage.localFileSystem.getEntryWithUrl(toFileUrl(requestedPath));
  const opened = await core.executeAsModal(async () => {
    const document = await app.open(file);
    if (document) app.activeDocument = document;
    return document;
  }, { commandName: 'PSD2UI：打开目标 PSD' });
  const info = getDocumentInfo();
  if (normalizeNativePath(info.path) !== normalizedRequestedPath) {
    throw new Error(`Photoshop 打开的文档路径不符：${info.path}`);
  }
  return info;
}

function layerKind(layer) {
  const value = String(layer && layer.kind || '').toLowerCase();
  if (value.includes('text')) return 'text';
  if (value.includes('group') || layer && layer.layers && layer.layers.length > 0) return 'group';
  return value || 'pixel';
}

function readBounds(layer) {
  const bounds = layer.bounds;
  if (!bounds) {
    throw new Error(`无法读取图层 '${layer.name}' 的 bounds。`);
  }
  return {
    left: asNumber(bounds.left),
    top: asNumber(bounds.top),
    right: asNumber(bounds.right),
    bottom: asNumber(bounds.bottom)
  };
}

function readAuthoringBounds(layer, layoutMode) {
  if (layoutMode === 'point' && layer.boundsNoEffects) {
    const raw = layer.boundsNoEffects;
    const candidate = { left: asNumber(raw.left), top: asNumber(raw.top), right: asNumber(raw.right), bottom: asNumber(raw.bottom) };
    if (Object.values(candidate).every(Number.isFinite)) return candidate;
  }
  return readBounds(layer);
}

function mapTextAlignment(value) {
  const raw = String(value || '').toLowerCase();
  const horizontal = raw.includes('right') ? 'right' : raw.includes('center') ? 'center' : 'left';
  return `middle-${horizontal}`;
}

function readLayerPropertyDescriptor(layer, property) {
  if (!action || typeof action.batchPlay !== 'function') return null;
  try {
    const document = requireDocument();
    const result = action.batchPlay([{
      _obj: 'get',
      _target: {
        _ref: [
          { _property: property },
          { _ref: 'layer', _id: Number(layer.id) },
          { _ref: 'document', _id: document.id }
        ]
      }
    }], { synchronousExecution: true });
    const descriptor = result && result[0];
    return descriptor && descriptor._obj !== 'error' ? descriptor[property] || null : null;
  } catch (error) {
    return null;
  }
}

function readFullLayerDescriptor(layer) {
  if (!action || typeof action.batchPlay !== 'function') return {};
  try {
    const result = action.batchPlay([{ _obj: 'get', _target: { _ref: [
      { _ref: 'layer', _id: Number(layer.id) }, { _ref: 'document', _id: requireDocument().id }
    ] } }], { synchronousExecution: true });
    return result && result[0] && result[0]._obj !== 'error' ? result[0] : {};
  } catch (error) { return {}; }
}

function descriptorPixels(value, resolution) {
  if (!value || typeof value !== 'object' || !Number.isFinite(Number(value._value))) return NaN;
  if (value._unit === 'pixelsUnit') return Number(value._value);
  if (value._unit === 'pointsUnit') return Number(value._value) * resolution / 72;
  return NaN;
}

function readTextMetrics(characterStyle, textDescriptor) {
  const firstRange = textDescriptor && Array.isArray(textDescriptor.textStyleRange)
    && textDescriptor.textStyleRange.find((range) => range && range.textStyle);
  const sourceStyle = firstRange && firstRange.textStyle || {};
  const resolutionValue = asNumber(requireDocument().resolution);
  const resolution = Number.isFinite(resolutionValue) && resolutionValue > 0 ? resolutionValue : 72;
  const size = asNumber(characterStyle.size);
  const leading = asNumber(characterStyle.leading);
  const impliedSize = descriptorPixels(sourceStyle.impliedFontSize, resolution);
  const impliedLeading = descriptorPixels(sourceStyle.impliedLeading, resolution);
  const effectiveSize = Number.isFinite(impliedSize) && impliedSize > 0 ? impliedSize : size;
  const paragraph = textDescriptor && (textDescriptor.paragraphStyleRange || []).find((range) => range.paragraphStyle);
  const autoPercent = Number(paragraph && paragraph.paragraphStyle.autoLeading);
  const autoRatio = Number.isFinite(autoPercent) && autoPercent > 0 ? autoPercent / 100 : 1.2;
  const explicitLeading = Number.isFinite(impliedLeading) && impliedLeading > 0 ? impliedLeading : leading;
  const lineAdvance = sourceStyle.autoLeading === true || !(explicitLeading > 0)
    ? effectiveSize * autoRatio : explicitLeading;
  const lineSpacing = effectiveSize > 0 && lineAdvance > 0 ? lineAdvance / effectiveSize : 1.2;
  return {
    fontSize: Number.isFinite(effectiveSize) && effectiveSize > 0 ? Math.max(1, Math.round(effectiveSize)) : 24,
    lineSpacing: Math.max(0.1, lineSpacing),
    ...(Number.isFinite(lineAdvance) && lineAdvance > 0 ? { lineAdvance } : {})
  };
}

function readTextLayoutMode(layer, textDescriptor) {
  try {
    const point = layer.textItem.isPointText;
    if (typeof point === 'boolean') return point ? 'point' : 'paragraph';
  } catch (error) { /* Older hosts may not expose this DOM property. */ }
  try {
    const paragraph = layer.textItem.isParagraphText;
    if (typeof paragraph === 'boolean') return paragraph ? 'paragraph' : 'point';
  } catch (error) { /* Fall back only to a known descriptor shape. */ }
  const shapes = textDescriptor && textDescriptor.textShape;
  if (Array.isArray(shapes) && shapes.length > 0 && shapes.every((shape) => shape && shape.char
      && shape.char._enum === 'char' && shape.char._value === 'paint')) return 'point';
  return undefined;
}

function readText(layer, layerEffects, textDescriptor, descriptor = {}) {
  if (layerKind(layer) !== 'text') return null;
  const layoutMode = readTextLayoutMode(layer, textDescriptor);
  try {
    const textItem = layer.textItem;
    const characterStyle = textItem.characterStyle || {};
    const paragraphStyle = textItem.paragraphStyle || {};
    const solidColor = characterStyle.color;
    const rgb = solidColor && solidColor.rgb;
    const color = rgb
      ? {
        r: Math.max(0, Math.min(1, Number(rgb.red) / 255)),
        g: Math.max(0, Math.min(1, Number(rgb.green) / 255)),
        b: Math.max(0, Math.min(1, Number(rgb.blue) / 255)),
        a: 1
      }
      : null;
    const metrics = readTextMetrics({ size: characterStyle.size || textItem.fontSize, leading: characterStyle.leading }, textDescriptor);
    return {
      value: String(textItem.contents || '').replace(/\r\n?/g, '\n'),
      fontSize: metrics.fontSize,
      alignment: mapTextAlignment(paragraphStyle.justification),
      lineSpacing: metrics.lineSpacing,
      ...(metrics.lineAdvance > 0 ? { lineAdvance: metrics.lineAdvance } : {}),
      ...(layoutMode ? { layoutMode } : {}),
      color,
      effects: normalizeLayerTextEffects(layerEffects, descriptor)
    };
  } catch (error) {
    return {
      value: String(layer.name || ''),
      fontSize: readTextMetrics({}, textDescriptor).fontSize,
      alignment: 'middle-center',
      lineSpacing: readTextMetrics({}, textDescriptor).lineSpacing,
      ...(layoutMode ? { layoutMode } : {}),
      color: null,
      effects: normalizeLayerTextEffects(layerEffects, descriptor)
    };
  }
}

function readStyleSignature(layer) {
  let boundsNoEffects = null;
  try {
    const value = layer.boundsNoEffects;
    if (value) {
      boundsNoEffects = {
        left: asNumber(value.left),
        top: asNumber(value.top),
        right: asNumber(value.right),
        bottom: asNumber(value.bottom)
      };
    }
  } catch (error) {
    boundsNoEffects = null;
  }
  return JSON.stringify({
    blendMode: String(layer.blendMode || ''),
    boundsNoEffects
  });
}

function readLayer(layer) {
  const children = [];
  const layers = layer.layers || [];
  for (let index = 0; index < layers.length; index += 1) {
    children.push(readLayer(layers[index]));
  }
  const opacity = Number(layer.opacity);
  const isText = layerKind(layer) === 'text';
  const descriptor = readFullLayerDescriptor(layer);
  const effectsDescriptor = isText ? descriptor.layerEffects || null : null;
  const textDescriptor = descriptor.textKey || null;
  const text = readText(layer, effectsDescriptor, textDescriptor, descriptor);
  if (text) {
    // 保留完整效果描述符及共同混合参数；不把 PSD 引擎私有文字数据带入 Runtime。
    const source = { ...descriptor, version: 1, layerEffects: effectsDescriptor };
    delete source.textKey;
    text.photoshop = { version: 1, descriptorJson: JSON.stringify(source) };
  }
  const bounds = readAuthoringBounds(layer, text && text.layoutMode);
  const textSource = textDescriptor ? {
    transform: textDescriptor.transform || null,
    styles: (textDescriptor.textStyleRange || []).map((range) => ({
      from: range.from, to: range.to, fontPostScriptName: range.textStyle && range.textStyle.fontPostScriptName,
      fontAvailable: range.textStyle && range.textStyle.fontAvailable,
      size: range.textStyle && range.textStyle.size, impliedFontSize: range.textStyle && range.textStyle.impliedFontSize
    }))
  } : null;
  return {
    layerId: String(layer.id),
    parentId: layer.parent && layer.parent.id != null ? String(layer.parent.id) : '',
    name: String(layer.name || `Layer-${layer.id}`),
    kind: layerKind(layer),
    bounds,
    visible: layer.visible !== false,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity / 100)) : 1,
    rotationClockwiseDegrees: 0,
    text,
    protection: readLayerProtection(layer, descriptor),
    styleSignature: JSON.stringify({ base: readStyleSignature(layer), effects: effectsDescriptor, textSource }),
    children
  };
}

function findLayerById(layers, layerId) {
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (String(layer.id) === String(layerId)) return layer;
    const found = findLayerById(layer.layers || [], layerId);
    if (found) return found;
  }
  return null;
}

function flattenLayers(layers, output) {
  for (let index = 0; index < layers.length; index += 1) {
    output.push(layers[index]);
    flattenLayers(layers[index].layers || [], output);
  }
}

function getActiveLayersInfo() {
  const document = requireDocument();
  const selectedIds = new Set((document.activeLayers || []).map((layer) => String(layer.id)));
  if (selectedIds.size === 0) {
    throw new Error('请先选择一个或多个 Photoshop 图层。');
  }
  const orderedLayers = [];
  flattenLayers(document.layers || [], orderedLayers);
  return orderedLayers
    .filter((layer) => selectedIds.has(String(layer.id)))
    .map((layer) => {
      const snapshot = readLayer(layer);
      return {
        ...snapshot,
        id: snapshot.layerId,
        layer
      };
    });
}

function getActiveLayerInfo() {
  return getActiveLayersInfo()[0];
}

function createSnapshot(rootLayerId) {
  const document = requireDocument();
  if (String(rootLayerId) === 'document-root') {
    const rootId = 'document-root';
    const children = Array.from(document.layers || []).map(readLayer)
      .map((layer) => ({ ...layer, parentId: rootId }));
    return { root: {
      layerId: rootId, parentId: '', name: getDocumentInfo().name,
      kind: 'group', documentRoot: true,
      bounds: { left: 0, top: 0, right: asNumber(document.width), bottom: asNumber(document.height) },
      visible: true, opacity: 1, rotationClockwiseDegrees: 0, text: null,
      styleSignature: '', children
    } };
  }
  const rootLayer = findLayerById(document.layers || [], rootLayerId);
  if (!rootLayer) {
    throw new Error(`当前 PSD 中找不到根图层 ${rootLayerId}。`);
  }
  return { root: readLayer(rootLayer) };
}

function getDocumentInfo() {
  const document = requireDocument();
  return {
    name: String(document.title || 'UI').replace(/\.psd$/i, ''),
    path: String(document.path),
    width: asNumber(document.width),
    height: asNumber(document.height)
  };
}

async function addSelectionChangeListener(callback) {
  if (!action || typeof action.addNotificationListener !== 'function') {
    throw new Error('当前 Photoshop 版本不支持图层选择事件监听，请使用“刷新当前状态”。');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('图层选择事件必须提供刷新回调。');
  }
  const notificationEvents = ['select', 'open', 'close'];
  const listener = (eventName, descriptor) => {
    if (!notificationEvents.includes(String(eventName || '').toLowerCase())) return;
    Promise.resolve(callback({ eventName, descriptor })).catch((error) => {
      console.error('Photoshop 图层选择变化后的 PSD2UI 刷新失败。', error);
    });
  };
  await action.addNotificationListener(notificationEvents, listener);
  return async () => {
    if (typeof action.removeNotificationListener === 'function') {
      await action.removeNotificationListener(notificationEvents, listener);
    }
  };
}

function readLayerProtection(layer, sourceDescriptor) {
  const descriptor = sourceDescriptor || readFullLayerDescriptor(layer);
  const opacity = Number(layer.opacity);
  return {
    clipped: layer.clipped === true || layer.isClippingMask === true || descriptor.group === true,
    hasLayerMask: layer.hasLayerMask === true || descriptor.hasUserMask === true,
    hasVectorMask: layer.hasVectorMask === true || descriptor.hasVectorMask === true,
    opacity: Number.isFinite(opacity) ? opacity : 100,
    blendMode: String(layer.blendMode || '')
  };
}

function validateGroupSelection(selected, minimum = 2) {
  const document = requireDocument();
  if (!Array.isArray(selected) || selected.length < minimum) {
    throw new Error('组合为组件要求至少选择两个同级图层。');
  }
  const parent = selected[0].layer.parent || document;
  const parentId = String(parent.id || '');
  if (selected.some((entry) => String((entry.layer.parent || document).id || '') !== parentId)) {
    const error = new Error('所选图层不在同一父组，无法保持原有层级组合。请只选择同一组内的图层。');
    error.layerIds = selected.map((entry) => String(entry.id));
    throw error;
  }
  const siblings = Array.from(parent.layers || document.layers || []);
  const selectedIds = new Set(selected.map((entry) => String(entry.id)));
  const indices = siblings.map((layer, index) => selectedIds.has(String(layer.id)) ? index : -1)
    .filter((index) => index >= 0);
  if (indices.length !== selectedIds.size) throw new Error('所选图层已经发生变化，请刷新后重试。');
  const between = siblings.slice(indices[0], indices[indices.length - 1] + 1);
  const gaps = between.filter((layer) => !selectedIds.has(String(layer.id)));
  if (gaps.length) {
    const error = new Error(`所选图层之间夹有未选图层：${gaps.map((layer) => layer.name).join('、')}。`
      + '组合会改变它们的叠放关系，请选择连续图层；可点击“定位问题图层”。');
    error.layerIds = gaps.map((layer) => String(layer.id));
    throw error;
  }
  const last = between[between.length - 1];
  const above = siblings[indices[0] - 1];
  if (readLayerProtection(last).clipped || above && readLayerProtection(above).clipped) {
    throw new Error('组合会切断剪贴蒙版链；请把基底与关联剪贴层一起包含在计划中。');
  }
  return { parent, parentId, siblings, layers: between };
}

async function selectLayersById(layerIds) {
  const document = requireDocument();
  const ids = Array.from(new Set((layerIds || []).map(String)));
  if (!ids.length) throw new Error('没有可定位的图层。');
  ids.forEach((id) => {
    if (!findLayerById(document.layers || [], id)) throw new Error(`问题图层 ${id} 已不存在，请重新检查。`);
  });
  await core.executeAsModal(async () => {
    for (let index = 0; index < ids.length; index += 1) {
      await action.batchPlay([{
        _obj: 'select', _target: [{ _ref: 'layer', _id: Number(ids[index]) }],
        ...(index > 0 ? { selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' } } : {}),
        makeVisible: false, _options: { dialogOptions: 'dontDisplay' }
      }], {});
    }
  }, { commandName: 'PSD2UI：定位图层' });
  return { layerIds: ids };
}

let visualStatePreview = null;

async function restoreVisualStatePreview() {
  if (!visualStatePreview) return { restored: false };
  const preview = visualStatePreview;
  const target = Array.from(app.documents || []).find((document) => String(document.id) === preview.documentId)
    || (app.activeDocument && String(app.activeDocument.id) === preview.documentId ? app.activeDocument : null);
  if (!target) throw new Error('状态预览的源 PSD 已关闭，无法恢复原可见性。');
  await core.executeAsModal(async () => {
    preview.layers.forEach((entry) => {
      const layer = findLayerById(target.layers || [], entry.layerId);
      if (!layer) throw new Error(`预览图层 ${entry.layerId} 已删除，无法恢复。`);
      layer.visible = entry.visible;
    });
  }, { commandName: 'PSD2UI：恢复状态预览' });
  visualStatePreview = null;
  return { restored: true };
}

async function previewVisualState(visualStates, stateName) {
  await restoreVisualStatePreview();
  const document = requireDocument();
  const states = visualStates && visualStates.states || [];
  if (!states.some((state) => state.name === stateName)) throw new Error('请选择需要预览的状态。');
  const targets = states.map((state) => {
    const layer = findLayerById(document.layers || [], state.layerId);
    if (!layer || layerKind(layer) !== 'group') throw new Error(`状态组 ${state.layerId} 已不存在。`);
    return { name: state.name, layer };
  });
  const previous = { documentId: String(document.id), layers: targets.map((entry) => ({
    layerId: String(entry.layer.id), visible: entry.layer.visible !== false
  })) };
  await core.executeAsModal(async () => {
    try {
      targets.forEach((entry) => { entry.layer.visible = entry.name === stateName; });
      visualStatePreview = previous;
    } catch (error) {
      previous.layers.forEach((entry) => {
        const layer = findLayerById(document.layers || [], entry.layerId);
        if (layer) layer.visible = entry.visible;
      });
      throw error;
    }
  }, { commandName: 'PSD2UI：预览组件状态' });
  return { state: stateName, temporary: true };
}

async function structureActiveLayers(plan, persist) {
  if (typeof persist !== 'function') {
    throw new TypeError('结构化必须提供 Manifest 同步回调。');
  }
  const document = requireDocument();
  const selected = getActiveLayersInfo();
  const selection = validateGroupSelection(selected);
  const layers = selection.layers;
  const expectedIds = (plan.sourceLayerIds || layers.map((layer) => String(layer.id))).map(String);
  if (expectedIds.length !== layers.length || expectedIds.some((id, index) => id !== String(layers[index].id))) {
    throw new Error('组件配置期间选择已变化，请重新选择并确认角色。');
  }
  const beforeIds = selection.siblings.map((layer) => String(layer.id));
  const beforeBounds = layers.map((layer) => ({ id: String(layer.id), bounds: readBounds(layer) }));
  return core.executeAsModal(async (executionContext) => {
    const freshSelection = validateGroupSelection(getActiveLayersInfo());
    if (String(requireDocument().id) !== String(document.id)
      || freshSelection.layers.length !== expectedIds.length
      || freshSelection.layers.some((layer, index) => String(layer.id) !== expectedIds[index])) {
      throw new Error('等待 Photoshop 执行期间选择已变化，请重新选择并确认角色。');
    }
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: document.id,
      name: `PSD2UI：结构化为${plan.groupName}`
    });
    try {
      const group = await document.createLayerGroup({
        name: plan.groupName,
        fromLayers: layers
      });
      if (!group) throw new Error(`Photoshop 未能创建“${plan.groupName}”组。`);
      if (constants && constants.BlendMode && constants.BlendMode.PASSTHROUGH != null) {
        group.blendMode = constants.BlendMode.PASSTHROUGH;
      }
      const childIds = Array.from(group.layers || []).map((layer) => String(layer.id));
      if (childIds.length !== expectedIds.length || childIds.some((id, index) => id !== expectedIds[index])) {
        throw new Error('Photoshop 组合后的图层叠放顺序与原选择不一致，已回滚。');
      }
      const afterIds = Array.from(selection.parent.layers || document.layers || [])
        .flatMap((layer) => String(layer.id) === String(group.id) ? childIds : [String(layer.id)]);
      if (afterIds.length !== beforeIds.length || afterIds.some((id, index) => id !== beforeIds[index])) {
        throw new Error('组合改变了未选图层的叠放关系，已回滚。');
      }
      beforeBounds.forEach((entry) => {
        const live = findLayerById(group.layers || [], entry.id);
        if (!live) throw new Error(`组合后图层 ${entry.id} 缺失，已回滚。`);
        const bounds = readBounds(live);
        if (Object.keys(entry.bounds).some((key) => Math.abs(bounds[key] - entry.bounds[key]) > 0.01)) {
          throw new Error(`组合改变了图层 ${live.name} 的位置或尺寸，已回滚。`);
        }
      });
      const value = await persist({
        id: String(group.id),
        name: String(group.name || plan.groupName),
        layer: group
      });
      await executionContext.hostControl.resumeHistory(suspension, true);
      return value;
    } catch (error) {
      await executionContext.hostControl.resumeHistory(suspension, false);
      throw error;
    }
  }, { commandName: `PSD2UI：结构化为${plan.groupName}` });
}

async function renameActiveLayers(renames, persist) {
  if (typeof persist !== 'function') {
    throw new TypeError('批量重命名必须提供 Manifest 同步回调。');
  }
  const document = requireDocument();
  const selected = getActiveLayersInfo();
  const entries = Array.isArray(renames) ? renames : [];
  if (entries.length !== selected.length) {
    throw new Error(`批量改名计划数量 ${entries.length} 与当前选择数量 ${selected.length} 不一致。`);
  }
  const selectedById = new Map(selected.map((entry) => [String(entry.id), entry]));
  const plannedLayerIds = new Set();
  const targetNames = new Set();
  const resolved = entries.map((entry, index) => {
    const layerId = String(entry && entry.layerId || '');
    const selectedLayer = selectedById.get(layerId);
    if (!selectedLayer) throw new Error(`批量改名第 ${index + 1} 项不是当前选中图层：${layerId || '<empty>'}。`);
    if (plannedLayerIds.has(layerId)) throw new Error(`批量改名计划重复包含图层 ${layerId}。`);
    plannedLayerIds.add(layerId);
    if (entry.previousName != null && String(entry.previousName) !== selectedLayer.name) {
      throw new Error(`图层 ${layerId} 名称已变化：期望 '${entry.previousName}'，实际 '${selectedLayer.name}'。`);
    }
    const name = String(entry.name || '').trim();
    if (!isEnglishIdentifier(name)) {
      throw new Error(`批量改名结果不是有效英文标识符：${layerId}:${name || '<empty>'}。`);
    }
    if (targetNames.has(name)) throw new Error(`批量改名结果重复：${name}。`);
    targetNames.add(name);
    return { layerId, previousName: selectedLayer.name, name, layer: selectedLayer.layer };
  });

  const selectedIds = new Set(resolved.map((entry) => entry.layerId));
  const allLayers = [];
  flattenLayers(document.layers || [], allLayers);
  const occupiedNames = new Set(allLayers
    .filter((layer) => !selectedIds.has(String(layer.id)))
    .map((layer) => String(layer.name || '')));
  const conflict = resolved.find((entry) => occupiedNames.has(entry.name));
  if (conflict) {
    throw new Error(`批量改名结果 '${conflict.name}' 已被未选中的 Photoshop 图层使用。`);
  }

  return core.executeAsModal(async (executionContext) => {
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: document.id,
      name: `PSD2UI：批量重命名 ${resolved.length} 个图层`
    });
    try {
      resolved.forEach((entry) => { entry.layer.name = entry.name; });
      const renamed = resolved.map((entry) => ({
        layerId: entry.layerId,
        previousName: entry.previousName,
        name: String(entry.layer.name || entry.name)
      }));
      const value = await persist(renamed);
      await executionContext.hostControl.resumeHistory(suspension, true);
      return { renamed, value };
    } catch (error) {
      await executionContext.hostControl.resumeHistory(suspension, false);
      throw error;
    }
  }, { commandName: `PSD2UI：批量重命名 ${resolved.length} 个图层` });
}

function requirePlanArray(plan, name) {
  const value = plan && plan[name];
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`结构计划字段 ${name} 必须是数组。`);
  return value;
}

function requirePlanText(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${label} 不能为空。`);
  return result;
}

function normalizePlanRef(value, label) {
  return requirePlanText(value, label);
}

function isAliasRef(value) {
  return String(value || '').startsWith('@');
}

function assertBounds(layer, expected, label, actualBounds) {
  if (!expected) return;
  const actual = actualBounds || readBounds(layer);
  ['left', 'top', 'right', 'bottom'].forEach((key) => {
    const target = Number(expected[key]);
    if (!Number.isFinite(target) || !Number.isFinite(actual[key]) || Math.abs(actual[key] - target) > 1) {
      throw new Error(
        `${label} 的 ${key} 前置条件不符：期望 ${expected[key]}，实际 ${actual[key]}。`);
    }
  });
}

function assertLayerPrecondition(document, condition) {
  const layerId = requirePlanText(condition && condition.layerId, '图层前置条件 layerId');
  const layer = findLayerById(document.layers || [], layerId);
  if (!layer) throw new Error(`结构计划前置图层 ${layerId} 已不存在。`);
  if (condition.name != null && String(layer.name || '') !== String(condition.name)) {
    throw new Error(
      `图层 ${layerId} 名称前置条件不符：期望 '${condition.name}'，实际 '${layer.name || ''}'。`);
  }
  if (condition.kind != null && layerKind(layer) !== String(condition.kind)) {
    throw new Error(
      `图层 ${layerId} 类型前置条件不符：期望 '${condition.kind}'，实际 '${layerKind(layer)}'。`);
  }
  if (condition.parentId != null) {
    const actualParentId = layer.parent && layer.parent.id != null ? String(layer.parent.id) : '';
    // Full-document snapshots use the virtual root as the top-level parent.
    // Resolve that sentinel to this document only; nested groups still must match.
    const expectedParentId = String(condition.parentId) === 'document-root'
      ? String(document.id) : String(condition.parentId);
    if (actualParentId !== expectedParentId) {
      throw new Error(
        `图层 ${layerId} 父级前置条件不符：期望 '${condition.parentId}'，实际 '${actualParentId}'。`);
    }
  }
  if (condition.visible != null && (layer.visible !== false) !== Boolean(condition.visible)) {
    throw new Error(`图层 ${layerId} 可见性前置条件不符。`);
  }
  if (condition.protection != null) {
    const actual = readLayerProtection(layer);
    const expected = condition.protection;
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)
        || Object.keys(actual).some(key => !Object.prototype.hasOwnProperty.call(expected, key) || actual[key] !== expected[key])) {
      throw new Error(`图层 ${layerId} 的蒙版、剪贴关系或混合设置已变化。`);
    }
  }
  if (condition.siblingIds != null) {
    if (!Array.isArray(condition.siblingIds)) throw new Error(`图层 ${layerId} 的 siblingIds 必须是同级图层数组。`);
    const actual = Array.from((layer.parent || document).layers || []).map(entry => String(entry.id));
    if (JSON.stringify(actual) !== JSON.stringify(condition.siblingIds.map(String))) throw new Error(`图层 ${layerId} 的同级叠放顺序已变化。`);
  }
  const layoutMode = condition.bounds && layerKind(layer) === 'text'
    ? readTextLayoutMode(layer, readLayerPropertyDescriptor(layer, 'textKey')) : undefined;
  assertBounds(layer, condition.bounds, `图层 ${layerId}`, condition.bounds && readAuthoringBounds(layer, layoutMode));
  return layer;
}

function collectExistingPlanRefs(plan) {
  const refs = [];
  requirePlanArray(plan, 'copies').forEach((entry) => refs.push(entry.sourceLayerId));
  requirePlanArray(plan, 'renames').forEach((entry) => refs.push(entry.ref));
  requirePlanArray(plan, 'containers').forEach((entry) => {
    (entry.members || []).forEach((ref) => refs.push(ref));
  });
  requirePlanArray(plan, 'groups').forEach((entry) => {
    (entry.members || []).forEach((ref) => refs.push(ref));
    (entry.roles || []).forEach((role) => refs.push(role.ref));
    (entry.previewRefs || []).forEach((ref) => refs.push(ref));
  });
  requirePlanArray(plan, 'adopt').forEach((entry) => {
    refs.push(entry.ref);
    (entry.roles || []).forEach((role) => refs.push(role.ref));
    (entry.previewRefs || []).forEach((ref) => refs.push(ref));
  });
  requirePlanArray(plan, 'presets').forEach((entry) => refs.push(entry.ref));
  requirePlanArray(plan, 'moves').forEach(entry => {
    refs.push(entry.ref);
    if (entry.parentRef !== 'document-root') refs.push(entry.parentRef);
    if (entry.beforeRef != null) refs.push(entry.beforeRef);
    if (entry.afterRef != null) refs.push(entry.afterRef);
  });
  ['ungroups', 'deletes'].forEach(kind => requirePlanArray(plan, kind).forEach(entry => {
    refs.push(entry.ref); (entry.expectedDescendantIds || []).forEach(ref => refs.push(ref));
  }));
  return refs
    .filter((ref) => ref != null && !isAliasRef(ref))
    .map((ref) => String(ref));
}

function validateConfirmedStructurePlan(document, plan) {
  if (!plan || plan.version !== 1) throw new Error('结构计划必须使用 version=1。');
  requirePlanText(plan.confirmationId, '结构计划 confirmationId');
  ['moves', 'ungroups', 'deletes'].forEach(kind => requirePlanArray(plan, kind).forEach(entry => {
    if (entry.allowAppearanceChange !== true) throw new Error(`${kind} 必须在已确认计划中显式声明 allowAppearanceChange:true。`);
    if (kind !== 'moves' && !Array.isArray(entry.expectedDescendantIds)) throw new Error(`${kind} 必须显式列出 expectedDescendantIds（叶层使用空数组）。`);
    if (kind === 'moves' && entry.beforeRef != null && entry.afterRef != null) throw new Error('移动不能同时指定 beforeRef 和 afterRef。');
  }));
  const availableAliases = new Set(requirePlanArray(plan, 'copies').map((entry) => String(entry.alias)));
  const componentAliases = new Set(requirePlanArray(plan, 'groups').map((entry) => String(entry.alias)));
  requirePlanArray(plan, 'containers').forEach((entry) => {
    const alias = normalizePlanRef(entry.alias, '容器组 alias');
    if (!isAliasRef(alias) || alias.length < 2) throw new Error(`容器组 alias 必须以 @ 开头并包含名称：${alias}`);
    if (availableAliases.has(alias) || componentAliases.has(alias)) throw new Error(`结构计划 alias 重复：${alias}`);
    requirePlanText(entry.name, '容器组名称');
    if (!Array.isArray(entry.members) || !entry.members.length) throw new Error(`容器组 ${alias} 没有成员。`);
    const members = entry.members.map((ref) => normalizePlanRef(ref, '容器组成员'));
    if (new Set(members).size !== members.length) throw new Error(`容器组 ${alias} 重复引用成员。`);
    members.filter(isAliasRef).forEach((ref) => {
      if (!availableAliases.has(ref)) throw new Error(`容器组 ${alias} 引用了尚未建立的别名 ${ref}。`);
    });
    availableAliases.add(alias);
  });
  const preconditions = requirePlanArray(plan, 'preconditions');
  if (preconditions.length === 0) throw new Error('结构计划必须提供完整图层前置条件。');
  const covered = new Set();
  preconditions.forEach((condition) => {
    const layer = assertLayerPrecondition(document, condition);
    const layerId = String(layer.id);
    if (covered.has(layerId)) throw new Error(`结构计划重复声明图层 ${layerId} 的前置条件。`);
    covered.add(layerId);
  });
  const missing = Array.from(new Set(collectExistingPlanRefs(plan)))
    .filter((layerId) => !covered.has(layerId));
  if (missing.length > 0) {
    throw new Error(`结构计划缺少现有图层前置条件：${missing.join(', ')}。`);
  }
}

function isEnglishIdentifier(value) {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(String(value || ''));
}

function collectSnapshotNameIssues(node, issues) {
  if (!node) return issues;
  if (!isEnglishIdentifier(node.name)) {
    issues.push(`${node.layerId}:${node.name || '<empty>'}`);
  }
  (node.children || []).forEach((child) => collectSnapshotNameIssues(child, issues));
  return issues;
}

function createPostRenameValidationPlan(plan, omitVisibility) {
  const renamedNames = new Map(requirePlanArray(plan, 'renames')
    .filter((entry) => !isAliasRef(entry.ref))
    .map((entry) => [String(entry.ref), String(entry.name)]));
  return {
    ...plan,
    preconditions: requirePlanArray(plan, 'preconditions').map((condition) => {
      const resolved = {
        ...condition,
        name: renamedNames.has(String(condition.layerId))
          ? renamedNames.get(String(condition.layerId))
          : condition.name
      };
      if (omitVisibility) delete resolved.visible;
      return resolved;
    })
  };
}

async function applyConfirmedPreinitializeRenames(plan, rootLayerId, options) {
  const document = requireDocument();
  const repairPreservedState = Boolean(options && options.repairPreservedState);
  const resolvedRootLayerId = requirePlanText(rootLayerId, '初始化根图层 rootLayerId');
  if (!findLayerById(document.layers || [], resolvedRootLayerId)) {
    throw new Error(`当前 PSD 中找不到初始化根图层 ${resolvedRootLayerId}。`);
  }
  const postRenamePlan = createPostRenameValidationPlan(plan, false);
  validateConfirmedStructurePlan(
    document,
    repairPreservedState ? createPostRenameValidationPlan(plan, true) : plan);

  return core.executeAsModal(async (executionContext) => {
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: document.id,
      name: `PSD2UI：初始化前应用已确认命名 ${plan.confirmationId}`
    });
    try {
      const renamed = [];
      if (!repairPreservedState) {
        for (const entry of requirePlanArray(plan, 'renames')) {
          if (isAliasRef(entry.ref)) continue;
          const layerId = normalizePlanRef(entry.ref, '初始化前重命名图层引用');
          const layer = findLayerById(document.layers || [], layerId);
          if (!layer) throw new Error(`初始化前重命名找不到图层 ${layerId}。`);
          const name = requirePlanText(entry.name, '初始化前重命名目标名称');
          if (!isEnglishIdentifier(name)) {
            throw new Error(`初始化前重命名目标不是有效英文标识符：${layerId}:${name}。`);
          }
          const previousName = String(layer.name || '');
          layer.name = name;
          renamed.push({ layerId, previousName, name: String(layer.name || name) });
        }
      }

      const visibilityRestored = [];
      for (const condition of requirePlanArray(plan, 'preconditions')) {
        if (condition.visible == null) continue;
        const layer = findLayerById(document.layers || [], String(condition.layerId));
        if (!layer) throw new Error(`初始化前状态恢复找不到图层 ${condition.layerId}。`);
        const expected = Boolean(condition.visible);
        if ((layer.visible !== false) !== expected) {
          const previousVisible = layer.visible !== false;
          layer.visible = expected;
          visibilityRestored.push({
            layerId: String(layer.id),
            previousVisible,
            visible: expected
          });
        }
      }

      validateConfirmedStructurePlan(document, postRenamePlan);

      const issues = collectSnapshotNameIssues(createSnapshot(resolvedRootLayerId).root, []);
      if (issues.length > 0) {
        throw new Error(
          `初始化根组仍有 ${issues.length} 个非法图层名：${issues.slice(0, 12).join(', ')}`
          + (issues.length > 12 ? '，……' : '。'));
      }

      await document.save();
      await executionContext.hostControl.resumeHistory(suspension, true);
      return {
        confirmationId: String(plan.confirmationId),
        rootLayerId: resolvedRootLayerId,
        mode: repairPreservedState ? 'repair-preserved-state' : 'preinitialize-rename',
        renamedCount: renamed.length,
        renamed,
        visibilityRestoredCount: visibilityRestored.length,
        visibilityRestored
      };
    } catch (error) {
      await executionContext.hostControl.resumeHistory(suspension, false);
      throw error;
    }
  }, { commandName: `PSD2UI：初始化前应用已确认命名 ${plan.confirmationId}` });
}

function isDescendantOrSelf(root, layer) {
  if (String(root.id) === String(layer.id)) return true;
  // Document IDs and layer IDs are separate namespaces; walking up to a
  // document with a colliding ID must not turn an unrelated group into a child.
  return Array.from(root.layers || []).some(child => isDescendantOrSelf(child, layer));
}

function layerTreeKey(layer, document) {
  return layer === document || typeof layer.save === 'function' && String(layer.id) === String(document.id)
    ? 'document-root' : `layer:${layer.id}`;
}

function captureLayerTreeOrders(document) {
  const result = new Map();
  const visit = (parent) => {
    const children = Array.from(parent.layers || []);
    const key = layerTreeKey(parent, document);
    if (result.has(key)) throw new Error('图层树包含重复或循环引用。');
    result.set(key, children.map(child => String(child.id)));
    children.forEach(child => {
      if (layerTreeKey(child.parent || document, document) !== key) throw new Error('图层树的子层父级不符，已回滚。');
    });
    children.forEach(visit);
  };
  visit(document);
  return result;
}

function assertLayerTreeOrders(document, expected, label) {
  const actual = captureLayerTreeOrders(document);
  if (actual.size !== expected.size || Array.from(expected).some(([key, ids]) => {
    const found = actual.get(key);
    return !found || found.length !== ids.length || found.some((id, index) => id !== ids[index]);
  })) throw new Error(`${label} 后的图层、父级或叠放顺序不符，已回滚。`);
}

async function applyConfirmedStructurePlan(plan, persist) {
  const document = requireDocument();
  if (typeof persist !== 'function') throw new TypeError('结构计划必须提供 Manifest 持久化回调。');
  validateConfirmedStructurePlan(document, plan);

  return core.executeAsModal(async (executionContext) => {
    if (String(requireDocument().id) !== String(document.id)) {
      throw new Error('等待 Photoshop 执行期间切换了 PSD，请重新确认结构计划。');
    }
    validateConfirmedStructurePlan(document, plan);
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: document.id,
      name: `PSD2UI：应用已确认结构计划 ${plan.confirmationId}`
    });
    try {
      const aliases = new Map();
      const copies = [];
      const containers = [];
      const structured = [];
      const presets = [];
      const edits = [];

      const registerAlias = (rawAlias, layer) => {
        const alias = normalizePlanRef(rawAlias, '结构计划 alias');
        if (!isAliasRef(alias)) throw new Error(`结构计划 alias 必须以 @ 开头：${alias}`);
        if (aliases.has(alias)) throw new Error(`结构计划 alias 重复：${alias}`);
        aliases.set(alias, layer);
      };
      const resolveRef = (rawRef) => {
        const ref = normalizePlanRef(rawRef, '结构计划图层引用');
        const alias = isAliasRef(ref) ? aliases.get(ref) : null;
        const layer = findLayerById(document.layers || [], alias ? String(alias.id) : ref);
        if (!layer) throw new Error(`结构计划找不到图层引用 ${ref}。`);
        return layer;
      };
      const resolveRoles = (owner, entries) => (entries || []).map((entry) => {
        const target = resolveRef(entry.ref);
        if (!isDescendantOrSelf(owner, target) || String(owner.id) === String(target.id)) {
          throw new Error(
            `结构角色 '${entry.name || ''}' 指向的图层 ${target.id} 不在组件组 ${owner.id} 内。`);
        }
        return {
          name: requirePlanText(entry.name, '结构角色名称'),
          layerId: String(target.id),
          nodeId: null
        };
      });
      const makeStructure = (owner, entry) => {
        const structure = {
          version: 1,
          roles: resolveRoles(owner, entry.roles),
          previewLayerIds: (entry.previewRefs || []).map((ref) => {
            const target = resolveRef(ref);
            if (!isDescendantOrSelf(owner, target) || String(owner.id) === String(target.id)) {
              throw new Error(`预览图层 ${target.id} 不在组件组 ${owner.id} 内。`);
            }
            return String(target.id);
          })
        };
        if (entry.layout != null) {
          structure.layout = JSON.parse(JSON.stringify(entry.layout));
          structure.layoutSource = 'explicit';
        }
        return structure;
      };

      for (const entry of requirePlanArray(plan, 'copies')) {
        const source = resolveRef(entry.sourceLayerId);
        const copy = await source.duplicate();
        copy.name = requirePlanText(entry.name, '复制图层名称');
        const offsetX = Number(entry.offsetX || 0);
        const offsetY = Number(entry.offsetY || 0);
        if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
          throw new Error(`复制图层 ${entry.alias || ''} 的偏移必须是有限数字。`);
        }
        if (offsetX !== 0 || offsetY !== 0) await copy.translate(offsetX, offsetY);
        if (entry.visible != null) copy.visible = Boolean(entry.visible);
        assertBounds(copy, entry.expectedBounds, `复制图层 ${entry.alias || copy.id}`);
        registerAlias(entry.alias, copy);
        copies.push({
          alias: String(entry.alias),
          layerId: String(copy.id),
          sourceLayerId: String(source.id)
        });
      }

      for (const entry of requirePlanArray(plan, 'renames')) {
        const layer = resolveRef(entry.ref);
        layer.name = requirePlanText(entry.name, '重命名目标名称');
      }

      for (const entry of requirePlanArray(plan, 'containers')) {
        const members = (entry.members || []).map(resolveRef);
        if (!members.length) throw new Error(`容器组 ${entry.alias || ''} 没有成员。`);
        const selectedIds = new Set(members.map((layer) => String(layer.id)));
        if (selectedIds.size !== members.length) throw new Error(`容器组 ${entry.alias || ''} 重复引用成员。`);
        const parent = members[0].parent || document;
        if (members.some((layer) => String((layer.parent || document).id) !== String(parent.id))) {
          throw new Error(`容器组 ${entry.alias || ''} 的成员不在同一父级。`);
        }
        validateGroupSelection(members.map(layer => ({ id: layer.id, layer })), 1);
        const siblings = Array.from(parent.layers || []);
        const ordered = siblings.filter((layer) => selectedIds.has(String(layer.id)));
        const expectedIds = ordered.map((layer) => String(layer.id));
        const remainingIds = siblings.filter((layer) => !selectedIds.has(String(layer.id))).map((layer) => String(layer.id));
        const bounds = ordered.map((layer) => ({ layer, bounds: readBounds(layer) }));
        const group = await document.createLayerGroup({
          name: requirePlanText(entry.name, '容器组名称'), fromLayers: ordered
        });
        if (!group) throw new Error(`Photoshop 未能创建容器组 '${entry.name || ''}'。`);
        if (constants && constants.BlendMode && constants.BlendMode.PASSTHROUGH != null) {
          group.blendMode = constants.BlendMode.PASSTHROUGH;
        }
        const actualIds = Array.from(group.layers || []).map((layer) => String(layer.id));
        if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
          throw new Error('容器组合后的图层叠放顺序不一致，已回滚。');
        }
        const actualRemainingIds = Array.from(parent.layers || [])
          .filter((layer) => String(layer.id) !== String(group.id)).map((layer) => String(layer.id));
        if (actualRemainingIds.length !== remainingIds.length
            || actualRemainingIds.some((id, index) => id !== remainingIds[index])) {
          throw new Error('容器组合改变了未选图层的叠放关系，已回滚。');
        }
        bounds.forEach((entry) => assertBounds(entry.layer, entry.bounds, `容器成员 ${entry.layer.id}`));
        registerAlias(entry.alias, group);
        containers.push({ alias: String(entry.alias), layerId: String(group.id),
          name: String(group.name), memberLayerIds: expectedIds });
      }

      for (const entry of requirePlanArray(plan, 'groups')) {
        const members = (entry.members || []).map(resolveRef);
        if (members.length === 0) throw new Error(`结构组 ${entry.alias || ''} 没有成员。`);
        const memberIds = new Set(members.map((layer) => String(layer.id)));
        if (memberIds.size !== members.length) throw new Error(`结构组 ${entry.alias || ''} 重复引用成员。`);
        const parentIds = new Set(members.map((layer) => (
          layer.parent && layer.parent.id != null ? String(layer.parent.id) : '')));
        if (parentIds.size !== 1) throw new Error(`结构组 ${entry.alias || ''} 的成员不在同一父级。`);
        const selection = validateGroupSelection(members.map(layer => ({ id: layer.id, layer })), 1);
        const beforeIds = selection.siblings.map(layer => String(layer.id));
        const beforeBounds = selection.layers.map(layer => ({ layer, bounds: readBounds(layer) }));
        const group = await document.createLayerGroup({
          name: requirePlanText(entry.name, '结构组名称'),
          fromLayers: selection.layers
        });
        if (!group) throw new Error(`Photoshop 未能创建结构组 '${entry.name || ''}'。`);
        group.blendMode = constants.BlendMode.PASSTHROUGH;
        const flattened = Array.from(selection.parent.layers || []).flatMap(layer => String(layer.id) === String(group.id)
          ? Array.from(group.layers || []).map(child => String(child.id)) : [String(layer.id)]);
        if (JSON.stringify(flattened) !== JSON.stringify(beforeIds)) throw new Error('组件组合改变了图层叠放顺序，已回滚。');
        beforeBounds.forEach(item => assertBounds(item.layer, item.bounds, `组件成员 ${item.layer.id}`));
        registerAlias(entry.alias, group);
        structured.push({
          layerId: String(group.id),
          name: String(group.name || entry.name),
          semantic: requirePlanText(entry.semantic, '结构组语义'),
          structure: makeStructure(group, entry)
        });
      }

      for (const entry of requirePlanArray(plan, 'moves')) {
        const layer = resolveRef(entry.ref);
        const layerId = String(layer.id);
        const parent = entry.parentRef === 'document-root' ? document : resolveRef(entry.parentRef);
        if (parent !== document && (layerKind(parent) !== 'group' || isDescendantOrSelf(layer, parent))) throw new Error('移动目标必须是不会产生循环引用的组。');
        const before = entry.beforeRef != null ? resolveRef(entry.beforeRef) : null;
        const after = entry.afterRef != null ? resolveRef(entry.afterRef) : null;
        if ([before, after].some(anchor => anchor && (String(anchor.id) === layerId
            || layerTreeKey(anchor.parent || document, document) !== layerTreeKey(parent, document)))) throw new Error('移动的排序参照必须是目标组内的其他图层。');
        const bounds = readBounds(layer);
        const descendants = [];
        flattenLayers(layer.layers || [], descendants);
        const descendantBounds = descendants.map(child => ({ id: String(child.id), bounds: readBounds(child) }));
        const expectedTree = captureLayerTreeOrders(document);
        const previousParentKey = layerTreeKey(layer.parent || document, document);
        const parentKey = layerTreeKey(parent, document);
        expectedTree.set(previousParentKey, expectedTree.get(previousParentKey).filter(id => id !== layerId));
        const targetOrder = expectedTree.get(parentKey).filter(id => id !== layerId);
        const insertionIndex = before ? targetOrder.indexOf(String(before.id)) : after ? targetOrder.indexOf(String(after.id)) + 1 : 0;
        targetOrder.splice(insertionIndex, 0, layerId);
        expectedTree.set(parentKey, targetOrder);
        if (typeof layer.moveTo === 'function') await layer.moveTo(parent, { beforeId: before && before.id, afterId: after && after.id });
        else if (typeof layer.move === 'function') await layer.move(before || after || parent,
          before ? constants.ElementPlacement.PLACEBEFORE : after ? constants.ElementPlacement.PLACEAFTER : constants.ElementPlacement.PLACEATBEGINNING);
        else throw new Error('当前宿主未实现图层移动。');
        assertLayerTreeOrders(document, expectedTree, `移动图层 ${layerId}`);
        const moved = findLayerById(document.layers || [], layerId);
        assertBounds(moved, entry.expectedBounds || bounds, `移动图层 ${layerId}`);
        if (layerTreeKey(moved.parent || document, document) !== parentKey) throw new Error('移动后的父级不符，已回滚。');
        descendantBounds.forEach(child => assertBounds(findLayerById(document.layers || [], child.id), child.bounds, `移动子层 ${child.id}`));
        edits.push({ operation: 'move', layerId, parentId: String(parent.id) });
      }
      for (const kind of ['ungroups', 'deletes']) for (const entry of requirePlanArray(plan, kind)) {
        const layer = resolveRef(entry.ref);
        const layerId = String(layer.id);
        const descendants = [];
        flattenLayers(layer.layers || [], descendants);
        const ids = descendants.map(child => String(child.id));
        if (JSON.stringify(ids) !== JSON.stringify(entry.expectedDescendantIds.map(String))) throw new Error(`${kind} 子层清单已变化，已停止操作。`);
        const parent = layer.parent || document;
        const parentKey = layerTreeKey(parent, document);
        const expectedTree = captureLayerTreeOrders(document);
        const siblings = expectedTree.get(parentKey);
        const index = siblings.indexOf(layerId);
        const directChildren = expectedTree.get(`layer:${layerId}`);
        expectedTree.delete(`layer:${layerId}`);
        if (kind === 'ungroups') {
          if (layerKind(layer) !== 'group') throw new Error('拆组目标必须是组。');
          siblings.splice(index, 1, ...directChildren);
          const childBounds = descendants.map(child => ({ id: String(child.id), bounds: readBounds(child) }));
          if (typeof layer.ungroup === 'function') await layer.ungroup();
          else {
            // This function already owns the modal/history transaction.
            await action.batchPlay([{ _obj: 'select', _target: [{ _ref: 'layer', _id: Number(layerId) }],
              makeVisible: false, _options: { dialogOptions: 'dontDisplay' } }], {});
            await action.batchPlay([{ _obj: 'ungroupLayersEvent', _options: { dialogOptions: 'dontDisplay' } }], {});
          }
          assertLayerTreeOrders(document, expectedTree, `拆组 ${layerId}`);
          childBounds.forEach(child => assertBounds(findLayerById(document.layers || [], child.id), child.bounds, `拆组子层 ${child.id}`));
          directChildren.forEach(id => {
            const child = findLayerById(document.layers || [], id);
            if (layerTreeKey(child.parent || document, document) !== parentKey) throw new Error('拆组后子层父级不符，已回滚。');
          });
        } else {
          siblings.splice(index, 1);
          ids.forEach(id => expectedTree.delete(`layer:${id}`));
          if (typeof layer.delete !== 'function') throw new Error('当前宿主未实现图层删除。');
          await layer.delete();
          assertLayerTreeOrders(document, expectedTree, `删除图层 ${layerId}`);
        }
        edits.push({ operation: kind === 'ungroups' ? 'ungroup' : 'delete', layerId, descendantIds: ids });
      }

      for (const entry of requirePlanArray(plan, 'adopt')) {
        const group = resolveRef(entry.ref);
        if (layerKind(group) !== 'group') {
          throw new Error(`现有组件根 ${entry.ref || ''} 不是 Photoshop 组。`);
        }
        structured.push({
          layerId: String(group.id),
          name: String(entry.name || group.name || ''),
          semantic: requirePlanText(entry.semantic, '现有组件组语义'),
          structure: makeStructure(group, entry)
        });
      }

      for (const entry of requirePlanArray(plan, 'presets')) {
        const layer = resolveRef(entry.ref);
        presets.push({
          layerId: String(layer.id),
          name: String(entry.name || layer.name || ''),
          semantic: requirePlanText(entry.semantic, '节点预设语义')
        });
      }

      const value = await persist({
        confirmationId: String(plan.confirmationId),
        copies,
        containers,
        structured,
        presets,
        edits
      });
      await executionContext.hostControl.resumeHistory(suspension, true);
      return value;
    } catch (error) {
      await executionContext.hostControl.resumeHistory(suspension, false);
      throw error;
    }
  }, { commandName: `PSD2UI：应用已确认结构计划 ${plan.confirmationId}` });
}

async function wrapTopLevelLayersInGroup(layerIds, groupName, persist) {
  const document = requireDocument();
  const requestedIds = Array.from(new Set((layerIds || []).map((value) => String(value))));
  const topLevelLayers = Array.from(document.layers || []);
  const topLevelIds = topLevelLayers.map((layer) => String(layer.id));
  if (requestedIds.length !== topLevelIds.length
    || requestedIds.some((layerId) => !topLevelIds.includes(layerId))) {
    throw new Error(
      '创建文档根组时必须显式包含当前全部顶层图层。'
      + `期望：${topLevelIds.join(', ') || '<empty>'}；实际：${requestedIds.join(', ') || '<empty>'}。`);
  }
  const name = String(groupName || '').trim();
  if (!name) throw new Error('创建文档根组时必须提供 groupName。');
  if (topLevelLayers.length === 0) throw new Error('当前 PSD 没有可包入根组的顶层图层。');
  const allLayers = [];
  flattenLayers(topLevelLayers, allLayers);
  const before = allLayers.map((layer) => ({ id: String(layer.id), name: layer.name,
    bounds: readBounds(layer), visible: layer.visible, opacity: layer.opacity }));

  return core.executeAsModal(async (executionContext) => {
    const freshIds = Array.from(requireDocument().layers || []).map((layer) => String(layer.id));
    if (String(requireDocument().id) !== String(document.id)
      || freshIds.length !== topLevelIds.length || freshIds.some((id, index) => id !== topLevelIds[index])) {
      throw new Error('等待 Photoshop 执行期间文档或顶层图层已变化，请刷新后重试。');
    }
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: document.id,
      name: `PSD2UI：创建文档根组 ${name}`
    });
    try {
      const group = await document.createLayerGroup({
        name,
        fromLayers: topLevelLayers
      });
      if (!group) throw new Error(`Photoshop 未能创建文档根组“${name}”。`);
      if (constants && constants.BlendMode && constants.BlendMode.PASSTHROUGH != null) {
        group.blendMode = constants.BlendMode.PASSTHROUGH;
      }
      const children = Array.from(group.layers || []).map((layer) => String(layer.id));
      if (document.layers.length !== 1 || children.length !== topLevelIds.length
        || children.some((id, index) => id !== topLevelIds[index])) {
        throw new Error('建立根组改变了图层叠放顺序，已回滚。');
      }
      before.forEach((entry) => {
        const layer = findLayerById(group.layers || [], entry.id);
        if (!layer || layer.name !== entry.name || layer.visible !== entry.visible || layer.opacity !== entry.opacity) {
          throw new Error('建立根组改变了原图层名称或显示状态，已回滚。');
        }
        const bounds = readBounds(layer);
        if (Object.keys(entry.bounds).some((key) => Math.abs(bounds[key] - entry.bounds[key]) > 0.01)) {
          throw new Error('建立根组改变了图层位置或尺寸，已回滚。');
        }
      });
      const result = {
        id: String(group.id),
        name: String(group.name || name),
        childLayerIds: Array.from(group.layers || []).map((layer) => String(layer.id))
      };
      const value = typeof persist === 'function' ? await persist(result) : result;
      await executionContext.hostControl.resumeHistory(suspension, true);
      return value;
    } catch (error) {
      await executionContext.hostControl.resumeHistory(suspension, false);
      throw error;
    }
  }, { commandName: `PSD2UI：创建文档根组 ${name}` });
}

module.exports = {
  requireDocument,
  openLocalDocument,
  getActiveLayerInfo,
  getActiveLayersInfo,
  getDocumentInfo,
  addSelectionChangeListener,
  createSnapshot,
  validateGroupSelection,
  selectLayersById,
  previewVisualState,
  restoreVisualStatePreview,
  structureActiveLayers,
  renameActiveLayers,
  applyConfirmedPreinitializeRenames,
  applyConfirmedStructurePlan,
  wrapTopLevelLayersInGroup,
  findLayerById,
  readLayer,
  asNumber
};
