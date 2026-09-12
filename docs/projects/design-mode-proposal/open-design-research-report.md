# Open Design 深度调研报告：在 Composer 新增「独立设计模式」进入设计面板

> 调研对象：`~/Documents/open-design`（v0.16.1，pnpm monorepo）
> 调研范围：composer 输入栏、设计模式（mode）体系、Studio 页面结构布局、设计技能/插件管线、daemon API、UI 设计系统
> 调研方式：5 路并行源码扫描 + 主线代码亲读交叉验证

---

## 0. 执行摘要（TL;DR）

你想做的「在 composer 新增设计模式来进入设计面板」，需要先知道三个关键事实：

1. **"模式"机制已经存在且相当完整**：`ChatSessionMode = 'design' | 'chat' | 'plan'`（`packages/contracts/src/api/chat.ts:39`），composer 里已有现成的模式选择器 `SessionModeToggle`，模式会切换系统提示词、持久化到会话、影响交付判定。**新增设计模式 = 给这个枚举加值 + 配套接线**。
2. **"设计面板"没有一个现成的一等组件**。最接近的是三类东西：(a) 右侧工作区的 tab 体系（有官方扩展点，"两行代码加一个 tab"）；(b) 悬浮在预览上的检查器面板（ManualEditPanel / InspectPanel）；(c) 左右两栏布局本身（chat + workspace，可拖拽）。
3. **代码库自己的建议（写死在注释里）是：不要轻易新增 sessionMode**。它是"系统提示词头部级开关 + UI toggle + 埋点 union"，改动面横跨 contracts/daemon/web 三个包约 18 处文件。如果你的"独立设计模式"更接近"一种新的生成玩法"而非"新的对话形态"，更轻的路径是走**场景插件 + chip + 新 tab 面板**的组合。

下面分维度展开，最后给两条可落地的方案路径。

---

## 1. 仓库结构与运行时拓扑

```
open-design/
├── apps/
│   ├── daemon/        Express 后端，127.0.0.1:7456（Express 5 + better-sqlite3 + spawn agent CLI）
│   ├── web/           Next.js 16（仅作壳）+ 自研路由 SPA，真正 UI 全在 src/
│   ├── desktop/       Electron 壳
│   └── landing-page/  Astro 营销站（与产品 UI 无关）
├── packages/
│   ├── contracts/     ★ 前后端共享类型 + 提示词组装 + 埋点枚举（唯一事实源）
│   ├── components/    @open-design/components 共享组件库（Button/Dialog/Input 等，极薄封装）
│   ├── agui-adapter/  AG-UI 协议适配
│   └── plugin-runtime/ 插件清单适配
├── plugins/           482 个插件（_official/ 下 460 个：scenarios/atoms/examples/design-systems/媒体模板）
└── deploy/            Docker Compose 部署
```

运行时拓扑（dev 模式）：

```
浏览器 ──→ Next.js dev (localhost:3000)
              │  /api/* /artifacts/* /frames/* rewrite
              ▼
          daemon (127.0.0.1:7456)
              │  spawn 子进程
              ▼
          agent CLI（claude/codex/opencode…）或 BYOK API 代理
              │  写文件到 <dataDir>/projects/<id>/
              ▼
          SSE 回流 → 前端刷新预览
```

鉴权：`OD_API_TOKEN` 存在时才启用 Bearer 校验，但 **loopback 直连直接放行**——本地 dev 零配置（`apps/daemon/src/api-token-auth.ts`，16 行）。

---

## 2. 功能全景（这个产品能做什么）

| 功能域 | 入口 | 说明 |
|---|---|---|
| 项目聊天（"Studio"） | `/projects/:id` → `ProjectView` | 核心工作面：左聊天右画布 |
| 首页创作入口 | `/` → `HomeHero` + chips 轨 | 自由文本 + 场景 chip（Prototype/Deck/Image/Video/HyperFrames/WebGL…） |
| 设计系统 | `/design-systems` | 品牌契约（DESIGN.md + tokens.css + components.html），注入生成管线 |
| 插件市场 | `/marketplace` `/plugins` | 460 官方插件，scenario/atom/skill/bundle 四类 |
| 任务/自动化 | `/tasks` | routines 定时任务 |
| Library | `/library` | 素材库（有 feature flag） |
| 品牌 | `/brands` | 品牌提取与 enrichment |
| 集成 | `/integrations` | agent CLI/MCP/HTTP 接入指南（"Use Everywhere" 弹窗——注意它**没有输入框**） |
| 媒体生成 | 工具箱/scenario | image/video/audio 走独立媒体契约 + provider 适配器 |
| HyperFrames | chip | 本地 HTML→MP4 渲染引擎，产物仍是 HTML |
| 导出 | 预览面板内 | PDF/PPTX/图片/archive |
| 部署 | 项目内 | deployments 表 + finalize 路由 |

---

## 3. 「模式」的四层正交概念（最重要的一章）

代码里"模式"这个词对应**四个互不相同的维度**，你的"独立设计模式"必须先决定挂在哪一层：

| 维度 | 取值 | 定义处 | 控制什么 |
|---|---|---|---|
| **sessionMode** 会话模式 | `design` / `chat`(UI 叫 Ask) / `plan` | `packages/contracts/src/api/chat.ts:39` | 整段系统提示词取舍：design=完整 artifact 宪章；chat=轻量问答（砍掉设计宪章/discovery）；plan=先产出可编辑 Markdown 计划文档再移交 design |
| **projectKind** 项目类型 | `prototype`/`deck`/`template`/`other`/`brand`/`image`/`video`/`audio` | `packages/contracts/src/api/projects.ts:9` | 默认场景插件路由、预览面板形态、是否走媒体契约 |
| **skillMode / od.mode** 技能输出面 | `prototype`/`deck`/`live-artifact`/`image`/`video`/`hyperframes`/`audio`/`design-system` | SKILL.md frontmatter；`apps/daemon/src/skills.ts:607` | 注入哪套生成契约（HTML 宪章 / deck 框架 / 媒体契约），决定独占预览面 |
| **taskKind** 任务场景 | `new-generation`/`code-migration`/`figma-migration`/`tune-collab` | 插件 schema enum | 场景插件的路由键 |

另有项目 metadata 修饰符（`intent: web-clone/live-artifact/wireframe…`、`fidelity`、`platformTargets`），首页 chips 就是靠这些修饰符**复用同一个插件**做出 wireframe/mobile 等"模式感"。

**关键架构约束（代码注释明确写出）**：
- sessionMode 三态是系统提示词头部级开关，接入成本高（daemon/contracts 两份镜像提示词组装器都要改，见 `apps/daemon/src/prompts/system.ts` ↔ `packages/contracts/src/prompts/system.ts` 的同步注释）；
- 若新模式是"媒体面"（不产 HTML），必须在提示词层跳过 HTML discovery 层并以专属契约为唯一权威（`prompts/system.ts:958` 注释解释了原因）；
- kind→插件默认表必须在 contracts 共享包，前后端不得各写一份（`scenario-defaults.ts:1` 注释）。

---

## 4. Composer 输入栏详解

### 4.1 两套输入实现（不共用）

| 表面 | 组件 | 行数 | 说明 |
|---|---|---|---|
| 项目聊天 | `ChatComposer.tsx`（经 `ChatPane` 挂载） | 5613 行 | 全功能 |
| 首页 hero | `HomeHero.tsx` | 5026 行 | **独立实现**，但复用 `LexicalComposerInput` 底层编辑器（L1554）和 `SessionModeToggle`（L1958） |
| 画板评论 | `BoardComposerPopover.tsx` | 小 | 只有 Textarea |

⚠️ "Use Everywhere" 浮窗（`UseEverywhereModal.tsx`，471 行）**没有输入框**，它是集成指南弹窗。

### 4.2 ChatComposer 输入栏结构（主 return 在 L2606 起）

```
.composer
└─ .composer-shell                     圆角卡片外壳（border + --radius-lg + --bg-fill-tertiary）
   ├─ PluginsSection                   顶部插件上下文条
   ├─ StagedRunContexts                已选 skill/plugin/MCP/附件 chips + DS 选择器插槽
   ├─ .composer-active-file            活动文件编辑提示条
   ├─ .composer-input-wrap
   │  ├─ LexicalComposerInput          Lexical 富文本（@mention 内联 token）
   │  └─ PlaceholderCarousel           空草稿轮播占位
   ├─ CaretFloatingLayer × 2           @ 弹窗 / / 弹窗（光标定位）
   └─ .composer-row                    ★ 底部工具栏（L2808）
      ├─ ComposerPlusMenu              "+" 菜单：附件/Library/Figma/引用项目/链接代码/设计系统/
      │                                子菜单 {connectors|plugins|skills|mcp|toolbox}（L46）
      ├─ leadingAccessory 插槽          如工作目录 pill
      ├─ footerAccessory 插槽
      ├─ SessionModeToggle             ★ 模式选择器（L3049）
      └─ .composer-send                发送/停止
```

**Floating bar**：chat tab 下 composer 通过 `createPortal` 钉到 `.chat-composer-fixed-layer`（`position: fixed; z-index: 45`，`ChatPane.tsx:2739-2752` + `chat.css:1044`），不随消息流滚动。

### 4.3 SessionModeToggle（`SessionModeToggle.tsx`，361 行）

- `MODE_META`（L17-65）：每模式定义 图标 + 成本档（low/medium/high 三格信号条 `ModeCostTag`）+ 9 个 i18n key（label/title/summary/solves/cost/costNote/query1-3）
- UI = 触发按钮 + 上弹 menu（`menuitemradio`）+ hover 时的 `ModeDescriptionCard` 说明卡（含示例问题列表）
- 样式在 `styles/chat.css:1476-1740`；窄容器 @container 折叠 label

### 4.4 提交数据流（端到端）

```
ChatComposer.submit()                    ChatComposer.tsx:2415
  └─ currentRunContextMeta()             L1146（skillIds/pluginIds/mcp/connector → RunContextSelection）
  └─ onSend → ChatPane → ProjectView.handleSend    ProjectView.tsx:4779
       ├─ BYOK 预检/余额门/排队
       ├─ userMsg 带 sessionMode          L4968
       └─ streamViaDaemon()              providers/daemon.ts:636
            └─ POST /api/runs            daemon routes/runs.ts:871
                 ├─ resolvePluginSnapshot 冻结插件快照（L938）
                 ├─ design.runs.createOrReuse（sessionMode 归一 runtimes/runs.ts:316）
                 ├─ 202 { runId }
                 └─ startChatRun(meta, run)   server.ts:4303
                      ├─ runSessionMode 解析（请求体 > 会话记录 > 'design'）L4370
                      ├─ composeSystemPrompt(...sessionMode) → 注入 CHAT/PLAN override
                      └─ spawn agent CLI
前端：EventSource GET /api/runs/:id/events（自动重连 + Last-Event-ID 续播）
  → 落盘文件 → 项目事件 → refreshWorkspaceItems → viewer 重新 fetch
  → onDone: selectAutoOpenTurnArtifact() 自动打开产物（ProjectView.tsx:5552）
  → resolveDesignDeliveryOutcome() 交付判定（仅 design 模式强制要产物，design-delivery.ts:77）
```

---

## 5. Studio 页面结构布局

### 5.1 布局骨架（只有左右两栏）

```
App.tsx
└─ .workspace-shell
   ├─ WorkspaceTabsBar            应用级 tab 条（类浏览器 tab，可拖拽，持久化 localStorage）
   └─ ProjectView                 /projects/:id
      └─ .split（CSS Grid 三列：chat 栏 + 8px 手柄 + workspace 栏）
         ├─ .split-chat-slot      ChatPane（消息流 + ChatComposer）
         │                        评论检查器激活时换成 .comment-left-host（320px 固定）
         ├─ .split-resize-handle  Pointer Capture 拖拽 + 键盘箭头（步长 16px）
         └─ FileWorkspace         右侧工作区
            ├─ .ws-tabs-shell     工作区 tab 条（Design System 固定 tab + Pages 菜单 + 打开的 tab + "+" 启动器）
            └─ .ws-body           tab 内容分发
```

- 布局常量集中在 `ProjectView.tsx:479-497`：chat 栏默认 460px（min 345 / max 720），工作区 min 400px
- 纯 CSS Grid（`shell.css:1381-1427`），无第三方分栏库
- 宽度持久化 localStorage `open-design.project.chatPanelWidth`；focus mode 单列全画布（`.split-focus`）
- **没有独立左 explorer 栏**——文件浏览器是工作区里的一个 tab（`DesignFilesPanel`）

### 5.2 工作区 tab 分发（`FileWorkspace.tsx:3619-3899`）

| tab | 组件 |
|---|---|
| `__browser__:n` | DesignBrowserPanel（Electron webview / iframe 降级） |
| `__design_system__` | DesignSystemProjectPanel |
| `__design_files__` | DesignFilesPanel |
| sketch 文件 | SketchEditor（Excalidraw） |
| `chat:<id>` | SideChatTab |
| `terminal:<id>` | TerminalViewer（xterm.js） |
| `live:<id>` | LiveArtifactViewer（preview/code/data/refresh-history 四子 tab） |
| 普通文件 | FileViewer → renderer 注册表分发 |

### 5.3 预览渲染（双 iframe 架构）

`HtmlViewer` 同时挂两个 iframe 二选一（`FileViewer.tsx:13379-13450`）：
1. **URL-load iframe**：`src=/api/projects/:id/raw/:file`，浏览器自拉子资源；需要跨源隔离时切 powered-preview 源
2. **srcDoc iframe**：`sandbox="allow-scripts allow-downloads"`，内容经 `buildSrcdoc()` 注入十几种 postMessage 桥（deck 导航/inspect 选取/评论/palette/手动编辑/快照…）

选路逻辑：`file-viewer-render-mode.ts:94` `shouldUrlLoadHtmlPreview()`。

### 5.4 现有"面板"族（悬浮于预览之上）

| 面板 | 位置 | 作用 |
|---|---|---|
| ManualEditPanel | `FileViewer.tsx:12094` | 手动编辑模式属性检查器：文本/href/src/样式/outerHTML 草稿 + 撤销重做，可拖拽浮动（985 行） |
| InspectPanel | `FileViewer.tsx:4417` | inspect 模式轻量 CSS 调节（颜色/padding/字号/圆角），postMessage 改 iframe，可序列化回源码 |
| CommentSidePanel/Dock | `FileViewer.tsx:3902/4300` | 评论列表，可 dock 预览右侧或 portal 进左栏 |

---

## 6. Artifact 类型体系

两套并行：

**(a) 文件型 Artifact**（`apps/web/src/artifacts/`）：
- `ArtifactKind`：`html | deck | react-component | markdown-document | svg | diagram | code-snippet | mini-app | design-system`
- 清单 `ArtifactManifest` 以 `<entry>.artifact.json` sidecar 持久化；无清单时按扩展名+文件名启发式推断（含 deck 嗅探）
- **RendererRegistry**（`renderer-registry.ts:90-108`）：硬编码有序数组 `[ReactComponent, DeckHtml, Html, Markdown, Svg]`，顺序即优先级；只有 markdown 支持流式部分渲染

**(b) Live Artifact**（daemon 托管的可刷新产物）：
- 契约 `packages/contracts/src/api/live-artifacts.ts`；存 `<projectDir>/.live-artifacts/`（artifact.json + template.html + data.json + refreshes.jsonl）
- daemon 安全模板渲染（`{{data.x}}` 插值 + `data-od-repeat`，禁 script/iframe）

注意：**"HyperFrames/deck/prototype/image" 不是 artifact kind，而是 projectKind 维度**（埋点枚举 `TrackingProjectKind`），HyperFrames 的产物仍是 HTML artifact。

---

## 7. 插件/技能管线（"设计模式"的另一条腿）

### 7.1 插件 = SKILL.md + open-design.json

- 规范：`plugins/spec/SPEC.md` + `docs/plugins-spec.md`（2434 行）+ JSON Schema `docs/schemas/open-design.plugin.v1.json`
- `od.kind`：`skill | scenario | atom | bundle`；启动时 `registerBundledPlugins()` 扫描 `plugins/_official/**` 注册进 SQLite（`plugins/bundled.ts:62`）
- 清单核心字段：`od.useCase.query`（`{{input}}` 占位 brief 模板）、`od.context`（skills/designSystem/craft/atoms）、`od.pipeline.stages[]`（`{id, atoms[], repeat?, until?}`——`until: "critique.score>=4 || iterations>=3"` 即 devloop 收敛条件）、`od.genui.surfaces[]`（声明式人在回路表单）、`od.inputs[]`（Apply 表单）、`od.capabilities[]`（信任能力）
- 注入提示词：`renderPluginBlock()`（`packages/contracts/src/prompts/plugin-block.ts:11`）渲染 `## Active plugin / ## Plugin inputs / ## Plugin atoms` 三块

### 7.2 run 生命周期

- `queued` →（客户端视角 start 事件后）`running` → 终态 `{succeeded, failed, canceled}`（`runtimes/runs.ts:20`）
- 退出码分类：`classifyChatRunCloseStatus()`（cancel→canceled；code 0 或已产 artifact 的干净退出→succeeded；否则 failed）
- **runs 不进 SQLite**：进程内 Map + `<dataDir>/runs/<id>/state.json` + `events.jsonl`；重启后 reconcile 标 failed
- pipeline runner v1 只发事件 + 管 GenUI，**实际执行由 agent loop 拥有**（`pipeline-runner.ts:4` 注释）——新管线靠提示词块引导 agent，不是硬编码执行器

### 7.3 Design System 注入

选择优先级：请求 `designSystemId` > 插件 `od.context.designSystem` > 项目绑定 > 应用默认（web-clone 显式跳过）。DS 存在时注入 `ACTIVE_DESIGN_SYSTEM_VISUAL_DIRECTION_OVERRIDE` 并**砍掉方向库**；教 agent 把 tokens.css 逐字贴进第一个 `<style>`；craft 规则冲突时品牌 token 胜出。

---

## 8. UI 设计系统（开发约定）

- **样式**：手写 CSS + `styles/tokens.css` 变量（唯一权威，203 行：颜色/圆角 6 档/阴影/动效/字体）。⚠️ **Tailwind 装了但没接线，全仓无 utility class**——不要用它
- **主题**：`:root` / `[data-theme="dark"]` / system 三态同在 tokens.css；accent 色可自定义（8 预设，`color-mix` 动态生成）；layout.tsx 内联 themeInitScript 防 FOUC
- **组件**：`@open-design/components` 极薄封装（forwardRef + 原生属性 + variant 联合类型）；Dialog 无 portal 无 Radix
- **图标**：`Icon.tsx` 自维护 SVG 注册表（93 个，联合类型约束）+ RemixIcon 字体；`lucide-react` 是死依赖
- **动效**：硬性约定——只用 `cubic-bezier(0.23,1,0.32,1)` ease-out，**禁止 ease-in**；进入 200ms/退出 140ms 非对称；禁 `scale(0)` 起跳；motion/react（v12）+ `src/motion.ts` 共享 variants
- **i18n**：`Dict` 接口类型先行，**19 个 locale 文件缺一个 key 就 typecheck 报错**；`useT()` + 点分 key；`pnpm i18n:check` 校验
- **状态**：无 zustand/redux/react-query——`src/state/*.ts` 裸 fetch（fail-soft）+ `src/hooks/` 标准范式（useState+useEffect+AbortController+refresh）+ SSE 推送 + localStorage 偏好（带 migration）

---

## 9. 落地方案：新增「独立设计模式」的两条路径

### 路径 A：新增 sessionMode（"在 composer 新增设计模式"的字面实现）

适合：新模式是**新的对话形态**（如"评审模式"、"自由画布模式"），需要专属系统提示词 + 模式级 UI 徽章 + 会话级持久化。

**必改清单（约 18 处，按层分组）**：

| 层 | 文件 | 改什么 |
|---|---|---|
| 契约 | `packages/contracts/src/api/chat.ts:39` | `ChatSessionMode` 加值 |
| 契约 | `packages/contracts/src/analytics/events/ui-click.ts:765` + `mappers.ts:14` | TrackingSessionMode + 映射 |
| 提示词（双份镜像） | `apps/daemon/src/prompts/system.ts` + `packages/contracts/src/prompts/system.ts:318` | 新增 `XXX_MODE_OVERRIDE` 常量 + `composeSystemPrompt` 分支，决定 discovery/charter 取舍 |
| 选择器 | `apps/web/src/components/SessionModeToggle.tsx` | `MODE_META` 加项 + `ModeCopyKey` 联合类型 |
| i18n | `src/i18n/types.ts` + **全部 19 个 locale 文件** | 每模式 9 个 key（typecheck 强制） |
| daemon 白名单 | `db.ts:1115`、`routes/project/conversations.ts:15`、`routes/project/index.ts:1042`、`runtimes/runs.ts:316`、`routes/runs.ts:1148`、`server.ts:4370` | sessionMode 归一化/校验白名单 |
| 行为分支（按需） | `runtime/design-delivery.ts:77`（是否要产物交付校验）、`ChatPane.tsx:1055`（nextStep 变体）+ `:4210`（消息徽章）、`HomeView.tsx:2006`（首页分流） | 模式行为差异 |
| 可选 | `apps/daemon/src/cli.ts:5955` | CLI `--mode` flag |

**"进入设计面板"的接线点**：模式切换后开面板有两个现成挂载方式——
- 在 `ProjectView` 监听 `activeConversation.sessionMode` 变化 → 调 FileWorkspace 的 tab API 打开你的面板 tab；
- 或在 run 完成回调（`onDone`，ProjectView.tsx:5552 的 `selectAutoOpenTurnArtifact` 同款位置）按模式自动打开。

### 路径 B：场景插件 + 新工作区 tab（代码库推荐姿态）

适合：新模式是**新的生成玩法/产物形态**，有独立交互面板，但对话形态仍是 design。

1. **插件**：新建 `plugins/_official/scenarios/od-<x>/`（SKILL.md `od.mode` + open-design.json：pipeline/inputs/genui/useCase.query）——daemon 重启自动注册，零代码改动
2. **入口**：`home-hero/chips.ts:89` 加 chip（`apply-scenario` 指向你的 pluginId）；composer 侧可挂 `ComposerPlusMenu` 的 toolbox 子菜单或 `DESIGN_TOOLBOX_ACTIONS`
3. **面板**（官方"两行"扩展点，`tab-launcher.ts:5-18` 注释明示）：
   - `workspace/tab-launcher.ts:77` `buildLauncherActions()` 注册入口
   - `FileWorkspace.tsx` `.ws-body` 分发加渲染分支（+ `src/types.ts:121-177` 新 tab id 前缀约定）
   - 若是固定根 tab（像 Design System）：仿 `__design_system__` 加常量 + tab strip 按钮 + `defaultRootTab`
4. **产物**（若新 artifact 类型）：`artifacts/types.ts` + `manifest.ts`（ALLOWED_KINDS）+ `renderer-registry.ts` 加 renderer + `FileViewer.tsx` 分发分支
5. **契约**（若新 projectKind）：`projects.ts:9` + `scenario-defaults.ts:55`（必须在 contracts，前后端共享）

### 决策建议

- 你的描述是"**新增设计模式 → 进入设计面板**"：如果"设计模式"对用户呈现为 composer 里的一个**可切换项**（和 design/chat/plan 平级），走路径 A，并用 §9-A 的接线点打开面板；
- 如果它更像一个**有专属输入参数和独立工作面的生成器**（如"品牌设计模式"、"自由画板模式"），走路径 B 更省事，且 B 的面板 tab 同样可以在 composer 里通过 + 菜单/toolbox 触达；
- A+B 可以叠加：sessionMode 控制对话行为，chip/tab 控制面板——现有 `plan` 模式就是这么做的（模式切 plan → 产物进 Design Files tab → nextStep 引导切回 design）。

---

## 10. 风险与注意事项

1. **两份镜像提示词组装器必须同步**（daemon 版 ↔ contracts 版），注释明确要求，漏一边会导致 CLI 路径和 BYOK 路径行为不一致
2. **i18n 是 typecheck 强制的**——加模式文案要一次性补 19 个语言（每个模式 9 个 key），否则过不了编译
3. **不要在 UI 里用 Tailwind**——体系不存在；样式一律 tokens.css 变量 + BEM 类/ CSS Modules
4. **runs 不落库**——若新模式需要"历史运行列表"跨重启可查，要新增 SQLite 表
5. **streamViaDaemon 有三处 run 消费循环**（ProjectView.tsx:3668/3872/4538），新增模式行为时注意三处一致性
6. **SessionModeToggle 挂在两个宿主**（ChatComposer L3049 + HomeHero L1958），加模式两边都会生效，但首页的模式状态是 HomeView 自己的 useState，与会话持久化是两套
7. 动效红线：禁 ease-in、禁 scale(0) 起跳、进入 200ms/退出 140ms

---

## 附：关键文件速查

| 主题 | 文件 |
|---|---|
| 模式类型源头 | `packages/contracts/src/api/chat.ts:39` |
| 模式选择器 | `apps/web/src/components/SessionModeToggle.tsx` |
| 输入栏 | `apps/web/src/components/ChatComposer.tsx`（5613 行） |
| Studio 页 | `apps/web/src/components/ProjectView.tsx`（布局常量 :479-497） |
| 工作区分发 | `apps/web/src/components/FileWorkspace.tsx:3601` |
| 新 tab 扩展点 | `apps/web/src/components/workspace/tab-launcher.ts:77` |
| 渲染器注册 | `apps/web/src/artifacts/renderer-registry.ts:90` |
| 提示词组装 | `apps/daemon/src/prompts/system.ts` ↔ `packages/contracts/src/prompts/system.ts` |
| run API | `apps/daemon/src/routes/runs.ts:871` |
| 插件规范 | `plugins/spec/SPEC.md` + `docs/schemas/open-design.plugin.v1.json` |
| 场景默认表 | `packages/contracts/src/plugins/scenario-defaults.ts:55` |
| 设计 tokens | `apps/web/src/styles/tokens.css` |
