# CEP 维护者打包

CEP 面板的版本写在 [CSXS/manifest.xml](../Plus-ins/PSD2UI-CEP/CSXS/manifest.xml) 中。源仓库同步到公开分支时保留预生成的 `panel.js`、`index.html`、`style.css` 和共享 `PSD2UI/` 源码；生成文件不能手工修改后再签名。

在公开仓库根运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\psd2ui\scripts\package-cep.ps1 -SkipBuild -OutputDirectory .\psd2ui\dist
```

省略 `-OutputDirectory` 时，公开版同样使用 `psd2ui/dist`。已有预生成面板时用 `-SkipBuild`；修改 Core、CEP 适配层或共享面板源码后，在 `psd2ui` 安装锁定依赖、运行 `npm.cmd run build:cep`，再执行上面的打包命令并去掉 `-SkipBuild`。这些构建步骤需要 Node.js；美术使用签名目录不需要。

首次打包会下载 Adobe 官方 ZXPSignCmd 4.1.3 Windows x64，并校验脚本固定的 SHA-256。默认生成内部开发自签名证书，证书和 DPAPI 密码文件保存在被忽略的 `psd2ui/.tmp/cep-signing`。已有证书可用 `-CertificatePath` 与 SecureString 类型的 `-CertificatePassword` 指定。签名未申请网络时间戳，有效期见输出目录的 `SIGNATURE.txt`；到期前需要重新签名。

输出目录直接包含 `Install.cmd`、`Install.ps1`、`README.md`、`SIGNATURE.txt`、`package-files.json`、`PSD2UI-CEP.version.json` 与已签名的 `com.yoyoengine.psd2ui.cep/`。版本文件记录本次打包的实际版本。脚本会对新包暂存、签名校验和安装器 `ValidateOnly`，再更新其管理的文件；遇到未知来源的同名安装文件会停止。不会在输出目录留下独立 ZIP 或 ZXP。

用户安装步骤见 [cep-install/README.md](cep-install/README.md)。打包和签名验证只证明安装文件的结构与完整性；目标 Photoshop 20.0.4 的面板、保存和导出仍需在对应机器实测。
