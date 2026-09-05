# Artemis 工作空间原型：编排与自检

更新：2026-09-05

## 交付范围

`apple-inspired-ui.html` 使用页面已有的按钮、标签、卡片、树行、表单、任务计划与消息组件重新组装主界面。`ui/index.css` 与 `ui/index.js` 是两个原型页面的共享组件入口；`component-tokens.css` 仅作兼容入口；`workspace-composition.css` 仅负责页面与子面板的组合布局。

默认值：方案 1（a）、浅色（light）、标准对比度（normal）。计划／执行／审查是独立的任务运行模式，默认保持执行。

## 与当前 Artemis 的结构对应

| 界面区域 | 实现依据 | 原型编排与入口 |
| --- | --- | --- |
| 主壳与任务树 | App.tsx、styles.css、project-sidebar-layout.ts | 活动栏 46px，侧栏默认 252px；1100px 以下为 44px／220px；项目与临时会话分组、搜索、折叠、调宽 |
| 会话与输入区 | App.tsx、ComposerContextBar.tsx | 会话独立滚动；底部依次为任务计划、项目／分支／模式上下文条、输入框及工具栏 |
| Dock 标签 | App.tsx 的 workspace-tab-bar | 统一注册 9 类面板；切换、关闭、重新打开、键盘导航、全部关闭后的四工具启动器 |
| 审查 | App.tsx 的 review-workspace | 左侧差异阅读器，右侧更改文件与筛选；Dock ≤620px 时上下排列 |
| 文件 | WorkspaceFilesPanel.tsx | 左侧文件内容／编辑区，右侧文件树；文件选择、筛选、编辑与页面内保存 |
| 浏览器 | App.tsx 的 WorkspaceBrowserPanel 入口 | 工具栏、地址、前后退、刷新和内置预览 |
| 阅读器 | App.tsx 的 MarkdownReaderPanel 入口 | 从文件打开，富文本／源代码切换 |
| 目标 | GoalEditorPanel.tsx | 顶栏目标入口，编辑、保存、还原和未保存状态 |
| 来源 | SourcesPanel.tsx | 环境浮层入口，附件、MCP 调用、Agent 来源分组 |
| Agent 团队与成员 | App.tsx 的 AgentTeamPanel／ChildAgentPanel 入口 | 环境活动入口，团队成员、消息、单 Agent 活动与结果 |
| 环境 | EnvironmentPanel.tsx | Git、Agent 活动、来源三组；分支选择、查看更改、提交表单 |
| 设置 | SettingsPanel.tsx | 通用、供应商、消息接入、Agent、执行权限、更新与诊断六个独立页；版本按钮直达诊断 |
| 资源中心 | ResourceCenter.tsx | 插件、Connector、MCP、Skill 对应独立内容区域 |
| 其他主导航 | TokenUsagePage、AutomationPage、ArchivePage | 保留对应的用量、定时任务和归档页面，补验页面切换与直达链接 |

当前桌面主窗口最小尺寸来自 `apps/desktop/src/main/main.ts`：980×680。低于该宽度的网页预览采用单面板覆盖布局，作为原型的窄屏补充适配；不宣称它是现有桌面产品的布局。

## 自检

可复现检查：

```sh
node docs/ui-prototype/tools/workspace-check.mjs
```

需本地可用的 Playwright 和 Chromium。默认截图及 JSON 结果输出到 `/tmp/artemis-workspace-check`，也可用 `ARTEMIS_UI_CHECK_OUTPUT` 指定目录。

检查覆盖：

- 默认外观与上下文条的容器顺序。
- 9 类 Dock 面板入口、唯一可见面板、标签关闭／重开、键盘导航。
- 文件编辑与筛选、目标保存与还原、审查筛选与文件切换、浏览器地址与历史。
- 环境浮层、嵌套提交对话框与 Escape 返回。
- 6 个设置页、键盘焦点循环及关闭后返回入口。
- 4 个资源分类与另外 3 个主导航页面。
- 1440、1280、1024、980、768、390×900，以及最小桌面窗口 980×680。
- 页面无横向溢出，输入框和工具栏控件均在容器内，工具面板位于视口内。
- 独立验证 3 方案×2 主题×2 对比度的背景、正文、强调色、卡片圆角与组件库一致，以及系统主题同步。
- 主界面、环境、文件、设置和窄屏截图复核；无 JavaScript 异常；`git diff --check` 通过。

## 预览

打开 `apple-inspired-ui.html`，需保留同目录的 `ui/`、`workspace/` 和样式文件，或使用单文件导出工具。工具栏的 `+` 打开审查／终端／浏览器／文件；顶栏目标按钮打开目标；环境按钮打开来源与 Agent 入口。设置 → 通用可切换外观。

支持 `#tab=review|terminal|browser|files|goal|sources|markdown|team|agent`，以及 `#view=resources|token-usage|automations|archive`。`#audit=1` 生成隐藏的 `LAYOUT_OUT` 布局结果。

这是静态交互原型。文件、目标、消息、分支和提交表单等操作只影响页面演示状态；浏览器展示内置预览，不执行网络导航；不连接真实工具、模型或 IM。检查结果不替代 Electron 集成测试或打包验收。


## 组件库接入记录

共享运行时已接管菜单/选择器、Popover、Tabs、Dialog、SplitPane、Switch、Toast 和折叠控件；任务计划与目标编辑器使用 `ArtemisPatterns`。工作台按钮与表单统一使用组件库的 compact 尺寸变体。

新增 `tools/library-check.mjs` 覆盖既有70卡/23定向契约、独立实例、幂等挂载、销毁后重新挂载、嵌套 Esc、目标保存失败及迟到结果、12组主题一致性、悬停文字对比和脱离原目录的单文件导出。详细的本轮运行证据见 `ui/implementation-validation.md`。
