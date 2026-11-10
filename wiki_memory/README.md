---
type: moc
status: active
updated: 2026-11-10
topic: memory-entry
sources: []
---

# 工程记忆导航

模式：`standard`；由用户在 2026-11-10 明确指定“构建标准记忆”，不是根据项目规模自动推断。配置见 [.memory.json](.memory.json)，工具及协议版本为 3.4.0、schema 2，导航采用相对 Markdown 链接。

本目录是唯一工程记忆根，可随 Git 仓库转移，维护工具不依赖个人 Skill 安装位置。本文仅导航；当前事实保存在五份状态页中。

修改、接续或跨分支任务：先读本协议和导航，再读[项目概览](当前状态/项目概览.md)、[当前约束](当前状态/当前约束.md)、[当前待办](当前状态/当前待办.md)，并重查 Git 状态；随后按任务补读架构、问题及决策。独立只读窄查询可直接定位主题和实际源码。

检索时优先搜索当前状态与有效决策；需要来由再查日志 MOC。可在项目根执行 `rg -n "关键词" wiki_memory src tests`，无需通读全部历史。历史验证不能替代当前分支验证。

日常开发直接遵循项目内协议，不调用 wiki-memory Skill；仅用户明确要求记忆管理时使用 Skill。

- [记忆维护协议](AGENTS.md)
- [工作日志 MOC](日志/MOC_工作日志.md)

维护命令在项目根执行：导航条目变化时用 `python wiki_memory/工具/memory.py index --project . --apply`；记忆有变化时用 `python wiki_memory/工具/memory.py check --project .`。初始化等完整验收改用 `check --project . --require-ready`，不重复普通检查。六类日志只用一个 MOC 汇总。

<!-- wiki-memory:auto:start -->

## 当前状态

- [已知问题](当前状态/已知问题.md) — active
- [当前待办](当前状态/当前待办.md) — active
- [当前约束](当前状态/当前约束.md) — active
- [系统架构](当前状态/系统架构.md) — active
- [项目概览](当前状态/项目概览.md) — active

- [工程决策目录](决策/MOC_决策.md) — 1 页，按主题或模块检索。

<!-- wiki-memory:auto:end -->
