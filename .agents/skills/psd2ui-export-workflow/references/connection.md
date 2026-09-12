# 连接 Photoshop

本 Skill 随 **main / CEP** 分支分发。默认连接已打开的 CEP 面板，使用 Windows PowerShell 5.1；不要求 UDT。
使用另一个分支的插件/脚本时，先读取那个工具包的实际接口；不能把本页的默认宿主直接套过去。

## 优先使用客户端 MCP

客户端应启动工具包的 PS-MCP/src/server.js（stdio）。PSD2UI_AUTHORING_ROOTS 是允许访问的 PSD 目录；Windows 多目录用分号。可用 PSD2UI_UIRES_PATH 固定导出根，传入的 uiResPath 必须与之匹配。

主分支默认 PSD2UI_HOST=cep。面板与 MCP 要运行在同一台 Windows、同一用户环境，保持面板打开；发现多个实例时以 PSD2UI_CEP_INSTANCE_ID 选择目标。只有明确维护 UXP 时才使用 PSD2UI_HOST=uxp。

日常先调用 psd2ui_photoshop_status，输入 {"checkOnly":true}。工具发现成功只证明 MCP 进程可用；status 才能检查 Photoshop 面板连接。status 不要求打开 PSD，随后仍须按精确 documentPath 打开目标文档。

## 没有注册 MCP 时，使用终端入口

只有客户端具备本地终端能力且工具包已准备时才可使用。toolRoot 指包含 Core、Plus-ins、PS-MCP、scripts 的目录，通常是 <仓库根>/psd2ui。

若本 Skill 位于仓库的 .agents/skills/psd2ui-export-workflow，先检查该仓库的 psd2ui/scripts/Invoke-Psd2UiPortable.ps1；若 Skill 被整体复制到其他项目，用用户给定的工具包位置。不要从旧项目、同名私有仓库或硬盘扫描结果猜工具根。

```powershell
$taskToolRoot = '<工具根绝对路径>'
$taskEntry = Join-Path $taskToolRoot 'scripts/Invoke-Psd2UiPortable.ps1'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskEntry -Operation Check
```

检查成功后，在 Windows PowerShell 5.1 中调用：

```powershell
$taskPsd = '<PSD绝对路径>'
$taskRoot = Split-Path -Parent $taskPsd
$taskPayload = @{ expectedDocumentPath = $taskPsd; rootLayerId = 'document-root' } | ConvertTo-Json -Depth 100 -Compress
& $taskEntry -Operation Call -AuthoringRoot $taskRoot -ToolName psd2ui_snapshot -PayloadJson $taskPayload
```

其他调用复用该入口、AuthoringRoot、ToolName 与 PayloadJson；工具参数见 [operations.md](operations.md)。导出同时传 -UiResPath 与 payload.uiResPath。Portable 会隔离旧环境变量，因此需要用显式参数指定目录。

## 独立环境准备

日常 Check 不安装依赖或启动/重载插件。用户明确要求安装准备时，工具包入口为：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskEntry -Operation Prepare
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskEntry -Operation Connect
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskEntry -Operation Check
```

Prepare 检查锁定依赖，缺失/损坏时恢复；Connect 只发现已经打开的 CEP 面板，不启动 Photoshop 或打开面板。
Node.js 使用 20.19+（20.x）、22.12+（22.x）或工具支持的更新版本。Photoshop 插件安装由工具仓库 README 说明，不由 Skill 文件代替。

## 写请求超时

CEP 超时可能意味着宿主仍在执行，不能自动重发。使用 psd2ui_photoshop_status 查询原请求：

```json
{ "checkOnly": true, "requestId": "<错误返回的原请求ID>", "instanceId": "<错误返回的原实例ID>" }
```

- succeeded：读取原 result，然后继续。
- running/queued：等待并查询同一请求。
- failed：报告原 error。
- unknown 或无法确认：报告已有回执，核对文档/镜像后再决定；不生成新请求 ID 重放修改。

不要读取或把会话 token 放进提示词。面板本地 HTTP 是内部连接协议，不是供客户端配置的 MCP URL。
