# MarginLink 验证记录

## 文件卡重叠与查看文件后返回 · 2026-11-19

在基线 `efa1c91`，Windows Obsidian 1.10.6 的隔离长文有 72 个 HTML 目标及重复引用。阅读模式从 2400 px 处打开 HTML 再后退，部分组合回到 0 px。24 组点击前后共测到 367 对重叠外框，同一对可在两个时刻分别计数。编辑模式重建虚拟文档后，部分卡片的侧别或在屏幕上的纵坐标改变。[基线样本](artifacts/card-return-baseline-1.10.6.json)

卡片使用文档坐标保留同侧的空位。重排旧重叠坐标时保留原始设置，拖动及键盘放置选取视口内最近的空位。原生后退从该标签的内存恢复先前的卡位、合并引用锚点和阅读位置。编辑器重估虚拟段落高度时，按正文在屏幕上的位置校正滚动和卡片。读者的滚轮、按键或指针操作立即结束这次视口校正。

运行 `npm run package` 后，使用 `scripts/launch-navigation-test.ps1` 启动独立测试仓库。点击返回脚本 `node scripts/desktop-card-return.mjs` 核对笔记文本、实际可见卡片、引用、视图模式和原生正文的屏幕坐标，容差为 1 px。滚动回归 `node scripts/desktop-reference-scroll.mjs` 另查每次采样的全部卡片是否重叠、是否被替换、是否可命中。紧密相邻的卡片随虚拟段落校正时最多在实测正文位移范围内滑动。

在本机 Node 24.16.0 中，`node scripts/benchmark-card-placement.mjs` 交替运行基线及候选的密集自动布局。预热后九次中位数，72 张为 1.205 → 0.192 ms，200 张为 7.595 → 0.856 ms，500 张为 86.442 → 4.457 ms。三组均逐张比对坐标。此测量仅覆盖选取卡位的计算，不包含连线路由或宿主绘制。[性能数据](artifacts/card-placement-performance.json)

另用固定随机种子生成了 1500 组拖放场景，分别穷举自由、吸附和完全手动模式中的可用纵坐标。三个模式的求解结果都与最近空位相符。阅读模式的额外夹具包含 15 张本地大图。图片载入导致文字跨过整行卡片时，按新正文位置重新选取空位，避免屏外旧占位挡住当前可见引用。

Windows Obsidian 1.10.6 和 1.15.1 各通过 24 组 HTML 卡片点击后退（三种视图、四种布局、合并开关），以及 Markdown 后退、关闭新标签、直接重开原文件和带图长文等十次额外往返。合计 68 次返回，实测可见卡片与正文位置变化均在 1 px 内，卡片重叠计数为零。阅读模式恢复到原滚动位置，两个宿主的带图夹具均逐一比对了两张可见图片和四张卡片。[1.10.6 返回报告](artifacts/card-return-1.10.6.json) · [1.15.1 返回报告](artifacts/card-return-1.15.1.json)

每版还通过 24 组滚轮、深跳与反向滚动回归，分别比对正文 53,366 次。所有采样的卡片碰撞、换边、引用代表切换、节点替换和可见卡缺失均为零。编辑器重估虚拟高度的实测最大值为 24.0625 px。两个宿主的 `desktop-reference-aggregation.mjs` 和 `desktop-reference-settings.mjs` 也通过，覆盖合并切换、分栏、定位、重链、撤销、设置和卸载。[1.10.6 滚动报告](artifacts/card-clearance-scroll-1.10.6.json) · [1.15.1 滚动报告](artifacts/card-clearance-scroll-1.15.1.json)

单元测试 56 个文件、555 项通过。lint、TypeScript 检查、构建和打包通过。测试使用的 main.js SHA-256 为 `3a543b356f66c0cc1b253ef1f0c0bf010efdebf483a086c7a10baf5c35d1fbf7`，安装 ZIP 的五个文件已与插件目录逐字节比对。桌面覆盖限 Windows 的项目隔离仓库，未使用用户正式库，也未覆盖第三方主题组合。

## 滚动时卡片换边、跳位与闪现 · 2026-11-19

基线 `487719b` 在 Windows Obsidian 1.10.6 的 180 段测试笔记中复现。开启合并后，实时预览自动布局的卡片最大横移 816 px，重复目标的文档纵坐标最大变化 5405.94 px。往返期间 26 张卡片被重建，18 张卡片在原卡位仍与视口相交时缺失。

修复分三处。文件组从该分栏首次测量的引用取得文档锚点，卡片和连线分别管理可见性。编辑器虚拟占位区校正时，已排卡片保留相对正文的偏移，新卡使用余下空间。阅读模式的绘制层覆盖原生滚动区顶部留白，密集布局进入这段留白的卡片可见且可点击。

专项脚本 `node scripts/desktop-reference-scroll.mjs` 使用真实滚轮、28 px 步进、跳至 3500 / 5500 px、反向滚回和停稳采样。它独立读取原生正文和卡片 DOM 的外框，核对卡片侧别、相对文字位移、锚点、节点身份、中点命中与远处引用的线或编号。文件中的 `maxY` 为文档绝对位置改变量，`relativeDrift` 为卡片相对同一处正文的位移；编辑器自身修正虚拟高度时两者有区别。未验证第三方主题组合、其他桌面系统或用户的正式笔记库。

在 Windows Obsidian [1.10.6](artifacts/reference-scroll-1.10.6.json) 与 [1.15.1](artifacts/reference-scroll-1.15.1.json) 上，同一安装包各通过 24 组（实时预览、源码、阅读 × 四种布局 × 合并开关）。每版 53,366 次正文比对、28,567 次卡片中心命中检查；卡片横移 0 px，最大相对正文漂移小于 0.001 px，锚点切换、节点替换及应当可见的卡片缺失均为 0。深滚后各组均检测到远处引用的连线或续接编号。编辑器虚拟高度对应的文档绝对位置校正最高 24.0625 px。

两版宿主均重新通过 `desktop-reference-aggregation.mjs` 和 `desktop-reference-settings.mjs`。覆盖远处引用定位、10 处密集连线/编号、单处重链与取消及撤销、分栏、同名文件解析变化和卸载。聚合回归中，48 步滚动采样新增求路和代表切换均为 0。

`npm test` 通过 55 文件、547 项。lint、TypeScript 检查、构建与打包通过。安装包 main.js SHA-256 为 `66bd49a8cd682a35cbd6977b5d50879cea1f5dbdba74d218ccd66a04834cfb81`，安装 ZIP 的五个文件已与桌面验收目录逐字节比对。

## 同文件引用合并 · 2026-11-19 · 未发布

基线 `4546bb6`，Windows、Node 24.16.0、npm 12.0.1。基线 54 文件 535 项，候选 55 文件 545 项单元测试通过。两次的 `npm test`、`npm run lint`、`npm run build`、`npm run package` 均退出 0。安装目录为 `dist/margin-link/`，两版宿主使用的 main.js SHA-256 为 `1c6acc1dfd72acdd9a127cdbcffd9142f76a356ec83b2357c633ada42a9888c1`。版本 0.3.2、最低版本 1.10.6、偏好 schema 2。

Windows Obsidian 1.10.6 和 1.15.1 使用新建的隔离 Vault 和 profile。重跑方式为先打包，按宿主选择 `scripts/launch-navigation-test.ps1 -HostAsar bundled` 或传入隔离测试 ASAR，再运行 `node scripts/desktop-reference-aggregation.mjs`。脚本核对 Vault 路径和 bundle 指纹。原始逐帧记录为 [1.10.6](artifacts/reference-aggregation-1.10.6.json) 和 [1.15.1](artifacts/reference-aggregation-1.15.1.json)。

| 验收 | 实测范围 |
| --- | --- |
| 文件与引用 | 30 处原生引用，20 个单独目标，另 10 处跨视口指向同一文件；含别名、标题和块。计数显示 10，列表显示 10 行。另用密集短文同时显示 10 处，逐处核对路线或配对编号。 |
| 定位与交互 | 源码、实时预览、阅读模式从列表定位到末尾指定引用并高亮。单击计数、鼠标移入、重绘、Escape、窄窗口裁剪和列表内滚动均通过。双分栏中仅发起操作的分栏滚动。面板开启时检查正文读取和 Vault 文件枚举共 0 次。 |
| 键盘与修改 | Enter、Space 和 Ctrl+点击打开，键盘打开列表、单处重链并保留子路径、单处解除及原生撤销均通过。源文件重命名，目标重命名、删除和重建时旧列表关闭并重新分组。 |
| 布局与数据 | manual/free/snap/auto 中往返开关后逐卡 transform 恢复，磁盘 layouts 数组 SHA-256 前后一致。快速切换后光标、滚动和原文一致。全文磁盘 SHA-256 前后均为 `890875988d7be8ce02e58e607344b55024048e2991f6fbc0bf187c5f53cf9824`。全量 data.json 包含开关本身，会随设置更新。 |
| 连线与清理 | 三种线型 × 四种显示策略，正文单处与卡片组高亮，窄端口续接。单测重验几何和线宽。卸载时两个列表监听均解除，定位计时器、列表、关系和附加 DOM 清空。 |

| 宿主 | 合并 | 首屏卡片 / 逻辑连接 / 编号对 | render p50 / p95 / max (ms) | 滚动求路次数 | 代表切换 |
| --- | --- | --- | --- | --- | --- |
| 1.15.1 | 关闭 | 15 / 15 / 0 | 0.5 / 1.1 / 4.1 | 0 | 0 |
| 1.15.1 | 开启 | 8 / 15 / 0 | 0.6 / 8.3 / 11.2 | 44 | 1 |
| 1.10.6 | 关闭 | 15 / 15 / 0 | 0.4 / 0.5 / 1.8 | 0 | 0 |
| 1.10.6 | 开启 | 8 / 15 / 0 | 0.4 / 3.9 / 5.1 | 44 | 1 |

默认关闭的独立导航回归 `node scripts/desktop-navigation.mjs` 在 1.10.6 的另一份新隔离 Vault 通过，覆盖旧卡片的阅读、编辑、预览、高亮、分组折叠及生命周期。

1.10.6 完成上述脚本后追加运行 `node scripts/desktop-reference-settings.mjs`。实际设置面板开关生效；在原文前插入文字后，目标卡片仍复用原 DOM。创建近目录同名文件后，原共享卡按宿主解析拆成两张，旧列表关闭；删除新增目标后再次合并。

48 步往返滚动采样保留全部 render 样本。四组滚动的组重算均为 0，悬停新增路由批次和搜索均为 0。聚合减少首屏卡片，滚动时成员和端口变化仍会引起求路，样本中的尾部渲染耗时上升。以上测量仅计插件 render。原始文件包含滚动前后卡片与锚点几何、路由和编号数。

开发过程中，基线回归发现 freezeLayout 对偏好来源的假设，桌面发现编辑器优先消费 Escape，分别修复后复跑。隔离探针首次启动还遇到信任弹窗的加载时序，以及将宿主文件对象返回给 Playwright 时的渲染进程崩溃。探针改为等待就绪、仅回传需要的标量；最终两个宿主专项通过，页面异常为 0。

未覆盖 macOS、Linux、第三方主题/插件组合及长期大库。创建、取消、撤销/重做、导入、原生 Markdown link/embed、拖动取消与路由碰撞沿用本轮完整单元测试，专项桌面没有逐项重演所有旧工作流。

## 0.3.2 取消链接与 300 px 留白 · 2026-11-18

基线 `main/10a92fc`。Windows 隔离桌面通过真实右键菜单依次解除第二个相同引用和一个失效的标题链接。实时预览、源码和阅读模式均核对源文本、卡片数量、其他引用和目标文件内容。另用 CRLF 笔记从阅读模式操作。在编辑器按两次 Ctrl+Z 和一次 Ctrl+Y，逐步核对文本与卡片恢复结果。

通过实际设置滑块将留白从 16 调至 300 px，重新加载插件后检查磁盘偏好、设置控件，以及卡片外框到正文边缘的实际距离。重开设置的附加写入计数为 0，关闭窗口后再次从磁盘读取到 300。开发中曾复现阅读段落沿用旧偏移，以及打开设置触发重复写入；两项均在最终桌面复测中覆盖。复跑时先执行 `scripts/launch-navigation-test.ps1` 创建隔离窗口，再运行 `node scripts/desktop-unlink.mjs`，最低宿主使用启动参数 `-HostAsar bundled`。

最终 Obsidian 1.10.6 一次、1.15.1 两次均通过，没有页面异常。`npm test` 通过 54 个文件、535 项测试，`npm run lint`、`npm run package`（含严格类型检查和构建）通过。ZIP 内五个文件与这三次桌面安装逐字节一致。安装包 SHA256 为 `427964ee952c2afa71b0e333b5e5dd21457e740c730a9de876ae19e17511ad3d`。

## 0.3.1 密集卡片与水平接线 · 2026-11-18

基线 `main/03566c5`。在项目内的新建隔离 Vault 中打开报告笔记的副本，载入该笔记原有的 32 条布局记录，采用原来的 15px 字号、字体、自由布局、中号方卡和直角线。HTML 目标用空白夹具代替，测试窗口为 1620 × 920。每次从页首滚至页尾，以可见卡片按钮的实际 DOM 外框测量同列净间距。负值表示相互遮挡。

| 显示模式 | 0.3.0 最小间距，Obsidian 1.15.1 | 0.3.1 最小间距，Obsidian 1.15.1 / 1.10.6 |
| --- | ---: | ---: |
| 阅读 | −46 px | 10 / 10 px |
| 实时预览 | −53.5 px | 10 / 10 px |
| 源码 | −60.5 px | 10 / 10 px |

两个宿主的每个模式均观察到 32 张不同的卡片。对照版本的 `Verse` 在距离卡边 12px 的位置还有一段 0.5px 的垂直台阶。修复后，检查实际可见的 SVG 路径，水平段从文字出口下方一直覆盖到卡边，全段同一纵坐标。阅读截图也复核了两侧密集卡片的间距。各次最终运行均核对测试笔记全文和 32 条保存记录与初始输入一致。

1.15.1 的最终窗口记录三次 `illegal access`。在另一隔离窗口禁用 MarginLink 后打开同一副本并重复滚动，宿主同样报告三次，来源为 `app://obsidian.md/index.html`。1.10.6 的最终窗口无此告警。测试范围限 Windows 和此笔记的布局场景。

`npm test` 通过 54 文件、528 项测试。新增回归覆盖旧布局、重排和滚动、初次保存与再次恢复、手动叠放，以及两侧卡边的分数像素对齐和遇障绕行。`npm run lint` 和 `npm run package`（含 TypeScript 检查与构建）通过。ZIP 中五个文件与安装目录逐字节相同，ZIP SHA256 为 `7f3fc1d1db81e17cb34db16e69359e1dcbb034326d5be46abb818d84f175b792`。

## 0.3.0 空间导航 · 2026-11-18

起点 `main/3c7f420`。审计、聚焦、预览、分组、生命周期整理依次为 `9ef2ceb`、`24750e0`、`119583e`、`18d0a63`、`71b0366`。最终包包含随后验收的边距预览定位及样式。Windows，Node 24.16.0，npm 12.0.1，Electron 37.10.2，Chromium 138。分别冷启动隔离 Obsidian 1.10.6 和 1.15.1，应用版本取窗口标题，插件运行时版本与盘上 manifest 均为 0.3.0。[代码审计](docs/v0.3-audit.md) · [实施记录](docs/v0.3-implementation-plan.md) · [原始测量和失败记录](artifacts/navigation-0.3.0.json)

| 检查 | 0.2.27 基线 | 0.3.0 最终 |
| --- | --- | --- |
| npm test | 0，51 文件、499 项 | 0，54 文件、522 项 |
| npm run lint | 0 | 0，无诊断 |
| npm run build | 0 | 0，严格 TypeScript 及 CJS bundle |
| npm run package | 0 | 0，五文件安装目录 |
| 隔离桌面导航 | 1.15.1 阅读步骤退出 1，内存 5 卡但 DOM 为 0 | 1.10.6、1.15.1 各自完整运行，均退出 0，pageerror 0 |
| 发布文件核对 | 基线 bundle d1b827dd…a5c59 | ZIP 恰含五文件，与安装目录逐字节相同；两次桌面的 JS/CSS 均与安装目录相同 |

最终 bundle SHA256 `374f76ec1a04f2e563e2187f1b90d8c3ae491d7515ae638fdf83922f73327451`，CSS `66d0a3f33e379380ccac8fffe07d7e8dfc007a1795dc6c98b313236845561037`，本机 ZIP `fd26a5ea5dc2dc065116419a4e74be2400aa5be28f41f985ffb2fa51062ffe2b`。manifest、package、lock 的两个根版本及 versions 对照均已校验。

### 功能与数据

- 两个宿主都验证了 Live Preview、源码、阅读下的单次出现高亮、悬停切换、P 固定和 Escape。另测右键固定、配对编号、resize 和同源双分栏各自固定。源码模式以真实文本片段画底纹。无安全路线、共享线段方向和裁切续接另有本轮既有集成测试覆盖。
- 预览实测含 HTML/脚本字符串和嵌入语法的 Markdown、HTML 附件、未解析文件、鼠标跨入面板、V、Esc 还焦和“打开文件”。受控延迟真实 Vault 读取，先 A→B 悬停，再在读取中切笔记、卸载。验证修改、改名、删除后失效，旧结果不能回填，重新启用恢复。悬停前后活动 leaf、光标与滚动一致。最终截图可见滚动摘要和打开按钮。[阅读预览](artifacts/navigation-preview-0.3.0.png)
- 设置页实际选择分组规则，标题栏原生菜单操作文件夹、类型；同名不同目录、同目标重复、未解析、隐藏线段成员及两个分栏均检查。四种布局分别比对折叠前后的全部 transform 和 data.json 字节。测试中的目标文件修改只发生在新建隔离夹具。源笔记全程 SHA256 `2073213f21170da9fc95a3f2347776ec479917044d45d0b8200a1a8172ef2aa5`。
- 实际拖动取消恢复、Ctrl 点击新标签、插件禁用与重启通过。单测另测选区建链、撤销/重链、导入、三种线型、卸载保存、跨模式布局、空/大/读错文件、XMind/PDF/图片只读元信息、摘要限长和容量。9,000 次引用、9 个不同目标的分组用例只解析 9 次。
- 本轮未在 macOS、Linux、第三方主题或大型 Vault 长时会话实测。未在最终桌面包复跑历版全部导入、原生正文 hover、重链与路线像素矩阵。单测或历史宿主结果各按对应证据使用。

### 同夹具性能

每次启动都创建新 profile 和同内容 Vault。比较使用同一 1.15.1 默认主题、字体、1620×920 窗口、5 个引用与 120 段滚动填充、auto/icon/always。启动后等字体加载及几何连续稳定 320ms 再测，表中为暖交互计时，冷启动耗时未单独量化。每模式合成 160 次 pointerenter/leave 组合，检查下一帧，再原生 scroller 上下各 24 个 14px 步长，含静默期共 49 个插件 render。真实鼠标跨面板和拖动另行验收。

| 宿主 / 插件 / 模式 | 悬停事件 p50 / p95 / max（ms） | 滚动 render p50 / p95 / max（ms） |
| --- | --- | --- |
| 1.15.1 / 0.2.27 / Live Preview | 0 / 0.1 / 0.3 | 0.2 / 1.1 / 1.1 |
| 1.15.1 / 0.2.27 / 源码 | 0 / 0.1 / 0.2 | 0.3 / 0.4 / 1.8 |
| 1.15.1 / 0.2.27 / 阅读 | 装饰层脱离，无法采样 | 同左 |
| 1.15.1 / 0.3.0 / Live Preview | 0 / 0.1 / 0.5 | 0.3 / 0.7 / 1.0 |
| 1.15.1 / 0.3.0 / 源码 | 0 / 0.1 / 0.2 | 0.3 / 0.6 / 1.6 |
| 1.15.1 / 0.3.0 / 阅读 | 0 / 0.1 / 0.1 | 0.2 / 0.6 / 1.1 |
| 1.10.6 / 0.3.0 / Live Preview | 0 / 0.1 / 0.4 | 0.3 / 0.7 / 0.9 |
| 1.10.6 / 0.3.0 / 源码 | 0 / 0.1 / 0.2 | 0.2 / 0.4 / 0.7 |
| 1.10.6 / 0.3.0 / 阅读 | 0 / 0.1 / 0.2 | 0.3 / 0.4 / 0.5 |

六组最终测量的悬停路由批次、SVG d 写入、目标文件读取、保存及观察到的 Long Tasks 均为 0。滚动期间也计入读取与保存。低于计时分辨率的值记为 0。数字仅描述这份夹具的插件工作，不能换算成整机 FPS。

### 失败与修正

基线阅读 sizer 重排后会只移除插件层，原 observer 将该记录当作自身变更忽略。现对仍断开的层请求重挂。候选版下一帧探针还捕获到一次多余批次，即使已等待稳定，几何代数仍从 11 到 13。原因是短暂的高亮片段移除后仍收到 style 记录；现在只处理仍属于当前视图的 mutation 目标，并单测区分这两种移除。没有放宽路线碰撞或更改求路算法。

验收脚本曾用折叠前 DOM 顺序选错目标，曾选到宿主隐藏的下拉尺寸测量副本，也曾在切页焦点尚未稳定时发快捷键。现按具体别名、可访问的 select 和完成布局的目标分别校验。最低宿主首次信任后会打开设置，现关闭该弹窗再操作卡片。旧失败输出保存在同一证据文件；已通过的最终运行具有独立记录。目视发现短面板的按钮可能需要滚动才能看全，最终布局优先使用卡片旁完整边距，正文单独可滚动，并校验打开按钮始终位于面板内。

### 复做

从项目根运行 `npm ci`（已有锁定依赖时可复用）及 `npm run package`。Windows 需已安装桌面 Obsidian。下面的启动脚本在 `test-vault/.v03-desktop/` 和 `test-profile/v03/` 新建独立目录，测试脚本核对精确路径后操作；每次验收原生关闭该窗口。现有 Obsidian 程序路径可通过 `-ObsidianExe` 指定。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/launch-navigation-test.ps1 -HostAsar bundled
node scripts/desktop-navigation.mjs
powershell -ExecutionPolicy Bypass -File scripts/launch-navigation-test.ps1 -HostAsar test-profile/obsidian-1.15.1.asar
node scripts/desktop-navigation.mjs --capture
```

第一个命令使用已安装程序自带的宿主（本机 1.10.6）；第二次启动需要已准备对应 asar。等待隔离窗口就绪后运行 Node。基线可将 3c7f420 构建的安装目录传给 `-PluginDir`，运行 `node scripts/desktop-navigation.mjs --baseline`。报告保留在 `artifacts/navigation/`，本次匹配基线、失败原始记录和最终两份原始记录已汇入上述 JSON。

## 0.2.27 连线路径美观 · 2026-11-17

基线main/5482c0c、0.2.26实际bundle aecd1881…c98583。只读复制当前UE6笔记及23个目标，在隔离test-vault/profile、Windows Obsidian1.15.1/Chromium138验证。新旧使用同一源文SHA12ba3973…699c、UI布局SHA204c3fff…b4dcba、字体、偏好和视口；1614/1100两宽度×读写×三线型共12组比较，11卡原生屏幕坐标最大变化0px。效果见[优化前](artifacts/route-aesthetics-before.png)、[优化后](artifacts/route-aesthetics-after.png)。

旧评分按曲线端点弦长并奖励Cubic、先接受大handle首个安全形状，导致大拱与长斜段占优。现在加入行间正交候选，以弧长、包络外逸、斜直段及端点曲率统一排名；开放空白仍保留舒展Cubic。评分下界先剪枝，走廊请求优先评相应路线，90°等腿Q用闭式弧长。候选评分的8点采样不参与安全判断；完整文字/卡片/描边、曲线保守细分及bounds保持原规则，batch/overlay/缓存和持久化结构未改。

| 原生SVG实测 | 0.2.26 → 0.2.27 |
| --- | --- |
| UEFN实际上拱，阅读/编辑 | 36.60/67.68 → 2.75/2.75px |
| incremental最长斜直段 | 475.24 → 0px |
| MCP阅读路径长度 | 479.86 → 378.57px |
| manual阅读路径长度 | 313.02 → 215.03px |

不能概括每条路线均缩短：Cook仍须绕过正文行，manual编辑原本已有合理路线。6项新增回归也检查左右镜像、封住下出口、紧邻卡片栈与开放空间舒展性。最终`npm test`为51文件499项，`npm run lint`和`npm run package`通过。

v3候选已改善外观，但真实滚动静默共享搜索出现62.3/51.7/53.6ms失败，raw完整保留，没有重跑抽绿。按实际profile，crosses占paint自耗时约38–46%。v4增加精确的线段同外半平面快拒绝、同轴distance绝对值快路，其余slab数学和曲线安全细分不变；一次额外比对44,683个相交判定、192组三线型完整Connector，与v3全部相同。

最终同一个d1b827dd…a5c59包26项桌面全部通过、errors0：14几何（12标准+2粗线）、8实际拖动/取消/drop重载、4真实滚轮。标准每场11条完整；5.5px粗线阅读9完整+2配对编号、编辑8完整+3配对编号，全部端点可见且安全。UEFN48步拖动paint p95/max阅读3.6/7.6ms、编辑3.0/5.6ms；ship为3.4/9.1、3.0/7.8ms。四轨迹LongTasks0、pointermove保存0、取消恢复及可见邻卡原位。

滚动标准render p95/max为阅读8.1/48ms、编辑5.5/18.2ms；双次深回入为5.3/10、3.1/18.5ms，均通过p95≤16.7、max<50、post-frame相对偏移≤1px及保存0门槛。实际post-frame偏移0、LongTasks0，回入复用已验证。阅读quiet paint仍47.2ms；每组各有一个浏览器帧间隔>50ms，source early-rAF中途246.6875px保留，不能把插件计时说成整机FPS或所有合成帧保证。

独立CPU基准双方各用全新Node24.16.0进程，三线型×7场景×24计时/独立计数/独立几何帧；全部6/6连通和有向SVG接缝安全。curve冷求路p95 7.07→5.66ms、共享冷18.13→8.52、单卡拖动1.39→1.19；滚动/精确平移/离屏回入全0次新求路。原混合进程曾有明显执行环境偏移，未删除，也未据此断言某个具体GC/JIT原因。完整21组对照、两条`--only=baseline/current --shared`复做命令在[CPU摘要](artifacts/route-aesthetics-cpu-0.2.27.json)。

桌面复做须先准备同一笔记副本与UI快照（原文及完整配置不随Git发布），安装包到隔离Vault并冷启9227。`desktop-route-aesthetics.mjs --phase=final-v4 --data=<快照>`，加`--narrow`、`--width=5.5 --allow-continuation --only=curve`覆盖其余几何；`desktop-curve-drag.mjs --ue6 --only=curve/UEFN`及原`--only=curve/ship`；`desktop-scroll-performance.mjs --phase=route-aesthetics-final-v4 --only=curve/hover/false --cold --verify`，深回入加`--deep-returns`并另选phase。新几何探针默认仅读隔离Vault的data.json。基线首份runtime版本曾遗留热manifest27，实际旧bundle/旧几何与后续runtime26一致；最终冷实例已核对manifest/runtime27及磁盘SHA，未以热metadata冒充包身份。

根main.js、dist和ZIP五文件逐字节一致；ZIP SHA8b4bf5a5…a2693ab。24夹具逐个校验归档、6配置按SHA还原，隔离39024原生退出，普通3336保留；正式源SHA不变。正式目前安装0.2.26，本轮未自动升级，替换五发布文件时保留data.json。[桌面摘要](artifacts/route-aesthetics-0.2.27.json)、[发布收据](artifacts/release-0.2.27.json)。候选仍是有限启发式，非全局最短/零交叉证明；其他系统、最低宿主、第三方主题/DOM及大型库长时运行未覆盖。

## 0.2.26 指定HTML图标 · 2026-11-17

按用户追加顺序，先完成并推送0.2.25滚动修复（22d9db9），再实施图标替换。`D:/04_EdgeDownload/Edge图标.png`与`src/assets/edge.png`字节相同，SHA256为`939eda2c…daa50448`，512×512 RGBA/90449bytes，保留原始透明度和颜色。移除原仿制SVG，改用内嵌data URL图片；无需运行时访问D盘。按后续要求删除图标下方HTML字样和相应CSS，只显示图案；HTML/HTM及大小写匹配、按钮无障碍名称、文件类型提示和非原生图片拖拽语义保留。三种卡片实际图片尺寸为24/26/18px。

图标验证后的实际笔记滚动抽查仍出现52.4ms、恢复正式当前23条UI布局/霞鹜15px后又出现51.2ms，未靠重跑抽绿。CPU/指纹指出：六条线滚出coverage使当前batch完全空，返回时旧Connector已丢，42.3ms用于重新求路，与PNG解码无关。新增每视图限100条成功绘制提示的`ConnectorRouteCache`，只保留connector/fingerprint/originY，不混入当前draw关系/描边，不保存到data.json。返回仍执行严格相对几何/精确平移和全部当前文字、卡片、边界验证；真实变化或受阻仍重搜。笔记/模式/源文/几何变化及卸载清理，13项新增单测覆盖回入零求解、当前空批次无旧线、安全失效、容量和清理。

最终`npm test`为50文件493项，`npm run lint`、`npm run package`通过；28项当前包桌面均passed、errors0：14图标（12真实浅深/读写/三形态+2原生交互）、2标准曲线hover滚轮、2双次2160px离屏返回、6生命周期及4拖卡。24个实际HTML/HTM图片decode512²、内嵌SHA与源相同；无HTML标记，点击、拖动、tooltip/aria和普通Markdown图标正常。主题实际class和computed background分别为theme-light/rgb255与theme-dark/rgb28，根已目视截图；没有以case名冒充主题切换。早期多余pointer假设、缺失HTM夹具、热改阅读section映射和setTheme参数被忽略的探针诊断完整保留，均未通过生产补丁或放宽断言处理。

标准匹配曲线hover：阅读render p95/max为5.2/42.5ms、编辑2.5/33.6ms，Long Tasks0。两次完整离屏返回：阅读6→0→6各六条安全复用，回入paint0.6/0.5ms；编辑首次5/6复用+一条必要求解、2.9ms，第二6/6、0.5ms。独立deep轨迹render max阅读5.7ms/编辑46.6ms（编辑峰值为静默探索），不隐藏尾部开销。各组post-frame可见偏移0、滚动保存0；early rAF中途值仍保留。卸载时cache8→0、timer1→null，400ms旧overlay render2→2，frameId为已取消的旧编号而不是伪称归零。

复做：隔离CDP9226下`node scripts/desktop-html-icon.mjs --output=artifacts/html-icon-0.2.26/final-cache`；匹配当前笔记UI布局后，`node scripts/desktop-scroll-performance.mjs --phase=html-icon-cache-deep-returns --only=curve/hover/false --cold --deep-returns --verify`。生命周期加`--reported-note --curve --route-cache`，拖动加`--only=curve/ship`，输出分别为final-cache-lifecycle-proof、final-cache-drag，保留旧报告。旧独立Chromium图标helper已适配PNG/无字样，但没有将其称作本轮运行通过。

根main.js、dist、ZIP五个发布文件与全部当前桌面bundle一致`aecd1881…c98583`，唯一PNG data URL解码后等于原始图片。[本版摘要](artifacts/html-icon-0.2.26.json)、[发布收据](artifacts/release-0.2.26.json)。26夹具已保留到ignored证据、6配置精确还原、隔离实例关闭，正式PID23544与笔记SHA保留。0.2.25的22项桌面及合成器仍只属于其对应bundle，不计成本版重新验证。其他系统、最低宿主、全部第三方组合及长时大库仍未覆盖。

## 0.2.25 真实滚轮与曲线滚动 · 2026-11-17

本轮使用用户当前UE6笔记及23个选定目标的只读副本；源与夹具SHA256为`12ba3973…699c`，与旧轮笔记内容不同。正式安装已核实为0.2.24且bundle与上版发布相同，排除旧包误用。测试仅在test-vault与隔离profile运行，Windows Obsidian1.15.1 / Electron37.10.2 / Chromium138，沿用用户15px字体、free布局、curve/hover、reduceMotion=false，并对照always及三线型。

CPU及逐次绘制记录确认：虚拟化DOM变化令障碍邻域重测，旧batch要求整份障碍和bounds相同才复用；整段真实的-0.3125px/+0.1875px坐标修正也被判成全部新路线。滚动还反复进行共享走廊候选搜索，已遇到但远离覆盖区的关系参与无效求路。旧曲线CPU主要耗在crosses/searchRoute，文字测量通常约1ms以内；并非只由SVG曲线绘制或文字扫描造成。

现在按自身相对几何复用旧线，严格整体位移精确平移所有点、控制点与路径，再用当前完整文字/卡片/边界验证；不放宽安全容差或四舍五入障碍。覆盖区外不搜索不可能显示的关系，相关卡片仍参与避障。必要路线立即更新，共享探索在160ms滚动静默后进行，并缓存附近绘制几何已完成的优化。宿主实测每120个wheel scroll会产生约120个同轮scrollend，因此没有用scrollend误判整段手势结束。缓存仅控制可选优化，不能跳过安全校验和失败路线恢复，也不承诺穷尽覆盖区外所有更优共享方案。

最终0.2.25真实wheel的10项硬门槛已通过：阅读/编辑×三线型always及curve悬停未激活/初始激活，120包上下往返滚轮、覆盖边界、450ms静置；每组render p95≤16.7ms、max<50ms、可见双方post-frame相对坐标≤1px、滚动保存0。6组always各4个静态点独立采样原生SVG，核对端口/共享接缝、完整文字及卡片描边碰撞和必要编号续接。最终曲线阅读p95为6.2–6.3ms、编辑2.3–2.5ms；阅读max28.3–36.3ms，编辑35.5–36.8ms。这些是插件工作耗时，不是整台机器的FPS保证；rAF记录仍可有宿主/采样等其他帧间隔。

相同最终探针、逐case重载/相同字体稳定条件/轨迹的0.2.24对照（baseline-matched）10组均观测完成、errors0，但不满足性能门槛，明确标记measured而不是passed。主要曲线对照如下；更早不同初始化的94–112ms/最高607ms诊断不混入此表。

| 模式/曲线显示 | 0.2.24 render p95 / max | 0.2.25 render p95 / max | Long Tasks旧→新 |
| --- | --- | --- | --- |
| 阅读/常驻 | 64.3 / 166.5ms | 6.3 / 36.3ms | 8→0 |
| 阅读/悬停未激活 | 59.7 / 181.4ms | 6.3 / 28.3ms | 8→0 |
| 编辑/常驻 | 42.2 / 197.2ms | 2.3 / 35.6ms | 6→0 |
| 编辑/悬停未激活 | 49.4 / 310.3ms | 2.5 / 36.8ms | 6→0 |

原生合成器另捕获阅读135PNG/编辑116PNG，分别39/30帧双方模板置信≥0.8，最大相对漂移0/1px，无>1px。source最早rAF观察曾有246.6875px的单帧中途值，post-frame task为0，未在已捕获合成帧呈现；原始值保留，没有删掉该观察来声称所有回调均同步。早期模板元数据与截图间字体/行宽变化造成假94px匹配，修正为fonts.ready及坐标稳定后取得模板，失败原始资料保留。

独立CPU对照`node scripts/benchmark-scroll-routing.mjs --baseline=4aa8838 --frames=12 --output=artifacts/scroll-routing-cpu-0.2.25.json`已完成42项，逐项12帧持续计时、独立12帧安全/有向共享接缝与停稳校验。六关系curve整体微移p95为32.19→0.251ms，远障碍16.06→0.373ms，覆盖移动30.68→0.341ms；持续及停稳均零重新求路、保留完整安全复核。这是故意提交的邻域事件，不表示每个真实滚动帧都求路。故意绕过overlay过滤、提交全部30关系的压力组仍重试24失败离屏项，直线/直角墙钟有回退；实际过滤效果以桌面记录为准。

完整`npm test`为49文件480项，`npm run lint`与`npm run package`通过，ZIP五个发布文件逐字节一致。当前包6项生命周期（双分栏真实滚轮、阅读重挂、idle0render、大跨度覆盖、待决timer期间卸载）及4项curve拖动/drop重载均通过，22桌面场景最终错误0。首轮生命周期5/6中的拖动邻卡变化发生在初始宿主字体/位置未稳，探针等待fonts.ready及200ms坐标稳定后同动作6/6，无生产补丁或放宽坐标判据。隔离首次信任/手动启用竞争和一次renderer崩溃单列诊断，后续最终各报告零pageerror。

复做（先准备当前隔离副本、安装对应包并启动9225；历史报告不覆盖）：`node scripts/desktop-scroll-performance.mjs --phase=final --cold --geometry --verify`；合成器加`--phase=final-compositor --only=curve/always --compositor`后分别运行`python scripts/analyze-compositor.py artifacts/scroll-performance/final-compositor/<preview或source>-curve-always-rest-compositor`。回归为`node scripts/desktop-scroll-lifecycle.mjs --output=artifacts/scroll-performance/final-lifecycle-settled --reported-note --curve`与`node scripts/desktop-curve-drag.mjs --output=artifacts/scroll-performance/final-drag --only=curve/ship`，后二者环境变量`MARGINLINK_CDP_URL=http://127.0.0.1:9225`。

最终源码、安装目录、ZIP及桌面bundle一致为`0d3f0744…550b4c`。[桌面摘要](artifacts/scroll-performance-0.2.25.json)、[发布收据](artifacts/release-0.2.25.json)、[CPU对照](artifacts/scroll-routing-cpu-0.2.25.json)。测试24夹具按SHA保留至ignored证据，6配置精确还原，隔离实例原生关闭；正式PID23544保留，源SHA起止不变。正式库未自动升级；其他系统、最低宿主、第三方DOM改写及大型库长时运行没有据此获得本轮验证。

## 0.2.24 重链视口与关联面板初始焦点 · 2026-11-17

按用户顺序，先完成并推送0.2.23的完全手动整改（`49a5d51df2117111ae89a0eece4bede4ec927d64`），再开始本阶段。实际环境仍为Windows Obsidian1.15.1、默认主题、1614×838/DPR1、隔离test-vault和test-profile/manual-layout-run。正式库只读，复制副本与正式源的不同版本沿用上一节来源说明；本阶段最终两组run的正式源起止均为c463d3，副本为98d945。

本地宿主源码与实际事务跟踪确认：Obsidian的Editor.transaction即使只改正文也请求scrollIntoView，因而卷向离屏旧光标；最后的editor.focus不是唯一原因。旧阅读恢复则在setState返回后直接写一次DOM scrollTop，早于原生渲染/滚动还原完成。Modal.open在onOpen之后再聚焦首个可聚焦元素，会覆盖FilePicker.onOpen内的input.focus。

新增单一relink-viewport helper：捕捉实际writer的原生CM scrollSnapshot，按受校验的同一次splice映射，仍只执行一次Editor正文事务，再在同一事件轮次提交纯滚动effect。未知文档变更不复位旧像素；没有native能力才同步回退公开Editor滚动API。阅读在最后异步文件核验后采集当前位置，恢复用公开原生文档坐标；匹配source分栏也按实际writer处理。没有多次timer追滚动、替身笔记或新增关系数据。FilePicker在super.open完成后同步聚焦搜索，切页聚焦对应输入并preventScroll，重复open、异步结果和关闭后不抢焦点。

| 真实成功重链 | 0.2.23开始→结束scrollTop | 0.2.24开始→结束scrollTop | 最终原模式连续采样偏移 |
| --- | ---: | ---: | ---: |
| 编辑 | 4503→448 | 4503→4503 | 滚动0px，锚点0px |
| 阅读 | 4382→4350 | 4382→4382 | 滚动0px，锚点0px |

旧阅读还曾在临时source阶段卷向448；不同模式的scroll坐标不作为相同像素比较。最终阅读仍短暂借用source，格式转换帧单独保留，不宣称跨模式没有任何视觉格式变化；恢复阅读后原锚点和视口完全原位。旧面板初始activeElement为“已有文件”按钮，直接键入完整路径只得到“A.md”；本版初始为search input，实际keyboard.type完整接收“Folder/Note A.md”。

- `npm test`：46文件448项通过（本阶段新增11项）；`npm run lint`、`npm run package`（含tsc/build）通过。新增测试覆盖原生后置焦点、页签/关闭/异步焦点生命周期、snapshot映射/no-op/未知doc/能力回退、异步读取后最新阅读位置及实际source writer。
- `node scripts/desktop-relink-viewport.mjs final --output=artifacts/relink-viewport/final-complete`：最终11/11、errors0。读写×鼠标/纯键盘Enter成功、取消、缺失路径，以及两模式页签/异步焦点/重复取消、公开新建关联命令入口直接键入。严格检查原模式逐rAF的原生scroll和真实anchorY≤1px、只替换受校验目标且保留别名/全文；实际成功与取消/失败均0px。
- `node scripts/desktop-manual-layout.mjs final --output=artifacts/relink-viewport/manual-regression-complete`：同包16/16、errors0，重测完全手动、自由返回、三设置入口/禁用控制、真正非栅格/重叠、恢复外观/reset、分屏、Ctrl新Tab、插件重载和真实进程重启。故当前0.2.24桌面功能验收合计27/27，不把0.2.23的22项直接计成本版重测。
- 独立只读审查核对源码、测试、数据边界及两份clean报告，没有阻断项。最低1.10.6本地安装包源码含scrollSnapshot且事务同样强制scrollIntoView，仅为能力结构检查，不当作本轮最低宿主桌面通过结果。

验收修正均保留原始失败：早期Tab用例失败未停trace，后续探针访问暂时null的file引发自身错误；已补每case/finally清理、启动前回收和文件状态保护，并在干净WebContents重测。正向Tab离开WebContents会按既有window-blur规则关闭面板，异步不抢焦点验证改为Shift+Tab留在面板内，未增加焦点trap。原生设置窗口仅DOM刚连接即读取/关闭后立即打开Quick曾产生3条无栈illegal-access；卸载Editor、loaded字段读取及订阅1→0后保存等对照均无错，不能泛称宿主通用告警。正确流程等待原生控件可见稳定、窗口真正关闭及主文档恢复焦点后，再打开Quick；完整16项最终错误0。没有为这些探针/窗口时序问题修改生产代码、放宽1px门槛或泛化过滤errors。

[结果摘要](artifacts/relink-viewport-0.2.24.json)、[发布收据](artifacts/release-0.2.24.json)。最终bundle `f3be4d44770bc70d9d11bb2edb9583b6ce9cb55b8b69bbb9f7cfb045c4a953e4`与安装目录及实际验收一致，ZIP五文件逐字节/版本/许可核对通过。收尾12个选定夹具移到ignored证据目录且散列一致，6份配置原样恢复，当前无隔离进程。其他宿主/主题/平台、popout/第三方DOM、大库长期使用未测；真实分栏重链由动作单测覆盖，桌面分屏布局重测不能代替该组合的GUI证明。

## 0.2.23 完全手动布局与导航恢复 · 2026-11-17

基线为干净main `416516ba63a3c5d4b0c7265e6bf879cf7855d8fc`（0.2.22）。使用选定UE6笔记与十个目标的隔离副本、默认主题、1614×838/DPR1、Windows Obsidian1.15.1。旧test-profile启动停滞后，仅终止经过参数核实的本轮隔离进程，改用test-profile/manual-layout-run干净子profile及本机已有1.15.1缓存包；普通Obsidian保留，没有更改正式库或整个用户profile。

实际点击卡片、执行原生历史返回，四组基线中source/free只有Verse一条保存位置时复现四张未拖卡漂移：dives右→左、Scene Graph左→右、model-assisted右→左、ship右→左，锚点相对偏移也变。其余三组这次稳定，不声称四组都复现。原因是每次切文件清空StableLayout后按分批到达的可见锚点重新平衡，只有拖过的卡片有持久位置。

现有schema2 UI位置增加批量初始化：free/snap/manual在首次稳定显示后保存未记录的安全弱身份和精确相对位置，返回时恢复；不会在pointermove或每帧更新时间戳，也不因初始化挤掉既有记录。manual另有独立布局分支：忽略左右平衡、counts和碰撞挤开；新卡只给独立邻近侧初始位置，保存侧不可用则隐藏，不换侧。进入manual前冻结已测布局，多分栏最近操作视图优先，其他视图补齐未认领key；源文变更未重绘、歧义身份和超出相对预算的快照不写。小于1px的可移动水平空间按真实宽度归一化，避免反复恢复缩短偏移。

- `npm test`：45文件437项通过（新增25项）。`npm run lint`及最终`npm run package`通过。构建首次因测试夹具与私有字段的交叉类型报错，改为明确的测试接口后tsc通过，未修改生产类型边界。
- `node scripts/desktop-manual-layout.mjs baseline` / `final`：最终16/16。涵盖四组原生点击返回、manual读写无记录及忽略左右优先、精确非栅格和有意重叠拖动、三设置入口/disabled控制、恢复外观不改模式、resize/滚动/插件重载、Ctrl新Tab、重置当前笔记不改其他笔记、两个同时分栏合并、真实进程退出/新PID重启、auto不写生成位置。
- 同包旧curve-drag脚本副本只筛四组curve轨迹和两组立即松手/插件重载，输出改到`artifacts/manual-layout/curve-regression/`：6/6。48步真实拖动，绘制p95约2.9–4.0ms，pointermove保存0，无文字/卡片碰撞，重载位置一致；不将它当新旧同布局性能对照。
- 侧栏初次关闭后共同x差15.75px经完整host/body/viewport与归一化记录核实为180Hz下只等10帧导致动画未结束。探针改为连续8帧且至少320ms几何稳定，维持相同几何及1px门槛后通过；点击另用真实hit-test点，重叠测试遵守实际空白带，启动等待完整plugins/workspace。中间失败原始报告保留，生产代码未因探针问题打补丁。

正式源在复制夹具后、baseline脚本启动前由`98d945…`变为`c463d3…`，变化来源未核实；本任务只读且未覆盖该变化。baseline/final/curve各run正式源起止都为c463d3，隔离副本及复制收据一直为98d945。初次速报误把发生时序写成baseline→final，已在提交前更正；本轮旧探针误标的fixtureSHA字段也在ignored原始报告中附来源说明后更正，没有改写历史版本报告。不能声称全轮正式源未变。

[结果摘要](artifacts/manual-layout-0.2.23.json)、[完全手动设置](artifacts/manual-settings-0.2.23.png)、[发布收据](artifacts/release-0.2.23.json)。源码/安装目录/实际桌面bundle为`1b14311e30c963e6727717e548e3df0d8aa06a05cda3f3035b2d17e2abb41086`，ZIP五文件逐字节、版本及许可核对通过。保留每笔记100条、全局500条、90天及唯一弱身份限制。其他主题/DOM/系统、最低宿主与大库长期使用未覆盖。新增的重链视口与搜索焦点要求按用户指令在本阶段完成后处理，不计为本版已实现。

## 0.2.22 平滑曲线拖动性能 · 2026-11-16

起点为干净 main `39fbdae671d97818cb93c288f5481d35a8a4d563`（0.2.21），跟踪 origin/main。Windows Obsidian 1.15.1、默认主题、霞鹜文楷15px/22.5px、700px正文、1614×838、DPR1；只读正式UE6笔记与十个目标，将选定内容和UI位置复制到test-vault。正式笔记散列前后不变，未向正式库安装或写入夹具。

曲线模式多枚举出口、目标入口、三次控制柄和七档圆角。旧版每次移动都做大量递归避障，再为同侧多条关系重复探索共享走廊；普通overlay.render计时没有包含pointermove直接触发的paintConnectors，不能用此前暖滚动结果推断拖动性能。

本版仅调整现有求解流程：检查必经的最短首段，整组候选评分不可能胜出时跳过；保留原“首个安全形状”选择顺序。safe先排除直段/边界失败，再对所有文字及卡片障碍统一递归检查曲线。拖动期间停止整侧走廊探索，但旧路径仍按所有最新卡片重验；松手/取消将策略位纳入缓存签名，恢复完整共享优化。没有降低描边、文字框或曲线避障要求。

- `npm test`：42文件412项通过（新增11项）；`npm run lint`、`npm run package`（含tsc/build）通过。新测试覆盖近卡片共线、圆角提前转出、末端阻挡、实际变化关系的求解次数、旧线被移动卡片挡住后的重算及释放重优化。
- `node scripts/benchmark-connector-drag.mjs --baseline=39fbdae --output=artifacts/curve-drag-cpu.json`：同六关系夹具30步，curve求解p95为旧版22.3ms、仅renderer优化13.3ms、完整拖动策略1.5ms。另933组逐字段几何差分通过（444有路、489失败），包括左右、近距/同列/折返、密/闭缝、粗线、边界、卡片、previous/corridor；旧实现直接抛错的零长度端口不纳入相等断言。
- `node scripts/desktop-curve-drag.mjs baseline` / `final`：对ship、dives分别在读写×三线型执行相同48步真实pointer轨迹，计时直接包裹paintConnectors。每次计时后另采样三个真实移动位置的原生SVG，独立校验全部六线的端点、接缝、完整文字Range及卡片描边碰撞；无pointermove保存、邻卡移动、取消后位置变化。

| 平滑曲线拖动 | 0.2.21绘制p95 | 0.2.22绘制p95 |
| --- | ---: | ---: |
| 阅读 ship | 35.4ms | 1.2ms |
| 阅读 dives | 110.3ms | 3.5ms |
| 编辑 ship | 30.1ms | 1.3ms |
| 编辑 dives | 93.1ms | 2.1ms |

这12组可比测量使用当时相同UI位置（ship与dives均在右侧），旧曲线右卡两组分别出现36/38次long task，最终全部计时窗口为0。数字是本机连线绘制耗时，不是完整输入延迟或显示FPS。原生关闭/重启隔离窗口后复测，实际加载manifest为0.2.22，避免仅凭缓存中的版本号判断产物。

最终拖动专项16/16：12组对照之外，左侧Scene Graph读写额外两组通过（p95 3.4/2.8ms，无基线对比），另两组立即松手、保存及插件重载后位置一致。六线无文字/卡片碰撞，其他卡片不动；合计本轮真实桌面26/26。

原笔记缺线和低转折回归10/10：两尺寸×读写×直线/直角均六线完整且无碰撞，90步暖滚动仍无求路、测量、d写入或保存。执行原desktop-route-quality脚本的同内容副本，仅输出改到ignored `artifacts/curve-drag/regression-final/`，保留0.2.21原报告。源码/安装目录/桌面验收bundle一致为 `b6416291c8aec15bf2be01299faac34515d51c1011419ffb134e900bc86da5a6`；ZIP五发布文件逐字节、版本和许可核对通过。

[桌面对照摘要](artifacts/curve-drag-0.2.22.json)、[CPU和几何差分](artifacts/curve-drag-cpu.json)、[发布收据](artifacts/release-0.2.22.json)。其他主题/第三方DOM/系统、最低声明1.10.6、popout、大库长测与完整手势结束延迟未覆盖。真实封闭通道仍按配对编号续接；无须修改原文或移动其他卡片来取得路径。

## 0.2.21 密集行间缺线与多转折 · 2026-11-16

基线为干净 main `3451ba135b87f5c52557dab6da0396b7004a5620`（0.2.20）。正式 AnyTime 库只读，选定原笔记和十个双链目标复制到项目 test-vault；使用原十条卡片位置与偏好、霞鹜文楷 15px、22.5px 行高、700px 正文、默认主题、缩放 100%、DPR 1。实际宿主为 Windows Obsidian 1.15.1。没有向正式库安装或写入测试内容，原笔记 SHA256 前后一致。

基线在 1614×838、1536×717 的阅读和编辑模式均复现 Verse、Scene Graph、model-assisted 三条缺线，只剩配对编号。三个源端上下文字框间距均为 3.5px，而旧固定留白加最大描边需双侧 5px，源出口被封住；备用网格搜索仅保存位置和距离，同长路线被拆为任意交替横竖步。ship 阅读为 8 折、编辑为 7 折。

整改集中在 connector-renderer 与 connector-batch：首选 1.5px 额外留白，失败后尝试 0.5px，始终保护完整 DOM 文字框和悬停加粗描边；直线/直角可使用精确安全边界，曲线保留圆角所需法向引线。搜索状态加入进入方向，每次转弯计 48 CSSpx 代价；直线中间跨度再做经安全校验的可见性简化。共享方案不能增加任何成员的转折，缓存按实际留白重验。曲线的完整障碍校验也修复了按端点纵向范围预过滤、遗漏真实曲线外凸碰撞的问题。

- `npm test`：40 文件、401 项通过（新增 17 项）。`npm run lint`、`npm run package`（含 tsc/build）通过；ZIP 五文件、逐字节、版本及第三方许可核对通过。
- `node scripts/desktop-route-quality.mjs final`：原 1.5px 配置 10/10。两尺寸×读写×直/直角，每组六条实际可见 SVG 连线完整，端点/共享接缝误差 <0.001px，途中不离开视口，无续接编号，独立完整文字 Range 与卡片描边碰撞为 0。直线和直角均为 2–3 折，ship 降至 2 折。
- `node scripts/desktop-route-quality.mjs final --width=2`：18/18。相同八组与暖滚动通过，另含 48 次逐卡聚焦，实测最大描边 2.5px，全部仍连续可见且无文字/卡片碰撞。探针使用 CSSNumericValue 解析实际 `calc(2.5px)`，避免 parseFloat 将已绘制的路径误判为不可见；未降低任何验收门槛。
- `node scripts/desktop-route-quality.mjs final --intro`：另8/8。开头 glimpse、fellow、reinvented、evolving 四条在两尺寸×读写×直/直角均为完整可见、无碰撞的2–3折连线；只调整滚动，保留原卡位置。至此全文十处双链均覆盖，本轮桌面合计60/60。
- 两宽度均显式预热后滚动 90 rAF 步，读写 overlay 工作 p95 约 0.4ms，求路、障碍测量、SVG d 写入、编号位置写入和保存均 0。基线路由截图后才加入显式预热，故不将其旧暖计数作性能对照，也不从此推断冷布局和长期大型库性能。
- 编号/四显示方式/重复出现/键盘高亮/设置共用及三线型×2/5px×读写真实回归 24/24。执行的是原 `desktop-number-modes.mjs` 的同内容副本，仅输出改为 `artifacts/route-quality/regression/`，保留此前历史报告。

[本轮结果摘要](artifacts/route-quality-0.2.21.json)、[发布收据](artifacts/release-0.2.21.json)、[直角实图](artifacts/route-quality-elbow.png)、[直线实图](artifacts/route-quality-straight.png)。最终安装目录、ZIP 和实际验收 bundle SHA256 均为 `94595fb31b75b2256d4be0b7b0ecbdbc641abd1fed5dba705397eedcbdb0f603`。原笔记全文及复制目标仅在忽略的本地证据中保留，不进入 Git。

范围限制：本轮覆盖用户报告的字号、布局、两种尺寸与 1.5/2px；实际几何封闭、过粗线宽、其他字体/主题和第三方 DOM 组合仍可能使用配对续接。最低声明宿主 1.10.6 与其他系统未重测。旧验证章节保留其当时范围与结果。

## 0.2.16–0.2.20 关联文件与滚动性能 · 2026-11-16

基线为干净的 `main`，`27c4e2d31f6aa3e0f169a6637e653558c39d084a`（0.2.15）。本轮仅操作项目 test-vault/test-profile；Windows、Node 24.16.0、npm 12.0.1、最终 Obsidian 1.15.1、Intel i7-14700KF、RTX 5070 Ti，显示器报告 180 Hz，默认主题，缩放 100%，CDP 1800×1100、DPR 1。最初宿主为 1.15.0，隔离重启后应用已有更新升为 1.15.1，最终性能基线与新实现均在 1.15.1 重跑。每版均运行完整单测、lint、含 tsc 的 build/package，并核对五个发布文件和 ZIP 摘要；17–19 从 Git 暂存树独立构建，避免并行开发混入后续版本。

| 版本 | 自动化测试 | 提交 | 安装包 |
| --- | ---: | --- | --- |
| 0.2.16 | 317 | b8fa475 | dist/MarginLink-0.2.16.zip |
| 0.2.17 | 351 | 608b899 | dist/MarginLink-0.2.17.zip |
| 0.2.18 | 356 | 6e681a0 | dist/MarginLink-0.2.18.zip |
| 0.2.19 | 360 | 323dc5d | dist/MarginLink-0.2.19.zip |
| 0.2.20 | 384 | 本节所在版本提交 | dist/margin-link-0.2.20.zip |

包的 SHA256 与逐文件摘要见 [发布收据](artifacts/releases-0.2.16-0.2.20.json)。构建物按约定不进入 Git。

暂存树构建使用目录联接共享依赖时，esbuild 的依赖路径可能为 `../../../包名`。本轮修正打包脚本，从实际输入定位所属 package.json 收集许可证，避免仅匹配 `node_modules/` 前缀产生空通知。17–19 已重新打包，五个 ZIP 均确认第三方通知非空且字节一致；运行时 bundle 保持已验收摘要。

### 视频、根因与滚动对照

本轮独立解码用户视频全部 120 帧，1134×898、24 FPS、5 秒，以四个固定横向区域进行灰度归一化互相关；最低模板置信度均 >0.93。[全部逐帧测量](artifacts/source-scroll-analysis.json)复现计划中的结果：F22–105 共 84 帧，79 帧正文/卡片错位 >1 视频像素，17 帧 >100，中位数 51，最大 244（F46）。卡片、编号与线拐角共同滞后，支持整层运动时序问题；24 FPS 录屏不能测得应用实际 FPS 或定位唯一长任务。

源码及真实 DOM 核实：原阅读实现从不滚动的 `.markdown-reading-view` 读取 scrollTop，真正容器为内层 `.markdown-preview-view`；固定覆盖层等待下一次 JS 绘制。新实现将卡片、SVG 和编号放入同一原生内容层，位于 CodeMirror 可编辑 DOM 外，限制溢出，不增加 scrollHeight。测量与求解缓存覆盖当前区间；成功及失败路线均复用。另修正 CSSOM 小数精度序列化造成的位置误判；读取浏览器样式字符串曾使每帧误增几何版本。期望位置现在由绘制缓存比较。阅读渲染器会删除同一 sizer 下的附加节点，0.2.20 会在挂载时恢复丢失的层，且保留原位置与清理责任。

相同设备、相同 150 帧 ±70px 正弦往返轨迹，预热后用 Performance trace、DOM 探针和开发时显式启用计数采样。原生对照实际卸载插件；表中“工作”是 overlay.render 的主线程耗时，“d 写入”含实际描边及隐藏逻辑参考路径。最终读写两模式求路、路径写入、完整障碍扫描、编号重新定位和位置保存均为 **0**；基线没有求路计数器，未填充假零值。

| 组别 | 阅读工作 p50/p95 ms | 编辑工作 p50/p95 ms | 阅读/编辑 d 写入 | DOM 即时偏移探针 |
| --- | --- | --- | --- | --- |
| 原生卸载 | 无插件工作 | 无插件工作 | 0 / 0 | 无装饰 |
| 0.2.15 常驻 | 1.4 / 4.5 | 2.3 / 2.8 | 1505 / 2820 | 最大 17 CSS px |
| 0.2.20 常驻 | 0.3 / 0.4 | 0.3 / 0.4 | 0 / 0 | 0 CSS px |
| 0.2.20 仅编号 | 0.2 / 0.3 | 0.2 / 0.3 | 0 / 0 | 0 CSS px |

各组 rAF 帧间隔 p50 约 5.6 ms、p95 约 5.6–5.7 ms；最长帧为基线阅读 11.1 ms，最终各组不超过 5.8 ms。观测到的 >50 ms 主线程任务均为 0，没有此范围的长任务可归属；不能据此宣称所有设备或冷启动没有卡顿。原生/插件 scrollHeight 相同：阅读 2382、编辑 2585 CSS px。DOM 探针故意在设置 scrollTop 后立即测量，基线 17px 是同步性探针结果，不是实际显示帧误差。

另以原生滚轮捕获 Chromium 合成画面，最终读写各 13 个有效 PNG 帧，独立跟踪文字和卡片标签，最大视频像素漂移均为 0（DPR 1）。本机基线捕获 14 帧、漂移 0；这种稀疏采样没有复现用户原片的连续滞后，也不能排除采样间隙中的迟滞。采样时间、置信度、p50/p95、最长帧及逐关联结果见 [本轮摘要](artifacts/iteration-16-20-summary.json)，原始 trace/PNG 在本机 artifacts/iteration-16-20/，可用下列脚本重做。

### 实际交互与缺线结果

最终安装包的四组桌面专项 **50/50**，全部来自本轮实际运行：

- `node scripts/desktop-link-actions.mjs 20`：9/9。普通单击、Enter/Space、4px 阈值两侧、有效拖放、拖回正文不补开、Esc、一次原生撤销；带引号中文 HTML 与 2 MB 二进制 XMind 移动，字节摘要相等，重名使用已有且保留来源，库内精确路径、文件夹错误与过期输入。导入撤销保留附件。
- `node scripts/desktop-number-modes.mjs`：24/24。全文出现顺序编号、重复目标分别编号、读写双模式、重绘/重开、四模式互切、三个设置入口、明暗主题、键盘共同高亮、两端独立裁切。仅编号冷启动求路、SVG d 写入和完整障碍扫描均为 0。
- `node scripts/desktop-relink.mjs --menu`：11/11。实际右键入口，只替换第二处完全相同链接，目标长度变化也不误改邻卡；别名/无别名、验证或明确保留/移除标题和块子路径、失效目标、同文件分栏过期编辑保护、手动布局/编号经 Undo/Redo 和重开保持。阅读真实内层滚动位置 **20→20**，随后切源模式的原生撤销/重做通过。
- `node scripts/desktop-scroll-lifecycle.mjs`：6/6。原生指针拖动当前卡 65px，5 张邻卡不动；读写分屏分别滚动均不移动另一窗格 6 张卡；真实阅读重渲染及同一 sizer 移除装饰后恢复原 6 个卡片 DOM；双窗格闲置 400ms 渲染/测量/求路/绘制计数全 0；禁用后固定层和原生层均清理并恢复父节点样式。另测新区域跳转 0→2955px，4 次渲染/测量/求路/完整障碍扫描、6 次 d 写入、48 次编号定位，单次渲染约 0.9–1.4ms，单列于暖缓存预算之外。

原密集夹具在读写模式均为 5 条完整安全路线，`ship` 使用同号两端续接；六组源文字、目标卡片和提示逐一核对，没有静默缺失。实际 `ship` 字形行上下只有 4px 间隙，小于当前安全余量需求；这是当前矩形障碍与描边规则下的搜索失败证据，不是任意几何均不可能连通的证明。另将行高明确设为 32px 的可达夹具，在三种线型×2/5px 线宽×读写双模式下均 **6/6 完整路线**；通过实际 SVG M/L/Q/C 采样、端点/共享段连续性和独立字形/卡片碰撞检查，未以路径节点数量冒充六条关系。编号截图见 [最终阅读模式](artifacts/iteration-final-numbers.png)。

文件系统专项用真实 Windows 临时文件及注入故障覆盖源复制中改变、目标抢占/被改写、权限拒绝、删除失败后复核重试、取消、符号链接/目录联接、失效目录、事务失败、部分副本的所有权与摘要保护。跨卷边界以禁止 rename 的模拟验证；没有实际第二块卷或另一进程持锁实测。绝对来源只出现在操作 UI，不写进笔记或插件关系数据。

重做性能：`node scripts/desktop-iteration.mjs baseline|final preview|source`（先安装对应版本）；`node scripts/desktop-scroll-capture.mjs final preview|source` 后运行 `python scripts/analyze-compositor.py <输出目录>`。原视频分析：`python scripts/analyze-scroll-video.py <视频> <输出.json>`，需本机 OpenCV。截图/trace 不替代用户主题、全部第三方插件、macOS/Linux、最终 1.10.6 或大型库长时验收；旧 Linux 套接字阻塞是历史环境结果，不能作为本轮 Windows 的状态。

## 0.2.11–0.2.15 连线与手动布局整改 · 2026-11-16

本轮基线 main 55f4033（0.2.10），开始工作树干净。独立加载基线实际路由函数，提示词给出的墙体用例在直线/折线/平滑三种样式均返回空，证据为 artifacts/connector-baseline-0.2.10.json。

0.2.11：248项测试、lint、TypeScript、build/package通过。新增扩展搜索、真实封闭出口与恢复、其他卡片保护、可视边界及安全编号续接测试；三种样式×常规/最大线宽的六关系几何夹具均为6/6完整路径，不能用续接标记计数代替。原生桌面启动仍因 socket Operation not permitted 阻塞，尚无本轮桌面通过结果。

0.2.12：259项测试、lint、类型检查、构建/打包通过。自由模式允许精确重叠，单卡移动/重置只更新自身缓存及UI记录；吸附只改变当前卡的网格位置。新增独立性及编号DOM集成测试覆盖其他卡片不动、重开重叠恢复、配对高亮/隐藏/恢复。0.2.13：265项测试、lint、类型检查、构建/打包通过。左右/高低错位/两档线宽验实际末段，不以总线长代替；压缩冗余折点，近距离直达和端口稳定回归通过。0.2.14：270项测试、lint、类型检查、构建/打包通过。独立SVG采样器支持M/L/Q/C及导数，左右宽裕斜向连接有实质转向长度、连续切向，主干接合和共线直连通过。曲线碰撞检查计入完整控制点包络和细分描边。0.2.15：301项测试、lint、类型检查、构建/打包通过。批量绘制拆出实际共享区间，每段一次描边，关系保留有向有序引用；22项批量路由和4项真实覆盖层集成测试检查三线型正反例、单次描边、分支切线、独立高亮、成员删除、首次纯滚动复用同一批次和DOM。另补齐手动跨侧后重开的自动基准、增量测量不受拖动影响、全局整理范围与源端接触安全回归。

| 版本 | 自动化通过数 | 构建与安装包 |
| --- | ---: | --- |
| 0.2.11 | 248 | lint、tsc、build、package、ZIP字节核对通过 |
| 0.2.12 | 259 | 同上 |
| 0.2.13 | 265 | 同上 |
| 0.2.14 | 270 | 同上 |
| 0.2.15 | 301 | 同上 |

安装包版本与SHA256逐版保存在 artifacts/releases-0.2.11-0.2.15.json。实际批量SVG的独立栅格图已目视检查：共享夹具的直线/折线各94px公共段，平滑70px公共段，均只绘制一次。这是合成几何检查，不是Obsidian窗口截图或真实字体避让的桌面验收。

本轮重试官方Obsidian1.10.6，仍在插件加载前因通信套接字 Operation not permitted 退出（artifacts/connectors-manual-launch.json）。最终桌面脚本报告 blocked、0场景通过（artifacts/connectors-manual-final-15/results.json）。未将旧截图或几何/DOM模拟测试当作桌面通过。桌面待验：阅读/实时预览/源码、分屏、最大线宽、缩放后的真实字形、六条完整路径、拖动其他卡片位移、重叠重开、续接标记安全留白、转向观感、共享段显隐与删除。

复做：仅安装到项目test-vault的插件目录，按README启动隔离实例后执行 `node scripts/desktop-connectors-manual.mjs final --through=15`、`node scripts/desktop-scroll-routing.mjs final`、`node scripts/desktop-stability.mjs final`、`npm run test:desktop`。现有脚本已忽略隐藏的逻辑参考路径，实际描边按成员和有向线段独立采样，不会以DOM path数量冒充已完成关系。


## 0.2.8–0.2.10 本轮整改 · 2026-11-16

基线 `570fad1bb674ebd2d51beffce25cd6294d122a99`（0.2.7），全新隔离 checkout，Node 24.22.1 / Linux。先运行 200 项基线测试，再用原版布局函数记录 [滚动基线](artifacts/scroll-baseline-0.2.7.json)：手动卡中心 60、50、50、50；六卡 ship 中心从 86 跳到 288。

0.2.8 的 209 项测试、ESLint、TypeScript、构建、打包通过。覆盖手动卡 60→30 的自然裁切、六卡整体 -80px 位移、auto/free/snap、虚拟化移除/重入、新卡加入不推挤旧卡、原文参考变化、两视图隔离、零 UI 数据写入以及拖放边界保留。

0.2.9 的 224 项测试、ESLint、TypeScript、构建及打包通过。新测试独立解析输出 SVG，覆盖左右同高、三线型、1/5px 线宽、长标题、行内代码、跨行别名、拥挤省略与空间恢复；5 项障碍缓存测试覆盖内容坐标、滚动复用、邻域边界、部分字形及 display: contents。真实字体加载和横向滚动会失效旧几何，当前绘制使用计入悬停增粗的安全线宽。新增 [最终桌面尝试](artifacts/scroll-routing-final.json) 为 blocked，零场景通过。

0.2.10 的 232 项测试、ESLint、TypeScript、生产构建及打包通过。新增8项图标语义测试覆盖 .html/.htm 大小写、灰阶SVG及无框HTML短标、别名、单一提示、读屏隐藏和未解析/Markdown/XMind保留。使用SVG栅格器渲染并目视检查了实际矢量图形的明暗灰阶外观；这只是图形资产检查，**不等同于实际卡片CSS、32px裁切或桌面交互验收**。`node scripts/check-html-icon.mjs` 尝试启动浏览器时同样收到 socket Operation not permitted，36个真实DOM/CSS场景未运行。可在允许浏览器进程的桌面执行该脚本，另在Obsidian同屏对照Markdown/XMind卡片，检查100%与高缩放、三形状、焦点和拖动。

| 安装包 | 自动化测试 | 构建与ZIP核对 |
| --- | ---: | --- |
| 0.2.8 | 209 | 清单版本、main.js/styles.css/许可逐项核对 |
| 0.2.9 | 224 | 清单版本、main.js/styles.css/许可逐项核对 |
| 0.2.10 | 232 | 清单版本、main.js/styles.css/许可逐项核对 |

本轮下载官方 Obsidian 1.10.6 并校验 SHA256（`1596c81d8645ff9f6506b5b3e1a6963250d9372ceb58eb037551e53bc1b16f72`）。使用本工程 test-profile 与 test-vault 隔离启动，进程退出 133：`process_singleton_posix.cc:294 socket() failed: Operation not permitted (1)`，发生在插件加载前。Chromium 管道模式亦被同类权限阻塞。桌面基线脚本 [报告](artifacts/scroll-routing-baseline-scroll.json) 明确为 blocked、零场景通过；没有将旧截图或历史报告作为本轮实测。

待桌面复做：构建后仅将 dist/margin-link 安装到本工程 test-vault/.obsidian/plugins/margin-link；按 README 启动隔离实例并开放 CDP 9223。依次运行 `node scripts/desktop-scroll-routing.mjs final --scroll-only`、`node scripts/desktop-scroll-routing.mjs final`、`node scripts/desktop-stability.mjs final` 和 `npm run test:desktop`。新增脚本独立量取正文 Range 与 SVG 屏幕路径，覆盖阅读/实时预览/源码、部分裁切与点击穿透、拖放后返回、分屏及三种线型。旧稳定性脚本完整边界断言只用于侧栏缩放/拖放，仍保留。真实逐帧滚动、连线避字和图标观感未在当前环境验收。


## 0.2.7 与前序补丁 · 2026-11-16

基线为公开仓库的 0.2.2（`2dd4c698`）。依次构建的四个中间版本和最终包分别通过测试、ESLint、TypeScript、生产构建及打包。各 ZIP 均已解压校验，含清单、main.js、styles.css 和许可文件，清单版本与文件名一致。

| 版本 | 通过的自动化测试数 |
| --- | ---: |
| 0.2.3 | 173 |
| 0.2.4 | 173 |
| 0.2.5 | 173 |
| 0.2.6 | 192 |
| 0.2.7 | 200 |

0.2.7 专项覆盖两个开关的四种组合、扩展名冲突隔离、旧设置升级和独立保存、附件改名及其他文件改名。新建笔记覆盖普通确认和 Ctrl 确认的目标、选区失效、同名保护。隔离库真机脚本新增附件文件列表和独立窗口场景，使用有效的 XMind 测试档案。

在本次 Linux 环境尝试启动隔离的 Obsidian 1.10.6，桌面进程在创建通信套接字时收到 `Operation not permitted`，尚未得到原生界面的交互结果。原生文件列表、第三方查看器共存、实际输入焦点和四向连线的视觉效果请在桌面复核。可执行 `npm run package`、`node scripts/setup-test-vault.mjs`，在有桌面环境的机器上按 README 启动隔离实例并运行 `npm run test:desktop`。下方记录属于历史版本。

## MarginLink v0.2.2 验证记录

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
