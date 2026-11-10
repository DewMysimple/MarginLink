# MarginLink v0.2.0 验证记录

日期：2026-11-10。检查针对 Git 基线 `2b6ab729c9307217ec14c2d4fcaaf8703d04c247` 加本轮 v0.2 本地改动；提交后可从对应提交追溯。桌面仅使用本工程 `test-vault/`、`test-profile/`，未安装到用户正式 Vault、未修改 Obsidian 程序本体。

## 环境和真实结果

Windows PowerShell；Node 24.16.0、npm 12.0.1、Git 2.54.0、Python 3.14.2。程序 `D:\SoftWare\Obsidian\Obsidian.exe`：内置 1.10.6 与已有 1.15.0 更新包分别在隔离 profile 实测。测试临时停用的仅为隔离 profile 中复制的更新包，结束已恢复；用户普通 profile 不变。公开类型依赖仍为锁文件中的 `obsidian@1.14.4`。

| 实际命令/检查 | 结果与范围 |
| --- | --- |
| `npm ci` | 成功；npm 阻止 esbuild 安装脚本的提示仍存在，平台二进制实际可构建，未为此更改执行许可 |
| `npm test` | **8 文件、90 项通过**；原有 52 项与新增 38 项 |
| `npm run lint` | 通过，覆盖 src/tests/scripts |
| `npm run build` | 通过，包含严格 TypeScript 检查及 esbuild CJS 构建 |
| `npm run package` | 通过，再次构建并生成安装目录及 bundled 依赖许可证 |
| PowerShell `Compress-Archive` | 生成 `dist/margin-link-0.2.0.zip`，52,695 字节，含 margin-link 根文件夹 |
| `npm run test:desktop`，Obsidian **1.10.6** | **44 场景通过，0 未预期异常，0 宿主告警** |
| `npm run test:desktop`，Obsidian **1.15.0** | **44 场景通过，0 未预期异常，18 已知宿主/CDP 告警**，下文单列 |
| `restart-layout-check.mjs prepare/verify` | 完全退出隔离应用、确认主进程终止、重新启动后，自定义位置与 UI 数据恢复；实际手动卡片出现，所有测试 Markdown SHA-256 保持一致 |
| `host-window-control.mjs` | 确认插件 overlay 为 0 后重复编辑器设置开关/关窗，仍有 6 条相同宿主诊断；恢复插件和测试偏好 |

最终发布目录的 `main.js / manifest.json / styles.css` 与源码根、测试插件目录按 SHA-256 核对一致。最终 bundle 的 SHA-256 为 `9C3813175C9334FC4EBF08108BCB51F27B4E978A3A65C8C7B7FF072B2FC40F59`。package、manifest、锁文件与 versions.json 的版本统一为 0.2.0，minAppVersion 保留实际完整运行过的 1.10.6。

## 验收与证据对应

原 26 项回归继续覆盖：已有双链逐次呈现、代码/嵌入排除、双向高亮、精确建链及撤销/重做、取消/过期保护、左右建链拖放、三模式、精确同名文件、未解析/HTML 安全、不同文件分屏、窄窗、键盘打开、阅读歧义、滚动、rename/delete 刷新、主题、表格拒绝、偏好开关、禁用再启用。

新增 18 个桌面场景（单个场景可能包含多组参数）：

1. 原生五组设置、旧偏好迁移、原生设置与快捷/完整表单共享状态，实时预览路径更新。
2. 三种线型、三种显示模式、宽度/透明度/预设色即时反映；none 保留七张卡片。
3. 三形状 × 三尺寸，实际 DOM 宽高与布局一致，边界及碰撞检查。
4. 实际 Pointer 拖动改变位置与连线，原文不变，刷新/客户端重载恢复相同位置。
5. Esc、pointercancel、window blur、无效放置、握柄单击均不写入或跳转。
6. 阅读模式跨侧移动，方向键及 Delete 恢复；源码模式与 Live Preview 共用合法位置。
7. snap 对齐/避让反馈，重复目标的独立 UI 记录。
8. 宽窄恢复、24px 字体/38px 行高与 1.5 deviceScaleFactor 的局部几何安全。
9. 同笔记两个 leaf 独立裁剪；不同笔记分屏由原回归覆盖。
10. 当前笔记/全部位置清除的确认与取消；当前清除保留另一笔记记录。
11. free 模式下原选区手柄继续精确写入 Wikilink，无行为冲突。
12. 两侧栏、限制行宽开/关后的边界；动画期间暂隐后恢复。
13. 三处相同别名分别拖动；远处插入前文保留身份，删除同原文链接后安全失效。
14. rename 安全失效；活动文件切换和文档变化取消拖动。
15. 120 条链接只渲染可见项，滚动至末尾对应实际锚点；稳定期 300ms DOM 变更数量小于 100，防止持续 rAF 自触发反馈。
16. 正方形/图标的原生亮暗主题与减少动画，真实截图。
17. 拖动中禁用移除 overlay/宿主类/高亮/提示，再启用正常；关闭快捷面板清除其 DOM。
18. 实际删除测试插件 data.json 并重载，从原生双链重建七张卡片，Markdown 字节不变。

纯函数测试补充损坏/越界/恶意键、未知 schema、旧四项迁移、数值范围、最多 500/每笔记 100 条/90 天过期、去重、唯一上下文弱匹配、重复歧义拒绝、相对位置往返、字体/滚动/视口裁剪、auto 忽略手动数据、三线型端点及非法几何。

证据文件：

- [1.10.6 最终桌面报告](artifacts/desktop-v2-1.10.6.json)、[原始诊断](artifacts/desktop-v2-diagnostics-1.10.6.json)。
- [1.15.0 最终桌面报告](artifacts/desktop-v2-1.15.0.json)、[原始诊断](artifacts/desktop-v2-diagnostics-1.15.0.json)。
- [完全退出/重启检查](artifacts/v2-restart.json)、[新设置窗口对照](artifacts/v2-host-control.json)。
- [正方形](artifacts/v2-square.png)、[拖动](artifacts/v2-dragging.png)、[亮色](artifacts/v2-light.png)、[图标](artifacts/v2-icon.png)、[完整设置](artifacts/v2-settings.png)、[快捷控制](artifacts/v2-quick.png)。全部来自实际隔离 Obsidian，已目视检查代表性布局与设置截图。

## 1.15.0 宿主告警

本机旧安装程序 + 1.15.0 更新包在 CDP 下关闭原生独立设置窗口时，出现无堆栈字符串 `illegal access`，CDP 特征为 `scriptId: 1 / lineNumber: 0 / app://obsidian.md/index.html`。本轮扩展了两组主题及一组编辑器设置开关，因此最终为 **18 条**（主题 12，编辑器 6），不是零异常运行。

先前卸载所有社区插件的主题对照保存在 `artifacts/desktop-control-plugin-unloaded.json`。本轮又实际卸载 MarginLink，确认 overlay=0，再做编辑器设置操作，6 条同特征诊断仍出现，见 `v2-host-control.json`。这说明两种复现不需要本插件加载；具体宿主原因仍未知，也未宣称修复。

脚本仅对上述精确字符串、空堆栈、CDP 特征且发生在明确的原生设置关闭阶段进行分类；任何其他异常仍使验收失败。没有通过删除诊断或忽略所有非法访问来“通过”。1.10.6 同一 44 场景没有这些告警。

## 本轮发现并修复

- 文件导航期间，旧卡片 focusout/hover 可以访问 CM 已替换的 tile，出现 `No tile at position`。增加文件校验及可恢复 DOM 测量保护，最终两版本未复现。
- 侧栏动画中几何逐帧变化会让旧卡片压住新正文边界。ResizeObserver 立即暂隐，下一稳定帧恢复；边界和无自触发循环检查通过。
- 1.10.6 的设置嵌在主文档，打开设置不触发 window blur。增加移出卡片区域的 focusin 取消及 pointer capture 清理，拖动中卸载复测通过。验收驱动同时适配旧版真实 checkbox input 与新版可聚焦容器；没有用测试适配替代产品修复。

## 数据与未验证范围

唯一 Markdown 关联写入仍是未改动的 `src/editor/selection-action.ts` 中单次 Editor 事务。UI 设置/卡片拖动、重置、删除 UI 数据、退出重启都验证了源码/文件字节保留。schema 2 仅保存白名单外观、源笔记路径和散列弱身份对应的相对 UI 位置，不保存关系图谱或正文。没有新运行时文件、替身 Markdown、frontmatter、隐藏 ID、网络请求或外部执行器。

剩余人工环境：用户实际主题与字体/缩放、独立 popout 编辑窗口、macOS/Linux/移动端/RTL、全部媒体编解码格式、HTML/思维导图查看器、第三方 DOM 改写及 Page Preview 组合。大型性能压测、恶意散列碰撞和跨设备同步冲突未覆盖；120 链接检查不能代表任意大文档。

弱身份在上下文/同原文数量变化时可失效，任何 Vault rename/delete 会清除全部位置；窄窗/密集区域可隐藏卡片。这些是明确的保守边界，原生双链不丢失。完整人工步骤见 README。

## 历史资料

`artifacts/desktop-results-1.10.6.json`（25 场景）与 `desktop-results-1.15.0.json`（26 场景）保留 v0.1 记录，不用于证明 v0.2。通用截图/diagnostics 会被后续本地验收更新，以带 v2 与版本名的报告为本轮依据。
