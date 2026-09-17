# IM 设置面板精简重构调研报告

- 日期：2026-09-17
- 状态：调研完成，方向待拍板（布局草图已定稿，扫码路线已实证）
- 关联文档：`docs/projects/im-guided-settings/wiring-plan.md`（现行三步流实施档案）

## 1. 背景与问题

现行「消息接入」设置面板为三步引导流：①连接服务 → ②接入渠道 → ③授权项目（N/3 进度）。调研动机有三：

1. 三张手风琴卡在设置完成后仍有较大视觉存在感，重入换凭据/加渠道的路径偏长；
2. 渠道接入（尤其飞书）要求用户去开放平台后台手动建应用、复制凭据、开权限、发布，摩擦大；
3. 实际案例：飞书自建应用未开「获取企业信息」权限时，自动获取 Tenant Key 失败，报错只给了绕行指引（高级设置手填），没有消除问题本身。

本报告回答四个问题：启用/关闭开关能否替代①卡（§3）；接入渠道×授权项目能否按渠道合并（§4）；两栏布局方案（§5）；ZCode 扫码接入机制能否照搬到 Artemis 的飞书与 Slack 渠道（§6、§7）。

## 2. 现状机制盘点

### 2.1 启用/关闭开关（运行层）

面板头部总开关 = `settings.enabled`，控制运行层暂停/恢复：禁用时置 state=disabled、释放网关租约（`/v1/device/release`）、停止轮询；已有配置与授权保留。启用有前置校验：`enableReason` 拦截无 deviceId / 无 bot 连接的情况；`im-service.ts save()` 强制 `enabled=true` 必须已有 deviceId + token。

### 2.2 ①连接服务卡（配置层）

职能是**设备注册 + 网关端点选择**：

- 本机一键（`setup-local`）：启动本机 Gateway 进程并以管理凭据注册设备，签发 deviceId；
- 团队服务器（`register`）：URL + 管理令牌 → `/v1/admin/register` 换设备凭据入 Keychain；
- 另有设备 ID 展示、导出网关包。

重新注册/切换网关要求先暂停（"Pause IM before changing device registration"）。代码注释 D1 决议：**首跑流程不出现总开关**（避免与引导流双入口打架）。

### 2.3 授权项目（grants）的数据模型

**授权轴 = 设备 × 项目，没有渠道维度**：

- `executionGrantSchema`（`packages/protocol/src/im.ts`）：`projectId / mode / shell / network / security.scopes / groups(群白名单) / expiresAt`，无渠道字段；
- 网关 `requireImGrant`（`im.ts:549`）只查 deviceId + projectId + 群白名单；
- 身份五元组 `{channel, connectionId, tenantId, appId, userId} → deviceId`：消息从哪个渠道进来，解析到设备后用的是同一份授权；
- 这是**有意的信任模型**：所有绑定身份都是同一个主人，渠道只是不同的"门"。

## 3. 问题一：启用/关闭开关能否替代①连接服务卡

**结论：替代不了，但可以吸收。** 开关是运行层（这台电脑"现在接不接活"），①是配置层（这台电脑是谁、消息从哪台网关进来）；开关的启用前置恰恰是①的产物。

可行的减法路线：**总开关智能化**——首次拨 ON 且未注册时自动链 `setup-local → enable`，①卡整体消失；团队服务器注册与设备 ID 挪到概览页或「高级」区。代价与约束：

- 推翻 D1 决议（首跑不显示总开关）——合并后开关成为唯一入口，需有意重议；
- `setup-local` 可能失败（端口占用等），开关需要错误呈现与重试路径（面板现有 message 机制可承接）；
- 团队服务器用户首跑仍需填表单，远程分支保留表单落点。

## 4. 问题二：接入渠道×授权项目按渠道合并是否可行

分两层：

1. **纯 UI 合并**（③内容搬进渠道 tab，数据不动）：可行、便宜，但必须显式标注「授权对此设备所有渠道生效」，否则用户在飞书 tab 取消勾选会同时影响其他渠道，会被理解成 bug。
2. **真·按渠道授权**：**渠道可能不是正确的轴**——飞书两个租户 = 同一渠道下两条 bot 连接（tenantId 不同），按渠道拆分无法区分它们；企业隔离诉求的正确粒度是**按连接（bot）拆**。且这是协议 schema、网关 `securityAllowed`/租约链路、桌面 `save()` 校验、面板四层联动的**安全边界变更**，按仓库规矩必须先补策略回归测试（见 AGENTS.md）。

**当前决议（§5 布局已体现）：不按渠道拆授权。** 渠道行不显示授权项目数（若显示，每行是同一个数，冗余且暗示渠道各自授权）；授权项目保持设备级、独立成卡。

## 5. 布局决议：两栏主设置区（定稿）

左栏 = "这台电脑是谁、能碰什么"（连接服务 + 授权项目）；右栏 = "门"（渠道列表）。渠道配置内容从主界面消失，下钻进渠道详情（复用现行②卡全部内容：平台接入指引、机器人列表、配对、顺手验证）。

```
┌ 消息接入 ────────────────────────────────────────────────────────────────┐
│  通过 IM 把任务交给这台电脑执行。      [●已连接·本机]        启用 ──⚫   │
│                                                                         │
│  ┌ 连接服务 ───────────────────────┐   ┌ IM 渠道 ──────────────────┐  │
│  │                                 │   │                            │  │
│  │  ● 已连接 · 本机 Gateway        │   │  ┌──────────────────────┐  │  │
│  │  设备 ID  a1b2c3d4e5     [复制] │   │  │ 🟢  飞书 / Lark      │  │  │
│  │  ▸ 团队服务器（高级）           │   │  │    已连接·1 个机器人 │  │  │
│  │                                 │   │  └──────────────────────┘  │  │
│  │  （未注册时=大按钮              │   │  ┌──────────────────────┐  │  │
│  │   「一键开启消息接入」）        │   │  │ ⚪  企业微信         │  │  │
│  │                                 │   │  │    未配置            │  │  │
│  └─────────────────────────────────┘   │  └──────────────────────┘  │  │
│                                        │  ┌──────────────────────┐  │  │
│  ┌ 授权项目 ───────────────────────┐   │  │ ⚪  Slack            │  │  │
│  │  3 个项目 · 所有渠道通用        │   │  │    未配置            │  │  │
│  │                                 │   │  └──────────────────────┘  │  │
│  │  ☑ 临时会话           [默认]    │   │                            │  │
│  │  ☑ Test project.Plan  [默认]    │   │  ＋ 添加渠道              │  │
│  │    整个项目可读                 │   │                            │  │
│  │  ☐ Other project               │   │       [机器人管理]        │  │
│  └─────────────────────────────────┘   └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

要点：

- 渠道行 = **品牌图标 + 渠道名**（粗体）+ 状态灯 + 一行状态（已连接·N 个机器人 / 未配置 / 连接错误）；整行可点 → 右栏下钻渠道详情（带返回）。
- 授权项目卡头显示「N 个项目 · 所有渠道通用」，替代渠道行上的重复计数。
- 品牌图标入库：企微、Slack 有现成 Remix 图标；**飞书无现成 Remix 图标，需内置官方 SVG 路径**（走 icons.tsx 两处同步 + build:ui-libraries 流程，同 bot-add/copy 先例）。
- 首跑形态待定：连接服务卡内的「一键开启」大按钮 vs §3 路线的总开关吸收。

## 6. 飞书扫码接入：机制拆解与实证（可照搬）

### 6.1 机制（ZCode 桌面 3.12.3 拆包）

飞书官方提供 **OAuth 应用注册端点**，客户端直连、无需任何服务器：

```
POST https://accounts.feishu.cn/oauth/v1/app/registration   （Lark: accounts.larksuite.com）

① action=init    → { supported_auth_methods: ["client_secret", "private_key_jwt"] }
② action=begin   → 参数 archetype="PersonalAgent"、auth_method="client_secret"、
                   request_user_info="open_id"
                   返回 device_code + verification_uri_complete + user_code
③ 二维码内容 = 飞书官方 verification_uri_complete URL（非第三方链接）
   用户用飞书 App 扫码 → 登录 → 确认创建应用（可填应用名）
④ action=poll（约 5s，pending / slow_down / access_denied / expired）
   成功返回：client_id + client_secret + app_name + tenant_brand(feishu/lark)
            + user_info.open_id（扫码人自己的 Open ID）
```

这是标准 OAuth Device Authorization 流；**中间没有 ZCode 服务器**。凭据回来直接喂 lark SDK `WSClient({appId, appSecret, domain})` 长连接收 `im.message.receive_v1`。拆包找不到任何后续权限配置/发布调用——`PersonalAgent` archetype 预置了应用能力。

### 6.2 真机实证（2026-09-17 全链通过）

| 环节 | 证据 |
|---|---|
| 扫码签发 | ZCode 配置出现 `cli_a95a…` 应用（凭据密文入库，90 字符） |
| 启用 | config `enabled: true`（ZCode 扫码后仍留一步启用开关） |
| 长连接 | ZCode 进程实挂 open.feishu.cn CDN 段 TLS（lsof 183.194.209.42:443 ≈ 解析 183.194.209.46 同段） |
| 收消息/绑定 | 「消息绑定」成功 = `im.message.receive_v1` 已预置并工作 |

**结论：PersonalAgent 扫码应用零控制台可用**——机器人能力、事件订阅、免发布全预置。用户全程未访问飞书开放平台后台。

### 6.3 Artemis 落地要点

1. **可行性：高**。端点官方公开（可先 `action:init` 探测，不支持时回退手动路径）；Artemis 本用同款 WSClient（`feishu-socket.ts`），凭据即插即用。
2. **顺带解掉 Tenant Key 死路**：长连接模式下事件走带认证的 socket，无 webhook 签名校验面；`tenantId` 可从首条事件 header 取，或对 websocket 连接置为可选。
3. **免配对**：注册响应带扫码人 open_id，可直接预绑定该身份到本设备（五元组现成），主人扫码即完成绑定；`/pair` 码保留给绑定其他成员。
4. **交互形态**：渠道详情页首屏放「扫码接入」（begin → 渲染二维码 → poll → 成功自动填入并启用），手动表单降级为「高级」回退。
5. **风险**：端点未见公开文档（ZCode 传 `source=node-sdk/zcode`，疑似 lark node-sdk 官方通道，存在接口收敛风险）；企业管理员禁止成员自建应用时扫码被拒——手动路径必须保留。
6. **边界约束**：websocket 连接放宽 `tenantId` 校验属 IM 安全边界改动，**先补策略回归测试**再动（AGENTS.md），并建议知会上游。

## 7. Slack 套用扫码授权：不可行照搬，云端一键安装是唯一近似形态

### 7.1 三支柱对比：飞书扫码模式为什么成立

| 支柱 | 飞书 | Slack |
|---|---|---|
| 客户端直连**创建应用** | `oauth/v1/app/registration`（官方端点，实测可用） | 不存在。`apps.manifest.create` 需 `sconf-` 应用配置令牌，而该令牌**只能人在 api.slack.com/apps 手动生成一次，无任何 API 引导** |
| 凭据**直达客户端**、客户端自挂长连接 | Device Grant 直接回 client_id/secret；WSClient 长连接 | 分布式安装走授权码流，token 落在**发布者的 HTTPS 回调服务器**（`oauth.v2.access` 交换需 client_secret）；`http://localhost` 回调只对本人 dev app 可用，分布式安装不收 |
| 模板**预置能力**、免发布 | PersonalAgent archetype（已实证） | 无对应概念；且 **Socket Mode 官方主要面向内部/单工作区应用**——分布式多租户场景每个安装需自己的 socket，官方主推 webhook（公网 HTTPS 回调，本地桌面不可达） |

旁证：ZCode 的渠道列表干脆没有 Slack（拆包零 slack 字符串，只有微信 iLink / 飞书 / Lark / Telegram）——Slack 的自助接入摩擦是行业公认的。

### 7.2 Slack 能做到的「最接近形态」：托管一键安装（Add to Slack）

```
Artemis 官方发布一个 Slack App（manifest 固定，client_secret 在 Artemis 托管中继）
桌面端发起安装会话(state) → 展示授权 URL（二维码意义不大：授权页是网页，
  桌面直接开浏览器更顺）→ 用户选工作区 → Allow
→ Slack 回调中继服务器 → 中继换 token → 经待定会话把 bot token 下发给桌面
```

代价：① Artemis 必须运营常驻中继服务（与"本机网关本地优先"叙事冲突；团队网关场景自洽）；② 分布式应用的事件走 webhook（公网 HTTPS），**本地桌面收不到 Slack 事件**，必须由中继/团队网关接收再转发——Slack 渠道天然是"云渠道"，与飞书 WS 长连接的本地直连性质不同；③ token 托管与企业合规信任问题；④ 应用目录上架另需 Slack 审核。

### 7.3 建议

- **飞书**：实施扫码接入（首选路径 + 手动回退）。
- **Slack**：**维持现行手动 manifest 流**（`ImSlackSetup` 复制 manifest → 控制台建应用 → Socket Mode token → 粘贴）；托管一键安装列为团队网关版本的独立议题，需先做云服务决策，不建议与本次精简重构捆绑。
- 企业微信/Telegram 等其他渠道未在本报告范围，后续按同法分析（企微可控性更差，Telegram BotFather 路径与本报告 Slack 手动路径同类）。

## 8. 落地路线（建议顺序）

1. **原型**：两栏主设置区 + 渠道行（品牌图标+名称+状态）+ 渠道详情下钻；授权项目卡头计数（原型侧先行，用户验收布局）。
2. **品牌图标入库**：feishu/wecom/slack 三枚（feishu 内置官方 SVG），icons.tsx 两处同步 + build:ui-libraries。
3. **生产**：连接服务+授权项目左栏迁移、渠道下钻重构；主开关智能化（§3 路线）与 D1 重议单列一笔。
4. **飞书扫码接入**：先真机验证 Artemis 侧 `begin/poll` 全链（可复用本报告 §6.1 参数）→ 渠道详情首屏扫码路径 → openId 预绑定 → websocket tenantId 放宽（**回归测试先行 + 上游知会**）。

## 附录：证据与来源

- ZCode 拆包：`/Applications/ZCode.app/Contents/Resources/app.asar`（2026-09-17 提取，`out/host/index.js` 含注册流实现与 WSClient 连接；`out/renderer/assets/IntlProvider-*.js` 含 UI 字符串）。
- 用户真机扫码产物：`~/.zcode/v2/bot-config.v3.json`、`~/.zcode/v2/credentials.json`（密文）。
- 端点 probe 实测（2026-09-17）：`POST action=init` → `{"supported_auth_methods":["client_secret","private_key_jwt"]}`。
- Slack 官方文档：
  - [apps.manifest.create method](https://docs.slack.dev/reference/methods/apps.manifest.create)
  - [Configuring apps with app manifests](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests)（`sconf-` 令牌需人工生成）
  - [Installing via OAuth](https://docs.slack.dev/authentication/installing-with-oauth)（redirect_uri HTTPS 要求）
  - [Using Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode)（xapp 令牌与三步设置；内部应用定位）
  - [App distribution guide](https://docs.slack.dev/tools/java-slack-sdk/guides/app-distribution)（分布式安装的托管回调要求）
