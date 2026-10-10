# Artemis v1.7.12

## 中文

- 将桌面与 Agent Host 的 Pi 升级到 1.1.0，适配中止事件和登录代理名称，保留依赖完整性检查。
- 主代理与自定义子代理在 Codemode 中可直接调用 Pi 原生分类和图片生成能力；分类工具支持传入图片，模型发现返回支持的输入类型。
- 自定义代理统一继承当前任务模式和宿主权限，移除设置中的工具白名单；旧配置与运行快照不再执行独立白名单限制。
- 保留 Plan 写入阻断、MCP 审批与沙箱、项目作用域、委派写入范围及代理生命周期校验。
- 修复浏览器延迟的旧导航响应覆盖新页面状态的问题，保留当前导航的错误提示。
- 包含 v1.7.11 的 Windows 更新恢复修复。若旧版无法在应用内安装更新，请下载并运行当前安装包一次。
- Computer Use、Design 和 Office 独立运行时沿用现有已发布版本。

## English

- Upgrade desktop and Agent Host Pi dependencies to 1.1.0, adapt aborted events and the provider login agent name, and retain dependency integrity checks.
- Enable native Pi classifier and image model operations in Codemode for main and custom child agents. Classification accepts images and model discovery reports supported input types.
- Make custom agents inherit the active task mode and host permissions. Remove the settings tool allowlist and stop applying separate allowlist restrictions from legacy definitions and runtime snapshots.
- Retain Plan write denial, MCP approval and sandboxing, project scope, delegated write scopes and agent lifecycle checks.
- Keep newer browser page state when an earlier navigation reply arrives late, while retaining current navigation errors.
- Include the Windows update recovery fixes from v1.7.11. If an older version cannot install the update in-app, download and run the current installer once.
- Retain the existing published Computer Use, Design and Office runtime versions.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
