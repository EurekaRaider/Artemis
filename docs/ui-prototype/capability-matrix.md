# 能力覆盖矩阵（components.html 70 卡 ↔ 基线 d0b7b9f 逐卡账本）

> 版本：v17 · 基线：`d0b7b9fa20787c97c90cdb00a8fa827e275f5aef`（main）· 生成器：`prototype/tools/gen_matrix.py`
>
> 本文件由生成器产出，**所有数字来自 `matrix-stats.json`，禁止手写**。
> 重新生成：`python3 tools/gen_matrix.py --version v17 --baseline d0b7b9fa20787c97c90cdb00a8fa827e275f5aef`
> 校验：`python3 tools/gen_matrix.py --verify --version v17 --baseline d0b7b9fa20787c97c90cdb00a8fa827e275f5aef`

**双口径，禁止混淆。** 生产 TS/Electron 账本的 70 卡中 20 卡 partial、2 卡 uncovered，缺口仍如实列在第四节；与此同时，HTML 原型契约已经 70/70 通过，其中 22 张历史 partial/uncovered 卡有定向交互断言。

**校验边界：** runner 的 T8 执行 HTML 卡片的状态、交互、键盘和 ARIA 契约；`--verify` 读取并校验该结果，同时验证生产账本格式、计数和精确词边界锚点。HTML 通过不等于生产 TS 组件已经实现。

## 一、口径与计数规则

- **分母 = 70 张卡**（components.html 全部 `class="spec"`，带稳定 `data-card` 属性）= 本文件总表行数 = covered+partial+uncovered 之和（48+20+2）。
- 卡 id：`<section>-<两位序号>`，按 DOM 顺序注入（如 `cat-input-03`），由 `--inject` 生成并经校验器与账本双向核对、无重复。
- **行号全部由生成器按 `git show d0b7b9f:<path>` 定位并经校验器逐条验证**（断言「该行包含该符号」）。v14 中 EnvironmentPanel/SourcesPanel/McpServerEditor/WorkspaceFileEditor 的行号错位已在本版修正。
- 模块为互斥分类：每卡恰好归一个模块，共 18 个；模块行内三态卡数之和 = 该模块卡数；全部模块卡数之和 = 分母；模块状态取组内最弱（含 uncovered 即 uncovered，否则含 partial 即 partial，否则 covered）；三态模块数之和 = 模块总数。
- 百分比 = **最大余数法**：各档先取 floor(count/total×100)，100 与 floor 和的差额按小数余数从大到小逐档 +1，三档之和精确 = 100%；校验器断言 == 100（无 ±1 容差，生成器负责凑整）。
- HTML 是否完成由 T8 判定；本表 status 则判定 **current main 的正式 TS/Electron 实现**相对 v17 HTML 契约的覆盖，不凭模块名或静态锚点臆断。
- `covered` = current main 已有对应生产实现；`partial` = 已有主流程/锚点，但相对 v17 契约仍缺状态、键盘、ARIA、组件化或独立测试；`uncovered` = current main 无对应生产符号（该卡无 file:line 锚点，校验器强制）。

## 二、逐卡总表（分母 70 = 行数）

| 卡 id | v14 编号 | 标题 | 模块 | 生产符号 | 基线锚点 | HTML 状态 | v17 交互契约 | v17 键盘 | v17 ARIA | 生产覆盖 | 生产迁移缺口 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cat-overview-01` | ◎ | 同组件三方向速览 | 设计令牌与主题 | `--ui-font` | `apps/desktop/src/renderer/styles.css:3` | default | 静态速览卡，切顶部方向标签仅换令牌 | 无 | 规范展示，无交互控件 | covered | — |
| `cat-tokens-01` | t0a | 字体排印 | 设计令牌与主题 | `--mono-font` | `apps/desktop/src/renderer/styles.css:4` | default | 静态规范卡（六档字阶展示） | 无 | 规范展示 | covered | — |
| `cat-tokens-02` | t0b | 间距与密度 | 设计令牌与主题 | `padding:` | `apps/desktop/src/renderer/styles.css:279` | default | 静态规范卡（间距/行高刻度） | 无 | 规范展示 | covered | — |
| `cat-tokens-03` | t1 | 圆角与阴影 | 设计令牌与主题 | `border-radius:` | `apps/desktop/src/renderer/styles.css:286` | default | 静态规范卡（同心圆角+浮层阴影） | 无 | 规范展示 | covered | — |
| `cat-tokens-04` | t2 | 动效节奏 | 设计令牌与主题 | `transition:` | `apps/desktop/src/renderer/styles.css:255` | default | 播放按钮触发进度条动画 | 空格/Enter 触发按钮 | 按钮可聚焦，prefers-reduced-motion 降级 | covered | — |
| `cat-basic-01` | 01 | 按钮变体与状态 | 基础控件 | `button {` | `apps/desktop/src/renderer/styles.css:233` | default、disabled、loading | 点击五种变体按钮 | Tab 聚焦，focus-visible 焦点环 | 禁用态原生 disabled 属性 | covered | — |
| `cat-basic-02` | 02 | 徽章 | 基础控件 | `badge` | `apps/desktop/src/renderer/styles.css:3242` | default | 静态徽章展示（pill 仅标签/状态） | 无 | 纯展示文本 | covered | — |
| `cat-basic-03` | 01b | 图标按钮 | 基础控件 | `.icon-button` | `apps/desktop/src/renderer/styles.css:309` | default、disabled | 点击图标按钮 | Tab 聚焦，焦点环 | aria-label 必需（卡上已标注） | covered | — |
| `cat-basic-04` | 01c | 头像 | 基础控件 | `avatar` | `apps/desktop/src/renderer/styles.css:929` | default | 静态头像展示 | 无 | 装饰性图形 | covered | — |
| `cat-basic-05` | 01d | 分段控件 | 基础控件 | `aria-pressed` | `apps/desktop/src/renderer/WorkspaceMarkdownEditor.tsx:72` | default | 点击切换选中段 | Tab + Enter/Space | role=group + aria-pressed 按钮组 | covered | — |
| `cat-basic-06` | 03 | 快捷键 · 提示 · 进度 | 基础控件 | `kbd` | `apps/desktop/src/renderer/styles.css:2128` | default | 悬停/聚焦显示 tooltip，按钮推进进度条 | Tab；tooltip 经 focus-within 可达 | kbd 样式标注快捷键 | covered | — |
| `cat-icons-01` | ic1 | 图标网格与规范 | 图标系统 | `stroke` | `apps/desktop/src/renderer/styles.css:1923` | default | 静态规范卡（24 网格/stroke 1.5/圆角端点） | 无 | 装饰性图标演示 | covered | — |
| `cat-icons-02` | ic2 | 尺寸档 | 图标系统 | `resourceIconName` | `apps/desktop/src/renderer/resource-icons.tsx:326` | default | 静态尺寸演示（xs…xl 五档） | 无 | 装饰性图标演示 | partial | 生产无统一 xs/sm/base/lg/xl 尺寸档类，图标尺寸由各组件内联定义 |
| `cat-icons-03` | ic3 | 自主设计图标库 | 图标系统 | `export function EnvironmentAddIcon` | `apps/desktop/src/renderer/EnvironmentPanelIcons.tsx:5` | default | 静态图标网格（98 格命名图标） | 无 | 装饰性图标网格 | partial | 基线仅 EnvironmentPanelIcons + resource-icons 两套自绘集，未逐一对应卡上 98 个命名 |
| `cat-icons-04` | ic4 | Agent 团队标记 | 图标系统 | `childAgentMarkForIdentity` | `apps/desktop/src/renderer/ChildAgentIcon.tsx:25` | default | 静态标记网格（8 形态 × 12 色） | 无 | 装饰性标记 | covered | — |
| `cat-input-01` | 04 | 文本框 | 输入与选择 | `input,` | `apps/desktop/src/renderer/styles.css:226` | default、error、disabled | 输入文本；错误/禁用态演示 | Tab 聚焦 | label 关联；aria-invalid + 错误文案 | covered | — |
| `cat-input-02` | 04b | 搜索框 | 输入与选择 | `.sidebar-search` | `apps/desktop/src/renderer/styles.css:427` | default | 输入搜索词 | Tab 聚焦 | aria-label=搜索 | covered | — |
| `cat-input-03` | 04c | 字段类型 | 输入与选择 | `password` | `apps/desktop/src/renderer/SettingsPanel.tsx:1151` | default | 五类字段输入演示 | Tab 聚焦 | label 关联 | partial | 五类字段（password/url/number/date/file）在基线均有生产对应（date=AutomationPage.tsx:972、file=SettingsPanel.tsx:1265，均引入于 0acb259）；PR9C 提案转 covered |
| `cat-input-04` | 05 | 下拉选择 | 输入与选择 | `function CodexSelect` | `apps/desktop/src/renderer/CodexSelect.tsx:98` | default、disabled | 点击展开；选项选择 | ↑↓ 移动，Enter 选择，Esc 关闭 | aria-haspopup/aria-expanded；listbox+option+aria-selected | covered | — |
| `cat-input-05` | 06 | 开关与复选 | 输入与选择 | `.resource-switch` | `apps/desktop/src/renderer/styles.css:9769` | default、disabled | 切换开关/勾选复选 | Tab + Space | 原生 checkbox 语义 | covered | — |
| `cat-overlay-01` | 07 | 对话框 | 浮层 | `aria-modal` | `apps/desktop/src/renderer/App.tsx:8348` | default | 打开/确认/取消/遮罩关闭 | Tab 框内循环；Esc 关闭；焦点回触发器 | role=dialog + aria-modal | covered | — |
| `cat-overlay-02` | 08 | Popover | 浮层 | `workspace-header` | `apps/desktop/src/renderer/App.tsx:6078` | default | 点击展开/外点关闭 | Esc 关闭；触发钮可聚焦 | aria-haspopup + aria-expanded；role=dialog 标注 | covered | — |
| `cat-overlay-03` | 09 | Toast | 浮层 | `TransientNotice` | `apps/desktop/src/renderer/App.tsx:271` | default、error | 按钮触发信息/错误提示 | 无（自动消失） | role=status/alert；aria-live polite/assertive | covered | — |
| `cat-data-01` | 09a | 标签页 | 主壳与导航 | `workspace-tab-bar` | `apps/desktop/src/renderer/App.tsx:7463` | default | 点击切换；方向键/Home/End 同步选择与焦点 | roving tabindex；←/→/Home/End | role=tablist/tab + aria-selected + aria-controls | partial | 正式 App.tsx 的 workspace tab 尚未固化 v17 的 roving tabindex 与 ←/→/Home/End 契约；迁移为 TS 组件时必须补 RTL 证据 |
| `cat-data-02` | 09b | 活动栏按钮 | 主壳与导航 | `activity-bar` | `apps/desktop/src/renderer/App.tsx:5297` | default | 点击切换活动项 | Tab + 点击 | aria-label + aria-current=page；active 左指示条 | partial | 正式 App.tsx 活动栏仍只有 active class，没有 aria-current=page；TS 迁移必须补齐 |
| `cat-data-03` | 09c | 面包屑 | 主壳与导航 | — | — | default | 点击层级链接 | Tab + Enter | nav + aria-label；aria-current=page | uncovered | 基线 Renderer 无面包屑/路径导航组件（App.tsx 与 styles.css 均无对应符号），卡片为前瞻设计，无 file:line 锚点 |
| `cat-data-04` | 09d | 动态 Dock 标签 | 主壳与导航 | `workspace-tool-dock` | `apps/desktop/src/renderer/App.tsx:7431` | default、empty、disabled | 切换/关闭标签；活动标签关闭后转移焦点；空态启动 Review/Terminal/Browser/Files | roving tabindex；←/→/Home/End；关闭后焦点转移 | role=tablist/tab + aria-selected；关闭按钮 label；不可用启动项 aria-disabled | partial | 正式 workspace Dock 标签仍未固化 roving tabindex/方向键与活动标签关闭后的焦点转移；正式启动器无显式 disabled-unavailable 契约；TS 迁移需保留 v17 四工具启动器与不可用态 |
| `cat-data-05` | 10 | 可调整分栏 | 主壳与导航 | `resizeWorkspaceDockFromKeyboard` | `apps/desktop/src/renderer/App.tsx:3080` | default、disabled | 拖拽与按钮演示像素钳制；关闭/重新打开分栏 | ←/→ 每次 24px；Home 默认；End 最大 | role=separator + 像素 aria-valuenow/min/max + aria-controls；关闭时 tabindex=-1 | partial | 正式 resizeWorkspaceDockFromKeyboard 仅支持 ArrowLeft/ArrowRight；TS 迁移需补 Home/End 并保留现有像素钳制；正式 Dock separator 只控制 workspace-tool-dock；v17 规格要求同时声明受影响的 conversation 与 Dock |
| `cat-data-06` | 11 | 工具栏 | 主壳与导航 | `.toolbar-button` | `apps/desktop/src/renderer/styles.css:310` | default、disabled | 点击工具按钮；按压态切换 | Tab + 点击 | role=toolbar + aria-label；aria-pressed | covered | — |
| `cat-data-07` | 11b | 侧栏树行 | 主壳与导航 | `project-thread-row` | `apps/desktop/src/renderer/App.tsx:5859` | default、conflict | 三级行选择、drop-before、active-running 与更多菜单展开 | 树行 roving tabindex；↑/↓；Enter/Space；菜单 Esc 恢复焦点 | role=tree/treeitem + aria-level 1/2/3 + aria-selected；菜单 aria-expanded | partial | 正式项目线程行的树语义与焦点策略分散在 App.tsx，尚无可复用 TreeRow TS 组件或 roving 键盘契约；拖拽落点、运行徽标与更多菜单需要在迁移测试中作为同一行状态组合验证 |
| `cat-data-08` | 12 | 列表行 + 树 | 主壳与导航 | `aria-level` | `apps/desktop/src/renderer/App.tsx:5458` | default | 折叠/展开；三级行选择；drop-after；active-running；更多菜单 | 树行 roving tabindex；↑/↓；Enter/Space；菜单 Esc 恢复焦点 | role=tree/treeitem；aria-expanded；aria-level 1/2/3；aria-selected | partial | 正式 App.tsx 尚未把三层树、拖拽落点、运行态和菜单焦点统一为可复用组件契约；正式线程树缺 ↑/↓ roving 导航与 Enter/Space 选择的组件级测试证据 |
| `cat-data-09` | 12a | 卡片 + 统计卡 | 数据容器 | `TokenUsagePage` | `apps/desktop/src/renderer/TokenUsagePage.tsx:85` | default | 静态卡片/统计卡展示 | 无 | 纯展示 | partial | 生产无通用 .card/.stat-card 组件类，统计呈现内聚在 TokenUsagePage/ResourceCenter 页面内 |
| `cat-data-10` | 12b | 差异 Diff | 数据容器 | `TurnChangeSetCard` | `apps/desktop/src/renderer/App.tsx:9491` | default | 静态增删行展示 | 无 | 增删行色彩语义（无专门 role） | covered | — |
| `cat-data-11` | 12c | 表格 | 数据容器 | `table` | `apps/desktop/src/renderer/styles.css:2773` | default | 静态表格；行 hover | 无 | 语义 table/th/td | covered | — |
| `cat-data-12` | 12d | 热力图 + 终端 | 数据容器 | `export function TerminalPanel` | `apps/desktop/src/renderer/TerminalPanel.tsx:55` | default | 静态热力图 + 终端输出演示 | 无 | 热力图容器 aria-label；终端深色固定 | partial | 终端 covered（TerminalPanel 基线有组件）；热力图在基线无对应组件 |
| `cat-data-13` | 12e | 状态胶囊 | 数据容器 | `.status-pill` | `apps/desktop/src/renderer/styles.css:1061` | default | 静态三态胶囊展示 | 无 | 色彩+文字双编码 | covered | — |
| `cat-data-14` | 12f | 消息 | 数据容器 | `function Timeline` | `apps/desktop/src/renderer/App.tsx:9589` | default | 静态用户/助手消息展示 | 无 | 头像+署名+正文结构 | covered | — |
| `cat-data-15` | 13 | 面板头 + 滚动区 | 数据容器 | `.panel-header` | `apps/desktop/src/renderer/styles.css:399` | default | 滚动区滚动；头部按钮点击 | 滚动区 tabindex=0 可键盘滚动 | 按钮 aria-label；滚动区 aria-label | covered | — |
| `cat-state-01` | s1 | 空状态 | 状态反馈 | `.empty-state` | `apps/desktop/src/renderer/styles.css:2337` | empty | 空态 CTA 按钮点击 | Tab + Enter | 图标装饰+标题+描述结构 | covered | — |
| `cat-state-02` | s2 | 加载骨架 | 状态反馈 | `skeleton` | `apps/desktop/src/renderer/styles.css:4296` | loading | 静态骨架屏演示 | 无 | 装饰性（aria-hidden 语义占位） | covered | — |
| `cat-state-03` | s3 | 错误横幅 | 状态反馈 | `role="alert"` | `apps/desktop/src/renderer/App.tsx:6311` | error | 重试按钮点击 | Tab + Enter | role=alert | covered | — |
| `cat-state-04` | s4 | 内联提示 | 状态反馈 | `notice` | `apps/desktop/src/renderer/styles.css:1295` | default | 静态内联提示 | 无 | 信息级提示（非 alert） | covered | — |
| `cat-sources-01` | S1 | 来源卡片（四类型） | 任务来源 | `export function SourcesPanel` | `apps/desktop/src/renderer/SourcesPanel.tsx:159` | default、loading、error | file/image/web/MCP 四类型均有打开按钮；加载/失败/恢复反馈 | Tab 到打开按钮；focus-visible | 打开来源 aria-label；状态区 status/alert + aria-live；长内容 title | partial | 正式 SourcesPanel 的 file 与 MCP 条目仍是 article，不具备统一 open-source 操作契约；正式来源加载由面板外驱动，缺 v17 统一 loading/error/retry 状态接口 |
| `cat-sources-02` | S2 | 网页搜索来源组 | 任务来源 | `WebSearchSourceGroup` | `apps/desktop/src/renderer/SourcesPanel.tsx:81` | default、error | query/结果按钮打开真实 URL 语义；失败后重试恢复 | Tab + Enter/Space；focus-visible | 结果列表 + open-source aria-label；失败 role=alert | partial | 正式 WebSearchSourceGroup 有打开按钮，但没有组内搜索失败/retry 状态；TS 组件接口需补齐 |
| `cat-sources-03` | S3 | MCP 调用来源组 | 任务来源 | `mcpSummary` | `apps/desktop/src/renderer/SourcesPanel.tsx:22` | default | 每个 MCP 调用可打开详情；长内容截断并保留 title | Tab + Enter/Space；focus-visible | 调用按钮 aria-label；详情 role=status | partial | 正式 SourcesPanel 的 MCP 组仍是静态 article；TS 迁移需加入逐调用详情与失败反馈契约 |
| `cat-sources-04` | S4 | 来源空态 | 任务来源 | `empty:` | `apps/desktop/src/renderer/SourcesPanel.tsx:17` | empty | 静态空态展示 | 无 | 空态文案（基线 i18n empty 文案对应） | covered | — |
| `cat-sources-05` | S5 | 来源归属标签 | 任务来源 | `parentAgent:` | `apps/desktop/src/renderer/SourcesPanel.tsx:20` | default | 静态归属标签展示 | 无 | parentAgent/usedBy 文案对应基线 i18n | covered | — |
| `cat-sources-06` | S6 | 目标编辑器 | 目标编辑器 | `export function GoalEditorPanel` | `apps/desktop/src/renderer/GoalEditorPanel.tsx:32` | default、loading、error | dirty/revert/save；loading/saving/load-error/save-error/ready 状态切换 | Tab；⌘/Ctrl+Enter 保存 | aria-busy；status aria-live；错误状态可见；按钮 aria-label | partial | 正式 GoalEditorPanel 将 load/save error 只上抛到全局 onError，缺面板内 retry/error 状态接口；正式组件虽支持 ⌘/Ctrl+Enter 与 aria-busy，但尚无独立 workbench/RTL 契约覆盖完整状态族 |
| `cat-sources-07` | S7 | 目标编辑器 stale 冲突 | 目标编辑器 | `stale` | `apps/desktop/src/renderer/GoalEditorPanel.tsx:14` | conflict、disabled、loading | stale 提示、重试、重新载入后恢复保存 | Tab 到重试；完成后保存恢复可达 | stale alert + aria-busy；禁用/恢复按钮 | partial | 正式 GoalEditorPanel 的 stale 恢复要求关闭后重开，没有面板内 retry；TS 迁移需采用 v17 可恢复路径 |
| `cat-sources-08` | S8 | 环境来源集成 + PR checks | 环境与 PR checks | `pr-check` | `apps/desktop/src/renderer/EnvironmentPanel.tsx:1629` | default、loading、error | PR summary 六态；三种 coverage warning；checks dialog；stale retry | Tab；Enter/Space 打开 checks；Esc 关闭并恢复焦点 | dialog + aria-expanded；passed/pending/failed/skipped/cancelled/none 文本；警告列表 | partial | 正式 PR checks 行为内聚在大型 EnvironmentPanel，尚未抽成可复用 TS 组件与独立 RTL 状态矩阵 |
| `cat-artemis-01` | 13a | 运行模式 | 运行模式与审批 | `approval-policy-menu` | `apps/desktop/src/renderer/App.tsx:7046` | default | 点击展开策略菜单 | 菜单键盘导航 | aria-haspopup/aria-expanded | covered | — |
| `cat-artemis-02` | 13b | 工具活动 | 工具活动与计划 | `ToolActivityGroupCard` | `apps/desktop/src/renderer/App.tsx:9360` | default、loading | 点标题折叠/展开 | 标题可聚焦，Enter 切换 | aria-expanded；步骤状态点 | covered | — |
| `cat-artemis-03` | 13c | 任务计划 | 工具活动与计划 | `export function TaskPlanProgress` | `apps/desktop/src/renderer/TaskPlanProgress.tsx:85` | default、loading | 静态步骤进度展示 | 无 | 步骤完成/进行中视觉（基线组件渲染） | covered | — |
| `cat-artemis-04` | 13d | 模型选择 | 会话与消息 | `model-picker` | `apps/desktop/src/renderer/App.tsx:7163` | default | 点击展开模型列表 | 列表键盘导航 | aria-haspopup/expanded | covered | — |
| `cat-artemis-05` | 13e | 输入区 | 输入区 | `composer` | `apps/desktop/src/renderer/App.tsx:6568` | default | textarea 输入自适应高 | 原生 textarea 聚焦 | aria-label 标注 | covered | — |
| `cat-artemis-06` | 13f | 上下文环 | 会话与消息 | `export function ContextUsageIndicator` | `apps/desktop/src/renderer/ContextUsageIndicator.tsx:78` | default | 静态三档用量环展示 | 无 | role=img + aria-label 百分比；高用量转警告色 | covered | — |
| `cat-artemis-07` | 13g | 附件芯片 | 输入区 | `export function ComposerContextBar` | `apps/desktop/src/renderer/ComposerContextBar.tsx:249` | default | 点 × 移除附件 | Tab + Enter | 移除按钮 aria-label | covered | — |
| `cat-artemis-08` | 13h | Agent 团队 | Agent 团队 | `AgentTeamPanel` | `apps/desktop/src/renderer/App.tsx:8451` | default | 静态主/子 Agent 层级展示 | 无 | 层级缩进+状态徽章 | covered | — |
| `cat-artemis-09` | 13i | 提示历史 | 会话与消息 | `navigatePromptHistory` | `apps/desktop/src/renderer/prompt-history.ts:33` | default | hover 出复用按钮并点击 | Tab 行内可达（focus-within 显按钮） | 复用按钮文本 | covered | — |
| `cat-artemis-10` | 13j | Browser 地址栏 | 工作区面板 | `export function WorkspaceBrowserPanel` | `apps/desktop/src/renderer/WorkspacePreviewPanel.tsx:100` | default、loading、disabled | 输入地址回车导航；前进/后退/刷新 | 输入框 + 按钮键盘可达 | 按钮 aria-label；禁用态 | covered | — |
| `cat-artemis-11` | 13k | Markdown 编辑与预览 | 工作区面板 | `export function WorkspaceMarkdownEditor` | `apps/desktop/src/renderer/WorkspaceMarkdownEditor.tsx:23` | default、loading、error | rich/source 双态；dirty/saving/saved/image-error；代码编辑器 plain 阈值与长行滚动 | Tab；Markdown 与代码编辑器均支持 ⌘/Ctrl+S | 模式按钮 aria-pressed；编辑器 textbox；保存状态 aria-live；wrap=off | partial | 正式 Markdown 与 WorkspaceFileEditor 仍是两个独立面板；迁移到 UI 库时需分别保留 v17 状态/快捷键契约；正式 Markdown 组件无 disabled prop，需在 TS 组件 API 评审时明确是否属于非目标而非静默遗漏 |
| `cat-artemis-12` | 13l | 环境操作对话框 | 环境与 PR checks | `commitMessage` | `apps/desktop/src/renderer/EnvironmentPanel.tsx:728` | default | 提交/推送/切分支按钮打开对话框 | Tab + Enter | 按钮文本；对话框复用焦点陷阱 | covered | — |
| `cat-artemis-13` | 13m | 设置复杂表单 | 设置与 MCP | `export function McpServerEditor` | `apps/desktop/src/renderer/McpServerEditor.tsx:145` | default、disabled、error、loading、conflict | stdio/http 切换、auth/权限、字段校验、busy-save、凭据锁定、移除确认 | Tab 遍历；确认对话框聚焦与取消后焦点恢复 | 传输类型 aria-pressed；form aria-busy；错误 alert；移除 dialog | partial | 正式 McpServerEditor 功能齐全但尚未作为可复用 UI 库组件交付；迁移需建立字段校验、busy/error、凭据锁定和移除确认的独立 RTL 证据 |
| `cat-artemis-14` | 14 | Composer | 输入区 | `composer-drop-overlay` | `apps/desktop/src/renderer/App.tsx:6575` | default | 输入、加附件、模拟拖拽、切运行模式 | Tab 遍历；发送钮禁用逻辑 | drop-overlay 文案；ctx-ring aria-label；按钮 aria-label | covered | — |
| `cat-artemis-15` | 15 | 排队消息 steer | 会话与消息 | `queued-message-bar` | `apps/desktop/src/renderer/App.tsx:6410` | default、disabled、loading | 插入当前、移到最前、内联编辑保存/取消、busy、移除 | Tab；编辑时 Ctrl/⌘+Enter 保存、Esc 取消 | role=status + 动态条数 label；busy/disabled 原生语义 | partial | 正式 App.tsx 已有 move-to-front/内联编辑/busy，但编辑器缺 v17 的 Ctrl/⌘+Enter 保存与 Esc 取消快捷键 |
| `cat-artemis-16` | 16 | 斜杠命令菜单 | 会话与消息 | `slash-command-menu` | `apps/desktop/src/renderer/App.tsx:6584` | default | 菜单选择命令 | ↑↓ 移动，Enter 选择 | role=listbox/option + aria-selected | covered | — |
| `cat-artemis-17` | 17 | 用户输入请求 | 会话与消息 | `UserInputCard` | `apps/desktop/src/renderer/App.tsx:9046` | default、conflict | 点选作答；自定义输入行编辑 | 选项点击；编辑行 Enter 提交/Esc 取消 | 倒计时+状态点；作答后锁定 | covered | — |
| `cat-artemis-18` | 17b | 多组问答 | 会话与消息 | — | — | default | 单卡滑动切换；独立作答进度；点导航 | dots roving tabindex；←/→/Home/End；箭头钮 | tablist/tab/tabpanel + aria-controls/labelledby；进度与独立计时 | uncovered | 前瞻设计：当前协议 userInputRequestedPayloadSchema 为单问题 header/question/options（packages/protocol/src/schema.ts:368），无多问题数组；正式迁移必须先扩展版本化协议与幂等 reducer，不能仅复制 HTML 交互；当前无生产锚点 |
| `cat-artemis-19` | 17c | 输入结果态 | 会话与消息 | `timedOut` | `apps/desktop/src/renderer/App.tsx:461` | conflict | 静态超时/已选结果展示 | 无 | 结果条文案（超时采用推荐项） | covered | — |
| `cat-artemis-20` | 18 | 审批卡 | 运行模式与审批 | `approval-card` | `apps/desktop/src/renderer/App.tsx:9861` | default | 允许一次/始终允许/拒绝 | Tab + Enter | 警示图标+命令块+三动作 | covered | — |

## 三、模块汇总（互斥分类，18 模块，卡数和 = 70）

| 模块 | 说明 | 卡数 | covered | partial | uncovered | 模块状态 |
|---|---|---|---|---|---|---|
| `tokens-design` | 设计令牌与主题 | 5 | 5 | 0 | 0 | covered |
| `basic-controls` | 基础控件 | 6 | 6 | 0 | 0 | covered |
| `iconography` | 图标系统 | 4 | 2 | 2 | 0 | partial |
| `form-inputs` | 输入与选择 | 5 | 4 | 1 | 0 | partial |
| `overlays` | 浮层 | 3 | 3 | 0 | 0 | covered |
| `shell-navigation` | 主壳与导航 | 8 | 1 | 6 | 1 | uncovered |
| `data-display` | 数据容器 | 7 | 5 | 2 | 0 | partial |
| `feedback-states` | 状态反馈 | 4 | 4 | 0 | 0 | covered |
| `sources-panel` | 任务来源 | 5 | 2 | 3 | 0 | partial |
| `goal-editor` | 目标编辑器 | 2 | 0 | 2 | 0 | partial |
| `environment` | 环境与 PR checks | 2 | 1 | 1 | 0 | partial |
| `composer` | 输入区 | 3 | 3 | 0 | 0 | covered |
| `run-control` | 运行模式与审批 | 2 | 2 | 0 | 0 | covered |
| `task-activity` | 工具活动与计划 | 2 | 2 | 0 | 0 | covered |
| `agents` | Agent 团队 | 1 | 1 | 0 | 0 | covered |
| `workspace-panels` | 工作区面板 | 2 | 1 | 1 | 0 | partial |
| `settings-mcp` | 设置与 MCP | 1 | 0 | 1 | 0 | partial |
| `session-messaging` | 会话与消息 | 8 | 6 | 1 | 1 | uncovered |
| **合计** | — | **70** | 8 | 8 | 2 | **18 模块** |

## 四、生产迁移清单（全部为 partial/uncovered）

v17 HTML 已由 T8 覆盖以下卡片；这里列的是 current main 正式实现相对 v17 契约仍需迁移或固化的部分：

1. `cat-data-01`（标签页）— partial：缺 正式 App.tsx 的 workspace tab 尚未固化 v17 的 roving tabindex 与 ←/→/Home/End 契约；迁移为 TS 组件时必须补 RTL 证据
2. `cat-data-03`（面包屑）— uncovered：缺 基线 Renderer 无面包屑/路径导航组件（App.tsx 与 styles.css 均无对应符号），卡片为前瞻设计，无 file:line 锚点
3. `cat-data-04`（动态 Dock 标签）— partial：缺 正式 workspace Dock 标签仍未固化 roving tabindex/方向键与活动标签关闭后的焦点转移、正式启动器无显式 disabled-unavailable 契约；TS 迁移需保留 v17 四工具启动器与不可用态
4. `cat-data-05`（可调整分栏）— partial：缺 正式 resizeWorkspaceDockFromKeyboard 仅支持 ArrowLeft/ArrowRight；TS 迁移需补 Home/End 并保留现有像素钳制、正式 Dock separator 只控制 workspace-tool-dock；v17 规格要求同时声明受影响的 conversation 与 Dock
5. `cat-data-07`（侧栏树行）— partial：缺 正式项目线程行的树语义与焦点策略分散在 App.tsx，尚无可复用 TreeRow TS 组件或 roving 键盘契约、拖拽落点、运行徽标与更多菜单需要在迁移测试中作为同一行状态组合验证
6. `cat-data-08`（列表行 + 树）— partial：缺 正式 App.tsx 尚未把三层树、拖拽落点、运行态和菜单焦点统一为可复用组件契约、正式线程树缺 ↑/↓ roving 导航与 Enter/Space 选择的组件级测试证据
7. `cat-sources-01`（来源卡片（四类型））— partial：缺 正式 SourcesPanel 的 file 与 MCP 条目仍是 article，不具备统一 open-source 操作契约、正式来源加载由面板外驱动，缺 v17 统一 loading/error/retry 状态接口
8. `cat-sources-02`（网页搜索来源组）— partial：缺 正式 WebSearchSourceGroup 有打开按钮，但没有组内搜索失败/retry 状态；TS 组件接口需补齐
9. `cat-sources-03`（MCP 调用来源组）— partial：缺 正式 SourcesPanel 的 MCP 组仍是静态 article；TS 迁移需加入逐调用详情与失败反馈契约
10. `cat-sources-06`（目标编辑器）— partial：缺 正式 GoalEditorPanel 将 load/save error 只上抛到全局 onError，缺面板内 retry/error 状态接口、正式组件虽支持 ⌘/Ctrl+Enter 与 aria-busy，但尚无独立 workbench/RTL 契约覆盖完整状态族
11. `cat-sources-07`（目标编辑器 stale 冲突）— partial：缺 正式 GoalEditorPanel 的 stale 恢复要求关闭后重开，没有面板内 retry；TS 迁移需采用 v17 可恢复路径
12. `cat-sources-08`（环境来源集成 + PR checks）— partial：缺 正式 PR checks 行为内聚在大型 EnvironmentPanel，尚未抽成可复用 TS 组件与独立 RTL 状态矩阵
13. `cat-artemis-11`（Markdown 编辑与预览）— partial：缺 正式 Markdown 与 WorkspaceFileEditor 仍是两个独立面板；迁移到 UI 库时需分别保留 v17 状态/快捷键契约、正式 Markdown 组件无 disabled prop，需在 TS 组件 API 评审时明确是否属于非目标而非静默遗漏
14. `cat-artemis-13`（设置复杂表单）— partial：缺 正式 McpServerEditor 功能齐全但尚未作为可复用 UI 库组件交付；迁移需建立字段校验、busy/error、凭据锁定和移除确认的独立 RTL 证据
15. `cat-artemis-15`（排队消息 steer）— partial：缺 正式 App.tsx 已有 move-to-front/内联编辑/busy，但编辑器缺 v17 的 Ctrl/⌘+Enter 保存与 Esc 取消快捷键
16. `cat-artemis-18`（多组问答）— uncovered：缺 前瞻设计：当前协议 userInputRequestedPayloadSchema 为单问题 header/question/options（packages/protocol/src/schema.ts:368），无多问题数组、正式迁移必须先扩展版本化协议与幂等 reducer，不能仅复制 HTML 交互；当前无生产锚点

除此之外的 partial 卡（非 R15 点名，但逐卡对照发现）：

- `cat-icons-02`（尺寸档）：生产无统一 xs/sm/base/lg/xl 尺寸档类，图标尺寸由各组件内联定义
- `cat-icons-03`（自主设计图标库）：基线仅 EnvironmentPanelIcons + resource-icons 两套自绘集，未逐一对应卡上 98 个命名
- `cat-input-03`（字段类型）：password/url/number 在基线有对应；date/file 字段类型无生产对应
- `cat-data-02`（活动栏按钮）：正式 App.tsx 活动栏仍只有 active class，没有 aria-current=page；TS 迁移必须补齐
- `cat-data-09`（卡片 + 统计卡）：生产无通用 .card/.stat-card 组件类，统计呈现内聚在 TokenUsagePage/ResourceCenter 页面内
- `cat-data-12`（热力图 + 终端）：终端 covered（TerminalPanel 基线有组件）；热力图在基线无对应组件

## 五、统计

HTML 原型契约：**70/70**；历史缺口定向卡：**22/22**；证据：`contrast/prototype-contract-result.json`。

| 覆盖状态 | 卡数 | 占比 |
|---|---|---|
| covered | 48 | 69% |
| partial | 20 | 28% |
| uncovered | 2 | 3% |
| **合计** | **70** | **100%** |

模块互斥分类：18 个模块 = covered 8 + partial 8 + uncovered 2（和 = 模块总数）。

## 六、诚实边界

- T8 只验证 HTML 原型行为；T9 验证 HTML 主页面的 1440×900 / 200% zoom / Dock closed 布局。它们不证明 VoiceOver/NVDA、macOS/Windows 原生差异，也不证明正式 TS/Electron 组件。
- partial/uncovered 的具体缺失状态以第四节为准，它们指生产实现迁移缺口；HTML 原型层已由独立契约完成，不得反向篡改生产状态。
- 锚点只证明符号存在于基线该行，不证明该符号的完整实现质量；实现级评审仍归 R15 主线。
