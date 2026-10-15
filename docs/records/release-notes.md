# Artemis v1.7.17

## 中文

- Pi 升级至 1.2.0，接入新版 Codemode 工具声明与运行兼容性，并验证启动钩子、取消／排队和上下文压缩；压缩文本不再包含思考内容。
- MCP 完整保留对象、数组、字符串、数字、布尔值和 `null` 等结构化结果。未声明输出 Schema 的工具也可在 Codemode 中返回原始 JSON；服务器未提供文本时，Work 会在上下文预算内补充 JSON 文本，并保留图片。
- 修复 PostToolUse 钩子追加上下文时丢失结构化结果的问题；钩子可读取结构化输出，错误反馈仍会拒绝工具结果。
- OpenRouter 目录按当前账户筛选可用模型，同步上下文／输出限制和价格，支持区域端点及按凭据和端点隔离的离线缓存。
- 修复账户切换与 Office 设置并发更新造成的凭据／目录不一致；桌面默认模型跟随 Agent Host 确认的选择，不再继续使用被账户目录排除的模型。
- 补齐真实 Pi Codemode 与 MCP SDK 回归测试，修复旧测试中工具未执行或断言被捕获仍可能通过的问题，并覆盖结构化结果、钩子交互、大输出截断和账户切换竞争条件。

## English

- Upgrade Pi to 1.2.0 with updated Codemode tool declarations and runtime compatibility, and verify startup hooks, cancellation, queued messages and context compaction. Compaction text no longer includes thinking content.
- Preserve MCP structured results including objects, arrays, strings, numbers, booleans and `null`. Codemode receives raw JSON even when a tool has no declared output schema; Work adds a context-budgeted JSON text fallback when the server supplies no text, while retaining images.
- Fix structured results being lost when PostToolUse hooks add context. Hooks receive structured output, while error feedback continues to reject tool results.
- Personalize OpenRouter model catalogs for the current account, including context/output limits and pricing, with regional endpoints and an offline cache isolated by credential and endpoint.
- Fix credential/catalog inconsistencies when account changes overlap Office settings updates. The desktop default model follows the Agent Host's confirmed selection instead of retaining a model excluded by the account catalog.
- Expand real Pi Codemode and MCP SDK regression coverage, correcting tests that could pass without executing the tool or after Pi caught an assertion. Cover structured results, hook interactions, large-output truncation and account-change races.
