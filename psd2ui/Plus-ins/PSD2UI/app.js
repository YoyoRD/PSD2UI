'use strict';

const { core: photoshopCore } = require('photoshop');
const Psd2Ui = require('./generated/core/index');
const { describePreflightIssues } = require('./src/preflightIssues');
const {
  getDocumentXmp,
  readManifest,
  readSidecarManifest,
  readSidecarRaw,
  restoreSidecarRaw,
  setDocumentXmp,
  writeManifest,
  writeManifestInCurrentModal
} = require('./src/xmpStore');
const {
  getActiveLayerInfo,
  getActiveLayersInfo,
  getDocumentInfo,
  addSelectionChangeListener,
  createSnapshot,
  structureActiveLayers,
  validateGroupSelection,
  selectLayersById,
  previewVisualState,
  restoreVisualStatePreview,
  renameActiveLayers,
  applyConfirmedPreinitializeRenames,
  applyConfirmedStructurePlan,
  findLayerById,
  openLocalDocument,
  requireDocument,
  wrapTopLevelLayersInGroup,
  readLayer
} = require('./src/photoshopDocument');
const {
  getRememberedUiResFolder,
  chooseUiResFolder,
  clearRememberedUiResFolder,
  verifyBundle,
  writeBundle
} = require('./src/exporter');

const HumanContext = { actor: 'human-panel' };
const McpContext = { actor: 'mcp' };
const PanelShell = window.Psd2UiPanelShell;

function element(id) {
  return document.getElementById(id);
}

let currentUiResFolder = null;
let draftDocumentKey = '';
let draftManifest = null;
let componentSelection = [];
let componentSelectionKey = '';
let componentOptions = {};
let componentInputs = { roles: [], previews: [], layout: [] };
let selectionIssueLayerIds = [];
let visualStateSelectionKey = '';
let visualStateInputs = [];
let savedDocumentKey = '';
let preparationDocumentKey = '';
let authoringRefreshVersion = 0;
let operationRunning = false;
let returnComponent = null;
let preflightContext = null;
let componentSaveDocumentKey = '';
let moduleInputDocumentKey = '';
let moduleInputDirty = false;
const authoringStateCache = new Map();

function documentKey() {
  const document = requireDocument();
  return `${String(document.id)}|${getDocumentInfo().path}`;
}

function selectionKey() {
  // Identity checks must not project every descendant of a selected group.
  try { return `${documentKey()}|${Array.from(requireDocument().activeLayers || []).map(layer => String(layer.id)).sort().join(',')}`; }
  catch (error) { return ''; }
}

function isCurrentRefresh(version, selection) {
  if (version !== authoringRefreshVersion) return false;
  if (selection !== selectionKey()) {
    scheduleSelectionRefresh();
    return false;
  }
  return true;
}

function requireSameDocument(key) {
  if (documentKey() !== key) throw new Error('操作期间切换了 PSD，请回到原文档后重试。');
}

function showElement(id, visible) {
  const target = element(id);
  if (!target) return;
  if (visible) target.classList.remove('is-hidden');
  else target.classList.add('is-hidden');
}

async function ensureAuthoringManifest() {
  const info = getDocumentInfo();
  const liveDocument = requireDocument();
  const key = `${String(liveDocument.id)}|${info.path}`;
  const stored = await readManifest();
  requireSameDocument(key);
  savedDocumentKey = stored ? key : '';
  const current = stored || (draftDocumentKey === key ? draftManifest : null);
  if (current) return Psd2Ui.projectAutomaticImageSemantics(
    { ...current, resourceNaming: 'source' }, createSnapshot(current.document.rootLayerId));
  const rootLayerId = 'document-root';
  const snapshot = createSnapshot(rootLayerId);
  draftManifest = Psd2Ui.executeAuthoringCommand(null, {
    command: 'initialize-document', input: {
      module: 'document', resourceNaming: 'source', name: info.name,
      width: info.width, height: info.height,
      rootLayerId, rootLayerName: info.name, snapshot
    }
  }, HumanContext).manifest;
  draftDocumentKey = key;
  return draftManifest;
}

function renderPreparationState(manifest) {
  let info;
  try { info = getDocumentInfo(); requireDocument(); } catch (error) { info = null; }
  const key = info ? documentKey() : '';
  if (moduleInputDocumentKey !== key) {
    moduleInputDocumentKey = key;
    moduleInputDirty = false;
  }
  const moduleName = manifest && manifest.document && manifest.document.module || '';
  if (!moduleInputDirty) element('document-module').value = moduleName === 'document' ? '' : moduleName;
  element('set-module').disabled = !manifest;
  element('document-module-status').textContent = !manifest ? '打开 PSD 后读取所属模块。'
    : moduleName === 'document'
      ? '尚未指定业务模块：当前暂用 document。导出前请填写并保存所属模块。'
      : `当前配置：${moduleName}。修改后点击“保存所属模块”或保存文档准备。`;
  const ready = Boolean(manifest && savedDocumentKey === key);
  element('preparation-badge').textContent = ready ? '已准备' : info ? '待保存配置' : '等待 PSD';
  element('preparation-title').textContent = ready ? '可以开始配置组件了' : info ? '为这份 PSD 建立配置' : '先打开并保存本地 PSD';
  element('preparation-description').textContent = ready
    ? '已读取保存的组件。重新准备只同步图层变化，保留已有配置。'
    : '点击下方按钮完成初始化；配置会写入 PSD 和同目录配置文件。';
  element('prepare-document').textContent = ready ? '同步文档，保留组件配置' : '初始化并保存配置';
  element('prepare-document').disabled = !info || !manifest;
  element('start-components').disabled = !info || !manifest;
  showElement('prepare-reminder', !ready);
  const layers = info ? Array.from(requireDocument().layers || []) : [];
  const grouped = layers.length === 1 && Psd2Ui.isGroupLayer(readLayer(layers[0]));
  element('wrap-document-root').disabled = !manifest || !layers.length || grouped;
  element('wrap-document-root').textContent = grouped ? '已有一个根组' : '将全部图层放入根组';
  element('root-group-summary').textContent = grouped
    ? `全部图层已在「${layers[0].name}」中，无需再次套组。`
    : layers.length ? `将收进全部 ${layers.length} 个顶层图层和组。` : '打开 PSD 后读取图层。';
  if (preparationDocumentKey !== key) {
    preparationDocumentKey = key;
    element('root-group-name').value = info ? info.name : '';
    PanelShell.activatePanel(ready ? 'layer' : 'prepare');
  }
}

async function prepareDocument() {
  const key = documentKey();
  const moduleName = element('document-module').value.trim();
  let current = await ensureAuthoringManifest();
  requireSameDocument(key);
  if (moduleName) current = Psd2Ui.executeAuthoringCommand(current, {
    command: 'set-document-module', input: { module: moduleName }
  }, HumanContext).manifest;
  const persisted = await persistManifest(current);
  moduleInputDirty = false;
  return { document: persisted.manifest.document.name, module: persisted.manifest.document.module, preservedConfiguration: true,
    sidecarPath: persisted.writeResult.sidecarPath };
}

async function saveDocumentModule() {
  const key = documentKey();
  const moduleName = element('document-module').value.trim();
  if (!moduleName) throw new Error('请填写界面所属模块，例如 baoleizhengduo。');
  const current = await ensureAuthoringManifest();
  requireSameDocument(key);
  const result = Psd2Ui.executeAuthoringCommand(current, {
    command: 'set-document-module', input: { module: moduleName }
  }, HumanContext);
  const persisted = await persistManifest(result.manifest);
  moduleInputDirty = false;
  return { module: persisted.manifest.document.module, sidecarPath: persisted.writeResult.sidecarPath };
}

async function wrapDocumentRoot() {
  const key = documentKey();
  const name = String(element('root-group-name').value || '').trim();
  if (!name) throw new Error('请填写根组名称。');
  const current = await ensureAuthoringManifest();
  requireSameDocument(key);
  const layers = Array.from(requireDocument().layers || []);
  if (layers.length === 1 && Psd2Ui.isGroupLayer(readLayer(layers[0]))) {
    return { reused: true, rootGroup: layers[0].name };
  }
  return runDocumentMutationWithManifestRollback(current, (persistInMutation) =>
    wrapTopLevelLayersInGroup(layers.map((layer) => String(layer.id)), name, async (group) => {
      const persisted = await persistInMutation(current);
      return { rootGroup: group.name, layerCount: group.childLayerIds.length,
        sidecarPath: persisted.writeResult.sidecarPath };
    }));
}

function requireLayersInAuthoringRoot(manifest, layers) {
  const root = createSnapshot(manifest.document.rootLayerId).root;
  for (const layer of layers) {
    if (!findSnapshotLayer([root], layer.id || layer.layerId)) {
      throw new Error(`「${layer.name}」在当前文档配置的根组之外。请在「${root.name}」组内配置组件；本次尚未保存。`);
    }
  }
}

function renderUiResFolder(folder, status) {
  currentUiResFolder = folder || null;
  element('uires-path').value = folder && folder.nativePath || '';
  element('uires-status').textContent = status || (folder
    ? '目录已授权；导出只会写入此目录。'
    : '请选择并授权一个可写目录。');
  element('export-output-summary').textContent = folder
    ? `输出到：${folder.nativePath}；图片放入 sprite/模块名 或 texture/模块名，JSON 放入 json。` : '请先在上方选择输出目录。';
}

async function refreshUiResFolder() {
  const folder = await getRememberedUiResFolder();
  renderUiResFolder(folder);
  return folder;
}

function requireUiResFolder() {
  if (!currentUiResFolder) {
    PanelShell.activatePanel('export');
    throw new Error('请先在“检查导出”中选择输出目录。');
  }
  return currentUiResFolder;
}

function writeStatus(value, summary) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  element('status').value = text;
  element('status-summary').textContent = summary || text.split('\n')[0] || '等待操作。';
  element('status-summary').classList.remove('is-error');
  element('status-summary').classList.remove('is-success');
  if (summary && summary.includes('失败')) element('status-summary').classList.add('is-error');
  else if (summary && summary.includes('成功')) element('status-summary').classList.add('is-success');
}

function formatError(error) {
  if (error && error.issues) {
    return `${error.message}\n${error.issues.map((entry) => `- [${entry.code}] ${entry.path ? `${entry.path}: ` : ''}${entry.message}`).join('\n')}`;
  }
  const diagnostics = error && error.details && error.details.diagnostics;
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    return `${error.message}\n${diagnostics.map((entry) => `- [${entry.code}] ${entry.message}`).join('\n')}`;
  }
  return error && error.message ? error.message : String(error);
}

function setStatusExpanded(expanded) {
  PanelShell.setStatusExpanded(expanded);
}

async function run(label, callback, options) {
  if (operationRunning) return null;
  operationRunning = true;
  authoringRefreshVersion += 1;
  authoringStateCache.clear();
  try {
    if (globalThis.__PSD2UI_REFRESH_HOST__) await globalThis.__PSD2UI_REFRESH_HOST__();
    if (!options || options.keepVisualPreview !== true) await restoreVisualStatePreview();
    writeStatus(`${label}：执行中……`, `${label}：执行中`);
    const result = await callback();
    refreshContext();
    await refreshAuthoringState();
    writeStatus({ operation: label, success: true, result }, `${label}成功`);
    return result;
  } catch (error) {
    if (Array.isArray(error && error.layerIds)) {
      selectionIssueLayerIds = error.layerIds.map(String);
      showElement('locate-selection-issue', selectionIssueLayerIds.length > 0);
    }
    const message = `${label}失败：\n${formatError(error)}`;
    writeStatus(message, `${label}失败`);
    if (options && options.reportPreflight) {
      renderPreflightFailure(error);
      setStatusExpanded(false);
    } else setStatusExpanded(true);
    console.error(error);
    return null;
  } finally {
    operationRunning = false;
  }
}

function captureBaseline(manifest, context) {
  if (!manifest || !manifest.document || !manifest.document.rootLayerId) return manifest;
  const snapshot = createSnapshot(manifest.document.rootLayerId);
  return Psd2Ui.executeAuthoringCommand(
    manifest,
    { command: 'capture-baseline', input: { snapshot } },
    context || HumanContext).manifest;
}

async function persistManifest(manifest, writer, context) {
  const key = documentKey();
  const snapshot = createSnapshot(manifest.document.rootLayerId);
  const synchronized = Psd2Ui.executeAuthoringCommand(manifest, {
    command: 'sync-layer-tree',
    input: { snapshot }
  }, context || HumanContext);
  const persisted = captureBaseline(synchronized.manifest, context);
  const writeResult = await (writer || writeManifest)(persisted, true);
  requireSameDocument(key);
  const readback = await readManifest();
  requireSameDocument(key);
  assertJsonEqual(readback, persisted, '保存后的组件配置');
  savedDocumentKey = key;
  draftManifest = persisted;
  draftDocumentKey = key;
  return {
    manifest: persisted,
    writeResult,
    diagnostics: synchronized.value.diagnostics,
    reconciliation: synchronized.value.reconciliation
  };
}

async function restoreManifestPersistence(document, backup) {
  return photoshopCore.executeAsModal(async () => {
    const rollbackErrors = [];
    try { await setDocumentXmp(backup.xmp); } catch (error) {
      rollbackErrors.push(`PSD XMP：${formatError(error)}`);
    }
    try { await restoreSidecarRaw(backup.sidecar); } catch (error) {
      rollbackErrors.push(`同目录配置镜像：${formatError(error)}`);
    }
    try { await document.save(); } catch (error) {
      rollbackErrors.push(`PSD 保存：${formatError(error)}`);
    }
    try {
      if (await getDocumentXmp() !== backup.xmp) {
        throw new Error('恢复后的原始 XMP 字节不一致。');
      }
      assertJsonEqual(await readSidecarRaw(document), backup.sidecar, '恢复后的同目录配置镜像');
    } catch (error) {
      rollbackErrors.push(`回滚读回：${formatError(error)}`);
    }
    if (rollbackErrors.length > 0) throw new Error(rollbackErrors.join('；'));
  }, { commandName: 'PSD2UI：恢复图层变更前的 Manifest' });
}

async function runDocumentMutationWithManifestRollback(current, operation) {
  const document = requireDocument();
  const backup = current ? {
    xmp: await getDocumentXmp(),
    sidecar: await readSidecarRaw(document)
  } : null;
  let persistenceStarted = false;
  const persistInCurrentMutation = async (manifest, context) => {
    const persisted = await persistManifest(manifest, async (prepared) => {
      persistenceStarted = true;
      return writeManifestInCurrentModal(prepared, false);
    }, context);
    await assertPersistedManifest(persisted.manifest, document, '文档变更保存前');
    await document.save();
    await assertPersistedManifest(persisted.manifest, document, '文档变更保存后');
    return persisted;
  };

  try {
    return await operation(persistInCurrentMutation);
  } catch (error) {
    draftManifest = null;
    draftDocumentKey = '';
    savedDocumentKey = '';
    if (!backup || !persistenceStarted) throw error;
    try {
      await restoreManifestPersistence(document, backup);
    } catch (rollbackError) {
      throw new Error(`${formatError(error)}\nManifest 回滚失败：${formatError(rollbackError)}`);
    }
    throw error;
  }
}

async function executeWithContext(command, input, context) {
  const current = await readManifest();
  const result = Psd2Ui.executeAuthoringCommand(current, { command, input }, context);
  const persisted = await persistManifest(result.manifest, null, context);
  return { manifest: persisted.manifest, value: result.value, writeResult: persisted.writeResult };
}

async function execute(command, input) {
  return executeWithContext(command, input, HumanContext);
}

function handlePanelChanged(panelName) {
  element('current-layer').title = element('current-layer').textContent;
  refreshContext();
  refreshAuthoringState().catch((error) => console.error('刷新 PSD2UI 配置状态失败。', error));
}

function setAdvancedResourceVisible(visible) {
  PanelShell.setAdvancedResourceVisible(visible);
}

function updateSemanticOptions() {
  PanelShell.updateSemanticOptions();
  showElement('slice-fields', element('image-type').value === 'sliced');
}

function setSemantic(semantic, resetValues) {
  if (semantic === 'group' || semantic === 'view') semantic = '';
  const registered = PanelShell.SemanticEntries.some((entry) => entry.name === semantic);
  if (!registered && semantic !== '') return;
  element('semantic').value = semantic;
  if (resetValues) {
    if (semantic === 'image') resetImageDefaults();
    if (semantic === 'text') resetTextDefaults();
  }
  updateSemanticOptions();
}

function resetImageDefaults() {
  element('image-type').value = 'simple';
  showElement('slice-fields', false);
  element('slice-left').value = '0';
  element('slice-top').value = '0';
  element('slice-right').value = '0';
  element('slice-bottom').value = '0';
}

function resetTextDefaults() {
  element('font-key').value = 'default';
}

function readNumber(id, label, options) {
  const value = Number(element(id).value);
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有效数字。`);
  if (options && options.integer && !Number.isInteger(value)) throw new Error(`${label}必须是整数。`);
  if (options && options.min != null && value < options.min) {
    throw new Error(`${label}不能小于 ${options.min}。`);
  }
  return value;
}

function buildNodeParameters(semantic) {
  if (semantic === 'image') {
    const imageType = element('image-type').value;
    return {
      image: {
        imageType,
        sliceBorder: imageType === 'sliced'
          ? {
            left: readNumber('slice-left', '九宫左边距', { min: 0, integer: true }),
            top: readNumber('slice-top', '九宫上边距', { min: 0, integer: true }),
            right: readNumber('slice-right', '九宫右边距', { min: 0, integer: true }),
            bottom: readNumber('slice-bottom', '九宫下边距', { min: 0, integer: true })
          }
          : null
      }
    };
  }
  if (semantic === 'text') {
    const fontKey = String(element('font-key').value || '').trim();
    if (!fontKey) throw new Error('fontKey 不能为空。');
    return { text: { fontKey } };
  }
  return {};
}

function requireSingleSelection(operation) {
  const selected = getActiveLayersInfo();
  if (selected.length !== 1) {
    throw new Error(`${operation}要求只选择 1 个图层；当前选择了 ${selected.length} 个。组合组件请先在 Photoshop 中建组并只选择该组。`);
  }
  return selected[0];
}

function withAuthoringState(layers, manifest) {
  const nodes = manifest && manifest.nodes || {};
  function decorate(layer) {
    const layerId = String(layer && (layer.layerId != null ? layer.layerId : layer.id) || '');
    const node = nodes[layerId];
    return {
      ...layer,
      id: layer && layer.id != null ? String(layer.id) : layerId,
      layerId,
      semantic: node ? node.semantic : '',
      structure: node ? node.structure : null,
      visualStates: node ? node.visualStates : null,
      viewport: node ? node.viewport : null,
      children: (layer && layer.children || []).map(decorate)
    };
  }
  return (layers || []).map(decorate);
}

function semanticDisplayName(semantic) {
  const entry = PanelShell.SemanticEntries.find((candidate) => candidate.name === semantic);
  if (entry) return entry.title;
  if (semantic === 'view') return '界面根 / View';
  if (semantic === 'group') return '普通容器 / Group';
  return semantic || '尚未解析';
}

function clearChildren(target) {
  while (target && target.firstChild) target.removeChild(target.firstChild);
}

function showComponentSaveReceipt(manifest, layerId, expectedSemantic) {
  const node = manifest.nodes[String(layerId)];
  if (!node || node.semantic !== expectedSemantic) {
    throw new Error(`图层 #${layerId} 的组件保存结果与 ${semanticDisplayName(expectedSemantic)} 不一致，请重新读取配置。`);
  }
  componentSaveDocumentKey = documentKey();
  element('component-save-feedback').textContent = `最近已保存：${node.name} · #${layerId} → ${semanticDisplayName(node.semantic)}。`;
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = String(value || '');
  option.textContent = label;
  select.appendChild(option);
}

function findSnapshotLayer(layers, layerId) {
  for (const layer of layers || []) {
    if (String(layer.layerId || layer.id) === String(layerId)) return layer;
    const nested = findSnapshotLayer(layer.children || [], layerId);
    if (nested) return nested;
  }
  return null;
}

function readComponentOptions() {
  const options = { roles: [], previewLayerIds: [], autoLayout: componentOptions.autoLayout !== false };
  componentInputs.roles.forEach((entry) => {
    if (entry.input.value) options.roles.push({ name: entry.name, layerId: String(entry.input.value) });
  });
  const template = options.roles.find((role) => role.name === 'item-template' || role.name === 'cell-template');
  if (template) options.templateLayerId = template.layerId;
  componentInputs.previews.forEach((entry) => {
    if (entry.input.checked && entry.layerId !== options.templateLayerId) options.previewLayerIds.push(entry.layerId);
  });
  if (componentInputs.layout.length) {
    options.layout = {};
    componentInputs.layout.forEach((entry) => {
      options.layout[entry.name] = entry.name === 'direction' ? entry.input.value : Number(entry.input.value);
    });
  }
  options.groupName = String(element('component-group-name').value || '').trim();
  if (componentInputs.viewportEnabled) {
    options.viewport = componentInputs.viewportEnabled.checked ? {
      width: Number(componentInputs.viewportWidth.value), height: Number(componentInputs.viewportHeight.value)
    } : null;
  }
  return options;
}

function updateAutomaticCollectionLayout(semantic, options) {
  if (!['list', 'grid'].includes(semantic)) return;
  const status = element('component-layout-status');
  if (!options.autoLayout) {
    status.textContent = '保留已保存或手动调整的布局；需要时可根据当前图层重新计算。';
    return;
  }
  const template = findSnapshotLayer(componentSelection, options.templateLayerId);
  if (!template) {
    status.textContent = '选择模板后，自动读取同级格子的尺寸、行列数和间距。';
    return;
  }
  const size = layer => ({ width: Number(layer.bounds.right) - Number(layer.bounds.left),
    height: Number(layer.bounds.bottom) - Number(layer.bounds.top) });
  const templateSize = size(template);
  const members = componentSelection.length === 1 ? componentSelection[0].children : componentSelection;
  const candidates = Psd2Ui.collectComponentCandidates(members || []);
  const samples = options.previewLayerIds.length
    ? [template, ...options.previewLayerIds.map(id => findSnapshotLayer(componentSelection, id)).filter(Boolean)]
    : [template, ...candidates.filter(layer => {
      if (!Psd2Ui.isGroupLayer(layer) || String(layer.layerId) === String(template.layerId)
          || String(layer.parentId) !== String(template.parentId)) return false;
      const candidateSize = size(layer);
      return Math.abs(candidateSize.width - templateSize.width) <= 1 && Math.abs(candidateSize.height - templateSize.height) <= 1;
    })];
  if (samples.length < 2) {
    status.textContent = '只有一个模板，已读取尺寸；间距和行列数可手动调整。';
    return;
  }
  try {
    const measured = Psd2Ui.suggestCollectionLayout(semantic, samples);
    options.layout = measured.layout;
    componentInputs.layout.forEach(entry => { entry.input.value = String(measured.layout[entry.name]); });
    const layout = measured.layout;
    const summary = semantic === 'grid'
      ? `${layout.columns} 列 × ${layout.rows} 行，横向间距 ${layout.horizontalSpacing}px，纵向间距 ${layout.verticalSpacing}px`
      : `${layout.direction === 'horizontal' ? '横向' : '纵向'}排列，间距 ${layout.spacing}px`;
    status.textContent = `已按 ${samples.length} 个同级样例计算：${summary}。${measured.diagnostics.map(issue => issue.message).join('')}`;
  } catch (error) {
    status.textContent = `自动计算未完成：${formatError(error)} 可调整图层后重算，或直接修改布局参数。`;
    throw error;
  }
}

function recalculateComponentLayout() {
  const fresh = getActiveLayersInfo();
  if (fresh.map(layer => String(layer.id)).join(',') !== componentSelection.map(layer => String(layer.id)).join(',')) {
    writeStatus('选择已变化，请重新选择要配置的组。', '重新计算布局失败');
    return;
  }
  const nodes = {};
  function collect(layer) { nodes[String(layer.layerId)] = layer; (layer.children || []).forEach(collect); }
  componentSelection.forEach(collect);
  componentSelection = withAuthoringState(fresh, { nodes });
  componentOptions.autoLayout = true;
  validateComponentDraft();
}

function validateComponentDraft() {
  const semantic = element('semantic').value;
  const status = element('component-configuration-status');
  const requiresGroup = componentSelection.length > 1;
  let valid = false;
  try {
    componentOptions = readComponentOptions();
    updateAutomaticCollectionLayout(semantic, componentOptions);
    Psd2Ui.planStructuredSelection(semantic, componentSelection, componentOptions);
    if (componentOptions.viewport && (!(componentOptions.viewport.width > 0) || !(componentOptions.viewport.height > 0))) {
      throw new Error('可视范围的宽度和高度必须大于 0。');
    }
    if (requiresGroup) validateGroupSelection(componentSelection);
    if (requiresGroup && !componentOptions.groupName) throw new Error('请填写新组件组名称。');
    status.textContent = requiresGroup ? '角色已就绪；组合后会保留原有位置与叠放顺序。' : '角色已就绪；保存将更新当前组的配置。';
    valid = true;
    selectionIssueLayerIds = [];
  } catch (error) {
    status.textContent = formatError(error);
    selectionIssueLayerIds = (error.layerIds || []).map(String);
  }
  element('selection-constraint').textContent = status.textContent;
  element('structure-component').disabled = !valid || requiresGroup;
  element('combine-component').disabled = !valid || !requiresGroup;
  showElement('locate-selection-issue', selectionIssueLayerIds.length > 0);
  const summary = element('component-role-summary');
  clearChildren(summary);
  componentInputs.roles.forEach((entry) => {
    const layer = findSnapshotLayer(componentSelection, entry.input.value);
    const line = document.createElement('p');
    line.textContent = `${entry.label || entry.name} → ${layer ? layer.name : '未指定'}`;
    summary.appendChild(line);
  });
  return valid;
}

function renderComponentEditor(force) {
  const semantic = element('semantic').value;
  const enabled = Psd2Ui.requiresStructure(semantic)
    && (componentSelection.length > 1 || componentSelection.length === 1 && Psd2Ui.isGroupLayer(componentSelection[0]));
  showElement('component-editor', enabled);
  showElement('component-layout-tools', enabled && ['list', 'grid'].includes(semantic));
  if (!enabled) return;
  const docInfo = getDocumentInfo();
  const key = `${docInfo.path}|${componentSelection.map((layer) => layer.layerId || layer.id).join(',')}|${semantic}`;
  if (!force && componentSelectionKey === key) { validateComponentDraft(); return; }
  const previousKey = componentSelectionKey;
  componentSelectionKey = key;
  if (previousKey !== key) {
    const existing = componentSelection.length === 1 && componentSelection[0].semantic === semantic
      ? componentSelection[0].structure : null;
    componentOptions = existing ? {
      roles: (existing.roles || []).map((role) => ({ name: role.name, layerId: role.layerId })),
      previewLayerIds: (existing.previewLayerIds || []).slice(), layout: existing.layout,
      viewport: componentSelection[0].viewport || null, autoLayout: false
    } : {};
  }
  ['component-role-fields', 'component-preview-fields', 'component-layout-fields', 'component-viewport-fields']
    .forEach((id) => clearChildren(element(id)));
  componentInputs = { roles: [], previews: [], layout: [] };
  let description;
  try { description = Psd2Ui.describeStructuredSelection(semantic, componentSelection, componentOptions); }
  catch (error) {
    element('component-configuration-status').textContent = formatError(error);
    element('structure-component').disabled = true;
    element('combine-component').disabled = true;
    return;
  }
  showElement('component-group-name-field', description.requiresGroup);
  element('component-group-name').value = componentOptions.groupName || description.groupName || '组件';
  description.roles.forEach((role) => {
    const label = document.createElement('label');
    label.className = 'role-field';
    const caption = document.createElement('span');
    caption.textContent = `${role.label || role.name}${role.required ? ' *' : '（可选）'}`;
    label.appendChild(caption);
    const select = document.createElement('select');
    appendOption(select, '', role.required ? '请选择图层' : '不使用');
    role.candidates.forEach((candidate) => appendOption(select, candidate.layerId,
      `${candidate.path || candidate.name} · #${candidate.layerId}`));
    select.value = role.selectedLayerId || '';
    select.addEventListener('change', () => {
      componentOptions = readComponentOptions();
      if (role.name === 'item-template' || role.name === 'cell-template') {
        const template = findSnapshotLayer(componentSelection, select.value);
        if (template) {
          const bounds = template.bounds || {};
          const layout = componentOptions.layout || {};
          layout[semantic === 'list' ? 'itemWidth' : 'cellWidth'] = Number(bounds.right) - Number(bounds.left);
          layout[semantic === 'list' ? 'itemHeight' : 'cellHeight'] = Number(bounds.bottom) - Number(bounds.top);
          componentOptions.layout = layout;
        }
        renderComponentEditor(true);
      } else validateComponentDraft();
    });
    label.appendChild(select);
    const help = document.createElement('small');
    const hints = {
      background: '选择负责点击区域的底图；图标和光效可作为装饰保留。',
      label: '选择显示标题的文字层，可留空。',
      text: '选择实际显示输入内容的文字层。',
      placeholder: '选择未输入时显示的提示文字。',
      'on-graphic': '选择开启或选中时出现的图案。',
      'item-template': '选择包含一整项内容的组，内部可以有按钮、文字和图标。',
      'cell-template': '选择一整个格子组，工具会用它生成重复格子。'
    };
    help.textContent = hints[role.name] || '选择该角色对应的完整组件；先配置内部组件，再配置外层。';
    label.appendChild(help);
    const locate = document.createElement('button');
    locate.type = 'button';
    locate.className = 'text-action';
    locate.textContent = '在 Photoshop 中定位';
    locate.addEventListener('click', () => {
      if (select.value) {
        returnComponent = { documentKey: documentKey(),
          layerIds: componentSelection.map((layer) => String(layer.id || layer.layerId)),
          semantic, options: readComponentOptions() };
        showElement('return-to-component', true);
        run('定位角色图层', () => selectLayersById([select.value]));
      }
    });
    label.appendChild(locate);
    element('component-role-fields').appendChild(label);
    componentInputs.roles.push({ name: role.name, label: role.label, input: select });
  });
  if (semantic === 'list' || semantic === 'grid') {
    const options = readComponentOptions();
    const templateId = options.templateLayerId;
    const template = findSnapshotLayer(componentSelection, templateId);
    const bounds = template && template.bounds || {};
    const heading = document.createElement('p');
    heading.className = 'field-help';
    heading.textContent = '仅预览样例：勾选的组留在 PSD，不生成重复条目。未勾选的内容保留。';
    element('component-preview-fields').appendChild(heading);
    description.previewCandidates.filter((candidate) => candidate.layerId !== templateId).forEach((candidate) => {
      const label = document.createElement('label');
      label.className = 'check-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = (componentOptions.previewLayerIds || []).includes(candidate.layerId);
      input.addEventListener('change', validateComponentDraft);
      const caption = document.createElement('span');
      caption.textContent = `${candidate.path || candidate.name} · #${candidate.layerId}`;
      label.appendChild(input); label.appendChild(caption);
      element('component-preview-fields').appendChild(label);
      componentInputs.previews.push({ layerId: candidate.layerId, input });
    });
    const list = semantic === 'list';
    const layout = description.layout || (list
      ? { direction: 'vertical', itemWidth: Number(bounds.right) - Number(bounds.left) || 1,
        itemHeight: Number(bounds.bottom) - Number(bounds.top) || 1, spacing: 0 }
      : { cellWidth: Number(bounds.right) - Number(bounds.left) || 1,
        cellHeight: Number(bounds.bottom) - Number(bounds.top) || 1, columns: 1, rows: 1, horizontalSpacing: 0, verticalSpacing: 0 });
    const labels = { direction: '排列方向', itemWidth: '条目宽度', itemHeight: '条目高度', spacing: '条目间距',
      cellWidth: '单元格宽度', cellHeight: '单元格高度', columns: '列数', rows: '预览行数', horizontalSpacing: '横向间距', verticalSpacing: '纵向间距' };
    const fields = list ? ['direction', 'itemWidth', 'itemHeight', 'spacing']
      : ['cellWidth', 'cellHeight', 'columns', 'rows', 'horizontalSpacing', 'verticalSpacing'];
    fields.forEach((name) => {
      const label = document.createElement('label');
      const caption = document.createElement('span'); caption.textContent = labels[name]; label.appendChild(caption);
      const input = document.createElement(name === 'direction' ? 'select' : 'input');
      if (name === 'direction') { appendOption(input, 'vertical', '纵向'); appendOption(input, 'horizontal', '横向'); }
      else { input.type = 'number'; input.min = name.toLowerCase().includes('spacing') ? '0' : '1'; input.step = '1'; }
      input.value = String(layout[name]);
      input.addEventListener('change', () => { componentOptions.autoLayout = false; validateComponentDraft(); });
      label.appendChild(input); element('component-layout-fields').appendChild(label);
      componentInputs.layout.push({ name, input });
    });
    const viewportContainer = element('component-viewport-fields');
    const toggleLabel = document.createElement('label'); toggleLabel.className = 'check-row';
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = Boolean(componentOptions.viewport);
    const toggleText = document.createElement('span'); toggleText.textContent = '单独设置列表可视范围';
    toggleLabel.appendChild(enabled); toggleLabel.appendChild(toggleText); viewportContainer.appendChild(toggleLabel);
    componentInputs.viewportEnabled = enabled;
    const allBounds = componentSelection.map((layer) => layer.bounds || {});
    const defaultViewport = { width: Math.max(...allBounds.map((box) => box.right || 0)) - Math.min(...allBounds.map((box) => box.left || 0)),
      height: Math.max(...allBounds.map((box) => box.bottom || 0)) - Math.min(...allBounds.map((box) => box.top || 0)) };
    ['width', 'height'].forEach((name) => {
      const label = document.createElement('label'); const caption = document.createElement('span');
      caption.textContent = name === 'width' ? '可视宽度' : '可视高度'; label.appendChild(caption);
      const input = document.createElement('input'); input.type = 'number'; input.min = '1';
      input.value = String((componentOptions.viewport || defaultViewport)[name]); input.disabled = !enabled.checked;
      input.addEventListener('change', validateComponentDraft); label.appendChild(input); viewportContainer.appendChild(label);
      componentInputs[name === 'width' ? 'viewportWidth' : 'viewportHeight'] = input;
    });
    enabled.addEventListener('change', () => {
      componentInputs.viewportWidth.disabled = !enabled.checked;
      componentInputs.viewportHeight.disabled = !enabled.checked;
      validateComponentDraft();
    });
  }
  validateComponentDraft();
}

function applyViewportOptions(manifest, layerId, semantic, options, sourceBounds) {
  if (!['list', 'grid'].includes(semantic) || !Object.prototype.hasOwnProperty.call(options, 'viewport')) return manifest;
  return Psd2Ui.executeAuthoringCommand(manifest, {
    command: 'set-node-viewport', input: { layerId, viewport: options.viewport, sourceBounds }
  }, HumanContext).manifest;
}

function readVisualStates() {
  if (!visualStateInputs.length) return null;
  const states = visualStateInputs.map((entry) => ({ name: String(entry.name.value || '').trim(), layerId: String(entry.layer.value || '') }));
  const selected = visualStateInputs.findIndex((entry) => entry.defaultInput.checked);
  return { defaultState: selected >= 0 ? states[selected].name : '', states };
}

function validateVisualStateDraft() {
  const value = readVisualStates();
  const preview = element('visual-state-preview-choice');
  const oldChoice = preview.value;
  clearChildren(preview);
  (value && value.states || []).forEach((state) => appendOption(preview, state.name, state.name || '未命名状态'));
  preview.value = value && value.states.some((state) => state.name === oldChoice) ? oldChoice : value && value.defaultState || '';
  try {
    if (value) Psd2Ui.planVisualStates(componentSelection[0], value);
    element('save-visual-states').disabled = false;
    element('preview-visual-state').disabled = !value;
    element('visual-state-status').textContent = value ? '状态配置可保存；预览不写入 PSD 文件。' : '没有状态；保存将清除当前组的状态配置。';
  } catch (error) {
    element('save-visual-states').disabled = true;
    element('preview-visual-state').disabled = true;
    element('visual-state-status').textContent = formatError(error);
  }
}

function addVisualStateRow(state, isDefault) {
  const group = componentSelection[0];
  const candidates = Psd2Ui.collectComponentCandidates(group.children || []).filter(Psd2Ui.isGroupLayer);
  const row = document.createElement('div'); row.className = 'issue-row';
  const name = document.createElement('input'); name.placeholder = '状态名称，如 正常 / 锁定'; name.value = state && state.name || '';
  const layer = document.createElement('select'); appendOption(layer, '', '选择状态组');
  candidates.forEach((candidate) => appendOption(layer, candidate.layerId, `${candidate.name} · #${candidate.layerId}`));
  layer.value = state && state.layerId || '';
  const defaultLabel = document.createElement('label'); defaultLabel.className = 'check-row';
  const defaultInput = document.createElement('input'); defaultInput.type = 'checkbox'; defaultInput.checked = Boolean(isDefault);
  const defaultText = document.createElement('span'); defaultText.textContent = '默认状态';
  defaultLabel.appendChild(defaultInput); defaultLabel.appendChild(defaultText);
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-action'; remove.textContent = '移除此状态';
  const entry = { name, layer, defaultInput, row };
  name.addEventListener('change', validateVisualStateDraft); layer.addEventListener('change', validateVisualStateDraft);
  defaultInput.addEventListener('change', () => {
    if (defaultInput.checked) visualStateInputs.forEach((other) => { if (other !== entry) other.defaultInput.checked = false; });
    validateVisualStateDraft();
  });
  remove.addEventListener('click', () => {
    visualStateInputs = visualStateInputs.filter((other) => other !== entry);
    element('visual-state-rows').removeChild(row); validateVisualStateDraft();
  });
  row.appendChild(name); row.appendChild(layer); row.appendChild(defaultLabel); row.appendChild(remove);
  element('visual-state-rows').appendChild(row); visualStateInputs.push(entry);
}

function renderVisualStateEditor(force) {
  const group = componentSelection.length === 1 && Psd2Ui.isGroupLayer(componentSelection[0]) ? componentSelection[0] : null;
  showElement('visual-states-editor', Boolean(group));
  if (!group) { visualStateSelectionKey = ''; return; }
  const key = `${getDocumentInfo().path}|${group.layerId}`;
  if (!force && visualStateSelectionKey === key) return;
  visualStateSelectionKey = key;
  clearChildren(element('visual-state-rows')); visualStateInputs = [];
  const value = group.visualStates;
  (value && value.states || []).forEach((state) => addVisualStateRow(state, state.name === value.defaultState));
  validateVisualStateDraft();
}

async function saveVisualStates() {
  const current = await ensureAuthoringManifest();
  const selected = withAuthoringState([requireSingleSelection('保存视觉状态')], current)[0];
  const value = readVisualStates();
  const visualStates = value ? Psd2Ui.planVisualStates(selected, value) : null;
  const result = Psd2Ui.executeAuthoringCommand(current, {
    command: 'set-visual-states', input: { layerId: selected.layerId, visualStates }
  }, HumanContext);
  const persisted = await persistManifest(result.manifest);
  visualStateSelectionKey = '';
  return { layerId: selected.layerId, visualStates, sidecarPath: persisted.writeResult.sidecarPath };
}

function updateSelectionControls(layers, manifest, preferredSemantic, blockedReason) {
  const authoredLayers = withAuthoringState(layers, manifest);
  componentSelection = authoredLayers;
  showElement('image-rename-card', authoredLayers.length > 0
    && authoredLayers.every((layer) => Psd2Ui.normalizeLayerKind(layer) === 'image'));
  const structureRootSummary = element('structure-root-summary');
  if (structureRootSummary) {
    if (blockedReason) {
      structureRootSummary.textContent = blockedReason;
    } else if (authoredLayers.length !== 1) {
      structureRootSummary.textContent = authoredLayers.length === 0
        ? '请选择一个代表完整组件的 Photoshop 图层组'
        : `当前选中 ${authoredLayers.length} 个图层；可选择类型后组合为组件`;
    } else if (Psd2Ui.normalizeLayerKind(authoredLayers[0]) !== 'group') {
      structureRootSummary.textContent = `${authoredLayers[0].name}（不是图层组）`;
    } else {
      const group = authoredLayers[0];
      const bounds = group.bounds || {};
      const width = Math.max(0, Number(bounds.right || 0) - Number(bounds.left || 0));
      const height = Math.max(0, Number(bounds.bottom || 0) - Number(bounds.top || 0));
      structureRootSummary.textContent = `${group.name} · ${Psd2Ui.summarizeSelection(group.children || [])} · ${width} × ${height} px`;
    }
  }
  const savedComponent = authoredLayers.length === 1 && authoredLayers[0].structure ? authoredLayers[0] : null;
  const availability = Psd2Ui.evaluateSemanticAvailability(authoredLayers, savedComponent
    ? { bySemantic: { [savedComponent.semantic]: savedComponent.structure } } : undefined);
  PanelShell.setSemanticAvailability(availability, preferredSemantic, blockedReason);
  renderComponentEditor(false);
  renderVisualStateEditor(false);
  return authoredLayers;
}

async function applySelectedPreset() {
  const key = documentKey();
  const layer = requireSingleSelection('写入组件语义');
  const semantic = element('semantic').value;
  const parameters = buildNodeParameters(semantic);
  let manifest = await ensureAuthoringManifest();
  requireSameDocument(key);
  requireLayersInAuthoringRoot(manifest, [layer]);
  Psd2Ui.requireSemanticAction(withAuthoringState([layer], manifest), semantic, 'apply');
  const nodeName = String(layer.name || '').trim();

  let result = Psd2Ui.executeAuthoringCommand(manifest, {
    command: 'apply-node-preset',
    input: { layerId: layer.id, name: nodeName, semantic }
  }, HumanContext);
  manifest = result.manifest;

  if (Object.keys(parameters).length > 0) {
    result = Psd2Ui.executeAuthoringCommand(manifest, {
      command: 'update-node-parameters',
      input: { layerId: layer.id, parameters }
    }, HumanContext);
    manifest = result.manifest;
  }

  const persisted = await persistManifest(manifest);
  showComponentSaveReceipt(persisted.manifest, layer.id, semantic);
  return {
    layerId: layer.id,
    layerName: layer.name,
    nodeName,
    semantic,
    parameters,
    reconciliation: persisted.reconciliation,
    sidecarPath: persisted.writeResult.sidecarPath
  };
}

async function structureSelectedComponent() {
  const key = selectionKey();
  const semantic = element('semantic').value;
  const options = readComponentOptions();
  const persistedCurrent = await ensureAuthoringManifest();
  if (selectionKey() !== key) throw new Error('读取配置期间选择已变化，请重新选择组件后保存。');
  const synchronized = Psd2Ui.executeAuthoringCommand(persistedCurrent, {
    command: 'sync-layer-tree',
    input: { snapshot: createSnapshot(persistedCurrent.document.rootLayerId) }
  }, HumanContext);
  const current = synchronized.manifest;
  const selected = withAuthoringState(getActiveLayersInfo(), current);
  requireLayersInAuthoringRoot(current, selected);
  componentSelection = selected;
  updateAutomaticCollectionLayout(semantic, options);
  Psd2Ui.requireSemanticAction(selected, semantic, 'structure', options);
  const group = selected[0];
  const plan = Psd2Ui.planStructuredGroup(semantic, group, options);
  const result = Psd2Ui.executeAuthoringCommand(current, {
    command: 'apply-structured-group',
    input: {
      layerId: plan.rootLayerId,
      name: plan.groupName,
      semantic: plan.semantic,
      structure: plan.structure
    }
  }, HumanContext);
  const configured = applyViewportOptions(result.manifest, plan.rootLayerId, semantic, options, group.bounds);
  const persisted = await persistManifest(configured);
  showComponentSaveReceipt(persisted.manifest, plan.rootLayerId, semantic);
  componentSelectionKey = '';
  return {
    groupLayerId: plan.rootLayerId,
    groupName: plan.groupName,
    semantic: plan.semantic,
    roles: plan.structure.roles,
    previewLayerIds: plan.structure.previewLayerIds,
    reconciliation: persisted.reconciliation,
    sidecarPath: persisted.writeResult.sidecarPath
  };
}

async function combineSelectedComponent() {
  const key = selectionKey();
  const semantic = element('semantic').value;
  const options = readComponentOptions();
  const current = await ensureAuthoringManifest();
  if (selectionKey() !== key) throw new Error('读取配置期间选择已变化，请重新选择组件后保存。');
  const selected = withAuthoringState(getActiveLayersInfo(), current);
  requireLayersInAuthoringRoot(current, selected);
  validateGroupSelection(selected);
  componentSelection = selected;
  updateAutomaticCollectionLayout(semantic, options);
  const plan = Psd2Ui.planStructuredSelection(semantic, selected, options);
  if (!plan.requiresGroup) throw new Error('当前已有组件组，请使用“保存组件配置”。');
  if (!options.groupName) throw new Error('请填写新组件组名称。');
  plan.groupName = options.groupName;
  return runDocumentMutationWithManifestRollback(current, (persistInMutation) =>
    structureActiveLayers(plan, async (created) => {
      const snapshot = createSnapshot(current.document.rootLayerId);
      const synchronized = Psd2Ui.executeAuthoringCommand(current, {
        command: 'sync-layer-tree', input: { snapshot }
      }, HumanContext).manifest;
      const group = withAuthoringState([readLayer(created.layer)], synchronized)[0];
      const finalPlan = Psd2Ui.planStructuredGroup(semantic, group, options);
      const result = Psd2Ui.executeAuthoringCommand(synchronized, {
        command: 'apply-structured-group', input: {
          layerId: finalPlan.rootLayerId, name: finalPlan.groupName,
          semantic, structure: finalPlan.structure
        }
      }, HumanContext);
      const configured = applyViewportOptions(result.manifest, finalPlan.rootLayerId, semantic, options, group.bounds);
      const persisted = await persistInMutation(configured);
      showComponentSaveReceipt(persisted.manifest, finalPlan.rootLayerId, semantic);
      componentSelectionKey = '';
      return { groupLayerId: finalPlan.rootLayerId, groupName: finalPlan.groupName,
        semantic, roles: finalPlan.structure.roles, sidecarPath: persisted.writeResult.sidecarPath };
    }));
}

async function batchRenameSelectedLayers() {
  const selected = getActiveLayersInfo();
  const baseName = String(element('batch-rename-base').value || '').trim();
  if (!Psd2Ui.isEnglishNodeName(baseName)) {
    throw new Error('批量改名基础名必须以英文字母开头，并且只能包含英文字母、数字和下划线。');
  }
  const start = readNumber('batch-rename-start', '起始序号', { integer: true, min: 0 });
  const width = Math.max(2, String(start + selected.length - 1).length);
  const renames = selected.map((layer, index) => ({
    layerId: layer.id,
    previousName: layer.name,
    name: selected.length === 1
      ? baseName
      : `${baseName}${String(start + index).padStart(width, '0')}`
  }));
  const current = await readManifest();
  return runDocumentMutationWithManifestRollback(current, (persistInMutation) =>
    renameActiveLayers(renames, async () => {
      if (!current) return { manifestUpdated: false, reason: '当前 PSD 尚未初始化' };
      const persisted = await persistInMutation(current);
      return {
        manifestUpdated: true,
        reconciliation: persisted.reconciliation,
        sidecarPath: persisted.writeResult.sidecarPath
      };
    }));
}

async function syncLayerTreeToManifest() {
  const manifest = await ensureAuthoringManifest();
  const persisted = await persistManifest(manifest);
  return {
    reconciliation: persisted.reconciliation,
    diagnostics: persisted.diagnostics,
    sidecarPath: persisted.writeResult.sidecarPath
  };
}

function refreshContext() {
  const result = { document: null, layers: [] };
  try {
    const info = getDocumentInfo();
    if (componentSaveDocumentKey && componentSaveDocumentKey !== documentKey()) {
      componentSaveDocumentKey = '';
      element('component-save-feedback').textContent = '';
    }
    if (preflightContext && preflightContext.documentKey !== documentKey()) {
      preflightContext = null;
      clearPreflightReport();
    }
    if (returnComponent && returnComponent.documentKey !== documentKey()) {
      returnComponent = null;
      showElement('return-to-component', false);
    }
    result.document = { name: info.name, path: info.path, width: info.width, height: info.height };
    element('current-document').textContent = `${info.name} · ${info.width} × ${info.height}`;
    element('document-size').textContent = `${info.width} × ${info.height} px`;
  } catch (error) {
    element('current-document').textContent = '没有打开本地 PSD';
    element('document-size').textContent = '—';
  }
  try {
    const selected = getActiveLayersInfo();
    result.layers = selected.map((layer) => ({ id: layer.id, name: layer.name }));
    const label = selected.length === 1
      ? `${selected[0].name} · #${selected[0].id}`
      : `已选择 ${selected.length} 个图层`;
    element('current-layer').textContent = label;
    element('editing-layer').textContent = label;
  } catch (error) {
    element('current-layer').textContent = '没有选中图层';
    element('editing-layer').textContent = '请先选择 Photoshop 图层';
  }
  return result;
}

function authoringSourceLabel(source) {
  if (source === 'structured') return '已结构化';
  if (source === 'default') return '默认解析';
  return '人工配置';
}

function loadNodeIntoFields(node) {
  if (!node) return;
  setSemantic(node.semantic, false);
  if (node.semantic === 'image' && node.image) {
    element('image-type').value = node.image.imageType || 'simple';
    const border = node.image.sliceBorder || {};
    element('slice-left').value = String(border.left || 0);
    element('slice-top').value = String(border.top || 0);
    element('slice-right').value = String(border.right || 0);
    element('slice-bottom').value = String(border.bottom || 0);
    showElement('slice-fields', element('image-type').value === 'sliced');
  }
  if (node.semantic === 'text' && node.text) {
    element('font-key').value = node.text.fontKey || 'default';
  }
}

async function refreshAuthoringState(options) {
  const version = ++authoringRefreshVersion;
  const selection = selectionKey();
  const revision = typeof photoshopCore.getDocumentRevision === 'function' ? photoshopCore.getDocumentRevision() : null;
  const key = selection ? documentKey() : '';
  const cached = options && options.reuseDocument && revision != null ? authoringStateCache.get(key) : null;
  const reuse = cached && cached.revision === revision;
  let manifest;
  if (reuse) {
    manifest = cached.manifest;
    savedDocumentKey = cached.savedDocumentKey;
    element('sidecar-path').textContent = cached.sidecarLabel;
    element('document-change-status').textContent = cached.changeLabel;
  } else {
    authoringStateCache.delete(key);
    try {
      const sidecar = await readSidecarManifest();
      if (!isCurrentRefresh(version, selection)) return null;
      const label = sidecar.manifest ? ` · revision ${sidecar.manifest.revision || 0}` : ' · 尚未生成';
      element('sidecar-path').textContent = `${sidecar.path}${label}`;
    } catch (error) {
      element('sidecar-path').textContent = '当前文档不是已保存的本地 PSD';
    }

    try {
      manifest = await ensureAuthoringManifest();
      if (!isCurrentRefresh(version, selection)) return null;
    } catch (error) {
      if (!isCurrentRefresh(version, selection)) return null;
      renderPreparationState(null);
      element('layer-config-status').textContent = '无法读取当前 PSD 的配置。';
      element('effective-semantic').textContent = '读取失败';
      element('layer-change-summary').textContent = formatError(error);
      updateSelectionControls([], null, element('semantic').value, '无法读取当前 PSD 的配置。');
      return null;
    }
  }
  renderPreparationState(manifest);
  if (!manifest) {
    element('layer-config-status').textContent = '请选择已保存本地 PSD 的图层。';
    element('effective-semantic').textContent = '等待文档';
    element('layer-change-summary').textContent = '尚无保存基线。';
    element('document-change-status').textContent = '尚无保存基线。';
    updateSelectionControls([], null, element('semantic').value, '请先打开已保存的本地 PSD。');
    return null;
  }
  if (manifest.document) {
    element('document-name').value = manifest.document.name || '';
    element('document-submodule').value = manifest.document.submodule || '';
  }

  if (!reuse) try {
    const documentChanges = Psd2Ui.diffSnapshotFromBaseline(
      manifest,
      createSnapshot(manifest.document.rootLayerId));
    element('document-change-status').textContent = documentChanges.length === 0
      ? '整个界面根与上次保存一致。'
      : `${documentChanges.length} 个图层相对上次保存有变化：${documentChanges.slice(0, 3).map((entry) => entry.name).join('、')}${documentChanges.length > 3 ? '……' : ''}`;
  } catch (error) {
    element('document-change-status').textContent = `无法比较：${formatError(error)}`;
  }
  if (!reuse && revision != null && revision === photoshopCore.getDocumentRevision()) {
    authoringStateCache.set(key, { revision, manifest, savedDocumentKey,
      sidecarLabel: element('sidecar-path').textContent,
      changeLabel: element('document-change-status').textContent });
    // Bound retained manifests when artists cycle through many large PSDs.
    if (authoringStateCache.size > 4) authoringStateCache.delete(authoringStateCache.keys().next().value);
  }

  let selected;
  try {
    selected = getActiveLayersInfo();
  } catch (error) {
    element('layer-config-status').textContent = '请在 Photoshop 中选择图层。';
    element('effective-semantic').textContent = '未选择';
    element('layer-change-summary').textContent = '未选择图层，无法比较变化。';
    updateSelectionControls([], manifest, element('semantic').value, '请先选择一个或多个 Photoshop 图层。');
    return manifest;
  }

  const nodes = manifest.nodes || {};
  if (selected.length === 1) {
    const layer = selected[0];
    const node = nodes[layer.id];
    const effectiveSemantic = node
      ? node.semantic
      : Psd2Ui.inferSourceSemantic(layer, false);
    const emptyGroup = Psd2Ui.collectUnconfiguredEmptyGroupIds(layer, manifest).has(String(layer.id));
    element('effective-semantic').textContent = emptyGroup ? '空组 · 未设置组件' : semanticDisplayName(effectiveSemantic);
    updateSelectionControls(selected, manifest, effectiveSemantic);
    if (emptyGroup) {
      element('layer-config-status').textContent = '没有可导出的内容，预检和导出自动跳过；添加内容后自动恢复正常导出。';
      setSemantic('', false);
    } else if (effectiveSemantic === 'group' && (!node || node.authoringSource === 'default')) {
      element('layer-config-status').textContent = '未设置组件；按普通图层组保留层级。需要改变用途时，选择类型后配置。';
      setSemantic('', false);
    } else if (node) {
      element('layer-config-status').textContent = node.authoringSource === 'default'
        ? '自动识别。需要改变用途时，选择类型并保存。'
        : `已保存：${semanticDisplayName(node.semantic)}${node.structure ? '，角色配置已记录' : ''}。`;
      if (node.authoringSource === 'default' && ['image', 'raw-image'].includes(node.semantic)) {
        const bounds = layer.bounds || {};
        const width = Math.max(0, Number(bounds.right || 0) - Number(bounds.left || 0));
        const height = Math.max(0, Number(bounds.bottom || 0) - Number(bounds.top || 0));
        element('layer-config-status').textContent = `自动识别：${width} × ${height} px → `
          + (node.semantic === 'raw-image' ? 'Texture（独立贴图）' : 'Sprite（图片）')
          + '。选择类型并保存可固定用途。';
      }
      loadNodeIntoFields(node);
    } else {
      element('layer-config-status').textContent = `初始化后新增的图层；当前默认解析为 ${semanticDisplayName(effectiveSemantic)}，导出时会补入配置。`;
      setSemantic(effectiveSemantic, true);
    }
    const changes = Psd2Ui.diffLayerFromBaseline(manifest, layer);
    element('layer-change-summary').textContent = changes.length === 0
      ? '与上次保存一致。'
      : `相对上次保存：${changes.join('；')}。`;
  } else {
    const explicitCount = selected.filter((layer) => {
      const node = nodes[layer.id];
      return node && node.authoringSource !== 'default';
    }).length;
    element('effective-semantic').textContent = '多选组合';
    updateSelectionControls(selected, manifest, element('semantic').value);
    element('layer-config-status').textContent = `已选择 ${selected.length} 个图层，其中 ${explicitCount} 个已有配置。选择连续同级图层可组合为组件。`;
    const changed = selected.map((layer) => ({
      name: layer.name,
      changes: Psd2Ui.diffLayerFromBaseline(manifest, layer)
    })).filter((entry) => entry.changes.length > 0);
    element('layer-change-summary').textContent = changed.length === 0
      ? '所选图层均与上次保存一致。'
      : `${changed.length} 个所选图层有变化：${changed.slice(0, 3).map((entry) => `${entry.name}（${entry.changes.join('、')}）`).join('；')}${changed.length > 3 ? '；……' : ''}`;
  }
  return manifest;
}

async function loadManifestIntoFields(requireExisting) {
  const manifest = await readManifest();
  if (!manifest) {
    if (requireExisting) throw new Error('当前 PSD 尚未初始化。');
    return null;
  }
  if (manifest.document) {
    element('document-name').value = manifest.document.name || '';
    element('document-submodule').value = manifest.document.submodule || '';
  }
  await refreshAuthoringState();
  return manifest;
}

function normalizeModuleInput() {
  const original = element('document-module').value;
  const normalized = String(original || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z]+/, '');
  if (!normalized) throw new Error('当前输入无法规范为合法 module；请以小写英文字母开头。');
  element('document-module').value = normalized;
  moduleInputDirty = true;
  return { before: original, after: normalized };
}

function normalizeSubmoduleInput() {
  const original = element('document-submodule').value;
  const normalized = String(original || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[^a-z]+/, '');
  if (!normalized) throw new Error('当前输入无法规范为合法 submodule；请以小写英文字母开头。');
  element('document-submodule').value = normalized;
  return { before: original, after: normalized };
}

async function inspectSelectedResource() {
  const manifest = await readManifest();
  if (!manifest) throw new Error('请先初始化当前 PSD 文档。');
  const layer = requireSingleSelection('读取资源绑定');
  const registry = manifest.resourceRegistry || {};
  const resourceId = (registry.layerBindings || {})[layer.id];
  const resource = resourceId && (registry.resources || {})[resourceId];
  if (!resource) {
    element('resource-summary').textContent = `${layer.name} 尚未显式绑定资源；默认导出时会自动分配。`;
    return { layerId: layer.id, bound: false };
  }
  element('resource-summary').textContent = `${resource.fileName} · ${resource.scope} · ${resource.status}`;
  element('reuse-resource-id').value = resourceId;
  return resource;
}

function prepareBundle(manifest, context) {
  const snapshot = createSnapshot(manifest.document.rootLayerId);
  const prepared = Psd2Ui.executeAuthoringCommand(manifest, {
    command: 'prepare-default-export',
    input: { snapshot }
  }, context || HumanContext);
  return {
    snapshot,
    manifest: prepared.manifest,
    preparationDiagnostics: prepared.value.diagnostics,
    reconciliation: prepared.value.reconciliation,
    bundle: Psd2Ui.buildBundle(prepared.manifest, snapshot)
  };
}

function renderImageNameIssues(issues) {
  const container = element('image-name-issues');
  clearChildren(container);
  element('image-name-summary').textContent = issues.length
    ? `${issues.length} 处问题需要处理。点击问题可定位到 Photoshop 图层。` : '图片命名检查通过。';
  issues.forEach((issue, index) => {
    const row = document.createElement('div'); row.className = 'issue-row';
    const text = document.createElement('p'); text.textContent = issue.message; row.appendChild(text);
    if (issue.layerId && issue.layerId !== 'document-root') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'text-action';
      button.textContent = `定位 ${issue.name || issue.layerId}`;
      button.addEventListener('click', () => run('定位命名问题', () => selectLayersById([issue.layerId])));
      row.appendChild(button);
    }
    container.appendChild(row);
  });
}

function clearPreflightReport() {
  clearChildren(element('preflight-issues'));
  showElement('preflight-report', false);
}

function renderPreflightFailure(error) {
  let context = preflightContext;
  try {
    if (!context || context.documentKey !== documentKey()) context = null;
  } catch (readError) { context = null; }
  const rows = describePreflightIssues(error, context && context.manifest, context && context.snapshot);
  const container = element('preflight-issues');
  clearChildren(container);
  element('preflight-issue-summary').textContent = `发现 ${rows.length} 处问题，处理后重新预检。`;
  element('export-summary').textContent = `预检未通过：${rows.length} 处问题。请查看上方问题列表。`;
  rows.forEach((issue, index) => {
    const row = document.createElement('div'); row.className = 'preflight-issue';
    const heading = document.createElement('strong');
    heading.textContent = `${index + 1}. ${issue.layers.length ? issue.layers.map(layer => layer.name).join('、') : '文档 / 导出设置'}`;
    row.appendChild(heading);
    issue.layers.forEach(layer => {
      const path = document.createElement('p'); path.className = 'issue-layer-path';
      path.textContent = `${layer.path} · #${layer.id}`;
      row.appendChild(path);
    });
    const reason = document.createElement('p'); reason.textContent = issue.message; row.appendChild(reason);
    const hint = document.createElement('p'); hint.className = 'field-help'; hint.textContent = issue.hint; row.appendChild(hint);
    issue.layers.filter(layer => layer.canLocate && context).forEach(layer => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'text-action';
      button.textContent = `定位「${layer.name}」`;
      const originKey = context.documentKey;
      button.addEventListener('click', () => run('定位预检问题', async () => {
        requireSameDocument(originKey);
        await selectLayersById([layer.id]);
        return { layerId: layer.id, layerName: layer.name, layerPath: layer.path };
      }));
      row.appendChild(button);
    });
    const code = document.createElement('p'); code.className = 'issue-code'; code.textContent = issue.code; row.appendChild(code);
    container.appendChild(row);
  });
  showElement('preflight-report', true);
  PanelShell.activatePanel('export');
}

async function checkImageNames(requireValid) {
  const manifest = await ensureAuthoringManifest();
  const snapshot = createSnapshot(manifest.document.rootLayerId);
  const issues = Psd2Ui.collectInvalidImageLayerNames(snapshot, manifest);
  renderImageNameIssues(issues);
  if (requireValid && issues.length) {
    PanelShell.activatePanel('export');
    const error = new Error(`图片命名检查未通过，共 ${issues.length} 处。请按检查列表修正后导出。`);
    error.issues = issues;
    throw error;
  }
  return { status: issues.length ? 'blocked' : 'ready', issues, manifest, snapshot };
}

async function prepareCurrentDocumentForExport() {
  clearPreflightReport();
  const context = { documentKey: documentKey(), manifest: null, snapshot: null };
  preflightContext = context;
  element('export-summary').textContent = '正在检查图层、组件和资源……';
  await restoreVisualStatePreview();
  const checked = await checkImageNames(false);
  requireSameDocument(context.documentKey);
  context.manifest = checked.manifest;
  context.snapshot = checked.snapshot;
  if (checked.issues.length) {
    const error = new Error(`图片命名检查未通过，共 ${checked.issues.length} 处。`);
    error.issues = checked.issues;
    throw error;
  }
  const source = Psd2Ui.prepareSourceManifest(checked.manifest, checked.snapshot);
  context.manifest = source.manifest;
  const preflight = Psd2Ui.preflightBundle(source.manifest, checked.snapshot);
  if (preflight.status !== 'ready') {
    const error = new Error(`组件或资源预检未通过，共 ${preflight.issues.length} 处。`);
    error.issues = preflight.issues;
    throw error;
  }
  return prepareBundle(source.manifest);
}

function combineDiagnostics(...groups) {
  const result = [];
  const seen = new Set();
  groups.forEach((group) => (group || []).forEach((entry) => {
    const key = [entry.severity, entry.code, entry.nodeId, entry.message].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  }));
  return result;
}

function normalizeNativePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function requireExpectedDocumentPath(expectedDocumentPath) {
  const expected = String(expectedDocumentPath || '').trim();
  if (!expected) throw new Error('PS-MCP 写操作必须提供 expectedDocumentPath。');
  const info = getDocumentInfo();
  if (normalizeNativePath(info.path) !== normalizeNativePath(expected)) {
    throw new Error(`当前 Photoshop 文档不是预期目标。预期：${expected}；实际：${info.path}`);
  }
  return info;
}

function summarizeLayer(layer) {
  const bounds = layer && layer.bounds;
  const number = (value) => {
    const parsed = Number(value && value.value != null ? value.value : value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    id: String(layer.id),
    name: String(layer.name || ''),
    kind: String(layer.kind || ''),
    visible: layer.visible !== false,
    childCount: layer.layers ? layer.layers.length : 0,
    bounds: bounds ? {
      left: number(bounds.left),
      top: number(bounds.top),
      right: number(bounds.right),
      bottom: number(bounds.bottom)
    } : null
  };
}

async function inspectForAutomation(options) {
  const key = documentKey();
  const document = requireDocument();
  const documentInfo = options && options.expectedDocumentPath
    ? requireExpectedDocumentPath(options.expectedDocumentPath)
    : getDocumentInfo();
  const manifest = await readManifest();
  const sidecar = await readSidecarManifest(document);
  requireSameDocument(key);
  let activeLayers = [];
  try {
    activeLayers = getActiveLayersInfo().map((entry) => summarizeLayer(entry.layer));
  } catch (error) {
    activeLayers = [];
  }
  return {
    document: documentInfo,
    activeLayers,
    topLevelLayers: Array.from(document.layers || []).map(summarizeLayer),
    manifest: manifest ? {
      ...manifest,
      nodeCount: Object.keys(manifest.nodes || {}).length,
      resourceCount: Object.keys(
        manifest.resourceRegistry && manifest.resourceRegistry.resources || {}).length
    } : null,
    sidecar: { path: sidecar.path, exists: Boolean(sidecar.manifest) },
    exportSettings: { uiResPath: currentUiResFolder && currentUiResFolder.nativePath || null,
      source: 'loaded-plugin-preference', scope: 'global' }
  };
}

async function initializeForAutomation(options) {
  const input = options || {};
  const documentInfo = requireExpectedDocumentPath(input.expectedDocumentPath);
  const existingManifest = await readManifest();
  if (existingManifest && input.allowReinitialize !== true) {
    throw new Error('当前 PSD 已经初始化；如需覆盖必须显式提供 allowReinitialize=true。');
  }
  const rootLayerId = String(input.rootLayerId || 'document-root').trim();
  const document = requireDocument();
  const root = rootLayerId === 'document-root' ? { name: documentInfo.name }
    : findLayerById(document.layers || [], rootLayerId);
  if (!root) throw new Error(`当前 PSD 中找不到初始化根图层 ${rootLayerId || '<empty>'}。`);
  const snapshot = createSnapshot(rootLayerId);
  const result = await executeWithContext('initialize-document', {
    resourceNaming: 'source',
    module: input.module,
    submodule: input.submodule,
    name: input.name || documentInfo.name,
    width: documentInfo.width,
    height: documentInfo.height,
    rootLayerId,
    rootLayerName: String(root.name || input.name || documentInfo.name),
    snapshot
  }, McpContext);
  return {
    document: result.value,
    initializedNodeCount: Object.keys(result.manifest.nodes || {}).length,
    sidecarPath: result.writeResult.sidecarPath
  };
}

async function executeForAutomation(options) {
  const input = options || {};
  requireExpectedDocumentPath(input.expectedDocumentPath);
  if (!['set-visual-states', 'set-collection-previews', 'set-node-viewport'].includes(input.command)) {
    return executeWithContext(input.command, input.input || {}, McpContext);
  }
  const key = documentKey();
  const current = await readManifest();
  requireSameDocument(key);
  if (!current) throw new Error('请先初始化当前 PSD 文档。');
  const commandInput = { ...(input.input || {}) };
  const snapshot = createSnapshot(current.document.rootLayerId);
  const root = withAuthoringState([snapshot.root], current)[0];
  const target = findSnapshotLayer([root], commandInput.layerId);
  if (!target) throw new Error(`当前配置根内找不到图层 ${commandInput.layerId || '<empty>'}。`);
  if (input.command === 'set-visual-states') {
    if (!Psd2Ui.isGroupLayer(target)) throw new Error('视觉状态只能配置在 Photoshop 组上。');
    if (!Object.prototype.hasOwnProperty.call(commandInput, 'visualStates')) {
      throw new Error('必须提供 visualStates；清除配置时显式传 null。');
    }
    commandInput.visualStates = commandInput.visualStates === null
      ? null : Psd2Ui.planVisualStates(target, commandInput.visualStates);
  } else if (input.command === 'set-collection-previews') {
    commandInput.snapshot = snapshot;
  } else {
    if (!Object.prototype.hasOwnProperty.call(commandInput, 'viewport')) {
      throw new Error('必须提供 viewport；清除配置时显式传 null。');
    }
    commandInput.sourceBounds = target.bounds;
  }
  const result = Psd2Ui.executeAuthoringCommand(current, {
    command: input.command, input: commandInput
  }, McpContext);
  const checked = Psd2Ui.prepareManifestForExport(result.manifest, snapshot, { allocateResources: false });
  const targetId = checked.manifest.nodes[String(commandInput.layerId)].id;
  const issues = checked.diagnostics.filter((entry) => entry.severity === 'error' && entry.nodeId === targetId
    && /^PSD2UI_(VISUAL_STATE|VIEWPORT)/.test(entry.code));
  if (issues.length) {
    const error = new Error('当前图层配置不可用；本次尚未保存。');
    error.issues = issues;
    throw error;
  }
  requireSameDocument(key);
  const persisted = await persistManifest(result.manifest, null, McpContext);
  return { manifest: persisted.manifest, value: persisted.manifest.nodes[String(commandInput.layerId)],
    writeResult: persisted.writeResult };
}

async function applyConfirmedPreinitializeRenamesForAutomation(options) {
  const input = options || {};
  requireExpectedDocumentPath(input.expectedDocumentPath);
  if (input.confirmationText !== 'APPLY_CONFIRMED_PREINITIALIZE_RENAMES') {
    throw new Error('初始化前重命名计划缺少当前用户确认标记。');
  }
  const plan = input.plan;
  const confirmationId = String(plan && plan.confirmationId || '').trim();
  if (!confirmationId || confirmationId !== String(input.confirmationId || '').trim()) {
    throw new Error('初始化前重命名计划 confirmationId 与调用确认不一致。');
  }
  const current = await readManifest();
  const repairPreservedState = input.repairPreservedState === true;
  if (current && !repairPreservedState) {
    throw new Error('当前 PSD 已经初始化，不允许再执行初始化前重命名。');
  }
  if (!current && repairPreservedState) {
    throw new Error('当前 PSD 尚未初始化，不需要执行初始化前状态恢复。');
  }
  return applyConfirmedPreinitializeRenames(plan, input.rootLayerId, {
    repairPreservedState
  });
}

function assertNoNewStructuralEditIssues(baseline, prepared, edits) {
  const structuralErrors = (diagnostics) => (diagnostics || []).filter((entry) => entry.severity === 'error'
    && /^PSD2UI_(STRUCTURE|VISUAL_STATE|VIEWPORT)/.test(entry.code));
  const issueKey = (entry) => JSON.stringify([entry.code || '', entry.nodeId || '', entry.message || '']);
  const existing = new Set(structuralErrors(baseline.diagnostics).map(issueKey));
  const issues = structuralErrors(prepared.diagnostics).filter((entry) => !existing.has(issueKey(entry)));
  const deletedIds = new Set();
  (edits || []).filter((entry) => entry.operation === 'delete').forEach((entry) => {
    [entry.layerId, ...(entry.descendantIds || [])].forEach((id) => deletedIds.add(String(id)));
  });
  Object.keys(baseline.manifest.nodes || {}).forEach((layerId) => {
    const before = baseline.manifest.nodes[layerId];
    if (!before.structure && !before.visualStates && !before.viewport) return;
    const after = prepared.manifest.nodes[layerId];
    if (!after) {
      // Deleting an entire component removes its owned references legitimately.
      // Moving it out of the configured root or ungrouping its owner must not
      // silently discard authoring settings through Core's reconciliation.
      if (!deletedIds.has(String(layerId))) issues.push({ severity: 'error',
        code: 'PSD2UI_STRUCTURE_OWNER_REMOVED', nodeId: before.id || '',
        message: `组件 '${before.name || layerId}' 的配置根已消失或移出当前导出根，但计划没有删除该组件。` });
      return;
    }
    // Core intentionally prunes missing previews during ordinary reconciliation.
    // An AI edit must preserve a surviving owner's previously valid references.
    const previews = new Set((after.structure && after.structure.previewLayerIds || []).map(String));
    (before.structure && before.structure.previewLayerIds || []).forEach((id) => {
      if (!previews.has(String(id))) issues.push({ severity: 'error',
        code: 'PSD2UI_STRUCTURE_PREVIEW_REMOVED', nodeId: before.id || '',
        message: `组件 '${before.name || layerId}' 的仅预览引用图层 ${id} 被本次结构操作移除。` });
    });
  });
  if (issues.length) {
    const error = new Error('结构操作新增了组件引用或布局错误，已停止保存并请求恢复图层树。');
    error.code = 'PSD2UI_STRUCTURE_EDIT_INVALID';
    error.issues = issues;
    throw error;
  }
}

async function applyConfirmedStructurePlanForAutomation(options) {
  const input = options || {};
  requireExpectedDocumentPath(input.expectedDocumentPath);
  if (input.confirmationText !== 'APPLY_CONFIRMED_STRUCTURE_PLAN') {
    throw new Error('结构计划缺少当前用户确认标记。');
  }
  const plan = input.plan;
  const confirmationId = String(plan && plan.confirmationId || '').trim();
  if (!confirmationId || confirmationId !== String(input.confirmationId || '').trim()) {
    throw new Error('结构计划 confirmationId 与调用确认不一致。');
  }
  const current = await readManifest();
  if (!current) throw new Error('请先初始化当前 PSD 文档。');
  const context = { actor: 'human-approved-plan', confirmationId };
  const hasEdits = ['moves', 'ungroups', 'deletes'].some((key) => Array.isArray(plan[key]) && plan[key].length);
  // Read the complete configured tree before any mutation. Preparation returns a
  // copy, so existing diagnostics and reconciled node IDs become a read-only
  // baseline without saving or broadening the gate to legacy plan operations.
  const baseline = hasEdits ? Psd2Ui.prepareManifestForExport(current,
    createSnapshot(current.document.rootLayerId), { allocateResources: false }) : null;

  return runDocumentMutationWithManifestRollback(current, (persistInMutation) =>
    applyConfirmedStructurePlan(plan, async (applied) => {
      const snapshot = createSnapshot(current.document.rootLayerId);
      let prepared = Psd2Ui.prepareManifestForExport(baseline ? baseline.manifest : current, snapshot, {
        allocateResources: false
      });
      let manifest = prepared.manifest;

      for (const container of applied.containers) {
        manifest = Psd2Ui.executeAuthoringCommand(manifest, {
          command: 'apply-node-preset',
          input: { layerId: container.layerId, name: container.name, semantic: 'group' }
        }, McpContext).manifest;
      }
      for (const structured of applied.structured) {
        manifest = Psd2Ui.executeAuthoringCommand(manifest, {
          command: 'apply-structured-group',
          input: structured
        }, context).manifest;
      }
      for (const preset of applied.presets) {
        manifest = Psd2Ui.executeAuthoringCommand(manifest, {
          command: 'apply-node-preset',
          input: preset
        }, McpContext).manifest;
      }

      manifest = Psd2Ui.prepareManifestForExport(manifest, snapshot, {
        allocateResources: false
      }).manifest;
      for (const copy of applied.copies) {
        const registry = manifest.resourceRegistry || {};
        const sourceResourceId = (registry.layerBindings || {})[copy.sourceLayerId];
        if (!sourceResourceId) {
          throw new Error(`复制图层 ${copy.layerId} 的来源 ${copy.sourceLayerId} 没有可复用资源。`);
        }
        manifest = Psd2Ui.executeAuthoringCommand(manifest, {
          command: 'reuse-resource',
          input: { layerId: copy.layerId, resourceId: sourceResourceId }
        }, McpContext).manifest;
      }

      prepared = Psd2Ui.prepareManifestForExport(manifest, snapshot);
      if (baseline) assertNoNewStructuralEditIssues(baseline, prepared, applied.edits);
      const persisted = await persistInMutation(prepared.manifest, context);
      return {
        confirmationId,
        copies: applied.copies,
        edits: applied.edits || [],
        containers: applied.containers,
        structured: applied.structured.map((entry) => ({
          layerId: entry.layerId,
          name: entry.name,
          semantic: entry.semantic,
          roles: entry.structure.roles
        })),
        presets: applied.presets,
        nodeCount: Object.keys(persisted.manifest.nodes || {}).length,
        resourceCount: Object.keys(
          persisted.manifest.resourceRegistry && persisted.manifest.resourceRegistry.resources || {}).length,
        diagnostics: combineDiagnostics(prepared.diagnostics, persisted.diagnostics),
        reconciliation: persisted.reconciliation,
        sidecarPath: persisted.writeResult.sidecarPath
      };
    }));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalJson(value[key]);
    return result;
  }, {});
}

function assertJsonEqual(actual, expected, label) {
  if (JSON.stringify(canonicalJson(actual)) !== JSON.stringify(canonicalJson(expected))) {
    throw new Error(`${label}不一致，已停止迁移。`);
  }
}

function assertScalarEqual(actual, expected, label) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}不一致；计划为 '${expected}'，当前为 '${actual}'。`);
  }
}

function localActiveResources(manifest) {
  const moduleName = manifest && manifest.document && manifest.document.module;
  return Object.values(manifest && manifest.resourceRegistry
    && manifest.resourceRegistry.resources || {}).filter((resource) => resource
      && resource.status === 'active'
      && resource.module === moduleName
      && resource.scope === 'module');
}

function validateConfirmedSubmoduleMigrationPlan(manifest, sidecarManifest, plan) {
  if (!plan || plan.version !== 1 || typeof plan !== 'object') {
    throw new Error('submodule 迁移计划必须是 version=1 的对象。');
  }
  const expected = plan.expected;
  if (!expected || typeof expected !== 'object') {
    throw new Error('submodule 迁移计划缺少 expected 前置条件。');
  }
  const targetSubmodule = String(plan.submodule || '').trim();
  if (!targetSubmodule) throw new Error('submodule 迁移计划缺少目标 submodule。');
  if (!manifest) throw new Error('当前 PSD 尚未初始化，不能执行 submodule 迁移。');
  if (!sidecarManifest) throw new Error('当前 PSD 缺少同目录配置镜像，不能执行事务迁移。');
  assertJsonEqual(sidecarManifest, manifest, 'PSD XMP 与同目录配置镜像');
  Psd2Ui.assertManifestValid(manifest);

  assertScalarEqual(manifest.manifestVersion, expected.manifestVersion, 'manifestVersion');
  assertScalarEqual(manifest.revision, expected.revision, 'revision');
  assertScalarEqual(manifest.document.id, expected.documentId, 'document.id');
  assertScalarEqual(manifest.document.name, expected.documentName, 'document.name');
  assertScalarEqual(manifest.document.module, expected.module, 'document.module');
  assertScalarEqual(manifest.document.rootLayerId, expected.rootLayerId, 'document.rootLayerId');
  if (manifest.document.submodule != null) {
    throw new Error(`当前 PSD 已有 submodule '${manifest.document.submodule}'，不能重复执行一次性迁移。`);
  }

  const resources = Object.values(manifest.resourceRegistry.resources || {});
  const active = resources.filter((resource) => resource && resource.status === 'active');
  const local = localActiveResources(manifest);
  assertScalarEqual(Object.keys(manifest.nodes || {}).length, expected.nodeCount, 'nodeCount');
  assertScalarEqual(resources.length, expected.resourceCount, 'resourceCount');
  assertScalarEqual(active.length, expected.activeResourceCount, 'activeResourceCount');
  if (active.length !== local.length) {
    throw new Error('当前 PSD 存在 Common、跨模块或非 module scope 的活动资源，不能执行文档级 submodule 迁移。');
  }
  assertJsonEqual(manifest.resourceRegistry.counters || {}, expected.counters || {}, '资源计数器前置条件');
  return { expected, targetSubmodule, resources, active };
}

function migrationInvariant(manifest, targetSubmodule) {
  const snapshot = JSON.parse(JSON.stringify(manifest));
  const moduleName = snapshot.document.module;
  delete snapshot.manifestVersion;
  delete snapshot.revision;
  delete snapshot.document.submodule;
  Object.values(snapshot.resourceRegistry.resources || {}).forEach((resource) => {
    if (!resource
        || resource.status !== 'active'
        || resource.module !== moduleName
        || resource.scope !== 'module') return;
    delete resource.submodule;
    delete resource.fileName;
    delete resource.history;
  });
  Object.keys(snapshot.resourceRegistry.counters || {}).forEach((key) => {
    if (key.startsWith(`${moduleName}|${targetSubmodule}|`)) {
      delete snapshot.resourceRegistry.counters[key];
    }
  });
  return snapshot;
}

function assertConfirmedSubmoduleMigrationResult(before, after, planState) {
  const { targetSubmodule } = planState;
  const moduleName = before.document.module;
  assertScalarEqual(after.manifestVersion, '1.1.0', '迁移后的 manifestVersion');
  assertScalarEqual(after.revision, Number(before.revision) + 1, '迁移后的 revision');
  assertScalarEqual(after.document.submodule, targetSubmodule, '迁移后的 document.submodule');
  assertJsonEqual(
    migrationInvariant(after, targetSubmodule),
    migrationInvariant(before, targetSubmodule),
    'submodule 迁移白名单之外的 Manifest 内容');

  const beforeResources = before.resourceRegistry.resources || {};
  const afterResources = after.resourceRegistry.resources || {};
  const migrated = localActiveResources(before);
  migrated.forEach((resource) => {
    const current = afterResources[resource.id];
    if (!current) throw new Error(`迁移后丢失资源 ${resource.id}。`);
    assertScalarEqual(current.submodule, targetSubmodule, `资源 ${resource.id}.submodule`);
    const marker = resource.kind === 'sprite' ? 'sp' : 'tex';
    const expectedFileName = `${moduleName}_${targetSubmodule}_${marker}_${String(resource.number).padStart(4, '0')}.png`;
    assertScalarEqual(current.fileName, expectedFileName, `资源 ${resource.id}.fileName`);
    const previousHistory = Array.isArray(resource.history) ? resource.history : [];
    const currentHistory = Array.isArray(current.history) ? current.history : [];
    if (currentHistory.length !== previousHistory.length + 1) {
      throw new Error(`资源 ${resource.id}.history 没有只追加一条迁移记录。`);
    }
    assertJsonEqual(currentHistory.slice(0, previousHistory.length), previousHistory,
      `资源 ${resource.id}.history 既有记录`);
    const appended = currentHistory[currentHistory.length - 1];
    assertJsonEqual(appended, {
      module: resource.module,
      kind: resource.kind,
      number: resource.number,
      fileName: resource.fileName,
      reason: 'confirmed-document-submodule-migration'
    }, `资源 ${resource.id}.history 新迁移记录`);
  });

  const expectedCounters = { ...(before.resourceRegistry.counters || {}) };
  ['sprite', 'texture'].forEach((kind) => {
    const numbers = Object.values(beforeResources).filter((resource) => resource
      && resource.module === moduleName
      && resource.kind === kind
      && Number.isInteger(resource.number)).map((resource) => resource.number);
    if (numbers.length === 0) return;
    const legacyKey = `${moduleName}|${kind}`;
    const namespacedKey = `${moduleName}|${targetSubmodule}|${kind}`;
    const legacyNext = Number.isInteger(expectedCounters[legacyKey])
      ? expectedCounters[legacyKey]
      : 1;
    expectedCounters[namespacedKey] = Math.max(legacyNext, Math.max(...numbers) + 1);
  });
  assertJsonEqual(after.resourceRegistry.counters || {}, expectedCounters, '迁移后的资源计数器');
}

async function assertPersistedManifest(expectedManifest, document, phase) {
  const xmpManifest = await readManifest();
  const sidecar = await readSidecarManifest(document);
  if (!sidecar.manifest) throw new Error(`${phase}同目录配置镜像不可读。`);
  assertJsonEqual(xmpManifest, expectedManifest, `${phase}PSD XMP`);
  assertJsonEqual(sidecar.manifest, expectedManifest, `${phase}同目录配置镜像`);
}

async function applyConfirmedSubmoduleMigrationForAutomation(options) {
  const input = options || {};
  requireExpectedDocumentPath(input.expectedDocumentPath);
  if (input.confirmationText !== 'APPLY_CONFIRMED_SUBMODULE_MIGRATION') {
    throw new Error('submodule 迁移计划缺少当前用户确认标记。');
  }
  const plan = input.plan;
  const confirmationId = String(plan && plan.confirmationId || '').trim();
  if (!confirmationId || confirmationId !== String(input.confirmationId || '').trim()) {
    throw new Error('submodule 迁移计划 confirmationId 与调用确认不一致。');
  }

  const document = requireDocument();
  const originalXmp = await getDocumentXmp();
  const originalSidecar = await readSidecarRaw(document);
  const current = await readManifest();
  const sidecar = await readSidecarManifest(document);
  if (await getDocumentXmp() !== originalXmp) {
    throw new Error('读取迁移前置条件时 PSD XMP 发生变化，请重试。');
  }
  const planState = validateConfirmedSubmoduleMigrationPlan(current, sidecar.manifest, plan);
  const context = { actor: 'human-approved-plan', confirmationId };
  const result = Psd2Ui.executeAuthoringCommand(current, {
    command: 'set-document-submodule',
    input: {
      submodule: planState.targetSubmodule,
      reason: 'confirmed-document-submodule-migration'
    }
  }, context);
  assertConfirmedSubmoduleMigrationResult(current, result.manifest, planState);

  return photoshopCore.executeAsModal(async (executionContext) => {
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: document.id,
      name: `PSD2UI：迁移 submodule ${planState.targetSubmodule}`
    });
    let historyOpen = true;
    try {
      const writeResult = await writeManifestInCurrentModal(result.manifest, false);
      await assertPersistedManifest(result.manifest, document, '保存前');
      await document.save();
      await assertPersistedManifest(result.manifest, document, '保存后');
      await executionContext.hostControl.resumeHistory(suspension, true);
      historyOpen = false;
      return {
        confirmationId,
        documentId: result.manifest.document.id,
        module: result.manifest.document.module,
        submodule: result.manifest.document.submodule,
        revision: result.manifest.revision,
        migratedResourceCount: result.value.migratedResources.length,
        sidecarPath: writeResult.sidecarPath
      };
    } catch (error) {
      const rollbackErrors = [];
      if (historyOpen) {
        try {
          await executionContext.hostControl.resumeHistory(suspension, false);
          historyOpen = false;
        } catch (rollbackError) {
          rollbackErrors.push(`Photoshop History：${formatError(rollbackError)}`);
        }
      }
      try { await setDocumentXmp(originalXmp); } catch (rollbackError) {
        rollbackErrors.push(`PSD XMP：${formatError(rollbackError)}`);
      }
      try { await restoreSidecarRaw(originalSidecar); } catch (rollbackError) {
        rollbackErrors.push(`同目录配置镜像：${formatError(rollbackError)}`);
      }
      try { await document.save(); } catch (rollbackError) {
        rollbackErrors.push(`PSD 保存：${formatError(rollbackError)}`);
      }
      try {
        if (await getDocumentXmp() !== originalXmp) {
          throw new Error('恢复后的原始 XMP 字节不一致。');
        }
        const restoredSidecar = await readSidecarRaw(document);
        assertJsonEqual(restoredSidecar, originalSidecar, '恢复后的同目录配置镜像');
        await assertPersistedManifest(current, document, '回滚后');
      } catch (rollbackError) {
        rollbackErrors.push(`回滚读回：${formatError(rollbackError)}`);
      }
      if (rollbackErrors.length > 0) {
        throw new Error(`${formatError(error)}\n事务回滚失败：${rollbackErrors.join('；')}`);
      }
      throw error;
    }
  }, { commandName: `PSD2UI：迁移 submodule ${planState.targetSubmodule}` });
}

async function preflightForAutomation(options) {
  requireExpectedDocumentPath(options && options.expectedDocumentPath);
  const prepared = await prepareCurrentDocumentForExport();
  return {
    document: prepared.bundle.document,
    diagnostics: combineDiagnostics(
      prepared.preparationDiagnostics,
      prepared.bundle.diagnostics),
    reconciliation: prepared.reconciliation,
    resources: prepared.bundle.resources.map((resource) => ({
      fileName: resource.fileName,
      sourceLayerId: resource.sourceLayerId,
      sliceBorder: resource.sliceBorder || null
    }))
  };
}

async function exportForAutomation(options) {
  const input = options || {};
  requireExpectedDocumentPath(input.expectedDocumentPath);
  if (!String(input.uiResPath || '').trim()) {
    throw new Error('PS-MCP 导出必须显式提供已授权的 UIRes 路径。');
  }
  const prepared = await prepareCurrentDocumentForExport();
  const persisted = await persistManifest(prepared.manifest, null, McpContext);
  const result = await writeBundle(prepared.bundle, { uiResPath: input.uiResPath });
  return {
    ...result,
    diagnostics: combineDiagnostics(
      prepared.preparationDiagnostics,
      prepared.bundle.diagnostics),
    reconciliation: prepared.reconciliation,
    sidecarPath: persisted.writeResult.sidecarPath
  };
}

function installDeveloperAutomation() {
  const automation = Object.freeze({
    openDocument: async (options) => openLocalDocument(options && options.documentPath),
    inspect: inspectForAutomation,
    wrapDocumentRoot: async (options) => {
      const input = options || {};
      requireExpectedDocumentPath(input.expectedDocumentPath);
      return wrapTopLevelLayersInGroup(input.layerIds, input.groupName);
    },
    snapshot: async (options) => {
      requireExpectedDocumentPath(options && options.expectedDocumentPath);
      return createSnapshot(options && options.rootLayerId);
    },
    initialize: initializeForAutomation,
    applyConfirmedPreinitializeRenames: applyConfirmedPreinitializeRenamesForAutomation,
    applyConfirmedStructurePlan: applyConfirmedStructurePlanForAutomation,
    applyConfirmedSubmoduleMigration: applyConfirmedSubmoduleMigrationForAutomation,
    execute: executeForAutomation,
    preflight: preflightForAutomation,
    exportBundle: exportForAutomation
  });
  globalThis.__PSD2UI_DEV__ = automation;
  globalThis.__YOYO_PSD2UI_DEV__ = automation;
  globalThis.__PSD2UI_BUSY__ = () => operationRunning;
  // AI and artist actions share one writer. Read-only automation does not run
  // the panel's refresh/initialization or restore a visual preview implicitly.
  globalThis.__PSD2UI_RUN__ = async (label, callback) => {
    if (operationRunning) throw new Error('PSD2UI 正在执行其他操作，请等待完成。');
    operationRunning = true;
    authoringRefreshVersion += 1;
    try { return await callback(); }
    finally { operationRunning = false; }
  };
}

element('clear-status').addEventListener('click', () => writeStatus('等待操作。'));
PanelShell.setPanelChangeHandler(handlePanelChanged);

element('semantic').addEventListener('change', () => {
  const semantic = element('semantic').value;
  setSemantic(semantic, true);
  renderComponentEditor(true);
  writeStatus(`已切换到 ${semantic}；不会修改 Photoshop 图层名。`, '已切换组件类型');
});
element('reset-image-defaults').addEventListener('click', () => {
  resetImageDefaults();
  writeStatus('图片参数已恢复默认值；尚未写入 PSD。', '已恢复图片默认值');
});
element('reset-text-defaults').addEventListener('click', () => {
  resetTextDefaults();
  writeStatus('fontKey 已恢复为 default；尚未写入 PSD。', '已恢复文本默认值');
});

element('refresh-context').addEventListener('click', () => run('刷新当前状态', refreshAuthoringState));
element('prepare-document').addEventListener('click', () => run('准备 PSD', prepareDocument));
element('wrap-document-root').addEventListener('click', () => run('建立根组', wrapDocumentRoot));
element('start-components').addEventListener('click', () => PanelShell.activatePanel('layer'));
element('go-prepare').addEventListener('click', () => PanelShell.activatePanel('prepare'));
element('return-to-component').addEventListener('click', async () => {
  if (!returnComponent || operationRunning) return;
  const target = returnComponent;
  const result = await run('返回组件', async () => {
    requireSameDocument(target.documentKey);
    await selectLayersById(target.layerIds);
    return { restored: true };
  });
  if (!result) return;
  // Finish the selection notification before restoring the unsaved role choices.
  if (selectionRefreshTimer != null) clearTimeout(selectionRefreshTimer);
  selectionRefreshTimer = null;
  selectionRefreshQueued = false;
  await refreshAuthoringState();
  setSemantic(target.semantic, false);
  renderComponentEditor(false);
  componentOptions = target.options;
  renderComponentEditor(true);
  returnComponent = null;
  showElement('return-to-component', false);
  writeStatus('已恢复刚才的角色选择；请点击保存组件配置。', '已返回组件，角色选择待保存');
});
element('sync-layer-tree').addEventListener('click', () => run('同步图层树到配置', syncLayerTreeToManifest));
element('read-document-name').addEventListener('click', () => run('读取界面名称', async () => {
  const info = getDocumentInfo();
  element('document-name').value = info.name;
  return { name: info.name, source: 'PSD 文件名' };
}));
element('use-layer-name').addEventListener('click', () => run('读取选中图层名', async () => {
  const layer = requireSingleSelection('读取选中图层名');
  element('document-name').value = layer.name;
  return { name: layer.name, source: '选中图层' };
}));
element('clear-document-name').addEventListener('click', () => {
  element('document-name').value = '';
  writeStatus('界面名称已清空；尚未写入 PSD。', '已清空界面名称');
});
element('select-uires').addEventListener('click', () => run('选择输出目录', async () => {
  const folder = await chooseUiResFolder();
  renderUiResFolder(folder);
  return { uiResPath: folder.nativePath };
}));
element('clear-uires').addEventListener('click', () => run('清除输出目录', async () => {
  clearRememberedUiResFolder();
  renderUiResFolder(null, '已清除；下次导出前必须重新选择目录。');
  return { cleared: true };
}));
element('document-module').addEventListener('input', () => { moduleInputDirty = true; });
element('normalize-module').addEventListener('click', () => run('规范模块名称', async () => normalizeModuleInput()));
element('normalize-submodule').addEventListener('click', () => run('规范 submodule', async () => normalizeSubmoduleInput()));
element('load-manifest').addEventListener('click', () => run('读取 PSD Manifest', async () => loadManifestIntoFields(true)));

element('initialize-document').addEventListener('click', () => run('初始化文档', async () => {
  if (await readManifest()) return prepareDocument();
  const documentInfo = getDocumentInfo();
  const root = requireSingleSelection('初始化文档根组');
  const snapshot = createSnapshot(root.id);
  const result = await execute('initialize-document', {
    resourceNaming: 'source',
    module: element('document-module').value || 'document',
    submodule: element('document-submodule').value,
    name: element('document-name').value || documentInfo.name,
    width: documentInfo.width,
    height: documentInfo.height,
    rootLayerId: root.id,
    rootLayerName: root.name,
    snapshot
  });
  await loadManifestIntoFields(true);
  const initializedNodes = result.manifest.nodes || {};
  const defaultSemanticCount = Object.keys(initializedNodes)
    .filter((layerId) => initializedNodes[layerId]
      && initializedNodes[layerId].authoringSource === 'default').length;
  return {
    document: result.value,
    initializedNodeCount: Object.keys(initializedNodes).length,
    defaultSemanticCount,
    sidecarPath: result.writeResult.sidecarPath
  };
}));

element('set-module').addEventListener('click', () => run('保存界面所属模块', saveDocumentModule));

element('set-submodule').addEventListener('click', () => run('更新 submodule', async () => {
  const manifest = await readManifest();
  if (!manifest) throw new Error('请先初始化当前 PSD 文档。');
  const activeResourceCount = Object.values(manifest.resourceRegistry
    && manifest.resourceRegistry.resources || {}).filter((resource) => resource
      && resource.status === 'active').length;
  if (activeResourceCount > 0) {
    throw new Error('当前 PSD 已有活动资源；请使用带精确前置条件和补偿回滚的已确认 submodule 迁移计划。');
  }
  const result = await execute('set-document-submodule', {
    submodule: element('document-submodule').value,
    reason: 'human-panel-document-submodule-migration'
  });
  await loadManifestIntoFields(true);
  return result.value;
}));

element('apply-preset').addEventListener('click', () => run('写入组件语义', applySelectedPreset));
element('structure-component').addEventListener('click', () => run('结构化当前组', structureSelectedComponent));
element('combine-component').addEventListener('click', () => run('组合为组件', combineSelectedComponent));
element('component-group-name').addEventListener('change', validateComponentDraft);
element('recalculate-component-layout').addEventListener('click', recalculateComponentLayout);
element('locate-selection-issue').addEventListener('click', () => run('定位组合问题', () => selectLayersById(selectionIssueLayerIds)));
element('image-type').addEventListener('change', updateSemanticOptions);
element('add-visual-state').addEventListener('click', () => {
  addVisualStateRow(null, visualStateInputs.length === 0);
  validateVisualStateDraft();
});
element('save-visual-states').addEventListener('click', () => run('保存视觉状态', saveVisualStates));
element('preview-visual-state').addEventListener('click', () => run('预览视觉状态', async () => {
  const value = Psd2Ui.planVisualStates(componentSelection[0], readVisualStates());
  return previewVisualState(value, element('visual-state-preview-choice').value);
}, { keepVisualPreview: true }));
element('restore-visual-state').addEventListener('click', () => run('恢复原可见性', restoreVisualStatePreview, { keepVisualPreview: true }));
element('batch-rename-selection').addEventListener('click', () => run('批量重命名所选图层', batchRenameSelectedLayers));

element('inspect-resource').addEventListener('click', () => run('读取资源绑定', inspectSelectedResource));
element('allocate-resource').addEventListener('click', () => run('分配组件资源', async () => {
  const manifest = await readManifest();
  if (!manifest) throw new Error('请先初始化当前 PSD 文档。');
  const layer = requireSingleSelection('分配组件资源');
  const node = manifest.nodes && manifest.nodes[layer.id];
  if (!node || (node.semantic !== 'image' && node.semantic !== 'raw-image')) {
    throw new Error('选中图层必须先写入 Image 或 Raw Image 语义。');
  }
  const result = await execute('allocate-resource', {
    layerId: layer.id,
    kind: node.semantic === 'raw-image' ? 'texture' : 'sprite'
  });
  await inspectSelectedResource();
  return result.value;
}));
element('reuse-resource').addEventListener('click', () => run('复用资源', async () => {
  const layer = requireSingleSelection('复用资源');
  const result = await execute('reuse-resource', {
    layerId: layer.id,
    resourceId: element('reuse-resource-id').value
  });
  await inspectSelectedResource();
  return result.value;
}));
element('promote-common').addEventListener('click', () => run('人工提升为 Common', async () => {
  const manifest = await readManifest();
  if (!manifest) throw new Error('请先初始化当前 PSD 文档。');
  const layer = requireSingleSelection('提升 Common 资源');
  const resourceId = manifest.resourceRegistry.layerBindings[layer.id];
  if (!resourceId) throw new Error('选中图层尚未绑定资源。');
  const resource = manifest.resourceRegistry.resources[resourceId];
  const submodule = String(element('migration-submodule').value || '').trim();
  if (manifest.document.submodule && !submodule) {
    throw new Error('提升为 Common 时必须填写 Common 下的目标 submodule。');
  }
  const result = await execute('promote-resource-to-common', {
    resourceId,
    submodule,
    kind: resource.kind
  });
  await inspectSelectedResource();
  return result.value;
}));
element('migrate-resource').addEventListener('click', () => run('人工迁移资源', async () => {
  const manifest = await readManifest();
  if (!manifest) throw new Error('请先初始化当前 PSD 文档。');
  const layer = requireSingleSelection('迁移资源');
  const resourceId = manifest.resourceRegistry.layerBindings[layer.id];
  if (!resourceId) throw new Error('选中图层尚未绑定资源。');
  const result = await execute('migrate-resource', {
    resourceId,
    module: element('migration-module').value,
    submodule: element('migration-submodule').value,
    kind: element('migration-kind').value,
    reason: 'human-panel-explicit-migration'
  });
  await inspectSelectedResource();
  return result.value;
}));
element('retire-resource').addEventListener('click', () => run('停用当前资源', async () => {
  const manifest = await readManifest();
  if (!manifest) throw new Error('请先初始化当前 PSD 文档。');
  const layer = requireSingleSelection('停用资源');
  const resourceId = manifest.resourceRegistry.layerBindings[layer.id];
  if (!resourceId) throw new Error('选中图层尚未绑定资源。');
  const result = await execute('retire-resource', { resourceId });
  await inspectSelectedResource();
  return result.value;
}));

element('check-image-names').addEventListener('click', () => run('图片命名检查', async () => {
  const result = await checkImageNames(false);
  return { status: result.status, issues: result.issues };
}));

function resourceKindSummary(bundle) {
  const sprites = bundle.resources.filter(resource => resource.kind === 'sprite').length;
  const textures = bundle.resources.filter(resource => resource.kind === 'texture').length;
  return `${sprites} 个 Sprite、${textures} 个 Texture`;
}

async function preflightCurrentDocument() {
  const prepared = await prepareCurrentDocumentForExport();
  const contentCheck = currentUiResFolder ? await verifyBundle(prepared.bundle, { uiResFolder: currentUiResFolder }) : null;
  const diagnostics = combineDiagnostics(
    prepared.preparationDiagnostics,
    prepared.bundle.diagnostics);
  const result = {
    issues: [],
    diagnostics,
    reconciliation: prepared.reconciliation,
    outputPath: currentUiResFolder && currentUiResFolder.nativePath || '',
    resources: prepared.bundle.resources.map((resource) => resource.fileName)
  };
  element('export-summary').textContent = `预检通过；${resourceKindSummary(prepared.bundle)}，${diagnostics.length} 条非阻断诊断。`
    + (contentCheck ? `已核对图片内容，${contentCheck.reusedResourceCount} 个公共资源可复用。` : '选择输出目录后可检查同名公共资源。');
  return result;
}

element('preflight').addEventListener('click', () => run('导出预检', preflightCurrentDocument, { reportPreflight: true }));
element('recheck-preflight').addEventListener('click', () => run('导出预检', preflightCurrentDocument, { reportPreflight: true }));

element('export-bundle').addEventListener('click', () => run('导出 JSON 与图片', async () => {
  preflightContext = { documentKey: documentKey(), manifest: null, snapshot: null };
  const uiResFolder = requireUiResFolder();
  const prepared = await prepareCurrentDocumentForExport();
  const persisted = await persistManifest(prepared.manifest);
  const result = await writeBundle(prepared.bundle, { uiResFolder });
  element('export-summary').textContent = `已导出 ${resourceKindSummary(prepared.bundle)}，复用 ${result.reusedResourceCount || 0} 个相同公共资源；${result.json}`;
  return {
    ...result,
    diagnostics: combineDiagnostics(
      prepared.preparationDiagnostics,
      prepared.bundle.diagnostics),
    reconciliation: prepared.reconciliation,
    sidecarPath: persisted.writeResult.sidecarPath
  };
}, { reportPreflight: true }));

let selectionRefreshTimer = null;
let selectionRefreshRunning = false;
let selectionRefreshQueued = false;

async function refreshAfterSelectionChange() {
  if (operationRunning) { scheduleSelectionRefresh(); return; }
  if (selectionRefreshRunning) {
    selectionRefreshQueued = true;
    return;
  }
  selectionRefreshRunning = true;
  try {
    do {
      selectionRefreshQueued = false;
      refreshContext();
      await refreshAuthoringState({ reuseDocument: true });
    } while (selectionRefreshQueued);
  } finally {
    selectionRefreshRunning = false;
  }
}

function scheduleSelectionRefresh() {
  selectionRefreshQueued = true;
  if (selectionRefreshTimer != null) clearTimeout(selectionRefreshTimer);
  selectionRefreshTimer = setTimeout(() => {
    selectionRefreshTimer = null;
    refreshAfterSelectionChange().catch((error) => {
      console.error('自动刷新 PSD2UI 图层状态失败，可使用“刷新当前状态”重试。', error);
    });
  }, 100);
}

async function enableSelectionRefresh() {
  await addSelectionChangeListener(scheduleSelectionRefresh);
}

function bootstrap() {
  resetImageDefaults();
  resetTextDefaults();
  setSemantic('image', false);
  setAdvancedResourceVisible(false);
  setStatusExpanded(false);
  PanelShell.activatePanel('prepare');
  refreshContext();
  refreshUiResFolder().catch((error) => {
    renderUiResFolder(null, `已保存的输出目录授权失效：${formatError(error)}`);
  });
  refreshAuthoringState().catch((error) => console.error('首次读取 PSD2UI 配置状态失败。', error));
  enableSelectionRefresh().catch((error) => {
    console.error('PSD2UI 无法监听 Photoshop 图层选择变化，将保留人工刷新入口。', error);
  });
  writeStatus(
    '按「准备 PSD → 配置组件 → 检查导出」完成交付。首次保存组件也会自动初始化。',
    '从准备 PSD 开始');
}

installDeveloperAutomation();
bootstrap();
