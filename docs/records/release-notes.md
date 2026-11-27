# Artemis v2.0.18

## 中文

- 将内置 Pi 引擎（`pi-ai`、`pi-coding-agent`）升级至 1.6.1，新增 OpenAI / Azure / OpenAI Codex 的 GPT-6.2 Astra 与 GPT-6.2 Sol、Qwen Token Plan 新模型以及 GitHub Copilot / Radius 决策模型支持，并带来 Gemini 4 `xhigh`、OpenAI Codex 缓存与断流重连、临时故障重试及 `undici` 8.12.4 安全修复。
- 接入 Pi 的 `after_provider_response` 响应钩子，在主任务与子 Agent 收到 HTTP 429 或带 `Retry-After` 的限流/过载响应时实时同步同服务商并发退避。
- 在 Work 模式的 `classify` 工具结果中透传服务商 `responseId`，并对齐 Anthropic 增量续聊默认规则以支持任意指向 `api.anthropic.com` 的配置。

## English

- Upgraded the bundled Pi runtime (`pi-ai`, `pi-coding-agent`) to 1.6.1, adding GPT-6.2 Astra and GPT-6.2 Sol on OpenAI, Azure, and OpenAI Codex, new Qwen Token Plan models, and GitHub Copilot / Radius decision models, along with Gemini 4 `xhigh`, OpenAI Codex caching/reconnection, transient retry, and `undici` 8.12.4 security fixes.
- Wired Pi's `after_provider_response` hook into parent and child sessions so HTTP 429 and `Retry-After` overload responses immediately coordinate provider backoff across concurrent agents.
- Forwarded provider `responseId` in the Work-mode `classify` tool result and aligned default Anthropic message-thread continuation with any `anthropic-messages` provider targeting `api.anthropic.com`.
