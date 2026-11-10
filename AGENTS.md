# MarginLink 项目规则

## Git 交付约定

用户于 2026-11-10 明确授权并要求：以后每一次完整对话的项目修改，都必须提交并推送到远程仓库。此约定持续适用于本项目，无需每轮重新请求提交或推送许可。

- 远程仓库为 `https://github.com/DewMysimple/MarginLink.git`；初始主分支为 `main`，upstream 为 `origin/main`。每轮修改前重查实际分支、remote、upstream 和工作树，保全用户及其他任务的无关改动。
- 有项目改动时，完成适当验证，按记忆协议同步持久事实，审查 diff 并提交本轮已授权的改动，再推送当前分支到已核实的 upstream。新分支首次推送时建立 upstream。
- 收尾核对工作树和本地/远程分支提交 ID，最终回复说明提交、推送结果。推送失败时保留本地提交，明确说明失败和恢复方法；不得把仅有本地提交称为已同步。
- 纯问答或没有文件变化时不创建空提交。遵守 `.gitignore`，依赖、构建文件、隔离 profile、凭据不纳入提交。不要强推、改写已发布历史或覆盖他人改动。

## 开发与验证

- 产品约束以 `prompt/Obsidian_MarginLink_Codex_开发提示词.md`、后续用户要求及实际源码为依据。关系仅存于原生 Wikilink；记忆体系是工程文档，不能成为插件运行时关系数据。
- 只在项目内 `test-vault/` 和隔离 `test-profile/` 验证；不向正式 Vault 写入夹具。`scripts/setup-test-vault.mjs` 会重置测试内容。
- 源码行为变化按范围运行 `npm test`、`npm run lint`、`npm run build`；涉及渲染/交互时补充实际 Obsidian 验收。单纯文档或记忆维护不为刷新日期重跑业务测试。
- 不把已有报告说成本轮重测结果；桌面宿主告警与插件错误分开记录，保留未验证范围。

<!-- wiki-memory:start -->
## 工程记忆

本项目使用工程根目录下的 `wiki_memory/`。新会话读取 `wiki_memory/AGENTS.md` 和 `wiki_memory/README.md`。按协议区分只读窄查询与修改、接续等任务，后者先读取规定的当前状态与全局约束。已读且未变的内容可复用。
在已授权开发任务完成或中断时，按协议同步有证据的状态、验证和恢复下一步；只读任务遵守只读范围。
日常读取、同步和交接直接遵循项目协议，不调用 wiki-memory Skill。仅用户明确要求配置、迁移、体检等记忆管理时加载 Skill；检查频率按项目协议，不把完整验收用于每轮收尾。
<!-- wiki-memory:end -->
