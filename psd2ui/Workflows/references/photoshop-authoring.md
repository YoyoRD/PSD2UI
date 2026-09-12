# Photoshop 配置与导出调用参考

先读 [PS-MCP 环境与最小示例](../../PS-MCP/README.md)。当前是 UXP / CCX 分支，此分支通过 Adobe UDT 连接 UXP 插件，需要 PowerShell 7（pwsh）及运行中的 Photoshop/UDT。

## 输入与读取

- Portable 脚本按包位置定位。PSD 与交付目录来自当前任务，分别用 -AuthoringRoot 与 -UiResPath 明确传入。
- 先严格 Check，成功后 open_document(documentPath)、inspect_document(expectedDocumentPath)、snapshot(expectedDocumentPath, rootLayerId: "document-root")。
- inspect 返回完整已保存 Manifest；snapshot 读取完整实时图层树。不要为读取而初始化/保存 PSD，也不要把仅有摘要当完整树。
- 人工确认前不调用 preflight_export：宿主可能恢复状态预览，它不等同于纯只读分析。

## 确认后使用已有命令

| 操作 | 工具与关键输入 |
| --- | --- |
| 首次初始化 | psd2ui_initialize_document；expectedDocumentPath、rootLayerId、module、name，已有配置不重新初始化 |
| 节点类型或参数 | psd2ui_execute_authoring；expectedDocumentPath、command、input |
| 状态组、组件组合、复制与改名 | psd2ui_apply_confirmed_structure_plan；使用当前树真实 ID 和前置条件 |
| 视觉状态 | execute_authoring 的 set-visual-states；input 为 layerId、visualStates |
| 仅预览集合项 | set-collection-previews；input 为 layerId、previewLayerIds |
| 列表/网格可视区域 | set-node-viewport；input 为 layerId、viewport: {width, height} |
| 导出 | psd2ui_export_bundle；expectedDocumentPath、uiResPath |

准确工具参数见 [server.js](../../PS-MCP/src/server.js)，节点默认字段见 [Core/defaults.js](../../Core/defaults.js)，宿主能力见 [photoshopDocument.js](../../Plus-ins/PSD2UI/src/photoshopDocument.js)。只读取当前操作需要的字段，参数使用导出模型名称，不用 Unity C# 属性名。

例如设置一张已配置图片的 raycast：

```json
{
  "expectedDocumentPath": "<本次PSD绝对路径>",
  "command": "update-node-parameters",
  "input": {
    "layerId": "<真实图片层ID>",
    "parameters": { "image": { "raycast": "disabled" } }
  }
}
```

结构计划带 expectedDocumentPath、confirmationId、confirmationText: "APPLY_CONFIRMED_STRUCTURE_PLAN" 和 plan。plan 带 version: 1、同一 confirmationId、引用层的 preconditions；groups/containers/adopt 等操作必须按本分支真实实现构造。确认编号对应用户实际确认，不产生授权。用返回的真实组 ID 配置角色与状态，不把 @alias 当作 layerID。

本分支没有通用 move/reparent/reorder/ungroup/delete 入口。不要沿用 CEP 分支的 moves/ungroups/deletes 参数；需要这些修改时，先由人工或另行授权的 Photoshop 操作承接。

普通状态组先用 containers 创建，再按返回的真实 ID 调用 set-visual-states。已有集合的明确布局可使用 set-collection-previews 标记仅预览项；不能擅自把真实运行内容排除为预览，也不要求所有预览项与模板等高。

## 输出与停止条件

用户只要求配置则保存成功后结束；要求导出则直接 export_bundle，内部已有必要检查。报告本次 json、folder、sidecarPath 与问题；不为了清空诊断自动修改或重试，不声明视觉验收。

Check 失败需先独立准备 UDT/插件会话；日常工作流不通过自动重载绕过检查。

本流程到 JSON/PNG 为止；Unity 缺口见 [接入说明](../../../docs/UNITY-INTEGRATION.md)。
