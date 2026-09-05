# Artemis UI 视觉方向原型 · 方向 A「Apple-inspired Artemis」

> 依据 [discussion #76「提案：建立 Artemis 自有 UI 设计语言」] 制作。
> 本目录自包含、零外部依赖、离线可用；仅为阶段 0/1 视觉方向与组件规范评审用静态原型，不改动任何产品源码。
> 最后更新：2026-09-05（v23：七项评审意见落地。①Dock 空态启动器支持图标+文字：`#dockLauncher.icon-mode` 与页签显示模式同步切换，五个启动钮（含不可用禁用图标）带 `.lb-ic` 线性图标；②③来源组条目重设计：`ul.src-links` 改行卡式 `.src-link`——网页条目（地球图标 · accent-text 标题 · 等宽域名副标题 · 悬停浮现外链箭头）与 MCP 条目（扳手图标 · 等宽工具名 · 职责副标题 · `sl-count` 计数胶囊），悬停 surface-2 底加发丝边、active 按压、focus-visible 同步；④目标编辑器 stale 冲突修复贴边：卡体改纵向满宽（对齐 S6），meta 行 8px 14px 内距单行排布（原 286px 挤压缩进折行堆叠）；⑤任务计划胶囊 in_progress 标记改脉动呼吸：1.6s 光环扩散（accent 38%→0%）加中心点搏动（scale 0.72→1），移除 plan-spin 旋转弧；⑥Agent 团队加身份图标：26px `.ag-av` 对齐 ChildAgentIcon 身份标记语言——主 Agent 六边形节点 accent 淡底 · 检索放大镜 teal · 实现代码括号 amber，字形色 color-mix 随主题自适应；⑦输入结果态两卡水平对齐：卡体纵向满宽堆叠，等宽左对齐，间距统一走 flex gap 14px（去除与 margin-top 8px 的叠加）。T8 契约 + 13 项 Playwright 断言（启动器图标三态/网页与 MCP 结构/悬停箭头/详情回读/stale 几何/呼吸动画名与伪元素/图标存在与三色淡底/对齐几何）全绿。v22：可调整分栏（卡 10）新增 3 栏模式：<code>[data-split-mode]</code> 切换钮（2 栏 / 3 栏，aria-pressed + 状态回读），3 栏加入中面板 <code>#splitMid</code>（surface-3 底）与第二分隔条 <code>#splitSep2</code>；每条分隔条独立控制其左侧面板（键盘 ±24px · Home 回默认：左 190px / 中 150px · End 到最大；<code>setPointerCapture</code> 拖拽按面板左缘计算），各自维护 aria-valuenow 四项，<code>#splitState</code> 回读含当前模式；<code>[hidden]</code> 显式守卫防 display:flex 压过 UA 隐藏；关闭分栏把两条 separator 一并移出 Tab 序；切回 2 栏中栏与第二分隔条隐藏。T8 契约 + 10 项 Playwright 断言（默认 2 栏/切换可见性/sep2 End 钳制与 Home 默认/3 栏下 sep1 仍工作/拖拽/双 separator 关闭恢复/切回 2 栏）全绿。v21：components.html 两卡按评审意见升级。①动态 Dock 标签（09d）新增双显示模式：`纯文字 / 图标+文字` 切换钮（aria-pressed + 状态回读），页签可选图标 `.dt-ic`（审查/终端/浏览器/文件四枚线性 SVG）经 `.dock-tabs.icon-mode` 显隐，活动页签图标用 accent-text；空态启动器新建的页签自动携带对应图标。②树行操作菜单（11b/12）重设计：`.tm-head` 目标行信息（名称 + level/运行中）、图标项 `.tm-item`（14px 线性图标 + `kbd` 快捷键提示 F2/Del）、`.tm-sep` 分区与 `.danger` 危险项（删除对话，danger 10% 底悬停）；交互补齐：菜单内 ArrowUp/Down 循环移焦、菜单项 click 执行后回读状态并归还焦点给更多钮、pointerdown 落在菜单与触发钮之外即关闭（原仅 Esc）。两卡 .spec-d 文档同步更新；T8 契约与 12 项 Playwright 交互断言（模式切换/图标显隐/启动器带图标/菜单结构/箭头键/点外关闭/项动作/第二棵树）全绿。另修复一处等价类时序毛刺：两级导航的滚动高亮改为「用户首次滚动后启用 + 构建期同步高亮首卡」，初始批 IO 回调时机不定会污染扫描器结构指纹（EQUIV_STALE 5 组合，v20 起潜伏、本轮首现）。v20：`components.html` 升级为生产级组件库指引页。①侧栏改两级导航：分类组（10 组，可折叠，计数徽标）+ 组件项（按 70 张卡自动生成，锚点直达 + IntersectionObserver 滚动高亮 + 活动指示点），与卡片集自动同步；②每张卡新增 `.spec-d` 文档块：构成（类名/令牌/尺寸硬参数，`<code>` 标注）/ 事件（click、键位、ARIA 属性）/ 行为（状态流转与边界）三行结构化规格，70/70 卡全覆盖，供迁移 TS 组件直接抄作业；③图形 emoji 全量清零（📄🖼🌐🔧📎🔒⚠ℹ→ 线性 SVG 图标，✕ 统一为文字 ×，↔ 改文案），仅保留 ✓×· 等文字性符号；④浮窗防遮挡：tree-menu 逃出 `.lst` 圆角裁剪（`overflow: visible` 覆盖），新增 z-index 层级阶梯注释（局部 1-15 · 菜单 30 · tooltip 50 · 顶栏/popover 60 · 遮罩 100 · Toast 200），10 类浮层经 elementFromPoint + 祖先 overflow + 视口边界三重断言无遮挡；⑤点击反馈补齐：189 个可点元素 47 组类全部具备 hover 变化 + active 按压或真实演示动作（seg/tree-toggle/src-open/pr-check/mode-pill/uq-dot/dt-x/launch-btn/md-tab/toolbar 等，方向 A/B 主钮 hover 以 brightness 滤镜补偿 accent-hover 同值问题）；⑥编排不贴边（launch-btn 内距、`spec-d` 16px 行距体系）；⑦动效核查：菜单/对话框/Toast/树折叠/工具活动/任务胶囊浮窗/switch 均实测中间帧，`prefers-reduced-motion` 全局降级保留；树折叠子行显隐改由 `aria-expanded` 兄弟选择器驱动（修复与箭头的相位错位）。文案纪律：文档块全中文、零破折号连接、每行 ≤110 字。T8 结构契约全程每批次复跑保持 70/70 卡 + 23 定向全绿。v19：卡 13c 从旧版静态步骤列表升级为对齐真实实现的任务计划胶囊——对齐 `TaskPlanProgress.tsx` / `styles.css` `.task-plan-*`（feat/im-feishu 工作树）：胶囊触发器「第 n / 总数 步」+ 当前步骤状态标记；悬停意图 175ms 后上浮步骤浮窗（pending 空环 / in_progress 旋转弧 / completed 勾选 / failed 叹号四态，当前步 pending 显示为进行中）；点击或聚焦固定展开，Esc、指针移出、点外、失焦关闭；全部完成后 2.5s 自动隐藏胶囊（演示经 `window.__planSet(state)` 可直达 run/failed/done）；令牌映射 panel-3→surface-3、muted→text-2、blue→accent、hover→surface-3，A/B/C 三方向经 `--row-h`/`--r-lg`/`--fs` 自动适配。T8 定向断言 22→23（新增 hover 意图时序、移出/Esc 关闭、失败态、完成 2.5s 自动隐藏、状态恢复）；对比度 open 场景补入胶囊浮窗步骤文本扫描。v18：`apple-inspired-ui.html` 主界面对齐 `feat/im-feishu` `e2879ac` 当前真实结构——移除顶部 macOS 演示条（原生拖拽区红绿灯/说明文字/页内主题切换钮；主题切换仍可用设置弹窗分段控件或 `#theme=` hash）；侧栏头改「任务 + 搜索任务」并移除独立新建钮；会话行补「···」更多菜单（重命名/分叉/归档/删除对话，components.html tree-menu 语言）；临时会话新增 IM 绑定线程「飞书 · 姓名」与连接徽标（绿点=已连接 / 红点=断链）；侧栏页脚改 用户名 + v1.4.40 版本徽标（点击进设置）；活动栏文案对齐 i18n（MCP 与 Skills / Token 用量 / 归档）；Dock 页签「审查」。此前 v17：绑定 current main `d0b7b9f`；补齐 20 张 partial 与 2 张 uncovered 的 HTML 原型状态/交互；新增 T8 70/70 卡片契约和 22 张历史缺口卡定向断言；新增 T9 正常、200% zoom、Dock closed 页面布局门禁。生产 TS/Electron 账本仍如实保留 48 covered / 20 partial / 2 uncovered，不把原型完成冒充正式迁移完成）。

## 打开方式

- **组件层主战场**：`components.html` —— A/B/C 三方向 × light/dark × normal/high-contrast 全切换，70 张组件卡 × 8 分类（另含概览区；侧栏计数经扫描器自动核对一致）。
  URL 直达：`#d=a|b|c`（方向）· `#t=light|dark` · `#c=normal|high`（对比度）· `#dialog=1`（打开对话框演示）· `#goto=<编号>`（滚动到指定组件卡）。
- **页面级原型**：`apple-inspired-ui.html` —— 方向 A 主界面高仿真；Dock separator、标签焦点和 Composer 布局已经纳入 T9 自动门禁。

URL hash 直达（apple-inspired-ui.html）：

```
#theme=dark                      主界面·深色
#theme=light                     主界面·浅色
#theme=dark&tab=terminal         Dock 终端标签
#theme=dark&dock=closed          右栏关闭
#theme=dark&collapsed=1          侧栏折叠
#theme=dark&empty=1              空会话状态
#view=resources|token-usage|automations|archive
#theme=light&settings=1          设置弹窗
#theme=dark&dockw=560            右栏预设 560px（自动钳制在边界内）
```

## 审计范围与基线

- **HTML 原型口径**：审计基线为 current main @ `d0b7b9fa20787c97c90cdb00a8fa827e275f5aef`。T8 执行 70 张卡片通用契约，并对历史 20 partial + 2 uncovered 定向触发状态、键盘与 ARIA 交互；v19 起另含 13c 任务计划胶囊定向断言（23 张）；T9 验证页面级正常、200% zoom 与 Dock closed 布局。
- **生产迁移口径**：`capability-matrix.md` 仍按同一 main 记录正式 TS/Electron 符号，结论是 **48 covered / 20 partial / 2 uncovered**。这是未来迁移清单，不因 HTML 演示通过而改写。
- 后续顺序：以 v17 HTML 原型为规格输入 → 迁移为 TS 组件 → 用 RTL/真实 Electron/screenshot matrix 重新建立生产证据。

## 对比度自动化矩阵（运行态 · 可复现）

**工具链已随包交付**：

```
contrast/scanner.js        扫描核心（文本节点 + ::before/::after + input/textarea::placeholder；
                           背景沿祖先链混合；渐变取全部停止点最差对比；前景做 alpha 合成；
                           disabled 控件与 data-cx-exempt 标记记录为豁免并说明理由）
contrast/run-headless.zsh  驱动脚本：构建 harness → 3 方向 × light/dark × normal/high
                           × default/open(对话框·菜单·Toast；slash 常驻菜单不计入 open)/forced-hover 全克隆 共 36 组合，
                           输出原始 JSON 到 contrast/results/，聚合 summary.json 与 REPORT.md
```

复现方式：解压后在包根目录执行 `zsh contrast/run-headless.zsh`（依赖 Chrome 与 python3/node；Chrome 版本会写入 REPORT.md）。固定 manifest：`contrast/results/` 必须恰好出现 36 个预期组合 JSON，且逐文件校验 `meta.combo`/`meta.label` 与文件名（含场景）一致、随机 nonce 执行绑定（仅逐行校验）、canonical 内容哈希（剥离 meta 与 state 的 direction/theme/contrast/nonce 身份字段，只覆盖实际扫描结果/断言/失败豁免/计数）——缺失、额外、未产出、元数据不符、重放或重复逻辑结果均判 FAIL；`contrast/fixtures.html` 用三趟截图（正常/文字隐藏/高对比字形mask）+ PNG 解码采样真实渲染字形核与邻近背景（不复用扫描器公式），渐变采样与元素渲染像素宽度绑定（每像素 1 样本并入 stop 端点）；对照按文字 span 覆盖列采样（隐藏文字趟同列背景 + 字形核 ≥85%maxdist 中位，覆盖列无字形记 1:1 证据，反例在扫描器 worstX 列定向确认），含「渐变早 stop 低对比」「渐变中段跨前景亮度」「组级 opacity 包住文字+背景」「窄色带（固定采样点漏检型）」等必须 FAIL 的假阳性反例，纳入总判定。

**最新一轮结果**：以包内 `contrast/summary.json`、`prototype-contract-result.json` 和 `layout-result.json` 为准；runner 对任何缺失结果 fail-closed，不接受手写通过声明。

## 已落地的角色令牌体系

| 角色 | 用途 |
|---|---|
| `--accent` / `--success` / `--warning` / `--danger` | 仅填充与描边（按钮底、选中态、边框） |
| `--accent-text` / `--success-text` / `--warning-text` / `--danger-text` | 彩色**文字**（徽章/编号/diff 行/pill/hover 图标） |
| `--accent-hover` / `--danger-solid` | 交互态填充（hover 底色随各主题文字角色成对设计） |
| `--on-success` | 成功填充上的图形/文字 |

UserInputCard 倒计时（2026-08-27，对齐真实实现；颜色信号点为本页提案——真实产品当前仅 muted 文字无信号）：信号点三档：剩余 >60s 品牌蓝（进行中）、≤60s warning 黄（临期）、≤15s danger 红 + 呼吸光环（紧迫，复用任务计划呼吸语言）。阈值经 `window.__ucSet(sec)` 可直达验证。17/17b 卡片头部提示行右侧增加实时倒计时，格式 `M:SS`、默认 **5 分钟**——严格对齐真实代码：`USER_INPUT_TIMEOUT_MILLISECONDS = 5*60*1000`（src/main/user-input-policy.ts:5）、`formatUserInputCountdown`（src/renderer/user-input-countdown.ts，Math.ceil）、提示文案「5 分钟内未选择将自动采用模型推荐项」= App.tsx timeoutHint；17b 多组问答**每题独立 5 分钟**（真实产品每组问答是独立 request，各自 expiresAt，见 protocol schema `expiresAt` 字段），切题时重置。demo 到 0:00 回卷循环；真实产品到时自动采用推荐项并提示「5 分钟未选择，已采用模型推荐项」。

菜单项留白（2026-08-27 设计反馈）：浮层菜单（斜杠命令/下拉）容器 `padding:5px 6px` + `flex-direction:column; gap:4px`，项圆角 6px——相邻高亮项之间保持 4px 纵向空隙、高亮块距菜单边缘 6px，选中后移动不贴边。已程序化验证 gap=4px。

验收口径（建议规范第 5 条执行细则）：对比度按**实际承载背景**（含芯片/hover/选中行/菜单叠层等次级表面）由上述工具链在全部 36 组合上判零；人工验收保留浏览器像素/键盘/读屏/200% zoom 维度。

## 三方向令牌（同一信息架构，仅换令牌）

顶部 tab 即时切换；只在提案规定的五维度差异：

| 方向 | 色温 | 强调色 | 密度 | 圆角/材质 |
|---|---|---|---|---|
| **A · Apple-inspired** | 石墨 `#1d1d1f`/`#f5f5f7` | Artemis Blue `#0071e3` / `#2077c9`(深) | 舒适（行高 36px） | 同心圆角 8–18px，轻毛玻璃浮层 |
| **B · Studio Precision** | 石墨蓝灰 `#0f1114`/`#f6f7f8` | 收敛钢蓝 `#3a6ea8` / `#5e9bd8`(深) | 紧凑（行高 30px） | 直角 4–8px，实底高对比描边（无 blur） |
| **C · Warm Editorial** | 暖米 `#f7f4ef` / 暖棕黑 `#1f1c19` | 赭石 `#ba583c` / `#a4654e`(深) | 宽松（行高 42px） | 大圆角 10–24px，衬线标题（New York/Songti）+ 纸感 |

## 组件层（components.html）· 70 张组件卡 × 8 分类（另含概览方向对比区；侧栏计数经扫描器自动核对一致）

分类导航：概览 / 令牌 / 图标 / 基础 / 输入 / 浮层 / 数据容器 / 状态 / Artemis 专属，随滚动高亮。
- **UserInputCard 三态**（17/17b/17c）：提问态（含 5:00 实时倒计时）、多组问答（每题独立 5 分钟，切题重置）、结果态（超时「已采用模型推荐项」/「已选择」，对齐真实 `user-input-result` 行结构）；选项行前置 **18px 小圆角方块编号**（1/2/3，radius 固定 4px 不随方向令牌放大，选中时转 accent 底白字）；**自定义输入流**（选「3 · 自定义输入…」选项条原位进入行内编辑并聚焦——不出独立输入框；Enter 提交切结果态并冻结倒计时，Esc 取消恢复）。

- **主题三态**：light / dark / increased-contrast（high 档覆盖 text-2/text-3/边框，本页完整提供；页面级原型不含此档，见交付边界）+ comfortable/compact 双密度，顶栏即时切换并回读计算值。
- **规则修正**：① 按钮为圆角矩形；② 开关选中用品牌强调色；③ 静态卡片零阴影；④ 菜单关闭退出 Tab 序列，打开焦点入首项；⑤ Split Pane 使用像素 `aria-valuenow/min/max`、越界钳制、Home/End 与关闭后移出 Tab 顺序；⑥ Tabs/树/Dock/多组问答使用 roving tabindex 与焦点恢复。
- **HTML 原型覆盖**：70/70 通用卡片契约 + 22/22 历史缺口定向契约。生产覆盖另见矩阵，仍为 48/20/2。
- **图标库**：常规语义图标 98 格 + Agent 团队生成式标记 8 格，合计 106 格（24 网格 · stroke 1.5 · 圆角端点 · currentColor；真实语义覆盖 76/76）。标记演示使用 ChildAgentIcon.tsx 的 identity 哈希机制（ChildAgentIcon.tsx 的 identity 哈希机制，建议保留其逻辑、仅统一线宽端点）。

预览：图片不再随包分发；复核时用 hash 直达自截（如 `components.html#d=a&t=light&goto=17`）。

## 页面级原型（apple-inspired-ui.html）· 方向 A 高仿真

对齐项（基于较早基线渲染树核对）：shell 网格 46/252/1fr、48px workspace-header、ComposerContextBar 运行模式下拉、上下文用量环、三层会话树、Dock 动态标签 + 宽度拖拽（键盘 ±24px、双击复位）、消息时间线审批卡等，详见下方令牌映射。

## 令牌映射（现有 styles.css → 方向 A）

| 语义 | 现有值（dark） | 方向 A dark | 方向 A light |
|---|---|---|---|
| 基底 bg | `#111214` | `#1d1d1f` 石墨 | `#f5f5f7` |
| 工作区面 | `#181818` | `#232325` | `#ffffff` |
| composer 面 panel-2 | `#1b1c1f` | `#272729` | `#ffffff` |
| 用户气泡 panel-3 | `#202226` | `#2c2c2f` | `#f0f0f2` |
| 强调 blue | `#78a9ff` | `#2077c9`* | `#0071e3` |
| 文字 text | `#ececee` | `#f5f5f7` | `#1d1d1f` |
| 次要 muted | `#979ba4` | `#a6a6aa`* | `#68686c`* |
| composer 阴影 | `0 10px 36px` | ✅ 保留同值（浅色减淡至 0.18） | 同左 |
| 动效 | 逐处定义 | 180/320/480ms `cubic-bezier(0.32,0.72,0,1)`；shell `(0.16,1,0.3,1)` | 同左 |

\* 第四轮对比度归零后的新值（A 深 accent 由 #2997ff 压暗以承载白字按钮；text-3 按 matrix 口径抬升）。

## 预览截图（previews/ 已于 2026-08-27 清理；下列编号仅为历史索引）

01 主界面·深 · 02 主界面·浅 · 03 Dock 终端标签 · 04 右栏关闭 ·
05 侧栏折叠 · 06 空会话状态 · 07 插件 · 08 使用量 ·
09 定时任务 · 10 归档 · 11 设置弹窗 · 12 dock-width-{460,620,800}

## 交付边界（如实声明）

- 这是可执行 HTML 规格，不是正式 TS 组件；不改动 Artemis 产品源码。
- increased-contrast 第三主题由 `components.html` 覆盖；页面级 `apple-inspired-ui.html` 仍只展示 light/dark。
- 200% zoom 的 T9 只证明 headless Chrome 几何与控件边界；不替代 VoiceOver/NVDA、macOS/Windows 真实 Electron、原生 PTY、性能与长时间运行验收。
- 生产矩阵的 partial/uncovered 是迁移工作清单；只有 TS 组件与真实页面测试通过后才可更新。

## 验证入口与退出码（v17）

附件 zip 顶层为 prototype/，解压到仓库根后一条命令完成正常基线 + 全部自测（T1–T9）：

    unzip artemis-ui-prototype-v17.zip -d <仓库根> && cd <仓库根>/prototype/contrast && ./run-headless.zsh

裸解压（无 .git）时矩阵锚点验证会输出 MATRIX_REPO_NOT_FOUND（exit 3，受控错误）；在仓库内运行或用 --repo 指定仓库根。

- 正常基线：36 组合扫描 → 聚合（fail-closed）→ fixtures 像素对照（13 用例）→ 结构不变量负向（structure-check.html，14 用例，含 aria-selected 单次扫描翻转与分隔符碰撞两个 R15 反例）
- 自测（同一命令内）：T1 生产账本格式/计数/锚点 + T8 结果一致性；T2 audit schema 负向×4；T3 投影后等价单侧注入×2；T4 重放；T5 无浏览器退出码；T6/T7 两种解压布局；T8 70 卡/23 定向原型契约；T9 normal/200% zoom/Dock closed 页面布局。
- 退出码：0=全过；91=VERSION_DRIFT；90=缺 VERSION；主跑失败按 agg+fixtures+structure+contract+layout 合计；无浏览器=NOBROWSER_EXIT（fail-closed 断言值）。
- 每条自测断言「预期错误类别 + 非零退出」，类别名：AUDIT_SCHEMA / STRUCT_CHANGED / EQUIV_STALE / MANIFEST
