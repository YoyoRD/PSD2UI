# Photoshop UXP 插件

本目录的 PSD2UI 是 Photoshop 25.0+ 的 UXP 源码与已有 Core 生成副本。安装、开发加载和 CCX 打包见 [仓库 README](../../README.md)，操作见 [美术工作流](../docs/ARTIST_WORKFLOW.md)。

UDT 应加载 PSD2UI/manifest.json。普通面板不用 npm 或 AI。配置保存在 PSD XMP 与同目录镜像，交付为 JSON/PNG；generated/core 由 scripts/sync-generated.mjs 从公共 Core 同步，不能手改。

此分支不包含 CEP，PS 2019 请切换仓库 main 分支。Unity Adapter 不分发，见 [Unity 接入](../../docs/UNITY-INTEGRATION.md)。本次未运行测试或 Photoshop。
