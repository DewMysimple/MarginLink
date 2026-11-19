# 同文件引用合并审计

基线 4546bb6，Windows、Node 24.16.0、npm 12.0.1。npm test 54 文件 535 项通过。lint、build、package 退出码均为 0。

1. 编辑器和阅读后处理器解析完整 Wikilink，通过源偏移匹配可测量的文字片段。MarginOverlay 将每个 anchor.key 传给 StableLayout，再按 placement.key 创建 shell、按钮和逻辑 path，因此每次出现各占一卡。
2. 源偏移、原文校验、alias、subpath、布局弱身份、路径缓存、配对编号和单处菜单操作都属于 occurrence。
3. 文件卡 DOM、引用列表和临时代表可以使用带命名空间的真实目标路径作为键。文件夹和类型折叠仍按原引用查询。
4. connectorBatch 目前把每条输入当成另一张阻挡卡。支持共享卡片需要显式的目标卡身份、独立路线和独立续接编号。
5. CardDragController 在正常落点经 layout identity 保存，freezeLayout 也会在首次稳定显示或切换模式时写入。聚合需同时封住两处写入口。
6. 手动模式保留逐处坐标。聚合提供只读临时位置，关闭后恢复拖动和原始布局。
7. 隔离桌面需覆盖多个别名与子路径、长文定位、跨栏隔离、多个端口、代表滚动、四种模式切换，以及源文和布局哈希。
