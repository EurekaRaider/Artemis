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
| [plugin-marketplaces.md](features/plugin-marketplaces/README.md) | GitHub 插件市场设计                    |
| [custom-subagents/](features/custom-subagents/README.md)         | 自定义子智能体(索引 / 计划 / 实施状态) |

## projects/ · 进行中专项

- [消息接入引导式设置提案](projects/im-guided-settings/README.md)：实际参数、步骤依赖、五步首次设置、群协作与异常恢复。

## records/ · 台账

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
