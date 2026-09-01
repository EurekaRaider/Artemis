# Artemis IM 远程接入 — 实现规划方案

> 参照 ggcode `internal/im/` 架构，按 Artemis 现有技术栈（Electron + TypeScript monorepo + Pi agent loop）落地。
> 术语遵循 codebase-design：模块 / 接口 / 实现 / 深度 / 接缝 / 适配器。
>
> **2026-08-31 修订：首个落地平台由 Telegram 调整为飞书（Feishu/Lark）。**
> 依据：ggcode 已有生产级飞书适配器 `internal/im/feishu_adapter.go`（1922 行，含 WS 长连接、卡片审批、频控处理、图片收发），
> 参考证据密度远高于 TG；且飞书国内网络可达、无公网回调需求（WebSocket 长连接）。TG 降级为 Phase 4 候选。

## 0. 现状对齐（已核实的架构事实）

| 事实 | 位置 | 对 IM 方案的意义 |
|---|---|---|
| Pi 是唯一 agent loop，禁止引入第二个编排框架 | `AGENTS.md` 架构不变量 | IM 不跑自己的 agent，只构造 prompt 并消费事件流 |
| Agent 跑在 Electron utility process，经 `ArtemisAgentHost.prompt()` 驱动 | `apps/desktop/src/agent/agent-worker.ts` | IM 桥接点与 UI 提交 turn 走同一条命令通道（`turn.prompt`） |
| 审批走 broker 模型：`AgentBroker.request()` 由 main 仲裁 | `agent-worker.ts` `PendingBroker` | IM 审批 = 把 broker 请求转发到 IM，回复映射回 decision |
| 已有"非 UI 触发 turn"的先例：`AutomationScheduler` 注入 `launch()` 回调 | `apps/desktop/src/main/automation-scheduler.ts` | IM 触发 turn 复用同款 launch 接缝，不需要新发明 |
| 协议事件全部走 `@artemis/protocol` 版本化 envelope + 幂等 reducer | `packages/protocol/src/` | IM 出站事件不新造协议，订阅现有事件流再翻译 |
| 敏感配置有加密存储 | `apps/desktop/src/main/encrypted-settings-store.ts`、`mcp-secret-store.ts` | IM 平台凭据（飞书 app_id/app_secret）复用加密存储模式，不进明文 yaml |
| Renderer 禁止 import main/Node API | 架构不变量 | 设置页只经 IPC 拿状态快照，凭据永不出 main 进程 |

## 1. 模块划分（深模块设计）

```
┌───────────────────────────── packages/im（新 workspace，纯 TS，零 Electron 依赖）
│  IMManager          ← 深模块：小接口，藏住绑定/配对/去重/审批状态机
│  接口: handleInbound(msg) / emit(event) / status() / pair(code) / mute(adapter)
│  ├─ types.ts        InboundMessage / OutboundEvent / ChannelBinding（对齐 ggcode 语义）
│  ├─ manager.ts      绑定表、配对挑战（4 位码 + TTL + 失败拉黑）、消息去重
│  └─ adapters/       每个平台一个 Adapter，统一实现 IMAdapter 接口
│       feishu.ts     @larksuiteoapi/node-sdk WSClient 长连接（无需公网 webhook）  ← 第一个真适配器
│       dummy.ts      内存适配器（测试 + seam 验证）
└─────────────────────────────
        ↑ 接口跨接缝，main 进程消费
┌───────────────────────────── apps/desktop/src/main
│  im-service.ts      ← 薄桥接层（adapter at the seam）：订阅协议事件流 → OutboundEvent；
│                       InboundMessage → 复用 automation 的 launch() 路径提交 turn；
│                       broker 审批 ↔ IM 审批消息双向映射
│  im-settings-store.ts  适配器配置 + 凭据（走 encrypted-settings-store）
└─────────────────────────────
        ↑ IPC（状态快照 only，无凭据）
┌───────────────────────────── apps/desktop/src/renderer
│  设置页 IM 面板      适配器状态、绑定列表、配对码确认、mute/unmute
└─────────────────────────────
```

### 核心接口（adapter seam）

```typescript
// packages/im/src/types.ts — 调用方只需懂这两个类型
interface InboundMessage {
  envelope: { adapter: string; platform: Platform; channelId: string;
              senderId: string; senderName: string; messageId: string };
  text: string;
  attachments: Attachment[]; // 图片 base64；语音不在 MVP 范围
}

type OutboundEvent =
  | { kind: "text"; text: string }
  | { kind: "status"; status: string }
  | { kind: "approval_request"; id: string; toolName: string; input: string }
  | { kind: "tool_call" | "tool_result"; /* ... */ };

// packages/im/src/adapter.ts
interface IMAdapter {
  readonly name: string;
  start(ctx: AdapterContext, onInbound: (msg: InboundMessage) => void): Promise<void>;
  send(binding: ChannelBinding, event: OutboundEvent): Promise<void>;
  stop(): Promise<void>;
}
// 可选增强接口（不实现则降级纯文本）：
//   TypingIndicator / InteractiveSender(按钮) — 对齐 ggcode 的渐进增强策略
```

**深度论证**：`IMAdapter` 3 个方法 + 2 个消息类型，背后是 WS 长连接/token 生命周期/重连、消息分片、Markdown 转平台格式（飞书卡片）、频控重试——调用方（im-service）和测试跨同一接缝。删除测试：删掉 IMManager 后，配对、去重、审批路由的复杂度会散回每个 adapter，证明它值得存在。

**Seam 真实性**：dummy adapter（测试）+ feishu adapter（生产）= 两个适配器，接缝不是假设性的。第三个平台（Telegram/企业微信）落地时接口如要改，说明初版接口设计错了。ggcode 已验证该接口族在 15+ 平台（TG/飞书/钉钉/Discord/Slack/企业微信…）上稳定，平台间差异全部收进适配器内部。

## 2. 关键设计决策（已确认，2026-08-31；第 4/6/9 条随平台调整修订）

1. **不新造 agent loop**。IM 入站 → `launch()` 创建/复用任务线程 → `turn.prompt`。遵守架构不变量。
2. **IM 触发的 turn 在 UI 生成可见线程**。【已定】远程执行必须可审计；复用现有线程的事件流/reducer 零额外成本；线程标题加平台前缀（如 `[FS]`）与 UI 任务区分。
3. **绑定 = (IM 频道 ↔ 项目工作区 + 线程)**，持久化到 store。数据结构按多频道设计，但 **MVP 运行时限制同时活跃绑定数为 1**，第二个频道绑定请求提示"先解绑"；Phase 4 再放开并发。【已定：结构不留债，运行复杂度不爆炸】
4. **附件范围：图片支持，语音暂缓**。【已定】飞书图片消息 `msg_type=image` → `image_key` → `GET /im/v1/images/{image_key}` → base64 → provider image block，走现有视觉链路（[G] `feishu_adapter.go` `processImageAttachment`）；语音需 STT 依赖（ggcode 走 `im/stt` + ffmpeg 转码），等真实反馈再加。
5. **配对授权沿用 ggcode 模型**：陌生频道首发消息 → main 弹配对卡（4 位码，5 分钟 TTL，错 5 次作废，拒绝 3 次拉黑该频道）。IM 侧不做任何隐式授权。
6. **审批映射**：agent broker 审批请求 → 飞书消息卡片按钮（Card JSON 2.0，`behaviors: [{type:"callback", value:{...}}]`，回调走 `card.action.trigger`）或文本 y/n/a；回复经 `RouteInboundText` 同款分流（`/` 命令）。**MVP 不做 `!` shell 直通**，风险高收益低。
7. **IM 触发的 turn 固定在 Execute + "Ask" 审批模式**，不允许从 IM 侧切到 Approve-for-me。远程入口的破坏面默认最小。
8. **出站默认 summary 模式**（状态 + 最终答复），verbose（每个工具调用）做成 per-binding 开关，对齐 ggcode 的 outputMode。
9. **首批平台只做飞书**：WebSocket 长连接、无公网回调、官方 Node SDK（`@larksuiteoapi/node-sdk`，MIT）、国内网络可达、ggcode 有完整生产先例。Telegram/企业微信留到第二阶段。

## 3. 阶段计划（每步绑定验证方式）

### Phase 0 — 核心模块 + 测试适配器（约 1 天）
- 新建 `packages/im`：types / manager / dummy adapter / 配对状态机
- 运行时"单活跃绑定"限制在 manager 层实现并测试
- **验证**：`npm run test -w @artemis/im`；配对 TTL/失败拉黑/消息去重/单绑定限制单测全绿；不 import 任何 Electron API（eslint 边界规则卡死）

### Phase 1 — 飞书端到端打通（约 2 天）
- feishu adapter（lark SDK WSClient 长连接）+ `im-service.ts` 桥接 + launch 复用（可见线程 + `[FS]` 标题前缀）+ 绑定持久化 + 图片附件
- 开发者后台手工步骤（建自建应用、配权限、订阅事件、配卡片回调、发布版本）写成设置页向导文案
- **验证**：真机冒烟——手机飞书发消息 → 配对码确认 → Artemis 执行"列出当前目录" → 飞书收到答复；发一张截图 → agent 能描述图片内容；进程重启后绑定仍在、长连接自动重连（SDK `WithAutoReconnect` 等效行为）；UI 中该线程可见

### Phase 2 — 审批与流式出站（约 1.5 天）
- broker 审批 → 消息卡片按钮（`card.action.trigger` 回调）；summary/verbose 输出模式；"正在输入"用 Typing 表情回复实现（飞书无原生 typing API，[G] `TriggerTyping` 先例：给用户最新消息加 `Typing` emoji reaction）
- **验证**：飞书触发一个需审批的 bash 命令，点"拒绝"后 turn 终止；长任务期间用户消息上有 Typing 表情；verbose 开关生效；审批结束后原卡片更新为"已批准/已拒绝"（按钮失效）

### Phase 3 — 设置页 UI（约 1 天）
- renderer IM 面板（状态快照 IPC）：适配器健康、绑定列表、mute/unmute、配对确认入口
- **验证**：typecheck + reducer 单测；UI 上 mute 后飞书侧发消息无响应，unmute 恢复

### Phase 4 — 第二平台 + 放开多活跃绑定（排期另议，约 2 天）
- **首选 Slack**（2026-09-01 调研结论，证据见下位文档附录 A）：Socket Mode 无公网、Block Kit 审批按钮无需后台配置、[G] `slack_adapter.go` 1366 行全量先例；备选 Telegram（[G] `tg_adapter.go`）或企业微信（[G] `wecom_adapter.go`，需公网回调）
- 放开 Phase 0 的单绑定限制，补多实例互斥逻辑
- **验证**：与飞书并行双绑同一工作区，消息互不串频道；接口未因第二平台被迫修改（若被迫改，回写设计复盘）

总计约 5.5–7.5 天（含测试），Phase 4 可独立裁剪。

## 4. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| Electron main 长驻连接的生命周期（休眠/断网/重启） | SDK WSClient 自动重连（对齐 [G] `larkws.WithAutoReconnect(true)`）；main 的 `before-quit` 统一 stop |
| `@larksuiteoapi/node-sdk` 等第三方依赖进 vendor 策略 | 先确认项目对外部 npm 依赖的策略（现有 deps 均为锁定版本）；SDK 为 MIT 且活跃维护（2026-08 核实 1.73.0） |
| 飞书开发者后台手工配置遗漏（尤其卡片回调） | ggcode 实测记录：`card.action.trigger` 必须在"回调配置"而非"事件订阅"里添加，漏配时按钮渲染但点击报 200340（[G] `feishu_adapter.go` 文件头注释）。设置页向导逐条列出并给自查命令 |
| 飞书 API 频控（每用户 5 QPS，超限 HTTP 429） | 段间 300ms 间隔 + 429 按 `x-ogw-ratelimit-reset` 重试 ≤2 次（[G] `rate_limit.go:23` / `feishu_adapter.go` `sendTextMessage` 先例） |
| 远程入口扩大攻击面 | Phase 1 起强制配对 + Execute/Ask 固定 + 无 shell 直通；凭据只存加密 store |
| 协议事件订阅点可能漏事件（compaction 等） | Phase 1 冒烟时对照 UI 线程消息核对完整性 |
| 多窗口/多实例并发 | 复用现有 agent-capacity-controller；IM turn 与普通 turn 同池排队 |
| 单活跃绑定限制被用户误解为 bug | 解绑提示文案 + 设置页明确展示当前活跃绑定 |

开放问题（产品侧，不阻塞 Phase 0–2）：
1. 语音附件何时排期（依赖 STT 选型；ggcode 路径：`im/stt` 可插拔 Transcriber + ffmpeg 转 wav，可作为实现参考）
2. Phase 4 已首选 Slack（2026-09-01 调研，见下位文档附录 A）；Telegram/企业微信顺延为第三平台候选
