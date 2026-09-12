# PSD 配置与导出流程

此公共版流程从原“PSD 到 Prefab”工作流中提取 Photoshop 部分，终点是配置保存或 JSON/PNG 导出。本仓库不包含 Unity Adapter。

1. 按 [PS-MCP 说明](../PS-MCP/README.md) 完成独立环境准备；开始及断连恢复时执行一次严格 Check。失败时报告原始错误，先处理环境。
2. 打开指定 PSD，读取 inspect 和完整 snapshot（rootLayerId 为 document-root），包括隐藏层、已有配置和本次确需比较的旧 JSON。
3. 给出当前结构、差异和建议；未经确认不初始化、重组、写配置、预检或导出。当前任务已确认同一 PSD 和方案时直接复用。
4. 根据方案调用现有配置/结构工具。使用返回的真实 layerID；不要把 sidecar 当作独立编辑入口，不扩大为任意 Photoshop 脚本。
5. 用户只要求配置则保存成功后结束；要求导出则调用 export_bundle，其内部已有必要检查。按工具返回值报告 json、folder、sidecarPath 及问题。

日常流程不为清空诊断自动改名、重试或追加视觉验收；工具失败时报告已返回的错误与产物。CEP 写请求超时先查询原 requestId 的回执，不能自动重放。

工具参数与分支差异见 [Photoshop 调用](references/photoshop-authoring.md)，可复用入口见 [导出 Skill](../../.agents/skills/psd2ui-export-workflow/SKILL.md)。如需生成 Prefab，转入接收方的 [Unity 接入](../../docs/UNITY-INTEGRATION.md)。
