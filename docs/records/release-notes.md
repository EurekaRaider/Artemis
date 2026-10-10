# Artemis v1.7.11

## 中文

- 修复 Windows 点击“安装更新”后更新助手未就绪、界面重新回到安装按钮的问题；更新助手可在应用退出后继续安装，并避免占用待替换的安装文件。
- 修复更新恢复状态的中文路径读取和应用重启参数传递，支持包含中文和空格的路径。
- 安装失败原因持续显示在侧边栏和更新设置中，重试时清除旧错误。
- 新版本安装成功并通过健康检查后，自动删除上一版本安装包；更新失败时保留旧包并恢复升级前数据库，清理失败不会误触发回滚。
- 确认 macOS 已有健康启动后清理安装包与更新缓存、清理失败后下次启动重试的逻辑。
- 若旧版 Windows 仍无法在应用内安装更新，请下载并运行 v1.7.11 安装包一次，替换为修复后的更新助手。
- Computer Use、Design 和 Office 独立运行时沿用现有已发布版本。

## English

- Fix Windows updates returning to the install button when the recovery helper fails to become ready. The helper continues after the application exits and avoids locking installation files that must be replaced.
- Correct recovery state decoding and application restart arguments for paths with spaces or non-ASCII characters.
- Keep installation errors visible in the sidebar and update settings, and clear them when retrying.
- Remove the previous installer after the new version installs and passes its health check. Failed updates retain the rollback installer and restore the pre-update database; cleanup errors do not trigger rollback of a healthy update.
- Confirm the existing macOS cleanup of successful update packages and caches, including retries on a later healthy startup when cleanup fails.
- If an older Windows version cannot install the update in-app, download and run the v1.7.11 installer once to obtain the repaired updater.
- Retain the existing published Computer Use, Design and Office runtime versions.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
