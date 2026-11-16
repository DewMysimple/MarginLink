# MarginLink

**Obsidian 原生双链的边缘卡片与空间布局。** 已有 `[[Wikilink]]` 自动显示为卡片；选中文字，用链接手柄或命令选择已有文件或新建 Markdown，即写入标准 `[[目标路径|原文字]]`。关闭插件后，全部原生链接仍可用。

**v0.2.15**，适用于 Obsidian 桌面端，最低声明版本 **1.10.6**。插件可在原生文件列表识别 HTML 网页和 XMind 思维导图。两个独立开关位于设置中的“Obsidian 能识别的文件类型”。本版验证范围见 [VALIDATION.md](VALIDATION.md)。

## 安装与升级

本机可安装目录为 `dist/margin-link/`，ZIP 为 `dist/margin-link-0.2.15.zip`。解压，将 `margin-link` 文件夹放到笔记库：

```text
<Vault>/.obsidian/plugins/margin-link/
├── manifest.json
├── main.js
├── styles.css
├── LICENSE
└── THIRD_PARTY_NOTICES.txt
```

进入“设置 → 第三方插件”，按需关闭受限模式，启用 MarginLink。**不要安装到 `D:\SoftWare\Obsidian` 程序目录**；程序安装位置与笔记库插件位置不同。本项目的独立演示库是 `test-vault/`，可用 Obsidian 仓库管理器打开；开发测试不写入你的正式 Vault。

升级时只替换发布文件，保留原 `data.json`。旧平铺配置与当前嵌套配置中的合法选择逐项保留，包括“悬停”“自动排列”“横向卡片”；只有缺失或无效的字段采用新默认。新安装和“恢复默认外观设置”统一为 `lines=always`、`placementMode=free`、`cardShape=square`。恢复默认不删除卡片位置。`layout` 继续代表左右优先，`placementMode` 控制拖动模式。

Git 仓库不跟踪 `main.js`、`dist/`、依赖或隔离 profile。克隆源码后可双击 `buildStart.cmd` 一键更新并生成 ZIP，也可运行 `npm ci`、`npm run package` 生成安装目录；具体命令见开发章节。此版本没有代替用户发布 GitHub Release 或提交 Obsidian 社区目录。本轮新桌面验收受到环境套接字权限阻塞，待测范围见验证记录。

## 创建和打开原生双链

1. 在 Live Preview 或源码模式选取普通行内文字。选区末端出现**链接手柄**；拖到正文左/右空白带，松手后可搜索已有文件，或选择“新建文件”创建 Markdown。也可用命令“将选中文字链接到文件 / Link selected text to file”，或聚焦手柄后按 Enter。
2. 例如 `Early Access` → `[[References/stages.html|Early Access]]`。只替换原选区，保留空格、中文与 Unicode；一次撤销/重做对应一次创建。
3. Esc、取消弹窗、非法放置、选区/文档版本/活动笔记变化都拒绝提交。不会错误包裹另一段文字。
4. 点击卡片打开实际目标；Ctrl/Cmd 点击新标签，Tab/Enter 操作卡片。原生双链的点击与悬停预览不被截获。未解析卡片显示明确状态，不创建文件。

新建笔记时可以在设置中预设三个存放目录。普通点击“创建并链接”后回到原文继续输入，按住 Ctrl 点击会立即在独立 Obsidian 窗口中编辑新笔记。文件名可修改，原选文字用作别名，例如 `[[详细分析/Vocabulary/model-assisted.md|model-assisted]]`。

创建仍限一个连续的普通行内选区：允许软折行，拒绝硬换行、代码、属性、公式、嵌入、已有链接内部、多选区和不安全别名/文件名。**表格内创建暂不支持**，避免别名 `|` 破坏表格。含 `\|` 的转义 Wikilink 保守跳过。普通 Markdown 链接、外部 URL、`![[嵌入]]` 不生成卡片。

## 移动已有卡片

在自由/吸附模式，按住**卡片图标、文件名或空白处**即可拖动，不会编辑笔记。已有卡片没有独立握柄；正文选中文字后的链接手柄继续用于创建双链。

| 模式 | 行为 |
| --- | --- |
| `auto` 自动 | 确定性排列、左右平衡或优先；不拖动、不写自由坐标；已保存的位置保留，切回手动模式可恢复 |
| `free` 自由 | 在当前 MarkdownView 的左右空白带进行二维放置，可跨侧移动；允许有意重叠，只更新当前卡片，其他卡片保持原位 |
| `snap` 吸附 | 仅当前卡片按栅格吸附，允许重叠；不推开其他卡片 |

移动达到约 5 个 CSS 像素才开始拖动；第一帧起保留按下时的整卡抓点，跨侧改变尺寸时保留抓点比例。单击卡片任意位置打开文件，Ctrl/Cmd 单击新标签。合法松手立即提交内存位置并抑制本次拖动产生的点击，下一次单击正常打开。拖动中没有跟随文字或悬停提示，“显示拖动边界”只控制空白带视觉反馈。最终位置必须落在本 leaf 的空白带内。**Esc、pointercancel、失焦、焦点进入其他控件、滚动、窗口 resize、切换笔记/模式、文档变化或卸载会取消**。非法或无空间的放置恢复原位置。

键盘操作：Tab 聚焦卡片自身，Enter/Space 打开，方向键移动，Shift+左右键换侧，Delete/Backspace 恢复此卡片自动位置。右键卡片也可恢复单个位置。设置、快捷面板及命令提供“整理/清除当前笔记布局”和“清除所有布局”，清除需确认，双链不受影响。

同一笔记多个 leaf 共享视觉偏好，但每个视图独立测量、裁剪和排布。保存的是 `side + xNormalized + yOffset`：水平值是空白带内的比例，垂直偏移以当前文字行高为单位、相对对应锚点。静态卡片保持与原文的相对距离，碰到窗格上下界时自然裁切，原文先离屏也不会将仍露出的卡片移除。纯滚动复用该窗格的内存排布，不改侧别、顺序或已保存位置；真实行宽、字体、内容与外观变化才可重排。拖动侧栏或分屏分隔线时，卡片与连线使用同一帧几何连续更新；只在该卡片横向确实没有空间或卡片完全离屏时移除，不修改保存的位置。

0.2.12起，手动位置恢复允许重叠，未拖过的卡片仍按独立的自动基准排列；拖动、键盘移动或单卡重置只改变当前出现位置。显式整理当前笔记或全部布局才重排对应范围。

## 连线与卡片外观

原生“设置 → MarginLink”保留完整设置，按基础、连线、布局、卡片、交互与辅助功能分组。顶部有不修改笔记的实时 DOM/SVG 预览。

- **连线**：隐藏/悬停聚焦/始终显示；曲线/直线/直角折线；1–5px、步长 0.5；常驻透明度 10–100%、默认 65%；主题强调色或紫/蓝/绿/灰预设。激活状态更清晰，`none` 保留卡片与跳转。
- 连线的正文端仅使用真实文字片段上沿或下沿中点；整条路径避开正文、标题和行内代码。保留所选线型与短引线，长纵向段放在正文列外；便宜候选失败后继续沿障碍边缘搜索；两端可见而确实封闭时，在安全留白显示相同编号续接，指向或聚焦任一端共同高亮。空隙恢复即恢复完整连线，隐藏模式同时关闭编号。
- **卡片**：横向、正方形、极简图标；小/中/大。正方形 76/84/92px，图标 32/36/44px；横向按实际空白宽度缩放。可调圆角、边框、阴影和路径显示。窄边距退化到图标，无空间则隐藏。悬停只显示一个“文件名称 · 文件类型”，保留扩展名；无路径、子标题、重复别名或诊断。未解析且无已知后缀显示“类型未知”；虚线状态与点击时的必要提示保留。
- 同侧关系有安全且有收益的公共路径时，三种线型可共用连续主干，公共段只绘制一次；高亮一张卡片只强调其源端、所经主干和目标支路。平滑模式按切线转向，避免卡边装饰性短折尾。共用成员仅是当前窗格的临时绘制数据。
- **布局**：三种模式、左右优先、正文边缘留白、吸附栅格/范围；可清除当前或全部笔记的位置。
- **辅助**：高亮反馈、拖动边界、减少动画。系统 `prefers-reduced-motion` 始终生效；不禁止全局文字选择。

单击左侧竖排工具栏的链接图标（“打开 MarginLink 设置”），即可展开右侧栏并选中 MarginLink 完整设置标签。连续点击复用同一面板，关闭标签后可以重开；自行收起侧栏或拖动标签后，插件不会主动搬回或展开。面板与原生设置页共用同一表单、偏好和实时预览。“当前笔记”指最近操作的 Markdown 视图，进入设置后仍可整理刚才的笔记，多分屏也按最近操作判定。

命令“打开快捷控制 / Open quick controls”保留轻量 Modal，提供显示、连线常驻、模式、形状、当前笔记整理及右侧完整设置入口。全部入口即时同步，不调用私有设置导航 API。

| 命令 ID | 用途 |
| --- | --- |
| `margin-link:toggle` | 切换边缘关联显示 |
| `margin-link:link-selection` | 将选中文字链接到已有文件 |
| `margin-link:refresh` | 刷新当前视图 |
| `margin-link:quick-controls` | 打开快捷控制 |
| `margin-link:open-settings` | 打开并激活完整设置标签 |
| `margin-link:reset-note-layout` | 确认后清除当前笔记布局 |
| `margin-link:reset-all-layouts` | 确认后清除全部布局 |

不预设全局快捷键，可在 Obsidian 热键设置中自行分配。

## UI 数据与位置恢复边界

**链接关系只在原生双链中；仅外观与个性化布局是插件数据。** 唯一持久化接口是官方 `loadData()/saveData()`，使用版本化 schema 2：

```text
data.json
  schemaVersion: 2
  preferences: 明确白名单中的全局外观与交互选项
  layouts: [{ source, key, side, xNormalized, yOffset, updated }]
```

`source` 是源笔记的 Vault 相对路径；`key` 是原生双链原文、前后各最多 48 字符上下文、相同原文链接数量的组合散列。上下文统一 LF 换行、阅读锚点保留原始偏移；确认完整源文时安全迁移可匹配的旧 CRLF 阅读位置，坐标与时间保留，宿主归一换行后仍能恢复。不保存正文副本、明文别名、目标关系表或稳定 ID，也不向 Markdown 写 ID。散列只用于弱匹配，不是唯一性或隐私加密保证。

恢复前必须重新解析当前双链，并且该上下文散列在整篇文档中唯一，才能应用位置。删除链接不会从旧记录产生卡片。重复完全相同上下文无法区分时拒绝保存；局部上下文、同原文链接数量改变或大幅编辑会使位置失效，宁可自动排布也不猜测另一条链接。远离锚点的前文插入通常不影响匹配。

切页、加载中的空白编辑器和局部阅读渲染仅影响显示，不清理位置。清理依据是明确绑定源文件的完整文档变更；删除双链后不再生成卡片。重命名源笔记/目录仅迁移对应源路径，删除源笔记/目录仅删除对应记录，无关附件操作保留其他位置。原生自动更新双链导致其原文或上下文变化时，受影响的引用仍可安全回退，不会自行改写 Markdown。

布局最多 500 条、每笔记 100 条，90 天过期；容错读取、去重和限额，记录缺失或损坏时回退。合法 drop 先同步更新内存，立即切页无需等待；约 250ms 合并落盘，串行写入防止旧快照覆盖新位置，不在每个 pointermove 写盘；关闭时提交待保存 UI 数据。窗口或侧栏变化仅调整当次绘制，空间恢复后使用原相对位置。

清除位置仅回到自动布局；恢复默认外观不删除位置。删除整个 `data.json` 或使用旧版会丢失/重置个性化显示与位置，**原生关联及笔记内容完全保留**。从 v0.1 恢复到 v0.2 时也不能依赖旧程序保留新 schema。

插件没有关系数据库、笔记 sidecar、关联 frontmatter、隐藏标记、localStorage、IndexedDB、遥测或网络请求。关系写入仍只有 `src/editor/selection-action.ts` 的一次安全 `Editor.transaction()`；不使用 `vault.modify()` 覆写笔记。卡片用文本节点，不用 `innerHTML` 执行内容。

## 三种笔记模式、文件类型与兼容性

Live Preview / 源码用 CM6 可见范围和真实 DOM 坐标，解析缓存只在文档变化时更新；阅读模式用官方 Markdown 后处理器、section 源范围与 DOM 顺序映射。重复引用各有独立锚点和卡片；普通 Markdown/参考式链接参与消歧。第三方 DOM 改写使数量不一致时省略该目标组。

CRLF/LF 使用一致的布局身份，并兼容旧 CRLF 阅读位置。Obsidian 1.10.6 自身切换编辑/阅读模式可能把 CRLF 保存为 LF，无插件对照见验证报告；单纯打开设置、拖动和导航不由本插件写回笔记。

每个 MarkdownView 有独立 overlay、SVG、观察器及坐标系。滚动、字体和主题变化合并到 rAF；卡片与原文独立判断裁切，阅读模式按视口及有限邻近范围测量，CodeMirror 虚拟化后复用已知排布；自己的 DOM/CSS 更新不触发无限重绘。窄窗或密集区域允许省略卡片，不挤压正文、不强制修改“限制行宽”。

文件选择仅来自 `Vault.getFiles()`，目标使用原生 `getFirstLinkpathDest()`，创建时验证精确完整路径以区分同名文件。标题/块子路径保留。Markdown、Canvas、Bases、PDF、原生图片/音视频通过 `WorkspaceLeaf.openFile(TFile)` 打开。

### HTML 和 XMind

在 **MarginLink → Obsidian 能识别的文件类型** 中独立选择 HTML 文件（.html、.htm）和 XMind 文件（.xmind）。首次使用和从旧版升级时，两项都开启。改动后，在“第三方插件”中关闭再启用 MarginLink 以应用。Obsidian 的“显示所有文件类型”和其他文件查看器也会影响文件列表中的可见性。

在原生文件列表或笔记双链中打开附件时，MarginLink 的只读页会显示名称和类型。若已有查看器先接管某一扩展名，沿用该查看器。需要打开文件内容时，在文件列表右键选择“在默认应用中打开”，由浏览器或关联的 XMind 应用打开。HTML 内容不会在 MarginLink 中运行。HTML/HTM 卡片使用随主题调整的灰阶网页旋涡图标及无外框 HTML 短标，紧凑卡片仍保留四字母，链接使用附件本身的路径，例如 `[[导图/项目规划.xmind|项目规划]]`。

本轮0.2.11–0.2.15的真实桌面验收受当前环境通信套接字权限阻塞，几何/集成测试和待桌面复做范围见 VALIDATION.md。隔离验收入口为 `node scripts/desktop-connectors-manual.mjs final --through=15`，不要在正式Vault运行。

## 源码与开发

| 入口 | 职责 |
| --- | --- |
| `src/main.ts`, `src/types.ts` | 生命周期、命令、共享偏好、迁移读取和串行保存 |
| `src/core/layout-identity.ts`, `layout-store.ts` | 弱身份、UI 位置白名单、限额、过期和失效 |
| `src/core/` 其余文件 | Markdown 保护区域、精确原生目标、安全格式化、文件能力 |
| `src/editor/`, `src/reading/` | 安全选区创建、CM6/阅读锚点与各自生命周期 |
| `src/view/layout-engine.ts` | 相对坐标、形状尺寸、碰撞/吸附与裁剪纯函数 |
| `src/view/card-drag-controller.ts` | 已有卡片移动及取消，独立于建链手柄 |
| `src/view/margin-overlay.ts`, `appearance.ts` | 每视图协调、局部几何与主题变量 |
| `src/ui/settings-tab.ts`, `settings-view.ts`, `quick-controls.ts` | 共享原生表单、右侧 ItemView、实时预览、快捷 Modal 与确认 |
| `scripts/desktop-test.mjs`, `desktop-v2.mjs`, `desktop-remediation.mjs`, `desktop-stability.mjs` | 隔离库客户端回归、即时切页、逐帧分隔线/抓点和长悬停场景 |

Windows 一键构建：安装 Git、Node 24（含 npm）后，双击项目根目录的 [buildStart.cmd](buildStart.cmd)。脚本通过 [build-latest.ps1](scripts/build-latest.ps1) 依次拉取 `origin/main`（仅快进）、按锁文件安装依赖、编译打包，并自动读取版本号生成 `dist/margin-link-<版本号>.zip`。随后会实际解压刷新 `dist/margin-link/`，对五个发布文件逐一校验 SHA-256，并更新文件夹日期。成功窗口同时显示 ZIP、可直接复制安装的目录、版本、生成时间与源码提交；失败时显示原因。项目路径可以包含空格和中文，从其他工作目录启动也可用。

运行前需处于 `main` 分支，已跟踪文件没有待提交修改。本地历史分叉、存在未推送提交或任一步骤失败都会停止，不自动切换分支或处理本地修改。构建失败时，已有 ZIP 可能仍是旧包，以窗口中的成功结果为准。终端自动运行可使用 `buildStart.cmd --no-pause`。

Node 24 / npm 12，手动安装与常规检查：

```powershell
npm ci
npm test
npm run lint
npm run build
npm run package
Compress-Archive -LiteralPath dist/margin-link -DestinationPath dist/margin-link-0.2.15.zip -Force
```

构建含严格 TypeScript 检查，esbuild 输出 CJS；Obsidian/CM6 由宿主提供。打包附带实际 bundled 依赖许可证。`npm run dev` 用于监听构建。

npm 12 默认禁止跨 registry 主机下载 URL；如果本机官方 registry 与锁文件中的既有镜像地址触发 `EALLOWREMOTE`，可对本次安装使用 `npm ci --allow-remote=all`，仍校验锁文件完整性，不修改全局 npm 配置。

真实桌面验收会重写测试笔记、测试偏好及工作区，只能在本项目独立库执行：

```powershell
npm run build
node scripts/setup-test-vault.mjs
powershell -ExecutionPolicy Bypass -File scripts/launch-test.ps1
# 首次信任自己生成的隔离库后运行
npm run test:desktop
```

更改源码后重建并把三个插件文件复制到测试目录，重新加载实例。准备脚本包含 v0.1 偏好夹具，以验证迁移；不要在隔离实例仍运行时重置夹具。启动脚本默认 `D:\SoftWare\Obsidian\Obsidian.exe`，可传 `-ObsidianExe`；profile 为 `test-profile/`，CDP 端口本机 9223，完成后关闭该实例。

`node scripts/host-window-control.mjs` 是编辑器设置窗口的卸载插件对照；`node scripts/restart-layout-check.mjs prepare` → 完全关闭并重新启动隔离实例 → `verify`，检查实际卡片恢复和所有 Markdown 哈希。上述脚本都有独立库校验，不运行于正式库。

`node scripts/legacy-layout-migration.mjs` 专测旧 CRLF 布局：通过原生设置禁用插件后预置已有 UI 数据夹具，正常启用，验证迁移、跨模式、导航与重载；同样仅允许在本工程隔离库运行。

`node scripts/desktop-stability.mjs final` 专测连续分隔线帧、抓点独立期望、长悬停与设置可见宽度；`baseline` 使用相同操作保留问题对照。截图及每帧观测见 VALIDATION；不要把几何稳定后的截图作为过程中没有闪烁的证据。

`node scripts/preferences-restart-check.mjs prepare <case>` → 正常关闭/重启隔离实例 → `verify`，核对旧平铺、旧嵌套、缺项、非法项和新默认的读取及设置文字。case 可用 `flat-valid`、`nested-valid`、`missing`、`invalid`、`defaults`；它会在插件禁用时改写隔离插件的测试配置。

协作规则见 [AGENTS.md](AGENTS.md)，[standard 工程记忆](wiki_memory/README.md) 保存状态与决策。每轮有项目修改均验证、同步必要记忆、提交并推送已核实 upstream；无变化不造空提交。源码仓库为 [DewMysimple/MarginLink](https://github.com/DewMysimple/MarginLink)。

## 人工验收

1. 打开独立库，切 Live Preview / 源码 / 阅读模式，已有双链逐次显示；代码、嵌入、普通链接不显示卡片。
2. 原生选区手柄与命令都只生成精确 `[[...|原文字]]`，检查取消、过期快照、撤销/重做、中文与同名文件。
3. 在三种模式调节线型、宽度、透明度、颜色，`none` 留下卡片，设置预览与实际页面同步。
4. 左侧图标一次展开完整设置，连续点击只有一个标签；选 free/snap，从卡片图标、文字和空白处跨侧拖动，放下后立即切走返回、单击卡片后退；确认位置和连线恢复，Esc、失焦和正文内松手恢复原位。
5. 完全退出再启动，在足够宽的视图恢复位置；缩窄后安全隐藏，放宽后恢复；滚动时跟随正确锚点，离屏没有漂浮连线。
6. 切三形状与小中大尺寸、明暗主题、字体、缩放、侧栏、限制行宽、不同文件分屏及同文件多个 leaf。
7. 重复同目标/同别名分别移动；远处编辑前文，删除/增加同原文链接、改变周围文字、重命名文件，确认不会把旧位置套给别的锚点。
8. 键盘打开和移动卡片、恢复单卡/当前笔记/全部位置；重命名/删除无关附件应保留其他笔记的位置。
9. 在自己的 HTML/思维导图处理器、Page Preview/主题组合下验证特殊格式提示及原生打开。
10. 清除布局、删除 data.json、禁用/卸载：Markdown 字节和双链保留，无幽灵关系、overlay、pointer capture、监听或附加类。

自动化已测范围和剩余人工环境缺口以验证报告为准，不把这份清单视为全部平台通过。

## 实际截图

以下为 v0.2.1 隔离 Obsidian 的实际 Electron 渲染：

![整卡拖动后的布局](artifacts/remediation-final.png)

![右侧完整设置](artifacts/remediation-settings.png)

旧版阅读、源码、分屏、窄窗截图与版本化 JSON 保留在验证报告的历史记录中。当前没有操作动图。

## 参考

- [官方插件样板](https://github.com/obsidianmd/obsidian-sample-plugin)
- [官方 TypeScript API](https://github.com/obsidianmd/obsidian-api)
- [Manifest 规范](https://docs.obsidian.md/Reference/Manifest)
- [支持的文件格式](https://obsidian.md/help/Files%20and%20folders/Accepted%20file%20formats)

MIT License；依赖许可证随发布文件附带。
