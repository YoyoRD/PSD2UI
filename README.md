# PSD2UGUI · UXP / CCX

将 PSD2UI 的 Photoshop 插件迁入原 PSD2UGUI 仓库：在 PSD 中配置组件、角色、列表模板和视觉状态，导出供引擎消费的 JSON 与 PNG。

当前分支是 **UXP / CCX 版本**。面向 Photoshop 25.0+；CCX 是 UXP 插件的分发格式。普通面板操作不需要 Node.js、MCP 或 AI。

**Adapters 不迁移。** 原 YoyoUI、SGUI Adapter 与各自 UI 框架、程序集和业务路由紧密绑定。本仓库可以完成 Photoshop 端配置和资源导出，**不提供开箱即用的 Unity Prefab 生成器**。Unity 接入缺口与最小实现顺序见 [Unity 接入说明](docs/UNITY-INTEGRATION.md)。

## 两个版本

| 分支 | 插件 | 宿主与安装方式 |
| --- | --- | --- |
| [main](https://github.com/YoyoRD/PSD2UGUI/tree/main)（主分支） | CEP 0.3.8 | Windows PS 20.0.4 / CC 2019 目标基线；签名 ZXP / 安装 ZIP |
| [ccx](https://github.com/YoyoRD/PSD2UGUI/tree/ccx) | UXP 0.2.0 | Photoshop 25.0+；UDT 开发加载 / CCX 安装 |

两者来自 PSD2UI 各自的已有分支，并非同一插件改后缀。迁移提交、文件一致性清单和排除项见 [迁移记录](docs/MIGRATION.md)。本次仅迁移源码、已有生成面板和安装脚本，整理分发配置与文档；没有运行构建、测试或实机验收，没有发布新的安装附件。

## 从源码运行 UXP

1. 获取此分支：

   ```powershell
   git clone --branch ccx https://github.com/YoyoRD/PSD2UGUI.git
   cd PSD2UGUI
   ```

2. 安装并打开 Photoshop 25.0+ 和 [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/guides/devtool/)，启用 UDT 与 Photoshop 的 UXP 开发模式；如宿主提示，重启 Photoshop。
3. 在 UDT 中 Add Plugin，选择本仓库的 `psd2ui/Plus-ins/PSD2UI/manifest.json`，执行 Load。
4. 在 Photoshop 的「插件」菜单打开 PSD2UI，打开并先保存一份本地 PSD。

本分支已包含 generated/core，开发加载无需 npm install 或构建。不要把 index.html 直接作为网页打开，它依赖 Photoshop UXP 宿主。

## 打包与安装 CCX

在 UDT 中选择该插件的 Actions → Package，生成 `.ccx`。接收方双击 CCX，由 Creative Cloud Desktop 完成安装，再从 Photoshop「插件」菜单打开 PSD2UI。用于对外分发的插件 ID 需由维护者按 Adobe 分发规则准备；本次保留原 manifest 的 ID 和版本，没有更换或登记 ID。

仓库源码 ZIP 不是 CCX 安装包，不要直接改名。操作依据：[Adobe 打包说明](https://developer.adobe.com/photoshop/uxp/guides/distribution/packaging-your-plugin/)和 [UXP 安装说明](https://developer.adobe.com/uxp/guides/how-to/distribution/install/)。

本次未生成新的 CCX，也未运行 UDT 或 Photoshop 安装验证。

## 第一次导出

1. 打开已保存的本地 PSD，进入「准备 PSD」，填写项目约定的界面所属模块，保存配置。
2. 普通图片和文字可自动读取。需要按钮、输入框、开关、列表等结构时，选择对应组并配置角色、模板及预览。复杂组件从内部向外配置。
3. 图片沿用正式基础名，例如 `comm_bt_0032`；组和文字可用中文。旧 `@...` 后缀被忽略，不再作为功能指令。首次配置或导出会准备文档身份。
4. 在「检查导出」选择一个可写的交付目录，处理面板报告的问题，执行「导出 JSON 与图片」。

```text
交付目录/
  json/界面名.psd2ui.json
  sprite/comm/comm_bt_0032.png
  texture/comm/comm_bg_0002.png
```

图片按自身 kind/module 归档，文件夹名称不必是 UIRes。配置写在 PSD 内嵌 XMP，并同步到 PSD 旁的 `<PSD名>.psd2ui.authoring.json`；它与交付 Bundle 用途不同，不要直接编辑该镜像代替面板配置。

完整操作见 [美术工作流](psd2ui/docs/ARTIST_WORKFLOW.md)、[图片尺寸规范](psd2ui/docs/IMAGE_SIZE_STANDARD.md)和 [数据契约](psd2ui/Contracts/README.md)。

## 可选 AI / MCP

只手动用面板可跳过。此分支通过 Adobe UDT 连接 UXP 插件，需要 PowerShell 7（pwsh）及运行中的 Photoshop/UDT。 外部 Node 需满足本分支脚本要求（20.x 至少 20.19，22.x 至少 22.12，或更新的受支持版本）。

在仓库根执行：

```powershell
pwsh -NoProfile -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation InstallDependencies
pwsh -NoProfile -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Connect
pwsh -NoProfile -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Check
```

首次准备与工作流检查分开：依赖和插件准备好后，日常只执行 Check，再读取 PSD。完整调用、创作目录配置与导出例子见 [PS-MCP](psd2ui/PS-MCP/README.md)。

从原 Skill 提取了 [psd2ui-export-workflow](.agents/skills/psd2ui-export-workflow/SKILL.md)，包含完整分析、人工确认、配置和导出，终点是 JSON/PNG。Skill 放在本仓库 `.agents/skills/`，保留其中相对引用；使用其他 AI 客户端时也可直接读取该文件及引用文档。没有分发原来包含私有 Adapter 的整套 Cursor 包。

## 还缺什么

| 事项 | 当前状态与接手方式 |
| --- | --- |
| Photoshop 配置、JSON/PNG 导出 | 已迁移现有实现；按上方启动流程使用，本次未实机验证 |
| Unity Reader / Prefab Builder | 未包含，需项目自己实现或提供兼容导入器 |
| UI 框架控件、列表/页面、字体效果 | 未包含，按 Schema 映射到项目组件 |
| Assets/Prefab 路径、字体、Sprite Atlas | 项目自行配置，不带原私有路由 |
| 数据绑定、点击事件、页面加载、业务代码生成 | 不属于 Photoshop 导出，需要项目接线 |
| 签名安装附件与版本兼容验收 | 本次未制作或发布；按各分支说明打包并在目标环境验证 |

本分支没有 CEP 宿主，不能安装到 PS 2019 的扩展功能目录。需要该宿主请切换 main 分支。

## 目录

- `psd2ui/Plus-ins/`：Photoshop 插件和共享面板源码。
- `psd2ui/Core/`、`Contracts/`：公共配置/导出逻辑与 Schema。
- `psd2ui/PS-MCP/`、`scripts/`：可选自动化、宿主连接和本分支的分发命令。
- `psd2ui/Tests/`：随原分支保留的测试源，本次没有运行。
- `.agents/skills/psd2ui-export-workflow/`：公开的 Photoshop 导出流程。
- `docs/UNITY-INTEGRATION.md`：Adapter 不分发的原因及接入清单。

原 Batch/Python、Export PSDUI.jsx、Demo 和旧 XML 工作流已替换，旧版本仍保留在 Git 历史中。
