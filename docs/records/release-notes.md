# Artemis v1.7.6

## 中文

- Computer Use 改为独立下载的原生能力包，支持 macOS 14+ arm64 与 Windows 11 x64；内置插件商店保留唯一入口，无需用户安装额外工具链。
- 增加签名清单、平台与宿主兼容检查、下载取消及篡改拒绝；更新由用户主动执行，运行中任务保留旧版本，释放后清理。
- Windows 原生运行时使用 UI Automation、窗口捕获和受授权的前台输入；macOS 运行时采用 Developer ID 签名、公证与 stapling。两个平台均使用 Ed25519 包签名，并在原生 runner 验证最终运行包后发布稳定目录。
- 应用访问与前台控制授权支持持续保存和撤销；停止、用户接管、原生进程退出和过期观察均阻止继续输入。
- 浏览器表单填写验证最终值，并加固调试会话生命周期、窗口变化及截图恢复。
- 更新 14 种界面语言、插件开发契约、README 与 1.7.6 版本元数据。

## English

- Deliver Computer Use as independently downloaded native capability packs for macOS 14+ arm64 and Windows 11 x64, with one Bundled plugins entry and no user-installed toolchain.
- Add signed manifests, platform and host compatibility checks, download cancellation and tamper rejection. Updates remain manual; active tasks retain the old runtime until it can be cleaned up.
- Use UI Automation, window capture and authorized foreground input on Windows. The macOS runtime uses Developer ID signing, notarization and stapling. Both platforms use Ed25519 package signatures; stable catalog publication follows verification of final runtime archives on their native runners.
- Persist and revoke application-access and foreground-control grants. Stop, user takeover, helper exit and stale observations prevent further input.
- Verify final browser form values and harden debug-session lifecycle, window changes and capture recovery.
- Update 14 interface languages, plugin development contracts, README and release metadata to 1.7.6.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
