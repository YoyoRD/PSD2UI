# PSD2UI

**把 UI PSD 整理成程序可以继续使用的图片、布局和组件配置。**

PSD2UI 是一套 Photoshop 内的 UI 制作与交付工具。美术在 PSD 中标明“哪个组是按钮、哪一层是背景、哪个条目是列表模板、哪些组表示选中状态”，插件将这些信息连同图片、文字和布局一起导出为 **JSON + PNG**。程序端读取这份交付数据，再映射到自己的 UI 框架。

你可以直接操作 Photoshop 面板，也可以接入 AI，让它先分析真实图层和已有配置，再按你确认的方案整理 PSD、配置组件并导出。

## 解决什么问题

制作游戏 UI 时，PSD 往往只有画面，没有程序需要的组件用途。按钮背景和文字需要人工辨认，列表模板与展示样例容易混在一起，切图、尺寸和布局需要重复记录；设计改版后，还得重新说明哪些地方发生了变化。

| 常见问题 | PSD2UI 的处理方式 |
| --- | --- |
| 美术和程序对组件结构理解不同 | 在 PSD 中保存组件类型、角色、模板和状态，随 JSON 一起交付 |
| 切图后还要手工记录位置、尺寸、文字等信息 | 从当前 PSD 读取布局和视觉参数，统一导出图片与配置 |
| 列表的展示样例被当成真实条目 | 明确指定完整条目模板，把其他条目标记为仅预览 |
| 公共图片重名、重复导出或被意外替换 | 按资源模块管理图片，导出时检查像素和参数，符合条件才复用 |
| 改版后难以判断现有配置是否仍适用 | 读取实时图层与已保存配置，由人工或 AI 对照分析再处理 |
| 希望 AI 帮忙，但缺少真实的 Photoshop 操作接口 | MCP 提供图层读取、配置、受控结构修改和导出工具，Skill 组织处理流程 |

**本仓库交付到 Photoshop 端的 JSON/PNG 为止，不包含 Unity Adapter 或 Prefab 生成器。** 接入 Unity 需要补齐导入、控件映射和项目路由，具体见后面的「接入 Unity」。

## 仓库里包含什么

| 部分 | 给谁用 | 负责什么 |
| --- | --- | --- |
| Photoshop 面板 | 美术、UI 制作者 | 查看当前选择，配置组件、角色、模板、状态，检查并导出 |
| Core / Contracts | 工具维护者、引擎接入者 | 公共配置与导出规则、JSON Schema |
| PS-MCP | AI 客户端 | 将插件能力作为本地工具提供给 AI |
| Skill | 使用 AI 处理 PSD 的人 | 规定分析、确认、配置、导出与续做步骤，支持不同任务终点 |

```text
手动操作面板 ───────────────────┐
                              ↓
AI 客户端 → Skill + PS-MCP → Photoshop / PSD
                              ↓
                      JSON + PNG 交付目录
                              ↓
                 项目自己的 Adapter → Prefab / UI
```

面板、MCP、Skill 是三个不同部分：安装面板即可手动使用；接入 MCP 后 AI 才能调用工具；加载 Skill 后 AI 才有这套处理流程。只复制 Skill 不会安装另外两部分。

## 选择适合你的版本

| 你的 Photoshop | 选择的版本 | 打开面板的位置 |
| --- | --- | --- |
| Windows Photoshop CC 2019（20.0.4） | [CEP 版 · main](https://github.com/YoyoRD/psd2ui/tree/main) | 窗口 → 扩展功能 → PSD2UI |
| Photoshop 25.0 及以上 | [CCX 版 · ccx](https://github.com/YoyoRD/psd2ui/tree/ccx) | 插件 → PSD2UI |

CEP 以 PS 20.0.4 为目标版本；其他 Photoshop 版本的兼容性需要在实际环境中确认。两版安装方式不同，请按对应分支的说明操作。

当前页面是 **CEP 版 0.3.8** 的使用说明。

## 安装 CEP 版

### 已有安装包

1. 关闭 Photoshop。
2. 将 `PSD2UI-CEP-0.3.8-Windows-Install-r2.zip` **完整解压**到普通文件夹。
3. 双击解压后的 `Install.cmd`，等待安装完成。
4. 重新打开 Photoshop，在「窗口 → 扩展功能 → PSD2UI」打开面板。

安装包可以离线使用，不需要管理员权限、Creative Cloud Desktop、开发工具或独立 Node.js。更新版本时也使用相同的安装入口，旧插件会自动备份。更多说明见 [安装与更新](psd2ui/scripts/cep-install/README.md)。

### 没有安装包，只有仓库源码

仓库包含已经生成的面板，可以直接生成安装包：

1. 在当前 `main` 分支点击 **Code → Download ZIP**，解压源码；也可以使用 Git 克隆仓库。
2. 在包含本 README 的目录打开 Windows PowerShell，运行：

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\psd2ui\scripts\package-cep.ps1 -SkipBuild
   ```

3. 从 `psd2ui/dist/` 找到生成的 `PSD2UI-CEP-0.3.8-Windows-Install-r2.zip`，按上面的安装步骤操作。

首次生成安装包需要联网下载 Adobe 签名工具，无需重新构建面板或安装 Node.js。源码 ZIP 本身不是安装包；源码中的 `Install.cmd` 需要打包生成的签名文件和清单，不能单独运行。

## 完成第一次导出

### 1. 打开并准备 PSD

打开一份 UI PSD，先保存到本地。在面板的「准备 PSD」中填写「界面所属模块」，例如 `login` 或项目约定的模块名，然后保存配置。看到「已准备」后继续。

### 2. 配置需要的组件

普通图片、文字和分组可以直接读取。需要组件用途时，再选择相应图层或组进行配置：

- **按钮**：选择按钮所在的组，设置为按钮，指定背景图片和标题文字。
- **列表或网格**：选择外层组，用一个完整条目作为模板，将其余展示样例标记为「仅预览」。
- **视觉状态**：为普通、选中等状态指定对应的组，并选择默认显示状态。

复杂组件从里面向外面配置。例如商品条目里有购买按钮，先配按钮，再配商品列表。选择类型后记得保存，切换下拉框本身不会保存配置。

### 3. 检查图片名称

图片使用 `comm_bt_0032`、`i_diamond_small` 这类基础名；组名和文字内容可以使用中文。图片名称开头的模块名决定资源归属，例如 `comm_...` 图片进入 `comm` 目录。

旧版 `@...` 命名后缀不再表示功能。遇到命名、角色或资源冲突，面板会显示原因并帮助定位图层。

### 4. 导出并交付

进入「检查导出」，选择一个可写的输出文件夹，处理检查结果，然后点击「导出 JSON 与图片」。

导出后，你会得到类似这样的目录：

```text
交付目录/
├─ json/
│  └─ 登录界面.psd2ui.json
├─ sprite/
│  └─ comm/comm_bt_0032.png
└─ texture/
   └─ comm/comm_bg_0002.png
```

- `json/`：界面层级、布局、组件配置和图片引用。
- `sprite/`：作为 Sprite 使用的图片。
- `texture/`：作为独立纹理使用的图片。

**交付时保留整个目录结构**，让程序端能够根据 JSON 找到图片。输出文件夹可以自行命名。

PSD 旁还会生成 `*.psd2ui.authoring.json`，用于保存配置镜像。它与交付目录里的 JSON 用途不同；修改组件请使用插件面板。

详细操作见 [美术使用指南](psd2ui/docs/ARTIST_WORKFLOW.md)。图片分类和九宫规则见 [图片尺寸规范](psd2ui/docs/IMAGE_SIZE_STANDARD.md)。

## 配置和导出时需要了解的细节

### 组件类型与角色

支持 group、image、raw-image、text、button、input-field、toggle、list、grid、red-point、toggle-page-group、list-page-group 等 UI 语义。

组件类型表达“这是一个什么组件”，角色表达“内部各层做什么”。例如按钮组中，底图是背景角色、文字是标题角色；列表中的一个完整条目是模板。复杂组件需要配置角色和模板，不能只选一个类型。

普通嵌套组可以保留；一个内部组件的图层不能再被外层组件随意占作角色。复杂结构应从内向外配置。将图层设为 ignore 会排除整个子树，不能用它掩盖尚未分析的内容。

### 模板、预览、视口和状态

- **模板**决定一条列表项或一格内容的结构；条目内部也可以有按钮等组件。
- **仅预览**的样例保留在 PSD 中帮助排版，不作为额外正式条目导出。
- **列表/网格布局**记录方向、尺寸、间距和行列信息；不能从预览数量推断业务数据条数。
- **视口**表示组件可见区域，与条目尺寸分开设置。
- **视觉状态**保存 normal/selected 等状态组及默认状态；它描述初始显示，不负责游戏中的点击和状态切换。

### Sprite、Texture 与九宫

未手动指定用途的普通图片，面积达到 **262144 像素（512 × 512）**，或任意边长 **大于 2040 px** 时，默认作为 Raw Image/Texture；其余默认作为 Image/Sprite。判断依据是图层边界面积和最长边，不是“某一边达到 512 就算大图”。

手动指定的类型、九宫和必要 Image 角色优先保留。这个规则用于选择导出类型，不会自动缩小图片。

九宫图片填写左、上、右、下边框后，导出的 PNG 会压缩可拉伸区域，同时保留节点原始布局尺寸。程序导入时需要同时使用图片和边框配置，不能用缩小后的 PNG 尺寸替代布局尺寸。[详细规则](psd2ui/docs/IMAGE_SIZE_STANDARD.md)

### 模块、命名与重复资源

“界面所属模块”用于描述当前界面；每张图片自己的模块来自图片基础名。一个 shop 界面仍可以引用 comm 模块的公共图片，它们会进入 sprite/comm 或 texture/comm。

图片名需要符合检查规则，组名和文字内容允许中文。旧 @ 后缀没有功能含义。多份 PSD 共用同名资源时，像素、尺寸及相关导出参数一致才会复用；有冲突时应先核对来源，而不是让 AI 自动改名或覆盖。

### PSD 配置与交付文件

| 文件 | 用途 | 如何修改 |
| --- | --- | --- |
| PSD 内嵌 XMP | 保存这份 PSD 的创作配置 | 通过面板或 MCP 保存 |
| PSD 旁的 *.psd2ui.authoring.json | 配置镜像，便于查看与比对 | 不作为独立手工编辑入口 |
| 交付目录 json/*.psd2ui.json | 引擎消费的界面和资源数据 | 修改 PSD/配置后重新导出 |
| sprite/ 与 texture/ 下的 PNG | 实际渲染出的图片 | 随导出更新，保留目录结构一起交付 |

文本读取内容、有效字号、颜色、对齐和可读取的样式；字体文件与 fontKey 的映射由目标项目提供。不同 Photoshop 版本的字形、效果和颜色表现仍需在目标环境确认。

## 接入 AI 帮你处理 PSD

AI 通过本机 Photoshop 插件读取真实图层和配置，可以提出方案并执行已确认的处理操作。模型账号由你的 AI 客户端管理，插件本身不需要填写模型 API Key。

### 第一步：安装插件，准备 MCP

先完成上面的面板安装。AI 所在电脑需要 Node.js（20.x 至少 20.19，22.x 至少 22.12，或工具支持的更新版本）。本分支使用 Windows 自带 PowerShell 5.1；保持 CEP 面板打开，不需要 UDT。在仓库根执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Prepare
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Connect
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Check
```

Check 成功后再继续。此工具链运行在 Photoshop 所在电脑上；CEP 面板和工具进程还应使用同一 Windows 用户。

### 第二步：在 AI 客户端注册工具

选择你使用的客户端，把示例中的目录占位符替换为本机路径，合并配置并重新加载 MCP。

**Cursor**：用 Cursor 打开本仓库，合并到 .cursor/mcp.json：

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

**Codex**：合并 [codex-mcp.toml](docs/examples/codex-mcp.toml) 到 ~/.codex/config.toml 或可信项目的 .codex/config.toml。示例已经写明命令、参数和目录变量；不要覆盖已有其他配置。

这是 stdio MCP，客户端会启动 node 服务，不需要填写 localhost URL。若工具包放在另一个目录，使用它的 server.js 绝对路径。客户端配置来源、逐步说明及排错见 [AI 接入指南](docs/AI-SETUP.md)。

### 第三步：加载 Skill

[psd2ui-export-workflow](.agents/skills/psd2ui-export-workflow/SKILL.md) 支持：

| 本轮要求 | AI 应完成到哪里 |
| --- | --- |
| 只分析 | 当前完整结构、已有配置/差异、建议方案 |
| 只配置 | 按确认方案整理并保存 PSD/配置 |
| 配置并导出 | 保存 PSD，并返回本次 JSON/PNG 路径 |
| 继续任务 | 沿用已确认方案，完成剩余步骤 |

用客户端打开本仓库并选择该 Skill，或在请求中明确让 AI 读取它。若在其他项目使用，整体复制 Skill 文件夹及 references，MCP 仍指向完整工具包。**有 Skill 不等于已经连接 Photoshop**，还需要第二步配置和成功的 status 检查。

普通流程会在修改后读回相关配置；你明确要求“快速、不复测”时，才直接依据工具返回继续。它不会要求你为了处理 PSD 先准备 Unity 项目。

### 第四步：给出你的 PSD 和处理要求

可以先发送：

> 使用 psd2ui-export-workflow。先检查 Photoshop 连接，再分析 <PSD绝对路径>，包括隐藏层和已有配置。找出按钮、商品列表模板和视觉状态，给出整理建议，先不要修改。

看过方案后继续：

> 按已确认方案处理：商品条目里的购买按钮绑定底图和标题，第一条作为列表模板，其他展示条目标为仅预览。保存配置并导出到 <交付目录绝对路径>。

已配置的 PSD 也可以只改一处，或明确要求按当前配置导出。输入准确的 PSD 路径、目标效果和需要的终点；导出时给出目录，首次初始化时确认界面模块。无须提供 Unity 工程。

### AI 能力的具体边界

- 可以读取完整图层、文字/位置和已有配置，初始化新 PSD，配置类型/参数、组件角色、列表模板、预览、视口与视觉状态，执行受控结构计划并导出。
- CEP 分支支持受控移动、解组和删除，但需要确认外观变化，并按要求提供前置条件与后代清单。
- **已有 PSD 的模块名修改未开放到日常 MCP**，应在面板点击「保存所属模块」；不能用重初始化覆盖已有配置。
- 当前工具不提供任意绘画、滤镜处理或自由执行 JSX。AI 只能调用已提供的处理接口。
- 配置和导出会保存 PSD；AI 操作期间等待完成再手动编辑。写请求超时不代表取消，不能直接重复提交。
- 运行结果是 PSD 配置和 JSON/PNG，不包括 Unity Prefab 或业务交互。

## 接入 Unity

**仓库没有 Adapters、Unity Package 或“导入 JSON 自动生成 Prefab”的菜单。** 原 YoyoUI、SGUI Adapter 与各自框架的控件、程序集、字体、目录和业务结构紧密绑定，因此没有放进这个公开仓库。

项目需要实现或提供以下能力：

| 目标 | 需要补齐 |
| --- | --- |
| 生成基础画面 | JSON Reader、图片导入、坐标和绘制层序转换、Prefab 保存 |
| 正确显示资源 | Sprite/Texture 导入设置、九宫边框、字体和文字效果映射 |
| 生成复杂控件 | 按 semantic、roles、模板和布局创建项目自己的 UI 组件 |
| 支持重复迭代 | 资源/Prefab/图集目录配置、更新策略、GUID 与引用保留 |
| 游戏内交互 | 点击、数据绑定、状态切换、页面加载和业务代码 |

先支持分组、图片和文字可以接通最小流程，再逐步增加按钮、列表和状态。新交付从 json 文件所在目录解析 `../<kind>/<module>/<fileName>`，坐标与层序转换也需要明确实现。完整步骤见 [Unity 接入指南](docs/UNITY-INTEGRATION.md) 和 [数据契约](psd2ui/Contracts/README.md)。

## 文档与目录

- [美术使用指南](psd2ui/docs/ARTIST_WORKFLOW.md)：面板操作、组件角色和复杂列表。
- [AI 接入指南](docs/AI-SETUP.md)：客户端配置、Skill 安装、请求示例和常见问题。
- [Skill 操作参考](.agents/skills/psd2ui-export-workflow/references/operations.md)：十个日常工具、参数和能力边界。
- [PS-MCP 调用说明](psd2ui/PS-MCP/README.md)：终端调用、目录设置和底层入口。
- [版本来源与维护记录](docs/MIGRATION.md)：分支来源和验证状态。

```text
仓库根/
├─ README.md
├─ .agents/skills/psd2ui-export-workflow/
├─ docs/                         # AI 接入、配置示例、Unity 接入
└─ psd2ui/                       # 工具根：不是仓库根的别名
   ├─ Plus-ins/                  # Photoshop 插件
   ├─ Core/                      # 配置与导出规则
   ├─ Contracts/                 # JSON Schema
   ├─ PS-MCP/                    # AI 工具服务
   └─ scripts/                   # 连接、构建与打包入口
```

普通面板操作和 AI 调用都不要求 Unity 工程。旧版 PSD2UGUI 的 XML 导入器不能直接读取当前 JSON；版本目标和已有实现不代表所有 Photoshop 版本已经完成实机验证。
