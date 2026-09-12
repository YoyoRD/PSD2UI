# PS-MCP：可选 Photoshop 自动化

此分支通过 Adobe UDT 连接 UXP 插件，需要 PowerShell 7（pwsh）及运行中的 Photoshop/UDT。 手动用面板可以跳过本页。PS-MCP 使用 stdio，只负责 Photoshop，不提供 Unity 调用或任意宿主脚本执行。

外部 Node 要求：20.x 至少 20.19，22.x 至少 22.12，或更新的受支持版本。插件安装先按 [仓库 README](../../README.md) 完成。依赖按本分支 package-lock.json 安装，不随仓库提交 node_modules。

## 首次准备

在仓库根执行：

```powershell
pwsh -NoProfile -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation InstallDependencies
pwsh -NoProfile -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Connect
pwsh -NoProfile -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Check
```

InstallDependencies 安装锁定依赖；Connect 是显式环境准备，可启动 UDT 后台服务、加载插件。工作流 Check 只检查已有会话，不启动服务或重载插件。

日常工作流及断连恢复只执行 Check，失败时报告原始原因，先完成独立环境准备后再继续。不要用 Connect 代替严格检查。

## 读取一份 PSD

以下仍在仓库根的 PowerShell 7 会话运行。将两个输入改为本次真实绝对路径：

```powershell
$taskPsd = '<PSD绝对路径>'
$taskOutput = '<交付目录绝对路径>'
$taskRoot = Split-Path -Parent $taskPsd
$taskCommand = './psd2ui/scripts/Invoke-Psd2UiPortable.ps1'

$taskOpen = @{ documentPath = $taskPsd } | ConvertTo-Json -Compress
& $taskCommand -Operation Call -AuthoringRoot $taskRoot -ToolName psd2ui_open_document -PayloadJson $taskOpen

$taskInspect = @{ expectedDocumentPath = $taskPsd } | ConvertTo-Json -Compress
& $taskCommand -Operation Call -AuthoringRoot $taskRoot -ToolName psd2ui_inspect_document -PayloadJson $taskInspect

$taskSnapshot = @{ expectedDocumentPath = $taskPsd; rootLayerId = 'document-root' } | ConvertTo-Json -Compress
& $taskCommand -Operation Call -AuthoringRoot $taskRoot -ToolName psd2ui_snapshot -PayloadJson $taskSnapshot
```

document-root 是虚拟快照根，不会创建 PSD 组。完整分析包括隐藏层与已有配置；已有旧 JSON 不代表当前 PSD 未变化。先给出方案并确认，再初始化/修改配置。

## 导出

仅在本次 PSD、方案和输出范围已确认且所需配置完成后执行。导出会保存配置/PSD 并写入交付目录：

```powershell
$taskExport = @{ expectedDocumentPath = $taskPsd; uiResPath = $taskOutput } | ConvertTo-Json -Compress
& $taskCommand -Operation Call -AuthoringRoot $taskRoot -UiResPath $taskOutput -ToolName psd2ui_export_bundle -PayloadJson $taskExport
```

工具内部包含必要导出检查。使用本次返回的 json（JSON 路径）、folder（交付根）、sidecarPath（配置镜像）和诊断；不从历史路径猜本次成功。Unity 端由接收方按 [接入说明](../../docs/UNITY-INTEGRATION.md) 实现。

## 直接接入支持 stdio 的客户端

配置 Node 进程执行 `<本仓库绝对路径>/psd2ui/PS-MCP/src/server.js`，或在 PS-MCP 目录运行 `npm.cmd start`。使用以下显式环境变量：

| 变量 | 用途 |
| --- | --- |
| PSD2UI_TOOL_ROOT | 可选；默认按脚本位置定位本包 |
| PSD2UI_AUTHORING_ROOTS | 允许访问的 PSD 目录；多个目录用系统路径分隔符连接，Windows 是分号。缺失时不能访问 PSD |
| PSD2UI_UIRES_PATH | 可选固定交付目录；导出仍需 payload 的 uiResPath |
| PSD2UI_UDT_ROOT / PSD2UI_UDT_PORT | UDT 安装目录与服务端口 |
| PSD2UI_UDT_AUTOSTART | false 禁止自动启动；严格 Check 始终不启动 |

Portable 入口会隔离遗留的 PSD2UI 环境变量，因此调用该脚本时用 -AuthoringRoot、-UiResPath 等参数，不依赖旧会话环境。非标准 UDT 位置/端口用 -UdtRoot / -UdtPort。

## 工具与失败处理

日常工具有 photoshop_status、open_document、inspect_document、snapshot、wrap_document_root、initialize_document、execute_authoring、apply_confirmed_structure_plan、preflight_export、export_bundle，完整名称统一以 psd2ui_ 开头。准确参数以 [server.js](src/server.js) 为准，配置与结构操作见 [调用参考](../Workflows/references/photoshop-authoring.md)。

UDT 会话按当前插件路径和文件指纹识别。移动仓库或修改插件后可能需要重新显式 Connect，随后再 Check；会话缓存缺失不等于 Photoshop 没有安装。
旧数据维护工具默认不注册，只有明确的维护任务才以 server.js --maintenance 或底层客户端的 Maintenance 参数启用；不属于共享 Skill 的日常步骤。

本次没有执行依赖安装、连接、测试或 Photoshop/Unity 操作。这里提供运行步骤，不能把说明中的调用当作本次已验证结果。
