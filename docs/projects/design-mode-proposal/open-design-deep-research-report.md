# Open Design 深度调研报告

> **目的**：为 Artemis「在 composer 新增设计模式、进入设计面板」提案提供参考。调研覆盖功能全景、核心工作流、模式体系、UI 结构布局、数据契约与可借鉴的工程设计模式。
> **调研对象**：`~/Documents/open-design`，版本 **0.16.1**（本地 checkout 截至 2026-07-31，commit `0c5f98e`；上游仍在演进，落地前建议再对照一次上游）。
> **调研方式**：四路并行深度代码调研（桌面 UI 结构 / agent 工作流与协议 / 设计系统与内容层 / 产物模型与渲染导出）+ 关键数值人工抽查验证（Studio 分栏宽度、chip rail 顺序、SessionModeToggle、modes.md 均已实读确认）。
> **License**：Apache-2.0（机制与模式可自由借鉴；`design-systems/` 内的品牌包为 curated fixture，逐包再核）。

---

## 0. 一页总览（TL;DR）

Open Design 是**"开源版 Claude Design"**：一个本地优先的 macOS/Windows 桌面应用，**自己不实现 agent 循环**，而是把用户机器上已有的 25+ 个 coding agent CLI（Claude Code、Codex、Cursor Agent、Pi、Devin……）当作"设计引擎"来驱动，生成网页原型、PPT、图片、视频、动效、音频等设计产物。

对 Artemis 提案最有价值的六个结论：

1. **"设计模式"是提示栈，不是第二个编排框架。** OD 把整个设计循环（发现 brief → 锁方向 → 计划 → 流式产出 → 评审 → 交付）实现为**一个分层组装的系统提示 + assistant 文本内嵌的结构化标记（`<question-form>`、`<CRITIQUE_RUN>` 等）+ 宿主端解析器**，agent CLI 的原生循环完全不动。这与 Artemis "Pi is the only agent loop" 的不变量天然兼容。
2. **模式入口长在 composer 底栏。** OD 的会话模式切换是 composer 底部的一个三档下拉（chat / plan / design），每档带成本信号条与悬停说明卡；**模式只影响后续 run，随下一条消息生效**。意图细分（原型/PPT/图片/视频……）则由 composer 下方的 **chip rail** 承担，选中 chip 后该场景的专属表单字段**内联展开在 composer 底栏**，而不是弹窗。
3. **设计面板 = 左会话右工作台的可拖分栏。** 左栏对话流（默认 460px，可拖 345–720，可隐藏进入专注模式），右栏是**标签式工作台**：每个产物一个 tab，沙箱 iframe 预览 + 版本历史模态 + 手动微调检查器 + 导出菜单。消息流里的产物卡片一点即在右侧开 tab——多产物切换完全由 tab 系统承担。
4. **品牌契约是三层文件包**：`DESIGN.md`（人/agent 可读散文）+ `tokens.css`（机器可粘贴的 `:root` 绑定契约，直接进产物第一个 `<style>`）+ `manifest.json`（发现与派生声明）。151 个内置品牌包，guard 防散文与 token 漂移。
5. **评审是一条 wire protocol**：`<CRITIQUE_RUN>` 标签流 + 五评委加权打分 + composite ≥ 8.0 且 MUST_FIX=0 才放行；轻量版是技能内置的 5 维自评（任一维 < 3/5 回修）。
6. **产物即文件 + sidecar manifest**：`<entry>.artifact.json` 记录 kind/renderer/exports 三元组驱动前端渲染器注册表与导出菜单；版本史挂在文件维度、每版本存触发 prompt 原文，恢复写新版本（非破坏性）。

---

## 1. 产品定位与总体架构

### 1.1 定位

- 自述："The open-source Claude Design alternative"、"Figma alternative for the agent era"（`README.md:32-36`）。
- 核心理念：Claude Design 的 agent-native 循环——**discover the brief, lock the direction, stream the artifact, critique, deliver**——不再封闭，变成一个由**功能技能、渲染模板、设计系统、插件**组成的文件系统，让本机已有的 coding agent 读、写、重组（`README.md:34`）。
- 你的 CLI 成为设计引擎，笔记本成为工作室，团队的 `DESIGN.md` 成为品牌契约。

### 1.2 进程拓扑

```
┌────────────────────────── Electron 桌面壳 (apps/desktop, 仅主进程) ─────────────────────┐
│   titleBarStyle: hiddenInset（无传统标题栏，自绘窗口 chrome）                             │
│   窗口 loadURL → daemon 起的本地 web 服务                                                │
└───────────────────────────────────────┬───────────────────────────────────────────────┘
                                        │ HTTP + SSE
┌───────────────────────────────────────▼───────────────────────────────────────────────┐
│  Express daemon (apps/daemon) —— 唯一业务权威                                            │
│  · /api/chat：组装系统提示 → spawn 用户选定的 agent CLI（cwd=项目目录）→ 解析 stdout 流    │
│  · 项目/文件/版本/设计系统/技能/插件/媒体生成/导出 全部 REST API                           │
│  · 数据落盘：<OD_DATA_DIR>/projects/<uuid>/… + app.sqlite                                │
└──────┬──────────────────────────────┬──────────────────────────────────────────────────┘
       │ spawn (26 个 RuntimeAgentDef) │ 代理 HTTP
┌──────▼──────────┐          ┌────────▼─────────┐          ┌────────────────────────┐
│ Agent CLI        │          │ od CLI           │          │ MCP stdio server       │
│ claude/codex/pi… │          │ 双轨规则：UI 能   │          │ od mcp install <agent> │
│ 或 BYOK proxy    │          │ 做的 CLI 都能做   │          │ 外部 agent 反向写产物   │
└─────────────────┘          └──────────────────┘          └────────────────────────┘
```

- **apps/web**（Next.js 客户端 SPA）承载**全部 UI**；apps/desktop 只有 Electron 主进程（`apps/desktop/src/main/runtime.ts:2670,2752`）。桌面专属能力（矢量 PDF、PPTX 截图、MP4）经 sidecar IPC 落到 Electron 主进程的隐藏 BrowserWindow 执行。
- **双轨规则**：Web UI 与 `od` CLI 调同一组 HTTP API（根 `AGENTS.md`）。
- **执行画像**（`packages/contracts/src/execution-profile.ts`）分两种：
  - `filesystem`（默认）：agent 用原生工具直接写项目文件；
  - `text_artifact`（BYOK/纯文本流）：模型无工具，输出单个 `<artifact type="text/html">` 块，daemon 解析后落盘。
- **数据目录契约**：`OD_DATA_DIR` 派生一切路径（根 `AGENTS.md:62-101`）。项目目录内含 entry 文件、`<entry>.artifact.json` sidecar、`.file-versions/`（版本快照）、`.live-artifacts/`、`.hyperframes-cache/`；会话消息/标签页状态/画布评论在 `app.sqlite`。

### 1.3 规模感

| 资产           | 数量                    | 说明                                                    |
| -------------- | ----------------------- | ------------------------------------------------------- |
| 设计系统品牌包 | 151（+`_schema`）       | `design-systems/<slug>/`，含 apple/claude/airbnb/ant…   |
| 渲染模板       | 114                     | `design-templates/`，每个含 `SKILL.md` + `example.html` |
| 功能技能       | 160+                    | `skills/`，SKILL.md 形态，与模板同构、分属两个注册表    |
| 官方场景插件   | 13 + 143 个 DS 镜像插件 | `plugins/_official/`                                    |
| Agent 适配 def | 26                      | `apps/daemon/src/runtimes/registry.ts`                  |
| craft 手艺文件 | 13                      | `craft/*.md`，品牌无关的普适设计规则                    |

---

## 2. 功能全景

### 2.1 产品页面（左侧 56px 图标导航栏 `EntryNavRail`，默认收起）

| 页面                      | 功能                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Home**                  | 大 composer（brief 输入）+ 意图 chip rail + 近期项目 + 插件画廊（详见 §5.2）                                                                                             |
| **Projects / Designs**    | 项目网格                                                                                                                                                                 |
| **Design Systems**        | 151 内置品牌包管理；创建向导支持 website URL / GitHub repo / 本地代码 / Figma / 资产上传 / 预设品牌 / DESIGN.md 粘贴七种源；可"用 Agent 编辑"、AI 深度优化（enrichment） |
| **Tasks / Automation**    | 把重复设计工作流编排成可调度的自动化任务                                                                                                                                 |
| **Plugins / Marketplace** | 浏览/安装/分发插件；GitHub-backed registry（PR review 合并再生 marketplace.json）                                                                                        |
| **Integrations**          | 连接器（connector）、MCP、use-everywhere（从任意 IDE/脚本使用 OD）                                                                                                       |
| **Studio**（项目内）      | 左对话右工作台的设计现场（详见 §5.3）                                                                                                                                    |

### 2.2 产物类型矩阵

| 类型                                        | 形态                                                                                     | 预览                                      | 导出                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------- |
| Prototype（网页/移动/桌面原型）             | 单页 HTML，读 DESIGN.md                                                                  | 沙箱 iframe                               | HTML / PDF / ZIP             |
| Deck（PPT）                                 | HTML + `.slide` 约定                                                                     | iframe + 键盘翻页 + 缩略图栏 + 演讲者备注 | PPTX（截图式/可编辑式）/ PDF |
| Image                                       | 媒体 provider 生成                                                                       | 原生 `<img>`                              | 文件下载                     |
| Video                                       | provider 生成，MP4 直接落项目目录                                                        | 原生 `<video>`                            | MP4（生成即产物）            |
| HyperFrames（HTML 动效）                    | agent 写 GSAP timeline 合成物，daemon 用 puppeteer 逐帧渲染 MP4（超时 5 分钟，进度回流） | 同 video                                  | MP4                          |
| Audio                                       | speech/sfx（ElevenLabs 等），音乐暂缓                                                    | 原生 `<audio>`                            | 文件下载                     |
| Live Artifact（活产物）                     | 模板 `template.html` + 数据 `data.json` 分离，可刷新                                     | 服务端水化预览（**CSP 禁脚本**）          | —                            |
| React component / Markdown / SVG / mini-app | manifest kind 枚举                                                                       | 对应 viewer（Babel 编译/消毒渲染）        | JSX / MD / SVG               |

### 2.3 能力清单（摘要）

- **多 agent 驱动**：26 个 CLI def（claude-stream-json / json-event-stream / ACP JSON-RPC / pi-rpc / plain 五类流格式）；无 CLI 时走 BYOK proxy 直连任意 OpenAI 兼容端点（带 SSRF 防护）。
- **MCP 双向**：对内 `od mcp install` 装给外部 agent；工具含 `collect_brief/confirm_brief`（brief 收集卡）、`create_artifact`（写 normal artifact 入口文件+manifest）、`write_file`（迭代）、`start_run`（委托 OD 内部跑技能，requestId 幂等）。
- **版本系统**：每文件独立版本链，AI run 边界自动快照，每版本记录触发 prompt 原文；恢复写新版本。
- **评审**：技能内置 5 维自评 + 可选 Critique Theater 多评委剧场（SSE 驱动的舞台 UI）。
- **手动微调**：预览上直接点选改文字/颜色（ManualEditPanel），以及 tweaks 参数面板（CSS 变量实时调参，不重载）。
- **评论/标注**：预览画板评论模式、draw overlay，评论存 SQLite。
- **内置浏览器/终端/白板**：工作台里可开浏览器 tab（browser-use 自动化）、xterm 终端 tab、Excalidraw sketch tab、侧聊 tab。

---

## 3. 核心设计工作流（五阶段循环）

README 的一句话循环在实现上是**"巨型系统提示 + CLI 原生工具流 + 宿主端标记解析"三件套**，不是一个代码状态机：

```
用户 brief ──POST /api/chat (SSE)──▶ daemon 组装系统提示 → spawn agent CLI
    ▼
① Discover   agent 输出 <question-form>（≤5 题、每题带推荐默认值）→ UI 渲染表单 → 答案回传为下一条 user 消息
② Lock       品牌分支：有品牌源→实测提取(grep 真实 hex，禁猜色)；无→从 5 个内置方向自行锁定（不再二次询问）
③ Plan       第一个工具调用必须是 TodoWrite，9 步计划逐项实时更新
④ Stream     agent 用原生工具直接写项目文件（filesystem handoff），结尾只做文件摘要
⑤ Critique   5 维自评（<3/5 回修）；可选多评委 <CRITIQUE_RUN> 标签流协议
⑥ Deliver    daemon diff 项目目录得产物清单 → 版本快照 → 预览/导出
```

### 3.1 Discover——question-form 协议（最值得移植的机制）

规则源：`apps/daemon/src/prompts/discovery.ts:40-95`。

- **只澄清"实质性影响结果的未决信息"**：新项目/首轮/元数据空缺不构成提问理由；信息够就直接开工。
- agent 先输出一句短 prose，再输出完整 `<question-form id="discovery">` JSON 块，然后**停止本轮**（不写代码不起工具）。
- 控件类型：`radio/checkbox/select/text/textarea/number/range/date/time/color/url/email/tel/file/switch/direction-cards`。
- **每题必须带推荐 `default`**——目标是"用户原样提交也能得到合理产出"；**硬上限 5 题**；全量本地化。
- 答案回传格式：`[form answers — discovery]\n- 问题: 答案 [value: stable_id]`——`[value:]` 后缀保证枚举值不因 label 本地化而破坏 agent 分支判断（`apps/web/src/artifacts/question-form.ts:786-819`）。

### 3.2 Lock the direction——三条路径

- **Branch A（有品牌源）**：agent 用 Bash/Read/WebFetch 真实抓取——`grep -E '#[0-9a-fA-F]{3,8}'` 提取真实色值（**禁止凭记忆猜色**）→ 写 `brand-spec.md`（6 个 OKLch 色板 token + 字体栈 + 布局姿态）→ 一句话口头陈述让用户低成本纠偏。
- **Branch B（无品牌源）**：从内置 **Direction Library**（`apps/daemon/src/prompts/directions.ts:53-184`）五个方向（editorial-monocle / modern-minimal / human-approachable / tech-utility / brutalist-experimental，各含完整 OKLch 六色板 + 三字体栈 + posture）自行绑定，**不再发第二个选向表单**——"只问一次，问完就锁"。
- **激活设计系统豁免**：系统提示已有 `## Active design system` 段时，禁止一切 theme/color/direction 二次询问。
- `direction-cards` 富卡类型把方向渲染成带色板 swatch/字体样例/mood 的可选卡——**同一份 DesignDirection 数据既给用户点选、又以 CSS-ready `:root` 块内联给 agent**，消除"用户选的"与"agent 绑定的"之间翻译损耗。

### 3.3 Plan——TodoWrite 9 步

方向锁定后第一个工具调用必须是 TodoWrite（`discovery.ts:133-173`），标准模板：读 DESIGN.md 与技能资产 → 绑定 token 到 `:root` → 规划页面/幻灯片清单 → 拷贝种子模板 → 填充布局 → 替换占位文案 → 跑 checklist（P0 全过）→ 5 维自评（<3/5 回修）→ 摘要。**逐项实时更新**，不批量收尾。Deck 有"framework first, content second"特例：逐字拷贝框架 HTML，禁止自写翻页/scale-to-fit 逻辑。

### 3.4 Stream——filesystem handoff

节奏契约（`apps/daemon/src/prompts/system.ts:549-572`）：短 prose/卡片宣布锁定方向 → 进度工具 → 原生工具写/改文件 → 结尾短摘要点名文件。**禁止在聊天里重复源码**。新交付物起**语义化文件名**（`investor-pitch-deck.html`），不叫 `index.html`。

### 3.5 Critique——两层评审

1. **技能内置 5 维自评**（每 run 自动）：Philosophy / Hierarchy / Execution / Specificity / Restraint 各 1-5 分，任一维 <3/5 回修最弱项重评。
2. **Critique Theater**（结构化多评委，默认关、四层开关）：
   - 5 个 panelist 在**同一 CLI 会话内以轮次发言**（不 spawn 额外进程）：DESIGNER（起草不评分）/ CRITIC / BRAND（DESIGN.md 合规）/ A11Y（WCAG AA）/ COPY。
   - wire protocol 是纯标签流 `<CRITIQUE_RUN><ROUND n><PANELIST role score>…<ROUND_END decision>`（`apps/daemon/src/prompts/panel.ts:136-195`）。
   - 收敛：composite 加权（designer×0 + critic×0.4 + brand/a11y/copy×0.2）**≥8.0 且 MUST_FIX 总数=0** 才 ship；默认最多 3 轮，超时取最高分轮；"round n+1 的 transcript 字节数必须严格小于 round n"防膨胀；**至少两个 panelist 必须在修复目标上分歧**（全票一致视为评审太浅）；daemon 重算 composite 防模型虚报。
   - 事件走双 SSE 通道，前端"剧场"组件（评委泳道 + 分数带 + 轮次分隔 + Esc 打断）叠在工作区顶部，idle 不占位。

### 3.6 Deliver

daemon 对项目目录做 run 前后 diff 得产物清单（`apps/daemon/src/server.ts:4807-4919`），对 AI 生成的 HTML 自动版本快照；预览/导出按 manifest 的 exports 能力出菜单。

---

## 4. 模式体系（对"composer 设计模式"最直接的参考）

OD 有**三套正交的"模式"概念**，文档明确要求不混淆：

### 4.1 会话模式 `ChatSessionMode = 'chat' | 'plan' | 'design'`

per-conversation，随 `POST /api/chat` 的 `sessionMode` 字段传入；UI 是 **composer 底栏的三档下拉**（`apps/web/src/components/SessionModeToggle.tsx`，已实读验证）：

| 模式           | 图标     | 成本档           | 行为（由提示 override 实现）                                                                                                                   |
| -------------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| chat           | comment  | low（1/3 格）    | 像普通助手一样回答/对比/调试；**不装载**发现层/设计章程/deck 框架/评审面板（省 3K+ token）；记忆/技能/插件/MCP 仍装载（"light, not amnesiac"） |
| plan           | file     | medium（2/3 格） | 同一上下文/工具/设计系统，但先产出**可编辑的 Markdown 计划文档**（plan.md / deck-outline.md / prd.md，按意图选体裁），用户确认前不出最终制品   |
| design（默认） | sparkles | high（3/3 格）   | 完整五阶段循环，装载全部重提示栈                                                                                                               |

交互细节（值得照抄）：

- 三档都带**成本信号条**（3 格用量表）——用户切换前就有开销预期；
- 菜单悬停/聚焦时右侧展开**说明卡**：标题、摘要、成本说明、适用场景（Best for）、三条示例 query（`SessionModeToggle.tsx:140-202`）；
- **模式随下一条消息生效**（`pendingSessionModeRef`，`ChatComposer.tsx:1026,1236`）——不重绑正在运行的子进程；
- 每档的成本/行为差异完全由系统提示的 override 段实现（`system.ts:1399-1436`：`CHAT_MODE_OVERRIDE` / `PLAN_MODE_OVERRIDE`），没有第二套代码路径。

### 4.2 创建面 tabs（New Project UI 的六个 tab）

Prototype / Live Artifact / Deck / Template / Media(Image/Video/Audio) / Other（`docs/modes.md`，已实读验证）。写进项目 `metadata.kind`。**tab 描述用户起点的工作流，daemon 的技能注册表 mode 描述指令包如何路由，二者故意不一一对应**。

### 4.3 技能注册表模式（`SKILL.md` 的 `od.mode` 七值）

`prototype | deck | template | design-system | image | video | audio`（`apps/daemon/src/skills.ts:30`）。

> 对 Artemis 的启示：**"设计模式"应该是会话级的（composer 上的一个档位），而"做什么类型的东西"是意图级的（chip/子模式）**，两层不要混成一个枚举。

---

## 5. UI 结构与布局详解

### 5.1 应用外壳

```
workspace-shell
├─ WorkspaceTabsBar          浏览器风格多"工作区标签页"顶栏（持久化 localStorage、拖拽重排、Cmd+数字切换）
│                            macOS 下左侧留红绿灯位；整条兼作窗口拖拽区（hiddenInset 无框窗口）
└─ body
   ├─ EntryShell（Home 及管理页共用）          ──或── ProjectView（Studio）
   │  └─ entry（CSS grid 两列）
   │     ├─ EntryNavRail    左侧 56px 纯图标导航，默认收起为 0 宽（Manus 风格），收起时整栏 inert
   │     └─ entry-main      顶条（rail 开关/消息中心/头像菜单）+ 内容区 max-width 1440px 居中
```

### 5.2 Home 页与 composer（设计模式的输入面）

```
home-view（垂直栈，滚动容器）
├─ HomeHero（居中，卡片区 max-width 960px）
│   ├─ 品牌 logo + 大标题（衬线体）+ 副标题
│   ├─ ★输入卡（max-width 720px，focus-within 高亮）
│   │   ├─ 已暂存上下文 chip 行（文件缩略图/插件/技能/MCP/设计系统引用，均带 ✕）
│   │   ├─ Lexical 富文本输入（@mention；空置时占位文案轮播；Enter 发送；可粘贴文件）
│   │   │   └─ 光标锚定 @ 浮层：Plugins/Skills/MCP/Connectors/Files 分组
│   │   └─ ★输入卡底栏（flex 两端）
│   │       ├─ 左：＋菜单（上传/引用项目/Figma/设计系统…）｜模板选择 pill｜媒体面表单字段（内联）
│   │       └─ 右：SessionModeToggle（chat/plan/design）｜执行引擎切换｜Run 按钮（空文案禁用）
│   ├─ 卡下一行：设计系统选择器 ｜ 工作目录选择器
│   ├─ ★意图芯片 rail（"Start with template"，横向滚动场景卡：插图+标题+一行描述）
│   │   └─ create 组 13 枚：web-clone → deck → prototype → wireframe → mobile → document
│   │        → hyperframes → webgl → live-artifact → image → video → audio（+create-brand-kit）
│   │   └─ 末尾 ⋯ 菜单收纳 migrate 组
│   ├─ 二级子类 chip 行
│   └─ 选中 chip 后：提示词示例卡行（插件预设或站点 favicon 卡）＋插件表单字段
├─ 新手推荐区
├─ 最近项目横滑卡条
└─ 场景插件画廊
```

关键机制：

- **chip = 动作而非装饰**：每个 chip 的 action 是判别联合（`apply-scenario(pluginId, projectKind, inputs?, projectMetadata?)`）——**选 chip = 绑定一个场景插件 + 项目类型 + 默认参数**（`apps/web/src/components/home-hero/chips.ts:44-63,87-377`）。
- **媒体面 = 字段集**：image/video/hyperframes/audio 四面共用 `buildHomeMediaComposer(surface)` 生成 `fields/inputs`，渲染为底栏内联表单（image：模型/比例/分辨率；video：+时长；audio：文本或提示词/语音类型/模型/音色……）；**换面即重建表单并归一化**；参数不再烘进 prompt 文本，交给 agent 运行时询问（`apps/web/src/components/home-hero/media-surfaces.ts`）。
- **选中 chip 后 rail 收起**、原地展开该场景的示例与字段；清掉 chip 恢复 rail——一套"composer 状态机"而非弹窗表单。
- 自由输入**也不会跑裸 agent**：路由到内置隐藏 `od-default` 场景插件（discovery→plan→generate→critique 管线，`plugins/_official/scenarios/od-default/`）。

### 5.3 Studio（项目页）——"设计面板"的布局范式

```
<div class="app">
├─ CritiqueTheaterMount        评审剧场（SSE 驱动，idle 时为 null，不占位）
└─ split（grid: {chatWidth}px  8px  minmax(400px,1fr)）
   ├─ 左：ChatPane
   │   ├─ 顶行：← 返回 ｜ 项目名（可编辑）｜ 会话切换下拉（+New/搜索/列表）
   │   ├─ 消息流：用户气泡 + agent 块序列
   │   │    （TaskActivityCard 执行摘要 / ProseBlock / ThinkingBlock / 工具卡 /
   │   │      ★产物卡 ProducedFiles——点击在右侧开 tab / 下一步建议条 / 👍👎）
   │   └─ ChatComposer（底部；与 Home 同一输入底座，差异：@mention+斜杠命令、
   │        StagedRunContexts 上下文行、工具箱弹层、Stop/Send 并存、占位符跟随活动文件）
   ├─ 中：8px 拖拽条（hover 变色，键盘步进 16px）
   └─ 右：FileWorkspace（标签式工作台）
       ├─ 标签条：[Design System]｜[Pages ▾]｜普通文件/浏览器/终端/侧聊/live-artifact 标签
       │         （可拖拽重排、滚轮横滑）＋ ＋新建启动器 ＋ 文件动作/移交 CLI/设置
       └─ 按活动标签渲染：
           · FileViewer（默认）★产物预览
           · DesignFilesPanel（文件列表+内嵌预览双栏 grid）
           · DesignBrowserPanel / TerminalViewer / SketchEditor / SideChatTab / LiveArtifactViewer
```

实测数值（已验证，`ProjectView.tsx:479-492`）：

- 左栏默认 **460px**，min **345** / max **720**（且按视口自适应钳制），localStorage 持久化；
- **专注模式**：chat slot `hidden`，grid 变单列，工作台左上角浮现"显示聊天"按钮；
- 左栏可被 ManualEditPanel（手动改稿检查器）整体替换。

**FileViewer**（产物预览器，13000+ 行）：

- 顶工具栏：deck 缩略图栏开关｜重载｜**Versions**（版本历史模态：左版本列表含来源徽标 ai/manual + 右版本预览 + Restore）｜Source/Preview 切换｜视口切换（desktop/mobile/宽）｜deck 翻页｜截图复制｜评论模式｜标注｜手动编辑｜zoom｜更多（分享/导出 HTML/PDF/PPTX/ZIP）；
- 正文：`preview-frame-clip > iframe`；**iframe 保活池**（默认 5 个复用，切 tab 秒开）；
- 双预览策略：多文件产物走 URL-load（保真、缓存）；需要宿主能力（翻页/评论/inspect/调参/编辑）或检测到焦点抢占/重定向循环时切 **srcDoc 注入桥**；沙箱默认 `allow-scripts allow-downloads`（无 same-origin），WebGL/WASM 需求才升级 powered 沙箱；
- 宿主⇄iframe 通信全部 postMessage（`od:` 前缀）：`od:slide`、`od:tweaks-available`、`od:tweaks-panel-visible` 等。

### 5.4 设计语言（UI 自身）

- 手写 CSS + CSS 变量（BEM），Tailwind v4 仅作 PostCSS 插件存在；token 源 `apps/web/src/styles/tokens.css`。
- 色彩：暖白工作台 `--bg #faf9f7`（暗色 `#1a1917`）——注释明确"**中性产品工作台，不让 chrome 色彩污染生成的 artifact**"；强调色陶土橙 `--accent #c96442` 只用于 app chrome 主 CTA；"当前选中"用独立的 `--selected #2563eb`。
- **圆角锁**：`--radius-xs 4 → sm 6 → base 8 → md 10 → lg 12 → pill 999`（"Shape Consistency Lock"）。
- **动效纪律**：唯一缓动 `cubic-bezier(0.23,1,0.32,1)`；时长三档 120/200/140ms；**禁 ease-in**。
- 字体：衬线 Source Serif Pro 用于标题/品牌，正文系统栈 13.5px。

---

## 6. 关键数据契约

### 6.1 设计系统包（三层文件）

```
design-systems/<slug>/
├── manifest.json    发现元数据 + 文件清单（schemaVersion od-design-system-project/v1；source.type ∈ bundled/local/github/shadcn）
├── DESIGN.md        人/agent 可读的品牌散文契约
├── tokens.css       机器可粘贴的绑定契约（:root 直接进产物第一个 <style>）
├── USAGE.md         agent 阅读顺序路由（必须含 Read Order/Highlights/Do/Avoid 四节）
├── components.html + components.manifest.json   组件 fixture 与派生索引
├── design-tokens.json / tailwind-v4.css         派生缓存（可再生，非第二真相源）
├── preview/（≥3 页：colors/typography/spacing）、assets/、fonts/、source/（导入证据）
```

- **DESIGN.md** 实测九段式（apple/claude/airbnb 一致）：Visual Theme & Atmosphere → Color Palette & Roles → Typography Rules → Component Stylings → Layout Principles → Depth & Elevation → Do's and Don'ts → Responsive Behavior → **Agent Prompt Guide**（速查色表 + 示例指令 + 迭代顺序）。官方明确"**不是固定 schema**"，guard 只要求 ≥7 个实质性 H2 且散文与 tokens.css 数值同步。
- **tokens.css 四层契约**（`packages/contracts/src/design-systems/token-schema.ts`）：A1-identity/A1-structure（品牌必填）→ A2（有默认值仍强制声明）→ B-slot（别名槽）→ C-extension（白名单品牌私有）。强制全量声明的原因：产物是单 `<style>` 粘贴模型，没有全局级联兜底。
- **注入顺序即约束力排序**（`system.ts:1120-1177`）：USAGE 路由 → DESIGN.md 全文（"authoritative, do not invent tokens"）→ tokens.css（"binding contract, no raw hex outside :root"）→ 组件清单/fixture → 按需 pull 文件索引（省上下文）→ craft 手艺规则（**品牌赢 token 值，craft 管怎么用**）→ 技能/模板正文。
- **选中优先级**：本次 run 显式选 > 插件快照 > 项目已存 > 全局默认；项目选了 "None" 就不偷偷套默认；web-clone 任务整体豁免。

### 6.2 技能与模板（SKILL.md）

- 最小单元 = 目录 + `SKILL.md`（YAML frontmatter + Markdown 工作流正文）；可选 `assets/`（种子模板）与 `references/`（layouts.md / checklist.md）。
- `od:` 扩展块：`mode`（七值）、`surface/platform/scenario`、`preview.type`、`example_prompt(+i18n)`、`design_system.requires`、`craft.requires`、`critique.policy` 等；无 `od:` 块的 Claude Code 技能零配置可用。
- **运行期 staging**：spawn 前把技能目录**真实拷贝**到 `<项目cwd>/.od-skills/<name>-<hash>/`（写屏障），提示里广告双路径，并有硬性预检（"先 Read template.html/layouts.md/checklist.md 再做任何事"）。
- 模板与技能同构、两个注册表（`/api/skills` vs `/api/design-templates`）；**模板被选中即成为项目主 `skillId`，其工作流正文注入**——不是填空骨架。重模板（html-ppt：36 主题 + 31 布局 + 27 动画）的守则是"永远从模板起步、用 token 不用字面色、不发明新布局文件"。

### 6.3 ArtifactManifest（normal artifact sidecar）

`<entry>.artifact.json`（`packages/contracts/src/api/artifacts.ts:94-134`）：

- `version: 1`；`kind ∈ html|deck|react-component|markdown-document|svg|diagram|code-snippet|mini-app|design-system`；`renderer` 同构枚举（deck 用 `deck-html`）；`exports ∈ html|pdf|zip|jsx|md|svg|txt`；`entry`（相对路径，禁穿越）；`title/supportingFiles/sourceSkillId/designSystemId/metadata(≤16KB)`；插件溯源字段组（snapshotId/taskKind/renderKind/handoffKind/exportTargets…，未知读者必须保留）。
- 写入边界带 **publication guard**（HTML 含模板占位符如 `$X.XM` 直接 422）与 **stub guard**（同 identifier 新文件明显缩水被拒）——防 agent 倒退交付。
- 前端**渲染器注册表**是纯函数线性匹配（`apps/web/src/artifacts/renderer-registry.ts`），manifest 缺失可按扩展名+文件名启发式推断。

### 6.4 Live Artifact

- 目录形存储 `项目/.live-artifacts/<la-slug>-<12hex>/`：`artifact.json / template.html / data.json / index.html(派生) / provenance.json / refreshes.jsonl / refresh.lock.json / snapshots/`。
- 刷新协议：文件锁 → 单调序号（防旧写覆盖新）→ 执行数据源（connector 只许只读工具）→ 声明式 outputMapping → bounded JSON 校验 → 原子提交；**失败旧预览不动**，只追加审计日志。
- 服务端模板引擎 `html_template_v1`：Mustache 风格**全转义**插值 + 唯一结构指令 `data-od-repeat`（一层）；**预览 CSP 完全禁脚本**。理念："**改数据不找 agent，改样式才找 agent**"。

### 6.5 版本与持久化

- `.file-versions/<sha256(fileName)前24位>/manifest.json + 0001-<uuid>.<ext>` 快照；每版本记录**触发它的用户 prompt 原文**——版本史即迭代史；恢复以 `restoreFromVersionId` 写**新版本**。
- 消息持久化在 SQLite `messages.events_json`（瞬态流事件不落库）；SSE 协议有版本号 `CHAT_SSE_PROTOCOL_VERSION = 1`；所有磁盘 schema 自带 `schemaVersion`，解析失败即丢弃不迁移。（对照 Artemis 的"版本化 envelope + 幂等 reducer"不变量：OD 更松散，Artemis 应保持自己的更严标准。）

### 6.6 共享资产契约

设备外框（iPhone/Pixel/iPad/MacBook/浏览器窗）是像素精确自包含 HTML，**唯一接口 `?screen=<path>`**；项目不复制 frame 文件、指向共享 assets 目录——这是"避免 agent 重画设备壳"的机制。

---

## 7. 工程与交互设计模式提炼

1. **提示栈分层组装**（`composeSystemPrompt()`，`system.ts:791-1359`）：注入顺序 ~19 层，从注入抗性 → 模式 override → 发现/方向 → 记忆 → 设计系统 → craft → 技能 → 元数据 → 评审面板 → 防伪造角色标记守卫。**冲突时后段/显式 override 段赢**；slim 变体按 **prompt-caching 前缀规则重排**（静态章程最前、会话稳定居中、轮次可变信号最后），意图信号只扫用户亲撰文本并 latch，避免中途翻转打爆缓存。
2. **"assistant 文本内嵌标记 + 宿主解析"协议族**：`<question-form>`、`direction-cards`、`<CRITIQUE_RUN>`、`<od-card>`（task-brief/verify-scorecard/rule-proposal 三钩子）——结构化交互不依赖特定 agent 的工具能力，任何 CLI 都能走。
3. **composer 状态机**：chip → 场景插件 → 字段集 → 示例卡，全部内联展开；表单渲染在底栏而非模态。
4. **数据规格而非子类的适配器**：`RuntimeAgentDef` 是纯数据对象（argv 构建/流格式/解析器指针/超时），没有 `run()` 方法；新增 agent = 加一个 def + 数组一行。
5. **push 轻、pull 按需的上下文预算**：设计系统只注入核心三件 + 文件索引，重文件（components.html 全文、preview 页）留给 agent 用 `od tools design-systems read --path` 按需拉，daemon 白名单校验路径。
6. **蒸馏闭环**：网站实测提取（强提示词反"LLM 均值回归"：每个值必须能溯源到页面上测到的东西）→ 结构化 brand.json → 确定性 engine 派生 → 注册为可复用 DS；以及从项目会话反推 DESIGN.md 的固定结构（Summary/Brand & Voice/IA/Components/Visual System/Open Questions/**Provenance**）。
7. **写边界守卫**：publication guard / stub guard / sidecar 原子写 / 版本恢复非破坏——所有"agent 可能倒退"的地方都有程序化防线，且防线失败会**回喂 agent 自纠**（lint-artifact 的 anti-slop 检查）。

---

## 8. 对 Artemis「composer 设计模式 → 设计面板」的映射建议

> 以下是基于本调研的借鉴建议，供提案讨论；需对照 Artemis 架构不变量（AGENTS.md）取舍。

### 8.1 入口：composer 上的"设计模式"

| OD 做法                                                             | Artemis 映射                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SessionModeToggle 三档（chat/plan/design）+ 成本信号条 + 悬停说明卡 | Artemis composer 已有模式体系（Plan/Execute 等），设计模式可作为同级档位；**成本/耗时预期信号条**是低成本高感知的照抄项 |
| 模式 = 系统提示 override 段，随下一条消息生效，不重绑运行中进程     | 与 Pi 唯一循环不变量完美兼容：**design mode = Pi 的一个 session mode + 设计提示栈**，绝不是第二个编排框架               |
| 意图 chip rail（场景卡）+ 媒体面字段内联展开                        | 设计面板首屏的"要做什么"选择器：原型/组件/动效/图标…每个意图绑定默认提示包与表单字段（比例/平台/保真度）                |
| 自由输入也有隐藏默认场景兜底，绝不跑裸 agent                        | 设计模式的默认提示包应覆盖未选意图的自由输入                                                                            |

### 8.2 面板：进入设计模式后的布局

- **左会话右工作台可拖分栏**（OD：460px 默认/345-720 范围/8px handle/专注模式）是经过验证的范式；Artemis 可复用现有对话栏 + 新增设计工作台区。
- **产物卡片 → 工作台 tab**：消息流产物一点开 tab；iframe 保活池保证切回秒开。
- **预览安全模型对齐**：OD 沙箱 iframe（无 same-origin、按需升级、宿主桥全 postMessage）与 Artemis "Browser 不暴露 Node/本地文件"不变量同向；srcDoc 注入桥 + `od:` 前缀消息协议可直接参考。
- **评审剧场模式**：独立挂载组件 + SSE 驱动 + idle 不占位，适合 Artemis 的设计评审面板（若做）。

### 8.3 协议：结构化交互

- **question-form 协议**最值得移植：控件级类型 + 默认值预填 + 5 题上限 + 稳定枚举 id 回传。Artemis 已有 `@artemis/protocol` 与版本化 envelope，应把表单/方向卡定义为 protocol 事件而非裸文本解析。
- **direction-cards 同构数据**：方向（OKLch 色板 + 字体栈 + posture）既是用户点选卡又是 agent 的 CSS-ready `:root`——一份 `@artemis/protocol` 类型即可双端消费。
- **critique wire protocol** 的收敛规则（阈值 + MUST_FIX=0 + 字节递减 + 强制分歧 + 宿主重算分数）可整体借鉴为设计评审门槛。

### 8.4 内容：品牌契约与资产

- DESIGN.md + tokens.css 三层包与 Artemis 现有 ZCode 令牌迁移工作（见仓库既有记忆/文档）同构；OD 的**四层 token 分类学 + 晋升路径**与"散文↔token 不漂移 guard"是成熟参考。
- 用户已有 open-design 的 `design-systems/` 品牌令牌库，提案可考虑直接消费同构格式（apple 等 151 包现成）。
- **craft/ 手艺层**（anti-AI-slop、typography、a11y baseline 等品牌无关规则，按需点单注入、品牌冲突时品牌赢）是低成本高收益的设计质量下限机制。
- **共享设备外框 `?screen=` 契约**解决"agent 重画手机壳"这一顽疾。

### 8.5 风险与注意

- OD 的模式差异靠巨型提示栈（完整栈数千 token），Artemis 需评估 Pi 上下文预算；OD 自己也在做 slim 变体 + 按需 pull，建议首版就按"push 核心、pull 重文件"设计。
- OD 的消息持久化没有 Artemis 严格（无幂等 reducer），**Artemis 应保持自己的版本化 envelope 标准**，只借协议形状不借持久化松散度。
- 本地 checkout 停在 2026-07-31（v0.16.1），上游迭代快（Issues/PR 活跃），引用具体行号前建议刷新对照。

---

## 附录：关键路径速查

| 主题                       | 路径                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| UI 根组件 / 微路由         | `apps/web/src/App.tsx` / `apps/web/src/router.ts`                                                                                    |
| Home composer              | `apps/web/src/components/HomeHero.tsx`（hero）、`home-hero/chips.ts`（chip 表）、`home-hero/media-surfaces.ts`（媒体面字段）         |
| 会话模式切换               | `apps/web/src/components/SessionModeToggle.tsx`                                                                                      |
| Studio 骨架                | `apps/web/src/components/ProjectView.tsx`（split 分栏 :479-492, :8499+）                                                             |
| 会话面板 / Studio composer | `apps/web/src/components/ChatPane.tsx` / `ChatComposer.tsx`                                                                          |
| 工作台 / 预览器            | `apps/web/src/components/FileWorkspace.tsx` / `FileViewer.tsx` / `IframeKeepAlivePool.tsx`                                           |
| 系统提示组装               | `apps/daemon/src/prompts/system.ts`（:791-1359）、`discovery.ts`（发现/方向规则）、`directions.ts`（方向库）、`panel.ts`（评审协议） |
| 技能注册/暂存              | `apps/daemon/src/skills.ts`                                                                                                          |
| Agent 适配                 | `apps/daemon/src/runtimes/`（`registry.ts` 26 def、`defs/*.ts`）、`docs/agent-adapters.md`                                           |
| MCP server                 | `apps/daemon/src/mcp.ts`（工具清单 TOOL_DEFS）                                                                                       |
| 设计系统解析/注入          | `apps/daemon/src/design-systems/index.ts`、`packages/contracts/src/design-systems/token-schema.ts`                                   |
| Artifact manifest          | `packages/contracts/src/api/artifacts.ts:94-134`、`apps/daemon/src/artifacts/manifest.ts`                                            |
| Live artifact              | `apps/daemon/src/live-artifacts/`（store/render/refresh-service）、`specs/2026-04-29-live-artifacts/spec.md`                         |
| 文件版本                   | `apps/daemon/src/project-file-versions.ts`、`run-html-version-snapshots.ts`                                                          |
| 导出                       | `apps/daemon/src/pdf-export.ts`、`deck-export.ts`、`apps/desktop/src/main/{pdf-export,deck-capture,artifact-export}.ts`              |
| 评审剧场 UI                | `apps/web/src/components/Theater/`、`docs/critique-theater.md`                                                                       |
| 模式文档                   | `docs/modes.md`（创建面 vs 注册表模式）、`docs/spec.md`、`docs/architecture.md`                                                      |
| 共享设备外框               | `assets/frames/`（`?screen=` 契约）                                                                                                  |
