# Artemis v1.7.1

## 中文

- Artemis 升级后，启动时检查已启用的 Design 与 Office 能力包，并在有兼容新版本时更新；检查失败会在下次启动重试。
- 插件市场新增更新检查和更新操作，完善能力包更新状态与反馈。
- Work 与 Codemode 支持由宿主审批的单次沙箱提权，保留项目信任、账号授权和默认沙箱设置。
- 改进设置中的服务商标签、下拉框定位和授权说明，整理仓库目录并增强布局校验。
- 服务商图标改为共享本地资源，减少 CSS 内嵌数据；同步修复设置页交互验证和样式契约。
- 同步版本标识与 README，继续通过双平台 CI、安装包验证及 macOS 签名和公证流程发布。

## English

- After an Artemis upgrade, check active Design and Office capability packs at startup and install a newer compatible version when available; retry failed checks on the next launch.
- Add marketplace update checks and update actions, with clearer capability pack update status and feedback.
- Support host-approved, single-call sandbox escalation in Work and Codemode while retaining project trust, account authorization and default sandbox settings.
- Improve provider labels, dropdown positioning and authorization descriptions in Settings; reorganize repository paths and strengthen layout verification.
- Emit provider icons as shared local assets to reduce inlined CSS data; repair settings interaction verification and style contracts.
- Synchronize version identifiers and the README, retaining cross-platform CI, package verification and macOS signing and notarization in the release pipeline.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
