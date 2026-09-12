# PSD2UGUI · CEP 9

将 PSD2UI 的 Photoshop 插件迁入原 PSD2UGUI 仓库：在 PSD 中配置组件、角色、列表模板和视觉状态，导出供引擎消费的 JSON 与 PNG。

当前分支是 **CEP 主版本**。面向 Photoshop CC 2019 的 CEP 9 宿主，普通美术使用不需要 Creative Cloud Desktop、UDT、外部 Node.js 或 AI。

**Adapters 不迁移。** 原 YoyoUI、SGUI Adapter 与各自 UI 框架、程序集和业务路由紧密绑定。本仓库可以完成 Photoshop 端配置和资源导出，**不提供开箱即用的 Unity Prefab 生成器**。Unity 接入缺口与最小实现顺序见 [Unity 接入说明](docs/UNITY-INTEGRATION.md)。

## 两个版本

| 分支 | 插件 | 宿主与安装方式 |
| --- | --- | --- |
| [main](https://github.com/YoyoRD/PSD2UGUI/tree/main)（主分支） | CEP 0.3.8 | Windows PS 20.0.4 / CC 2019 目标基线；签名 ZXP / 安装 ZIP |
| [ccx](https://github.com/YoyoRD/PSD2UGUI/tree/ccx) | UXP 0.2.0 | Photoshop 25.0+；UDT 开发加载 / CCX 安装 |

两者来自 PSD2UI 各自的已有分支，并非同一插件改后缀。迁移提交、文件一致性清单和排除项见 [迁移记录](docs/MIGRATION.md)。本次仅迁移源码、已有生成面板和安装脚本，整理分发配置与文档；没有运行构建、测试或实机验收，没有发布新的安装附件。

## 从源码运行 CEP

仓库已包含生成好的 CEP 面板，不必先安装 Node 或重新构建。以下操作在 Windows 上执行：

1. 获取主分支，在仓库根打开 PowerShell：

   ```powershell
   git clone --branch main https://github.com/YoyoRD/PSD2UGUI.git
   cd PSD2UGUI
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\psd2ui\scripts\package-cep.ps1 -SkipBuild
   ```

   此命令只对现有生成面板打包签名。首次会下载并校验 Adobe ZXPSignCmd，创建本机开发自签名证书；需要联网下载工具。证书和密码留在被忽略的 .tmp 中，不应随源码或安装包分发。

2. 在 `psd2ui/dist/` 找到 `PSD2UI-CEP-0.3.8-Windows-Install-r2.zip`，**完整解压到独立目录**。不要直接运行源码目录的 Install.cmd，它需要打包时生成的签名目录与清单。
3. 关闭 Photoshop，双击解压目录里的 `Install.cmd`。安装至当前用户的 `%APPDATA%\Adobe\CEP\extensions\com.yoyoengine.psd2ui.cep`；已有安装会由安装器备份。
4. 启动 Photoshop，从「窗口 → 扩展功能 → PSD2UI」打开面板。使用时保持面板打开。

如果已经拿到维护者生成的完整安装 ZIP，直接从第 2 步开始，可离线安装。打包得到的另一份 `.zxp` 是签名原包，不要改后缀当成 CCX。签名包无需设置 PlayerDebugMode；自签名不代表 Adobe 审核。

[CEP 安装、源码构建与限制](psd2ui/Plus-ins/PSD2UI-CEP/README.md) · [签名与分发](psd2ui/scripts/CEP-DISTRIBUTION.md)

清单允许的 Photoshop 版本范围比目标基线宽，这不是所有版本兼容承诺。本次未在 PS 20.0.4 或其他版本重新实机验证。

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

只手动用面板可跳过。默认连接已经打开的 CEP 面板。Windows 自带 PowerShell 5.1 即可，Node.js 仅供外部 MCP 使用。 外部 Node 需满足本分支脚本要求（20.x 至少 20.19，22.x 至少 22.12，或更新的受支持版本）。

在仓库根执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Prepare
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Connect
powershell.exe -NoProfile -ExecutionPolicy Bypass -File psd2ui/scripts/Invoke-Psd2UiPortable.ps1 -Operation Check
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

CEP 面板与 MCP 需要保持打开；不同 Photoshop 版本的文字、滤镜、效果和颜色结果仍可能不同。CEP 没有 UXP 原生 modal 排他锁，AI 操作期间应等待结束再手动编辑。

## 目录

- `psd2ui/Plus-ins/`：Photoshop 插件和共享面板源码。
- `psd2ui/Core/`、`Contracts/`：公共配置/导出逻辑与 Schema。
- `psd2ui/PS-MCP/`、`scripts/`：可选自动化、宿主连接和本分支的分发命令。
- `psd2ui/Tests/`：随原分支保留的测试源，本次没有运行。
- `.agents/skills/psd2ui-export-workflow/`：公开的 Photoshop 导出流程。
- `docs/UNITY-INTEGRATION.md`：Adapter 不分发的原因及接入清单。

原 Batch/Python、Export PSDUI.jsx、Demo 和旧 XML 工作流已替换，旧版本仍保留在 Git 历史中。
