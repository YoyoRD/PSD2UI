# 迁移来源与范围

公开仓库现名为 [PSD2UI](https://github.com/YoyoRD/psd2ui)，原名 PSD2UGUI。下文保留迁移时的项目名称以说明历史来源。

2026-09-12 将 PSD2UI 的两个现有分支分别迁入 PSD2UGUI，保留 PSD2UGUI 原 Git 历史。本次不修改插件、Core、Schema、MCP 或安装脚本的实现，不运行构建、测试、安装和 Photoshop/Unity 实机验证。

| 公开仓库分支 | 原工具仓库来源分支 | 来源提交 | 插件版本 |
| --- | --- | --- | --- |
| main | codex/cep9-migration（CEP9） | `ca9a5f06b6333a76d710c772dc23aeec5e10a7ef` | CEP 0.3.8 |
| ccx | main | `9eb46d0fda26bf873d80731b9d1b282dd3802570` | UXP 0.2.0 |

两个来源提交不同。CEP 分支包含其已有宿主兼容改动，不用 CCX 分支同名文件覆盖它。保留原插件 ID、版本、品牌和 XMP 命名空间，避免仅因仓库改名改变已有 PSD 配置身份。

## 保留

- Photoshop 插件源文件、图标与品牌资产；CEP 分支额外包含 CEP 宿主、现有生成面板、构建和签名安装脚本。
- Core、JSON Schema、可选 PS-MCP 与所需 Photoshop 桥接脚本。
- 原 Core、UXP、PS-MCP 测试源；CEP 分支额外保留 CEP 测试和安装检查脚本，仅供后续维护，本次没有运行。
- 对应分支的依赖锁文件；不复制 node_modules、会话凭据、临时记录或机器环境。
- 公共美术操作说明；原 Skill 的分析、确认、配置、导出部分提取为本仓库的导出 Skill。

保留原 `psd2ui/` 相对目录是为了维持 require、构建和桥接路径。每个分支的 [迁移清单](migration-manifest.json) 记录迁入原文件的来源路径和 SHA-256；其中不包含重写的 Markdown 和修改过的 package.json 分发脚本配置。文件一致只表示复制未改变内容，不表示代码或宿主运行验证通过。

## 排除与替换

- **整个 Adapters 目录不迁移**：包括 YoyoUI、SGUI、UnityPackage、文本效果包、Integration、业务 JSON、模板及同步目标。
- 排除 Unity 编译、同步、退役脚本及 Tests/Adapters。
- 原 export-cursor-environment.js 会打包 Adapters，因此不迁移；本仓库 Skill 不依赖其生成的 Cursor 环境。
- 排除旧仓库实施历史、私有项目验收样例、PSD 测试资源、本机路径与原项目 AGENTS。
- PSD2UGUI 旧的 Batch、Demo、JsCode 和旧 README 被本次内容替换；旧版本仍可从 Git 历史提交 `93570a15994b2d62e420883e94db0e327f44a803` 查看。
- 调整 package.json 的描述、移除 adapters:sync 和 Tests/Adapters 测试入口，其余命令仍保留；这属于分发配置调整。
- 重写 README、契约导读、框架边界与 Skill，避免要求读者安装未分发的 Unity 工具。

## 尚未交付

首次迁移没有生成或发布新的签名 ZXP、安装 ZIP、CCX，也没有创建 GitHub Release。CEP 的预生成面板已随源码保留；README 提供维护者签名打包路径。CCX 使用 Adobe UDT 打包。若 Releases 没有附件，应按源码步骤运行，不把 GitHub 的 Source code ZIP 当作插件安装包。

源仓库未提供本次可直接沿用的项目级 LICENSE；本次没有代作者选择新的授权协议。CEP 所含 pngjs 的第三方许可证原样保留，新增项目级许可证仍由维护者决定。

Unity 缺口与实现顺序见 [Unity 接入](UNITY-INTEGRATION.md)。当前交付结果是文件迁移，未声明功能、视觉或跨版本兼容已验证。

## 2026-09-26 CEP 后续同步

公开仓库继续保持 **main = CEP、ccx = UXP/CCX**。main 从源仓库 `origin/codex/cep9-migration` 的 `fd25502246bb6ca95fb9ab7ad3b06324a20ff3a2` 同步到 CEP 0.4.6；源仓库 UXP 分支 `origin/main` 仍为上表提交，因此本轮不修改公开仓库 ccx。

同步范围为 CEP 宿主、共享面板及其预生成文件、Core、Schema、对应 Core/UXP/CEP 测试源和通用打包脚本。详细文件与 SHA-256 见 [同步清单](sync-manifest.json)。继续排除整个 Adapters、Tests/Adapters、Unity 项目脚本、私有项目路径和验收样例。源仓库的内部同步/性能记录没有直接搬入公开文档。

唯一的源码适配是将公开版 `scripts/package-cep.ps1` 的默认输出从内部美术目录改为仓库内 `psd2ui/dist`；其余同步代码保持源提交内容（Windows 工作区行尾转换不改变代码语义）。CEP 新版直接交付平铺的签名安装目录，不再按旧说明输出外层 ZIP。README、安装说明、数据契约和 Skill 操作参考已相应更新；历史迁移清单仍记录 2026-09-12 的原始基线，不代表当前文件哈希。

本轮没有运行构建、签名打包、测试或 Photoshop/Unity 实机操作。源仓库历史验证与本次公开同步的结果分别看待；使用目标 Photoshop 时仍须自行确认面板加载、配置保存和 JSON/PNG 导出。
