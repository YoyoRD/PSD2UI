'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeAuthoringCommand,
  prepareManifestForExport,
  planStructuredGroup,
  planStructure,
  evaluateSemanticAvailability,
  requireSemanticAction,
  collapseNineSlicePixels,
  captureBaseline,
  diffLayerFromBaseline,
  diffSnapshotFromBaseline,
  buildBundle
} = require('../../Core');

function ids() {
  let value = 0;
  return (prefix) => `${prefix}-v1-${++value}`;
}

function initialize(snapshot) {
  const input = {
    module: 'demo',
    name: 'DemoView',
    width: 1024,
    height: 768,
    rootLayerId: 1,
    rootLayerName: 'DemoView'
  };
  if (snapshot) input.snapshot = snapshot;
  return executeAuthoringCommand(null, {
    command: 'initialize-document',
    input
  }, { actor: 'human-panel' }, { idFactory: ids() }).manifest;
}

test('初始化把现有全树写成默认类型，并按任一边超过 512 判定 RawImage', () => {
  const snapshot = {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 1024, bottom: 768 },
      children: [
        {
          layerId: 2,
          name: 'TitleLabel',
          kind: 'text',
          text: { value: '标题', fontSize: 32 },
          bounds: { left: 20, top: 20, right: 220, bottom: 80 },
          children: []
        },
        {
          layerId: 3,
          name: 'WideBackground',
          kind: 'pixel',
          bounds: { left: 0, top: 100, right: 513, bottom: 300 },
          children: []
        },
        {
          layerId: 4,
          name: 'DefaultIcon',
          kind: 'pixel',
          bounds: { left: 20, top: 320, right: 120, bottom: 420 },
          children: []
        },
        {
          layerId: 5,
          name: 'DefaultContainer',
          kind: 'group',
          bounds: { left: 0, top: 0, right: 900, bottom: 700 },
          children: []
        }
      ]
    }
  };

  const manifest = initialize(snapshot);
  assert.equal(manifest.nodes['1'].semantic, 'view');
  assert.equal(manifest.nodes['2'].semantic, 'text');
  assert.equal(manifest.nodes['3'].semantic, 'raw-image');
  assert.equal(manifest.nodes['4'].semantic, 'image');
  assert.equal(manifest.nodes['5'].semantic, 'group');
  assert.equal(manifest.nodes['3'].authoringSource, 'default');
  assert.equal(Object.keys(manifest.resourceRegistry.resources).length, 0,
    '初始化只物化默认类型，资源在发布准备时稳定分配');

  const prepared = prepareManifestForExport(manifest, snapshot, { idFactory: ids() });
  assert.equal(Object.keys(prepared.manifest.resourceRegistry.resources).length, 2);
  assert.equal(prepared.defaultSemanticCount, 4);
  assert.equal(prepared.diagnostics[0].code, 'PSD2UI_DEFAULT_SEMANTICS_APPLIED');
});

test('组件类型按当前选择限制直接写入与结构化动作', () => {
  const image = { layerId: 10, kind: 'pixel', parentId: 1 };
  const singleImage = evaluateSemanticAvailability([image]);
  const single = (semantic) => singleImage.find((entry) => entry.semantic === semantic);
  assert.equal(single('image').canApply, true);
  assert.equal(single('raw-image').canApply, true);
  assert.equal(single('button').canApply, true);
  assert.equal(single('button').canStructure, false);
  assert.equal(single('input-field').enabled, false);
  assert.equal(single('toggle').enabled, false);

  const inputGroup = {
    layerId: 20,
    name: 'LoginInput',
    kind: 'group',
    parentId: 1,
    bounds: { left: 10, top: 20, right: 310, bottom: 80 },
    children: [
      { layerId: 10, kind: 'pixel', parentId: 20 },
      { layerId: 11, kind: 'text', parentId: 20 }
    ]
  };
  const inputAvailability = evaluateSemanticAvailability([inputGroup]);
  const input = inputAvailability.find((entry) => entry.semantic === 'input-field');
  assert.equal(input.canApply, false);
  assert.equal(input.canStructure, true);
  assert.equal(input.enabled, true);
  assert.throws(
    () => requireSemanticAction([inputGroup], 'input-field', 'apply'),
    (error) => error.code === 'PSD2UI_DIRECT_SELECTION_INVALID'
      && /必须通过“结构化所选图层”创建/.test(error.message));

  const invalidInput = evaluateSemanticAvailability([{
    ...inputGroup,
    children: [
      { layerId: 10, kind: 'pixel', parentId: 20 },
      { layerId: 12, kind: 'pixel', parentId: 20 },
      { layerId: 13, kind: 'text', parentId: 20 },
      { layerId: 14, kind: 'text', parentId: 20 },
      { layerId: 15, kind: 'text', parentId: 20 }
    ]
  }]).find((entry) => entry.semantic === 'input-field');
  assert.equal(invalidInput.enabled, true);
  assert.equal(invalidInput.canStructure, false);
  assert.equal(invalidInput.canConfigure, true);
  assert.match(invalidInput.reason, /背景.*多个候选/);
  assert.equal(invalidInput.configuration.roles[0].candidates.length, 2);

  const ungrouped = evaluateSemanticAvailability(inputGroup.children)
    .find((entry) => entry.semantic === 'input-field');
  assert.equal(ungrouped.canStructure, true);
  assert.equal(ungrouped.requiresGroup, true);
  assert.match(ungrouped.reason, /同级图层组合/);

  const structuredRoot = evaluateSemanticAvailability([{
    ...inputGroup,
    semantic: 'input-field',
    structure: {
      version: 1,
      roles: [
        { name: 'background', layerId: '10' },
        { name: 'text', layerId: '11' }
      ]
    }
  }]).find((entry) => entry.semantic === 'input-field');
  assert.equal(structuredRoot.currentStructuredRoot, true);
  assert.equal(structuredRoot.enabled, true);
  assert.equal(structuredRoot.canApply, false);
  assert.equal(structuredRoot.canStructure, true);
  assert.match(structuredRoot.reason, /当前组可配置/);

  const brokenStructuredRoot = evaluateSemanticAvailability([{
    ...inputGroup,
    semantic: 'input-field',
    children: [{ layerId: 10, kind: 'pixel', parentId: 20 }],
    structure: { version: 1, roles: [{ name: 'background', layerId: '10' }] }
  }]).find((entry) => entry.semantic === 'input-field');
  assert.equal(brokenStructuredRoot.currentStructuredRoot, true);
  assert.equal(brokenStructuredRoot.canStructure, false);
  assert.equal(brokenStructuredRoot.enabled, true);
  assert.match(brokenStructuredRoot.reason, /缺少.*输入文字/);
});

test('默认投影自动识别文本、大图和普通图片，并自动分配稳定资源', () => {
  const manifest = initialize();
  const snapshot = {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 1024, bottom: 768 },
      children: [
        {
          layerId: 2,
          name: 'TitleLabel',
          kind: 'text',
          text: { value: '开始游戏', fontSize: 36, alignment: 'middle-center', lineSpacing: 1 },
          bounds: { left: 20, top: 20, right: 300, bottom: 80 },
          children: []
        },
        {
          layerId: 3,
          name: 'LargeBackground',
          kind: 'pixel',
          bounds: { left: 0, top: 0, right: 1024, bottom: 768 },
          children: []
        },
        {
          layerId: 4,
          name: 'FeatureIcon',
          kind: 'pixel',
          bounds: { left: 10, top: 100, right: 110, bottom: 200 },
          children: []
        }
      ]
    }
  };

  const prepared = prepareManifestForExport(manifest, snapshot, { idFactory: ids() });
  assert.equal(prepared.manifest.nodes['2'].semantic, 'text');
  assert.equal(prepared.manifest.nodes['2'].text.value, '开始游戏');
  assert.equal(prepared.manifest.nodes['3'].semantic, 'raw-image');
  assert.equal(prepared.manifest.nodes['4'].semantic, 'image');
  assert.equal(Object.keys(prepared.manifest.resourceRegistry.resources).length, 2);
});

test('结构化按钮记录组根角色，额外图层不占用功能角色', () => {
  const plan = planStructure('button', [
    { layerId: 10, name: 'TitleLabel', kind: 'text', parentId: 5 },
    { layerId: 11, name: 'ButtonBackground', kind: 'pixel', parentId: 5 }
  ]);
  assert.equal(plan.groupName, '按钮');
  assert.deepEqual(plan.structure.roles, [
    { name: 'background', layerId: '11', nodeId: null },
    { name: 'label', layerId: '10', nodeId: null }
  ]);
  assert.deepEqual(plan.structure.previewLayerIds, []);
});

test('现有 Photoshop 组作为唯一结构根并保留美术组名', () => {
  const group = {
    layerId: 5,
    name: 'StartGame',
    kind: 'group',
    parentId: 1,
    bounds: { left: 100, top: 200, right: 420, bottom: 280 },
    children: [
      { layerId: 10, name: 'TitleLabel', kind: 'text', parentId: 5 },
      { layerId: 11, name: 'ButtonBackground', kind: 'pixel', parentId: 5 }
    ]
  };
  const plan = planStructuredGroup('button', group);
  assert.equal(plan.rootLayerId, '5');
  assert.equal(plan.groupName, 'StartGame');
  assert.deepEqual(plan.structure.roles, [
    { name: 'background', layerId: '11', nodeId: null },
    { name: 'label', layerId: '10', nodeId: null }
  ]);

  assert.throws(
    () => planStructuredGroup('button', { ...group, kind: 'pixel' }),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROOT_GROUP_REQUIRED');
  assert.throws(
    () => planStructuredGroup('button', { ...group, children: [] }),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROOT_EMPTY');
  assert.throws(
    () => planStructuredGroup('button', {
      ...group,
      bounds: { left: 100, top: 200, right: 100, bottom: 280 }
    }),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROOT_BOUNDS_INVALID');
  assert.throws(
    () => planStructuredGroup('button', {
      ...group,
      children: group.children.map((child) => ({ ...child, parentId: 99 }))
    }),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROOT_CHILD_INVALID');
});

test('多个候选时给出明确角色与可选择图层而不按顺序猜测', () => {
  assert.throws(
    () => planStructure('input-field', [
      { layerId: 10, kind: 'pixel', parentId: 5 },
      { layerId: 11, kind: 'pixel', parentId: 5 },
      { layerId: 12, kind: 'text', parentId: 5 }
    ]),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROLE_AMBIGUOUS'
      && error.details.roleName === 'background'
      && error.details.candidates.length === 2);
});

test('List 多余样例只记录为 Photoshop 预览层', () => {
  const plan = planStructure('list', [
    { layerId: 20, kind: 'group', parentId: 5, bounds: { left: 0, top: 0, right: 100, bottom: 30 } },
    { layerId: 21, kind: 'group', parentId: 5, bounds: { left: 0, top: 40, right: 100, bottom: 70 } },
    { layerId: 22, kind: 'group', parentId: 5, bounds: { left: 0, top: 80, right: 100, bottom: 110 } }
  ], { templateLayerId: 20, previewLayerIds: [21, 22] });
  assert.equal(plan.structure.roles[0].name, 'item-template');
  assert.deepEqual(plan.structure.previewLayerIds, ['21', '22']);
  assert.deepEqual(plan.structure.layout, {
    direction: 'vertical', itemWidth: 100, itemHeight: 30, spacing: 10
  });
});

test('List 结构化会区分尺寸和间距错误', () => {
  assert.throws(
    () => planStructure('list', [
      { layerId: 20, kind: 'group', parentId: 5, bounds: { left: 0, top: 0, right: 100, bottom: 30 } },
      { layerId: 21, kind: 'group', parentId: 5, bounds: { left: 0, top: 40, right: 90, bottom: 70 } }
    ], { templateLayerId: 20, previewLayerIds: [21] }),
    (error) => error.code === 'PSD2UI_STRUCTURE_SIZE_MISMATCH');
  assert.throws(
    () => planStructure('list', [
      { layerId: 20, kind: 'group', parentId: 5, bounds: { left: 0, top: 0, right: 100, bottom: 30 } },
      { layerId: 21, kind: 'group', parentId: 5, bounds: { left: 0, top: 40, right: 100, bottom: 70 } },
      { layerId: 22, kind: 'group', parentId: 5, bounds: { left: 0, top: 85, right: 100, bottom: 115 } }
    ], { templateLayerId: 20, previewLayerIds: [21, 22] }),
    (error) => error.code === 'PSD2UI_STRUCTURE_SPACING_MISMATCH');
});

test('Grid 结构化记录规则布局并拒绝不规则行列', () => {
  const cell = (layerId, left, top) => ({
    layerId,
    kind: 'group',
    parentId: 5,
    bounds: { left, top, right: left + 20, bottom: top + 10 }
  });
  const plan = planStructure('grid', [
    cell(30, 0, 0), cell(31, 25, 0), cell(32, 0, 15), cell(33, 25, 15)
  ], { templateLayerId: 30, previewLayerIds: [31, 32, 33] });
  assert.deepEqual(plan.structure.layout, {
    cellWidth: 20,
    cellHeight: 10,
    columns: 2,
    rows: 2,
    horizontalSpacing: 5,
    verticalSpacing: 5
  });
  assert.throws(
    () => planStructure('grid', [
      cell(40, 0, 0), cell(41, 25, 0), cell(42, 25, 15)
    ], { templateLayerId: 40, previewLayerIds: [41, 42] }),
    (error) => error.code === 'PSD2UI_STRUCTURE_GRID_IRREGULAR');
});

test('页面组只接受已经结构化的 Toggle 或 List 组件组', () => {
  const togglePage = planStructure('toggle-page-group', [
    { layerId: 50, kind: 'group', semantic: 'toggle', parentId: 5 }
  ]);
  assert.equal(togglePage.structure.roles[0].name, 'toggle-0');
  const listPage = planStructure('list-page-group', [
    { layerId: 51, kind: 'group', semantic: 'list', parentId: 5 }
  ]);
  assert.equal(listPage.structure.roles[0].name, 'list');
  assert.throws(
    () => planStructure('toggle-page-group', [
      { layerId: 52, kind: 'group', semantic: 'group', parentId: 5 }
    ]),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROLE_REQUIRED'
      && error.details.roleName === 'toggle-0');
  assert.throws(
    () => planStructure('list-page-group', [
      { layerId: 53, kind: 'group', semantic: 'group', parentId: 5 }
    ]),
    (error) => error.code === 'PSD2UI_STRUCTURE_ROLE_REQUIRED'
      && error.details.roleName === 'list');
});

test('4,4,4,4 九宫把拉伸大图收缩为 9x9，并保留四角像素', () => {
  const width = 12;
  const height = 12;
  const source = new Uint8Array(width * height);
  for (let index = 0; index < source.length; index += 1) source[index] = index;
  const result = collapseNineSlicePixels(source, width, height, 1, {
    left: 4,
    top: 4,
    right: 4,
    bottom: 4
  });
  assert.equal(result.width, 9);
  assert.equal(result.height, 9);
  assert.equal(result.pixels[0], source[0]);
  assert.equal(result.pixels[8], source[11]);
  assert.equal(result.pixels[8 * 9], source[11 * 12]);
  assert.equal(result.pixels[8 * 9 + 8], source[11 * 12 + 11]);
});

test('保存基线后能够说明选中图层的具体变化', () => {
  const manifest = captureBaseline(initialize(), {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      visible: true,
      opacity: 1,
      bounds: { left: 0, top: 0, right: 100, bottom: 100 },
      children: []
    }
  });
  const changes = diffLayerFromBaseline(manifest, {
    layerId: 1,
    name: 'DemoViewRenamed',
    kind: 'group',
    visible: false,
    opacity: 0.5,
    bounds: { left: 0, top: 0, right: 120, bottom: 100 },
    children: []
  });
  assert.ok(changes.some((value) => value.startsWith('名称：')));
  assert.ok(changes.includes('位置或尺寸已改变'));
  assert.ok(changes.some((value) => value.startsWith('可见性：')));
  assert.ok(changes.some((value) => value.startsWith('不透明度：')));
  const documentChanges = diffSnapshotFromBaseline(manifest, {
    root: {
      layerId: 1,
      name: 'DemoViewRenamed',
      kind: 'group',
      visible: false,
      opacity: 0.5,
      bounds: { left: 0, top: 0, right: 120, bottom: 100 },
      children: []
    }
  });
  assert.equal(documentChanges.length, 1);
  assert.equal(documentChanges[0].name, 'DemoViewRenamed');
});

test('单图片直接标记为按钮时仍保留自动 CImage 视觉资源', () => {
  let manifest = initialize();
  manifest = executeAuthoringCommand(manifest, {
    command: 'apply-node-preset',
    input: { layerId: 2, name: 'btnConfirm', semantic: 'button' }
  }, { actor: 'human-panel' }, { idFactory: ids() }).manifest;
  const snapshot = {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 1024, bottom: 768 },
      children: [{
        layerId: 2,
        name: 'btnConfirm',
        kind: 'pixel',
        bounds: { left: 10, top: 20, right: 210, bottom: 80 },
        children: []
      }]
    }
  };

  const prepared = prepareManifestForExport(manifest, snapshot, { idFactory: ids() });
  assert.equal(prepared.manifest.nodes['2'].semantic, 'button');
  assert.ok(prepared.manifest.nodes['2'].image.resourceId);
  assert.equal(
    prepared.diagnostics.filter((entry) => entry.code === 'PSD2UI_STRUCTURE_INCOMPLETE').length,
    0);
  const bundle = buildBundle(prepared.manifest, snapshot);
  assert.equal(bundle.root.children[0].semantic, 'button');
  assert.ok(bundle.root.children[0].image.resourceId);
  assert.equal(bundle.resources.length, 1);
});

test('用户确认的精确结构计划只提升组件结构化权限', () => {
  const snapshot = {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 1024, bottom: 768 },
      children: [{
        layerId: 2,
        name: 'btnStartGame',
        kind: 'group',
        bounds: { left: 100, top: 100, right: 400, bottom: 200 },
        children: [{
          layerId: 3,
          name: 'ButtonBackground',
          kind: 'pixel',
          bounds: { left: 100, top: 100, right: 400, bottom: 200 },
          children: []
        }]
      }]
    }
  };
  const manifest = initialize(snapshot);
  const context = { actor: 'human-approved-plan', confirmationId: 'main-structure-v1' };
  const structured = executeAuthoringCommand(manifest, {
    command: 'apply-structured-group',
    input: {
      layerId: 2,
      name: 'btnStartGame',
      semantic: 'button',
      structure: {
        version: 1,
        roles: [{ name: 'background', layerId: 3 }],
        previewLayerIds: []
      }
    }
  }, context, { idFactory: ids() });
  assert.equal(structured.manifest.nodes['2'].semantic, 'button');
  assert.throws(
    () => executeAuthoringCommand(structured.manifest, {
      command: 'set-document-module',
      input: { module: 'other' }
    }, context),
    (error) => error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');
  assert.throws(
    () => executeAuthoringCommand(manifest, {
      command: 'apply-structured-group',
      input: {
        layerId: 2,
        name: 'btnStartGame',
        semantic: 'button',
        structure: { version: 1, roles: [], previewLayerIds: [] }
      }
    }, { actor: 'human-approved-plan' }),
    (error) => error.code === 'PSD2UI_HUMAN_CONFIRMATION_REQUIRED');
});

test('Photoshop 文本效果作为默认解析信息进入 Bundle', () => {
  const manifest = initialize();
  const effects = {
    gradient: {
      isVertical: true,
      colorKeys: [
        { time: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { time: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
      ],
      alphaKeys: [{ time: 0, alpha: 1 }, { time: 1, alpha: 0.5 }]
    },
    outline: {
      color: { r: 0, g: 0, b: 0, a: 1 },
      distanceX: 2,
      distanceY: 2
    },
    shadow: null
  };
  const snapshot = {
    root: {
      layerId: 1,
      name: 'DemoView',
      kind: 'group',
      bounds: { left: 0, top: 0, right: 1024, bottom: 768 },
      children: [{
        layerId: 2,
        name: 'TitleLabel',
        kind: 'text',
        text: {
          value: '标题',
          fontSize: 32,
          alignment: 'middle-center',
          lineSpacing: 1,
          effects
        },
        bounds: { left: 10, top: 20, right: 210, bottom: 80 },
        children: []
      }]
    }
  };
  const bundle = buildBundle(manifest, snapshot);
  assert.deepEqual(bundle.root.children[0].text.effects, effects);
  assert.equal(bundle.root.children[0].text.fontKey, 'default');
});
