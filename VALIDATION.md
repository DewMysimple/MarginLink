# MarginLink v0.2.2 验证记录

## 交互稳定性整改（2026-11-16）

本轮依据 `prompt/MarginLink-交互稳定性整改-Codex提示词.md` 完整1–7项。基线 main `15ee229d1a940a3f416bd7ab54acefaa14b9ec85`，当前验证包含本轮源码、单测、脚本、夹具和文档改动。Windows、Node24.18.0/npm12.2.2，隔离宿主 **Obsidian1.15.1**，仅本工程 `test-vault/`、`test-profile/`，本机CDP9223。普通实例与正式Vault未操作。

| 项目 | 对照、实际原因与最终改动 | 验证证据 |
| --- | --- | --- |
| 1 连续分隔线 | v0.2.1的RO和几何签名分支隐藏全层；最终基线采样右148帧/24隐藏、左94帧/18隐藏。移除隐藏后还查出RO排下一帧导致阈值处2个真实绘制后越界帧。最终在RO交付、绘制前合并刷新当前视图，复用节点、集中读取host几何，同步卡片/SVG | `margin-overlay.ts`；真实按住左右分隔线、慢/快/暂停/反向，充足边距0无故隐藏；单调square/icon/hidden/icon/square，0越界、存储不变。逐帧记录视口、锚点、隐藏分类及独立端点误差，未跳过不可见层 |
| 2 单一悬停 | 基线`title`和`aria-label`均含路径/诊断；实测Obsidian把aria-label生成可见tooltip。没有据此宣称系统截图证明两个气泡同时出现。最终去掉这两个属性，短无障碍名用aria-labelledby，唯一自管提示只显示TFile.name/目标末段与类型 | `card-renderer.ts`、`card-tooltip.ts`；HTML图标/标题/空白长悬停1.7秒，DOM与系统截图均只有一个提示。Markdown、Canvas、缺失无后缀/HTML、长中文、同文件标题/块共8类通过；移出/换卡/按下/切页清理 |
| 3 安静拖动 | 原position-ghost跟随更新文案；现在删除DOM、所有文案与样式，只保留可选边界，设置名“显示拖动边界” | `card-drag-controller.ts`、`styles.css`、`settings-tab.ts`；hints开/关×free/snap×合法右侧/左侧/正文非法/返回，共16观测无ghost、跟随文字或残留tooltip；Esc还原。`editor/drag-controller.ts`建链ghost保留且原桌面流程回归 |
| 4 保持抓点 | 旧positionFromDrop以中心定位，84px方卡右上首帧多(+36,-36)，左下相反。pointerdown按整卡实际外框记录比例，先原始指针命中，再候选矩形→约束/吸附/避让；move/up共用路径，up独立计算阈值 | `card-drag-controller.ts`、`layout-engine.ts`；右上数值向量得到(1208,212)，左下及无最后move回归。实机三形状×7条目首帧/连续/释放/重开，每轴≤1px；compact无可见文字项明确用中心代替。跨侧、边界、snap以独立公式核对，键盘保持中心语义 |
| 5 统一默认 | 原常量与reader各自写旧默认，改为单一always/free/square；旧flat/nested合法值逐项保留，只回退缺失/非法字段 | `types.ts`、preferences/store单测；真实删除隔离data后启用，常驻线/方卡/free直接可用；旧合法/缺项/非法、恢复默认、预览/真实卡片及原位置/Markdown不变。完整进程重启矩阵见下方收尾结果 |
| 6 下拉框文字 | **1.15.1基线首次折叠创建及稳定宽栏未复现箭头only**，值/选中文本正确；不把宿主测宽或主题推测写成已证根因。表单局部CSS改用原生选项固有宽度，给箭头/中文留空间，窄栏换行，排除宿主测宽副本 | `styles.css`；最终窄/中/宽三档记录实际宽度、选中值/文字、可用文字区、control宽度与无横滚。长项“悬停或聚焦时显示”、短项、键盘、明暗、重开和原生共享表单通过，截图目视可读 |
| 7 顶部标题 | 共享表单原h2含后缀，改为精确MarginLink，保留所有分组/控件 | `settings-tab.ts`；实际右侧栏与原生设置页h2精确相等；截图同时含标题和至少两个闭合可读下拉框 |

基线与最终使用相同真实鼠标轨迹、独立抓点期望。采样采用rAF后任务观察绘制后状态，避免把排在renderer之前的测量当最终帧；仍保留了由绘制后观察确认的中间越界失败报告，没有通过隐藏、慢拖或增大等待掩盖。恢复状态时可等待几何稳定，过程断言不等8个稳定帧。侧栏实际宽度受宿主约束，以报告记录为准。

| 命令/检查 | 本轮状态 |
| --- | --- |
| `npm ci` | 首次因npm12默认远程URL策略EALLOWREMOTE失败；`npm ci --allow-remote=all`成功，保留锁文件完整性与全局npm配置 |
| `npm test` | 13文件、168项通过，包括抓点向量/事件顺序、无最后move的up、失效几何、tooltip生命周期/文本、默认/迁移/逐字段回退 |
| `npm run lint` | 通过（src/tests/scripts） |
| `npm run build` / `npm run package` | TypeScript、esbuild与许可证打包通过 |
| `node scripts/desktop-stability.mjs final` | 12专项通过；含快速“拉侧栏→右上拖→松→点击→后退”、idle800ms新增render0/待执行帧0、面板开关订阅不增长、pending提示禁用后0残留，全库Markdown哈希相等，错误/运行时诊断为空 |
| `npm run test:desktop` | 最终构建在1.15.1完整55/55通过，插件错误0、宿主告警0；覆盖三模式/分屏/建链/取消/快捷与设置/立即切页/CRLF及布局恢复 |
| `preferences-restart-check.mjs` | flat-valid/nested-valid/missing/invalid/defaults五种配置，各正常titlebar退出、确认旧隔离PID终止、重启后核对整个偏好、UI中文值和Markdown哈希，5/5通过，普通实例保留 |
| `restart-layout-check.mjs` | 正常退出并确认隔离进程终止，重新启动1.15.1；A/B独立手动矩形、全部连线坐标、data和全库Markdown哈希精确恢复 |
| 工程记忆index/check | 索引刷新一次；16页、0错误。仅原协议6117字符超过6000阅读预算的既有warning，不扩大为记忆体检或重写协议 |

证据：[v0.2.1对照](artifacts/stability-baseline.json)、[移除暂隐后发现的阈值失败](artifacts/stability-intermediate-threshold.json)、[最终专项逐帧及交互报告](artifacts/stability-final.json)、[长悬停系统截图](artifacts/stability-final-hover-system.png)、[窄栏](artifacts/stability-final-settings-260.png)、[宽栏](artifacts/stability-final-settings-600.png)、[亮色](artifacts/stability-final-settings-theme-light.png)、[暗色](artifacts/stability-final-settings-theme-dark.png)。代表性截图已用本地图像工具目视核对。

最终专项右146帧、左95帧均0无故隐藏；阈值529帧形态五段准确且0越界。完整回归：[55场景](artifacts/desktop-0.2.2-1.15.1.json)、[诊断](artifacts/desktop-diagnostics-0.2.2-1.15.1.json)、[切页/整卡/布局观测](artifacts/desktop-0.2.2-1.15.1-remediation.json)。五类完整进程重启：[配置/UI/Markdown核对](artifacts/preferences-restart.json)。旧报告未覆盖或重写。

布局正常重启：[A/B矩形、连线及全库哈希](artifacts/stability-0.2.2-restart.json)、[重启截图](artifacts/stability-0.2.2-restart.png)。重启工具只识别本工程test-profile进程并核对物理Vault路径，正常titlebar关闭、确认旧PID退出后再启动；普通实例5788始终保留。最后隔离实例27032已正常关闭并确认退出，tracked临时appearance已恢复。

桌面测试修正了两类夹具操作问题：目标距离不足5px会成为正常点击，因此测试目标确保形成真实拖动；隐藏窗口及setViewState后先明确激活目标Markdown并聚焦，再执行指针动作。失败中间尝试未冒充通过结果，最终均完整重跑、等待进程终态才进入下一阶段。

最终安装目录 `dist/margin-link/`，ZIP `dist/margin-link-0.2.2.zip`，56,415字节，含margin-link根目录及main.js/styles.css/manifest.json/LICENSE/THIRD_PARTY_NOTICES.txt五文件。源码根、打包目录、实测插件main.js SHA256相同：`AB2A65B0ACDD92CDAE9D0954D3F737B23152D0073A5A645E5B15C7A9F95B08AF`；ZIP：`59C20999D16B42C741960C60CF319F934670C51D41BCDC197D66D6BDFE5BE6B2`。package/lock/manifest/versions统一0.2.2。构建物、依赖、隔离profile不入Git。

本轮最终bundle尚未在1.10.6或用户自定义主题/第三方悬停扩展/popout/其他平台复测；minAppVersion声明保留1.10.6。不能将默认主题的单提示与下拉框结果外推所有扩展组合。原生Wikilink唯一来源、原UI布局数据和完整源校验保留，无运行时关系库或Markdown改写。

## 历史：v0.2.1 验证记录

## 本轮环境与范围（2026-11-16）

Windows、Node 24.18.0 / npm 12.2.2，工作区 `F:/myGithub/MarginLink`；Git 验证基线 `51260ae9cfb14369a88c412743b6d3a43454f8bf`，包含本轮未提交的 v0.2.1 源码、测试和文档变化。宿主为 `F:/Software/Obsidian/Obsidian.exe` 的 **Obsidian 1.10.6**，仅使用本仓库 `test-vault/` 和 `test-profile/`，CDP 本机 9223。原有普通实例未操作。

| 实际命令 | 本轮结果 |
| --- | --- |
| `npm test` | 12 个测试文件、117 项通过；包含真实 overlay 切页时序、整卡事件、生命周期/异步保存及 CRLF 旧布局兼容 |
| `npm run lint` | 通过 |
| `npm run build` | TypeScript 与 esbuild 通过 |
| `npm run package` | 通过，生成 `dist/margin-link/` 及实际打包依赖许可证 |
| `npm run test:desktop` | Obsidian 1.10.6：旧 key 自动迁移补丁前 55 场景通过；最终构建在 1.15.1 再次 55 场景通过；两次均插件异常 0、宿主/CDP 告警 0 |
| `node scripts/legacy-layout-migration.mjs` | 最终构建，Obsidian 1.15.1：旧 CRLF 位置自动迁移，坐标/时间保留，阅读/编辑/导航/重载后矩形和连线一致，诊断为空 |
| `restart-layout-check.mjs prepare` → 正常退出/重启隔离实例 → `verify` | Obsidian 1.15.1：A/B 独立位置、实际矩形、连线坐标、原样 UI 数据及全库 Markdown 哈希全部恢复 |
| PowerShell `Compress-Archive` | `dist/margin-link-0.2.1.zip`，54,943 字节，核对 ZIP 内五个安装文件及根目录结构 |

最终构建真实桌面结果：[1.15.1 完整 55 场景](artifacts/desktop-0.2.1-1.15.1.json)、[原始诊断](artifacts/desktop-diagnostics-0.2.1-1.15.1.json)、[整改几何与内存观测](artifacts/desktop-remediation.json)。原有 44 场景延续通过，新增 11 场景覆盖：Ribbon 完整设置单实例/重开、三处整卡起拖×三种外观、取消、无等待即时 A→B→A、120ms 加载竞态、点击卡片后退/关闭重开/Ctrl 新标签、编辑阅读切换/侧栏和窄窗恢复、无关附件 rename/delete、卡片键盘操作、删除原生链接、CRLF 跨模式、多分屏最近笔记整理。观察和比较真实侧别、矩形、全部连线坐标，容许 1px 取整误差。

同轮先行的 [1.10.6 报告](artifacts/desktop-0.2.1-1.10.6.json)及[诊断](artifacts/desktop-diagnostics-0.2.1-1.10.6.json)来自 bundle `57A173978DBDA1FA049FCFBA01243C057B5AB294D40234FC66016C05A98B8693`，包括三项整改与换行身份兼容，但在最终旧 key 自动迁移补丁之前；不把它当作最终 bundle 的 1.10.6 重测。

即时切页用例在 pointerup 后直接走原生快速切换入口，没有调用插件内部保存，也没有在切页前加防抖落盘等待。读取内存/数据只作观测；拖放和设置均经真实卡片/表单入口。新验收等候窗口与侧栏几何稳定，避免把动画尚未结束的中间矩形当恢复结果。

最终审查额外发现旧 CRLF raw key 仅兼容读取仍会在宿主归一 LF 时被清理。补丁在完整源确认和完整 metadata 清理前安全迁移唯一旧 key，保留原坐标与更新时间；即使首个快照已为 LF，也仅用精确换行等价全文恢复，歧义不迁移。专项测试先在迁移前构建失败，再在最终构建通过，见[旧位置迁移报告](artifacts/legacy-layout-migration.json)。该测试只在插件禁用时预置已有用户 data.json 夹具，不通过内部方法替代拖动或保存。

最终 `main.js` 的 SHA-256 为 `C3D342DC325260829ADCC882442715C32A7BCD46CE740A1E9F3F52B46616233C`，源码根、安装目录及隔离测试插件 bundle 一致。ZIP 的 SHA-256 为 `76F9A977ED466852A65CCDE9B5F9110CFAD2184EF2CADF3EE30D89D87477C5BA`。package、manifest、锁文件与 versions.json 统一 0.2.1，minAppVersion 仍为实测的 1.10.6。构建物、依赖和 profile 均不纳入 Git。

正常重启证据见[两篇源笔记恢复报告](artifacts/remediation-restart.json)。隔离宿主首次重启时自动加载了 1.15.1 更新包，最终完整套件与 prepare/verify 均为 1.15.1，重启报告同时记录前后标题。隔离实例最后正常关闭，普通实例保留。

本轮未复测 1.15.0，最终旧 key 迁移补丁未在 1.10.6 重跑；其他操作系统、移动端、popout、自定义主题及第三方查看器组合未覆盖。下方旧版历史报告不能代替这些检查。

## 位置复位的已验证原因

基线 0.2.0 bundle SHA-256 为 `9c3813175c9334fc4ebf08108bcb51f27b4e978a3a65c8c7b7ff072b2fc40f59`。普通无延迟 A→B→A 首轮正常，不能声称每次导航必现。对隔离 Vault 的真实 `read/cachedRead` 加 120ms 受控加载延迟后，真实 leaf 导航返回 A 时，`view.file.path` 已为 A，CM 仍保留 B 的文档。旧 `reconcile(A, B的keys)` 将 A 已保存的内存记录从 1 条删成 0 条，实际卡片从右侧 `(1645, 504.4375, 196, 48)` 复位为左侧 `(594, 226.5, 196, 48)`，连线路径同时改变。见[基线完整观测](artifacts/layout-before-fix-delayed.json)。不是单纯的绘制坐标错误。

修复取消编辑器/阅读渲染触发的破坏性清理，改用绑定源文件的完整 metadata 文档变更；新源完整内容确认后才显示/提交。合法 drop 先同步写入正确源的内存布局，再按原有 250ms 合并、串行落盘。源 rename/delete 只作用对应路径，临时空间变化不覆盖保存值。

还复现并修复了两项相关问题：原生延迟 `active-leaf-change` 会取消刚从设置转入笔记的首次拖动；CRLF 源文与 LF 编辑器身份不同会使跨模式恢复失败。前者仅取消其他视图的手势，后者统一身份上下文并保留旧 raw key 兼容读取，均有回归覆盖。

CRLF 另有宿主边界：单纯拖卡片保持原始 CRLF 字节；但 1.10.6 在 source→preview 切换时会把文件换行保存为 LF，卸载 MarginLink 后同样发生，见[无插件对照](artifacts/crlf-host-control.json)。因此跨模式位置与内容恢复通过，不把宿主的换行转换宣称为“CRLF 跨模式字节不变”；标准 LF 夹具仍执行全库精确哈希断言。

## 历史：v0.2.0（2026-11-10）

以下保留原始验证记录，版本、环境、计数和旧策略均为历史事实，不能作为 v0.2.1 本轮结果。

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
