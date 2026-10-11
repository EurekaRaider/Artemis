# Artemis v1.7.13

## 中文

- 新增桌面输入框后续消息预测：普通回复结束后，在空输入框显示可选建议；Tab 填入、Escape 关闭，填入不会自动发送，可在设置中关闭。
- 预测复用当前模型回复，不新增模型请求；输入、附件、等待审批和用户决策时抑制建议，历史回放不恢复建议，后续模型上下文剔除预测元数据。
- 附件导入支持进度与取消，本地文件按需存储并批量索引；修复 PDF 原生附件工作线程的初始化，验收覆盖 1,000 个不同源路径。
- Windows CI 将完整桌面测试分为四个独立 runner 分片，分片内保持串行隔离，公共检查只执行一次，保留原生安全检查和现有测试时限。
- 增加 macOS x64 原生 CI 与签名、公证、打包流程；两种 macOS 架构各使用三个视觉验收分片，Intel 桌面测试使用两个分片。Release 可用 `publish=false` 完整验证打包而不发布。

- 将桌面与 Agent Host 的 Pi 升级到 1.1.0，适配中止事件和登录代理名称，保留依赖完整性检查。
- 主代理与自定义子代理在 Codemode 中可直接调用 Pi 原生分类和图片生成能力；分类工具支持传入图片，模型发现返回支持的输入类型。
- 自定义代理统一继承当前任务模式和宿主权限，移除设置中的工具白名单；旧配置与运行快照不再执行独立白名单限制。
- 保留 Plan 写入阻断、MCP 审批与沙箱、项目作用域、委派写入范围及代理生命周期校验。
- 修复浏览器延迟的旧导航响应覆盖新页面状态的问题，保留当前导航的错误提示。
- 包含 v1.7.11 的 Windows 更新恢复修复。若旧版无法在应用内安装更新，请下载并运行当前安装包一次。
- Computer Use、Design 和 Office 独立运行时沿用现有已发布版本。

## English

- Add optional next-message suggestions to the empty desktop composer after ordinary replies. Tab inserts a suggestion, Escape dismisses it, and insertion never sends it. Settings can disable suggestions.
- Reuse the current model response without an extra request. Suppress suggestions during typing, attachments, approvals and user decisions; history replay does not restore them, and subsequent model context excludes prediction metadata.
- Add attachment import progress and cancellation, on-demand local file storage and batch indexing. Initialize native PDF attachment workers before reading; acceptance covers 1,000 distinct source paths.
- Split the complete Windows desktop test suite across four independent runners, keep each shard serial and isolated, and run shared checks once while retaining native security checks and existing deadlines.
- Add native macOS x64 CI, signing, notarization and packaging. Each macOS architecture uses three visual shards, and Intel desktop tests use two shards. Release supports complete packaging validation with `publish=false` without publishing.

- Upgrade desktop and Agent Host Pi dependencies to 1.1.0, adapt aborted events and the provider login agent name, and retain dependency integrity checks.
- Enable native Pi classifier and image model operations in Codemode for main and custom child agents. Classification accepts images and model discovery reports supported input types.
- Make custom agents inherit the active task mode and host permissions. Remove the settings tool allowlist and stop applying separate allowlist restrictions from legacy definitions and runtime snapshots.
- Retain Plan write denial, MCP approval and sandboxing, project scope, delegated write scopes and agent lifecycle checks.
- Keep newer browser page state when an earlier navigation reply arrives late, while retaining current navigation errors.
- Include the Windows update recovery fixes from v1.7.11. If an older version cannot install the update in-app, download and run the current installer once.
- Retain the existing published Computer Use, Design and Office runtime versions.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
