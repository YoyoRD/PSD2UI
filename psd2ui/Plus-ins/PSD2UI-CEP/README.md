# PSD2UI CEP 0.4.6

本目录是 Windows Photoshop CC 2019（20.0.4）对应的 CEP 9 面板。当前版本以 [CSXS/manifest.xml](CSXS/manifest.xml) 为准。打开方式、第一次导出和 AI 接入见[仓库 README](../../../README.md)。

仓库保留预生成的 `panel.js`、`index.html`、`style.css` 和 `host/photoshop.jsx`。在仓库根运行以下命令即可把这些文件签名到本地 `psd2ui/dist`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\psd2ui\scripts\package-cep.ps1 -SkipBuild -OutputDirectory .\psd2ui\dist
```

首次打包需要获取 Adobe 签名工具。完整输出目录含 `Install.cmd`、版本与校验文件、已签名的 `com.yoyoengine.psd2ui.cep/`；保留整个目录，关闭 Photoshop 后运行 `Install.cmd`，重开 Photoshop，从「窗口 → 扩展功能 → PSD2UI」进入。普通面板使用不需要独立 Node.js。详情见[安装说明](../../scripts/cep-install/README.md)和[打包说明](../../scripts/CEP-DISTRIBUTION.md)。

共享面板与导出实现在 `../PSD2UI/`，公共 Core 在 `../../Core/`；`src/` 是 CEP 接入层，`host/photoshop.jsx` 承接固定 RPC。更新源码应通过仓库构建脚本重新生成面板，不能手改生成文件。当前版包含 CEP 缓存与保存优化、Photoshop 2020 宿主兼容、同名九宫复用和重复导出文件保留规则。

CEP 不能保证不同 Photoshop 版本的文字、图层效果和色彩逐像素一致。此公开仓库同步没有重新运行 Photoshop 或 Unity 实机验证；源分支历史验证也不能代替目标机器验收。
