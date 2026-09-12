# PSD2UI 数据契约

[psd2ui.schema.json](psd2ui.schema.json) 定义跨宿主的 JSON Bundle，不包含 Unity 或私有 UI 框架类型名。当前 source 命名链路输出 `schemaVersion: "1.5.0"`；历史分支兼容规则以 Schema 与 [Core/bundle.js](../Core/bundle.js) 为准。

- PSD 中的 XMP 是创作配置；同目录 `<PSD名>.psd2ui.authoring.json` 是配置镜像，不作为独立手工编辑入口。
- `json/<界面名>.psd2ui.json` 是交付 Bundle，包含 document、节点树、resources 等。
- 节点坐标相对父节点左上角，单位为像素；children 使用 Photoshop 前景到背景顺序。
- 图片使用正式基础名，忽略旧 @ 后缀的功能含义。资源的 kind/module/fileName 决定图片路径，多个 PSD 共享图片仍须通过导出器的像素与参数检查。
- 未手动配置的图片按 [图片尺寸规范](../docs/IMAGE_SIZE_STANDARD.md) 选择 Image/Sprite 或 Raw Image/Texture；人工类型、九宫和必要角色优先。
- semantic、structure.roles、模板、布局、预览与 visualStates 表达配置结果；不表达业务事件和数据绑定。
- 九宫导出的 PNG 已压缩可拉伸区域，目标端须保留节点原布局尺寸，并使用对应 sliceBorder。
- 1.5 的 text.layoutMode 区分 point 与 paragraph；fontSize 来自 Photoshop 有效字号，字体文件仍由目标项目映射。

本仓库没有 Unity Adapters。如何读取资源、转换坐标并补齐 Prefab 生成，见 [Unity 接入](../../docs/UNITY-INTEGRATION.md)。
