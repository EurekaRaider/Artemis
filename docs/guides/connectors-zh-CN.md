[English / 简体中文](connectors.md)

# Connectors v1

Artemis 直接连接官方服务，不需要 Artemis 后端。Pi、工具审批及各 MCP 服务的沙箱策略保持生效。

## 用户流程

加载 ArtemisPluginShop，然后安装签名插件。安装后自动打开该插件的连接对话框；仅加载商店不会开始授权。通过已安装插件的 Configure 可重新打开同一对话框，没有独立 Connector 页面。关闭待处理的对话框会取消授权。Google 和 Microsoft 打开系统浏览器；GitHub 显示设备码；QQ 要求邮箱地址和授权码；Figma 检查桌面 MCP 端点。公共客户端 ID 由发布者配置，不由用户输入。Gmail 和 Workspace 各有独立授权，但共享同一 Google 账号身份。每个服务允许一个连接。应用退出后不保留后台轮询。

所有现有 Connector 插件都必须更新并重新连接。运行时不读取或转换历史授权记录，其文件仍保留在磁盘上。不支持的版本、旧 Connector 别名和旧认证声明会各自被拒绝，不影响无关插件及手动 MCP 服务加载。

## 契约与执行

每个插件只声明一个 MCP 服务。其 `x-artemis.connector` 对象包含 `version: 1`、稳定的 `id`、`provider`、`displayName`、`auth`、`scopes`、`capabilities`、`requiredHostCapabilities: ["connector-v1"]` 及 `setup`。所在 MCP 服务是唯一的运行时引用，不创建第二份应用声明。宿主根据支持的 Connector 注册表校验提供商、授权、传输和官方端点。Connector v1 本身是必需的宿主能力，不支持与旧宿主配对。

示例（Figma Desktop）：

```json
{
  "mcpServers": {
    "figma": {
      "type": "http",
      "url": "http://127.0.0.1:3845/mcp",
      "auth": "none",
      "x-artemis": {
        "connector": {
          "version": 1,
          "id": "figma",
          "provider": "figma",
          "displayName": "Figma",
          "auth": "none",
          "scopes": [],
          "capabilities": ["read"],
          "requiredHostCapabilities": ["connector-v1"],
          "setup": "desktop-mcp"
        }
      }
    }
  }
}
```

Renderer/preload API 为 `listConnectorDefinitions`、`listConnectorConnections`、`connectConnector`、`cancelConnectorAuthorization`、`reconnectConnector` 和 `disconnectConnector`。账号状态不含令牌。手动 MCP 仍是高级功能，使用自身的标准 MCP 配置。

ConnectorService 在把凭据交给执行器前，校验固定的商店签名密钥、已安装内容的精确摘要、所属插件、配置绑定、提供商和权限。凭据只保存在操作系统加密的 `connector-credentials-v1.json` 中。Access token 通过私有 `com.artemis.connector/auth` 上下文传给受信任的本地适配器；refresh token 留在宿主。QQ 授权码只传给其受信任的邮件适配器。官方远程 MCP 认证通过宿主传输头或 OAuth provider 提供。配置导出只含声明，不含凭据记录。

Connector 声明变更后，其工具保持禁用直到重新授权。工具注册和执行都要求连接有效。断开连接会关闭 MCP 客户端并使待处理的刷新代次失效。平台可能已接受正在进行的写入，取消不能撤销它。邮件发送结果不确定时绝不自动重试。

## 发布者配置

OAuth v2 完全在签名插件中配置，参见 [v2 声明与开发者后端契约](plugin-oauth.md)。Artemis 不再读取 `connector-clients.json`，打包时排除旧客户端文件。仍禁止服务器机密。明确的 `native-public` PKCE 声明可包含可分发的原生客户端兼容 secret，仅用于令牌兑换和刷新。Google Desktop 使用此声明；真实账号授权与刷新仍是发布验收要求。

Figma Desktop 和 QQ Mail 保留各自的非 OAuth 配置。未验证注册资料的候选服务不得进入已发布商店。

## 验收与发布门禁

本地 mock 测试和 stdio 冒烟运行不能证明真实提供商验收。发布配对的宿主／商店版本之前，需记录：

- 首批六个服务分别完成连接、读取、支持的写入、权限缺失、撤销、取消、超时和调用待处理时断开连接的证据。
- 官方远程 MCP 的客户端注册／准入、工具可用性和权限行为。未获准的远程服务不得公开发布。
- macOS arm64 和 Windows x64 安装包中的浏览器回调、操作系统加密、本地运行时沙箱、Figma loopback、签名及安装／更新行为。
- Google 审核覆盖发送给所选模型提供商的数据。
- 最终打包后进行签名、文件清单和离线归档校验。

Microsoft、GitHub 和 Slack 的公共注册以及受控账号访问是外部发布前提。不得借用其他应用的 client ID，也不得要求最终用户注册开发者应用。

## 本地验证

OAuth 声明和信任契约见 [OAuth 指南](plugin-oauth.md)。宿主和商店的配对变更应根据实际发布输入验证。
