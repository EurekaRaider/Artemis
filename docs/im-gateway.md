# Artemis IM 与跨 IM 协作

IM 功能默认关闭。Gateway 可内置运行或独立部署；桌面通过认证的 HTTP 传输拉取持久请求并回传结果，外部服务强制 HTTPS，内置服务仅监听本机回环地址。Gateway 不运行模型，不接收本地模型密钥，也不暴露 Electron IPC。Pi 仍是桌面的唯一 Agent 执行循环。

## 一键设置（推荐）

在 Artemis 设置 → **IM 连接**点击“一键启动并注册”。安装版已包含 Gateway 及运行时，不需要源码、Node.js、npm 或命令行。Artemis 自动启动仅监听 `127.0.0.1` 的服务、选择空闲端口、独立生成管理凭据和加密密钥、用系统凭据加密保存，并注册当前设备。后续启动自动恢复同一设备和已有配置。系统凭据加密不可用时拒绝初始化，不会改为明文保存。

内置服务随 Artemis 运行；远程使用时保持电脑唤醒、应用开启。企业微信长连接和 Slack Socket Mode 不需要公网入口。选择项目及执行权限仍由用户明确完成；初始化不会开放项目或自动启用执行。正常关闭释放设备会话；异常退出后旧会话最多等待 45 秒过期。

## 独立部署（团队管理员）

在第 1 步展开“高级”，点击“导出独立运行包”。把包复制到服务器并解压，安装 Node.js 24 或更新版本后，在解压目录执行：

```sh
node gateway.mjs
```

运行包不包含源码工程、源码映射、开发依赖或任何用户凭据。无需 npm 安装或编译。首次运行自动生成 `.env.gateway` 中的两份独立密钥；再次启动复用原配置。使用系统服务管理器时把工作目录设为解压目录。默认监听 `127.0.0.1:8787`，`GET /health` 返回健康状态。管理员从配置文件取得管理凭据，成员在“使用团队 Gateway”中注册；完整部署说明已附在包内。

维护者构建独立运行包可执行 `npm run package:gateway`；正常桌面构建和打包也会自动生成并附带该包。用户无需接触此开发命令。

生产访问必须在反向代理上启用 HTTPS，并将请求体上限设为至少 14 MiB；只将 Gateway HTTP 端口交给代理，保留管理员操作的 Bearer 认证。桌面仅接受 HTTPS 源地址；回环开发地址允许 HTTP。禁止重定向携带设备凭据。

一个数据库只允许一个 Gateway 实例。SQLite 使用 WAL 和独占连接，第二个进程不能同时接管数据库。部署使用持久卷；备份时先停止 Gateway，再备份数据库及加密密钥。不要在多个副本之间共享此 SQLite 文件。机器人连接凭据在数据库中使用 AES-256-GCM 加密；设备凭据只存摘要。

## 配置桌面与平台

桌面“IM 连接”页内置六步引导、平台字段说明、成功标志、可复制的配对与测试指令，以及常见问题排查。团队成员请让服务管理员协助输入管理凭据，不要在群里传递管理员密钥。

1. 点击“一键启动并注册”。如果使用团队服务，展开手动注册表单填写管理员提供的地址和凭据。
2. 在第三步“连接机器人”配置机器人；企业微信填写企业 ID、Bot ID / Secret，飞书填写 Tenant Key、App ID / Secret、Bot Open ID、Verification Token、Encrypt Key。外部管理凭据不会保存；内置服务自动管理凭据，无需填写。机器人密钥只送到 Gateway 并加密保存。Slack 只需 Bot User OAuth Token 和 App-Level Token；工作区、应用和机器人编号自动识别。
3. 企业微信由 Gateway 连接 `wss://openws.work.weixin.qq.com`，独占订阅智能机器人。请勿让其他客户端同时连接同一个 Bot ID。
4. 飞书在开放平台订阅 `im.message.receive_v1`，回调地址为 `https://你的Gateway/channels/feishu/连接ID`。启用与实际单聊、@群消息及图片/文件资源相符的应用权限；发布应用版本并安装到对应企业。Bot Open ID 必须是本机器人稳定的 open_id，不能填写 App ID。事件签名、应用、企业及时间窗口均会校验。
5. 保存机器人后自动生成配对码，也可手动更新；在**本人机器人单聊**发送配对指令，五分钟内有效。企业微信、飞书使用 `/pair 配对码`；Slack 使用普通消息 `pair 配对码`（不带 `/`，避免被 Slack 输入框拦截）。一个平台身份只能绑定一台设备，换设备前先解除旧绑定。
6. 选择远程项目、默认项目、任务模式、命令及网络权限、每次确认或范围内自动执行，点击“保存并启用连接”；选中首个项目时自动设为默认项目。连接尚未启用时也能刷新配对结果，此操作不会启动任务。

Execute 在本机沙箱启动、项目外读写探针通过后才能开放。当前远程工具集包含项目内读写、沙箱命令、澄清、计划和受限本地团队；远程 MCP、扩展、个人记忆、私有技能目录及完整桌面 shell 不开放。网络权限当前是沙箱命令的整体开关，不是按域名授权。

本地子 Agent 的写入遵守各自分工路径；命令执行和跨设备协调由根 Agent 负责。

连接 ID 固定对应平台、企业与应用或机器人。可以在原连接上更新密钥，更换企业或机器人时必须使用新的连接 ID；历史身份与待发消息不会被转交给另一个账号。

Slack 设置提供可复制的应用清单：在 Slack 创建应用时选择 From a manifest，可自动配置 Socket Mode、`message.im`、`app_mention` 以及 `chat:write`、`im:history`、`app_mentions:read`、`files:read`、`users:read`。`users:read` 用于通过 `bots.info` 校验并自动识别机器人。用户仍需在 Slack 安装应用到工作区，并创建带 `connections:write` 的 App-Level Token。每个 Slack 应用只连接一份 Gateway，且只绑定一个工作区连接；多工作区使用各自的应用，以免 Socket Mode 在多个连接间分配事件而漏收。两个令牌必须来自同一应用；Gateway 会校验机器人身份和 Socket Mode 握手中的应用 ID。Socket Mode 连接断开时自动重连，只在事件写入持久队列后确认接收。

平台参考：[Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)、[Slack 应用清单](https://docs.slack.dev/reference/app-manifest/)、[企业微信智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)、[飞书接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive?lang=zh-CN)。

## 单聊命令

Slack 中以下命令均省略开头的 `/`，例如 `projects`、`new 任务内容`、`approve 确认码 yes`；机器人返回的 Slack 指令也会自动转换。

| 指令                                 | 行为                                          |
| ------------------------------------ | --------------------------------------------- |
| `/help`                              | 显示可用操作                                  |
| `/projects`、`/project 项目ID`       | 列出授权项目、明确选择项目                    |
| `/new 任务内容`                      | 创建真实桌面任务，首条消息标注 IM 来源        |
| `/tasks`、`/continue 任务ID`         | 列出可访问任务、明确选择并订阅后续进展        |
| 普通消息                             | 进入当前任务；运行时进入现有 follow-up 队列   |
| `/status [任务ID]`                   | 根据真实任务与持久事件返回状态                |
| `/stop [任务ID]`                     | 取消任务和对应沙箱进程                        |
| `/approve 一次性确认码 yes或no`      | 本人单聊处理同一桌面审批，仅一次生效          |
| `/answer 一次性确认码 [问题ID] 答案` | 回答澄清；多问题需要指定问题 ID               |
| `/publish [任务ID] 项目内相对路径`   | 显式发布文件，回传 SHA-256 和 15 分钟下载链接 |
| `/unsubscribe`                       | 停止当前任务向此会话回传                      |

未明确选择的旧桌面任务不会发送到 IM。群任务与单聊任务隔离；其他身份不能接管绑定的任务。切换本地任务到 IM 要等当前执行结束，之后使用远程工具权限。停用 IM 不改变原有本地任务、Terminal 或桌面 shell 的权限。

传入附件复用 Artemis 的文本、图片、PDF、DOCX、XLSX、PPTX 解析流程；单文件最多 10 MiB，总计 20 MiB，最多四张图片。无法支持的类型明确返回错误。产物下载链接是临时访问凭据，能被持有链接的人下载；仅在明确发布时创建，不自动上传文件或私有历史。

飞书将任务开始、等待确认、恢复执行和结束状态更新到同一卡片，最终答复单独保留；企业微信使用分段 Markdown 状态回执。审批和澄清使用上表的一次性指令，两端都支持。卡片明确被平台拒绝时降级为文本，发送结果不确定时保留诊断，不重复发送。飞书应用需要发送与更新消息权限；卡片采用共享更新模式，参见[飞书更新已发送卡片](https://open.feishu.cn/document/server-docs/im-v1/message-card/patch)。

## 群与跨 IM 空间

Gateway 管理员先为群指定管理员身份，成员先各自在自己的桌面完成配对。指定管理员是自托管运营者配置的可信名单；当前不自动从平台拉取管理员角色，因此运营者必须核对其实际群管理资格。

先让已配对的群管理员在目标群 @机器人发送 `/help`，再在桌面的进阶设置中输入管理凭据、查看诊断。`groups` 显示实际群 ID，`identities` 和 `devices` 显示稳定身份及设备 ID。发现群 ID 不会自动开启共享。使用这些值填写以下空间结构：

```json
{
  "id": "engineering",
  "name": "Engineering",
  "endpoints": [
    { "connectionId": "wecom-team", "id": "企业微信群ID", "kind": "group" },
    { "connectionId": "feishu-team", "id": "飞书群ID", "kind": "group" }
  ],
  "participants": [
    {
      "deviceId": "设备A的ID",
      "name": "Alice",
      "identity": {
        "channel": "wecom",
        "connectionId": "wecom-team",
        "tenantId": "企业ID",
        "appId": "BotID",
        "userId": "稳定用户ID"
      }
    },
    {
      "deviceId": "设备B的ID",
      "name": "Bob",
      "identity": {
        "channel": "feishu",
        "connectionId": "feishu-team",
        "tenantId": "TenantKey",
        "appId": "AppID",
        "userId": "用户OpenID"
      }
    }
  ],
  "administrators": [
    {
      "channel": "wecom",
      "connectionId": "wecom-team",
      "tenantId": "企业ID",
      "appId": "BotID",
      "userId": "稳定用户ID"
    },
    {
      "channel": "feishu",
      "connectionId": "feishu-team",
      "tenantId": "TenantKey",
      "appId": "AppID",
      "userId": "用户OpenID"
    }
  ]
}
```

每个群的指定管理员通过 @机器人发送 `/space-confirm engineering`，全部确认后生效。单平台群使用一个 endpoint 即可。每位主人还须在本地项目授权中允许该空间 ID。修改群、成员或管理员配置会清除确认并变更空间修订号，旧任务不能继续向新共享范围投递。

只有 @机器人发起的公开协作内容和明确发布的消息、任务状态、成果进入空间。普通聊天、机器人回流消息不触发任务。飞书和 Slack 可引用机器人消息关联任务；企业微信使用明确任务编号继续。跨 IM 的公开回复可以成为同一任务的讨论输入，但不能变成其他主人的审批或停止指令。

协调者在主人授权的 Execute 模式下使用内建 `collaborate` 工具发现参与者、分派、查看状态、传递消息、取消或完成；命令及网络仍使用各自的授权开关。目标桌面重新校验自己的授权，执行独立任务。每轮协作最多 16 次分派、64 条 Agent 共享消息，任务默认 30 分钟过期；远程请求默认有 100,000 令牌预算。桌面离线时持久排队，协调者不在线时不能新增分派。截止、撤销和预算耗尽会取消执行。补丁、提交标识、测试证据可以作为文字或显式发布的文件交换；不会自动合并其他人的代码。

## 恢复与验证边界

Gateway 在接收后先写数据库，再确认平台事件。桌面先保存请求再确认 Gateway；任务创建有固定 ID，已投递但结果不确定的请求不自动重放。消息发送区分 pending、sending、done、failed、uncertain；限流和未发送状态可退避重试，发送结果不确定则保留诊断，由运营者核对平台实际消息。管理员状态页显示各投递状态计数。设备注册凭据可通过管理员 `/v1/admin/revoke` 撤销。

离线或暂停的设备收到请求时会立即回执排队原因，超过截止时间后停止排队并提示重发。各渠道独立取出待发消息；同一会话保持顺序，限流中的进展不会被后续结果越过。协作取消先标记“正在取消”，以目标桌面的实际结束回执为准，未启动的分派不会在恢复后再次执行。

本地重启后恢复事件回传和请求队列。未确认的命令操作不会盲目重新执行。Gateway 收到已配对用户的附件后立即下载并加密缓存，最多保留 24 小时，供暂时离线的桌面恢复读取；原始请求仍按 30 分钟截止。未能在平台资源链接过期前保存的附件会明确要求重发。

每个设备连接使用 45 秒租约，同一设备凭据不能同时由两处 Artemis 执行。桌面按本地请求开始时间提前 5 秒停止续约失败后的远程操作，避免依赖两台机器的时钟同步；暂停会释放租约。进程异常退出后，新进程等待旧租约失效再接管。发送前再次校验身份与空间修订，撤销绑定或修改共享范围会阻止旧的待发答复。

验证命令：

```sh
npm run test:im
npm run typecheck
npm run build
npm run verify:im
```

自动测试覆盖协议隔离、渠道验签与自有 @、重复消息、双设备模拟协作、审批一次生效、原生 macOS Seatbelt 文件与网络边界及显式产物发布。`verify:im` 使用独立临时数据目录启动真实 Electron，验证六步引导、注册、配对、授权、Pi 受限文件读取和任务回传；模型和 IM 渠道使用本地测试替身，不会连接个人账号。截图与结果默认写入 `artifacts/im`。

真实企业微信、飞书与 Slack 工作区、两台物理电脑、Windows 原生权限、签名安装包以及长时间断线恢复仍需部署环境验收。模拟渠道和源码测试不能替代这些验收；外部 A2A 适配不在此版本中。
