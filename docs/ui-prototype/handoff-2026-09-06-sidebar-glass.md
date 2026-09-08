# 原型改版交接说明 · 2026-09-06 晚（拉取上游之后）

> **历史快照。** 实际应用已完成迁移并根据后续反馈修正；当前原型 v144 已反向同步这些结果。若本文与 [2026-09-08 实际界面同步交接](handoff-2026-09-08-production-sync.md) 冲突，以后者为准，尤其是悬停侧栏让位、78% 均匀玻璃、无边框环境面板与 Agent 层级。

> 交接对象：接手 `docs/ui-prototype/` 的队友 agent。
> 本次会话范围：v113 → v143（全部落在 `workspace-composition.css` 版本块 + `artemis-ui.html` 内联资产 + `workspace/workspace.js` 少量改动）。
> 运行方式：`docs/ui-prototype` 下静态服务（如 `python3 -m http.server 4173`），打开 `http://127.0.0.1:4173/artemis-ui.html`。

## 0. 当前版本快照

| 文件 | 版本参数 | 说明 |
|---|---|---|
| `workspace-composition.css` | `?v=143` | **本会话主战场**，v113–v143 全部追加在此（append-only 版本块，块首注释即变更记录） |
| `workspace/workspace.js` | `?v=128` | 动效门控、peek/snap 事件流、默认宽度 280 |
| `workspace/workspace.css` | `?v=158` | **本会话未动**，仍是样式权威层（v105 注释约定） |
| `ui/index.css` | `?v=127` | 未动 |

**纪律**：改 composition.css 后必须 bump html 里的 `?v=N`（有次替换没匹配上导致掉档到 v=141，交接后注意核对）。层级顺序：workspace.css → composition.css → ui/index.css，后者同名同特异性覆盖前者。

## 1. 本次改版主线（按用户需求顺序）

### A. 顶部穿透（v113–v114）
- 借鉴 EasyReading（`~/Documents/EasyReading`）：`titleBarStyle: hiddenInset` + 红绿灯浮于内容之上。原型用 `.titlebar-lights`（HTML 内，pointer-events:none）模拟。
- 展开态：左侧栏背景直通 y=0，`.sidebar-top` 顶部避让 38px（v113）。
- 右侧顶栏曾试 108px 高，被否，**回调 ZCode 实测 48px（h-12）**，会话信息恢复左置面包屑（v114）。

### B. 收起态几何（v115–v120）
- 顶栏在收起态左延至 x=0（负 margin -48px），红绿灯落在单色块上（v115）。
- 极简栏（rail）成圆角浮岛：y=48 到窗口底、右侧圆角 12px、上贴顶栏下贴底（v115/v116）。
- **v118 是关键勿动**：`body.sidebar-collapsed .sidebar{background:var(--bg)}` 把车道铺实底。真因是 `body::before`（workspace.css:5046，z:-1 的全屏 accent 径向渐变）会透过透明车道在圆角缺口处渗出灰晕。**不要把车道改回透明**，玻璃在实底上成像。
- hover 抽屉（peek drawer）与浮岛同高带：`top:48px`、右缘同款圆角/描边/投影，横向整条推出（v120）。

### C. 液态玻璃材质（v122–v127，被否过程也在内）
- v122 纯渐变假玻璃 → 用户否（"我想要液态玻璃材质"）。
- v123–v125 真·SVG 位移折射 + 车道光影衬底 + 颗粒 → 用户否（"污、不干净"）。教训：**单色系设计（--accent=#171717 近黑）里，斜阴影带/光池/噪点颗粒都读作脏污**。
- **v126/v127 终版（现行）**：均匀液态。配方 = 一条柔和纵向光泽渐变（0.34→0.10@38%→0@62%）+ 通透基底（rail 40%/暗 46%）+ `backdrop-filter:url(#railGlass)` + 亮缘 rim（顶 0.92 白）+ 浮岛投影 `0 1px 4px@0.05, 0 8px 24px@0.08`（暗 0.28/0.3）。
- 实测均匀度：亮色纵向极差 3、水平全平 246–249（主区 238）；暗色极差 10。

### D. SVG 折射滤镜（HTML 内联，v123/v129/v138）
`artemis-ui.html` `<body>` 顶部隐藏 `<svg><defs>` 内三个滤镜，结构同为：
`feImage(位移贴图 data-URI) → feDisplacementMap(scale 22) → feGaussianBlur(结霜) → feComponentTransfer(提亮 0.04)`

| 滤镜 | 贴图 | 结霜 | 用途 |
|---|---|---|---|
| `#railGlass` | 48×672，16px 边缘带 | 1.6 | 收起态浮岛 |
| `#drawerGlass` | 260×672，18px 边缘带 | 1.6 | hover 抽屉（基底 58%/暗 55%，文字可读优先） |
| `#panelGlass` | 260×672（同 drawer 贴图） | 6.5 | 环境浮层（重雾） |

要点：
- **feImage 子区域必须是 `x/y=8.3333%、width/height=83.3334%`**（默认滤镜区域 -10%..120%，贴图对齐元素本体）。
- 贴图 = 灰 128 底 + 四边 R/G 通道线性渐变带（编码折射向量），`preserveAspectRatio="none"` 拉伸。
- `backdrop-filter:url()` **仅 Chromium 支持**（Electron/IAB 均可）；CSS 里先写 `blur(20px) saturate(1.8) brightness(1.04)` 回退行，再写 `url(#xx)` 覆盖。
- 单色系没有可饱和的颜色，饱和滤镜无意义，用 feComponentTransfer tableValues='0.04 1' 均匀提亮。

### E. 展开态修复与精修（v128、v130/v131、v134）
- **v128**：`app-shell { grid-template-rows: minmax(0,1fr) }`。之前隐式 auto 行被侧栏内容撑到 803px > 视口 720，footer 被推出窗外 83px 且整页滚动。钉死后 project-tree 自带的 flex:1+overflow:auto 生效，footer 钉底。**勿删**。
- footer 54→44px（16px 底内距是给已不存在的活动栏对齐留的）；布局 `[设置][头像+名称] —弹簧— [版本][更新钮]`（v131 更正：版本+更新钮在右）。
- 会话搜索条全态隐藏（v130 展开态 → v134 全态含 peek 抽屉）。
- 默认宽度 260→**280**（`workspace.js` `UI.splitPane initial`，窄窗 250；restart-dance 兜底同步 280）。范围 208–420 不变。

### F. 交互时序（v121/v129、v130、v132/v136/v137、v143）
现行时序参数（都在 composition.css 版本块里，可整表调）：

| 动作 | 参数 |
|---|---|
| 展开↔收起（grid+顶栏） | 640ms `cubic-bezier(0.38,0.08,0.22,1)`，JS 门控类 `sidebar-anim` 挂 720ms（workspace.js） |
| peek 抽屉推出/收回 | 560ms 同曲线，淡入淡出 420ms（v143） |
| 开启防抖 | 悬停 200ms 后才动（drawer 与 rail 都是） |
| 收回方向 | 零延迟立即走 |

**频闪根治的坑（v136/v137，重要）**：EOF peek 规则（composition.css:372-375）用 `opacity + visibility` 双开关切 rail，但 **visibility 必须出现在 transition 列表里**（`visibility 0s linear 200ms`），否则鼠标一进图标瞬消、移出瞬回——这就是"频闪"的真身。且注意特异性：`body.sidebar-collapsed .sidebar:hover .sidebar-rail` 是 (0,4,1)，会压赢属性选择器规则 (0,3,1)，v137 用同形选择器+更晚位置夺回。**动这两块前先算特异性**。

其他机制（既有，未改名）：
- `sidebar-snap`：折叠点击后挂类（`transition:none !important` 硬压抽屉），下一次窗级 mousemove 移除——防点击后鼠标未动时 :hover 粘滞。测样式前记得先动鼠标清 snap。
- `data-sidebar-peek` 属性（JS mouseenter/mouseleave 维护）驱动抽屉/rail 显隐；EOF 规则 + `sidebar-anim` 门控（workspace.js syncNavigation 内 restart-dance：先钉旧值→强制回流→挂类→清钉，防 focus() 抢跑）。

### G. 行内按钮悬停显隐（v132）
项目行 `.acts`、分组行 `+项目/眼睛/收起` 改严格悬停显隐。压掉两条常亮路径：`:focus-within`（点击行后按钮焦点保持）和 `.project-item.active > .project-head .acts`（选中项目无条件显示）。键盘 `:focus-visible` 路径保留。

### H. 环境浮层 = 真机同步 + 实底液态（v135–v142）
- **布局/图标/按钮全部对照真机** `apps/desktop/src/renderer/EnvironmentPanel.tsx` + `EnvironmentPanelIcons.tsx` + `styles.css`（行号见下）。280px 宽、节头动作钮（Git 节 +项目、来源节 +来源）、`environment-setting-row` 行结构、分支控件（strong+chevron）、**PR 检查卡**（标题+外链+检查摘要+状态点）、Agent 活动行（彩色几何 agent mark + 双行文本 + ›）+ 汇总行。图标无缺库项：标准图标在 `packages/ui/src/icons.tsx` 均有，真机特有图标在 EnvironmentPanelIcons.tsx，原型按同路径内联。
- workspace.js 对 `#environmentBranch` 的两处 textContent 写入已改为写内层 strong（保 chevron）。
- **材质结论（数学，勿回退）**：半透明基底永远会透字——黑字白底对比 ~220，透率哪怕 6% 也残留 ~13 级灰差，正好是"看得见"。v142 用**不透明基底**：亮 `color-mix(in srgb, var(--bg-sidebar) 94%, white)`、暗 `90%, black`，透率归零。液态感由边缘折射（panelGlass 位移仍在）、光泽渐变、rim、阴影承担。这与 ZCode 浮层做法一致（用户提供了参照截图）。

## 2. 遗留事项（未做/待决定）
1. **真机 App.tsx 落地**：原型全部结论尚未回写 `apps/desktop/src/renderer/`。顶部穿透需移除 styles.css:129-140 的 28px 全宽 ::before 拖拽条、改 per-region drag + `trafficLightPosition:{x:18,y:20}`（main.ts 已有 hiddenInset on darwin）；Windows 保持原生窗框。
2. 对比度矩阵（v17 计划）未随新材质重跑。
3. peek 抽屉/浮岛基底浓度（40%/58%）与环境浮层（不透明）是三档，是否统一由产品定。
4. PR 卡的检查弹层（environment-checks-popover）、分支菜单（environment-branch-menu）真机有完整实现，原型只做了静态卡片，交互未接。

## 3. 验证协议（本会话踩过的坑，照做省时间）
- **像素取样为准**，视觉模型会看走眼；截图存 `~/.zcode/cli/artifacts/<sess>/call_*-tool-result-*.png`，PIL 直接采样。
- IAB（Chromium 146）每次调用指针重置 → mouseleave 会自动触发；hover 类验证必须在**同一个调用单元内**完成 move→wait→screenshot。
- 截图往返有 ~100ms 延迟，标"120ms"的帧实际落在 ~200ms+，容易把防抖期结束的正常淡出误判成瞬切（v136 误诊教训）。
- `getAnimations()` + 实时 computed 是判断"过渡是否真的带延迟在跑"的可靠手段。
- `color-mix` 在 background 简写末层时 backgroundImage 显示 `none` 是**正常的**（它落在 background-color），别误诊为不支持。
- 受限 Playwright 面没有 `locator.hover()`，用 `tab.cua.move({x,y})`。
- 程序化折叠用 `document.querySelector('#leftToggle').click()`；点击处理器会 focus() 抢跑过渡，restart-dance 已在 JS 内处理。

## 4. 版本块速查（composition.css 内可直接 grep）
v113 顶部穿透 / v114 顶栏回调 / v115-116 浮岛 / v117-119 灰晕排查与投影 / v120 抽屉同带 / v121 门控动画 / v122-127 液态玻璃迭代史（终版 v126/127）/ v128 钉底 / v129 抽屉液态+640ms / v130-131 footer+宽度+防抖 / v132 行按钮悬停 / v134 搜索条全隐 / v135-138 浮层液态迭代 / v139 真机同步 / v142 不透明基底 / v143 抽屉 560ms。
