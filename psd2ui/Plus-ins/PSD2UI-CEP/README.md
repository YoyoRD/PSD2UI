# PSD2UI CEP 0.3.8

Windows Photoshop 20.0.4（CC 2019）/ CEP 9 为目标基线。本次由 PSD2UI 的 CEP9 分支迁入，未重新运行宿主验证。最短运行步骤见 [仓库 README](../../../README.md)。

## 使用现成生成面板

本目录已经有 panel.js、index.html、style.css 与 host/photoshop.jsx。在仓库根运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/package-cep.ps1 -SkipBuild
```

首次下载 Adobe 签名工具。然后完整解压 psd2ui/dist 下的 PSD2UI-CEP-0.3.8-Windows-Install-r2.zip，关闭 Photoshop，双击其中的 Install.cmd；重开后从「窗口 → 扩展功能 → PSD2UI」进入。

源码中的 scripts/cep-install 只是打包模板，不能单独安装。完整包含签名 META-INF 和 package-files.json；安装器按清单检查完整性，并保存旧版本。说明见 [离线安装](../../scripts/cep-install/README.md)和 [签名打包](../../scripts/CEP-DISTRIBUTION.md)。

## 需要修改源码时

在仓库的 psd2ui 目录运行：

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build:cep
npm.cmd run package:cep
```

共享面板与导出逻辑位于 ../PSD2UI，Core 在 ../../Core；src 是 CEP 接入层，host/photoshop.jsx 承接固定命令。panel.js、index.html、style.css、THIRD-PARTY-LICENSES.txt 是构建产物，不能手改。pngjs 已打入面板，接收方无需 Node。

## 已有能力与限制

沿用源分支 0.3.8 的配置、角色、模板、状态、PNG/九宫导出与资源比较实现，也保留其读取缓存、选择刷新、结构计划和安装器 r2 的更新。美术操作见 [工作流](../../docs/ARTIST_WORKFLOW.md)。

- CEP 串行处理面板与 AI 操作，但没有 UXP 原生 modal 排他锁；操作期间等待结束再手动修改。
- AI 写请求超时不等于取消，先用 requestId/instanceId 查询回执，不能自动重发。
- 像素适配面向当前 exporter 使用的 8bit RGB(A) 场景；不同 Photoshop 版本的文字、滤镜、图层效果和颜色不保证逐像素一致。
- manifest 的宽宿主范围不是兼容性验收结果。历史来源记录不作为本次迁移验证。
- 本仓库没有 Unity Adapters；导出后如何补 Prefab 生成见 [Unity 接入](../../../docs/UNITY-INTEGRATION.md)。
