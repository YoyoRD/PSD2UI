# Unity 接入：本仓库未包含的部分

**本仓库没有 Adapters，也没有可直接安装的 Unity Package 或通用 UGUI 导入器。** 安装 Photoshop 面板可以配置 PSD 并导出 JSON/PNG；生成 Unity Prefab 还需要你自己的 Editor 导入端。旧 PSD2UGUI 的 XML、@ 命名规则和 quicktool/psdimport 菜单不属于当前流程。

原 YoyoUI、SGUI Adapter 绑定各自的控件、程序集、字体、业务目录、列表/页面框架及图集策略。复制这些实现无法成为其他项目可用的通用导入器，因此整个 Adapters 目录及其同步脚本都不分发。

## 接口已有，目标端需要补齐

| 已导出信息 | Unity 端需要实现 |
| --- | --- |
| Schema 1.5.0、document、节点树与稳定资源 ID | JSON Reader、版本判断、输入诊断和错误报告 |
| 父节点左上角像素坐标、尺寸、可见性、透明度 | RectTransform 坐标和锚点转换，初始显示与透明度映射 |
| children 从前景到背景排列 | 显式转换为 UGUI 的 sibling/绘制顺序 |
| image / raw-image、resourceId、图片种类与九宫边框 | Sprite/Texture 导入、Image/RawImage 绑定、边框顺序转换、纹理导入设置 |
| 文本、字号、颜色、对齐、fontKey、layoutMode、效果 | 项目字体路由、Text 或 TMP 映射、点/段落文本排版、描边阴影等效果支持 |
| button、toggle、input-field、list/grid 等 semantic 与 structure.roles | 项目实际控件创建、角色引用和模板/Item Prefab 构建 |
| visualStates 与默认可见性 | 初始状态生成；运行时切换、事件和数据绑定由业务实现 |
| document.module、资源自己的 module | PSD/交付根、Assets 目录、Prefab 目录及 Sprite Atlas 路由配置 |
| 同一 PSD 再导出的稳定身份 | 更新规则、GUID/引用保留、工具所有权、失败时的恢复边界 |

`schemaVersion`、字段定义和枚举以 [Schema](../psd2ui/Contracts/psd2ui.schema.json) 为准，[Core/bundle.js](../psd2ui/Core/bundle.js) 是生成端参考。不要把同目录 `*.psd2ui.authoring.json` 当作最终 Bundle，它是 PSD 内嵌配置的镜像。

## 建议先接通的最小流程

1. 用面板导出一张简单界面，输入选择 `json/<界面名>.psd2ui.json`。
2. 遍历 `resources`，从 JSON 所在目录解析 `../<kind>/<module>/<fileName>`。kind 是 sprite 或 texture；模块取每个资源自身的 module，公共 comm 图片仍在 comm 目录。
3. 将图片导入项目明确配置的 Assets 目录。先支持 group、image、raw-image 和 text，完成层序、坐标与资源绑定；为未支持的语义给出具体诊断。
4. 使用 Unity Editor API 保存 Prefab；重复导入应有明确的更新/新建策略并保留现有资产引用。不要直接手写 Prefab 或 meta 文本。
5. 基础画面可用后，再补组件角色、九宫、列表模板、状态、字体效果和可选图集；业务事件、页面加载及数据接线独立完成。

为最小导入端定义输出目录即可先运行，不要求一开始支持所有框架控件或自动图集。要承接已有项目资产，需要由该项目确认路由和更新策略。本仓库不提供上述 Reader/Builder 的实现，Schema 文件本身也不会自动生成 Unity 代码。

## 导出布局

```text
交付目录/
  json/界面名.psd2ui.json
  sprite/comm/comm_bt_0032.png
  sprite/item/item_007.png
  texture/comm/comm_bg_0002.png
```

图片来自自身 kind/module，`fileName` 是纯文件名。原 Adapter 的兼容顺序是：json 子目录 Bundle 先找模块目录，再找旧的类型目录；旧根目录 Bundle 先找相邻 PNG，再找模块/类型目录。若需要兼容旧交付，可按此顺序实现，不跨 sprite/texture 随意找同名文件。

九宫 PNG 的可拉伸行列已经压缩，不能拿 PNG 像素大小替代节点布局尺寸。组名、文字允许中文，旧 @ 后缀没有功能含义，不能据此推断 UI 控件或图集路由。
