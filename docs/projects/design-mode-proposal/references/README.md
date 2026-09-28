# references/ — OpenDesign 设计文档参考附件

来源仓库：`open-design`（本地 `/Users/nickyhuang/Documents/open-design`）
来源 commit：`ad9078b87c`（2026-09-11，main）
拷贝时间：2026-09-12

目录结构映射源仓库相对路径（`docs/…`、`specs/current/…` 原样保留；`apps-web-chat/AGENTS.md` 对应源仓库 `apps/web/src/components/chat/AGENTS.md`）。

## 阅读顺序建议

先读本目录下的 `opendesign-ui-design-interpretation.md`（调研解读，含全部结论与交叉引用），再按需要查原文。

## 文件清单

### 调研产出

| 文件 | 说明 |
|---|---|
| `opendesign-ui-design-interpretation.md` | 本次调研解读：产品定位、界面结构、聊天面板交互、画布直接操纵、错误 UX 五原则、设计理念总结 |

### 产品与架构层（docs/）

| 文件 | 说明 | 状态 |
|---|---|---|
| `docs/spec.md` | 产品基线：定位、五条核心赌注、目标用户、Non-goals | 已归档（2026-04-24），仅作概念溯源 |
| `docs/modes.md` | 新建项目六个创建 tab 的控件矩阵；"UI 分类权威源是代码"原则 | 当前 |
| `docs/architecture.md` | 总体架构；Filesystem 型 vs Text-artifact 型两种执行剖面；§3.6 文件预览双轨渲染 | 顶部有 Historical note，部分过时 |
| `docs/design/run-errors/error-ux-design.md` | **错误交互 UX 设计**（32 场景 S01–S32 + 五原则 + 按失败数据排的 P0–P2） | 飞书文档仓库副本 |
| `docs/design/run-errors/implementation-audit.md` | error-ux-design 的落地审计姊妹篇 | 配套 |

### 聊天面板规格族（specs/current/）

| 文件 | 说明 |
|---|---|
| `chat-panel-next.md` | **主规格**（~165KB）：24 组件 / 84 状态交付矩阵、壳子模型 11 条规则、D1–D57 设计决策、已知坑、明确不做什么 |
| `chat-panel-next-plan.md` | 交付计划：6 天排期、M1/M2 两个纠偏点、五块组件零依赖组装策略 |
| `chat-panel-manual-qa.md` | 人工验收判据（滚动/产物卡/执行记录/输入队列/澄清表单/错误态六组）+ 四条"看着像 bug 其实是对的" |
| `chat-stream-scroll-research.md` | 流式滚动调研：贴底状态机方案、手势意图/程序滚动/亚像素死区缺口清单 |

### 画布交互规格族（specs/current/）

| 文件 | 说明 |
|---|---|
| `manual-edit-direct-manipulation.zh-CN.md` | **直接操纵 v2.1–v2.7 全量修订**：选中/拖拽/行内编辑/取色器/裁剪/快捷键/六层体系/关键不变量（已交付） |
| `manual-edit-mode-requirements.md` | 手动编辑 v1 需求：四模式边界（Edit/Comment AI/Tweaks/Draw）、三栏布局、选中模型、八种补丁类型 |
| `studio-chat-visual-discovery.md` | 视觉发现方案（规划中）：动态提问、看图选风格目录、问题内联 Chat |
| `studio-chat-response-information-architecture.md` | 回复信息架构方案（规划中）：任务视图重组、展开/折叠策略 |

### 组件规约

| 文件 | 说明 |
|---|---|
| `apps-web-chat/AGENTS.md` | chat 组件分层（primitives → 业务组件 → runtime 纯函数）、`--chat-*` 样式接缝、降级形态与测试规约 |

## 未拷贝但文中引用的位置（回源仓库查）

- `docs/design/chat-mirror/` — 24 组件陈列镜像页与验收截图（HTML/图片资源，双击 `mirror-exec.html` 可开）
- 根 `README.md` / `QUICKSTART.md` — 用户可见行为的权威源
- 根 `AGENTS.md` — "Chat UI conventions"、"Asking the user questions" 等交互规约的权威条目
- `apps/web/src/runtime/chat/build-turn-blocks.ts`、`plan-pill.ts`、`apps/web/src/components/FileViewer.tsx`、`srcdoc.ts` — 解读中引用的代码锚点
