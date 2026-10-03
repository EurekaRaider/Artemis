# Artemis v1.6.19

## 中文

- **会话欢迎页**：按本地时间显示早晨、下午、晚上或深夜问候，结合用户名称和项目上下文，支持全部 14 种界面语言。
- **消息操作**：修复消息下方操作按钮的显示与点击区域，复制按钮使用支持鼠标和键盘的统一提示。图片右键菜单新增“复制图片”。
- **文件卡片**：时间线文件卡片使用彩色文件图标，HTML 文件采用网页图标。
- **HTML 预览**：隔离的交互式 HTML 预览随内容调整高度，保留流式回复中的页面状态，避免视口高度反馈循环，并在失败时提供重试。
- **Slack CLI**：将内置 CLI 更新至官方稳定版 **4.9.0**，同步三平台下载与二进制摘要。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Conversation welcome**: show morning, afternoon, evening or late-night greetings based on local time, with the user name and project context in all 14 interface languages.
- **Message actions**: fix the visibility and click area of actions below messages, and use the shared copy tooltip with mouse and keyboard support. Add Copy Image to the native image context menu.
- **File cards**: use colored file artwork in timeline cards and a webpage icon for HTML files.
- **HTML previews**: resize isolated interactive HTML previews to their content, retain page state during streamed replies, prevent viewport-height feedback loops and offer retry after failures.
- **Slack CLI**: update the bundled CLI to official stable **4.9.0**, with refreshed download and executable digests for all three supported platforms.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
