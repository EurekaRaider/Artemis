# docs/ 导读

[文档管理规则](AGENTS.md)：根级保留架构和安装总览；`features/` 维护当前能力，`projects/` 保留未完成专项，`records/` 维护长期台账。已完成计划的有效结论并入功能文档，过程由 Git 历史追溯。

## 总览

| 文档                        | 说明                             |
| --------------------------- | -------------------------------- |
| [系统架构](architecture.md) | 进程模型、包边界、协议与执行策略 |
| [安装说明](install.md)      | 安装、插件与模型配置             |

## features/ · 功能与维护指南

| 文档                                                                   | 说明                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| [IM 接入与协作](features/im-gateway/README.md)                         | 服务部署、渠道接入、配对、命令与故障恢复             |
| [飞书 / Lark 扫码权限](features/im-gateway/feishu-scan-permissions.md) | 最小权限、事件订阅与实测边界                         |
| [Slack 自动设置](features/im-gateway/slack-cli-setup.md)               | 官方 CLI 接入、恢复与打包验证                        |
| [原生群协作](features/im-gateway/native-groups.md)                     | 平台身份、机器人协作、消息交付与剩余验收             |
| [IM 安全边界](features/im-security/README.md)                          | 文件与执行范围、群授权事务、外发与任务控制           |
| [附件上下文](features/attachment-context/README.md)                    | 上下文预算与附件保护                                 |
| [自定义子智能体](features/custom-subagents/README.md)                  | 项目关联、结构化调用、权限快照、限制与回退           |
| [Hooks 开发指南](features/hooks/README.md)                             | 钩子配置、信任、执行边界与示例                       |
| [Hooks English guide](features/hooks/guide-en.md)                      | Hook events, command protocol and plugin integration |
| [Connectors](features/connectors/README.md)                            | 账号连接、凭据绑定、执行与开发者配置                 |
| [插件 OAuth v2](features/plugin-oauth/README.md)                       | 声明、授权边界和开发者后端协议                       |
| [插件与 Git 商店开发](features/plugin-marketplaces/README.md)          | 第三方插件规范、签名、分发和更新                     |
| [Plugin development guide](features/plugin-marketplaces/guide-en.md)   | Plugin and Git marketplace development in English    |
| [Computer Use](features/computer-use/README.md)                        | macOS 与内置浏览器操作、许可、停止及验证             |
| [Office 工作台](features/office-workbench/README.md)                   | 共享运行时、会话、预览、编辑与保护边界               |
| [离线授权](features/offline-licensing/README.md)                       | 签发、续期、恢复及客户端边界                         |
| [多语言维护](features/localization/README.md)                          | 语言资源、术语、RTL 与验证约定                       |
| [macOS 签名与公证](features/macos-release/README.md)                   | 本机配置、分阶段构建、签名与公证                     |
| [macOS 手动发布](features/macos-release/manual-release.md)             | 最终包检查、上传及公开发布步骤                       |

## projects/ · 未完成专项

| 文档                                                                      | 当前范围                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------- |
| [IM 权限与真实群验收](projects/im-permission-redesign/README.md)          | 已实现边界、双机流程及目标平台待验收项         |
| [Office 技术验证](projects/office-workbench/README.md)                    | 样本矩阵、运行时发行证据、格式保真及剩余门槛   |
| [OAuth 配对验收](projects/plugin-oauth-acceptance/README.md)              | 宿主/插件配对、真实账号及安装包待验收项        |
| [Computer Use 后续计划](projects/issues-225-227/repair-plan.md)           | #226 原始暂停场景的复现输入和验收要求          |
| [Issues 225–227 验证](projects/issues-225-227/verification.md)            | #225/#227 修复证据与 #226 未闭合边界           |
| [设计模式探索](projects/design-mode-proposal/README.md)                   | 插件项目类型、双向面板交互及资料缺口           |
| [OpenDesign 参考附件](projects/design-mode-proposal/references/README.md) | 外部固定版本材料；原仓库引用按附件导读回源查阅 |

## records/ · 长期台账

| 文档                                                 | 说明                                           |
| ---------------------------------------------------- | ---------------------------------------------- |
| [发布说明](records/release-notes.md)                 | 当前版本中英文公开说明，Release 工作流直接消费 |
| [CI 与验证维护](records/ci-reliability.md)           | 当前命令、工作流范围、失败诊断与证据要求       |
| [皮肤兼容台账](records/skin-compatibility-ledger.md) | Skin v1 契约、历史里程碑及持续 UI 审查约定     |
| [README 视觉资产](records/readme-visuals.md)         | 截图规范、隐私检查、清单与复现方式             |

## 原型、示例与资产

- [UI 原型](ui-prototype/README.md)：自治的 HTML 原型、工具、历史证据及冻结基线状态。
- [Hooks 示例](examples/hooks/hooks.json)：配置、脚本及[示例插件](examples/hooks/plugin/.codex-plugin/plugin.json)。
- [图片](images/)与[截图清单](images/screenshots/manifest.json)：当前文档资产，删除前核对引用和 manifest。
- [架构图源](diagrams/)与[截图脚本](scripts/capture-readme.mjs)：图源与文档配套工具。
