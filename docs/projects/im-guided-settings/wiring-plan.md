# 消息接入引导式设置 · 生产接线实施文档（wiring）

日期：2026-09-13。状态：**已拍板，施工中**。
分支：`codex/im-guided-settings-wiring`（自 main = 2e4fa18 切出）。

上游输入：

- 原型实现：`docs/ui-prototype/`（artemis-ui.html `#settingsPanelIm` + workspace.js imDecorate + workspace.css im-\*，13 检查块契约探针全绿）；
- 原型侧计划与完成记录：[plan.md](plan.md)（PT-1..PT-9 全部完成；PR-S1..S5、DOC-1/2 未做，由本文档接手）；
- 交互契约：[UX-CONTRACT.md](UX-CONTRACT.md)（D1-D4 决议、「临时会话」内置授权语义）；
- 生产现状：上游 5a71941 已重写 `ImSettingsPanel.tsx`（2418 行，ImNavigation 分 view 导航 + 向导态/管理态）。

## 0. 决议记录（2026-09-13 用户拍板）

| #   | 决议                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | **路线选方案 B**：ImSettingsPanel 整面板按原型结构全量重写——向导态五卡流 + 完成后概览 + 群协作第二流程；`ImNavigation` 分 view 导航与六步 `ImSetupGuide` 退场；`im-settings-panel.test.tsx` 与 `verify-im.mjs` 随重写适配（覆盖不降级）                                                                   |
| W2  | 分支名 `codex/im-guided-settings-wiring`                                                                                                                                                                                                                                                                  |
| W3  | PR-S3 空 scope 语义取**方案 a**：security.scopes 中某受众 `readPaths` 为空 = 该受众**可读整个项目根**；此时 `writePaths ⊆ 全集` 恒真、不受额外限制；`readPaths` 非空时 `writePaths ⊆ readPaths` 校验照旧。默认新 grant = `readPaths=[] + writePaths=[]`，即「可读整个项目、不可写任何文件」（与 D3 一致） |
| W4  | 「临时会话」：先核实 im-gateway 对无 grant 会话的真实行为，再以展示层内置行（checked + disabled、不占项目授权与默认项目逻辑）呈现；若需 gateway 改动，**先回报再动**                                                                                                                                      |
| W5  | pre-push 的 `verify:visual-convergence` 在 main 上已知损坏（另案未查），本分支推送按用户届时指示执行（此前惯例 `--no-verify`）                                                                                                                                                                            |

沿用 plan.md D1-D4：首次流程移除总开关（搬入完成后概览）、测试任务独立第 5 步 + 群协作第二流程、读范围默认声明 + Execute 才强制范围树、测试任务诚实版 V1。

## 1. 目标

1. 把原型的**五卡引导流**（①连接服务 → ②添加机器人 → ③绑定我的账号 → ④允许手机操作的项目 → ⑤发一条测试任务）与**完成后概览**接进真实 `ImSettingsPanel`（方案 B 全量重写），数据全部走真实链路：`window.artemis` 的 `getImStatus / getSnapshot / saveImSettings / manageIm`，持久化仍是 `im-service.ts` 的 `im.sqlite` 版本化信封，生产代码一行假数据不剩。
2. **识别并剥离原型模拟件**（处置清单见 §2），生产实现中不出现任何演示种子、假数据、假时序。
3. 补齐 plan.md 欠账的生产侧先行项 **PR-S1（状态枚举）、PR-S2（两阶段保存并启用）、PR-S3（空 scope 决议，已按 W3 拍板）**，作为④⑤卡体验的地基，在本分支一并交付。
4. 守住 AGENTS.md 不变量：渲染层零 Node/Electron import（`verify-ui-boundaries` 把关）、UI 只消费 `@artemis/protocol`、持久化事件版本化信封 + 幂等 reducer。

## 2. 模拟项处置清单（原型 → 生产）

### A. 直接丢弃——纯演示件，生产无对应物

| 类别                | 原型位置                                                                | 处置                        |
| ------------------- | ----------------------------------------------------------------------- | --------------------------- |
| 演示种子/场景重建   | `IM_SEEDS`、`imApplyDemo`、`imEpoch`（workspace.js:660-747, 2100-2115） | 不实现                      |
| hash 探针桥         | `#im-demo=` 参数、`window.__imApplyDemo/__imLocateCard`                 | 不实现                      |
| 演示场景面板        | `.im-simulation` details（7 场景 + 保存/启用失败开关 + 重置）           | 不实现；失败路径换真实错误  |
| 演示结果下拉        | ①启动 ok/port/register；②凭据 ok/bad/offline/permission/mismatch        | 换真实错误分支展示          |
| 「填入演示值」按钮  | `data-im-fill-demo`（workspace.js:3136-3142）                           | 不实现                      |
| 「演示」角标/文案   | `im-demo-tag`、notice() 的「（演示）」后缀                              | 不实现                      |
| 假时序              | 1s 启动、900ms 连接、10s 双轨等待、配对码 4:32 初始值                   | 换真实轮询 + 真实 expiresAt |
| beforeunload 脏守卫 | workspace.js:3203-3206（内存态专用）                                    | 不实现（生产有真实草稿态）  |

### B. 换真数据源——语义保留，底座替换

| 原型假数据                        | 生产真源                                                                |
| --------------------------------- | ----------------------------------------------------------------------- |
| 假项目列表（IM_SEEDS 写死）       | `getSnapshot().projects`                                                |
| 假范围树 `IM_SCOPE_TREE`          | `manageIm({action:"scope-entries"})` + im-security 受保护路径           |
| 假配对码 + 假倒计时               | `manageIm({action:"pair"})` 真实配对码 + `ImPairingCode` 真实 expiresAt |
| 假设备号 `dev-3f9a`               | `getImStatus().deviceId`                                                |
| 假配对请求/绑定账号/群/团队机器人 | 真实 `pairingRequests / bindings / spaces`                              |
| 演示轨道推进按钮（⑤/群流程）      | ⑤用 `im-task-created` 事件真实推进 + 诚实版用户自证（D4）               |
| 硬编码授权到期场景                | 真实 `expiresAt` 计算（30 天 + 续期）                                   |
| `data-im-open-project` 死链接     | 真实打开项目指引                                                        |

### C. 语义直接映射到既有生产机制

| 原型件                                            | 生产数据/动作                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ①卡 一键开启 / 就绪 facts（设备编号、运行方式）   | `manageIm({action:"setup-local"})`；`status.deviceId`；settings.gatewayUrl 判个人/团队            |
| ①卡 团队服务器表单（HTTPS-only 校验、凭据不落盘） | `manageIm({action:"register", url/deviceName/adminToken})`；切换团队先暂停确认（PT-2 语义）       |
| ①卡 连接诊断                                      | `manageIm({action:"admin", operation:"status"})` 现有 diagnostics                                 |
| ②卡 平台行 + 凭据三子阶段                         | 渠道凭据块：`admin connections` 推 Gateway 加密保存（本地不落盘）；`ImLegacyImport`；回调地址复制 |
| ②卡 阶段 3 平台侧自证勾选                         | 保留「我已完成」+「收发将在配对时验证」标注（不伪装系统检测）                                     |
| ②卡 团队机器人选用                                | 现有团队连接选择 + `PUBLIC_BOT_FIELDS` 公共字段回显                                               |
| ③卡 配对指令/复制/续期                            | `manageIm({action:"pair", requireConfirmation:true})`；Slack 无斜杠规则（imChannelConstraint）    |
| ③卡 配对请求批准/拒绝、绑定管理                   | `resolve-pairing` / `unpair`（解绑内联二次确认）                                                  |
| ④卡 项目列表/三档模式/审批/命令/网络              | `snapshot.projects` + `executionGrantSchema`（mode/approval/shell/network）                       |
| ④卡 范围树（可写⊆可读、受保护禁选）               | `scope-entries` + `imGrantSecurity` scopes（owner 受众）；受保护路径禁选                          |
| ④卡 临时会话内置行                                | W4：先核实 gateway 无 grant 会话行为 → 展示层内置行（checked+disabled）                           |
| ④卡 默认项目 / 30 天有效期                        | `defaultProjectId` / `expiresAt = now+30d` + 续期                                                 |
| ④卡 「保存并启用」两阶段                          | PR-S2 新组合入口（见 P2）                                                                         |
| ⑤卡 四段轨道                                      | `im-task-created` 事件 + 「我已收到回复」可撤销自证（D4）                                         |
| 概览 五分区 + 总开关                              | status 汇总 + `saveImSettings`（enabled）；D1 总开关新家                                          |
| 群协作四步第二流程                                | spaces view 能力（admin spaces、群确认指令、成员管理）打包为第二流程                              |

## 3. 目标面板结构（方案 B）

- **向导态**（五步未全完成时呈现）：面板头（设置进度 N/5、状态胶囊、断连恢复条）+ 五张 `im-card`（折叠态=一行摘要+编辑入口；展开态=该步骤完整交互）。总开关不出现（D1）。
- **完成概览**（五步全完成后呈现，重开直达不重跑流程）：五分区（消息服务/机器人/我的账号/项目访问/群协作）+ 总开关（暂停/恢复，暂停保留配置）+ 三态（配置完整/服务健康/测试通过）+ 「继续设置」定位最早缺条件步骤。
- **群协作第二流程**：同面板独立流程，入口在概览（及⑤完成态可选项）；顶部「返回单聊设置」。
- **derive 单一事实源**：五步完成态全部从真实 status 推导（①`deviceId`、②任一连接 connected、③bindings 非空、④grants 非空、⑤用户确认标记）；进度、徽标、级联回退（删连接→③④⑤回退）均由 derive 计算，与原型 `imDerive` 同构。
- **数据链路不变**：`window.artemis` 四 API + 既有 2s 轮询 + refreshEpoch 迟到作废机制。
- **文案双语言**：面板走 `locale` prop / i18n.ts，新文案中文为准、英文对照，不留硬编码单语言。
- **组件落点**：`ImSettingsPanel.tsx` 重写；新组件建议 `ImGuidedFlow` / `ImFlowCard`（×5）/ `ImFlowOverview` / `ImGroupFlow`；`styles.css` im-\* 区重组；`@artemis/ui` 组件（Button/Checkbox/Select/TextField/Dialog 受控惯例）不新造平行组件。

## 4. 计划步骤

> 纪律：每阶段独立成提交、面板保持可用、`npm test` + `typecheck` 全绿后才进下一阶段；提交前仓库根跑 Prettier；push 须用户确认（W5）。并行会话风险：git 操作前先查分支与工作树。

### P0 分支与基线（本文档落盘即完成）

- 切 `codex/im-guided-settings-wiring`；基线 `npm test` + `typecheck` 记录在案。

### P1 生产先行·状态与决议（S）

- **PR-S1 连接状态枚举统一**：收敛为 `unconfigured | saving | saved | connecting | connected | partial_error`，UI 与 store 同源（枚举定义落 `@artemis/protocol`，渲染层不再自造状态字符串）。
- **PR-S3 空 scope 方案 a 落地**（W3）：校验规则改为「readPaths 空 → writePaths 不受限；readPaths 非空 → writePaths ⊆ readPaths」；默认新 grant 空 scope = 根可读+不可写；决议同步 im-security 注释/README。
- 验收：①渲染层 grep 无枚举外连接状态字符串；②保存凭据与连接建立是两个可观察状态；③新增枚举流转断言；④writePaths ⊆ readPaths 回归断言保留；⑤desktop 测试全绿。

### P2 两阶段「保存并启用」（M）

- **PR-S2**：组合入口——先 `saveImSettings` 保存授权，成功后再启用；返回结构区分「保存失败（不发起启用）/ 保存成功·启用失败（仅重试启用）」。
- 验收：三场景测试（全成功 / 保存失败不启用、错误归表单 / 保存成启用败仅重试启用）；重试无重复副作用（无重复 grant）。

### P3 面板骨架全量重写（L，方案 B 主体）

- `ImSettingsPanel.tsx` 重写为向导态五卡流 + derive；①②③卡分别接 gateway / 渠道凭据 / 配对真实动作与真实错误分支；④卡先内嵌既有 permissions 逻辑（复用组件）、⑤卡先占位骨架；`ImNavigation` 与 `ImSetupGuide` 退场；SettingsPanel 集成点、隐藏 tabpanel aria 结构、<720px 紧凑态保留语义。
- 测试：`im-settings-panel.test.tsx` 按新结构重写，既有用例意图全量迁移（覆盖不降级：状态刷新、凭据跨断连保留、配对批准/拒绝/解绑、倒计时过期、紧凑键盘模型等）。
- 验收：向导态/完成态切换正确；进度 N/5 随真实状态更新；删连接级联回退；模拟件零残留（`apps/` grep 不到 §2-A 任何对应物）。

### P4 ④项目授权卡 + 临时会话（L）

- ④卡按 PT-5 设计重做：三档模式、默认范围声明行（W3 语义：「可读整个项目，不可写任何文件」）、Execute 强制真实范围树、执行审批、沙箱命令/网络（仅 Execute）、默认项目、确认摘要五要素、两阶段保存（P2 API）、30 天到期/续期接真实 expiresAt。
- 临时会话内置行（W4）：先核实 im-gateway 对无 grant 会话的实际行为并记录到本文档附录；行为符合则展示层内置行（checked+disabled），不符则先回报。
- 验收：范围树不变量（可写⊆可读、受保护禁选、Execute 未选范围禁保存）、摘要五要素、两阶段三场景全部落为 RTL 断言。

### P5 ⑤测试任务 + 完成概览 + 群协作入口（M）

- ⑤诚实版四段轨道（真实事件推进 + 「我已收到回复」可撤销、无「系统验证」字样）；完成概览（五分区 + 总开关新家 + 三态 + 继续设置）；群协作第二流程壳（复用 spaces 能力、四步引导）。
- 验收：概览重开直达；暂停后摘要带「已暂停」、配置保留；「继续设置」定位最早缺步（缺③/缺⑤两场景断言）；部分连接异常不连坐。

### P6 收尾（S）

- `npm run verify:im`（真实 Electron 端到端）按新面板结构适配并通过；PR-S4 决议落档、PR-S5 im-gateway README 三处修订、DOC-1/2 提案修订、README 提案状态更新；全量 `npm test` + `typecheck` + `verify:ci`。

## 5. 总验收（DoD）

1. 生产代码零模拟残留（§2-A 无对应物），面板所有状态可溯源到 `window.artemis` 四 API。
2. 架构门禁全绿：`verify-ui-boundaries`（渲染层无 Node/Electron）、协议只走 `@artemis/protocol`、持久化版本化信封不变。
3. 测试覆盖不降级：既有用例意图全量迁移 + 新增（枚举流转、两阶段三场景、范围树不变量、摘要五要素、级联回退、概览语义）；`npm run verify:im` 通过。
4. D1-D4 + W1-W5 决议在真机面板可观察成立。
5. 三方一致：本实施文档、im-gateway README、提案文档与最终实现无冲突。

## 6. 风险

| #   | 风险                                                   | 缓解                                                           |
| --- | ------------------------------------------------------ | -------------------------------------------------------------- |
| R1  | 全量重写体量大（2418 行面板 + ~30 用例 + 1874 行 e2e） | 分阶段提交（P3-P5），每阶段面板可用且门禁绿；e2e 适配集中在 P6 |
| R2  | 并行会话同仓库                                         | git 操作前查分支/工作树；不丢弃不明改动                        |
| R3  | 临时会话 gateway 行为未知                              | W4 先核实再实现，需动 gateway 先回报                           |
| R4  | verify:visual-convergence 在 main 上已坏               | W5：推送按用户指示；不在本分支顺手修（另案）                   |
| R5  | i18n 双语言文案量                                      | 中文为准、英文对照，P3 起随组件同步补齐，不留待收尾            |

## 7. 实施记录

### P1b PR-S3 空 scope 方案 a（已落地）

- `packages/protocol/src/im-security.ts`：`imDataScopeSchema` superRefine 改为——readPaths 为空（wholeProject）时 writePaths 不受 ⊆ 约束、filePaths 必须为空；readPaths 非空时两条旧不变量照旧。
- `apps/desktop/src/main/im-policy.ts` `authorizeImPath`：read 分支空 readPaths = 放行（受保护路径检查在前，仍拦截）；write 分支不变——**空 writePaths 仍 = 不可写任何文件**。
- `apps/desktop/src/main/im-sandbox.ts` `buildScopedImShellLaunch`：空 readPaths 时 seatbelt read 规则改为项目根 subpath；点文件/密钥 deny 规则照旧兜底。
- `ImDataPermissions.tsx`：默认态文案「整个项目（默认）」；读框在默认态显示全选、首次取消勾选即收窄为根级枚举（写范围随之裁剪）；默认态写框可选；「清除此范围」改名「恢复默认范围」。
- `ImSettingsPanel.tsx`：新勾项目即附默认 security（owner 受众，readPaths=[]/writePaths=[]，待确认）。
- `packages/agent-host/src/remote-tools.ts`：系统提示词明示「空 readPaths=整个项目可读；空 writePaths=不可写」。
- 测试：protocol 空 scope 三例、im-policy 全读不写一例、im-sandbox 根读 seatbelt 一例、im-security-ui 按新契约重写（默认全读/收窄/写⊆读）。
- **语义迁移说明**：已持久化的 `readPaths=[]` grant 由「全拒读」翻转为「整个项目可读」——此类 grant 此前运行时全拒、无法实际使用，翻转符合 W3/D3 默认语义，不做数据迁移。
- 门禁：仓库根 `npm test` 1664 通过 + `typecheck` 全绿。

### P1a PR-S1 连接状态枚举统一（已落地）

- `packages/protocol/src/im.ts`：新增 `IM_CONNECTION_STATES` / `ImConnectionState`（`unconfigured|saving|saved|connecting|connected|error|partial_error`，比 plan.md 原列六值多一个 `error`——单连接失败是真实存在的态，`partial_error` 只由聚合产生）与纯聚合函数 `imAggregateConnectionStates`（gateway 四值映射：`disabled→saved`；`[connected,error]→partial_error`；`[error,…无 connected]→error`）。gateway `ChannelStatus.state` 原始四值契约不动。
- `ImNavigation.tsx`：`imConnectionHealth` 改为委托聚合器；`imConnectionLabel` 覆盖七值（新增「保存中」「已保存，待连接」「部分连接异常」，删除连接语境的「已停用」）；新增 `imChannelConnectionState`（渲染层瞬态合并：`saving`=凭据 PUT 在途、`saved`=保存成功→下次刷新前的空窗）。
- `ImSettingsPanel.tsx`：凭据保存挂 `savingChannel`/`savedPending` 瞬态（成功刷新即清）；渠道胶囊与单连接行改用统一推导；`stateLabels` 显式类型化为 `Record<ImStatus["state"], string>`（服务生命周期态与连接生命周期态两轴分离）。
- `styles.css`：`im-dot` 新增 `saving`（warning+脉冲）与 `partial_error`（danger）样式，含 reduced-motion 分支。
- 测试：protocol 聚合器七例流转；panel 部分 failure 期望 `error→partial_error`；新增「保存≠已连接」两阶段用例（未配置→保存并连接→「已保存，待连接」→连接中→已连接）。
- grep 验收：渲染层连接状态字符串全部落在类型化枚举上（群成员在线态、remoteTasks 租约态为独立轴，不混用）。

### P2 PR-S2 两阶段「保存并启用」（已落地）

- 新模块 `apps/desktop/src/renderer/im-save-enable.ts`：`imSaveAndEnable(save, draft, current)` —— 阶段一按当前启用状态保存授权；已启用即单阶段完成；未启用则阶段二 `{...已保存, enabled:true}` 启用。返回判别联合 `{phase:"enabled"|"save-failed"|"saved-enable-failed", status?, error?}`。`imRetryEnable` 仅重发启用阶段（同一载荷重发，save 为整体替换语义，无重复 grant）。
- `ImSettingsPanel.tsx` permissions 区：原「保存项目授权」改为「保存并启用」组合入口；保存失败→错误归表单、不发起启用；保存成功启用失败→InlineNotice「授权已保存，连接未启用」+ 仅「重试启用」按钮；④区引导文案同步。
- 语义说明：组合入口总是把暂停中的服务重新启用（按钮文案即「保存并启用」，对齐原型④卡）；纯暂停/恢复仍走顶部开关，两者并存直至 P3 概览接管开关（D1）。
- 测试：三场景——保存失败（单次调用、无启用、错误可见）、保存成功启用失败+重试启用（授权载荷逐字不变、grants 仍 1 条、通知消失）、两阶段全成功（暂停态保存→自动启用，两次调用断言 enabled false→true）。
- e2e：verify-im.mjs 按钮名同步（全量适配在 P6）。

### P3 面板骨架重写·guide 态五卡流（已落地）

- **分区提取**：ImSettingsPanel 内 gateway / 渠道 / pairing / permissions 四个分区块原位提取为局部渲染函数 `renderGatewayBody/renderChannelBody/renderPairingBody/renderPermissionsBody`（闭包共享状态，零 props 穿线）；管理态 DOM 不变（既有用例零改动通过），guide 卡体与未来概览复用同一实现。
- **im-flow-derive.ts**：五步完成态只从真实 status 推导（①deviceId ②任一连接 connected ③identities 非空 ④grants 非空 ⑤localStorage 按设备存的用户确认——D4 诚实自证），`imFirstPendingStep` 驱动卡片自动展开；含 4 条单元测试。
- **ImFlowCard.tsx + styles**：可折叠步骤卡（num/title/summary/caret，aria-expanded）与进度胶囊；`.im-flow` 样式全用体系令牌。
- **guide 态**：五卡流替换旧 im-wizard（六步 ImSetupGuide + 平台差异卡 + 群入口卡退场——ImSetupGuide 文件保留，管理态 setup-guide 分区仍用，P5 一并退役）；②卡内平台选择 `flowSelectChannel` 留在流内只重置渠道编辑态；⑤卡 = ImFirstTaskInstructions 指令 + 「我已收到回复（可撤销）」确认；①-④就绪时⑤卡提供群协作入口（D2）。
- **header（D1）**：guide 态显示「设置进度 N/5」；总开关在 guide 态仅对已注册设备（回看场景）保留，未注册设备的首次流程无总开关；管理态 header 不变。
- **级联回退**：flowDoneKey 前后对比，已完成步骤回退时在 guide 态给一次性提示（derive 是单一事实源，回退自然反映）。
- **P3 妥协（P5 收口）**：①卡 setup-local 完成后仍 `selectView(channel)` 跳管理态渠道编辑；②③④卡内的深层链接（navigateStep/前往配对）仍跳管理视图；ready 自动进管理行为保留（完成后概览落地后改为 5/5 → 概览）。
- **测试迁移**：六步用例→五卡（0/5、五标题、D1 无开关、②约束、①一键）；ready 回看指引用例→进度 3/5 + ④自动展开；群入口用例→⑤卡（5/5 + 确认标记）；两处旧「绑定你的 IM 账号/连接一个机器人」导航点击删除（卡体自动展开直达）；新增级联回退提示用例；afterEach 清 localStorage 保证⑤确认标记不串测。

### P4 ④项目授权卡重做 + 临时会话（已落地）

- **W4 核实结论（2026-09-13）**：「已配对但 grants 为空」是合法可达状态，三条判定全部成立——(a) /help 无条件可用、/projects 给中文引导；(b) 普通消息走到项目选择逻辑，返回固定中文引导「请先 /projects 查看项目…」（非模型对话，不 500 不静默）；(c) /new 同路径明确拒绝。gateway 全程不看 grants（只查 identities binding，router.ts:153-177），配对独立于授权。**无需动 gateway**。两个已知小缺口（另案）：/status /stop /continue 拒绝文案是英文（protocol im.ts:418）；「临时会话」文案已按现状措辞为「可收发消息并获得指引」，不暗示模型对话。
- **临时会话内置行**：④卡项目列表首行，defaultChecked+disabled（不可取消），说明文案「不绑定项目的会话：可收发消息并获得指引；不授权任何项目文件」，不进 grants/默认项目状态。
- **三档模式**（D3）：任务模式 Select 换成三张 radio 档位卡（Plan 只读分析/Review 只读审查/Execute 允许修改），离开 Execute 自动清 shell/network。
- **范围显隐**（D3）：Plan/Review 默认只显示声明行「可读整个项目，不可写任何文件」（W3 语义），范围树收进「自定义范围 ▸」次级入口；Execute 强制展开范围树。
- **Execute 保存闸**：owner 受众 writePaths 为空 ⇒ 保存并启用禁用 + 警示；选中后恢复（含确认摘要五要素：项目/文件范围/回复对象/模式/30 天有效期，保存前可见）。
- 测试：内置行（勾选+禁用+不入 grants）；档位门控（Plan 声明行+树隐藏、自定义入口展开、Execute 树强制+未选可写禁保存+全选可修改后可保存+摘要五要素+切回 Plan 清 shell/network 落库断言）。

### P5 完成概览 + 群协作第二流程 + 导航退场（已落地）

- **P5a ⑤四段轨道**（提交 0f8ece6）：诚实版轨道——仅「桌面出现任务」由系统检测（`onImTaskCreated` 实时事件 + `remoteTasks` 存在性），「任务完成」「回复送达」随用户确认点亮，首段为指引文案；无任何「系统验证」措辞（D4）。
- **P5b 屏幕状态机**：`screen: "flow" | "overview" | "group"`（undefined 时按 5/5 派生落概览）；「完成即概览」为粘性；回退时停留概览并由三态与「继续设置」呈现。
- **完成概览**：三态胶囊（配置完整 N/5 / 服务健康（含部分异常与已暂停）/ 测试通过）+「继续设置」（回到流程并定位最早缺步卡）+「设置群协作」入口 + 五张与流程共用的步骤卡（同一 `renderStepCards()`，展开即编辑）。
- **总开关新家（D1）**：仅概览常驻；流程中已注册设备回看时保留；群协作屏与未注册首次流程不出现。
- **群协作第二流程**：`group` 屏 = 「← 返回单聊设置」+ `renderSpacesBody()`（spaces 分区已提取）；入口在概览与⑤卡（已配对即可见）；spaces 自动 admin/status 检测挂在 group 屏。
- **ImNavigation 退场**：组件与隐藏 tabpanel、`.im-layout`、setup-guide 分区、ready 自动进管理 effect（wasReady/enteredManagement/reviewing）全部删除；ImNavigation.tsx 仅保留工具函数与类型。旧分区目标经 `selectView` 兼容映射到对应步骤卡/群流程。
- **②卡平台选择行**：外包 span 携带 `data-connection-state`（Button 白名单不透传任意 data-*），并改用官方 `selected` 属性。
- **交互补丁**：保存启用失败时钉住④卡；④保存成功后自动前进⑤（重新展开④可继续编辑）。
- **测试迁移**：nav() 助手删除，新增 `openCard/platformCard/platformState/openGroupSetup` 助手；信号测试改查平台选择行 `data-connection-state`；~20 个管理态用例改走卡片导航；ready 用例改为「完成态直达概览」；tab 键导航改为卡头 Enter 切换；截图契约从 `.im-channel-card` 迁到 `.im-platform-card`；ImNavigation 独立 compact 用例删除。
- **死 CSS 清理**：`.im-wizard/.im-guide-link/.im-channel-list/.im-channel-card/.im-common-*/.im-nav-*/.im-layout/.im-detail` 等全部移除，`verify:ui-convergence` 全绿。
- 门禁：仓库根 `npm test` 1673 通过 + `typecheck` 全绿。
