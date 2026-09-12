# PSD2UGUI 维护边界

- `main` 是 CEP 版，`ccx` 是 UXP/CCX 版。来源与排除项见 `docs/MIGRATION.md`。
- 本仓库交付 Photoshop 配置与 JSON/PNG 导出工具，不包含 Unity Adapters、框架组件、项目路由或业务代码。不要从其他项目补拷这些内容。
- `psd2ui/Core` 是公共规则源；`Plus-ins/PSD2UI/generated/core` 是生成副本。CEP 的 `panel.js/index.html/style.css/THIRD-PARTY-LICENSES.txt` 由本分支构建脚本生成，不能手改。
- CEP 分支保留 `Plus-ins/PSD2UI` 作为构建所需的共享面板与导出源码，不能把它当作多余目录删除。两个分支的同名文件应按各自来源维护，不直接用另一个分支覆盖。
- 可复用 Skill 位于 `.agents/skills/psd2ui-export-workflow`，终点是导出 JSON/PNG；Unity 接入另见 `docs/UNITY-INTEGRATION.md`。
- 修改逻辑时按范围选择构建与检查。纯迁移和文档整理按用户要求可以不运行测试；如未运行 Photoshop/Unity，交付时必须如实说明，不能引用原仓库历史验收作为本次结果。
