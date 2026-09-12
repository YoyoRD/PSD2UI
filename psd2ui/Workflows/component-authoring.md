# PSD 分析、配置与导出

本仓库的可执行流程由 [psd2ui-export-workflow Skill](../../.agents/skills/psd2ui-export-workflow/SKILL.md)维护：连接检查 → 读取全树与配置 → 确定方案 → 按授权处理 → 按本轮要求保存或导出。

支持仅分析、仅配置、导出和续做。默认在修改后读回相关结果；明确要求快速/不复测时直接使用工具返回值。已有方案和明确授权不重复确认，新的改动范围另行确定。

首次准备见 [AI 接入指南](../../docs/AI-SETUP.md)。操作参数见 [Skill 操作参考](../../.agents/skills/psd2ui-export-workflow/references/operations.md)，宿主与终端入口见 [连接参考](../../.agents/skills/psd2ui-export-workflow/references/connection.md)。

本流程处理真实 PSD，终点是本次配置保存或 JSON/PNG 导出；Unity 接入由项目按 [接入指南](../../docs/UNITY-INTEGRATION.md)提供。
