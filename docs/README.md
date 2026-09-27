# docs/ 导读

文档放置规则见 [AGENTS.md](AGENTS.md):根级只放总览,`features/` 功能域、`projects/` 进行中专项、`records/` 台账记录。

## 总览(根级)

| 文档                               | 说明                                     |
| ---------------------------------- | ---------------------------------------- |
| [architecture.md](architecture.md) | 系统架构总览(进程模型、包边界、信任分层) |
| [install.md](install.md)           | 安装与运行说明                           |

## features/ · 功能域

| 文档                                                             | 说明                                   |
| ---------------------------------------------------------------- | -------------------------------------- |
| [im-gateway.md](features/im-gateway/README.md)                   | IM 网关部署与协作(配置、指令、多设备)  |
| [im-security.md](features/im-security/README.md)                 | IM 安全边界(权限交集、审批、沙箱)      |
| [attachment-context.md](features/attachment-context/README.md)   | 附件上下文预算与保护                   |
| [插件与 Git 商店开发](features/plugin-marketplaces/README.md) | 第三方插件规范、签名与发布（中文） |
| [Plugin development guide](features/plugin-marketplaces/guide-en.md) | Plugin and Git marketplace development (English) |
| [Computer Use](features/computer-use/README.md) | macOS 与内置浏览器操作、安装、自动调用及验证 |
| [Office 工作台与能力包](features/office-workbench/README.md) | 三个插件的共享运行时、版本化会话与预览原型边界 |
| [custom-subagents/](features/custom-subagents/README.md)         | 自定义子智能体(索引 / 计划 / 实施状态) |

macOS 长期签名配置、只签名、独立公证与一条龙发布命令见 [本机 arm64 发布指南](features/macos-release/README.md)。

## projects/ · 进行中专项

- [消息接入引导式设置提案](projects/im-guided-settings/README.md)：实际参数、步骤依赖、五步首次设置、群协作与异常恢复。
- [群协作权限体系重新评估](projects/im-permission-redesign/README.md)：统一权限入口、按会话独立授权、写入调度、原生隔离及实施验收记录。
- [Office 工作台技术验证](projects/office-workbench/README.md)：30 份样本矩阵、原生和 UI 证据、未通过门槛与发布前流程。

## records/ · 台账

- [release-notes.md](records/release-notes.md)：当前版本的中英文公开发布说明，由 CD 随客户端产物发布。

| 文档                                                                     | 说明                                        |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| [skin-compatibility-ledger.md](records/skin-compatibility-ledger.md)     | 皮肤兼容账本                                |
| [management-appearance-audit.md](records/management-appearance-audit.md) | 管理面板外观审计记录                        |
| [readme-visuals.md](records/readme-visuals.md)                           | README 截图与视觉资产规范(capture 脚本配套) |

- [test-ci-audit.md](records/test-ci-audit.md)：测试与 CI 精简依据、覆盖保留和验证边界。
- [localization-audit.md](records/localization-audit.md)：多语言语义校对、翻译查找修复与覆盖边界。

## 自治区与资产

- [ui-prototype/](ui-prototype/README.md) — 静态原型(自带 README、工具与契约)
- [images/](images/) / [diagrams/](diagrams/) / [scripts/](scripts/) — 图片、图源、配套脚本

- [插件 OAuth v2](features/plugin-oauth/README.md)：声明、授权边界和开发者后端协议。
- [插件 OAuth 配对验收](projects/plugin-oauth-acceptance/README.md)：本地、真实账号和安装包验证记录。
