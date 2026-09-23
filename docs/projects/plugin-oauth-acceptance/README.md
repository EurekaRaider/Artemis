# 插件 OAuth v2 配对验收

记录日期：2026-09-23。此记录区分代码验证、真实平台授权与安装包验证；目前不能作为发布完成证明。

## 已完成的代码验证

- 新增纯数据 v2 契约和 `connector-oauth-v2` 能力要求。三类流程按声明执行；OAuth 引擎没有 Google、Microsoft、GitHub、Slack 平台分支，也不读取旧客户端配置文件。
- 公网 HTTPS、实际连接时 DNS 检查和地址固定、禁止重定向、端点按用途隔离、发现结果限制、scope/issuer/resource/client 绑定、公共客户端注册和错误信息过滤。
- 签名所有者参与凭据绑定；更新/卸载/取消使旧结果失效，覆盖信任校验期间发生更新的竞态。仅显示文案变化保留连接；QQ Mail 使用升级前相同的凭据哈希算法。
- 现有弹窗展示应用、发布者来源、授权域名、权限、资源和后端；14 种语言增加通用文案，旧 OAuth 插件提示更新并禁止授权。
- PluginShop 的 Gmail、Workspace、GitHub 迁移为 0.3.0。其他 OAuth 候选插件更新为未上架示例；QQ Mail、Figma 保留原版本和协议。
- 四类声明示例、校验 CLI、双仓契约一致性检查、开发者后端协议、私钥/凭据 JSON 打包拒绝测试已交付。

## 测试及构建证据

| 范围 | 结果与限制 |
| --- | --- |
| OAuth、签名信任、更新、UI、SDK、离线包相关测试 | 9 文件、88 项通过；包括 Device Flow、三种 MCP 注册方式、恶意端点/发现/重定向、issuer、scope、跨签名凭据复用、刷新取消及更新竞态 |
| 固定宿主构建 | 先 bundle 宿主 OAuth 引擎，再生成并安装全新 provider 的签名插件；授权、实际 stdio MCP 工具调用、刷新、实例重建后读取凭据、断开及更新绑定均通过，宿主 bundle 哈希不变。授权服务和加密适配器使用测试替身，不代表原生安装包验收 |
| 独立后端资源 | Device Flow 测试验证独立资源 token、无 secret 交换及资源变更失效；不代表实际第三方后端已部署或完成服务端安全审计 |
| Artemis 类型检查与生产构建 | 全工作区类型检查及生产构建通过；最终服务改动后再次通过桌面类型检查和构建 |
| Artemis `npm test` | 未全绿：前置 UI convergence 校验被现有 `.update-btn.downloaded` 样式组合阻断 |
| 桌面串行回归 | 在 `apps/desktop` 执行 `vitest run --no-file-parallelism`：232 文件通过、4 文件失败、2 跳过；2232 测试通过、84 失败、12 跳过。失败位于 IM sandbox、IM flow derive、IM settings panel、task notification shutdown，未修改这些功能以消除失败 |
| PluginShop `npm run check` | 通过：类型、30 项测试、构建、5 个插件签名、darwin-arm64 运行时冒烟、离线包验证和格式检查 |
| 双仓规则一致性 | 两个契约源文件逐字比较通过（仅 `.ts`/`.js` 导入后缀归一化）；配对离线包导入、安装与签名信任校验通过 |

离线包：`ArtemisPluginShop/dist/ArtemisPluginShop-offline-0.3.0.tar.gz`。

SHA-256：`9edaee392b7f95c922b648fa76a889112dd3fb5e3ed4f63e3715fa399b4ce586`。

商城继续使用原有签名身份，没有生成或替换发布者密钥。没有提交、推送或发布。

## 真实平台：按用户要求延期

使用隔离 Electron 配置和系统 safeStorage，安装已签名 Gmail 插件后打开了真实 Google 授权页面。凭据交换被公网地址校验阻断：本机代理 DNS 将 Google/GitHub 解析为 `198.18.x.x` 保留地址。没有放宽网络规则，也没有加入 client secret。

**尚不能判断现有 Google Desktop 客户端能否无 secret 完成授权和刷新。** 用户决定先完成代码，将真实网络验收留待后续。重新测试前须使用返回真实公网地址的网络。

待补：

1. Gmail 和 Workspace 分别授权、同账户约束、无 secret 刷新、受控读写及撤销。
2. GitHub 真实 Device Flow、MCP 工具读写、重授权及撤销。
3. 实际开发者后端或独立模拟部署的端到端 audience、token 轮换与撤销验收。
4. macOS arm64/x64 和 Windows 最终安装包中的浏览器回调、OS 加密、重启恢复和不含平台客户端文件检查。当前仅证明构建配置排除这些文件，未宣称完成安装包验收。
5. 修复上述全量检查阻断后，再执行两仓最终质量门禁。

任何模拟测试、类型检查或源码构建都不代替这些发布条件。

## 重跑命令

Artemis 根目录：

```sh
npm run typecheck
npm run build
ARTEMIS_CONNECTOR_MARKETPLACE_ARCHIVE=/path/to/ArtemisPluginShop/dist/ArtemisPluginShop-offline-0.3.0.tar.gz npx vitest run apps/desktop/test/connector-service.test.ts apps/desktop/test/connector-contract.test.ts apps/desktop/test/connector-oauth-v2.test.ts apps/desktop/test/connector-oauth-network.test.ts apps/desktop/test/connector-oauth-parity.test.ts apps/desktop/test/codex-plugin-service.test.ts apps/desktop/test/connector-marketplace-acceptance.test.ts apps/desktop/test/plugin-connection-flow.test.tsx apps/desktop/test/mcp-oauth.test.ts
```

PluginShop：

```sh
npm run check
npm run verify:oauth-contract -- /path/to/Artemis
```
