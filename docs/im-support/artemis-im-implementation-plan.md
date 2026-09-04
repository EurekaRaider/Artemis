# Artemis IM 远程接入 — 细化实施方案（附参考证据）

> 上位文档：[artemis-im-remote-access.md](artemis-im-remote-access.md)（决策已锁定）
> 本文档把方案细化到文件、接口签名、状态机级别。每条设计都标注参考证据：
> - **[A]** = Artemis 仓库 `/Users/nickyhuang/Documents/Artemis`（落地侧既有模式）
> - **[G]** = ggcode 仓库 `/Users/nickyhuang/Documents/ggcode`（参考实现）
>
> 所有行号均为 2026-08-31 实际读取核实。
>
> **2026-08-31 修订：首个落地平台由 Telegram 调整为飞书。** E7/E12/E13/E20 重写为飞书证据，
> 新增 E21–E24（开发者后台配置、频控、token 生命周期、Typing 表情回复），均来自
> [G] `internal/im/feishu_adapter.go`（1922 行生产实现）实际读取。
>
> **2026-09-01 补充：Phase 4 第二平台选型调研完成，首选 Slack。**
> 新增附录 A（Slack 证据表 S1–S9），均来自 [G] `internal/im/slack_adapter.go`（1366 行生产实现）实际读取。

## 1. 证据索引（决策 → 支撑）

| # | 设计点 | 证据 |
|---|---|---|
| E1 | IM turn 提交走 `turn.prompt` 命令 | [A] `packages/protocol/src/host-messages.ts:168` 命令形状 `{requestId, threadId, turnId, text, mode, attachments?, goal?, memoryContext?}`；实际提交点 [A] `apps/desktop/src/main/main.ts:5402` |
| E2 | 审批拦截有唯一入口 | [A] `main.ts:3838` `handleBrokerRequest()`，按 kind 分发（shell.execute / local.file.read/write / mcp.call / extension.call / office.document 等） |
| E3 | 非 UI 来源审批已有先例 | [A] `main.ts:3008` `automationAutoApproval()` + `main.ts:3030` `createAutomationApproval()`：发 `approval.requested` 事件（`source: "automation"`）并直接返回 `ApprovalResolution {approvalId, nonce, approved, scope, source}`。IM 用同款形状、`source: "im"`，但改为挂起等待而非自动批准 |
| E4 | "挂起请求、稍后解析"模式已存在 | [A] `main.ts:3058` `pendingUserInputs.consume()/consumeRecommended()`：user.input 类 broker 请求挂起，UI/超时后来解析。IM 审批挂起队列照抄此模式 |
| E5 | 事件流有唯一分发点 | [A] `main.ts:2763` `emitPayload()`：`store.appendEvent` → `webContents.send(IPC.agentEvent)` → `applyPayloadSideEffects`。IM 出站订阅在此处挂 listener，与 UI 消费同一事件源，无遗漏风险 |
| E6 | 线程创建走 store | [A] `main.ts:5099` `createTaskThread()`（target=local 时 `store.createThread(thread)`，main.ts:5144/5153） |
| E7 | 图片附件协议已就绪 | [A] `packages/protocol/src/schema.ts:138` `promptImageSchema`、`:165` `promptAttachmentSchema` union。飞书图片消息直接转 PromptAttachment，无需改协议；下载路径证据 [G] `feishu_adapter.go` `processImageAttachment`：`msg_type=image` → `image_key` → `GET /im/v1/images/{image_key}` → base64 + MIME 嗅探 |
| E8 | 凭据加密存储模式 | [A] `apps/desktop/src/main/encrypted-settings-store.ts` `SafeStorageAdapter {encryptString, decryptString}`，`PersistedSettings.credentials: Record<string, EncryptedCredential>` |
| E9 | 持久化实体进 AppStore | [A] `apps/desktop/src/main/store.ts:1759` `getAutomation`、`:1846` `claimAutomationRun`（SQLite 行映射模式 `AutomationRunRow` store.ts:123） |
| E10 | 包工程模板 | [A] `packages/protocol/package.json`：`tsc` 构建 + `vitest run` 测试 + zod；`tsconfig.json` extends base、composite。测试在 `packages/protocol/test/*.test.ts` |
| E11 | Renderer IPC 模式 | [A] `apps/desktop/src/preload/preload.ts:12` `contextBridge` + `ipcRenderer.invoke(IPC.xxx)`；设置 UI 在 `renderer/SettingsPanel.tsx` |
| E12 | 飞书 WS 长连接 + 断线自愈 | [G] `feishu_adapter.go:254` `runWebSocket()`：官方 SDK WS client（Go 版 `larkws.NewClient`）+ `WithAutoReconnect(true)`，重连由 SDK 托管；`:183` `run()`：启动先 `fetchTokenWithRetry([3s,5s,10s,30s])`（#540：启动瞬时网络抖动不得让适配器死在 error 态）→ `fetchBotInfo`（非致命）→ token 刷新循环 → WS 长连接（webhook 仅 legacy 模式） |
| E13 | 飞书消息分片：按字节不按 rune | [G] `message_split.go:44` 平台上限表 `PlatformFeishu: 28000` + `:15` 注释"interactive card limit is ~30KB of JSON bytes, not chars (#757)" + `:114` `splitMessageBytes`。**#757 教训**：28000 个 rune 的 CJK 文本 ≈84KB 字节，必然超卡片 30KB 上限；切分必须以 UTF-8 字节数为准、不切断码点 |
| E14 | 入站去重 | [G] `runtime.go:678` `HandleInbound`：key=`adapter:messageID`，**处理前**打标、失败回滚（#540），每 100 条清理 >5 分钟旧条目 |
| E15 | 配对状态机 | [G] `runtime.go:815` `HandlePairingInbound`：黑名单检查 → 同渠道码匹配 → `buildPairingBinding`；陈旧槽位自愈（#719）。常量 [G] `pairing.go:18`：TTL 5min / 抢占空闲 2min / 错码 5 次作废 / 拒绝 3 次拉黑 |
| E16 | 审批回复解析 | [G] `approval_reply.go:8` `ParseApprovalReply`：y/yes/好/允许→Allow；a/always/总是允许→Allow+always；n/no/拒绝→Deny；y/n 前缀 ≤3 字符兜底 |
| E17 | 输出模式 | [G] `emitter.go:36` `outputMode`（verbose/quiet/summary）、`:456` `SetOutputMode` |
| E18 | 入站路由 | [G] `inbound_route.go:29` `RouteInboundText`：`/`→slash、待批审批→审批解析、待答→ask_user、其余→message（MVP 砍掉 `$`/`!` shell 分支） |
| E19 | 适配器接口族 | [G] `types.go`：`Sink {Name, Send}` + 可选 `TypingIndicator`/`InteractiveSender`/`Closer`，不实现则降级纯文本；`types.go:21` `PlatformFeishu Platform = "feishu"` |
| E20 | 飞书官方 Node SDK，**决策：引入** | `npm view @larksuiteoapi/node-sdk` → 1.73.0 MIT，2026-08 仍活跃维护。决策理由：飞书事件与卡片回调走 WSClient 长连接，SDK 托管连接注册与重连（对照 [G] Go 版用官方 SDK `larkws` 的同一选择）；裸 HTTP 只能做 webhook 模式，需要公网入口，违反"无公网"约束。**这是与 TG"裸 Bot API"决策相反的有意差异**——TG 长轮询是纯 HTTPS 拉取，飞书长连接是平台私有 WS 协议 |
| E21 | 开发者后台配置（易踩坑） | [G] `feishu_adapter.go:1-20` 文件头实测记录：①事件与回调的连接模式设为"长连接"；②`card.action.trigger`（卡片回传交互）必须在**"回调配置"**里添加，**不是"事件订阅"**——漏配时按钮正常渲染但点击报错误码 200340（card callback not configured）。设置页向导必须逐条列出 |
| E22 | 飞书频控 | [G] `feishu_adapter.go:63` `feishuInterMsgDelay=300ms`（每用户 5 QPS，300ms≈3.3 QPS 安全值）；429 响应带 `x-ogw-ratelimit-reset` 头，按其重试；[G] `rate_limit.go:23` `maxRateLimitRetries=2`、`:34` `parseRetryAfter` |
| E23 | token 生命周期 + 错误约定 | [G] `feishu_adapter.go` `refreshToken()`：`POST /auth/v3/tenant_access_token/internal`（app_id+app_secret），默认 expire 7200s；`tokenRefreshLoop` 5min ticker + `feishuTokenExpireDelta=300`（提前 5 分钟刷新）；`parseFeishuMessageID()`：**飞书 API 大量错误以 HTTP 200 + body `code!=0` 返回，必须查 code 字段** |
| E24 | Typing 指示 = 表情回复 | 飞书 Bot 无原生 typing API。[G] `feishu_adapter.go` `TriggerTyping()`：对用户最新消息加 `Typing` emoji reaction（`POST /im/v1/messages/{msgId}/reactions`，`emoji_type:"Typing"`），`reactionAck` 状态去重防重复添加 |

## 2. packages/im 详细设计

### 2.1 文件清单（模板证据 E10）

```
packages/im/
  package.json          @artemis/im，private，type:module，build:tsc，test:vitest run，
                        deps: zod + @artemis/protocol + @larksuiteoapi/node-sdk（证据 E20）
  tsconfig.json         extends ../../tsconfig.base.json，composite，outDir:dist，rootDir:src
  src/
    index.ts            仅导出公共接口（深度纪律：内部文件不外泄）
    types.ts            InboundMessage / OutboundEvent / ChannelBinding / AdapterState / Platform
    adapter.ts          IMAdapter + 可选接口（证据 E19）
    manager.ts          IMManager（证据 E14/E15/E18 的实现载体）
    pairing.ts          配对状态机（证据 E15）
    dedup.ts            SeenMessages（证据 E14）
    route.ts            routeInboundText（证据 E18，删 shell 分支）
    approval-text.ts    parseApprovalReply（证据 E16，原样移植词汇表）
    split.ts            splitMessageBytes（证据 E13：按 UTF-8 字节切，不切断码点）
    translate.ts        AgentPayload → OutboundEvent[] 纯函数（§3.2）
    bindings.ts         BindingStore 接口 + MemoryBindingStore
    adapters/
      dummy.ts          内存适配器（测试 + seam 验证）
      feishu.ts         WSClient 长连接适配器（证据 E12/E13/E20-E24）
  test/                 与 src 同构的 vitest 用例（清单见 §6）
```

### 2.2 核心类型（types.ts）

```typescript
// 对齐 [G] types.go，字段级映射
export type Platform = "feishu" | "dummy";

export interface Envelope {
  adapter: string;          // 适配器实例名，如 "feishu-main"
  platform: Platform;
  channelId: string;        // 飞书 chat_id（oc_ 前缀）
  senderId: string;         // 飞书 open_id（ou_ 前缀）
  senderName: string;
  messageId: string;        // 飞书 message_id（om_ 前缀）
  receivedAt: string;       // ISO
}

export interface InboundMessage {
  envelope: Envelope;
  text: string;
  attachments: InboundAttachment[]; // {kind:"image", mime, dataBase64}
}

export type OutboundEvent =
  | { kind: "text"; text: string }
  | { kind: "status"; status: string }
  | { kind: "approval_request"; approvalId: string; toolName: string; summary: string; risk: string }
  | { kind: "approval_resolved"; approvalId: string; approved: boolean }
  | { kind: "tool_summary"; total: number; failures: number } // summary 模式用
  | { kind: "tool_detail"; toolName: string; detail: string; isError?: boolean }; // verbose 模式用

export interface ChannelBinding {
  workspaceKey: string;     // projectId 或临时会话 key
  threadId: string;         // 绑定的可见线程（决策 2，E6 创建）
  adapter: string;
  platform: Platform;
  channelId: string;
  outputMode: "summary" | "verbose" | "quiet"; // per-binding（决策 8，证据 E17）
  muted: boolean;
  boundAt: string;
  lastInboundMessageId?: string;  // Typing 表情回复的挂载点（证据 E24）
}
```

### 2.3 适配器接口（adapter.ts，证据 E19）

```typescript
export interface AdapterContext { signal: AbortSignal; }

export interface IMAdapter {
  readonly name: string;
  readonly platform: Platform;
  start(ctx: AdapterContext, onInbound: (msg: InboundMessage) => void): Promise<void>;
  send(binding: ChannelBinding, event: OutboundEvent): Promise<void>;
  stop(): Promise<void>;
}

// 可选增强（typeof 守卫探测，不实现自动降级）：
export interface TypingIndicator { triggerTyping(binding: ChannelBinding): Promise<void>; }
export interface InteractiveSender {
  sendApprovalButtons(
    binding: ChannelBinding,
    event: Extract<OutboundEvent, { kind: "approval_request" }>,
  ): Promise<string /* platformMsgId */>;
}
export interface ApprovalCallbackSource {
  onApprovalCallback(cb: { approvalId: string; approved: boolean; messageId: string }): void;
}
```

### 2.4 IMManager 公共接口（manager.ts）

```typescript
export class IMManager {
  constructor(deps: {
    bindings: BindingStore;                 // main 侧注入 AppStore 实现（§4）
    now?: () => Date;                       // 测试注入，对齐 AutomationScheduler 的 now? 模式（[A] automation-scheduler.ts:26）
    onPairingRequested?: (challenge: PairingChallenge) => void;  // → main 弹配对 UI
    onInboundAccepted?: (msg: InboundMessage, binding: ChannelBinding) => void; // → im-service 提交 turn
  });

  registerAdapter(adapter: IMAdapter): void;
  startAdapter(name: string): Promise<void>;   // muted 硬拒（[G] adapters.go StartNamedAdapter 同款守卫）
  stopAdapter(name: string): Promise<void>;

  handleInbound(msg: InboundMessage): Promise<InboundResult>;
  // 内部顺序（证据 E14/E15/E18）：
  //   1. dedup 打标（失败回滚）
  //   2. muted → 静默丢弃
  //   3. 无绑定 → handlePairingInbound（配对流程）
  //   4. 有绑定 + 有待批审批 → parseApprovalReply 命中则 resolveApproval
  //   5. 有绑定 + "/" → slash（/status /verbose /quiet /new /unbind）
  //   6. 有绑定 → onInboundAccepted（单活跃绑定守卫在这里，见下）

  resolveApproval(approvalId: string, approved: boolean, respondedBy: string): boolean;
  registerPendingApproval(req: PendingApproval): void;  // im-service 调，broker 请求到达时

  setMuted(adapter: string, muted: boolean): Promise<void>; // mute=物理断连（stop）
  status(): IMStatusSnapshot;
}
```

**单活跃绑定守卫（决策 3 落地）**：`onInboundAccepted` 触发前检查 `bindings.list()` 中 `muted=false` 的绑定数；新频道配对成功时若已有活跃绑定，回复固定文案"当前已绑定到另一个频道，请先在设置中解绑"并拒绝激活（绑定记录照存，`muted=true`）。Phase 4 删除此守卫即可放开。

### 2.5 配对状态机（pairing.ts，证据 E15 原样移植）

```
陌生频道首消息
  → 渠道在黑名单? → 回复"已加入黑名单"，结束（[G] runtime.go:837）
  → 已有 pending 槽位?
       同渠道 & 码匹配 → 建绑定，回复"绑定成功"（[G] runtime.go:871）
       同渠道 & 码错误 → WrongCodeAttempts++，满 5 次作废槽位并计入拒绝（[G] pairing.go:26）
       槽位 age>5min 或 (异渠道 & idle>2min) → 丢弃旧槽，开新挑战（[G] runtime.go:862）
  → 无 pending → 生成 4 位码挑战，onPairingRequested 通知桌面
桌面端确认 = 配对卡（通知 + 设置页条目），操作者点"批准"后把 4 位码发到 IM；
   操作者点"拒绝" → RejectCount++，满 3 次拉黑该渠道（[G] pairing.go:30）
```

与 ggcode 的一处有意差异：ggcode 在 TUI 里显示配对码、用户在 IM 里回码；Artemis 改为**桌面弹配对卡显示 4 位码、用户把码发到 IM 频道**完成确认——等价的双向确认，但更贴合桌面应用形态（桌面通知复用 [A] `automationRunNotification` main.ts:3004 的模式）。

### 2.6 入站路由（route.ts，证据 E18 裁剪版）

```typescript
export type InboundRoute =
  | { kind: "empty" }
  | { kind: "slash"; text: string }          // "/" 前缀
  | { kind: "approval"; approved: boolean; always: boolean }  // 有待批审批且命中词表
  | { kind: "message"; text: string };
// 明确删除：ggcode 的 shell 分支（[G] inbound_route.go:38）——MVP 决策 6
```

### 2.7 飞书适配器（adapters/feishu.ts，证据 E12/E13/E20-E24）

```
配置（对应 [G] feishu_adapter.go:96 newFeishuAdapter 的必填/可选项）：
  appId, appSecret        必填，缺则构造即抛错（对齐 [G] 同款校验）
  domain                  "feishu"(默认) | "lark"（海外版，API base 换 open.larksuite.com）
  encryptKey/verifyToken  MVP 不需要——仅 webhook 模式用于验签，WS 长连接模式由 SDK 托管
                          （[G] 同名配置仅在其 legacy webhook 路径生效）

start():                        // [G] feishu_adapter.go:183 run() 的结构移植
  1. fetchTokenWithRetry([3s,5s,10s,30s])   // 证据 E12/E23：启动 token 必须拿到，
                                            // 瞬时抖动退避重试而不是死态（[G] #540）
  2. fetchBotInfo() → bot open_id（非致命，失败仅 debug log）
  3. tokenRefreshLoop：5min 轮询，剩余有效期 <300s 时刷新（证据 E23）
  4. SDK WSClient 长连接（自动重连，证据 E12），EventDispatcher 注册两个处理器：
       "im.message.receive_v1"  → onMessage
       "card.action.trigger"    → onCardAction   // 前提：后台"回调配置"已添加（证据 E21）
  AbortSignal 触发 → 关 WS、停 token 循环 → publishState(stopped)

onMessage(event):
  sender 是机器人自身 → 丢弃
  msg_type="text"  → content.text 提取
  msg_type="post"  → 富文本展平提取纯文本（[G] parseMessageContent 的 post 分支）
  msg_type="image" → image_key → GET /im/v1/images/{image_key}（Bearer token）
                     → base64 → InboundAttachment；MIME 以响应 Content-Type + 内容嗅探为准
                     （证据 E7/[G] processImageAttachment）
  其余（audio/file/sticker 等）→ MVP 回复固定文案"暂不支持该消息类型"
                                 （语音 STT 见上位文档开放问题 1）
  组装 InboundMessage → manager.handleInbound（配对/去重/路由全在 manager，适配器零状态机）

onCardAction(event):            // [G] handleCardActionTrigger 的字段映射
  action.value = {appr: approvalId, decision: "y"|"n"}（自定义键名，对照 [G] 的 "choice"）
  operator.open_id / context.open_message_id / context.open_chat_id 取齐
  → ApprovalCallbackSource 回调（审批归属校验在 manager：approvalId 必须命中 pending 队列）

send():                         // 按 OutboundEvent.kind 分发
  text/status/tool_detail/tool_summary →
    splitMessageBytes(text, 28000) 逐段（证据 E13：按字节切，#757 教训）：
      首选 msg_type="interactive" 卡片渲染（Card JSON 2.0：
        {schema:"2.0", config:{wide_screen_mode:true},
         body:{elements:[{tag:"markdown", content}]}}——支持表格/标题/代码块，
        1.0 卡片的 markdown tag 不支持表格，证据 [G] sendPostMessage 注释）
      卡片发送失败 → 降级 msg_type="text" 纯文本重发（[G] Send 的 fallback 同款）
    段间 sleep 300ms（证据 E22，5 QPS 频控）
    HTTP 429 → 按 x-ogw-ratelimit-reset 重试 ≤2 次（证据 E22）
    所有响应查 body.code != 0 才算失败（证据 E23：飞书错误常以 HTTP 200 返回）

  approval_request → 实现 InteractiveSender：
    Card 2.0 + column_set 按钮组（[G] SendInteractive 结构移植）：
      {tag:"button", text:"同意", type:"primary",
       behaviors:[{type:"callback", value:{appr, decision:"y"}}]}
      {tag:"button", text:"拒绝", type:"danger",
       behaviors:[{type:"callback", value:{appr, decision:"n"}}]}
    返回 platformMsgId 供 approval_resolved 回写

  approval_resolved → PATCH 原卡片，正文改为"✅ 已批准 / ❌ 已拒绝（由 xxx 操作）"，
    移除按钮列（卡片整体替换，飞书卡片更新即全量替换 body）

triggerTyping(binding):         // 证据 E24，实现 TypingIndicator 可选接口
  binding.lastInboundMessageId 为空 → no-op
  → POST /im/v1/messages/{msgId}/reactions {reaction_type:{emoji_type:"Typing"}}
  reactionAck 去重：同一条消息只加一次（[G] reactionAck 同款状态）
  MVP 只加不删（对齐 [G]）；im-service 在 turn 运行开始时触发一次即可，无需 4s 续命
  （表情不会过期，不存在 TG sendChatAction 的 5s 失效问题）
```

开发者后台一次性配置（设置页向导逐条列出，证据 E21 + [G] 文件头）：
1. 创建企业自建应用，记录 app_id / app_secret
2. 权限：`im:message`、`im:message:send_as_bot`、`im:resource`（图片下载/上传）、`im:chat`（读群信息，配对卡展示频道名用）
3. 事件与回调 → 连接模式选"长连接"
4. 事件订阅添加 `im.message.receive_v1`（接收消息）
5. **回调配置**添加 `card.action.trigger`（卡片回传交互）——注意不是事件订阅，漏配报 200340
6. 创建版本并发布（自建应用需发布后权限生效）

## 3. main 进程桥接（im-service.ts）

```
apps/desktop/src/main/
  im-service.ts          生命周期 + 双侧翻译
  im-bindings-store.ts   BindingStore 的 AppStore 实现（SQL 表 im_bindings，证据 E9）
  im-service.test.ts     main 侧单测（vitest，与现有 main 测试同构）
```

### 3.1 接线点（全部有证据）

| 职责 | 接线 | 证据 |
|---|---|---|
| 入站 → turn | `onInboundAccepted` → 无绑定线程则 `createTaskThread`（标题 `[FS] {channelName}`，target=local，projectId=绑定工作区）→ 复用 main.ts:5402 的 `agentProcess.request({type:"turn.prompt", mode:"execute", ...})` 提交路径（抽出公共函数 `submitTurnToThread`，原代码内联段改为调用它） | E1/E6 |
| 运行中追加消息 | 线程 `status==="running" \|\| "waiting-approval"` 时改发 `turn.follow-up`（main.ts:5425 `queueTurn` 现有路径） | E1 |
| 审批 → IM | `handleBrokerRequest`（main.ts:3838）各 handler 在"需要 ask"分支前插入 `imService.interceptApproval(request)`：命中绑定线程则 `manager.registerPendingApproval` + `send(approval_request)`，**挂起不 resolve**，等 IM 回复 | E2/E3/E4 |
| IM 回复 → resolve | `manager.resolveApproval` 命中（卡片回调或文本解析）→ `agentProcess.request({type:"broker.resolve", resolution})`，resolution 形状照抄 E3（`source:"im"`，scope 恒 `"once"`——IM 侧不提供"总是允许"记忆，即使回复 a/always，决策 7 的收紧） | E3/E4 |
| 出站订阅 | `emitPayload`（main.ts:2763）尾部加 `imService.onAgentEvent(threadId, preparedPayload)`——在 store.appendEvent 之后、与 UI 同一事件源 | E5 |
| 配对 UI | `onPairingRequested` → 桌面通知 + `mainWindow.webContents.send(IPC.imPairingRequested, challenge)` | §2.5 |
| Typing 触发 | turn 开始事件 → `adapter.triggerTyping(binding)`（一次即可，表情不过期；无 4s 续命逻辑——与 TG 方案的有意差异，证据 E24） | E24 |

### 3.2 出站事件翻译（onAgentEvent → translate.ts）

| AgentPayload（协议事件） | OutboundEvent | outputMode 门控 |
|---|---|---|
| `turn.completed` 的最终 assistant 文本 | `text`（全量答复） | summary/verbose 发；quiet 不发 |
| `turn.failed` | `text`（错误摘要） | 全模式发 |
| `approval.requested` | —（已由 3.1 拦截路径直接发，跳过避免双发） | — |
| 工具调用/结果 | `tool_detail` | 仅 verbose |
| turn 开始/结束边界 | 工具计数聚合 → `tool_summary`（"共执行 N 个工具，M 失败"） | 仅 summary |
| 其他（goal、memory、queue 等） | 忽略 | — |

翻译器必须是**纯函数** `translateAgentPayload(payload, mode) → OutboundEvent[]`，放 `packages/im/src/translate.ts`，可脱离 Electron 单测（测试面=接口面）。

### 3.3 模式锁定（决策 7 落地）

`submitTurnToThread` 的 IM 调用点硬编码 `mode:"execute"`；审批模式由现有 `evaluateModePolicy`（main.ts:3874）决定，IM 路径**不新增** auto-approve 通道（对照 E3 automation 的 `createAutomationApproval`，IM 明确不实现等价物）。IM 触发的 turn 在 broker 挂起期间线程进入 `waiting-approval`，UI 同样可见可干预——桌面端点批准与 IM 点批准效果一致（同一 broker.resolve 通道，nonce 防重放已由 E3 形状自带）。

## 4. 配置与持久化

| 数据 | 位置 | 证据 |
|---|---|---|
| 飞书 app_id/app_secret | `encrypted-settings-store` 新增 `credentials["im:feishu:{adapterName}"]`，值为 JSON `{appId, appSecret}`，复用 `SafeStorageAdapter`（app_id 不是机密，但同条存储简化读写；永不在 UI/日志回显 app_secret） | E8 |
| 适配器启用配置 | 同 store 新增 `imAdapters?: Record<string,{platform, domain, enabled}>`（PersistedSettings version 升 2，迁移：缺省=无适配器） | E8 |
| 绑定/配对状态 | AppStore 新表 `im_bindings`（workspace_key, thread_id, adapter, platform, channel_id, output_mode, muted, bound_at, last_inbound_message_id）+ `im_pairing_channels`（渠道拒绝计数/黑名单） | E9 |
| 进程重启恢复 | main 启动时（automationScheduler 接线 main.ts:15398 附近）读配置 → 逐个 `startAdapter` | [G] adapters.go:31 同款 |

## 5. 分阶段任务拆解

### Phase 0 — packages/im 核心（1 天）

| 任务 | 产出 | 验证 |
|---|---|---|
| 0.1 包骨架 | package.json/tsconfig（抄 E10 模板） | `npm run build -w @artemis/im` 通过 |
| 0.2 types/adapter/bindings/memory store | §2.2/2.3 | tsc 类型断言测试 |
| 0.3 dedup.ts | 证据 E14 语义：先打标、失败回滚、5min/100 条清理 | 单测：重复投递只处理一次；失败后可重投 |
| 0.4 pairing.ts | §2.5 状态机 | 单测：TTL 过期/异渠道抢占/错 5 次/拒 3 次拉黑/绑定成功路径（注入 now） |
| 0.5 route.ts + approval-text.ts | §2.6 + E16 词表（含中文：好/允许/拒绝/总是允许） | 单测：词表全量 + 无待批时"y"按 message 处理 |
| 0.6 split.ts | **splitMessageBytes**：UTF-8 字节安全 28000 字节切分（证据 E13，#757 教训） | 单测：emoji/中文混排不碎码点；28000 个 CJK 字符（≈84KB）切成 ≥3 段 |
| 0.7 manager.ts + dummy adapter | §2.4，含单活跃绑定守卫 | 单测：全状态流转 + 守卫拒绝文案 |
| 0.8 translate.ts | §3.2 纯函数 | 单测：三种模式门控矩阵 |

**Phase 0 出口**：`npm run test -w @artemis/im` 全绿；`grep -r "electron" packages/im/src` 为空（边界检查做成 scripts/ 脚本进 CI——现仓库无 eslint，用脚本做硬边界）。

### Phase 1 — 飞书端到端（2 天）

| 任务 | 产出 | 验证 |
|---|---|---|
| 1.1 feishu.ts 生命周期 | §2.7：token 获取退避 + 刷新循环 + SDK WSClient 接线（SDK client 用工厂注入，便于 mock） | 单测：mock SDK，token 退避序列/刷新时机/AbortSignal 停止语义；SDK 重连由官方托管，不自测 |
| 1.2 图片附件 | image_key → GET /im/v1/images/{key} → base64 → InboundAttachment（证据 E7） | 单测 mock fetch + 真机发截图 |
| 1.3 im-bindings-store.ts | §4 SQL 表 + BindingStore 实现 | main 侧单测（内存 SQLite，同 store.ts 测试模式） |
| 1.4 im-service.ts 入站链路 | §3.1 入站→建线程→turn.prompt/follow-up | 集成测试：注入假 agentProcess.request，断言命令形状=E1 |
| 1.5 配置读写 + 启动恢复 | §4 | 重启后绑定与适配器自动恢复（真机） |
| 1.6 配对桌面卡 | 通知 + IPC 事件 | 真机：飞书私聊机器人→桌面弹卡→发码→绑定成功 |

**Phase 1 前置（一次性手工）**：按 §2.7 末尾清单完成开发者后台配置；把 app_id/app_secret 录入设置页（写入即加密）。
**Phase 1 出口（真机冒烟）**：手机飞书发"列出当前目录文件"→ 配对 → 收到答复；发截图 → agent 描述图片；kill 进程重开 → 直接继续对话无需重新配对；UI 线程列表出现 `[FS]` 线程且内容一致。

### Phase 2 — 审批与出站（1.5 天）

| 任务 | 产出 | 验证 |
|---|---|---|
| 2.1 broker 拦截 | §3.1 审批→IM 挂起 | 集成测试：假 broker 请求→断言 IM 收到 approval_request 且 worker 未收到 resolve |
| 2.2 审批卡片 + card.action.trigger | §2.7 InteractiveSender/ApprovalCallbackSource（先确认后台"回调配置"已添加，证据 E21） | 真机：点"拒绝"→ turn 终止；点"同意"→ 继续；桌面同步收到 approval_resolved |
| 2.3 文本审批兜底 | E16 解析接入 manager | 单测 + 真机回"y" |
| 2.4 出站翻译接线 | §3.2 onAgentEvent 接入 emitPayload；卡片 markdown 渲染 + 纯文本降级 + 300ms 段间隔 + 429 重试（证据 E13/E22/E23） | 集成测试：假事件流→dummy adapter 收到正确事件序列；单测：429 重试与 code!=0 错误识别（mock fetch） |
| 2.5 Typing 表情回复 | 证据 E24：turn 开始给用户消息加 Typing reaction，reactionAck 去重 | 真机长任务观察表情出现且不重复 |
| 2.6 /verbose /quiet /summary 切换 | per-binding outputMode 持久化 | 真机切换后输出密度变化 |

**Phase 2 出口**：完整闭环"IM 发起 → 审批 → 执行 → 回复"，桌面与 IM 双端审批互通（桌面点批准，飞书收到 approval_resolved 且原审批卡片更新为终态、按钮消失）。

### Phase 3 — 设置页（1 天）

| 任务 | 产出 | 验证 |
|---|---|---|
| 3.1 IPC + preload | `IPC.imStatus/imSetMuted/imUnbind/imApprovePairing/imRejectPairing`（抄 E11 模式） | typecheck |
| 3.2 SettingsPanel IM 区块 | 适配器状态/绑定列表/配对确认/app_id+app_secret 录入（写入即加密，永不回显 secret）+ 开发者后台配置向导（§2.7 清单逐条 checklist） | reducer 单测 + 手动 |
| 3.3 i18n | 中/英文案 | 切换语言检查 |

### Phase 4（另议）— 第二平台（首选 Slack，证据附录 A）+ 放开多绑定

**首选 Slack**（2026-09-01 调研结论，证据见附录 A）：
- 与飞书同档"无公网 + 官方 SDK 可选"，但后台配置更少（无卡片回调配置步骤）
- [G] `slack_adapter.go`（1366 行）全量生产先例，三个已知坑（终态认证 #603 / envelope ack #968 / mention 剥离 #540）均有记录和测试
- 适配器增量约 500–800 行 TS（含 mrkdwn 转换），预计 1.5–2 天；manager/配对/审批路由零改动
- 接口验证价值最高：压测 `Envelope.threadId` 与 mrkdwn 转换两个飞书未覆盖的接缝维度

备选：Telegram（裸 Bot API 长轮询，[G] `tg_adapter.go` 全文件即纯 HTTP 先例）或企业微信（回调模式需公网入口，[G] `wecom_adapter.go`）——风险均高于 Slack。

**前置结构调整**：Slack 消息 ID 是 `channel:ts` 组合且带原生线程（S6），需在 Phase 0 的 `Envelope` 预留可选 `threadId?: string` 字段（协议形状参考 [G] types.go，Phase 1–3 飞书路径不填即可，避免 Phase 4 改核心类型）。

## 6. 测试清单总览

- **packages/im**：8 个测试文件（对应 Phase 0 任务 0.3–0.8），全部经公共接口测，不测私有函数（接口即测试面）
- **main 侧**：`im-service.test.ts`（假 agentProcess + 假 store）、`im-bindings-store.test.ts`（内存 SQLite）
- **协议零改动**：E1/E7 现有形状足够，不新增 envelope 类型 → 不触碰 reducer 兼容性红线（[A] AGENTS.md "versioned envelope + idempotent reducer" 不变量）
- **真机冒烟清单**：Phase 1/2 出口各一份，见上

## 7. 风险登记（上位文档之外的新增项）

| 风险 | 等级 | 缓解 |
|---|---|---|
| `submitTurnToThread` 抽取触碰 main.ts:5300-5420 既有逻辑（goal 授权、memory recall、checkpoint） | 中 | 抽取为纯移动不重写；抽取后跑现有 main 测试套件 + `npm run verify:goal-parity` |
| 审批拦截插入点影响 automation 自动批准路径 | 中 | 拦截顺序：automation 优先（现有行为不变），IM 拦截只处理非 automation 线程 |
| 飞书开发者后台配置错漏（权限/事件订阅/卡片回调分散在三处） | 中 | 证据 E21 + §2.7 清单做成设置页 checklist 向导；启动时 `getMe` 等价调用（bot/v3/info）失败即给出指向性报错 |
| node SDK 与 [G] Go SDK 的 API 形状差异（本文档 §2.7 按 Go 版结构描述） | 中 | Phase 1.1 落地时对照 `@larksuiteoapi/node-sdk` 文档逐条核对（WSClient/EventDispatcher/card.action.trigger 的支持形态），差异处回写本文档；SDK 版本 pin 到核实的版本 |
| main.ts 已超 1.4 万行，继续膨胀 | 低 | im-service.ts 独立文件，main.ts 只加 3 处接线点（broker 拦截、emitPayload 挂点、启动恢复） |
| 配对码 4 位空间小（10⁴） | 低 | 沿用 [G] #719 硬化参数（TTL 5min + 错 5 次 + 拉黑 3 次），已被 ggcode 生产验证 |
| 飞书频控导致长答复延迟（28000B/段 × 300ms 间隔） | 低 | 段数 = 字节数/28000，日常答复 1–2 段；verbose 模式用户自选承担 |

## 附录 A — Slack 适配器证据表（Phase 4 首选，2026-09-01 调研）

> 来源：[G] `internal/im/slack_adapter.go`（1366 行生产实现）+ `message_split.go` / `reaction_ack.go` 实际读取。
> Node SDK 事实：`@slack/bolt` 5.0.0 MIT / `@slack/socket-mode` 3.0.1 / `@slack/web-api` 8.1.1（2026-09-01 npm 核实）。

| # | 设计点 | 证据 |
|---|---|---|
| S1 | 双 token 模型 + Socket Mode 连接 | [G] `slack_adapter.go` `newSlackAdapter`：`bot_token`（xoxb-，Web API 收发）+ `app_token`（xapp-，开连接）均必填，缺则构造抛错。连接流程：`auth.test` → `apps.connections.open` 拿 WS URL → 原生 WebSocket |
| S2 | 重连循环 + 终态认证错误（#603） | `run()`：退避 `[2,5,10,30,60]s` + 干净断开重置 attempt（与 TG 同款语义）；`slackTerminalAuthErrors`（invalid_auth/token_revoked/token_expired/account_inactive 等）命中即永久退出报 error——坏 token 不能每 60s 空转 |
| S3 | WS 保活 | ping 每 60s + 读超时 90s：Slack Socket Mode 底层 AWS API Gateway 空闲 10 分钟断连（`slackWSPingInterval`/`slackWSReadTimeout` 常量注释） |
| S4 | envelope ack 必须无条件（#968） | `slackAckForEnvelope`：每个带 `envelope_id` 的 envelope 都必须回 ack 帧；`accepts_response_payload` 只决定 ack 能否带载荷，**不决定要不要 ack**——ggcode 早期按标志判断导致大量重投。去重 key=`channel:ts`，容量 1000 + 5min TTL |
| S5 | 机器人 mention 剥离（#540） | `stripBotMention`：频道里触发靠 @机器人，文本带字面量 `<@U123>` 或 `<@U123|名字>` token，不剥则 `/status` 前缀匹配失败、审批回复"y"匹配不上词表；其他用户的 mention 保留 |
| S6 | 消息 ID 与线程 | Slack 无独立 message_id，`ts`（时间戳）即 ID；线程回复带 `thread_ts`，`Envelope.ThreadID` 字段为 Slack 而设（[G] types.go）——Artemis 侧需在 Phase 0 预留 `threadId?` |
| S7 | mrkdwn 转换（Slack 独有增量） | `markdownToMrkdwn`：`**粗**`→`*粗*`、`*斜*`→`_斜_`、`~~删~~`→`~删~`、`[文](链)`→`<链|文>`、标题降级粗体、GFM 表格转纯文本对齐；代码块/行内代码先占位保护防误转换。约 150 行，10+ 正则 |
| S8 | 分片与频控 | `message_split.go:40` `PlatformSlack: 12000`（`markdown_text` 上限，按字符+markdown 边界切）；频控每频道 ~1 msg/秒，段间隔 500ms；429 走 `Retry-After`，且 HTTP 200 body 内 `ok:false, error:"ratelimited"` 也要重试（`sendChannelMessage` 双形态处理） |
| S9 | 审批/typing/图片 | 审批：Block Kit `actions` 块按钮，回调经 Socket Mode `interactive` envelope（`block_actions`）送达——**无需后台额外配置**（优于飞书）；审批后 `chat.update` 改原消息。Typing：bot 无原生 API，`reactions.add` 加 emoji，`already_reacted` 不算错误。图片：入站 `files[].url_private_download` + Bearer；出站 `files.upload` multipart——**注意 ggcode 自注该 API 已弃用，新实现应改用 `files.getUploadURLExternal` 两步流程** |

**Node 侧 SDK 决策（待定，落地时再定）**：
- 选 `@slack/bolt`：省手写 WS/envelope/ack，但 middleware 事件模型与 `IMAdapter.onInbound` 回调风格需适配层
- 裸实现（仅加 `ws` 包）：对照 [G] 逐行移植，ack/去重/ping 语义完全可控，多约 200 行但少一层框架映射
- 倾向裸实现：ggcode 全适配器仅用 gorilla/websocket 通用库，证明 Socket Mode 是标准 JSON over WS，无平台私有协议（与飞书必须 SDK 的情形不同）


## 附录 B — 实施偏差记录（2026-09-01 真机验证后回写）

> Phase 0–3 已实施并真机验证（配对 + 双向通信链路）。与正文设计的有意偏差：

| # | 正文设计 | 实施结果 | 理由 |
|---|---|---|---|
| D1 | §3.1 审批拦截插入 handleBrokerRequest 各 handler | 改走 `emitPayload` 事件路径：`approval.requested` 是所有 ask 分支的唯一出口，在 onAgentEvent 里拦截 | 侵入面更小（main.ts 少 N 个插入点）；automation 优先级靠 `source === "automation"` 跳过自然保持 |
| D2 | §6 "协议零改动" | `approvalResolutionSchema`/`approvalRequested`/`approvalResolved` 的 source 枚举加了 `"im"` | E3 形状已预留 source 语义，决策 2 要求可审计；reducer/UI 不按 source 分支（已核实），additive 兼容 |
| D3 | E20 用 WSClient + EventDispatcher | 实际用 SDK 更高层的 `LarkChannel`：token 生命周期/自动重连/消息去重/bot mention 剥离/markdown→card 2.0/429 重试全部内置 | 安装包 types 核实后确认覆盖 E12/E22/E23 全部手写逻辑；E14 dedup 仍在 manager 作第二道防线 |
| D4 | §2.4 manager 接口 | 新增 `onReplyToChannel`（配对回复出口）、`dropPendingApproval`/`hasPendingApproval`（UI 先决议清理） | 真机缺陷：配对 replyText 起初无发送出口；ggcode 由适配器自回 |
| D5 | §4 PersistedSettings | version 升 2，新增 `imAdapters`；凭据键 `im:feishu:{name}` 用 `api_key.env` 形状存 appId/appSecret | 复用现有 credentials 加密通道 |
| D6 | —（正文未含） | `ARTEMIS_USER_DATA_DIR` 环境变量支持并行隔离实例 | 真机冒烟需要与日常实例并存（main.ts app ready 前 setPath） |
| D7 | 配对批准无渠道回执 | `approvePairing` 成功后回发"配对成功，已绑定"（对齐 ggcode） | 真机 UX 反馈 |
| D8 | §3.2 翻译层假设 `turn.completed.text` / `tool.call` / `tool.result` / `turn.failed.error` | 按 schema.ts 真实形状重写：`message.part.delta` 聚合成全量答复；`turn.failed.message`；`tool.started`/`tool.completed`；`message.superseded` 丢弃被替换 part | 真机缺陷 2026-09-01：旧形状下 turn.completed 永远产出 []，飞书收不到任何答复；旧单测按同一虚构形状编写所以全绿（测试面≠真实面教训） |
| D9 | E7 图片附件直转 PromptAttachment | 增加 SDK 占位符清洗：`![image](image_key)` → 下载成功 `[图片]` / 失败 `[图片下载失败]`；下载失败从静默 catch 改为 console.warn | 真机缺陷 2026-09-01：占位符原样进入 prompt 并显示在线程 UI；静默吞错使权限类失败（如缺 im:resource）不可诊断 |
| D10 | —（正文未含） | 出站富媒体：`extractMediaFromText`（media.ts）从 outbound 文本提取 markdown 图片 / 裸图片 URL / data:image / 本地 .mp4 视频，交给 SDK `SendInput` 的 `{image}` / `{video}` 发送；data:image 先 `decodeDataImageUrl` 解码为 Buffer | 对齐 ggcode `ExtractImagesFromText`；SDK `toBuffer` 已原生承担 URL 下载 + 本地路径读取（含 SSRF 防护 + 大小限制），`packages/im` 保持零 Electron 依赖 |
| D11 | E1/`submitTurn` 附件仅覆盖空闲态 | 运行中线程（`threadStatus` running/waiting-approval）的入站图片附件经 `IMServiceHost.followUp` 透传 `attachments`，`turn.follow-up` 协议原生支持 | 真机链路确认：线程运行中发来的图片不能丢；协议与 `queueTurn` 均已支持 |
| D12 | —（正文未含） | 配对待批准态推送：`IMManager.onPairingAwaitingApproval` → `IMServiceHost.notifyPairingAwaiting` → main 发 `IPC.imStatusChanged` → 设置面板 `onIMStatusChanged` 订阅刷新 | 目标 1：配对码正确后设置面板需主动刷新显示批准/拒绝 UI（原仅挑战态有 notifyPairing） |
| D13 | E5 订阅点仅挂 `emitPayload` 单发路径 | 抽出共用尾部扇出 `fanOutPersistedPayload`（side effects + goal + changeSet + `imService.onAgentEvent`），`emitPayload` 与 `emitPayloadBatch` 两路共用；源码结构回归测试 `im-outbound-wiring.test.ts` 锁定 | 真机缺陷 2026-09-04：agent worker 的流式 turn 事件全部经 `AgentEventBatcher` → `onEvents` → `emitPayloadBatch` 批量上报，单发路径只有 main 侧事件——IM 出站订阅对 turn 事件完全失明，桌面 UI 正常但飞书端收不到任何模型回复（配对回执走 `adapter.send` 直发所以不受影响） |
| D14 | —（当日废弃） | ~~心跳（可编辑状态消息 + editMessage/recallMessage）~~ 真机反馈当日撤回：改用 Typing 表情方案——① 入站受理即触发 `triggerTyping`（原仅 turn.started，用户发送后要等数秒）；② **turn 终态经 `clearTyping`/`removeReactionByEmoji` 移除表情**（只删机器人自己加的那条；ggcode 不做清除，表情永久残留）；③ 适配器失败从静默 catch 改为 console.warn（缺权限 403 可诊断）；④ 配置清单新增 `im:message.reaction:write` 权限 chip | 真机反馈 2026-09-04：心跳消息机制不要；用户要的是 ggcode 同款"消息上的 Typing 表情"，且回复送达后表情应消失。ggcode feishu `TriggerTyping`（feishu_adapter.go:1202）= 用户最新消息加 "Typing" emoji reaction。飞书加/删表情均需 `im:message.reaction:write` 权限（此前清单缺失 + 失败被静默吞 → 真机上从未出现过） |
| D15 | §3.2 summary 模式 turn 边界产出 `tool_summary`（工具计数） | 整体废弃 `tool_summary` 事件类型：summary 模式 turn 边界只发聚合文本（verbose 的 `tool_detail` 流不变），`TurnToolStats`/stats() 一并移除 | 真机反馈 2026-09-04："别告诉我用了几个工具，我只关心最终的结果"。ggcode `EmitRoundSummary` 同样显式丢弃工具计数（`_, _, _ = toolCalls, toolSuccesses, toolFailures`），印证该取舍 |
| D16 | E7/D9 图片下载沿用 SDK `downloadResource`（im/v1/images/{image_key}） | 用户图片改走「消息内资源」接口 `GET im/v1/messages/{message_id}/resources/{file_key}?type=image`：`FeishuChannelLike` 增加可选 `downloadMessageResource`，`defaultChannelFactory` 基于公开属性 `rawClient` 补齐实现，缺省时回退 `downloadResource`（兼容缝）；空缓冲与抛错同权——warn + `[图片下载失败]`，占位符不泄漏 | 真机缺陷 2026-09-04：`downloadResource` 走的 `im/v1/images/{image_key}` 仅服务机器人自己上传的图片，用户消息里的 image_key 一律 HTTP 400 → 全部显示 `[图片下载失败]`（与权限无关）；ggcode feishu_adapter.go:890 即用 messages/resources 接口。修复后真机复验：下载成功，线程文本显示 `[图片]`；图像数据最终是否被消费取决于推理后端视觉能力（glm-5.3 被 pi 运行时以 "model does not support images" 省略——读图需切换视觉模型，与 IM 链路无关） |
| D17 | E7 图片下载成功后文本保留 `[图片]` 标记 | 成功时占位符剥离为空（图片已在气泡内联展示，标记冗余）：纯图片消息 text=""（`user.message` schema 允许空串，Timeline 文本非空条件渲染天然只显示图片）；`startTaskTurn` 显示层 emitInitialTurn 改传原始 `text`，模型侧 `requestText` 兜底（"Inspect the attached files."）只进 turn.prompt 不进气泡；`turn.follow-up` schema 要求 text min(1)，im-service 对纯图片 follow-up 补 `[图片]` 入队标记 | 真机反馈 2026-09-04："图片消息，我能看到图片，不用在消息下方还出现 [图片]"。memory-turn-integration 结构测试同步更新（显示层 text / 模型侧 requestText 分离） |
| D18 | 决策 2 线程标题 `[FS] 姓名`；无渠道连接状态可视 | ① 标题改「飞书 · 姓名」（approvePairing + not-found 重建两处）；② 会话条 IM 徽标：manager 新增 `onAdapterStateChange` 回调 → im-service `notifyIMStatusChanged` → main 推 `IPC.imStatusChanged` → App 订阅刷新 `getIMStatus`，绑定线程标题旁显示「飞书」chip（绿点=已连接 / 红点=断链，title 提示）；`.thread-title-wrap` 与标记列 grid 兼容 | 真机反馈 2026-09-04：`[FS]` 前缀不直观；且左侧会话列表看不出飞书是否还连着。断链推送此前缺失（imStatusChanged 只在配对事件发） |
| D19 | manager 路由层对空文本一律丢弃（`routeInboundText("")` → empty → dropped） | 空文本 + 附件（纯图片消息）改走 message 路径（复用单活跃绑定守卫），仅文本与附件都为空才丢弃 | 真机缺陷 2026-09-04（D17 引入的回归）：D17 把纯图片消息文本剥离为空串后，消息在进入 im-service 之前被路由层丢弃——"从飞书端发图片接收不到"。ggcode 对照：feishu_adapter.go:354 即"文本与附件都为空才丢弃"；其 daemon 桥反而会丢纯图片（daemon_bridge.go:407），不可取 |
| D20 | 主进程侧创建的 IM 线程对渲染层不可见（getSnapshot 仅挂载时拉取） | `imHost.createThread`（配对批准 + not-found 重建的唯一产生点）成功后推 `IPC.imThreadCreated`；api/preload 暴露 `onIMThreadCreated`；App 订阅 → 刷新 snapshot（preserveLoadedEvents）+ refreshIMThreadHealth（与 imStatusChanged 订阅共用回调） | 真机缺陷 2026-09-04："删除飞书会话后重发消息，没有新会话产生"——DB 实证主进程重建完全正常（线程已建、绑定已改指、turn 跑完、飞书已收到回复），但抽屉直到重启都看不到新会话。ggcode 对照：其 Manager 每次状态变化都经 onUpdate 推送快照（UI 永不轮询），正是缺的这一环 |
| D21 | triggerTyping 在 `await addReaction` 之后才写去重标 | 先打标再请求（失败不回滚——typing 是 best-effort，避免反复刷失败日志） | 真机缺陷 2026-09-04（231015 回归）：入站受理与 turn.started 兜底在毫秒级并发触发同一消息，await 后打标挡不住第二个在途请求 → 飞书返回 `231015 Act on reaction failed, repeated request is processing`。该报错同时证明 `im:message.reaction:write` 权限已生效（表情实际已加上） |

**真机冒烟已验证**（2026-09-01，隔离实例）：飞书私聊 → 配对引导回复 → 回码 → 桌面批准 → 渠道回执 → `[FS]` 线程执行。
**2026-09-01 修正**：当时"答复回发飞书"结论不成立——出站翻译层字段与真实协议不匹配（D8），答复实际从未送达；已于同日修复并补真实事件流回归测试。
**待真机复验**：答复出站（D8 修复后）、图片附件（D9 修复后；若线程显示 `[图片下载失败]`，查 main 进程日志 `[im:*] image download failed`，大概率缺 `im:resource` 权限或未发版）、审批卡片按钮（需后台配 card.action.trigger）、进程重启恢复、/verbose 切换。
**2026-09-04 新增（D10-D12）待真机复验**：① 出站富媒体——agent 答复含 markdown 图片/URL/本地 .mp4 时，飞书应收到独立图片/视频消息（图片限 10MB；本地文件路径默认放行，仅 POSIX 块表 `/etc /proc /sys /dev` 拒读）；② 线程运行中飞书发图 → 桌面会话面板用户气泡内应显示内联缩略图（readTaskSourceImage 取回，SourcesPanel 同款）；③ 配对码正确后设置面板「消息接入」页应自动从「显示配对码」切到「批准/拒绝」按钮，无需手动刷新。
**2026-09-04 D16 修复后复验通过**：飞书发图 → 下载成功，线程文本显示 `[图片]`，附件可进入模型上下文；图像数据最终是否被消费取决于推理后端视觉能力（当前 glm-5.3 会被 pi 运行时以 "model does not support images" 省略——读图需切换视觉模型，与 IM 链路无关）。
**2026-09-04 D13 修复后复验提示**：此前 D8 修复的「答复出站」在真机上仍不生效——批量事件路径（`emitPayloadBatch`）绕过 IM 订阅，D13 修复后一切模型答复（含富媒体提取）才真正可达飞书端；此前所有出站相关复验结论需以 D13 修复版重测。
**2026-09-04 新增（D14/D15）待真机复验**：① Typing 表情——先在飞书开发者后台给应用开通 `im:message.reaction:write`（添加/删除消息表情回复）并**发布新版本**，然后从飞书发消息，该消息上应立即出现 Typing 表情；**turn 结束（回复送达）后表情应自动消失**（clearTyping/removeReactionByEmoji）；若不出现或不清除，看 main 日志 `typing reaction failed/remove failed (om_…)` 告警（此前失败被静默吞，无从诊断）；② 回复不再包含"共执行 N 个工具"统计，summary 模式只发最终答复文本。
**2026-09-04 新增（D17/D18）待真机复验**：① 飞书发图 → 桌面气泡只显示图片本身，不再出现 `[图片]` 文本（纯图片消息气泡无文字；带文字的图片消息只显示文字+图片）；② 新配对的会话标题为「飞书 · 发送者」（存量 `[FS] x` 线程不自动改名，可手动重命名）；③ 左侧会话列表中 IM 绑定的会话标题旁有「飞书」chip——绿点=已连接、红点=断链（断网/停适配器后应自动变红，恢复后变绿）。
**2026-09-04 新增（D19/D20）待真机复验**（D17 复验前必须先装上本批修复，否则纯图片必然收不到）：① 飞书发**纯图片**（不带文字）→ 桌面应出现只含图片的用户气泡、模型侧收到 "Inspect the attached files." 兜底 prompt；运行中的线程发纯图片同样入队不丢；② 在桌面删除飞书绑定的会话 → 从飞书重发任意消息 → 左侧抽屉**无需重启**应立刻出现新的「飞书 · …」会话（重建 + D20 推送；顺带验证新会话标题不再是 `[FS]`）；③ 现存旧 `[FS]` 会话已可全部删除，之后不会再出现该前缀。
**2026-09-04 环境定性（非代码缺陷）**：真机"无论文字图片都提示『正在等待网络恢复』"——事件流实证消息全部到达、turn 正常启动，卡在模型端点连接重试（zai/glm-5.3，connection 重连指数退避）。`api.z.ai`/`chat.z.ai` 解析到 fake-ip（198.18.0.96）且系统代理开启：代理处于系统代理模式时 Node/Electron 不认 macOS 系统代理 → 直连 fake-ip 必败（open.feishu.cn 正常所以 IM 双向通畅）。**恢复方式：代理切回 TUN/增强模式**，重试中的 turn 会自动续跑。D21 同批修复（typing 231015 并发竞态），复验 Typing 表情时不应再出现该告警。
**已知限制**：dev 态未签名 Electron 的 macOS 系统通知被吞（通知权限），配对码以设置页卡片为准。
