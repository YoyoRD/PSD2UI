'use strict';

(function createPanelShell(global) {
  const PanelEntries = Object.freeze([
    Object.freeze({ name: 'prepare', tabId: 'tab-prepare', panelId: 'panel-prepare' }),
    Object.freeze({ name: 'layer', tabId: 'tab-layer', panelId: 'panel-layer' }),
    Object.freeze({ name: 'export', tabId: 'tab-export', panelId: 'panel-export' }),
    Object.freeze({ name: 'settings', tabId: 'tab-settings', panelId: 'panel-settings' })
  ]);
  const NoParametersPanel = 'options-no-parameters';
  const SemanticEntries = Object.freeze([
    Object.freeze({
      name: 'image', optionId: 'options-image', title: '图片 / Image',
      commit: '图片语义 + imageType/九宫',
      description: '图片的尺寸、颜色与透明度由 Photoshop 自动解析。'
    }),
    Object.freeze({
      name: 'raw-image', optionId: NoParametersPanel, title: '独立贴图 / Raw Image',
      commit: '独立贴图类型（无参数）',
      description: '使用独立纹理；未配置图片面积达到 512 × 512 px 或任一边超过 2040 px 时默认使用。'
    }),
    Object.freeze({
      name: 'text', optionId: 'options-text', title: '文本 / Text',
      commit: '文本语义 + fontKey',
      description: '文字内容、排版、渐变、描边和阴影从 Photoshop 读取。'
    }),
    Object.freeze({
      name: 'button', optionId: NoParametersPanel, title: '按钮 / Button',
      commit: '按钮语义（可结构化）',
      description: '指定按钮背景与可选文字；装饰和普通子组可以保留。'
    }),
    Object.freeze({
      name: 'input-field', optionId: NoParametersPanel, title: '输入框 / Input Field',
      commit: '输入框语义（可结构化）',
      description: '指定背景、输入文字及可选占位文字。'
    }),
    Object.freeze({
      name: 'toggle', optionId: NoParametersPanel, title: '开关 / Toggle',
      commit: '开关语义（可结构化）',
      description: '明确选择背景与开启图案，可加文字标签。'
    }),
    Object.freeze({
      name: 'list', optionId: NoParametersPanel, title: '列表 / List',
      commit: '列表语义（可结构化）',
      description: '指定条目模板、仅供预览的样例，以及方向、尺寸和间距。'
    }),
    Object.freeze({
      name: 'grid', optionId: NoParametersPanel, title: '网格 / Grid',
      commit: '网格语义（可结构化）',
      description: '指定单元格模板、预览样例和行列布局。'
    }),
    Object.freeze({
      name: 'red-point', optionId: NoParametersPanel, title: '红点 / Red Point',
      commit: '红点语义（无参数）',
      description: '标记红点图片；显示条件由项目程序配置。'
    }),
    Object.freeze({
      name: 'toggle-page-group', optionId: NoParametersPanel, title: '页签页面组 / Toggle Page Group',
      commit: '页签页面组语义（可结构化）',
      description: '组件组内至少有 1 个已经结构化的直属开关组；页面数据由项目代码提供。'
    }),
    Object.freeze({
      name: 'list-page-group', optionId: NoParametersPanel, title: '列表页面组 / List Page Group',
      commit: '列表页面组语义（可结构化）',
      description: '组件组内有 1 个已经结构化的直属列表组；业务页面数据由项目代码提供。'
    }),
    Object.freeze({
      name: 'ignore', optionId: 'options-ignore', title: '忽略子树 / Ignore',
      commit: '忽略子树',
      description: '选中图层及其全部子层不会进入导出的 UI Bundle。'
    })
  ]);
  const StructuredSemanticNames = Object.freeze([
    'button', 'input-field', 'toggle', 'list', 'grid',
    'toggle-page-group', 'list-page-group'
  ]);
  const OptionPanelIds = Object.freeze([
    'options-group', 'options-image', 'options-raw-image', 'options-text',
    'options-button', 'options-ignore', NoParametersPanel
  ]);
  let panelChangeHandler = null;
  let semanticAvailability = null;
  let semanticBlockedReason = '';
  const Guides = {
    button: {
      tree: '购买按钮  ← 选这个组\n├─ 按钮底图  → 背景\n├─ 购买文字  → 文字\n└─ 图标 / 光效  → 保留装饰',
      steps: ['选完整的「购买按钮」组，类型选「按钮」。', '把底图指定为背景，文字指定为标签，点击「保存组件配置」。', '切换到别的图层，再回来：当前类型应显示「按钮」。'],
      note: '只有一张按钮图片时，直接选图层、选按钮、保存当前图层即可。装饰不需要逐一分配角色。'
    },
    'input-field': {
      tree: '输入框  ← 选这个组\n├─ 底框  → 背景\n├─ 输入文字  → 输入文本\n└─ 请输入昵称  → 占位文本',
      steps: ['把底框和文字放在同一个输入框组内。', '选外组，类型选「输入框」，分别指定背景、输入文本和可选占位文本。', '保存组件配置；输入文字与占位文字使用两个不同文字层。'],
      note: '图片角色选图片，文本角色选 Photoshop 文字层。'
    },
    toggle: {
      tree: '声音开关  ← 选这个组\n├─ 底图  → 背景\n├─ 勾选图案  → 开启图案\n└─ 声音  → 文字',
      steps: ['先把开关的两种视觉元素拆成独立图层。', '选开关组，指定背景和开启图案，按需要指定文字。', '保存组件配置。一个可点击的列表条目不必都标成开关。'],
      note: '列表的单选、多选和点击行为由程序接入。'
    },
    list: {
      tree: '商品列表  ← 最后配置这个组\n├─ 商品条目  → 条目模板\n│  ├─ 图标 / 名称 / 价格\n│  └─ 购买按钮  → 先配内部按钮\n├─ 商品样例二  → 仅预览\n└─ 商品样例三  → 仅预览',
      steps: ['先选模板里的购买按钮，完成按钮配置。条目组可保留为普通组。', '回到「商品列表」外组，类型选「列表」，条目模板选「商品条目」。', '勾选其余重复条目为「仅预览样例」，填写方向、条目尺寸和间距，然后保存。'],
      note: '模板是重复内容的一整项，不是一张背景图。仅预览样例留在 PSD；列表的数据、点击和选中状态由程序接入。'
    },
    grid: {
      tree: '背包网格  ← 选这个组\n├─ 物品格  → 单元格模板\n│  ├─ 底框 / 物品图标\n│  └─ 数量文字\n├─ 格子样例二  → 仅预览\n└─ 格子样例三  → 仅预览',
      steps: ['把一整格的底框、图标和数量放进同一个模板组。', '选背包网格外组，类型选「网格」，指定单元格模板与预览样例。', '填写格子宽高、列数与间距，保存组件配置。'],
      note: '每个格子内部需要的按钮、红点先单独配置；模板内部不限制装饰数量。'
    },
    'toggle-page-group': {
      tree: '分类页签  ← 最后配置这个组\n├─ 装备页签  → 已配置的开关组\n└─ 材料页签  → 已配置的开关组',
      steps: ['先分别选每个页签，按「开关」指定背景与选中图案并保存。', '这些开关组应直接放在「分类页签」下面。', '选分类页签外组，类型选「页签页面组」，指定页签角色并保存。'],
      note: '页面内容、页签对应哪个页面和点击切换，由程序接入。'
    },
    'list-page-group': {
      tree: '动态分类  ← 最后配置这个组\n└─ 分类列表  → 已配置的列表组\n   ├─ 页签条目  → 条目模板\n   └─ 页签样例  → 仅预览',
      steps: ['先按「列表」完成分类列表的模板和布局配置。', '把该列表组直接放在动态分类组下。', '选动态分类外组，类型选「列表页面组」，指定内部列表并保存。'],
      note: '外层引用完整列表组件，内部的条目角色仍归列表管理。'
    },
    states: {
      tree: '奖励条目  ← 选这个组\n├─ 可领取  → normal\n├─ 未解锁  → locked\n└─ 已领取  → claimed',
      steps: ['每种完整外观单独建一个组，放在同一个条目组内。', '选择条目组，在「视觉状态」添加状态名称和对应组，并指定默认状态。', '保存状态配置，再选择状态预览；预览结束点击「恢复原可见性」。'],
      note: '状态名可自定义。预览是临时显示；运行时何时切换由程序接入。'
    }
  };

  function renderGuide() {
    const choice = element('component-guide-kind');
    const guide = Guides[choice && choice.value] || Guides.button;
    element('component-guide-tree').textContent = guide.tree;
    element('component-guide-note').textContent = guide.note;
    const steps = element('component-guide-steps');
    while (steps.firstChild) steps.removeChild(steps.firstChild);
    guide.steps.forEach((text, index) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'guide-step';
      paragraph.textContent = `${index + 1}. ${text}`;
      steps.appendChild(paragraph);
    });
  }

  function element(id) {
    return document.getElementById(id);
  }

  function requireEntry(entries, name, label) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) throw new Error(`${label} '${name}' 未注册。`);
    return entry;
  }

  function setClassState(target, className, enabled) {
    if (!target) return;
    if (enabled) target.classList.add(className);
    else target.classList.remove(className);
  }

  function activatePanel(panelName) {
    requireEntry(PanelEntries, panelName, '功能区');
    PanelEntries.forEach((entry) => {
      const active = entry.name === panelName;
      const tab = element(entry.tabId);
      const panel = element(entry.panelId);
      setClassState(tab, 'is-active', active);
      tab.setAttribute('aria-pressed', active ? 'true' : 'false');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      setClassState(panel, 'is-active', active);
    });
    element('app-shell').scrollTop = 0;
  }

  function setPanelChangeHandler(handler) {
    panelChangeHandler = typeof handler === 'function' ? handler : null;
  }

  function setStatusExpanded(expanded) {
    setClassState(element('status-content'), 'is-hidden', !expanded);
    element('status-toggle').setAttribute('aria-expanded', expanded ? 'true' : 'false');
    element('status-chevron').textContent = expanded ? '−' : '+';
    const shell = element('app-shell');
    if (shell.style) shell.style.bottom = expanded ? '220px' : '49px';
  }

  function setAdvancedResourceVisible(visible) {
    setClassState(element('advanced-resource-panel'), 'is-hidden', !visible);
  }

  function setInternalSettingsVisible(visible) {
    setClassState(element('internal-settings-panel'), 'is-hidden', !visible);
    const toggle = element('internal-settings-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
  }

  function updateSemanticOptions() {
    if (!element('semantic').value) {
      OptionPanelIds.forEach((id) => setClassState(element(id), 'is-hidden', true));
      element('semantic-summary-title').textContent = '未设置组件';
      element('semantic-summary-text').textContent = '普通组保留层级；未配置的空组自动跳过导出。需要组件时选择类型后再配置。';
      element('commit-semantic').textContent = '选择组件类型后配置';
      updateSemanticActionState();
      return;
    }
    const selectedEntry = requireEntry(SemanticEntries, element('semantic').value, '组件语义');
    OptionPanelIds.forEach((id) => setClassState(element(id), 'is-hidden', id !== selectedEntry.optionId));
    element('semantic-summary-title').textContent = selectedEntry.title;
    element('semantic-summary-text').textContent = selectedEntry.description;
    element('commit-semantic').textContent = `保存${selectedEntry.title.split('/')[0].trim()}配置`;
    updateSemanticActionState();
  }

  function updateSemanticActionState() {
    if (!semanticAvailability) return;
    const semantic = element('semantic').value;
    const state = semanticAvailability.find((entry) => entry.semantic === semantic);
    const hasExecutableAction = semanticAvailability.some((entry) => entry.canApply || entry.canStructure || entry.canConfigure);
    element('apply-preset').disabled = Boolean(semanticBlockedReason) || !state || !state.canApply;
    const configurable = state && (state.canConfigure || state.canStructure);
    element('structure-component').disabled = Boolean(semanticBlockedReason) || !configurable || Boolean(state.requiresGroup);
    const combine = element('combine-component');
    if (combine) combine.disabled = Boolean(semanticBlockedReason) || !configurable || !state.requiresGroup;
    setClassState(element('apply-preset'), 'is-hidden', !state || !state.canApply || Boolean(configurable));
    setClassState(element('structure-component'), 'is-hidden', !configurable || Boolean(state.requiresGroup));
    setClassState(combine, 'is-hidden', !configurable || !state.requiresGroup);
    let message = semanticBlockedReason;
    if (!message && !semantic) message = '尚未设置组件；选择类型后可查看配置要求。';
    if (!message && !hasExecutableAction && state && !state.currentStructuredRoot) {
      message = `当前选择不符合任何组件签名。${state.reason}`;
    }
    if (!message && state) message = state.reason;
    element('selection-constraint').textContent = message || '当前选择没有可执行的组件操作。';

    const structureStatus = element('structure-candidates');
    if (structureStatus) {
      const candidates = semanticAvailability.filter((entry) => entry.canConfigure || entry.canStructure);
      if (semanticBlockedReason) {
        structureStatus.textContent = semanticBlockedReason;
      } else if (candidates.length > 0) {
        const labels = candidates.map((candidate) => {
          const entry = requireEntry(SemanticEntries, candidate.semantic, '组件语义');
          return entry.title.split('/')[0].trim();
        });
        structureStatus.textContent = `可配置：${labels.join('、')}。`;
      } else {
        const structuredState = semanticAvailability.find((entry) =>
          StructuredSemanticNames.includes(entry.semantic) && entry.currentStructuredRoot)
          || semanticAvailability.find((entry) => StructuredSemanticNames.includes(entry.semantic));
        const reason = structuredState
          ? structuredState.structureReason || structuredState.reason
          : '请选择一个代表完整组件的 Photoshop 图层组。';
        structureStatus.textContent = `暂不可结构化：${reason}`;
      }
    }
  }

  function setSemanticAvailability(entries, preferredSemantic, blockedReason) {
    semanticAvailability = Array.isArray(entries) ? entries.slice() : [];
    semanticBlockedReason = String(blockedReason || '');
    SemanticEntries.forEach((entry) => {
      const state = semanticAvailability.find((candidate) => candidate.semantic === entry.name);
      const option = element(`semantic-option-${entry.name}`);
      if (option) option.disabled = !state || !state.enabled;
    });

    const preferredState = semanticAvailability.find((entry) => entry.semantic === preferredSemantic);
    const registeredPreferred = SemanticEntries.some((entry) => entry.name === preferredSemantic)
      && preferredState && preferredState.enabled;
    const currentSemantic = element('semantic').value;
    const currentState = semanticAvailability.find((entry) => entry.semantic === currentSemantic);
    const firstEnabled = semanticAvailability.find((entry) => entry.enabled);
    if (preferredSemantic === '' || preferredSemantic === 'group' || preferredSemantic === 'view') {
      element('semantic').value = '';
    } else if (registeredPreferred) {
      element('semantic').value = preferredSemantic;
    } else if (!currentState || !currentState.enabled) {
      element('semantic').value = firstEnabled
        ? firstEnabled.semantic
        : SemanticEntries[0].name;
    }
    updateSemanticOptions();
  }

  function setup() {
    PanelEntries.forEach((entry) => {
      element(entry.tabId).addEventListener('click', () => {
        activatePanel(entry.name);
        if (panelChangeHandler) {
          try {
            panelChangeHandler(entry.name);
          } catch (error) {
            console.error(`切换到 ${entry.name} 功能区后刷新 Photoshop 上下文失败。`, error);
          }
        }
      });
    });
    element('status-toggle').addEventListener('click', () => {
      const expanded = element('status-toggle').getAttribute('aria-expanded') === 'true';
      setStatusExpanded(!expanded);
    });
    element('advanced-resource-toggle').addEventListener('change', () => {
      setAdvancedResourceVisible(Boolean(element('advanced-resource-toggle').checked));
    });
    const internalToggle = element('internal-settings-toggle');
    if (internalToggle) internalToggle.addEventListener('click', () => {
      setInternalSettingsVisible(internalToggle.getAttribute('aria-expanded') !== 'true');
    });
    element('semantic').addEventListener('change', updateSemanticOptions);
    const guideToggle = element('component-guide-toggle');
    if (guideToggle) {
      guideToggle.addEventListener('click', () => {
        const expanded = guideToggle.getAttribute('aria-expanded') !== 'true';
        guideToggle.setAttribute('aria-expanded', String(expanded));
        setClassState(element('component-guide-content'), 'is-hidden', !expanded);
        element('component-guide-chevron').textContent = expanded ? '−' : '＋';
        renderGuide();
      });
      element('component-guide-kind').addEventListener('change', renderGuide);
    }
  }

  global.Psd2UiPanelShell = {
    PanelEntries,
    SemanticEntries,
    activatePanel,
    setPanelChangeHandler,
    setStatusExpanded,
    setAdvancedResourceVisible,
    setInternalSettingsVisible,
    updateSemanticOptions,
    setSemanticAvailability
  };
  setup();
}(window));
