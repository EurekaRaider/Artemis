# 实际界面反向同步 · 2026-09-08

本次以当前工作区中 Artemis **1.4.63 的实际 React/Electron 实现（含尚未提交的界面修正）**为依据，将已落地的结果回写到静态设计原型。主入口是 `artemis-ui.html`；组合样式版本 **v144**，工作空间脚本版本 **v144**。此前 09-06 交接中的抽屉遮盖布局、环境面板实底渐变、双行 Agent 等描述已被本记录替代。历史版本块保留供追溯。

## 当前设计约定

| 区域 | 当前实现与原型共用的约定 | 实现依据 |
|---|---|---|
| 侧栏 | 默认 280px、窄窗 250px；收起轨道 48px；轨道及悬停抽屉从 y=48 开始；底栏 44px | `project-sidebar-layout.ts`、`prototype-migration.css` |
| 悬停展开 | 统一 200ms 防抖；展开后占用完整侧栏宽度，对话及输入框随之右移；移出即开始收回；抽屉横移 560ms，淡入淡出 420ms；固定/收起 640ms | `App.tsx`、`prototype-migration.css` |
| 固定按钮 | 鼠标能从月亮横移到右侧按钮并固定；可点击品牌区域不作为 macOS 拖动区；隐藏区域与轨道互斥 `inert` | `App.tsx`、`prototype-migration.css` |
| 标题栏 | 高度 48px；模拟红绿灯位置 x=18、y=17；折叠态面包屑左侧留出 104px | `main.ts`、`prototype-migration.css` |
| Dock 响应式 | 对话最小 320px、分割热区 7px；Dock 最小宽度随视口为 440/380/320px；≤820px 转为覆盖工作区的全宽工具面板，关闭后恢复对话 | `workspace-dock-layout.ts`、`packages/ui/src/styles.css` |
| 窄输入区 | 容器宽度 ≤700px 时，审批及模型按钮收为 32px 图标入口，保留可访问名称与原菜单；初始窄窗直接呈现收起侧栏 | `styles.css`、`App.tsx` |
| 均匀玻璃 | 抽屉与环境面板统一为侧栏基色 78% + 透明，不再叠加纵向渐变；SVG 位移 22，结霜 6.5；轨道仍为 1.6 | `SidebarGlassFilters.tsx`、`prototype-migration.css` |
| 环境面板 | 宽 280px，圆角 14px，无外描边及内高光，仅 `0 8px 24px / 12%` 阴影；触发器底部 +18px，最终距标题栏下沿约 12px | `styles.css`、`prototype-migration.css` |
| 阅读区域 | 面板与对话/输入框保留 24px 安全间距；剩余阅读宽度不足 480px 时收起环境面板；滚动条仍在工作区边缘 | `EnvironmentPanel.tsx`、`styles.css` |
| Git 操作 | 自上而下为「变更 +N −N」「本地工作区」「当前分支」「提交或推送」；纵排、无按钮底板；固定 16px 图标列，8px 间距 | `EnvironmentPanel.tsx`、`EnvironmentPanelIcons.tsx` |
| 行数与图标 | 变更为加减文档图标，提交为圆环与横线；新增绿 `#42c878`，删除红 `#ef6464` | `EnvironmentPanelIcons.tsx`、`styles.css` |
| Agent 信息 | 主 Agent 保留短任务介绍；下方仅列其直接创建的代理/代理组，不将组内成员或更深层代理并列展开；组内成员从团队详情查看 | `environmentTopLevelAgents` |
| Agent 行 | 标题与状态同一行，长标题省略并以 tooltip 保留全文；无右箭头、无成员数及数字分隔符；图标使用实际 `ChildAgentIcon` 图形 | `EnvironmentPanel.tsx`、`ChildAgentIcon.tsx`、`styles.css` |
| 任务摘要 | 实际应用由所选模型生成中文至多 20 字摘要；标题原文保持不变；单行、悬停显示原文；原型展示预设短摘要，不调用模型 | `task-summary.ts`、`EnvironmentPanel.tsx` |
| 思考状态 | 上下指示灯均为 `#d97706`、2 秒同相位呼吸；相同状态文案及时间；停止后同时停止动画；减少动态效果时禁用呼吸 | `App.tsx`、`styles.css` |

上表的 renderer 文件位于 `apps/desktop/src/renderer/`；`main.ts` 位于 `apps/desktop/src/main/`，`task-summary.ts` 位于 `packages/agent-host/src/`。

## 原型交互与边界

- 「变更」打开审查 Dock；「提交或推送」打开现有演示对话框。勾选是否包含未暂存内容只改变提交范围行数，不改变环境面板的仓库总行数；演示提交完成后总行数同步更新。
- 环境面板中「UI 实现团队」及「布局检查」分别为直接团队与直接代理。团队详情里的「界面编排」「样式检查」为成员，不在环境面板中重复展示。
- 静态演示不连接文件系统、真实模型、Git 或账号；macOS 红绿灯是模拟元素，不能替代原生窗口测试。其它设置、资源中心及工具页的既有演示继续保留，不宣称其全部业务状态已与产品逐项验收。
- 09-06 的历史性能/对比度报告不作为 v144 的重新验收结果。

## 本轮验证

在本机静态服务 `http://127.0.0.1:4173/artemis-ui.html` 使用已安装 Chrome + Playwright 检查。覆盖深浅色 1280×800、980/768/390×680，环境布局与阅读安全区、悬停防抖及横移固定、灯光相位与减少动态效果、Git 与 Agent 详情入口。最终结果以本次任务回复为准。

复查时可运行目录内 `npm test`（需本地 Playwright/Chromium），或打开原型手动检查上述动作。此原型仍是设计评审资产，不是产品的打包输入。
