# S0 决策原型结论（设计插件模式）

日期：2026-09-29。分支：`codex/design-plugin-s0`（基于 `c160a4f1`）。对应提案：[implementation-proposal.md](../implementation-proposal.md) §12 S0。

## 交付物

| 模块     | 路径                                                                                                    | 验证目标                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 协议契约 | [design-plugin.ts](../../../packages/protocol/src/design-plugin.ts)                                     | manifest schema（strict）、typeBinding、plugin-restricted-v1 profile、提交状态机、纯 JS SHA-256（renderer 安全） |
| 插件目录 | [design-plugin-catalog.ts](../../../apps/desktop/src/main/design-plugin-catalog.ts)                     | 通用扫描/校验/发现，零业务分支                                                                                   |
| 工具门控 | [design-plugin-tool-gate.ts](../../../apps/desktop/src/main/design-plugin-tool-gate.ts)                 | 双层防护：列表过滤 + 派发守卫（allow-list 语义）                                                                 |
| 提交账本 | [design-plugin-submission-ledger.ts](../../../apps/desktop/src/main/design-plugin-submission-ledger.ts) | SQLite 持久、幂等 accept、状态机校验、崩溃恢复                                                                   |
| 测试插件 | [resources/s0-plugins/](../../../apps/desktop/resources/s0-plugins/)                                    | test-notes 与 test-shapes，业务完全不同                                                                          |
| 测试     | 3 个测试文件 32 用例                                                                                    | 见下方验证矩阵                                                                                                   |

## 验证矩阵

### 验证线 2：提权防护（协议层 + 门控层，14 用例）

| 用例                                                                    | 结果 |
| ----------------------------------------------------------------------- | ---- |
| manifest 拒绝未知键 / 空类型 / 非 none 网络 / 错误协议版本              | ✅   |
| §7 矩阵全部拒绝项（bash/文件/子代理/MCP/扩展/web/office）在列表层被滤除 | ✅   |
| 每个被拒类别在派发守卫层独立抛错（stale-list 回归用例）                 | ✅   |
| 未知类别默认拒绝（allow-list，非 deny-list）                            | ✅   |

### 验证线 3：持久提交账本（8 用例）

| 崩溃窗口           | 行为                                        | 结果 |
| ------------------ | ------------------------------------------- | ---- |
| accepted 未派发    | 重启后进入 redispatchable                   | ✅   |
| dispatching 无确认 | 标记 unknown，保留原状态与 turnId，绝不重放 | ✅   |
| running 无终态     | 同上                                        | ✅   |
| 重复重启           | unknown 持续可见直至显式对账（幂等恢复）    | ✅   |
| 同 ID 不同 payload | 拒绝并报损坏                                | ✅   |
| 同文不同 ID        | 独立记录、序列递增                          | ✅   |

### 解耦证明（6 用例）

两个业务不同的插件包经同一路径加载、校验、按 typeId 解析；坏 manifest 报错而非静默跳过；真实资源包可加载。

## 验证线 1：WebContentsView 面板容器（已通过，macOS arm64 原生窗口）

验证脚本 [verify-s0-panel-native.mjs](../../../apps/desktop/scripts/verify-s0-panel-native.mjs) 在真实 Electron 窗口（swiftshader 无 GPU）中装载两个 S0 插件面板（独立非持久 session），6 项检查全部通过，证据落盘 `artifacts/s0-panel/darwin-arm64.json`：

| 检查                  | 结果 | 说明                                                                                |
| --------------------- | ---- | ----------------------------------------------------------------------------------- |
| focus-panel           | ✅   | 面板 webContents.focus() 执行，宿主窗口稳定                                         |
| focus-active-element  | ✅   | 面板报告 activeElement=BODY                                                         |
| overlay-above-panel   | ✅   | 宿主模态对话框渲染在面板视图之上                                                    |
| resize-panel-follows  | ✅   | 宿主 resize 后 view bounds 按比例跟随（content=1600x796，右半面板 x=800 width=800） |
| switch-dom-persists   | ✅   | setVisible(false)→DOM 变更→setVisible(true)，DOM 状态保留                           |
| teardown-kills-panels | ✅   | 显式 close() 后两个面板 webContents 均 isDestroyed()=true                           |

**两条 Electron 43 实测发现（写进宿主实现的硬要求）：**

1. `host.destroy()` 不会自动销毁子 WebContentsView 的 webContents——提案 §8"关闭页签必须显式关闭所属 webContents"不是防御性设计，是必须实现的清理逻辑。
2. 销毁后 `view.webContents` 引用被清空——宿主需在销毁前持有引用（或先 close 子视图再 destroy 宿主窗口）。

另：`setContentSize` 会被屏幕物理高度截断（1600x900 → 1600x796），断言须用相对布局而非绝对像素。2. **未接入 agent-host**：工具门控与账本尚未挂到 `runtime.ts` 创建路径，纯模块级验证。3. **stdio runtime 协议未实现**：runtime 存根只回 ready，无 tool.invoke/artifact.propose 帧。4. **未做 macOS 打包验证**；Windows 未涉及。5. 提案 §5.2 不可变 revision 存储、§8 独立 session/MessagePort 均为 S1/S2 范围。

## 结论与建议

- **架构方向可行**：通用宿主 + 严格 manifest + 双层工具门控 + 持久账本在模块层全部按提案行为工作，未发现需要推翻提案的证据。
- **发现并修复一处设计缺陷**：初版 `recover()` 会把上一轮 unknown 的记录从报告中静默丢弃；已修复为持续可见直至显式对账——这正是提案 §9.3 "不能承诺 exactly-once、必须提供核对" 的落地。
- **下一步（按优先级）**：
  1. 把工具门控接入 `createResourceOverrides`/thread 创建路径，用真实 Pi session 跑 §7 拒绝矩阵。
  2. stdio 帧协议（hello/ready/tool.invoke）+ runtime 进程生命周期测试。
  3. 依据验证线 1 的两条 Electron 43 发现，在正式 PanelHost 中实现显式 webContents 清理。

## 运行方式

```sh
npx vitest run packages/protocol/test/design-plugin.test.ts \
  apps/desktop/test/design-plugin-catalog.test.ts \
  apps/desktop/test/design-plugin-tool-gate.test.ts \
  apps/desktop/test/design-plugin-submission-ledger.test.ts
npm run typecheck
```
