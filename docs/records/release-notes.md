# Artemis v1.7.0

## 中文

- 启动不再要求注册码、设备绑定或激活；保留插件信任、账号授权、凭据加密和原生沙箱。
- 支持 Windows x64 和 macOS arm64，改用 GitHub 公共托管 CI。外部贡献通过 fork 与 PR，发布使用明确附件清单。
- Windows 新增当前用户级 NSIS 安装包，ZIP 保持手动更新；安装版使用独立签名索引、附件验证、数据库快照和外部恢复助手。
- Windows Design runtime 接入 AppContainer，限制网络、子进程和任务外访问。
- 新增插件 v2 资源/交互契约、JSON Schema、轻量 runtime SDK 与开发工具；保留 v1 兼容和内容哈希授权。
- 历史翻页读取分页投影，时间线共享可见区域调度，会话派生缓存采用数量和内存双限。
- 更新 README、架构图、插件开发与双平台发布指南，移除过时的注册码及私有发布文档。

## English

- Remove activation, registration codes and device binding while retaining plugin trust, account authorization, encrypted credentials and native isolation.
- Target Windows x64 and macOS arm64 on GitHub-hosted CI, with fork pull requests and explicit release asset allowlists.
- Add per-user Windows NSIS distribution alongside manual ZIP downloads. Installed updates use a signed platform index, verified artifacts, database snapshots and an external recovery helper.
- Connect Windows Design runtimes to AppContainer with task-private writes, no network and child-process restrictions.
- Add v2 resource/interactive plugin contracts, JSON Schema, a lightweight runtime SDK and development tools, retaining v1 compatibility and content-hash trust.
- Read history from page-sized projections, share timeline visibility scheduling and bound derived-session caches by count and memory.
- Refresh the README, architecture diagrams and developer/release documentation; remove obsolete activation and private-release instructions.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
