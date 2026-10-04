[English / 简体中文](plugin-oauth-en.md)

# 插件 OAuth v2

插件声明接入资料，Artemis 按流程执行授权。公开 client ID 可以进入签名插件；服务器机密、用户令牌、私钥不能进入插件包；仅明确声明为原生公共客户端的可分发兼容参数例外。必须保管服务器机密的平台应使用开发者后端。

## 声明

在 `.mcp.json` 的 `mcpServers.<name>.x-artemis.connector` 使用 `version: 2`、`requiredHostCapabilities: ["connector-oauth-v2"]`。`provider` 是插件自定义标识，不表示平台官方认证。完整类型和校验在 `apps/desktop/src/shared/connector-oauth.ts`，PluginShop 的对应文件使用相同规则。

- 公共字段：`id`、`provider`、`displayName`、`auth`、`scopes`、`capabilities`。
- `oauth.applicationName`：注册应用名称。
- `oauth.client`：`{type:"static",clientId}`、`{type:"native-public",clientId,clientSecret}`（仅 PKCE）、`{type:"dynamic"}` 或 `{type:"metadata",url}`。后两种仅用于 Remote MCP；元数据文档必须预先登记固定本机回调。
- `issuer`、`authorizationEndpoint`、`tokenEndpoint`：固定授权方及按用途分离的端点。
- `redirect`：`hostname` 为 `127.0.0.1` 或 `localhost`；可声明固定 `port` 和 `path`，否则宿主选择端口和连接路径。
- Device Flow 额外声明 `deviceAuthorizationEndpoint` 和 `verificationOrigins`。
- Remote MCP 额外声明 `resource`、`mcpEndpoint`、完整的 `discoveryUrls`；动态注册还需 `registrationEndpoint`。发现结果不能增加新目标。
- `requiredScopes` 必须是请求权限的子集；`scopeDescriptions` 提供展示说明，`scopeAliases` 将服务端返回值映射到声明权限。
- `authorizationParameters` 仅用于公开附加参数，不能覆盖 state、client、redirect、scope、resource、code、PKCE 或任何令牌参数。
- `identity` 可声明账户查询 `endpoint`、`subject`/`account` 字段路径列表、`requiredClaims` 以及 `group`。分组只在同一签名身份、商城来源及 issuer 内生效。无账户接口的插件不显示虚构身份。
- `backend: {operator,url}` 明示开发者后端运营方及域名。此字段不会授予额外网络权限。

所有 OAuth 网络地址限公网 HTTPS，无凭据、片段、查询参数和自定义端口；本机 HTTP 只用于宿主回调。宿主 HTTP 请求在连接时使用已校验的 DNS 结果并禁止重定向。系统浏览器由其自身管理连接；宿主先检查目的地址，不向浏览器发送已有令牌。插件不能用一个宽泛域名白名单接收所有类型凭据。授权结果、刷新结果均受连接代次及取消信号约束。

## 流程与职责

`oauth-pkce` 使用系统浏览器、S256、随机 state 和本机回调；`device-code` 按服务端间隔轮询并处理 slow_down；`mcp-oauth` 通过 MCP SDK 使用受约束的发现和公共客户端注册。

宿主加密存储凭据。refresh token、授权码、verifier 不进入适配器、Renderer 或配置导出。本地业务适配器通过既有私有调用元数据按需取得 access token；它属于受信任插件代码，签名并不证明其业务请求安全。发布前仍需审查适配器。

插件更新、禁用、卸载前取消授权和刷新，迟到结果不能恢复连接。凭据绑定签名发布者、插件、连接、客户端、issuer、资源和认证声明；认证内容变化要求重新授权。仅应用名称、显示名称、权限说明和后端运营方文案变化不改变凭据绑定。

v1 OAuth 连接只保留用于显示更新提示，旧 OAuth 凭据定向删除；不会回退读取宿主客户端配置。QQ Mail、Figma 和普通 MCP 保留原协议。打包排除 `connector-clients*.json` 和旧 `*oauth-client.json`，开发者本地原文件不删除。

## 开发者后端协议

后端持有上游 secret 和令牌，向 Artemis 暴露公共客户端 Authorization Code + PKCE 或标准 MCP OAuth。后端必须校验 S256、精确回调、一次性 code、client ID、scope 和 resource；自身签发的 token 只能访问声明资源，不得将上游 token 返回 Artemis。后端资源服务验证 issuer、audience、有效期和权限，拒绝另一个资源的 token；刷新令牌轮换及撤销由后端实现。

开发者负责平台注册、回调登记、审核、后端维护和客户端元数据文档托管。Artemis 不部署后端；需要保密的客户端凭据必须留在开发者后端。

## 校验与示例

PluginShop 的 `examples/oauth-v2` 提供 PKCE、Device、Remote MCP、开发者后端四类声明。示例中的 client ID 需真实注册后替换，示例不代表可用上架插件。

```sh
node scripts/validate-oauth.mjs examples/oauth-v2/pkce.json
node scripts/verify-oauth-contract.mjs /path/to/Artemis
npm run build
npm run sign
npm run check
```

后续宿主与插件配对更新仍需验证真实平台和最终安装包；本地测试不能替代这些检查。

## TUN / Fake-IP 网络

系统浏览器使用自身的代理和 DNS 设置，宿主只校验授权 URL 的 HTTPS、主机名及凭据等格式，不使用宿主 DNS 结果阻止浏览器打开页面。

宿主 HTTPS 请求仍固定已验证的公网地址。如果系统 DNS 返回 TUN 常用的 `198.18.0.0/15` 虚拟地址，使用固定公网入口 `1.1.1.1` 的 Cloudflare DNS-over-HTTPS 查询真实 A 记录，并保持 `cloudflare-dns.com` 的 TLS 校验。只向解析服务发送待访问的主机名，不发送 OAuth 参数、code 或 token。随后连接真实公网 IP，继续按原目标域名验证 TLS。

Fake-IP 本身仍属于禁止连接的地址。内网、loopback、链路本地地址或混合危险结果不会获得兼容放行；加密 DNS 失败时也不会退回连接 Fake-IP。此路径用于兼容 TUN，并不新增显式 HTTP/SOCKS 代理配置功能。

## 原生公共客户端兼容参数

`native-public` 仅用于平台允许原生应用分发的静态客户端参数，例如 Google Desktop 注册的 `client_secret`。发布者必须核实注册类型；声明校验不能证明某个值实际属于公共客户端。禁止借此分发 Web/服务器客户端机密。该参数可从插件包中读取，不能作为客户端身份认证或保密边界。

宿主仅在 PKCE 授权码兑换和刷新时，将此参数发送到声明的令牌端点；不加入浏览器 URL、账户查询或插件运行时认证上下文。S256、state、回调校验、签名验证及端点保护继续生效。参数变化会改变认证指纹，要求重新授权。用户 access/refresh token 仍禁止进入插件包，refresh token 仅由宿主管理。宿主不读取旧客户端资料文件。

依据：[Google 原生应用 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) 与 [RFC 8252 第 8.5 节](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.5)。
