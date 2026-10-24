# Artemis v1.7.19

## 中文

- Pi 升级至 1.4.0，适配 Artemis 现有扩展和并发补丁。保留主、子 Agent 的统一调度、排队取消、执行超时和 Worker 实际退出后释放容量的行为。
- 更新 Electron 至 43.8.3，并更新生产与开发依赖，修复本次审计发现的 25 项安全告警；发布前全量及生产依赖审计均为 0 告警。
- 优化 Codemode Worker 启动：使用 Pi 自带的独立 Worker 包，通过 CJS 入口减少模块加载开销。每次执行仍使用新的线程和隔离 VM，保留内存上限、工具权限及中止机制。
- 补齐 Pi 的重试错误分类、Responses 工具变更前缀、空白工具结果和压缩预算回归，避免确定性错误被重试，保留现有模型与会话功能。
- 本机 macOS arm64 签名安装包完成 1–64 路同负载交替对比，所有档位耗时中位数均低于升级前版本；真实钥匙串中的现有凭据、SQLite、Canvas、PTY 和 Seatbelt 验收通过。
- 随包 Slack CLI 更新至 4.11.0，并验证官方归档摘要、原生执行和本地兼容流程。

## English

- Upgrade Pi to 1.4.0 and adapt Artemis's existing extension and concurrency patches. Preserve shared scheduling for main and child agents, queued cancellation, execution deadlines and capacity release after the worker actually exits.
- Upgrade Electron to 43.8.3 and update production and development dependencies to resolve the 25 findings identified in this audit. Both full and production dependency audits report zero findings before release.
- Reduce Codemode worker startup overhead by using Pi's shipped self-contained worker through a CommonJS entry. Every execution retains a fresh thread and isolated VM, memory limits, tool permissions and abort handling.
- Expand regression coverage for retryable error classification, stable Responses prefixes across tool changes, whitespace-only tool results and compaction budgets. Preserve existing model and session behavior without retrying deterministic failures.
- Complete alternating same-load comparisons at 1–64 concurrent scripts on the locally signed macOS arm64 package; median batch times improve at every load compared with the previous version. Existing Keychain credentials, SQLite, Canvas, PTY and Seatbelt checks pass.
- Update the bundled Slack CLI to 4.11.0 and verify official archive digests, native execution and local compatibility flows.
