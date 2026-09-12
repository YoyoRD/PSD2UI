# PSD2UI CEP Windows 安装包

适用基线：Windows、Photoshop 20.0.4 / CC2019，使用 Photoshop 内置 CEP 9。

1. 关闭 Photoshop。
2. 将整个 ZIP 解压到一个普通本地文件夹。不要在压缩包预览窗口里直接运行安装器。
3. 双击 `Install.cmd`，成功后打开 Photoshop 的「窗口 → 扩展功能 → PSD2UI」。

普通面板使用不需要 Creative Cloud Desktop、UXP Developer Tools、独立 Node.js 或管理员权限。AI / MCP 是另外的可选程序端功能，不是美术安装步骤。

## 安装器修订 r2

CEP 功能版本仍为 0.3.8。r2 将完整插件的暂存目录放到 `CEP/psd2ui-staging`，避免位于 Photoshop 的 `extensions` 扫描目录内；目录重命名遇到拒绝访问或共享冲突时，最多等待 3.25 秒重试。目标目录已存在时拒绝嵌套或覆盖，持续失败则停止并按实际状态恢复旧版本。

每次安装都会输出完整日志路径，默认在 `%TEMP%\PSD2UI-Install`。日志包含运行账号、是否提权、源/目标/暂存/备份路径、失败步骤、原始异常和回滚结果；清理失败不会掩盖主要错误。`-ValidateOnly` 仍只核对包，不创建安装日志或改动目标目录，也不代表目标目录可写。

如果普通模式和管理员模式都报“拒绝访问”，先回传本次日志，不必反复切换运行方式。目录权限允许写入时，文件占用仍可能阻止整目录重命名；不能仅凭该报错认定是权限不足或杀毒软件。r2 不更改 ACL、不结束占用进程、不调整安全软件。最新 AI/MCP 入口也已兼容 Windows 自带的 PowerShell 5.1，不要求 PowerShell 7。

## 0.3.8 试用清单

本轮已在 Windows / Photoshop 26.8.0（2025）完成真实 PSD 的人工配置与 AI 流程导出对照，两条流程各导出 114 张 PNG，像素和运行时 JSON 一致。其他 Photoshop 版本请按下面步骤验证，并在反馈中注明完整版本号。

1. 复制一份待测 PSD，用副本试用。打开 PSD2UI 面板，连续点击不同图层、切换两个文档，检查面板选中项是否跟随，以及 Photoshop 是否出现持续卡顿。
2. 按实际需求配置组件、资源类型和九宫参数，保存 PSD，关闭再打开，检查配置是否保留。
3. 导出到一个测试目录，检查 JSON、图片数量、透明区域和九宫效果。修改配置后再次导出，检查结果是否更新。
4. 如果使用公共资源：同名且像素、尺寸、透明度和九宫参数相同的资源应可复用；同名但内容或九宫参数不同应提示冲突，已有公共图片应保持不变。`comm_` 名称本身不代表无条件允许覆盖。

反馈请附 Photoshop 完整版本、插件版本、PSD 大小和大致图层数、具体操作步骤、卡顿持续时间或完整错误文本；必要时提供可共享的测试 PSD。Unity 导入结果需在同事项目中另行验证。

安装器只更新当前用户的 `%APPDATA%\Adobe\CEP\extensions\com.yoyoengine.psd2ui.cep`。旧版本保存到相邻的 `CEP\psd2ui-backups` 目录，安装异常时自动恢复；不会停止 Photoshop、修改其他插件、PSD 或 Unity 项目。安装器不会设置 `PlayerDebugMode`，不会修改系统执行策略；`Install.cmd` 的策略参数只作用于本次 PowerShell 进程。公司策略禁止脚本时请由团队 IT 按同一用户目录部署。

安装前检查包完整性可运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -ValidateOnly
```

`package-files.json` 用于检查文件传输完整性；它不是发行者身份认证。Photoshop 在加载时校验 CEP 签名，`META-INF` 目录必须原样保留，安装后不要修改插件目录内的文件。

本包使用团队内部自签名证书签署，未申请网络时间戳；证书有效期见 `SIGNATURE.txt`，到期前需要由维护者重新签名并更新安装包。`SIGNATURE.txt` 记录实际打包时 Adobe ZXPSignCmd 的离线签名验证结果。签名验证和安装验证不等于 Photoshop 20.0.4 中的完整导出验收。

如果更新后需要退回旧版：关闭 Photoshop，将当前插件目录另行保存，再把安装器输出的 `Backup` 目录恢复为上述插件目录名称。不要把备份放进 `extensions` 内，否则 Photoshop 可能同时发现两个版本。

维护者构建方式与签名工具来源见仓库 `scripts/CEP-DISTRIBUTION.md`；安装包不含私钥、密码或开发工具。
