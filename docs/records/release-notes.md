# Artemis v2.0.1

## 中文

- 修复资源中心 MCP 沙箱与兼容模式胶囊内图标、文字未居中的问题。
- 恢复 Office、设计插件卡片的专属图标，避免显示通用文档或设计图标。
- 修复输入框 `@` 插件列表统一显示默认技能图标的问题，优先使用插件自带图标并保留品牌图标回退。
- 群聊项目授权概览按群身份和项目归组，避免同一群通过多个机器人连接时重复显示；不同租户、平台、群或项目仍独立保留，同名群显示区分信息，各机器人授权可分别管理。

## English

- Center icons and labels inside the Resource Center's MCP sandbox and compatibility mode pills.
- Restore the dedicated Office and Design plugin artwork on their cards.
- Show each plugin's own icon in composer `@` suggestions, with the existing brand fallback when a manifest icon is unavailable.
- Group project authorization summaries by group identity and project so multiple bot connections do not duplicate the same group. Keep different tenants, platforms, groups and projects separate, distinguish same-named groups, and preserve independent bot authorization management.
