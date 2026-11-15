# Artemis v2.0.9

## 中文

- 支持从已完成的历史回复创建分支，同步截断 Pi 上下文、界面历史和附件，保留原会话；工作目录文件不会回滚。
- 接入个人和项目 Markdown 提示词模板，可通过 `/` 查找并带参数使用；排队消息的编辑、立即发送及中断恢复保留原始命令和附件。
- 为自定义模型提供常用兼容选项，覆盖 OpenAI Completions、OpenAI Responses 和 Anthropic Messages，并在请求层执行相应设置。
- 修复模板异常文件、重复展开、删除后的缓存残留，以及会话分支创建失败时的附件和会话文件清理问题。

## English

- Fork a new conversation from a completed historical reply, keeping Pi context, visible history and attachments at the same boundary while preserving the original conversation. Workspace files are not rolled back.
- Use personal and project Markdown prompt templates through `/` commands with arguments. Queue editing, steering and interrupted-message recovery preserve the original command and attachments.
- Configure common custom-model compatibility options for OpenAI Completions, OpenAI Responses and Anthropic Messages, with the settings enforced in provider requests.
- Fix malformed template handling, repeated expansion, stale templates after deletion, and attachment/session cleanup when creating a conversation fork fails.
