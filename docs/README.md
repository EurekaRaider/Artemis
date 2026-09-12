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

| 文档                                                               | 说明                           |
| ------------------------------------------------------------------ | ------------------------------ |
| [design-p0.md](projects/design-p0/README.md)                       | 设计工作流 P0 方案             |
| [design-workflow.md](projects/design-workflow/README.md)           | 任务设计工作流实现             |
| [p0-acceptance-matrix.md](projects/p0-acceptance-matrix/README.md) | P0 验收矩阵(安全门禁)          |
| [design-mode-proposal/](projects/design-mode-proposal/)            | 设计模式调研报告与方案(进行中) |

## records/ · 台账

| 文档                                                                     | 说明                                        |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| [skin-compatibility-ledger.md](records/skin-compatibility-ledger.md)     | 皮肤兼容账本                                |
| [management-appearance-audit.md](records/management-appearance-audit.md) | 管理面板外观审计记录                        |
| [readme-visuals.md](records/readme-visuals.md)                           | README 截图与视觉资产规范(capture 脚本配套) |

## 自治区与资产

- [ui-prototype/](ui-prototype/README.md) — 静态原型(自带 README、工具与契约)
- [images/](images/) / [diagrams/](diagrams/) / [scripts/](scripts/) — 图片、图源、配套脚本
