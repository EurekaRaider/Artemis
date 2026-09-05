# 提案：Artemis UI 组件库（`@artemis/ui`）构建方案

> 状态：**征求评审意见**。本提案获通过前不开始任何实现。
> 依据：discussion #76 方向 A 组件层原型（components.html，70 卡）、scanner v17 + T8/T9 证据链、已接受候选规范 #1/#9/#10′；基线 d0b7b9f。

## 1 · 背景与目标

方向 A 组件层目前以静态 HTML 原型 + 扫描工具链交付。本提案将其升级为桌面 renderer 的正式组件库：`packages/ui`（`@artemis/ui`），使 #76 的规范决议从「文档约定」变成「库的强制约束」——令牌由库发放、对比度由库内 CI 门把守、ARIA 模式由组件内置。

**不改变的事**：Pi 仍是唯一 agent loop；渲染层仍只消费 `@artemis/protocol`；库是纯展示层，零 Electron / Node / protocol 依赖（props 与回调进、事件出，协议对接留在 desktop 粘合层）。

## 2 · 技术栈对齐（依据当前仓库实况）

| 项 | 现状 | 库采用 |
|---|---|---|
| 框架 | React 19.2 + Vite 8 + esbuild | 同栈，workspace `packages/ui` |
| 语言 | TypeScript（typecheck 已入 CI） | TS strict，导出类型完整 |
| 样式 | 无既定方案 | **纯 CSS 变量 + `art-` 前缀类名**（不引 CSS-in-JS/Tailwind） |
| 测试 | vitest 4 + RTL 先例 | vitest + React Testing Library |
| 图标 | `@phosphor-icons/react` 已在依赖 | phosphor 映射优先，专有图标（Agent 标记等 8 个）自绘 SVG |
| 截图矩阵 | desktop 已有 `verify:screenshot-matrix` | 与库内对比度矩阵并联，不重复建设 |

## 3 · 令牌体系（落实决议 #9）

三层令牌，全部为 CSS 自定义属性，从 components.html tokens 区提取：

```
primitive（色板/字阶/间距/圆角原始值）
  └─ role（--accent / --accent-text / --danger / --on-success … 语义角色）
       └─ component（--art-btn-* 等组件级引用）
```

主题机制沿用原型已验证的属性作用域，无运行时成本：

```html
<html data-direction="a" data-theme="dark" data-contrast="high">
```

- **方向 A 为默认皮肤**；B/C 令牌目录保留，切 `data-direction` 即换肤，组件单套（待决策点 D1）
- 高对比度（`data-contrast="high"`）与暗色（`data-theme`）为正交维度，与扫描矩阵的 36 组合一一对应

## 4 · 组件清单与迁移顺序

| 里程碑 | 内容 | 原型来源 |
|---|---|---|
| M1 基础件 | Button、Avatar、Input、Textarea、Select、Switch、Badge、Icon、TokenChip | 令牌/基础/图标/输入区卡片 |
| M2 浮层件 | Dialog、Menu（斜杠/下拉）、Toast、Tooltip | 浮层区 + 已验证 ARIA 模式（tablist roving、Esc、焦点管理） |
| M3 复合件 | UserInputCard（倒计时/选项/自定义输入/结果态）、RunMode 下拉、Countdown 信号点 | 状态区/Artemis 专属区 |

复合件在库内只承载**展示状态与用户交互**，所有 agent 决策语义（超时采用推荐项等）由调用方决定——组件提供回调，不内置策略。

## 5 · 质量门（落实决议 #10′，库的核心差异化）

1. **对比度矩阵进 CI**：scanner v17 + fixtures 移植为 `packages/ui/tools/contrast/`，对库内 workbench 页（components.html 的 React 版，即全部组件的真实渲染）跑「方向 × 主题 × 对比度 × 三场景 = 36 组合」矩阵，`npm run test:contrast`，fail-closed 语义不变
2. **假阳性反例集即回归 fixtures**：渐变中段、组级 opacity 等反例永久保留，任何令牌/组件改动先过像素对照
3. **行为测试**：每个交互组件配 RTL 用例（键盘导航、焦点、回调），ARIA 断言取自原型已验证的选择器
4. **并联**：desktop `verify:screenshot-matrix` 继续负责整页级视觉；库级与页面级两层互不替代

## 6 · 落地路径与验收标准

| 阶段 | 交付 | 验收标准 |
|---|---|---|
| P0 骨架 | workspace + tokens.css + workbench 页 + scanner 移植 | 场景：CI 全量构建。正常：`build/typecheck/test:contrast` 全绿。异常：任一工具缺失时 CI 显式失败（fail-closed） |
| P1 基础件 | M1 全部组件 + RTL | 场景：workbench 渲染全部基础件。正常：36 组合矩阵 0 失败 + fixtures 13/13。异常：新增令牌未过矩阵则合并被拒 |
| P2 浮层件 | M2 + 焦点管理 | 场景：键盘完成 开→导航→提交→Esc 全流程。正常：ARIA 断言全过。异常：焦点丢失/穿透用例必须被 RTL 捕获 |
| P3 真实切片 | Settings 页（建议）以 `@artemis/ui` 重写 | 场景：桌面运行 Settings。正常：与原型视觉一致 + screenshot-matrix 通过。异常：渲染层依赖审计零 electron/node import |
| P4 铺开 | 其余界面按界面逐个迁移 | 每界面一个切片 PR；不出现跨界面大批量替换 |

P0–P2 完成并评审复核后，才进入 P3/P4（与「能力覆盖矩阵排在扫描器可信之后」同序）。

## 7 · 待决策点（请评审拍板）

- **D1** 方向 B/C：建议令牌保留进库（属性切换换肤），组件单套；若否，B/C 仅存档
- **D2** 发布物形态：建议仅 workspace 内部消费，不做 npm 发包与版本化仪式
- **D3** workbench 形态：建议库内自建 demo 页承接 components.html，不引入 Storybook（最小依赖）
- **D4** 既有界面迁移排期：本提案只到 P3 试点，P4 排期另行讨论

## 8 · 明确不做

- 不引入 CSS-in-JS、Storybook、Tailwind 或第二套状态管理
- 不把 Pi / `@artemis/protocol` / Electron API 拉进 `@artemis/ui`
- 规范未定稿前不迁移页面级界面（先库后页，避免二次返工）
- 组件不带产品文案（i18n 由调用方经 react-i18next 注入）

## 9 · 风险

| 风险 | 应对 |
|---|---|
| 扫描器选择器在真实组件树的覆盖差异 | 库不使用 Shadow DOM/iframe，扫描器按 DOM 顺序全局扫描不受影响；P1 起矩阵覆盖 workbench 全量组件 |
| 令牌迁移遗漏（原型手工 CSS → 库分层） | 以扫描矩阵与 fixtures 为回归门，遗漏即失败 |
| React 19 API 演进 | 锁定 19.2 现版本，组件不用实验性 API |
| 范围蔓延 | P4 前不动任何既有界面；每阶段验收不过不进下一阶段 |

---
附：本提案随 v8 证据包一并提交；通过后按 P0 启动，未通过前不开始实现。
