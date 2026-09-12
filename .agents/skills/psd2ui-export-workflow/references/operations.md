# PSD2UI 操作参考

本页描述当前分支的日常 MCP。工具名以下表为准；Core 里有某个命令，不代表 MCP 开放了它。宿主连接见 [connection.md](connection.md)。

## 日常工具

| 工具 | 主要输入 | 行为/结果 |
| --- | --- | --- |
| psd2ui_photoshop_status | checkOnly:true | 检查已有连接；无需打开 PSD |
| psd2ui_open_document | documentPath | 打开/激活 .psd，不保存或关闭其他文档 |
| psd2ui_inspect_document | expectedDocumentPath | 文档、完整已保存 manifest、镜像信息、导出目录 |
| psd2ui_snapshot | expectedDocumentPath, rootLayerId | 当前图层树；全树用 document-root |
| psd2ui_wrap_document_root | expectedDocumentPath, layerIds, groupName | 将明确列出的全部顶层层放进真实根组 |
| psd2ui_initialize_document | expectedDocumentPath, rootLayerId, module, name | 新文档初始化并保存 XMP/镜像/PSD |
| psd2ui_execute_authoring | expectedDocumentPath, command, input | 节点、参数、状态、预览、视口与资源配置 |
| psd2ui_apply_confirmed_structure_plan | expectedDocumentPath, confirmationId, confirmationText, plan | 已确认结构计划，返回新图层/组的真实 ID |
| psd2ui_preflight_export | expectedDocumentPath | 导出诊断；可能恢复状态预览，不用于确认前分析 |
| psd2ui_export_bundle | expectedDocumentPath, uiResPath | 保存 PSD/配置，检查并导出 JSON/PNG |

传入当前 PSD 的精确绝对路径，不能只依赖“当前打开的文档”。打开另一份 PSD 后不要沿用前一份的 layerId。inspect.exportSettings 的目录是插件偏好，不必然是当前任务授权的交付目录。

## 初始化与配置

未初始化时可以先读取全树。确认要保存配置后：

```json
{
  "expectedDocumentPath": "<PSD绝对路径>",
  "rootLayerId": "document-root",
  "module": "<已确认的界面模块>",
  "name": "<界面名称>"
}
```

以上是 psd2ui_initialize_document 的输入。document-root 是虚拟导出根，不会创建真实组。不传 allowReinitialize:true 来重置已有配置。已有文档更改 module 应使用面板的「保存所属模块」，日常 MCP 无对应入口。

psd2ui_execute_authoring 的 command 白名单：

- apply-node-preset
- update-node-parameters
- set-visual-states
- set-collection-previews
- set-node-viewport
- allocate-resource
- reuse-resource
- retire-resource

参数更新示例（图片已经配置为 image）：

```json
{
  "expectedDocumentPath": "<PSD绝对路径>",
  "command": "update-node-parameters",
  "input": {
    "layerId": "<快照中的图片层ID>",
    "parameters": { "image": { "raycast": "disabled" } }
  }
}
```

更换节点类型使用 apply-node-preset，input 包含 layerId、semantic、name。它会应用该类型的预设；调整一个既有参数时不要重新套预设。常见类型有 group、image、raw-image、text、button、input-field、toggle、list、grid、red-point、toggle-page-group、list-page-group、ignore。复杂组件还需角色/模板，不能只改 semantic 就报告配置完成。

需要实际字段时，读取工具根中的 Core/defaults.js、Core/validation.js 或现有 manifest；局部查询即可。例如终端在工具根执行以下只读命令：

```powershell
node -e "console.log(JSON.stringify(require('./Core/defaults').createPreset('image'), null, 2))"
```

image/raw-image/text/button 的补丁放在 parameters.image/rawImage/text/button 中。enabled/disabled 是契约值，不能用 Unity 属性名代替。不要把组件配置解释为已经接好运行时交互。

## 结构计划

结构修改使用 psd2ui_apply_confirmed_structure_plan，不能通过 execute_authoring 调用 apply-structured-group。外壳如下，具体操作数组按真实快照和当前宿主填写：

```json
{
  "expectedDocumentPath": "<PSD绝对路径>",
  "confirmationId": "<对应本次真实确认的标识>",
  "confirmationText": "APPLY_CONFIRMED_STRUCTURE_PLAN",
  "plan": {
    "version": 1,
    "confirmationId": "<与外层相同的标识>",
    "preconditions": [
      { "layerId": "<真实ID>", "name": "<当前原名>", "parentId": "<真实父级ID>" }
    ],
    "renames": [
      { "ref": "<同一真实ID>", "name": "<已确认的新名>" }
    ]
  }
}
```

不要原样提交占位符。preconditions 覆盖所有实际引用层，名字、父级及需要核对的几何来自当前快照。确认字符串只是接口格式，不能代替用户的授权。

containers 用 alias/name/members 创建普通组；groups 用于组件组合，adopt 配置已有组，presets 用于节点预设，copies/renames 用于确认过的复制/改名。计划形状较复杂时，只读工具根 Plus-ins/PSD2UI/src/photoshopDocument.js 中 validateConfirmedStructurePlan 与 applyConfirmedStructurePlan 的相应段落。

成组仅允许连续同级成员，并保留完整剪贴链。后续角色、状态等使用工具返回的真实组 ID；@alias 只在本次结构计划内解析，不能作为独立工具调用的 layerId。

本 CEP 分支还支持 moves/ungroups/deletes。每项必须声明 allowAppearanceChange:true；解组/删除还要列出准确的 expectedDescendantIds，叶子层为空数组。此声明要对应用户确认的外观变化，不自动添加。顶层前置条件可使用完整快照返回的 document-root。

### 给已有组配置按钮或列表

以下是 plan.adopt 的条目示例，用于保留已有组的层级。将它放入上面的确认外壳，并在 preconditions 中覆盖组件组、角色和预览的所有现有层。结构计划要求 PSD 已有 Manifest；不要将示例中的占位符当作实际 ID。

```json
{
  "adopt": [
    {
      "ref": "<已有按钮组ID>",
      "semantic": "button",
      "roles": [
        { "name": "background", "ref": "<该按钮内的底图ID>" },
        { "name": "label", "ref": "<该按钮内的文字ID>" }
      ]
    },
    {
      "ref": "<已有列表组ID>",
      "semantic": "list",
      "roles": [
        { "name": "item-template", "ref": "<完整条目组ID>" }
      ],
      "previewRefs": ["<同级展示条目组ID>"],
      "layout": {
        "direction": "vertical",
        "itemWidth": 320,
        "itemHeight": 80,
        "spacing": 12
      }
    }
  ]
}
```

320/80/12 仅用于展示字段形状，实际值取当前图层和已确认布局。先完成条目内的按钮，再配置外层列表。adopt 会写入该组件的完整结构；更新既有结构时保留仍需使用的角色、预览和布局，不能把上述片段当作局部补丁。

| 类型 | 角色名称 |
| --- | --- |
| button | background 必需，label 可选 |
| input-field | background、text 必需，placeholder 可选 |
| toggle | background、on-graphic 必需，label 可选 |
| list | item-template，指向完整条目组 |
| grid | cell-template，指向完整格子组 |

角色必须在所属组件内；已配置内部组件的根可以成为模板，其内部图层不能被外层组件直接占用。更多组件角色与布局约束按工具根 Core/structure.js 查询。

## 状态、预览与可视区域

- **视觉状态**：先建立已确认的普通状态组，再 execute_authoring → set-visual-states。input 为 layerId、visualStates；states 列出 name 与真实 layerId，defaultState 是其中一个 name。传 visualStates:null 清除配置。
- **仅预览条目**：set-collection-previews 的 input 为 layerId、previewLayerIds。保留 PSD 展示样例，但它们及其子树不成为正式导出节点；已有明确布局的预览不要求都与模板等高。不能把真实内容擅自标成预览。
- **独立视口**：set-node-viewport 的 input 为 layerId、viewport:{width,height}。视口尺寸与条目尺寸分别设置，不能用一个代替另一个。
- **列表/网格**：指定完整模板，明确哪些是预览，再配置方向/间距或格子/行列数。布局无法由图层确定时给出需要确认的字段，不猜测数据条数或业务页数。

视觉状态输入示例：

```json
{
  "expectedDocumentPath": "<PSD绝对路径>",
  "command": "set-visual-states",
  "input": {
    "layerId": "<组件或状态容器组ID>",
    "visualStates": {
      "defaultState": "normal",
      "states": [
        { "name": "normal", "layerId": "<普通状态组ID>" },
        { "name": "selected", "layerId": "<选中状态组ID>" }
      ]
    }
  }
}
```

## 导出及不能越过的边界

psd2ui_export_bundle 输入 expectedDocumentPath、uiResPath。导出内部检查命名、配置引用和共享图片冲突，并返回 json/folder/sidecarPath 等结果。不能把现有 authoring 镜像编辑成新的交付 JSON。

图片基础名决定资源模块；旧 @ 后缀不决定用途。组/文字允许中文，同名图片要比较实际像素与导出参数。九宫 PNG 已压缩可拉伸区域，仍保留原布局尺寸。初始化时指定的界面 module 与各张图片的 module 不是一回事。

当前日常 MCP 不开放已有文档 module 修改、任意 Photoshop JSX 执行、手绘新素材、任意滤镜编辑或 Unity 构建。两个旧维护工具默认隐藏，不为日常任务自动启用 --maintenance。
