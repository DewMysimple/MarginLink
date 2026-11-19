# 同名附件替换审计

2026-11-19，在 Windows NTFS 对本次起点 0.3.2 核实。

| 核查项 | 基线结果 |
| --- | --- |
| Git 与构建 | `git status --short --branch` 为 `codex/test01`，仅有既存未跟踪 v0.3 提示词；`git branch --show-current` 和 `git log -1 --oneline` 确认 HEAD 为 4546bb6。origin 的 fetch/push 均为 DewMysimple/MarginLink；远端 main 同 revision，此工作分支尚无 upstream。修改前 npm test 54 文件、535 项通过，lint、build 均通过。 |
| 目录与文件名 | src/ui/file-picker.ts 的 FilePicker.folderSelect 复用三个预设位置和根目录，showImport 用 attachmentPath 校验目录、扩展名及 Wikilink 可表示性。库内绝对路径走 inspect.vaultPath。普通关键字才走模糊搜索。 |
| 入口与冲突 | SelectionAction.openOperation 经 FilePicker.showLocalFile、showImport 调用 LocalFileImporter.move。基线 UI 用 getFileByPath 提供「使用已有文件」，磁盘未索引的冲突则由 open(wx) 的 EEXIST 拒绝。测试 uses exclusive target creation 明确证明未授权不能覆盖。 |
| 解析与写入 | ImportHost.resolve 的泛型在 UI 中是 TFile。getFileByPath 能立即返回已存在的旧对象，单凭对象存在不能确认刷新。commit 调用 actions.existing，进而 exactTarget、formatWikilink 或 relinkText、prepareEdit.replace 和一次 editor.transaction，核对完整原文。它并非只读确认。 |
| 类型边界 | file-recognition.ts、file-capabilities.ts 负责注册及打开能力，link-resolver.ts 分别负责原生解析及精确建链，link-formatter.ts 校验表示形式。替换不需要扩展查看器或调整 relink.ts。 |
| 写入与缓存 | 基线没有可复用的原子大文件覆盖封装。Vault.modifyBinary 接受整个 ArrayBuffer；既有导入的 1 MiB 循环、sync、SHA-256 和身份检查更适合。main.ts 的公开 Vault modify 事件已按路径清除 target-preview.ts 的有界摘要缓存，metadataCache.changed 提供 Markdown 变更。 |
| 身份与取消 | inspect 保存源 realpath、dev/ino、size、mtimeNs、ctimeNs；move 复核并且只在 commit 和副本校验后删除来源。旧目标需要单独的确认快照，关闭 picker 的 AbortSignal 可以复用。 |
| Windows 依据 | 在项目 test-vault 的同目录测试中，Node 24.16.0 rename 成功替换 Report.HTML，目录只有原文件名；用 .NET FileShare.None 锁住后 rename 返回 EPERM，目标仍为前次完整内容。Node/libuv Windows 使用 MoveFileExW 的 REPLACE_EXISTING，同目录避免跨设备复制。权限、共享模式会导致调用失败，不能退化到先删除。见 [libuv 实现](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c) 和 [Microsoft 参数说明](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)。 |
| 测试与缺口 | tests/local-file-import.test.ts 以注入 fs.open、write、unlink 等模拟中断、独立写入、取消、EXDEV 与来源占用。tests/file-picker.test.ts 检查重复点击和关闭。scripts/desktop-link-actions.mjs 曾验证旧的同名分支；desktop-relink.mjs、desktop-test.mjs 和 VALIDATION 的 0.2.16–17、0.3.x 是回归入口。基线没有实际替换、同尺寸缓存刷新或发布后部分成功的覆盖。 |
