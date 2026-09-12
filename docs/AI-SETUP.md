# 用 AI 分析、配置和导出 PSD

这是一套本地 Photoshop 工具：AI 根据真实图层树提出方案，调用插件提供的命令修改 PSD、保存组件配置并导出资源。图层和配置由本机插件读取，操作结果也保存在本机。

## 你需要准备什么

| 部分 | 作用 | 是否必需 |
| --- | --- | --- |
| Photoshop + PSD2UI 面板 | 读取和修改真实 PSD，保存配置，渲染 PNG | 必需 |
| 本仓库的 PS-MCP | 把插件能力提供给 AI 客户端 | 直接使用 MCP 时必需 |
| 支持本地工具调用的 AI 客户端 | 理解需求、分析图层、生成操作计划 | AI 处理时必需 |
| psd2ui-export-workflow Skill | 告诉 AI 分析、确认、配置、导出和续做的步骤 | 建议同时加载 |

只复制 Skill 不会安装 Photoshop 插件，也不会自动注册 MCP。本仓库不提供模型服务，不需要在插件里填写 OpenAI API Key；模型账号和调用方式由你使用的 AI 客户端配置。被调用工具返回的图层名称、文字和配置会进入 AI 对话，按你的项目要求选择可用的客户端。

以下以**在安装 Photoshop 的 Windows 上，用同一用户打开本仓库**为例。CEP 会话发现依赖本机用户目录；云端任务、另一台电脑或另一用户的终端不能直接发现这个面板。工具根是仓库下的 psd2ui 目录，不是 Unity 项目目录。

## 1. 安装面板并准备工具依赖

先按 [仓库 README](../README.md) 安装 **CEP 0.3.8** 并打开面板。安装 Node.js（20.x 至少 20.19，22.x 至少 22.12，或工具支持的更新版本）。本分支使用 Windows 自带 PowerShell 5.1，不需要 UDT 或 PowerShell 7。

在包含 README.md 的仓库根执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Prepare
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Connect
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Check
```

Prepare 准备缺失的锁定依赖；Connect/Check 都只发现已打开的 CEP 面板。Check 成功后再配置客户端。日常任务只需 Check，不用每次重新安装。

## 2. 让 AI 客户端看到 Photoshop 工具

### Cursor

用 Cursor 打开本仓库，将 [cursor-mcp.json 示例](examples/cursor-mcp.json)中的服务项合并到本仓库 `.cursor/mcp.json`。已有其他服务时保留它们。完整示例：

```json
{
  "mcpServers": {
    "psd2ui-photoshop": {
      "command": "node",
      "args": [
        "${workspaceFolder}/psd2ui/PS-MCP/src/server.js"
      ],
      "env": {
        "PSD2UI_AUTHORING_ROOTS": "<PSD创作目录绝对路径>",
        "PSD2UI_UIRES_PATH": "<导出目录绝对路径>",
        "PSD2UI_HOST": "cep"
      }
    }
  }
}
```

替换两个目录占位符。Windows 路径可以使用正斜杠；多个允许的 PSD 目录用分号连接。工作区变量指包含 .cursor/mcp.json 的项目目录；如果你打开的是游戏项目，就把 args 中的工具路径改成此工具仓库的绝对路径。

保存后在 Cursor 的 MCP 设置中启用/重新加载该服务，检查工具列表。配置格式和项目配置位置依据 [Cursor 官方 MCP 文档](https://cursor.com/docs/mcp)。

### Codex

将 [codex-mcp.toml 示例](examples/codex-mcp.toml)中的配置节合并到 `~/.codex/config.toml`，或可信项目的 `.codex/config.toml`，替换三个绝对路径占位符。Windows 路径建议使用正斜杠（如 E:/Tools/psd2ui），避免 TOML 双引号中的反斜杠转义：

```toml
# 将占位路径替换为本机真实绝对路径；只合并本节，不覆盖已有配置。
[mcp_servers.psd2ui-photoshop]
command = "node"
args = ["<仓库绝对路径>/psd2ui/PS-MCP/src/server.js"]
startup_timeout_sec = 30
tool_timeout_sec = 660

[mcp_servers.psd2ui-photoshop.env]
PSD2UI_AUTHORING_ROOTS = "<PSD创作目录绝对路径>"
PSD2UI_UIRES_PATH = "<导出目录绝对路径>"
PSD2UI_HOST = "cep"
```

重新加载 MCP 或开启新会话。已安装 CLI 时可用 `codex mcp list` 查看登记状态。tool_timeout_sec 给大 PSD 的操作预留时间；超时不等于 Photoshop 取消了写入。配置项与位置依据 [Codex 官方 MCP 文档](https://developers.openai.com/codex/mcp/)。

以上示例文件不会自动修改你的客户端设置。PSD2UI 使用 **stdio**：客户端启动 node 进程即可，不需要填写 localhost URL、API Key 或复制 CEP 会话凭据。CLI 单独启动 server.js 后等待输入属于正常现象。

## 3. 加载处理流程 Skill

本仓库的 Skill 位于：

```text
.agents/skills/psd2ui-export-workflow/
├─ SKILL.md
└─ references/
   ├─ connection.md
   └─ operations.md
```

Codex 与 Cursor 都支持从项目的 .agents/skills 读取 Skill。用客户端打开本仓库后，在会话中选择该 Skill，或明确让 AI 读取该 SKILL.md；CLI 支持时也可用 `$psd2ui-export-workflow` 指定。发现机制见 [Codex Skills](https://developers.openai.com/codex/skills/)与 [Cursor Skills](https://cursor.com/docs/skills)。

如果要在游戏项目里使用，可**整体复制这个 Skill 文件夹及 references** 到那个项目的 .agents/skills。MCP 的 args 仍指向完整工具仓库，PSD 目录仍由 env 配置；Skill 不携带插件、Node 依赖或任何 Unity Adapter。没有发现到 Skill 时可显式提供它的路径，不要只复制 SKILL.md 而遗漏引用文件。

## 4. 先确认工具连接，再处理 PSD

向 AI 发送：

> 使用 psd2ui-export-workflow。先调用 psd2ui_photoshop_status，参数为 {"checkOnly":true}，只检查连接，暂时不要打开或修改 PSD。

客户端中应该能找到十个日常工具，包括 psd2ui_photoshop_status、psd2ui_open_document、psd2ui_inspect_document、psd2ui_snapshot、psd2ui_execute_authoring 和 psd2ui_export_bundle。工具列表可见说明 MCP 服务已连接；status 成功才说明 Photoshop 插件连接正常。

然后按需要发出下面的请求，路径替换为实际值。

**只分析，先给方案：**

> 使用 psd2ui-export-workflow，分析 <PSD绝对路径>。读取包括隐藏层的完整树和已有配置，列出按钮、列表、状态的建议及需要整理的层级。先不要修改或导出。

**确认后配置并导出：**

> 按刚才确认的方案处理同一份 PSD：购买按钮绑定底图与文字，商品列表以第一项为模板，第二、三项仅作预览。界面模块使用 shop。保存配置并导出到 <交付目录绝对路径>。

**已有配置，只调整一处：**

> 读取 <PSD绝对路径>，把已确认的页签默认状态改成 selected，保留其他配置。本轮只保存配置，不导出。

**继续之前的任务：**

> 继续上一份已确认方案，沿用相同 PSD 和交付目录。只做尚未完成的步骤；如果上次写操作超时，先查询原请求结果，不重复提交。

Skill 支持仅分析、仅配置和导出三个终点。普通流程修改后读回相关配置一次；明确要求“快流程，不复测”时直接使用工具返回值。已有确认不会重复询问，新的层级/删除/范围变化需要明确对应的处理方案。

## AI 可以做什么，哪些需要人工承接

| 操作 | 当前入口与限制 |
| --- | --- |
| 读取 PSD 的层级、位置、文字、隐藏层和已有配置 | inspect + 全树 snapshot |
| 新 PSD 初始化、配置节点类型和参数 | initialize_document / execute_authoring |
| 普通组、组件组合、复制、改名、组件角色 | 已确认结构计划；受当前图层和前置条件约束 |
| 列表模板、仅预览条目、视口、视觉状态 | 结构配置 + previews/viewport/states 工具 |
| 移动、解组、删除 | CEP 已有受控入口；必须明确允许外观变化，解组/删除提供后代清单 |
| 修改已初始化 PSD 的界面模块名 | 日常 MCP 未开放；在面板「保存所属模块」完成 |
| 图片绘制、任意滤镜/修图、任意 JSX 执行 | 不属于这些 MCP 工具的能力 |
| Unity Prefab、图集与业务接线 | 需要项目自己的 Adapter，本仓库不包含 |

AI 根据真实返回的 layerId 操作，不根据图层名猜 ID；复杂组件需要角色与模板，不是把类型改成 list 就结束。详细参数在 [Skill 操作参考](../.agents/skills/psd2ui-export-workflow/references/operations.md)。

## 常见连接问题

| 现象 | 如何处理 |
| --- | --- |
| AI 看不到任何 psd2ui_* 工具 | 确认客户端配置文件位置、node 命令和 server.js 路径，查看 MCP 启动日志后重新加载 |
| 工具可见，但 Photoshop 状态失败 | 打开 CEP 面板，确认同一 Windows 用户；多个实例时指定 PSD2UI_CEP_INSTANCE_ID |
| 提示未配置/超出创作目录 | 将 PSD 所在目录加入 PSD2UI_AUTHORING_ROOTS，保存并重新加载 MCP |
| 导出目录不匹配 | payload.uiResPath 与 PSD2UI_UIRES_PATH 使用同一绝对路径 |
| 已有文档初始化报错 | 先读取并保留现有配置，不用 allowReinitialize:true 处理普通修改 |
| 写操作超时或断连 | 用错误里的原 requestId/instanceId 查询 status 回执；unknown 时核对文档，不自动重放 |
| Skill 能读取，但 MCP 暂时无法注册 | 客户端有本地终端时可用现有 Portable Call 入口，见下方链接；仍需要插件与工具依赖 |

不用注册 MCP 的终端调用方式见 [PS-MCP 手动调用](../psd2ui/PS-MCP/README.md)和 [Skill 连接参考](../.agents/skills/psd2ui-export-workflow/references/connection.md)。这条路线不要求把 Skill 安装到固定目录。

实际可用性以本机 Check、客户端 status 和目标 PSD 的操作结果为准；本文命令与示例用于指导接入。
