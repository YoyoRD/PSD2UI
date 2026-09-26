# CEP 签名目录安装

适用 Windows Photoshop 20.0.4 / CC2019 的 CEP 9 面板。普通使用只需要 Photoshop 和**完整签名安装目录**，不需要 Node.js、UXP Developer Tool 或管理员权限。当前功能版本以同目录的 `PSD2UI-CEP.version.json` 为准，安装器修订号为 r2。

签名目录至少包含 `Install.cmd`、`Install.ps1`、`README.md`、`SIGNATURE.txt`、`package-files.json`、`PSD2UI-CEP.version.json`，以及 `com.yoyoengine.psd2ui.cep/` 子目录。复制或转交时保留整个目录和子目录中的 `META-INF` 签名。源码目录里的 `Install.cmd` 只是模板，不能单独运行。

1. 保存工作并关闭 Photoshop。
2. 在完整签名目录中双击 `Install.cmd`。
3. 等待安装结果，重新打开 Photoshop，在「窗口 → 扩展功能 → PSD2UI」打开面板。

安装器将插件放在当前用户的 `%APPDATA%\Adobe\CEP\extensions\com.yoyoengine.psd2ui.cep`。更新时保留旧版本备份，失败时尝试恢复；日志默认写入 `%TEMP%\PSD2UI-Install`。安装前可在完整签名目录中运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -ValidateOnly
```

这一步检查包文件是否齐全，不会安装，也不等于 Photoshop 加载或导出已验证。签名有效期见 `SIGNATURE.txt`；签名目录安装和 AI/MCP 接入是两项独立步骤。

只有源码时，在公开仓库根运行以下命令，默认输出到 `psd2ui/dist`；首次执行需要获取并校验 Adobe 签名工具：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\psd2ui\scripts\package-cep.ps1 -SkipBuild -OutputDirectory .\psd2ui\dist
```

`-SkipBuild` 使用随仓库提交的预生成面板。维护者修改源码后，应按[公开仓库的打包说明](https://github.com/YoyoRD/psd2ui/blob/main/psd2ui/scripts/CEP-DISTRIBUTION.md)先重建面板。当前打包脚本生成平铺的签名文件和插件目录，不生成外层 ZIP；GitHub 的 Source code ZIP 只是源码。
