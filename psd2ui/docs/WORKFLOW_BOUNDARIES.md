# Photoshop 与目标项目的边界

本仓库只分发 PSD2UI 的 Photoshop 端、Core/Schema、可选 PS-MCP 与导出 Skill。

1. 美术端：本地 PSD、图片命名、组件角色、模板、预览、状态与视觉参数；保存 XMP/镜像并导出 JSON/PNG。普通面板操作无需 AI。
2. 可选 AI 端：读取完整 PSD 和已有配置，提出方案，沿用或取得人工确认后执行配置、导出；以用户要求的配置或导出终点结束。
3. 目标端：由接收方提供 Unity/其他引擎的导入器、路径/字体/图集路由、Prefab 构建、控件映射与业务逻辑。本仓库不包含 Adapters，具体缺口见 [Unity 接入](../../docs/UNITY-INTEGRATION.md)。

已有配置或旧导出不是新的修改授权；同一 PSD 和方案在当前任务已明确确认则无需重复确认。公共 Skill 不自动安装环境、操作 Unity 或生成业务代码。维护者安装和打包步骤见仓库 [README](../../README.md)。
