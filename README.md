# PSD2UI

在 Photoshop 中整理游戏 UI，配置组件并导出图片与布局数据，让美术和程序围绕同一份 PSD 协作。

你可以直接在面板中配置按钮、输入框、开关、列表模板和视觉状态，再导出 **PNG 图片 + JSON 配置**。日常操作不需要 AI；如果希望让 AI 协助分析和配置 PSD，也提供可选的 MCP 接口。

插件负责 PSD 配置和 JSON/PNG 导出，**仓库不包含 Unity 导入器**。需要生成 Prefab 时，项目还要提供自己的 Adapter；具体接入内容见下方「接入 Unity」。

## 选择适合你的版本

| 你的 Photoshop | 选择的版本 | 打开面板的位置 |
| --- | --- | --- |
| Windows Photoshop CC 2019（20.0.4） | [CEP 版 · main](https://github.com/YoyoRD/psd2ui/tree/main) | 窗口 → 扩展功能 → PSD2UI |
| Photoshop 25.0 及以上 | [CCX 版 · ccx](https://github.com/YoyoRD/psd2ui/tree/ccx) | 插件 → PSD2UI |

CEP 以 PS 20.0.4 为目标版本；其他 Photoshop 版本的兼容性需要在实际环境中确认。两版安装方式不同，请按对应分支的说明操作。

当前页面是 **CCX 版 0.2.0** 的使用说明。CCX 是 Photoshop UXP 插件的安装包格式。

## 安装 CCX 版

### 已有 CCX 安装包

1. 双击 `.ccx` 文件，按 Creative Cloud Desktop 的提示完成安装。
2. 打开 Photoshop 25.0 或更高版本。
3. 在「插件」菜单中打开 PSD2UI。

### 没有安装包，只有仓库源码

可以通过 Adobe 的开发工具直接加载面板：

1. 在当前 `ccx` 分支点击 **Code → Download ZIP**，解压源码；也可以使用 Git 克隆此分支。
2. 安装并打开 [Adobe UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/guides/devtool/)。
3. 启用 UDT 和 Photoshop 中的 UXP 开发模式，按提示重启 Photoshop。
4. 在 UDT 中点击 **Add Plugin**，选择源码里的 `psd2ui/Plus-ins/PSD2UI/manifest.json`，然后点击 **Load**。
5. 在 Photoshop 的「插件」菜单中打开 PSD2UI。

仓库已包含面板运行所需的生成文件，加载源码无需安装 Node.js 或运行构建命令。GitHub 下载的源码 ZIP 不能通过改后缀变成 CCX。

需要制作 CCX 安装包时，在 UDT 中选择该插件的 **Actions → Package**。对外分发的插件 ID 与安装规则见 [Adobe 打包说明](https://developer.adobe.com/photoshop/uxp/guides/distribution/packaging-your-plugin/)。

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

## 接入 Unity

**仓库不包含 Adapters，也不提供可直接生成 Prefab 的 Unity 菜单或 Package。**

原有的 YoyoUI、SGUI Adapter 与对应 UI 框架的控件、程序集和项目配置紧密绑定，因此不随插件提供。接入其他项目时，需要由程序实现或提供兼容的导入器：

| 你希望得到的结果 | 项目需要补齐的部分 |
| --- | --- |
| 还原基本 UI 画面 | 读取 JSON、导入图片、转换坐标和层序、创建并保存 Prefab |
| 正确显示图片和文字 | Sprite/Texture 设置、九宫边框、字体映射和文字效果 |
| 生成按钮、列表、页面等组件 | 将组件类型、角色和模板映射到项目的 UI 控件 |
| 支持项目迭代 | 资源/Prefab 目录、图集策略、重复导入和引用保留规则 |
| 在游戏中交互 | 点击事件、数据绑定、状态切换和页面加载等业务逻辑 |

可以先接通普通分组、图片和文字，得到基础 Prefab，再逐步补充复杂组件。数据格式与接入顺序见 [Unity 接入指南](docs/UNITY-INTEGRATION.md)和 [JSON 数据契约](psd2ui/Contracts/README.md)。

## 用 AI 协助制作 UI（可选）

AI 可以读取完整图层树和已有配置，提出整理方案，在你确认后执行配置与导出。手动使用面板时可以跳过这一部分。

程序端需要外部 Node.js、PowerShell 7 和 UDT 连接。先完成上面的插件加载，再按 [PS-MCP 使用说明](psd2ui/PS-MCP/README.md)准备连接。

导出流程可参考 [psd2ui-export-workflow Skill](.agents/skills/psd2ui-export-workflow/SKILL.md)。这个流程到 JSON/PNG 导出为止；Unity 生成和业务开发仍由目标项目承接。

## 更多说明

- [美术使用指南](psd2ui/docs/ARTIST_WORKFLOW.md)：组件、角色、列表和状态的具体操作。
- [图片尺寸规范](psd2ui/docs/IMAGE_SIZE_STANDARD.md)：Sprite、Texture 与九宫的选择。
- [Unity 接入指南](docs/UNITY-INTEGRATION.md)：导入器需要实现的功能。
- [PS-MCP 使用说明](psd2ui/PS-MCP/README.md)：AI 连接、调用参数和异常处理。
- [版本来源与维护记录](docs/MIGRATION.md)：源码来源、分发范围与验证状态。

如果你使用过旧版 PSD2UGUI，请注意：现在导出的是 JSON/PNG，旧的 XML 导入工具不能直接读取这套数据。
