# CEP Windows 离线分发

`npm run package:cep` 使用 Windows PowerShell 5.1 构建面板，再用 Adobe ZXPSignCmd 签名，输出到 `psd2ui/dist`：

- `PSD2UI-CEP-<version>-Windows-r2.zxp`：签名原包。
- `PSD2UI-CEP-<version>-Windows-Install-r2.zip`：美术解压后双击 `Install.cmd`；包含已签名插件目录和完整 `META-INF`。安装器修订号独立于 CEP 功能版本。
- `PSD2UI-CEP-<version>-Windows-package-r2.json`：打包结果、安装器修订号和交付文件 SHA-256。

只打包已经生成的面板可以运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-cep.ps1 -SkipBuild
```

打包机需要 Node.js 及已安装的仓库依赖；美术机器不需要这些工具。打包工具使用 [Adobe 官方 ZXPSignCmd 4.1.3 Windows x64](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD/4.1.3/x64)，首次下载到被忽略的 `.tmp/cep-signing`，随后校验固定 SHA-256。打包工具不随安装包分发。

默认生成内部开发自签名证书，有效期 3650 天；证书和按当前 Windows 用户 DPAPI 加密的密码文件只存在 `.tmp/cep-signing`，不得提交或交给美术。已有证书可通过 `-CertificatePath` 和 SecureString 类型的 `-CertificatePassword` 传入。不要把明文密码写入命令历史；在受控构建进程中构造 SecureString。ZXPSignCmd 本身需要密码进程参数，构建机应只供可信用户使用。

默认不申请网络时间戳，签名后验证与用户安装可以离线进行。根据 [Adobe 签名说明](https://github.com/Adobe-CEP/Getting-Started-guides/tree/master/Package%20Distribute%20Install)，没有时间戳的签名在证书过期后不能继续加载，必须在到期前重签发布。精确有效期和两次验证结果写在安装包的 `SIGNATURE.txt`。自签名不代表 Adobe Marketplace 审核或 CA 身份认证。

发布只包含 `CSXS`、`host`、`index.html`、`panel.js`、`style.css`、`THIRD-PARTY-LICENSES.txt`；不会把源码、私钥或独立 Node 运行时复制进去。签名 ZXP 解压后再次验证目录签名，ZIP 完成后重新解压并验证签名及安装清单，确保 `META-INF` 未损坏。Windows 包在 Windows 本机签名，拒绝符号链接，遵循 [Adobe 的跨平台签名问题说明](https://github.com/Adobe-CEP/CEP-Resources/blob/master/ZXPSignCMD/KnownIssue2024.md)。

安装器默认使用用户级 CEP 目录，不设置 `PlayerDebugMode`。更新前校验扩展 ID、签名文件是否完整、发布清单和所有文件字节；原版保留在 `CEP/psd2ui-backups`，自动回滚安装中断。安装脚本的文件清单检查仅确认传输完整性，CEP 签名真实性由 Adobe 签名工具和 Photoshop 加载器验证。

安装器 r2 在相邻的 `CEP/psd2ui-staging` 暂存，只有验证成功的正式目录进入 `extensions`；使用拒绝已存在目标的精确目录重命名。仅对本地文件操作的 Windows 5/32/33 错误短时重试，累计等待不超过 3.25 秒；这不适用于 Photoshop/AI 写操作。失败日志默认写入 `%TEMP%/PSD2UI-Install`，保留具体阶段与原始异常；清理暂存目录失败只记录警告，不能覆盖安装或回滚的主要错误。

打包和安装验证不包含 Photoshop 实机功能验收；正式交付仍须在目标 PS 20.0.4 运行图层操作、保存和导出路径。

安装脚本的临时目录测试覆盖安装、更新备份、失败回滚、损坏包和路径越界拒绝，不操作当前 Photoshop 或用户插件目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\cep-install\Test-Install.ps1 -PackageZip .\dist\PSD2UI-CEP-0.3.8-Windows-Install-r2.zip
```
