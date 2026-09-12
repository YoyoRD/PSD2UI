'use strict';

const { fail } = require('./errors');

const StructuredSemantics = new Set([
  'button',
  'input-field',
  'toggle',
  'list',
  'grid',
  'toggle-page-group',
  'list-page-group'
]);

const GroupNames = Object.freeze({
  button: '按钮',
  'input-field': '输入框',
  toggle: '开关',
  list: '列表',
  grid: '网格',
  'toggle-page-group': '页签页面组',
  'list-page-group': '列表页面组'
});

const GeometryTolerance = 1;

function asNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function geometry(layer) {
  const bounds = layer && layer.bounds || {};
  const left = asNumber(bounds.left);
  const top = asNumber(bounds.top);
  const right = asNumber(bounds.right);
  const bottom = asNumber(bounds.bottom);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function near(left, right) {
  return Math.abs(left - right) <= GeometryTolerance;
}

function geometryFailure(code, semantic, requirement, layers) {
  fail(
    code,
    `无法结构化为${GroupNames[semantic]}：要求 ${requirement}；当前 ${summarize(layers)} 的位置或尺寸不符合。请调整后重试。`,
    { semantic, requirement, actual: summarize(layers) });
}

function requireEqualPositiveSize(semantic, layers) {
  const boxes = layers.map(geometry);
  if (boxes.some((box) => box.width <= 0 || box.height <= 0)) {
    geometryFailure('PSD2UI_STRUCTURE_SIZE_INVALID', semantic, '每个条目都具有正的像素宽高', layers);
  }
  const first = boxes[0];
  if (boxes.some((box) => !near(box.width, first.width) || !near(box.height, first.height))) {
    geometryFailure('PSD2UI_STRUCTURE_SIZE_MISMATCH', semantic, '所有条目尺寸一致（允许 1px 误差）', layers);
  }
  return boxes;
}

function measuredSpacing(gaps, semantic, layers, axisLabel, diagnostics) {
  const first = gaps[0] || 0;
  if (!gaps.some(value => !near(value, first))) return Math.max(0, first);
  if (!diagnostics) {
    geometryFailure('PSD2UI_STRUCTURE_SPACING_MISMATCH', semantic, `${axisLabel}间距一致（允许 1px 误差）`, layers);
  }
  const average = Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length * 100) / 100;
  diagnostics.push({ code: 'PSD2UI_LAYOUT_SPACING_AVERAGED',
    message: `${axisLabel}间距不一致（${Math.min(...gaps)}–${Math.max(...gaps)}px），已取平均 ${average}px 作为统一间距。` });
  return Math.max(0, average);
}

function requireRegularAxis(values, semantic, layers, axisLabel, diagnostics, cellSize) {
  if (values.length <= 1) return 0;
  if (diagnostics) {
    const gaps = values.slice(1).map((value, index) => value - values[index] - cellSize);
    if (gaps.some(gap => gap < -GeometryTolerance)) {
      geometryFailure('PSD2UI_STRUCTURE_OVERLAP_INVALID', semantic, '相邻格子不重叠', layers);
    }
    return measuredSpacing(gaps, semantic, layers, axisLabel, diagnostics) + cellSize;
  }
  const spacing = values[1] - values[0];
  if (values.slice(2).some((value, index) => !near(value - values[index + 1], spacing))) {
    geometryFailure(
      'PSD2UI_STRUCTURE_SPACING_MISMATCH',
      semantic,
      `${axisLabel}间距一致（允许 1px 误差）`,
      layers);
  }
  return spacing;
}

function planListGeometry(layers, diagnostics) {
  const boxes = requireEqualPositiveSize('list', layers);
  const minX = Math.min(...boxes.map((box) => box.centerX));
  const maxX = Math.max(...boxes.map((box) => box.centerX));
  const minY = Math.min(...boxes.map((box) => box.centerY));
  const maxY = Math.max(...boxes.map((box) => box.centerY));
  const horizontal = maxX - minX > GeometryTolerance && maxY - minY <= GeometryTolerance;
  const vertical = maxY - minY > GeometryTolerance && maxX - minX <= GeometryTolerance;
  if (!horizontal && !vertical) {
    geometryFailure(
      'PSD2UI_STRUCTURE_ALIGNMENT_INVALID',
      'list',
      '条目沿单一横轴或纵轴对齐，不能重叠或同时跨两个方向',
      layers);
  }
  const ordered = boxes.slice().sort((left, right) => horizontal
    ? left.left - right.left
    : left.top - right.top);
  const gaps = ordered.slice(1).map((box, index) => horizontal
    ? box.left - ordered[index].right
    : box.top - ordered[index].bottom);
  if (gaps.some((gap) => gap < -GeometryTolerance)) {
    geometryFailure('PSD2UI_STRUCTURE_OVERLAP_INVALID', 'list', '相邻条目不重叠', layers);
  }
  if (!diagnostics && gaps.length > 1 && gaps.slice(1).some((gap) => !near(gap, gaps[0]))) {
    geometryFailure('PSD2UI_STRUCTURE_SPACING_MISMATCH', 'list', '条目间距一致（允许 1px 误差）', layers);
  }
  return {
    direction: horizontal ? 'horizontal' : 'vertical',
    itemWidth: boxes[0].width,
    itemHeight: boxes[0].height,
    spacing: diagnostics ? measuredSpacing(gaps, 'list', layers, horizontal ? '横向' : '纵向', diagnostics) : Math.max(0, gaps[0] || 0)
  };
}

function clusterAxis(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  const clusters = [];
  sorted.forEach((value) => {
    const last = clusters[clusters.length - 1];
    if (!last || !near(last.value, value)) {
      clusters.push({ value, count: 1 });
    } else {
      last.value = (last.value * last.count + value) / (last.count + 1);
      last.count += 1;
    }
  });
  return clusters.map((entry) => entry.value);
}

function nearestAxisIndex(value, axis) {
  let best = 0;
  for (let index = 1; index < axis.length; index += 1) {
    if (Math.abs(axis[index] - value) < Math.abs(axis[best] - value)) best = index;
  }
  return best;
}

function planGridGeometry(layers, diagnostics) {
  const boxes = requireEqualPositiveSize('grid', layers);
  const columns = clusterAxis(boxes.map((box) => box.centerX));
  const rows = clusterAxis(boxes.map((box) => box.centerY));
  if (columns.length === 1 && rows.length === 1) {
    geometryFailure('PSD2UI_STRUCTURE_OVERLAP_INVALID', 'grid', 'Cell 不能全部重叠', layers);
  }
  const horizontalStep = requireRegularAxis(columns, 'grid', layers, '横向', diagnostics, boxes[0].width);
  const verticalStep = requireRegularAxis(rows, 'grid', layers, '纵向', diagnostics, boxes[0].height);
  if ((columns.length > 1 && horizontalStep < boxes[0].width - GeometryTolerance)
      || (rows.length > 1 && verticalStep < boxes[0].height - GeometryTolerance)) {
    geometryFailure('PSD2UI_STRUCTURE_OVERLAP_INVALID', 'grid', '相邻 Cell 不重叠', layers);
  }
  const occupied = new Set();
  const cellsByRow = new Map();
  boxes.forEach((box) => {
    const column = nearestAxisIndex(box.centerX, columns);
    const row = nearestAxisIndex(box.centerY, rows);
    const key = `${row}:${column}`;
    if (occupied.has(key)) {
      geometryFailure('PSD2UI_STRUCTURE_OVERLAP_INVALID', 'grid', '每个行列位置最多放置一个 Cell', layers);
    }
    occupied.add(key);
    if (!cellsByRow.has(row)) cellsByRow.set(row, []);
    cellsByRow.get(row).push(column);
  });
  if (rows.length > 1 && columns.length > 1) {
    for (let row = 0; row < rows.length; row += 1) {
      const rowColumns = (cellsByRow.get(row) || []).sort((left, right) => left - right);
      const isLast = row === rows.length - 1;
      const hasGap = rowColumns.some((column, index) => column !== index);
      if (rowColumns.length === 0 || hasGap || (!isLast && rowColumns.length !== columns.length)) {
        geometryFailure(
          'PSD2UI_STRUCTURE_GRID_IRREGULAR',
          'grid',
          '按行连续排列，只有最后一行允许缺少尾部 Cell',
          layers);
      }
    }
  }
  return {
    cellWidth: boxes[0].width,
    cellHeight: boxes[0].height,
    columns: columns.length,
    rows: rows.length,
    horizontalSpacing: columns.length > 1 ? Math.max(0, horizontalStep - boxes[0].width) : 0,
    verticalSpacing: rows.length > 1 ? Math.max(0, verticalStep - boxes[0].height) : 0
  };
}

function normalizeLayerKind(layer) {
  const raw = String(layer && layer.kind || '').toLowerCase();
  if (raw.includes('text')) return 'text';
  if (raw.includes('group') || layer && Array.isArray(layer.children) && layer.children.length > 0) {
    return 'group';
  }
  return 'image';
}

function isGroupLayer(layer) {
  return String(layer && layer.kind || '').toLowerCase().includes('group');
}

function summarize(layers) {
  const counts = { image: 0, text: 0, group: 0 };
  layers.forEach((layer) => { counts[normalizeLayerKind(layer)] += 1; });
  return `${counts.image} 张图片、${counts.text} 个文本、${counts.group} 个组`;
}

function requireCommonParent(layers, semantic) {
  const parents = new Set(layers.map((layer) => String(layer.parentId == null ? '' : layer.parentId)));
  if (parents.size > 1) {
    fail(
      'PSD2UI_STRUCTURE_PARENT_MISMATCH',
      `无法结构化为${GroupNames[semantic]}：选中图层不在同一个父级。请移动到共同父级后重试。`);
  }
}

function requireShape(condition, semantic, requirement, layers) {
  if (condition) return;
  fail(
    'PSD2UI_STRUCTURE_SELECTION_INVALID',
    `无法结构化为${GroupNames[semantic]}：要求 ${requirement}，当前选择了 ${summarize(layers)}。请调整选择后重试。`,
    { semantic, requirement, actual: summarize(layers) });
}

function role(name, layer) {
  return { name, layerId: layerIdOf(layer), nodeId: null };
}

function layerIdOf(layer) {
  return String(layer && (layer.layerId == null ? layer.id : layer.layerId) || '').trim();
}

const StructureRoleContracts = Object.freeze({
  button: Object.freeze({
    background: { label: '背景', required: true, kinds: ['image'], semantics: ['image', 'raw-image'] },
    label: { label: '标题', required: false, kinds: ['text'], semantics: ['text'] }
  }),
  'input-field': Object.freeze({
    background: { label: '背景', required: true, kinds: ['image'], semantics: ['image'] },
    text: { label: '输入文字', required: true, kinds: ['text'], semantics: ['text'] },
    placeholder: { label: '占位文字', required: false, kinds: ['text'], semantics: ['text'] }
  }),
  toggle: Object.freeze({
    background: { label: '背景', required: true, kinds: ['image'], semantics: ['image'] },
    'on-graphic': { label: '选中图形', required: true, kinds: ['image'], semantics: ['image'] },
    label: { label: '标题', required: false, kinds: ['text'], semantics: ['text'] }
  }),
  list: Object.freeze({
    'item-template': { label: '条目模板', required: true, kinds: ['group'], semantics: [] }
  }),
  grid: Object.freeze({
    'cell-template': { label: '格子模板', required: true, kinds: ['group'], semantics: [] }
  }),
  'list-page-group': Object.freeze({
    list: { label: '页面列表', required: true, kinds: ['group'], semantics: ['list'] }
  })
});

function structureRoleContract(semantic, name) {
  if (semantic === 'toggle-page-group') {
    return /^toggle-(0|[1-9][0-9]*)$/.test(String(name || ''))
      ? { label: '页签', required: true, kinds: ['group'], semantics: ['toggle'] }
      : null;
  }
  return StructureRoleContracts[semantic] && StructureRoleContracts[semantic][name] || null;
}

function isComponentBoundary(layer) {
  return Boolean(layer && requiresStructure(layer.semantic)
    && layer.structure && Array.isArray(layer.structure.roles));
}

// A component may use descendants of ordinary groups. Nested components remain
// opaque: their root can be a template or page role, their internals cannot.
function isWithinComponent(layerId, ownerLayerId, parentById, nodesById) {
  let current = String(parentById[String(layerId)] || '');
  const owner = String(ownerLayerId);
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === owner) return true;
    if (isComponentBoundary(nodesById[current])) return false;
    visited.add(current);
    current = String(parentById[current] || '');
  }
  return false;
}

function collectComponentCandidates(layers) {
  const result = [];
  const seen = new Set();
  function visit(layer, path, parentId) {
    const layerId = layerIdOf(layer);
    if (!layerId || seen.has(layerId)) {
      fail('PSD2UI_STRUCTURE_LAYER_ID_INVALID', '组件候选图层缺少唯一的 Photoshop layerId。');
    }
    seen.add(layerId);
    if (layer.semantic === 'ignore' || layer.exportMode === 'preview-only') return;
    const name = String(layer.name || layerId);
    const candidate = { ...layer, layerId, parentId: parentId == null
      ? String(layer.parentId == null ? '' : layer.parentId) : String(parentId),
    path: path ? `${path}/${name}` : name };
    result.push(candidate);
    if (isComponentBoundary(layer)) return;
    (layer.children || []).filter(Boolean).forEach((child) => visit(child, candidate.path, layerId));
  }
  layers.forEach((layer) => visit(layer, '', null));
  return result;
}

function candidateSummary(layer) {
  return { layerId: layerIdOf(layer), name: String(layer.name || ''),
    kind: normalizeLayerKind(layer), semantic: String(layer.semantic || ''),
    parentId: String(layer.parentId == null ? '' : layer.parentId), path: layer.path || String(layer.name || '') };
}

function roleAcceptsLayer(contract, layer) {
  const kind = normalizeLayerKind(layer);
  if (!contract.kinds.includes(kind)) return false;
  if (kind === 'group') return contract.semantics.length === 0 || contract.semantics.includes(layer.semantic);
  // Assigning an image role may deliberately select Image rather than a previous
  // automatic RawImage projection; applyStructuredGroup handles that conversion.
  return !isComponentBoundary(layer);
}

function normalizeRoleChoices(options, semantic) {
  const choices = new Map();
  if (options.roles != null && !Array.isArray(options.roles)) {
    fail('PSD2UI_STRUCTURE_ROLE_INVALID', 'roles 必须是包含 name/layerId 的数组。');
  }
  (options.roles || []).forEach((choice) => {
    const name = String(choice && choice.name || '').trim();
    if (!structureRoleContract(semantic, name) || choices.has(name)) {
      fail('PSD2UI_STRUCTURE_ROLE_INVALID', `组件 ${semantic} 包含未知或重复角色 '${name}'。`);
    }
    choices.set(name, String(choice.layerId == null ? '' : choice.layerId).trim());
  });
  if (options.templateLayerId != null) {
    const name = semantic === 'list' ? 'item-template' : semantic === 'grid' ? 'cell-template' : '';
    if (!name) fail('PSD2UI_STRUCTURE_TEMPLATE_INVALID', '只有列表或网格可以指定 templateLayerId。');
    const id = String(options.templateLayerId).trim();
    if (choices.has(name) && choices.get(name) !== id) {
      fail('PSD2UI_STRUCTURE_TEMPLATE_INVALID', '模板角色与 templateLayerId 指向不同图层。');
    }
    choices.set(name, id);
  }
  return choices;
}

function describeRoles(semantic, candidates, options) {
  const choices = normalizeRoleChoices(options, semantic);
  const explicitRoles = Array.isArray(options.roles);
  let names = Object.keys(StructureRoleContracts[semantic] || {});
  if (semantic === 'toggle-page-group') {
    const toggles = candidates.filter((layer) => normalizeLayerKind(layer) === 'group' && layer.semantic === 'toggle');
    names = choices.size ? [...choices.keys()].sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
      : toggles.map((_layer, index) => `toggle-${index}`);
    if (names.length === 0) names = ['toggle-0'];
  }
  const occupied = new Set([...choices.values()].filter(Boolean));
  const roles = names.map((name) => {
    const contract = structureRoleContract(semantic, name);
    const matching = candidates.filter((layer) => roleAcceptsLayer(contract, layer));
    const selectable = matching.filter((layer) => !occupied.has(layerIdOf(layer)) || choices.get(name) === layerIdOf(layer));
    const selectedLayerId = choices.has(name) ? choices.get(name)
      : explicitRoles && !contract.required ? ''
        : selectable.length === 1 ? layerIdOf(selectable[0]) : '';
    if (selectedLayerId) occupied.add(selectedLayerId);
    return { name, label: contract.label, required: contract.required,
      candidates: matching.map(candidateSummary), selectedLayerId,
      explicit: choices.has(name) || explicitRoles && !contract.required,
      ambiguous: !choices.has(name) && !(explicitRoles && !contract.required) && selectable.length > 1 };
  });
  return roles;
}

function requireStructuredGroupRoot(semantic, groupRoot) {
  if (!groupRoot || !isGroupLayer(groupRoot)) {
    fail(
      'PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED',
      `无法结构化为${GroupNames[semantic]}：必须只选择 1 个现有 Photoshop 组作为组件根。`
      + '请先在 Photoshop 图层面板中建立组，再选择该组。');
  }
  const rootLayerId = layerIdOf(groupRoot);
  if (!rootLayerId) {
    fail('PSD2UI_STRUCTURE_ROOT_LAYER_ID_REQUIRED', '结构化组件组根缺少 Photoshop layerId。');
  }
  const rootName = String(groupRoot.name || '').trim();
  if (!rootName) {
    fail('PSD2UI_STRUCTURE_ROOT_NAME_REQUIRED', `结构化为${GroupNames[semantic]}的 Photoshop 组不能为空名。`);
  }
  const children = Array.isArray(groupRoot.children) ? groupRoot.children.filter(Boolean) : [];
  if (children.length === 0) {
    fail(
      'PSD2UI_STRUCTURE_ROOT_EMPTY',
      `无法结构化为${GroupNames[semantic]}：组根 '${rootName}' 没有直属子图层。`);
  }
  const rootGeometry = geometry(groupRoot);
  if (rootGeometry.width <= 0 || rootGeometry.height <= 0) {
    fail(
      'PSD2UI_STRUCTURE_ROOT_BOUNDS_INVALID',
      `无法结构化为${GroupNames[semantic]}：组根 '${rootName}' 必须具有正的像素宽高；`
      + `当前为 ${rootGeometry.width} × ${rootGeometry.height}。请检查组内可见内容和图层边界。`,
      { layerId: rootLayerId, bounds: groupRoot.bounds || null });
  }
  const nonDirectChild = children.find((child) => String(child.parentId == null ? '' : child.parentId) !== rootLayerId);
  if (nonDirectChild) {
    fail(
      'PSD2UI_STRUCTURE_ROOT_CHILD_INVALID',
      `无法结构化为${GroupNames[semantic]}：图层 ${nonDirectChild.layerId || '<empty>'} 不是组根 '${rootName}' 的直属子图层。`);
  }
  return { rootLayerId, rootName, children };
}

function planStructuredGroup(semantic, groupRoot, options) {
  const normalizedSemantic = String(semantic || '').trim();
  if (!StructuredSemantics.has(normalizedSemantic)) {
    fail('PSD2UI_STRUCTURE_SEMANTIC_REQUIRED', `语义 '${normalizedSemantic}' 不支持结构化。`);
  }
  const root = requireStructuredGroupRoot(normalizedSemantic, groupRoot);
  const plan = planStructure(normalizedSemantic, root.children, options);
  return {
    ...plan,
    rootLayerId: root.rootLayerId,
    groupName: root.rootName
  };
}

function planCollectionLayout(semantic, samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    fail('PSD2UI_STRUCTURE_LAYOUT_REQUIRED', '只有一个模板时，请明确填写方向、尺寸与间距等布局参数。');
  }
  return semantic === 'list' ? planListGeometry(samples) : planGridGeometry(samples);
}

function suggestCollectionLayout(semantic, samples) {
  if (!['list', 'grid'].includes(semantic) || !Array.isArray(samples) || samples.length < 2) {
    fail('PSD2UI_STRUCTURE_LAYOUT_REQUIRED', '自动计算间距需要至少两个格子或条目组。');
  }
  const diagnostics = [];
  const layout = semantic === 'list' ? planListGeometry(samples, diagnostics) : planGridGeometry(samples, diagnostics);
  return { layout, diagnostics };
}

function validateTemplateSize(semantic, layout, template) {
  validateStructureLayout(semantic, layout);
  const box = geometry(template);
  const width = semantic === 'list' ? layout.itemWidth : layout.cellWidth;
  const height = semantic === 'list' ? layout.itemHeight : layout.cellHeight;
  if (Math.abs(width - box.width) > 0.01 || Math.abs(height - box.height) > 0.01) {
    fail('PSD2UI_STRUCTURE_LAYOUT_STALE', '模板尺寸与已记录布局不一致，请重新配置模板或布局。');
  }
}

function planStructure(semantic, selectedLayers, options) {
  const normalizedSemantic = String(semantic || '').trim();
  if (!StructuredSemantics.has(normalizedSemantic)) {
    fail('PSD2UI_STRUCTURE_SEMANTIC_REQUIRED', `语义 '${normalizedSemantic}' 不支持结构化。`);
  }
  const layers = Array.isArray(selectedLayers) ? selectedLayers.filter(Boolean) : [];
  if (layers.length === 0) {
    fail('PSD2UI_STRUCTURE_SELECTION_REQUIRED', `结构化为${GroupNames[normalizedSemantic]}前必须选择图层。`);
  }
  requireCommonParent(layers, normalizedSemantic);
  const settings = options || {};
  const candidates = collectComponentCandidates(layers);
  const described = describeRoles(normalizedSemantic, candidates, settings);
  const roles = [];
  const usedIds = new Set();
  described.forEach((entry) => {
    if (entry.ambiguous) {
      fail('PSD2UI_STRUCTURE_ROLE_AMBIGUOUS', `${GroupNames[normalizedSemantic]}的“${entry.label}”有多个候选，请明确选择角色图层。`,
        { semantic: normalizedSemantic, roleName: entry.name, candidates: entry.candidates });
    }
    if (!entry.selectedLayerId) {
      if (entry.required) {
        fail('PSD2UI_STRUCTURE_ROLE_REQUIRED', `${GroupNames[normalizedSemantic]}缺少“${entry.label}”角色，请选择对应图层。`,
          { semantic: normalizedSemantic, roleName: entry.name, candidates: entry.candidates });
      }
      return;
    }
    const target = candidates.find((layer) => layerIdOf(layer) === entry.selectedLayerId);
    if (!target || !entry.candidates.some((candidate) => candidate.layerId === entry.selectedLayerId)) {
      fail('PSD2UI_STRUCTURE_ROLE_SCOPE_INVALID', `角色 '${entry.name}' 必须指向当前组件内类型匹配的图层，不能穿越另一个组件。`);
    }
    if (usedIds.has(entry.selectedLayerId)) {
      fail('PSD2UI_STRUCTURE_ROLE_DUPLICATE', `图层 ${entry.selectedLayerId} 不能同时占用多个组件角色，请明确选择。`);
    }
    usedIds.add(entry.selectedLayerId);
    roles.push(role(entry.name, target));
  });
  if (normalizedSemantic === 'toggle-page-group') {
    roles.forEach((entry, index) => {
      if (entry.name !== `toggle-${index}`) {
        fail('PSD2UI_STRUCTURE_ROLE_INVALID', '页签角色必须从 toggle-0 连续编号，顺序由明确角色配置决定。');
      }
    });
  }
  if (settings.previewLayerIds != null && !Array.isArray(settings.previewLayerIds)) {
    fail('PSD2UI_STRUCTURE_PREVIEW_INVALID', 'previewLayerIds 必须是数组。');
  }
  const previewLayerIds = (settings.previewLayerIds || []).map((id) => String(id).trim());
  if (new Set(previewLayerIds).size !== previewLayerIds.length) {
    fail('PSD2UI_STRUCTURE_PREVIEW_INVALID', '预览样例不能重复。');
  }
  let layout = null;
  if (normalizedSemantic === 'list' || normalizedSemantic === 'grid') {
    const templateId = roles[0].layerId;
    const template = candidates.find((layer) => layerIdOf(layer) === templateId);
    const samples = [template];
    previewLayerIds.forEach((id) => {
      const sample = candidates.find((layer) => layerIdOf(layer) === id);
      if (!sample || normalizeLayerKind(sample) !== 'group' || id === templateId
          || String(sample.parentId) !== String(template.parentId)) {
        fail('PSD2UI_STRUCTURE_PREVIEW_INVALID', '预览样例必须是模板的同级组，不能包含模板本身或跨越另一组件。');
      }
      samples.push(sample);
    });
    layout = settings.layout ? JSON.parse(JSON.stringify(settings.layout))
      : planCollectionLayout(normalizedSemantic, samples);
    validateTemplateSize(normalizedSemantic, layout, template);
  } else if (previewLayerIds.length || settings.layout != null) {
    fail('PSD2UI_STRUCTURE_PREVIEW_INVALID', '只有列表或网格支持模板预览与集合布局。');
  }

  const structure = {
    version: 1,
    roles,
    previewLayerIds
  };
  if (layout) {
    structure.layout = layout;
    structure.layoutSource = settings.layout ? 'explicit' : 'inferred';
  }
  return {
    semantic: normalizedSemantic,
    groupName: GroupNames[normalizedSemantic],
    structure
  };
}

function describeStructuredSelection(semantic, selectedLayers, options) {
  if (!requiresStructure(semantic)) fail('PSD2UI_STRUCTURE_SEMANTIC_REQUIRED', `语义 '${semantic}' 不支持结构化。`);
  const layers = Array.isArray(selectedLayers) ? selectedLayers.filter(Boolean) : [];
  if (!layers.length) fail('PSD2UI_STRUCTURE_SELECTION_REQUIRED', '请先选择现有组，或需要组合的同级图层。');
  const existingRoot = layers.length === 1 && isGroupLayer(layers[0]);
  if (!existingRoot && layers.length < 2) {
    fail('PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED', '组合组件需要现有组或至少两个同级图层。');
  }
  requireCommonParent(layers, semantic);
  const root = existingRoot ? requireStructuredGroupRoot(semantic, layers[0]) : null;
  const members = existingRoot ? root.children : layers;
  const candidates = collectComponentCandidates(members);
  const settings = options || {};
  const roles = describeRoles(semantic, candidates, settings);
  let plan = null;
  let issues = [];
  try { plan = planStructure(semantic, members, settings); }
  catch (error) { issues = [{ code: error.code || 'PSD2UI_STRUCTURE_INVALID', message: error.message, ...(error.details || {}) }]; }
  return { semantic, requiresGroup: !existingRoot, rootLayerId: root && root.rootLayerId || null,
    groupName: root ? root.rootName : String(settings.groupName || GroupNames[semantic]),
    sourceLayerIds: layers.map(layerIdOf), parentLayerId: String(layers[0].parentId == null ? '' : layers[0].parentId),
    roles, previewCandidates: candidates.filter((layer) => normalizeLayerKind(layer) === 'group').map(candidateSummary),
    layout: plan && plan.structure.layout || settings.layout || null,
    needsConfiguration: issues.length > 0, issues };
}

function planStructuredSelection(semantic, selectedLayers, options) {
  const described = describeStructuredSelection(semantic, selectedLayers, options);
  const layers = selectedLayers.filter(Boolean);
  const plan = described.requiresGroup ? planStructure(semantic, layers, options)
    : planStructuredGroup(semantic, layers[0], options);
  return { ...plan, rootLayerId: described.rootLayerId, requiresGroup: described.requiresGroup,
    sourceLayerIds: described.sourceLayerIds, parentLayerId: described.parentLayerId,
    groupName: described.groupName };
}

function validateVisualStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Array.isArray(value.states) || value.states.length === 0) {
    fail('PSD2UI_VISUAL_STATES_INVALID', '状态配置需要默认状态及至少一个状态组。');
  }
  const names = new Set();
  const ids = new Set();
  value.states.forEach((state) => {
    const name = String(state && state.name || '').trim();
    const id = String(state && state.layerId || '').trim();
    if (!name || !id || names.has(name) || ids.has(id)) {
      fail('PSD2UI_VISUAL_STATES_INVALID', '状态名和状态组必须非空且不能重复。');
    }
    names.add(name); ids.add(id);
  });
  if (!names.has(String(value.defaultState || '').trim())) {
    fail('PSD2UI_VISUAL_STATES_INVALID', '默认状态必须指向已配置的状态名。');
  }
  return { defaultState: String(value.defaultState).trim(),
    states: value.states.map((state) => ({ name: String(state.name).trim(), layerId: String(state.layerId).trim() })) };
}

function planVisualStates(groupRoot, value) {
  const root = requireStructuredGroupRoot('button', groupRoot);
  const result = validateVisualStates(value);
  const candidates = collectComponentCandidates(root.children);
  const byId = new Map(candidates.map((candidate) => [layerIdOf(candidate), candidate]));
  const stateIds = new Set(result.states.map((state) => state.layerId));
  result.states.forEach((state) => {
    const candidate = byId.get(state.layerId);
    if (!candidate || !isGroupLayer(candidate)) {
      fail('PSD2UI_VISUAL_STATE_SCOPE_INVALID', `状态 '${state.name}' 必须指向当前组件内的组，不能穿越其他组件。`);
    }
    let parentId = candidate.parentId;
    const visited = new Set();
    while (byId.has(parentId) && !visited.has(parentId)) {
      if (stateIds.has(parentId)) fail('PSD2UI_VISUAL_STATE_OVERLAP', '不同状态组不能互相嵌套。');
      visited.add(parentId);
      parentId = byId.get(parentId).parentId;
    }
  });
  return result;
}

function requiresStructure(semantic) {
  return StructuredSemantics.has(String(semantic || ''));
}

function validateStructureLayout(semantic, layout) {
  const list = semantic === 'list';
  const keys = list ? ['direction', 'itemWidth', 'itemHeight', 'spacing']
    : ['cellWidth', 'cellHeight', 'columns', 'rows', 'horizontalSpacing', 'verticalSpacing'];
  if (!['list', 'grid'].includes(semantic) || !layout || typeof layout !== 'object'
      || Array.isArray(layout) || Object.keys(layout).length !== keys.length
      || keys.some((key) => !Object.prototype.hasOwnProperty.call(layout, key))) {
    fail('PSD2UI_STRUCTURE_LAYOUT_INVALID', `${semantic} 必须包含完整且无额外字段的 structure.layout。`);
  }
  const positive = list ? ['itemWidth', 'itemHeight'] : ['cellWidth', 'cellHeight'];
  const nonnegative = list ? ['spacing'] : ['horizontalSpacing', 'verticalSpacing'];
  if (positive.some((key) => !Number.isFinite(layout[key]) || layout[key] <= 0)
      || nonnegative.some((key) => !Number.isFinite(layout[key]) || layout[key] < 0)
      || (list && !['horizontal', 'vertical'].includes(layout.direction))
      || (!list && ['rows', 'columns'].some((key) => !Number.isInteger(layout[key]) || layout[key] < 1))) {
    fail('PSD2UI_STRUCTURE_LAYOUT_INVALID', `${semantic} 布局尺寸必须为正数、间距非负，方向或行列数必须有效。`);
  }
  return layout;
}

module.exports = {
  StructuredSemantics,
  isGroupLayer,
  normalizeLayerKind,
  StructureRoleContracts,
  structureRoleContract,
  isComponentBoundary,
  isWithinComponent,
  collectComponentCandidates,
  describeStructuredSelection,
  planStructuredSelection,
  planStructuredGroup,
  planStructure,
  planCollectionLayout,
  suggestCollectionLayout,
  validateTemplateSize,
  validateVisualStates,
  planVisualStates,
  requiresStructure,
  validateStructureLayout
};
