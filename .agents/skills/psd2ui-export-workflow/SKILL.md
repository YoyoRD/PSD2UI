---
name: psd2ui-export-workflow
description: 使用 PSD2UI 中的 Photoshop 插件与可选 PS-MCP，分析 UI PSD、按确认方案配置图层并导出 JSON/PNG。适用于 CEP 或 CCX 分支；不包含 Unity Prefab 生成。
---

# PSD2UI 配置与导出

这是从原 component/fast workflow 提取的 Photoshop 部分。先从本仓库 [PS-MCP 说明](../../../psd2ui/PS-MCP/README.md) 确定当前分支的宿主和调用入口。面板可独立使用；缺少 MCP 连接时不假称可以自动操作 Photoshop。

- 输入：本次 PSD 绝对路径、允许的创作根、导出目录与任务终点。沿用本轮已明确的参数，只查缺项，不使用维护机器路径。
- 环境准备由接收方按 README 执行。工作流开始和断连恢复时只做一次严格 Check；检查失败即报告，不自动安装、启动、重载或修复。
- 未确认的 PSD 先 open、inspect，再读取 rootLayerId 为 document-root 的完整 snapshot，包含隐藏层和全部已有配置。输出当前结构、差异、拟改动与导出范围；确认前不初始化、修改、预检或导出。
- 同一 PSD 与方案在当前会话已确认时，直接继续未完成步骤，不重复确认。按 [调用参考](../../../psd2ui/Workflows/references/photoshop-authoring.md) 使用本分支已支持工具和真实返回 ID；不手写 sidecar，不从层名猜字段或生成任意宿主脚本。
- 只要求配置就在保存成功后结束；要求导出则直接 export_bundle，复用其内部检查，不另做一轮预检。不要因为诊断自行改名、去重、改工具源码或反复生成。
- 报错只报告原始问题和已有产物；CEP 写请求超时不自动重发，用原 requestId/instanceId 查询回执。只有已返回完成结果才能继续依赖操作。
- 最终报告工具实际返回的 json、folder、sidecarPath 和问题，注明是否复测。工具报告不等于视觉或运行交互验收。

本仓库没有 Adapters。到 JSON/PNG 导出即结束，不尝试调用 SGUI/YoyoUI Build、生成 Prefab、图集、QuickCode 或业务代码。用户要求 Unity 接入时说明 [具体缺口](../../../docs/UNITY-INTEGRATION.md)，由目标项目单独提供导入能力。
