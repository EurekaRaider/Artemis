# Artemis v1.7.7

## 中文

- 增加按会话隔离的 Computer Use GPU 预览及画中画窗口，支持浏览器与原生桌面捕获，并修复关闭、会话切换、拖动和悬停控件。
- Computer Use 原生能力包升至 1.2.1，要求 Artemis 1.7.7 或更新版本；客户端和运行时分别发布并验证。
- 修复插件市场的慢网络更新检查：Office、Design 与 Computer Use 的签名清单采用 60 秒有界下载预算，失败保留已验证版本并允许重试。
- 设计聊天默认保持受限；可信插件经用户在宿主界面明确选择后，可使用普通 Work/Codemode 权限及设计工具。权限逐聊天保存，升级前关闭旧会话，进行中的轮次与待处理审批禁止升级。Plan、插件信任、MCP 沙箱、扩展信任及既有审批规则继续生效。
- 修复 Computer Use 迁移、下载、等待、重试及更新按钮布局；迁移入口明确显示“安装运行时”，长状态信息与操作标签分开展示。
- 将插件市场来源名称及重新获取引导统一为“Artemis 插件”，同步全部 14 种界面语言，并保持内部来源与安装逻辑。

- 修复浅色/深色界面的文字对比度：输入框提示、项目分组与会话时间、增删数字、文件状态、MCP 调用次数和快捷键提示使用对应的文字颜色，并增加双主题对比度回归检查。

## English

- Add session-scoped GPU Computer Use previews and picture-in-picture windows for browser and native desktop capture, with fixes for close behavior, session changes, dragging and hover controls.
- Publish Computer Use runtime 1.2.1 for Artemis 1.7.7 or newer. Verify and publish the client and native runtime independently.
- Fix slow-network catalog checks: Office, Design and Computer Use signed feeds use a bounded 60-second download budget, retaining verified versions on failure and allowing retry.
- Keep design chats restricted by default. After an explicit host UI choice for a trusted plugin, standard Work/Codemode tools coexist with design tools. Persist permissions per chat, close the old session before upgrading, and refuse changes during active turns or pending approvals. Plan, plugin trust, MCP sandboxes, extension trust and existing approval rules remain enforced.
- Fix Computer Use migration, download, waiting, retry and update action layouts. Label migration as “Install runtime” and display long status messages separately from action labels.
- Rename the marketplace source and reinstall guidance to “Artemis plugins” in all 14 interface languages, preserving internal source and installation behavior.

- Improve light and dark text contrast for input placeholders, project groups and conversation timestamps, change counts, file statuses, MCP call counts and keyboard hints, with regression checks for both themes.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
