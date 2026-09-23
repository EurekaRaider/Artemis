# 开发 Artemis 插件与 Git 插件商店

简体中文 · [English](guide-en.md) · [文档索引](../../README.md)

本文按 2026-09-23 的 Artemis 当前源码整理。发布时仍需在面向用户的 Artemis
版本上验收；源码支持不代表旧安装包已经支持。

插件是包含 `.codex-plugin/plugin.json` 及其声明资源的目录；商店是同一个公开
GitHub 仓库中的插件目录清单。第三方不需要搭建商店网站、注册中心或修改 Artemis。
建议先完成下面的纯 Skill 示例，再按需增加 MCP 和账号授权。

## 1. 选择插件能力

| 能力 | 需要提供什么 | 使用条件 |
| --- | --- | --- |
| Skill | `SKILL.md` 与配套文件 | 提供工作流指令，不是自动执行的安装钩子 |
| 普通 MCP | `.mcp.json`、本地服务或远端地址 | 支持 stdio / Streamable HTTP；用户配置并启用 |
| Artemis Connector | MCP 加 `x-artemis.connector` 声明 | 必须来自用户确认签名的商店；新 OAuth 接入使用 v2 |
| 可执行 Pi 扩展 | 单独的扩展安装流程 | 不通过 Git 插件商店安装 |

Hooks、commands、agents、浏览器扩展、定时任务模板会被标记为不支持。插件商店
不是通用 Electron UI 扩展接口。兼容 Codex/Claude 风格目录不代表支持它们的全部
字段；不要声明尚未实现的能力。

## 2. 建立最小商店

在新仓库创建以下三个文件即可。这个示例不需要 MCP 服务、构建步骤或签名：

```text
my-marketplace/
├── .agents/plugins/marketplace.json
└── plugins/example-tools/
    ├── .codex-plugin/plugin.json
    └── skills/acme-example-review/SKILL.md
```

`.agents/plugins/marketplace.json`：

```json
{
  "name": "acme-marketplace",
  "interface": { "displayName": "Acme Marketplace" },
  "plugins": [
    {
      "name": "example-tools",
      "source": { "source": "local", "path": "./plugins/example-tools" },
      "policy": { "installation": "AVAILABLE" },
      "category": "Development"
    }
  ]
}
```

`plugins/example-tools/.codex-plugin/plugin.json`：

```json
{
  "name": "example-tools",
  "version": "1.0.0",
  "description": "Review a project and report actionable findings.",
  "skills": "./skills/",
  "interface": {
    "displayName": "Example Tools",
    "shortDescription": "A reusable project review workflow.",
    "category": "Development",
    "brandColor": "#2563EB"
  },
  "localizations": {
    "en": {
      "displayName": "Example Tools",
      "description": "Review a project and report actionable findings.",
      "shortDescription": "A reusable project review workflow."
    },
    "zh-CN": {
      "displayName": "示例工具",
      "description": "检查项目并报告可操作的问题。",
      "shortDescription": "可复用的项目审查流程。"
    }
  }
}
```

`plugins/example-tools/skills/acme-example-review/SKILL.md`：

```markdown
---
name: acme-example-review
description: Use when the user requests a project review with actionable findings.
---

1. Read the project instructions and identify the requested review scope.
2. Inspect relevant files without changing them.
3. Report concrete findings with file locations and suggested fixes.
4. Respond in the user's language. State any verification you could not perform.
```

示例 Skill 要求读取项目指引、按范围审查、报告文件位置与修复建议，并使用用户语言
回答。你可以直接把正文改成中文，保留 frontmatter 的字段名和稳定标识。

## 3. 遵守清单与 Skill 规则

- 商店 `name` 和目录条目的 `name` 为 1–120 个字符，匹配
  `[a-z0-9][a-z0-9._-]*`；插件清单 `name` 使用同一字符集，最多 64 个字符。
  建议商店条目名与插件清单名一致。
- 名称是稳定身份，不是翻译文案。常规更新不要重命名商店、插件或 Skill。
- 商店 `source` 必须指向同一仓库内的目录，也可以写为字符串
  `"./plugins/example-tools"`。外部 Git 地址、npm 包、子模块不能代替本地插件目录。
- 推荐目录清单路径为 `.agents/plugins/marketplace.json`；兼容路径为
  `.claude-plugin/marketplace.json` 和仓库根目录的 `marketplace.json`。
- `policy.installation: "NOT_AVAILABLE"` 隐藏条目。通常省略 `policy.products`；
  如果提供非空数组，必须包含 `CODEX` 才能通过兼容加载器展示。
- 商店路径相对仓库根目录，插件资源路径相对插件根目录。文件名大小写必须一致，
  禁止符号链接、目录逃逸、socket 等非普通文件内容。
- 只声明实际存在的资源。插件至少包含一个有效 Skill 或可导入 MCP 服务。
  不可用或不支持的 Connector 声明可能使整个插件不可安装，即使其中有 Skill。
- 始终填写版本号，建议使用语义化版本；缺省回退值 `0.0.0` 不应作为发布惯例。
- `interface.logo` 可选，指向插件内 PNG；`brandColor` 为 `#RRGGBB`。
  可自动翻译的标准分类为 `Communication`、`Productivity`、`Development`、`Design`。
- Skill 名称在所有插件与独立 Skill 之间全局唯一，建议加发布者前缀。最多 64 个
  字符，匹配 `[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*`。frontmatter 必须有单行
  `description`，最多 1,024 个字符，不要依赖 YAML 多行描述。
- 配套文件放在 Skill 目录中，例如 `references/`、`scripts/`、`examples/`、
  `templates/`。写清用途、依赖和副作用；安装 Skill 不会自动执行这些脚本。

### 插件自身的中英文支持

如示例所示，`localizations` 位于 `plugin.json` 顶层。支持的语言键为
`en`、`zh-CN`、`zh-TW`、`ja`、`ko`、`es`、`fr`、`de`、`pt-BR`、`it`、`ru`、`ar`、
`hi`、`id`。显示文案逐字段按“当前语言 → 英语 → 基础字段”回退；不要翻译 ID 和路径。

每种语言可设置 `displayName`（120 字符）、`description`（2,000）、
`shortDescription`（300）、`longDescription`（10,000）、`defaultPrompt`
（最多 20 条字符串，每条 2,000 字符）。未知语言、未知字段、空文案会被拒绝。
元数据本地化不会自动翻译 Skill 正文和服务返回值，需要开发者自行提供。

## 4. 按需增加普通 MCP

在 `plugin.json` 增加 `"mcpServers": "./.mcp.json"`，在插件根目录创建 `.mcp.json`。
以下可选示例展示两个独立服务；发布前必须实现本地服务、替换远端占位地址：

```json
{
  "mcpServers": {
    "example-local": {
      "command": "${ARTEMIS_NODE}",
      "args": ["${PLUGIN_ROOT}/mcp/server.mjs"],
      "env": { "EXAMPLE_API_KEY": "$EXAMPLE_API_KEY" }
    },
    "example-remote": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "auth": "oauth"
    }
  }
}
```

`${ARTEMIS_NODE}` 仅作为完整 `command` 使用，调用 Artemis 可执行文件的 Node
模式；使用 `node` 则要求用户 PATH 中存在 Node。`${PLUGIN_ROOT}` 和
`${CLAUDE_PLUGIN_ROOT}` 在命令及参数中解析为已安装快照目录。其他未解析的命令或
参数变量会阻止导入，不会留待 shell 展开。

发布前准备好所有运行依赖。Artemis 复制插件快照，不会自动执行 `npm install`、
编译 TypeScript 或运行 `postinstall`。如果 `.mjs` 仍引用未提供的包，运行就会失败。
原生依赖必须按承诺支持的系统和架构分别测试。stdio 的 stdout 只输出协议消息，
诊断写 stderr，禁止输出凭据。

环境变量只接受同名引用，例如 `"EXAMPLE_API_KEY": "$EXAMPLE_API_KEY"`，也可以
用 `envVars` / `env_vars` 列出变量名。字面值会被丢弃并要求用户手动配置；不要打包
秘密。疑似携带凭据的命令参数会阻止导入。自定义 `cwd` 不生效，宿主使用私有托管目录。

远端地址使用 HTTPS，仅本机 loopback 开发地址允许 HTTP。地址不能带凭据、查询参数
或片段。除 `Authorization` 外的自定义请求头会阻止导入；请求头里的凭据不会被导入。
`auth: "oauth"` 选择 OAuth。Bearer 接入用 `bearer_token_env_var` 声明变量名，
再由用户在 Artemis 配置令牌；当前解析器仅写 `auth: "bearer"` 不会选择 Bearer
模式。这里不支持旧 SSE 传输。

服务安装后默认禁用。本地 stdio 默认使用原生沙箱；当前导入器设置
`allowNetwork: true`，用户应在启用前检查。每个服务的 full-access 兼容选项会授予
桌面用户权限，需要单独明确选择；扩展的 **Full local access** 不改变 MCP 权限。
Skill 不会绕过 Plan/Review 限制，启用服务也不等于授权所有业务操作。

## 5. 接入 Artemis Connector / OAuth

账号连接声明位于 `.mcp.json` → `mcpServers.<name>.x-artemis.connector`。
**新插件不要使用 `apps`、`connectors`、`.app.json`、`.connector.json` 或
`x-artemis.auth`**；当前加载器将它们视为旧格式并要求更新、重新连接。

### “用户确认过签名指纹的商店”是什么意思

这类插件会让 Artemis 管理账号授权，因此需要先建立对发布者的信任：

1. 开发者持有自己的 Ed25519 私钥，对商店目录和插件内容签名，随仓库发布签名和公钥。
2. 用户添加商店时查看公钥指纹，通过发布者官网等独立渠道核对后确认。
3. Artemis 校验内容与签名，再允许安装其中的 Connector、进入账号连接流程。
   后续更新继续校验相同密钥；换密钥需要重新明确确认。

**不要求上架 Artemis 官方商店，也不需要购买证书。** 第三方可以自建仓库、自行签名。
签名证明内容完整性和密钥连续性，不证明作者可信或业务代码安全。

普通 MCP 认证和 Artemis Connector 是两个不同契约。所有 `x-artemis.connector`
声明都要求已确认签名的商店；直接导入本地插件或从未签名 Git 商店安装均不能满足此
条件。纯 Skill 和不带该声明的普通 MCP 不要求签名。

### OAuth 声明与开发职责

新 OAuth 提供方使用 v2。把下面片段放进服务的 `x-artemis.connector` 字段；它不是
完整 `.mcp.json`，也不是已经可用的在线服务：

```json
{
  "version": 2,
  "id": "sample-api",
  "provider": "sample-platform",
  "displayName": "Sample API",
  "auth": "oauth-pkce",
  "scopes": ["records.read"],
  "capabilities": ["read"],
  "requiredHostCapabilities": ["connector-oauth-v2"],
  "oauth": {
    "applicationName": "Sample Desktop",
    "client": {
      "type": "static",
      "clientId": "REPLACE_WITH_REGISTERED_PUBLIC_CLIENT_ID"
    },
    "issuer": "https://auth.example.com/",
    "authorizationEndpoint": "https://auth.example.com/authorize",
    "tokenEndpoint": "https://auth.example.com/token",
    "redirect": { "hostname": "127.0.0.1" },
    "requiredScopes": ["records.read"],
    "scopeDescriptions": { "records.read": "Read records" },
    "resource": "https://api.example.com/"
  }
}
```

此 PKCE 示例需配合 stdio 业务适配器。远端 v2 Connector 必须声明
`oauth.mcpEndpoint`，使用 Streamable HTTP，且服务地址与该字段完全一致。
按流程补齐声明后再选择传输方式：

- `oauth-pkce`：公共客户端、系统浏览器、S256、state、本机回调。
- `device-code`：设备授权端点以及允许的验证页面来源。
- `mcp-oauth`：资源、MCP 端点、明确列出的发现 URL；动态注册还需要注册端点。
  发现结果不能新增未声明的目标。

开发者负责平台注册、回调登记、替换占位 client ID 和地址、最小权限申请及权限说明。
公开 client ID 可以打包，client secret、用户令牌、私钥不能打包。OAuth 网络端点
限公网 HTTPS，不能带凭据、查询参数、片段、自定义端口；本机 HTTP 仅用于宿主回调。

平台必须使用 client secret 时，由开发者运营后端保管上游秘密和令牌，对 Artemis
提供公共客户端 PKCE 或标准 MCP OAuth。后端签发绑定资源的令牌，校验 issuer、
audience、有效期和 scope，不向桌面返回上游令牌。Artemis 不替开发者部署后端。

宿主加密存储凭据，并绑定发布者、来源、插件、连接和认证声明；影响安全的声明变化
要求重新授权。适配器不得记录或持久化收到的 access token；refresh token、授权码、
PKCE verifier 留在宿主。签名不能替代适配器代码审查。

完整字段见 [OAuth 契约](../plugin-oauth/README.md) 与
[源码校验器](../../../apps/desktop/src/shared/connector-oauth.ts)。v1 OAuth 不能用作
新提供方的回退。发布前验证真实登录、取消、刷新、撤销和更新后的授权行为。

## 6. 签名商店

纯 Skill、普通 MCP 的 Git 商店可不签名；Artemis Connector 和离线商店导入必须签名。
这里使用 Ed25519 内容签名，区别于 Git commit 签名和 macOS 应用签名。

构建最终插件文件后生成 `.artemis/integrity.json`：

1. 为发布者生成一对 Ed25519 密钥。私钥保存在仓库外并备份，更新持续使用同一密钥。
   在用户可独立核验的渠道公布公钥 SHA-256 指纹。
2. 对商店清单的原始字节计算 SHA-256，作为 `marketplaceHash`。逐个收集商店条目
   对应插件目录下全部普通文件（包括隐藏文件），拒绝符号链接和目录外路径。
3. 文件记录为 `{path, size, sha256}`：`path` 是使用 `/` 的插件相对路径，`size`
   为字节数，哈希是小写十六进制。按 `left.path.localeCompare(right.path, "en")` 排序。
4. 按排序顺序拼接每个文件的 UTF-8 路径、NUL 字节、十六进制哈希、NUL 字节，对整体
   求 SHA-256 得到 `contentHash`。插件记录为 `{name, version, contentHash, size, files}`，
   `size` 为文件字节总和。包含全部商店条目，包括被 policy 隐藏的条目。
5. 构造未签名对象：`schemaVersion: 1`、`marketplaceName`、`marketplaceHash`、
   `signatureAlgorithm: "Ed25519"`、`publicKey`（SPKI DER 的 base64）、
   `signingKeyFingerprint`（DER 的 SHA-256）、`signedAt`（ISO 时间）、
   `sourceUrl`（`https://github.com/owner/repository.git`）、`plugins`。
6. 递归使用 `localeCompare` 排序对象键，保留数组顺序，再 `JSON.stringify`，对其
   UTF-8 字节进行 Ed25519 签名。把 base64 签名加为 `signature` 后保存 JSON；
   被签名的内容不含 `signature` 字段。
7. 同时发布清单、插件内容和完整性文件。通过 Git 商店入口验收并确认指纹。
   清单字节或插件文件有任何修改都必须重新生成签名；格式化 JSON 也会改变哈希。

精确格式以[宿主验签实现](../../../apps/desktop/src/main/codex-plugin-service.ts)和
[测试中的 `signMarketplaceRepository` 参考实现](../../../apps/desktop/test/codex-plugin-service.test.ts)
为准。把该算法接入自己的发布工具，不要自行设计另一套签名格式；无需修改 Artemis。

Artemis 会固定用户确认的密钥。换密钥或移除签名会使刷新失败，用户需要主动移除、
重新添加来源并确认新密钥。签名不是对发布者信誉的背书。

### 可选：离线分发

只打包 `.agents/plugins/marketplace.json`、`.artemis/integrity.json` 和所有已签名
插件文件，保持相对路径。签名声明必须包含 `sourceUrl`。排除 `.git`、私钥、无关源码
和未签名的额外文件。通过 **资源中心 → 插件 → 添加 → 离线插件市场包** 导入目录或
`.tar.gz` / `.tgz`，确认指纹后再安装，不能使用“本地插件包”代替该入口。
离线浏览和安装使用导入缓存；更新时分发并导入新签名包。校验和文件本身不是商店包。

## 7. 验证、发布与更新步骤

1. 用 JSON 解析器检查所有 JSON，核对路径和 Skill frontmatter。审查秘密、许可证、
   依赖和体积。为插件附上 README，写明配置方法、支持的 Artemis 版本与平台、权限
   及排障方法。
2. 打开 **资源中心 → 插件 → 添加 → 本地插件包**，选择 `plugins/example-tools`，
   不要选择商店根目录。安装最小 Skill，在新任务中调用，并切换中英文检查文案。
   普通 MCP 也可本地验证；带签名要求的 Connector 走第 4 步。
3. 创建公开 `github.com` 仓库，把完整文件发布到默认分支。只创建 release tag 或
   上传 release 附件不够。用户添加商店的流程不支持私有仓库、SSH 地址、其他 Git
   托管平台或任意分支/tag 路径。
4. 在 **插件 → 添加 → Git 插件商店** 输入 `owner/repository` 或
   `https://github.com/owner/repository`。检查来源；如已签名，核对并确认指纹。
   从该商店安装每个插件。
5. 配置并启用 MCP/Connector，验证真实工具调用、权限拒绝及认证流程。重启 Artemis
   检查持久化。在每个承诺支持的系统/架构上测试；解析器测试不能证明真实提供方、
   沙箱和安装包运行时可用。
6. 更新时先构建最终内容，提升 `plugin.json.version`，按需重新签名，再发布到默认
   分支。用户先 **刷新**，再 **更新**；刷新目录不会自动更新已安装快照。
   验证已有安装的升级和卸载流程。

Artemis 通过 HTTPS 下载有上限的仓库归档，用户不需要安装 Git。打开插件页只读缓存，
不会联网刷新。刷新失败保留上次有效缓存并标记过期。空搜索显示当前商店；输入关键词
会搜索已缓存的 Git 来源。移除商店删除订阅及缓存，不卸载已安装插件；重新添加同一
仓库后可恢复来源关联。

如果托管 Skill、插件快照或 MCP 结构被外部修改，更新/卸载会停止，避免静默覆盖。
先备份并处理本地改动。保持稳定名称，注明需要重新授权的变化。

## 8. 限制与常见问题

| 项目 | 宿主限制 |
| --- | ---: |
| 用户商店数 / 每个商店插件数 | 20 / 1,000 |
| 商店 JSON / 插件或 MCP JSON | 5 MiB / 每个 1 MiB |
| 下载归档 / 解压归档 / 条目数 | 100 MiB / 500 MiB / 20,000 |
| 插件文件数 / 单文件 / 总量 | 2,500 / 50 MiB / 200 MiB |
| Skill 文件数 / 单文件 / 总量 | 200 / 5 MiB / 20 MiB |
| PNG 图标 | 128 KiB；2,048 × 2,048；4,194,304 像素 |

发布工具可以设置比宿主更严格的上限。

| 现象 | 排查方向 |
| --- | --- |
| 仓库不可用 | 公开 GitHub 仓库、正确 owner/name、可访问 API 与归档主机的 HTTPS |
| 缺少清单 / 没有可安装插件 | 清单位置、仓库内路径、policy 过滤、有效 Skill 或可导入 MCP；严格校验可能拒绝整次刷新 |
| Update plugin and reconnect | 移除旧 app/Connector 格式，使用当前声明契约 |
| Connector requires a trusted signed marketplace plugin | 从已确认指纹的签名 Git 或离线来源安装，本地导入不满足条件 |
| 签名密钥变化 / 内容签名失败 | 同一发布者密钥、最新哈希、精确清单字节、签名后未修改文件 |
| 商店身份变化 | 恢复原名称，或主动移除并重新添加来源 |
| Skill 已安装 | 解决全局名称冲突，使用发布者前缀 |
| MCP 启动后退出 | 已安装路径、依赖、传输、stdout 协议、沙箱和网络设置；日志不能泄露秘密 |
| 刷新失败仍显示旧条目 | 属于缓存保护，修复仓库后重新刷新 |

实现依据：[商店加载器](../../../apps/desktop/src/main/codex-plugin-service.ts)、
[Skill 解析器](../../../apps/desktop/src/main/resource-catalog.ts)、
[本地化](../../../apps/desktop/src/shared/plugin-localization.ts)、
[Connector 契约](../../../apps/desktop/src/shared/connectors.ts)。
