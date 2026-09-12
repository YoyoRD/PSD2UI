'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PluginRoot = path.resolve(__dirname, '../../Plus-ins/PSD2UI');

function read(name) {
  return fs.readFileSync(path.join(PluginRoot, name), 'utf8');
}

function pngSize(name) {
  const buffer = fs.readFileSync(path.join(PluginRoot, name));
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${name} 不是 PNG 文件`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `找不到样式规则 ${selector}`);
  return match[1];
}

test('面板样式只使用 Photoshop UXP 可稳定渲染的布局能力', () => {
  const css = read('style.css');
  assert.doesNotMatch(css, /\bdisplay\s*:\s*grid\b/i, 'UXP 不支持 CSS Grid');
  assert.doesNotMatch(css, /\bgrid-template-/i, 'UXP 不支持 CSS Grid');
  assert.doesNotMatch(css, /(^|[;{]\s*)gap\s*:/im, 'UXP 宿主不能依赖 flex gap');
  assert.doesNotMatch(css, /(^|[;{]\s*)font\s*:/im, 'UXP 不支持 font 简写');
  assert.doesNotMatch(css, /\btransition\s*:/i, 'UXP 不支持 CSS transition');
  assert.doesNotMatch(css, /\bobject-fit\s*:/i, 'UXP 中 object-fit 与边框组合渲染不稳定');
  assert.match(ruleBody(css, '.feature-tabs'), /display\s*:\s*flex/i);
  assert.match(ruleBody(css, '.app-shell'), /overflow-y\s*:\s*auto/i);
  assert.match(ruleBody(css, '.scroll-region'), /overflow\s*:\s*visible/i);
});

test('功能路由不依赖 UXP 历史兼容性不稳定的 data 属性', () => {
  const html = read('index.html');
  const scripts = `${read('uiShell.js')}\n${read('app.js')}`;
  assert.doesNotMatch(html, /\bdata-[a-z-]+=/i);
  assert.doesNotMatch(scripts, /\.dataset\b/);
  assert.doesNotMatch(html, /<label\b[^>]*\bfor=/i, 'UXP 不支持 label for 关联');

  const buttons = [...html.matchAll(/<button\b([^>]*)>/gi)];
  assert.equal(new Set(buttons.map((match) => match[1].match(/\bid="([^"]+)"/i)[1])).size,
    buttons.length, '实际操作入口必须使用唯一 ID');
  buttons.forEach((match) => {
    const idMatch = match[1].match(/\bid="([^"]+)"/i);
    assert.ok(idMatch, `按钮缺少稳定 ID: ${match[0]}`);
    assert.ok(scripts.includes(`'${idMatch[1]}'`) || scripts.includes(`"${idMatch[1]}"`),
      `按钮 ${idMatch[1]} 没有绑定到面板脚本`);
  });
});

test('三步美术流程和设置都存在，品牌只保留文字', () => {
  const html = read('index.html');
  ['prepare', 'layer', 'export', 'settings'].forEach((name) => {
    assert.match(html, new RegExp(`id="tab-${name}"`));
    assert.match(html, new RegExp(`id="panel-${name}"`));
  });
  assert.match(html, /aria-label="psd2ui by yoyord"/);
  assert.doesNotMatch(html, /<img|<footer/);
  assert.doesNotMatch(html, /yoyord-mark\.png|tab-document|tab-resource/);

  const options = [...html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, '').trim());
  assert.equal(options.length, 27);
  options.forEach((label) => assert.match(label, /\//, `下拉项不是中英双语: ${label}`));
});

test('发布 Manifest 提供单一 Photoshop Host 和完整插件图标', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(Array.isArray(manifest.host), false, '发布包的 host 必须是单一对象');
  assert.equal(manifest.host.app, 'PS');

  const pluginIcon = manifest.icons[0];
  assert.deepEqual(pluginIcon.scale, [1, 2]);
  assert.deepEqual(pngSize(pluginIcon.path), { width: 24, height: 24 });
  assert.deepEqual(pngSize(pluginIcon.path.replace(/\.png$/, '@2x.png')), { width: 48, height: 48 });

  const panelIcon = manifest.entrypoints[0].icons[0];
  assert.deepEqual(panelIcon.scale, [1, 2]);
  assert.deepEqual(pngSize(panelIcon.path), { width: 23, height: 23 });
  assert.deepEqual(pngSize(panelIcon.path.replace(/\.png$/, '@2x.png')), { width: 46, height: 46 });
});

test('图层语义界面只展示抽象组件、必要参数和结构化入口', () => {
  const html = read('index.html');
  const shell = read('uiShell.js');
  assert.match(html, /<select id="semantic">/);
  [
    'image', 'raw-image', 'text', 'button', 'input-field', 'toggle',
    'list', 'grid', 'red-point', 'toggle-page-group', 'list-page-group', 'ignore'
  ].forEach((semantic) => {
    assert.match(html, new RegExp(`<option\\b[^>]*value="${semantic}"[^>]*>`));
  });
  assert.doesNotMatch(html, /quick-semantic-|value="group"/);
  ['node-opacity', 'font-size', 'text-value', 'text-alignment', 'image-raycast'].forEach((id) => {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `${id} 应从美术语义参数中移除`);
  });
  ['slice-left', 'slice-top', 'slice-right', 'slice-bottom', 'font-key'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(html, /id="semantic-summary-title"/);
  assert.match(html, /id="semantic-summary-text"/);
  assert.match(html, /id="layer-config-status"/);
  assert.match(html, /id="effective-semantic"/);
  assert.match(html, /id="layer-change-summary"/);
  assert.match(html, /id="selection-constraint"/);
  assert.doesNotMatch(html, /id="node-name"/,
    '结构化直接采用美术已有组名，不再提供新组名输入');
  assert.match(html, /id="structure-root-summary"/);
  assert.match(html, /id="structure-candidates"/);
  assert.match(html, /使用已有组时不移动图层、不修改组名/);
  ['component-role-fields', 'component-preview-fields', 'component-layout-fields', 'combine-component', 'check-image-names',
    'component-viewport-fields', 'visual-states-editor'].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(html, /id="sidecar-path"/);
  assert.match(html, /id="document-change-status"/);
  assert.match(html, /class="commit-card"/);
  assert.match(html, /id="commit-semantic"/);
  assert.match(html, /保存当前图层/);
  assert.match(html, /id="structure-component"/);
  assert.match(html, /id="sync-layer-tree"/);
  assert.match(html, /id="batch-rename-base"/);
  assert.match(html, /id="batch-rename-start"/);
  assert.match(html, /id="batch-rename-selection"/);
  assert.match(html, /写入类型不会修改图层名称/);
  assert.match(shell, /NoParametersPanel/);
});

test('页签与语义切换不依赖 classList.toggle 的 force 参数', () => {
  const shellSource = read('uiShell.js');
  assert.doesNotMatch(shellSource, /classList\.toggle\s*\(/,
    'Photoshop UXP 宿主切换状态统一使用明确的 add/remove');

  class FakeClassList {
    constructor(initial) {
      this.values = new Set(initial || []);
    }

    add(name) {
      this.values.add(name);
    }

    remove(name) {
      this.values.delete(name);
    }

    contains(name) {
      return this.values.has(name);
    }

    toggle() {
      throw new Error('此模拟 UXP DOM 不支持 classList.toggle。');
    }
  }

  class FakeElement {
    constructor(initialClasses) {
      this.classList = new FakeClassList(initialClasses);
      this.attributes = {};
      this.listeners = {};
      this.checked = false;
      this.scrollTop = 20;
      this.textContent = '';
      this.value = '';
    }

    addEventListener(name, listener) {
      this.listeners[name] = listener;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    getAttribute(name) {
      return this.attributes[name] || null;
    }

    dispatch(name) {
      assert.ok(this.listeners[name], `缺少 ${name} 事件绑定`);
      this.listeners[name]();
    }
  }

  const elements = {};
  const ensure = (id, classes) => {
    elements[id] = new FakeElement(classes);
    return elements[id];
  };
  ['prepare', 'layer', 'export', 'settings'].forEach((name, index) => {
    ensure(`tab-${name}`, index === 0 ? ['is-active'] : []);
    ensure(`panel-${name}`, index === 0 ? ['is-active'] : []);
  });
  ensure('app-shell');
  ensure('status-toggle').setAttribute('aria-expanded', 'false');
  ensure('status-content', ['is-hidden']);
  ensure('status-chevron');
  ensure('advanced-resource-toggle');
  ensure('advanced-resource-panel', ['is-hidden']);
  ensure('semantic').value = 'image';
  const semanticNames = [
    'image', 'raw-image', 'text', 'button', 'input-field', 'toggle',
    'list', 'grid', 'red-point', 'toggle-page-group', 'list-page-group', 'ignore'
  ];
  semanticNames.forEach((name) => ensure(`semantic-option-${name}`));
  ensure('semantic-summary-title');
  ensure('semantic-summary-text');
  ensure('commit-semantic');
  ensure('selection-constraint');
  ensure('structure-candidates');
  ensure('apply-preset');
  ensure('structure-component');
  ensure('options-image');
  ensure('options-text', ['is-hidden']);
  ensure('options-ignore', ['is-hidden']);
  ensure('options-no-parameters', ['is-hidden']);

  const sandbox = {
    console: { error() {} },
    document: { getElementById: (id) => elements[id] || null },
    window: {}
  };
  vm.runInNewContext(shellSource, sandbox, { filename: 'uiShell.js' });

  ['prepare', 'layer', 'export', 'settings'].forEach((name) => {
    elements[`tab-${name}`].dispatch('click');
    const activeTabs = ['prepare', 'layer', 'export', 'settings']
      .filter((candidate) => elements[`tab-${candidate}`].classList.contains('is-active'));
    const activePanels = ['prepare', 'layer', 'export', 'settings']
      .filter((candidate) => elements[`panel-${candidate}`].classList.contains('is-active'));
    assert.deepEqual(activeTabs, [name]);
    assert.deepEqual(activePanels, [name]);
    assert.equal(elements[`tab-${name}`].getAttribute('aria-selected'), 'true');
    assert.equal(elements['app-shell'].scrollTop, 0);
  });

  const expectedPanels = {
    image: 'options-image',
    text: 'options-text',
    button: 'options-no-parameters',
    list: 'options-no-parameters',
    ignore: 'options-ignore'
  };
  Object.entries(expectedPanels).forEach(([semantic, expectedPanel]) => {
    elements.semantic.value = semantic;
    elements.semantic.dispatch('change');
    const visible = ['options-image', 'options-text', 'options-no-parameters', 'options-ignore']
      .filter((id) => !elements[id].classList.contains('is-hidden'));
    assert.deepEqual(visible, [expectedPanel]);
  });

  const availability = semanticNames.map((semantic) => ({
    semantic,
    enabled: semantic === 'input-field',
    canApply: false,
    canStructure: semantic === 'input-field',
    reason: semantic === 'input-field'
      ? '当前选择可结构化为输入框。'
      : '当前选择不符合要求。'
  }));
  sandbox.window.Psd2UiPanelShell.setSemanticAvailability(
    availability,
    'input-field');
  assert.equal(elements.semantic.value, 'input-field');
  assert.equal(elements['semantic-option-image'].disabled, true);
  assert.equal(elements['semantic-option-input-field'].disabled, false);
  assert.equal(elements['apply-preset'].disabled, true);
  assert.equal(elements['structure-component'].disabled, false);
  assert.equal(elements['selection-constraint'].textContent, '当前选择可结构化为输入框。');
  assert.equal(elements['structure-candidates'].textContent,
    '可配置：输入框。');

  elements.semantic.value = 'image';
  sandbox.window.Psd2UiPanelShell.setSemanticAvailability(
    availability,
    'image');
  assert.equal(elements.semantic.value, 'input-field',
    'preferred 类型被禁用时应自动切到真正可执行的结构候选');

  const unavailable = semanticNames.map((semantic) => ({
    semantic,
    enabled: false,
    canApply: false,
    canStructure: false,
    currentStructuredRoot: false,
    reason: '当前选择不符合要求。'
  }));
  sandbox.window.Psd2UiPanelShell.setSemanticAvailability(
    unavailable,
    'input-field',
    '请先初始化当前 PSD。');
  assert.equal(elements['apply-preset'].disabled, true);
  assert.equal(elements['structure-component'].disabled, true);
  assert.equal(elements['selection-constraint'].textContent, '请先初始化当前 PSD。');
  assert.equal(elements['structure-candidates'].textContent, '请先初始化当前 PSD。');
});

test('面板启动主动读取 XMP、同目录镜像与图层变化状态', () => {
  const app = read('app.js');
  const photoshopDocument = read('src/photoshopDocument.js');
  const bootstrapMatch = app.match(/function bootstrap\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(bootstrapMatch, '找不到 bootstrap');
  assert.match(bootstrapMatch[1], /refreshAuthoringState/);
  assert.match(app, /diffSnapshotFromBaseline/);
  assert.match(app, /readSidecarManifest/);
  assert.match(app, /diffLayerFromBaseline/);
  assert.match(app, /element\('load-manifest'\)\.addEventListener\('click'/,
    '必须保留人工读取 PSD Manifest 的入口');
  assert.match(app, /enableSelectionRefresh/);
  assert.match(app, /scheduleSelectionRefresh/);
  assert.match(photoshopDocument, /notificationEvents = \['select', 'open', 'close'\]/,
    '必须监听 Photoshop 选择与文档打开、关闭来自动刷新当前状态');
  assert.match(photoshopDocument, /action\.addNotificationListener\(notificationEvents/);
  assert.doesNotMatch(app, /setInterval\(/,
    '图层选择刷新应由 Photoshop 事件驱动，不使用常驻轮询');
  assert.match(app, /const snapshot = createSnapshot\(root\.id\)/);
  assert.match(app, /rootLayerName: root\.name,\s*snapshot/,
    '初始化命令必须携带当前根组的完整图层快照');
  assert.match(app, /const nodeName = String\(layer\.name \|\| ''\)\.trim\(\)/,
    '写入人工语义必须直接使用美术维护的 Photoshop 图层基础名');
  assert.doesNotMatch(app, /renameLayerAndPersist/,
    '写入人工语义不得隐式重命名 Photoshop 图层');
  assert.match(app, /command: 'sync-layer-tree'/,
    'Manifest 持久化前必须按当前完整图层树清理失效配置');
  const structureFlow = app.match(
    /async function structureSelectedComponent\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(structureFlow, '找不到面板结构化流程');
  assert.match(
    structureFlow[1],
    /command: 'sync-layer-tree'[\s\S]*planStructuredGroup[\s\S]*command: 'apply-structured-group'/,
    '新图层必须先同步进 Manifest，再以现有组根规划并写入组件结构');
  assert.doesNotMatch(
    structureFlow[1],
    /structureActiveLayers|createLayerGroup|resolveStructureGroupName|node-name/,
    '人工面板结构化不得移动图层、自动包组或读取新组名');
  assert.match(photoshopDocument, /const snapshot = readLayer\(layer\);[\s\S]*\.\.\.snapshot/,
    '选中组必须携带完整直属子层快照供结构识别');
  assert.match(app, /renameActiveLayers\(renames/,
    '图层改名只能从显式批量改名入口执行');
  assert.match(photoshopDocument, /async function renameActiveLayers\(/);
  assert.doesNotMatch(photoshopDocument, /async function renameLayerAndPersist\(/,
    '不再保留可被误用的单图层重命名入口');
  assert.match(app, /runDocumentMutationWithManifestRollback\(current/,
    '图层树与 Manifest 联动变更必须有 XMP 与 sidecar 补偿回滚');
  assert.match(app, /restoreManifestPersistence\(document, backup\)/);
  assert.match(app, /photoshopCore\.executeAsModal\(async \(\) => \{/,
    'XMP 与 PSD 保存的补偿回滚必须在 Photoshop modal 中执行');
});

test('Photoshop select/open/close 通知使用同一监听器刷新并注销', async () => {
  let registeredEvents = null;
  let registeredListener = null;
  let removedEvents = null;
  let removedListener = null;
  const photoshop = {
    app: {},
    core: {},
    action: {
      addNotificationListener: async (events, listener) => {
        registeredEvents = events;
        registeredListener = listener;
      },
      removeNotificationListener: async (events, listener) => {
        removedEvents = events;
        removedListener = listener;
      }
    }
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: { error() {} },
    require(name) {
      if (name === 'photoshop') return photoshop;
      if (name === './textEffects') return { normalizeLayerTextEffects: () => null };
      throw new Error(`意外依赖：${name}`);
    }
  };
  vm.runInNewContext(read('src/photoshopDocument.js'), sandbox, {
    filename: 'photoshopDocument.js'
  });

  let refreshCount = 0;
  const unsubscribe = await sandbox.module.exports.addSelectionChangeListener(() => {
    refreshCount += 1;
  });
  assert.deepEqual(Array.from(registeredEvents), ['select', 'open', 'close']);
  registeredListener('set', {});
  registeredListener('select', {});
  registeredListener('open', {});
  registeredListener('close', {});
  assert.equal(refreshCount, 3);

  await unsubscribe();
  assert.deepEqual(Array.from(removedEvents), ['select', 'open', 'close']);
  assert.equal(removedListener, registeredListener);
});

test('显式批量改名一次提交全部选中图层，并在非法结果时不进入 modal', async () => {
  const bounds = { left: 0, top: 0, right: 10, bottom: 10 };
  const first = { id: 2, name: 'OldA', bounds, layers: [], parent: null };
  const second = { id: 3, name: 'OldB', bounds, layers: [], parent: null };
  const document = {
    id: 1,
    path: 'F:\\Workspace\\Main.psd',
    layers: [first, second],
    activeLayers: [second, first]
  };
  let modalCount = 0;
  const resumed = [];
  const photoshop = {
    app: { activeDocument: document },
    action: {},
    core: {
      executeAsModal: async (callback) => {
        modalCount += 1;
        return callback({
          hostControl: {
            suspendHistory: async () => ({ id: modalCount }),
            resumeHistory: async (_suspension, commit) => resumed.push(commit)
          }
        });
      }
    }
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: { error() {} },
    require(name) {
      if (name === 'photoshop') return photoshop;
      if (name === './textEffects') return { normalizeLayerTextEffects: () => null };
      throw new Error(`意外依赖：${name}`);
    }
  };
  vm.runInNewContext(read('src/photoshopDocument.js'), sandbox, {
    filename: 'photoshopDocument.js'
  });

  await assert.rejects(
    sandbox.module.exports.renameActiveLayers([
      { layerId: '2', previousName: 'OldA', name: 'Avatar01' },
      { layerId: '3', previousName: 'OldB', name: 'Avatar01' }
    ], async () => null),
    /批量改名结果重复/);
  assert.equal(modalCount, 0);

  await assert.rejects(
    sandbox.module.exports.renameActiveLayers([
      { layerId: '2', previousName: 'OldA', name: 'Avatar01' },
      { layerId: '3', previousName: 'OldB', name: 'Avatar02' }
    ]),
    /Manifest 同步回调/);
  assert.equal(modalCount, 0);

  await assert.rejects(
    sandbox.module.exports.renameActiveLayers([
      { layerId: '2', previousName: 'OldA', name: 'Avatar01' },
      { layerId: '2', previousName: 'OldA', name: 'Avatar02' }
    ], async () => null),
    /重复包含图层/);
  assert.equal(modalCount, 0);

  let persistCount = 0;
  const result = await sandbox.module.exports.renameActiveLayers([
    { layerId: '2', previousName: 'OldA', name: 'Avatar01' },
    { layerId: '3', previousName: 'OldB', name: 'Avatar02' }
  ], async (renamed) => {
    persistCount += 1;
    return { count: renamed.length };
  });
  assert.equal(first.name, 'Avatar01');
  assert.equal(second.name, 'Avatar02');
  assert.equal(persistCount, 1);
  assert.deepEqual(Array.from(resumed), [true]);
  assert.equal(result.value.count, 2);

  first.name = 'OldA';
  second.name = 'OldB';
  await assert.rejects(
    sandbox.module.exports.renameActiveLayers([
      { layerId: '2', previousName: 'OldA', name: 'Avatar01' },
      { layerId: '3', previousName: 'OldB', name: 'Avatar02' }
    ], async () => { throw new Error('sidecar save failed'); }),
    /sidecar save failed/);
  assert.deepEqual(Array.from(resumed), [true, false],
    '持久化失败必须要求 Photoshop History 回滚');
});

test('PS-MCP 打开已激活文档不重复写 activeDocument，切换时进入 modal', async () => {
  const current = {
    id: 1,
    title: 'MainView.psd',
    path: 'F:\\Workspace\\YoyoEngine\\美术目录\\MainView.psd',
    width: 720,
    height: 1660
  };
  const other = {
    id: 2,
    title: 'Other.psd',
    path: 'F:\\Workspace\\YoyoEngine\\美术目录\\Other.psd',
    width: 100,
    height: 100
  };
  let activeDocument = current;
  let modalCount = 0;
  const app = { documents: [current, other] };
  Object.defineProperty(app, 'activeDocument', {
    get: () => activeDocument,
    set: (value) => { activeDocument = value; }
  });
  const photoshop = {
    app,
    action: {},
    core: {
      executeAsModal: async (callback) => {
        modalCount += 1;
        return callback({});
      }
    }
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: { error() {} },
    require(name) {
      if (name === 'photoshop') return photoshop;
      if (name === './textEffects') return { normalizeLayerTextEffects: () => null };
      if (name === 'uxp') throw new Error('已打开的本地文档不应再次访问文件系统。');
      throw new Error(`意外依赖：${name}`);
    }
  };
  vm.runInNewContext(read('src/photoshopDocument.js'), sandbox, {
    filename: 'photoshopDocument.js'
  });

  const first = await sandbox.module.exports.openLocalDocument(current.path);
  assert.equal(first.path, current.path);
  assert.equal(modalCount, 0);

  const second = await sandbox.module.exports.openLocalDocument(other.path);
  assert.equal(second.path, other.path);
  assert.equal(activeDocument, other);
  assert.equal(modalCount, 1);
});

test('用户确认的结构计划校验前置条件并在单次 Photoshop 历史事务中执行', () => {
  const app = read('app.js');
  const photoshopDocument = read('src/photoshopDocument.js');
  assert.match(photoshopDocument, /function validateConfirmedStructurePlan\(/);
  assert.match(photoshopDocument, /结构计划缺少现有图层前置条件/);
  assert.match(photoshopDocument, /source\.duplicate\(\)/);
  assert.match(photoshopDocument, /copy\.translate\(offsetX, offsetY\)/);
  assert.match(photoshopDocument, /document\.createLayerGroup\(\{/);
  assert.match(photoshopDocument, /suspendHistory\(\{/);
  assert.match(photoshopDocument, /resumeHistory\(suspension, false\)/);
  assert.match(app, /confirmationText !== 'APPLY_CONFIRMED_STRUCTURE_PLAN'/);
  assert.match(app, /actor: 'human-approved-plan'/);
  assert.match(app, /runDocumentMutationWithManifestRollback\(current[\s\S]*?applyConfirmedStructurePlan\(/,
    '已确认的自动化结构计划也必须补偿 Manifest 持久化失败');
  assert.match(app, /applyConfirmedStructurePlan: applyConfirmedStructurePlanForAutomation/);
});

test('用户确认的 submodule 迁移校验 Manifest 前置条件并补偿 XMP 与 sidecar', () => {
  const app = read('app.js');
  assert.match(app, /function validateConfirmedSubmoduleMigrationPlan\(/);
  assert.match(app, /function assertConfirmedSubmoduleMigrationResult\(/);
  assert.match(app, /confirmationText !== 'APPLY_CONFIRMED_SUBMODULE_MIGRATION'/);
  assert.match(app, /writeManifestInCurrentModal\(result\.manifest, false\)/);
  assert.match(app, /restoreSidecarRaw\(originalSidecar\)/);
  assert.match(app, /setDocumentXmp\(originalXmp\)/);
  assert.match(app, /resumeHistory\(suspension, false\)/);
  assert.match(app, /applyConfirmedSubmoduleMigration: applyConfirmedSubmoduleMigrationForAutomation/);
});

test('用户确认的初始化前命名只重命名现有图层并校验完整根树', () => {
  const app = read('app.js');
  const photoshopDocument = read('src/photoshopDocument.js');
  assert.match(photoshopDocument, /async function applyConfirmedPreinitializeRenames\(/);
  assert.match(photoshopDocument, /collectSnapshotNameIssues\(createSnapshot\(resolvedRootLayerId\)\.root/);
  assert.match(photoshopDocument, /createPostRenameValidationPlan\(plan, false\)/);
  assert.match(photoshopDocument, /visibilityRestoredCount: visibilityRestored\.length/);
  assert.match(photoshopDocument, /await document\.save\(\)/);
  assert.match(photoshopDocument, /resumeHistory\(suspension, false\)/);
  assert.match(app, /confirmationText !== 'APPLY_CONFIRMED_PREINITIALIZE_RENAMES'/);
  assert.match(app, /当前 PSD 已经初始化，不允许再执行初始化前重命名/);
  assert.match(app, /当前 PSD 尚未初始化，不需要执行初始化前状态恢复/);
  assert.match(app, /applyConfirmedPreinitializeRenames: applyConfirmedPreinitializeRenamesForAutomation/);
});

test('图片导出按稳定 ID 获取源图层并为每张资源创建独立工作台', () => {
  const exporter = read('src/exporter.js');
  assert.match(exporter, /function requireOpenDocument\(documentId, label\)/);
  assert.match(exporter, /async function createTemporaryDocument\(width, height, name\)/);
  assert.match(exporter, /await app\.documents\.add\([\s\S]*?const document = app\.activeDocument/);
  assert.match(exporter, /PSD2UI_TEMP_DOCUMENT_CREATE_FAILED/);
  assert.match(exporter, /await openLocalDocument\(sourceDocumentPath\)/);
  assert.match(exporter, /sourceDocument = requireOpenDocument\(sourceDocumentId, '资源源'\)/);
  assert.match(exporter, /layer = findLayerById\(sourceDocument\.layers \|\| \[\], sourceLayerId\)/);
  assert.match(
    exporter,
    /workbenchId = await createTemporaryDocument\([\s\S]*?'PSD2UI_Resource_Workbench'\)/);
  assert.match(exporter, /await closeWithoutSaving\(findOpenDocument\(workbenchId\)\)/);
  assert.match(
    exporter,
    /String\(app\.activeDocument\.id\) !== String\(document\.id\)[\s\S]*?app\.activeDocument = document/);
  assert.doesNotMatch(exporter, /createTemporaryDocuments\(sourceWidth, sourceHeight\)/);
  assert.match(exporter, /app\.activeDocument = requireOpenDocument\(sourceDocumentId, '导出源'\)/);
});

test('UIRes 由面板显式选择并允许跨仓授权目录', () => {
  const { assertUiResFolder } = require('../../Plus-ins/PSD2UI/src/uiResPath');
  const html = read('index.html');
  const app = read('app.js');
  const exporter = read('src/exporter.js');

  const crossRepositoryFolder = {
    nativePath: 'F:\\DMWK_Client\\trunk\\Project\\UIRes',
    isFolder: true
  };
  assert.equal(assertUiResFolder(crossRepositoryFolder), crossRepositoryFolder);
  assert.throws(() => assertUiResFolder(null), /有效且已授权/);
  assert.throws(
    () => assertUiResFolder({ nativePath: 'F:\\DMWK_Client\\bundle.json', isFolder: false }),
    /必须是目录/);

  ['uires-path', 'uires-status', 'select-uires', 'clear-uires'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  assert.match(html, /不要求与 PSD 位于同一仓库/);
  assert.match(app, /chooseUiResFolder/);
  assert.match(app, /writeBundle\(prepared\.bundle, \{ uiResFolder \}\)/);
  assert.match(exporter, /psd2ui\.uires-token\.v1/);
  assert.match(exporter, /getEntryForPersistentToken/);
  const resolveBody = exporter.match(
    /async function resolveUiResFolder\(options\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(resolveBody, '找不到 UIRes 解析函数');
  assert.doesNotMatch(resolveBody[1], /getFolder\(/,
    '导出动作不得在后台隐式弹出目录选择');
});
