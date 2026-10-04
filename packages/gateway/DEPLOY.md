[English / 简体中文](DEPLOY-en.md)

# Artemis Gateway

普通用户请在 Artemis 设置 → IM 连接点击“一键启动并注册”。无需源码、Node.js、npm、命令行或单独部署。

此独立运行包供团队服务管理员使用，支持 Slack Socket Mode、企业微信长连接和飞书长连接或事件回调。仅需安装 Node.js 24 或更新版本，无需 npm 或 Artemis 源码。把包解压到服务器上的独立目录，在该目录执行：

```sh
node gateway.mjs
```

首次启动自动创建 `.env.gateway`，独立生成管理凭据和数据库加密密钥。打开该文件，将 `ARTEMIS_GATEWAY_ADMIN_TOKEN` 的值输入 Artemis 的“使用团队 Gateway”注册表单。后续启动自动读取此文件，不会更换凭据。请保持服务运行；使用系统服务管理器时将工作目录设为解压目录。

默认仅监听 `127.0.0.1:8787`。浏览器打开 `http://127.0.0.1:8787/health`，应返回 `ok: true`。供其他电脑使用、下载已发布文件或接收飞书回调时，管理员需配置可访问的 HTTPS 域名和反向代理，请求体上限至少 14 MiB。不要把管理凭据放入链接或公开到聊天中。

SQLite 数据保存在 `data/gateway.sqlite`；同一数据库仅允许一个实例。备份时先停服务，再备份整个 `data` 目录及 `.env.gateway`；丢失加密密钥将无法读取机器人凭据。运行包不包含任何用户凭据，导出后会在服务器上生成新的凭据。

## Slack

Artemis 的 Slack 设置提供应用清单，可直接导入，自动配置 Socket Mode、私聊和 @ 事件及所需权限。安装到工作区后，复制 Bot User OAuth Token (`xoxb-`)；在 Basic Information → App-Level Tokens 创建带 `connections:write` 的 App-Level Token (`xapp-`)。只需在 Artemis 粘贴这两个令牌；工作区、应用和机器人编号会自动识别。同一应用只连接这一份 Gateway；多个工作区请分别创建应用。

在机器人私聊使用 `pair 配对码`、`projects`、`new 任务内容`、`status` 等普通消息命令，不带 `/`，以免 Slack 将它们当成 Slash Command。群聊先邀请机器人，再 @ 机器人发送命令。仅接收本人机器人私聊及明确 @ 的群消息，配对和项目授权保持有效。

Slack Socket Mode、企业微信和飞书长连接只需出站网络；飞书也可选择 HTTPS 回调。每个连接只启用一种传输，切换时先停止旧订阅。飞书按钮需订阅 card.action.trigger，Typing 需消息表情读写权限。

飞书默认使用仅需出站网络的长连接，也支持 HTTPS 回调；一个连接只能使用一种接入传输。没有 transport 字段的旧回调配置仍按回调处理。订阅 `im.message.receive_v1` 和 `card.action.trigger`，按需启用消息资源及表情权限，迁移前停止旧桌面订阅。导入凭据不会导入身份、授权或待处理审批。
