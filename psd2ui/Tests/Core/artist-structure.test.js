'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeAuthoringCommand, planStructure, planStructuredGroup, planStructuredSelection,
  describeStructuredSelection, evaluateSemanticAvailability, requireSemanticAction,
  prepareManifestForExport, buildBundle, planVisualStates, collectComponentCandidates
} = require('../../Core');

function image(id, name = `comm_sp_${String(id).padStart(4, '0')}`, x = 0, y = 0, width = 100, height = 30) {
  return { layerId: String(id), kind: 'pixel', name, visible: true,
    bounds: { left: x, top: y, right: x + width, bottom: y + height }, children: [] };
}
function text(id, name = '标题') { return { ...image(id, name), kind: 'text', text: { value: name, fontSize: 18 } }; }
function group(id, name, children = [], x = 0, y = 0, width = 100, height = 30) {
  return { ...image(id, name, x, y, width, height), kind: 'group',
    children: children.map((child) => ({ ...child, parentId: String(id) })) };
}
function initialize(root) {
  return executeAuthoringCommand(null, { command: 'initialize-document', input: {
    resourceNaming: 'source', name: '正式界面', rootLayerId: root.layerId, rootLayerName: root.name,
    width: root.bounds.right - root.bounds.left, height: root.bounds.bottom - root.bounds.top, snapshot: { root }
  } }, { actor: 'human-panel' }).manifest;
}
function command(manifest, commandName, input) {
  return executeAuthoringCommand(manifest, { command: commandName, input }, { actor: 'human-panel' }).manifest;
}
function configure(manifest, root, semantic, options) {
  const plan = planStructuredGroup(semantic, root, options);
  return command(manifest, 'apply-structured-group', { layerId: root.layerId, name: root.name,
    semantic, structure: plan.structure });
}
function decorate(layer, manifest) {
  const node = manifest.nodes[layer.layerId];
  return { ...layer, semantic: node && node.semantic, structure: node && node.structure,
    children: (layer.children || []).map((child) => decorate(child, manifest)) };
}

test('source 初始化保留中文组与文字，旧 @ 名称不决定组件或 RawImage', () => {
  const root = group('document-root', '中文根', [group(2, '确认@anniu', [
    image(3, 'comm_bt_0032@unpack', 0, 0, 700, 60), text(4, '任意 中文 文字')
  ], 0, 0, 700, 60)], 0, 0, 720, 1280);
  const manifest = initialize(root);
  assert.equal(manifest.document.module, 'ui');
  assert.equal(manifest.nodes['2'].semantic, 'group');
  assert.equal(manifest.nodes['3'].semantic, 'image');
  const bundle = buildBundle(manifest, { root });
  assert.equal(bundle.schemaVersion, '1.5.0');
  assert.equal(bundle.resources[0].fileName, 'comm_bt_0032.png');
  assert.equal(bundle.resources[0].kind, 'sprite');
  assert.equal(bundle.root.children[0].children[1].name, '任意 中文 文字');
});

test('按钮允许普通嵌套组和装饰，显式角色按稳定 ID 导出而不搬动图层', () => {
  const button = group(2, '购买', [image(3), group(4, '装饰与标题', [image(5), text(6), text(7, '额外文案')])]);
  const root = group(1, '根', [button]);
  const before = JSON.stringify(root);
  assert.throws(() => planStructuredGroup('button', button), error => error.code === 'PSD2UI_STRUCTURE_ROLE_AMBIGUOUS');
  const manifest = configure(initialize(root), button, 'button', {
    roles: [{ name: 'background', layerId: 3 }, { name: 'label', layerId: 6 }]
  });
  const built = buildBundle(manifest, { root }).root.children[0];
  assert.equal(built.structure.roles.find(role => role.name === 'label').nodeId, manifest.nodes['6'].id);
  assert.equal(built.children[1].children.length, 3);
  assert.equal(JSON.stringify(root), before);
});

test('角色候选不穿过已结构化子组件，显式越界也不能配置', () => {
  const child = group(4, '子按钮', [image(5), text(6)]);
  child.semantic = 'button';
  child.structure = { version: 1, roles: [{ name: 'background', layerId: '5' }] };
  const root = group(2, '外按钮', [image(3), child]);
  const description = describeStructuredSelection('button', [root]);
  assert.deepEqual(description.roles.find(role => role.name === 'background').candidates.map(layer => layer.layerId), ['3']);
  assert.deepEqual(description.roles.find(role => role.name === 'label').candidates, []);
  assert.equal(planStructuredGroup('button', root).structure.roles.length, 1);
  assert.throws(() => planStructuredGroup('button', root, { roles: [{ name: 'background', layerId: 5 }] }),
    error => error.code === 'PSD2UI_STRUCTURE_ROLE_SCOPE_INVALID');
});

test('Toggle 与双文本 Input 不按层顺序猜角色，明确一个角色后可补唯一余项', () => {
  const toggle = group(1, '选择', [image(2), image(3), text(4)]);
  assert.throws(() => planStructuredGroup('toggle', toggle), error => error.code === 'PSD2UI_STRUCTURE_ROLE_AMBIGUOUS');
  const plan = planStructuredGroup('toggle', toggle, { roles: [{ name: 'background', layerId: 3 }] });
  assert.deepEqual(plan.structure.roles.map(role => [role.name, role.layerId]), [['background', '3'], ['on-graphic', '2']]);
  const input = group(5, '输入', [image(6), text(7), text(8)]);
  assert.throws(() => planStructuredGroup('input-field', input), error => error.code === 'PSD2UI_STRUCTURE_ROLE_AMBIGUOUS');
});

test('同级多选产生可执行组合计划但没有虚构组 layerId', () => {
  const selected = [image(2), text(3)].map(layer => ({ ...layer, parentId: '1' }));
  const plan = planStructuredSelection('button', selected);
  assert.equal(plan.requiresGroup, true);
  assert.equal(plan.rootLayerId, null);
  assert.deepEqual(plan.sourceLayerIds, ['2', '3']);
  assert.equal(plan.parentLayerId, '1');
  assert.deepEqual(plan.structure.roles.map(role => role.layerId), ['2', '3']);
  assert.equal(requireSemanticAction(selected, 'button', 'structure').requiresGroup, true);
  assert.throws(() => planStructuredSelection('button', [selected[0], { ...selected[1], parentId: '9' }]),
    error => error.code === 'PSD2UI_STRUCTURE_PARENT_MISMATCH');
  assert.throws(() => planStructuredSelection('button', [selected[0], selected[0]]),
    error => error.code === 'PSD2UI_STRUCTURE_LAYER_ID_INVALID');
});

test('组件有额外图片时仍可进入配置，缺少必需类型则说明缺项', () => {
  const root = group(1, '按钮', [image(2), image(3), text(4)]);
  const availability = evaluateSemanticAvailability([root]).find(entry => entry.semantic === 'button');
  assert.equal(availability.canStructure, false);
  assert.equal(availability.canConfigure, true);
  assert.equal(requireSemanticAction([root], 'button', 'configure').enabled, true);
  const missing = evaluateSemanticAvailability([group(1, '无文字', [image(2)])])
    .find(entry => entry.semantic === 'input-field');
  assert.equal(missing.canConfigure, false);
});

test('列表明确模板和预览样例，其他子组仍是普通视觉内容', () => {
  const list = group(2, '列表', [group(3, '样例', [], 0, 0), group(4, '模板', [], 0, 40), group(5, '装饰组', [image(6)], 0, 100)], 0, 0, 100, 150);
  const root = group(1, '根', [list], 0, 0, 100, 200);
  assert.throws(() => planStructuredGroup('list', list), error => error.code === 'PSD2UI_STRUCTURE_ROLE_AMBIGUOUS');
  const options = { templateLayerId: '4', previewLayerIds: ['3'] };
  const manifest = configure(initialize(root), list, 'list', options);
  const built = buildBundle(manifest, { root }).root.children[0];
  assert.deepEqual(built.children.map(node => node.sourceLayerId), ['4', '5']);
  assert.equal(built.structure.roles[0].nodeId, manifest.nodes['4'].id);
  assert.equal(built.structure.layout.spacing, 10);
});

test('单模板必须明确布局；显式布局不被 PSD 中的样例排版重新覆盖', () => {
  const list = group(2, '列表', [group(3, '模板')]);
  assert.throws(() => planStructuredGroup('list', list), error => error.code === 'PSD2UI_STRUCTURE_LAYOUT_REQUIRED');
  const layout = { direction: 'horizontal', itemWidth: 100, itemHeight: 30, spacing: 18 };
  const root = group(1, '根', [list]);
  let manifest = configure(initialize(root), list, 'list', { templateLayerId: '3', layout });
  assert.equal(manifest.nodes['2'].structure.layoutSource, 'explicit');
  const changed = group(1, '根', [group(2, '列表', [group(3, '模板'), group(4, '样例', [], 0, 55)])]);
  manifest.nodes['2'].structure.previewLayerIds = ['4'];
  const prepared = prepareManifestForExport(manifest, { root: changed });
  assert.deepEqual(prepared.manifest.nodes['2'].structure.layout, layout);
  assert.equal(prepared.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
  assert.throws(() => planStructuredGroup('list', list, { templateLayerId: '3', layout: { ...layout, itemWidth: 99 } }),
    error => error.code === 'PSD2UI_STRUCTURE_LAYOUT_STALE');
});

test('模板不能同时成为预览，跨父级或重复预览不被接受', () => {
  const list = group(2, '列表', [group(3, '模板'), group(4, '包裹', [group(5, '内层')])]);
  const layout = { direction: 'vertical', itemWidth: 100, itemHeight: 30, spacing: 5 };
  for (const previewLayerIds of [['3'], ['5'], ['4', '4']]) {
    assert.throws(() => planStructuredGroup('list', list, { templateLayerId: '3', previewLayerIds, layout }),
      error => error.code === 'PSD2UI_STRUCTURE_PREVIEW_INVALID');
  }
});

test('导出重新校验角色的组件边界，后续把普通包裹组结构化会失效', () => {
  const wrapper = group(3, '普通组', [image(4)]);
  const button = group(2, '外按钮', [wrapper]);
  const root = group(1, '根', [button]);
  let manifest = configure(initialize(root), button, 'button');
  manifest = configure(manifest, wrapper, 'button');
  const prepared = prepareManifestForExport(manifest, { root });
  assert.ok(prepared.diagnostics.some(diagnostic => diagnostic.code === 'PSD2UI_STRUCTURE_ROLE_CROSSES_COMPONENT'));
  assert.throws(() => buildBundle(manifest, { root }), error => error.code === 'PSD2UI_STRUCTURE_INVALID_FOR_EXPORT');
});

test('视觉状态保存默认值并保留 PSD 的原始可见性，导出映射到已有组', () => {
  const component = group(2, '状态组件', [group(3, '正常', [image(5)]), group(4, '选中', [image(6)])]);
  const root = group(1, '根', [component]);
  const states = planVisualStates(component, { defaultState: '正常', states: [{ name: '正常', layerId: 3 }, { name: '选中', layerId: 4 }] });
  const manifest = command(initialize(root), 'set-visual-states', { layerId: 2, visualStates: states });
  const built = buildBundle(manifest, { root }).root.children[0];
  assert.equal(built.visualStates.defaultState, '正常');
  assert.deepEqual(built.children.map(child => child.visible), ['enabled', 'disabled']);
  assert.equal(root.children[0].children[1].visible, true);
  assert.equal(command(manifest, 'set-visual-states', { layerId: 2, visualStates: null }).nodes['2'].visualStates, undefined);
});

test('视觉状态拒绝默认值缺失、互嵌、非组、跨子组件和忽略子树', () => {
  const component = group(2, '状态组件', [group(3, '普通组', [group(4, '内层', [image(5)])]), group(6, '其他', [image(7)])]);
  const root = group(1, '根', [component]);
  assert.throws(() => planVisualStates(component, { defaultState: '无', states: [{ name: '正常', layerId: 3 }] }),
    error => error.code === 'PSD2UI_VISUAL_STATES_INVALID');
  assert.throws(() => planVisualStates(component, { defaultState: '正常', states: [{ name: '正常', layerId: 3 }, { name: '内层', layerId: 4 }] }),
    error => error.code === 'PSD2UI_VISUAL_STATE_OVERLAP');
  assert.throws(() => planVisualStates(component, { defaultState: '图', states: [{ name: '图', layerId: 5 }] }),
    error => error.code === 'PSD2UI_VISUAL_STATE_SCOPE_INVALID');
  let manifest = initialize(root);
  manifest = configure(manifest, component.children[0], 'button');
  assert.equal(collectComponentCandidates(decorate(component, manifest).children).some(layer => layer.layerId === '4'), false);
  manifest = command(manifest, 'set-visual-states', { layerId: 2, visualStates: { defaultState: '内层', states: [{ name: '内层', layerId: 4 }] } });
  assert.ok(prepareManifestForExport(manifest, { root }).diagnostics.some(diagnostic => diagnostic.code === 'PSD2UI_VISUAL_STATE_SCOPE_INVALID'));
  manifest = command(initialize(root), 'apply-node-preset', { layerId: 6, name: '其他', semantic: 'ignore' });
  manifest = command(manifest, 'set-visual-states', { layerId: 2, visualStates: { defaultState: '忽略', states: [{ name: '忽略', layerId: 6 }] } });
  assert.ok(prepareManifestForExport(manifest, { root }).diagnostics.some(diagnostic => diagnostic.code === 'PSD2UI_VISUAL_STATE_SCOPE_INVALID'));
});

test('可视区域只覆盖列表尺寸，源范围改变会报告但不覆盖明确设置', () => {
  const list = group(2, '列表', [group(3, '模板')], 10, 20, 100, 200);
  const root = group(1, '根', [list], 0, 0, 300, 500);
  const layout = { direction: 'vertical', itemWidth: 100, itemHeight: 30, spacing: 8 };
  let manifest = configure(initialize(root), list, 'list', { templateLayerId: '3', layout });
  manifest = command(manifest, 'set-node-viewport', { layerId: 2, viewport: { width: 120, height: 90 }, sourceBounds: list.bounds });
  const built = buildBundle(manifest, { root }).root.children[0];
  assert.deepEqual(built.rect, { x: 10, y: 20, width: 120, height: 90 });
  assert.equal(built.children[0].rect.x, -10);
  const changed = JSON.parse(JSON.stringify(root));
  changed.children[0].bounds.bottom += 30;
  const prepared = prepareManifestForExport(manifest, { root: changed });
  assert.ok(prepared.diagnostics.some(diagnostic => diagnostic.code === 'PSD2UI_VIEWPORT_SOURCE_CHANGED'));
  assert.deepEqual(prepared.manifest.nodes['2'].viewport, { width: 120, height: 90 });
  assert.throws(() => command(manifest, 'set-node-viewport', { layerId: 2, viewport: { width: 0, height: 80 } }),
    error => error.code === 'PSD2UI_VIEWPORT_INVALID');
  assert.equal(command(manifest, 'set-node-viewport', { layerId: 2, viewport: null }).nodes['2'].viewport, undefined);
});

test('source 的忽略与预览子树不分配图片资源，也不被其未命名图片阻断', () => {
  const list = group(2, '列表', [group(3, '模板', [image(4)]), group(5, '样例', [image(6, '未命名图片')], 0, 40)]);
  const ignored = group(7, '不导出', [image(8, '另一个未命名图片')]);
  const root = group(1, '根', [list, ignored]);
  let manifest = configure(initialize(root), list, 'list', { templateLayerId: 3, previewLayerIds: [5] });
  manifest = command(manifest, 'apply-node-preset', { layerId: 7, name: ignored.name, semantic: 'ignore' });
  const prepared = prepareManifestForExport(manifest, { root });
  assert.equal(prepared.manifest.resourceRegistry.layerBindings['6'], undefined);
  assert.equal(prepared.manifest.resourceRegistry.layerBindings['8'], undefined);
  const bundle = buildBundle(manifest, { root });
  assert.deepEqual(bundle.resources.map(resource => resource.fileName), ['comm_sp_0004.png']);
});

test('预览样例的历史资源不参与当前输出的图片类型和名字冲突', () => {
  const list = group(2, '列表', [group(3, '模板', [image(4)]), group(5, '样例', [image(6)], 0, 40)]);
  const root = group(1, '根', [list, image(7)]);
  let manifest = command(initialize(root), 'apply-node-preset', {
    layerId: 6, name: 'comm_sp_0006', semantic: 'raw-image'
  });
  manifest = prepareManifestForExport(manifest, { root }).manifest;
  const previewResourceId = manifest.nodes['6'].rawImage.resourceId;
  manifest = configure(manifest, list, 'list', { templateLayerId: 3, previewLayerIds: [5] });
  root.children[1].name = 'comm_sp_0006';
  const prepared = prepareManifestForExport(manifest, { root });
  const bundle = buildBundle(prepared.manifest, { root });
  assert.deepEqual(bundle.resources.map(resource => resource.fileName).sort(), ['comm_sp_0004.png', 'comm_sp_0006.png']);
  const emitted = bundle.resources.find(resource => resource.fileName === 'comm_sp_0006.png');
  assert.equal(emitted.kind, 'sprite');
  assert.deepEqual(emitted.sourceLayerIds, ['7']);
  assert.equal(prepared.manifest.resourceRegistry.resources[previewResourceId].kind, 'texture');
  assert.equal(prepared.manifest.resourceRegistry.layerBindings['6'], previewResourceId);
});
