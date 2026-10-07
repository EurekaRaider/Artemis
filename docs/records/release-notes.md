# Artemis v1.7.4

## 中文

- 补齐 14 种语言的桌面界面与 IM 提示，包括 Office、Design、文件预览、Computer Use、工作树和群成员识别信息。
- Design 面板通过宿主提供语言文案，更新加载、文件操作、历史、演示和标记截图提示，并补充本地化与渲染验证。
- 资源中心显示已安装的插件版本，在 Design 插件安装或更新后刷新状态；停用的能力包仍显示其已安装版本。
- 调整服务商登录标题、选择器和操作按钮布局，改进窄窗口中的显示。
- 生产构建共享多语言消息键名，减少重复 JS 字节，保留全部文案及现有性能门禁。
- 升级 MCP SDK 至 1.32.1，保留 OAuth 凭据的授权服务器绑定；缺少 issuer 的旧凭据需重新授权。
- 同步主程序、工作区包、锁文件、MCP 身份、主题和版本契约至 1.7.4，Design 插件升至 0.4.6，更新 README。

## English

- Complete desktop and IM messages in all 14 supported languages, including Office, Design, file previews, Computer Use, worktrees and group member resolution.
- Supply Design panel copy from the host for loading, file operations, history, presentation and markup capture, with localization and rendered-panel verification.
- Show installed plugin versions in the Resource Center and refresh status after Design pack installation or updates. Inactive capability packs still show their installed version.
- Align provider login headings, selectors and action buttons, including narrow-window layouts.
- Share locale message keys in production builds to reduce duplicate JavaScript bytes while preserving all messages and existing performance budgets.
- Upgrade the MCP SDK to 1.32.1 and preserve authorization-server binding on OAuth credentials. Legacy credentials without an issuer require authorization again.
- Synchronize the application, workspace packages, lockfile, MCP identities, theme and version contracts to 1.7.4; advance the Design plugin to 0.4.6 and update the README.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
