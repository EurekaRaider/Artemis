# Artemis v1.7.18

## 中文

- Pi 升级至 1.3.0。Codemode 使用 Artemis 的统一并发调度，保留现有主、子 Agent 并发能力；真实 Worker 回归覆盖最高 64 路并发、单脚本并行工具和多层子任务等待。
- 补齐 Codemode 排队取消、执行中止和超时后的资源回收，Worker 实际退出后才释放容量，确保取消后的替换任务可继续运行，避免父任务等待子任务时占满执行槽位。
- 兼容 Kimi Coding 官方旧端点和新版工具声明；保留自定义代理地址。改进自定义 Responses 的工具参数 JSON 修复、Schema 校验、错误图片保留和流式取消，防止取消后返回成功或执行不完整工具调用。
- 新增会话分享：从项目任务或最近会话菜单创建当前分支的固定快照，逐条选择消息；工具详情、思考内容和图片默认不分享，可按需开启。快照移除私有工作区及模型配置，跨平台导出统一使用脱敏路径。
- 支持导出离线 HTML、上传至 Radius 或 Secret Gist，并提供分享历史、复制链接和管理入口。上传需要明确操作，支持取消并防止重复上传；Secret Gist 仅是不公开列出，持有链接的人均可阅读。
- 重新设计分享对话框、内容选择与历史操作，修复预览黑屏；隔离的 HTML 预览跟随深浅色主题，深色背景下保留清晰的文字和边界，并适配窄窗口。
- 补齐 Pi 1.3.0 并发与取消、Kimi、自定义 Responses、快照脱敏、分享交互及深浅色预览回归测试。

## English

- Upgrade Pi to 1.3.0. Codemode uses Artemis's shared concurrency scheduler to preserve existing main and child agent capacity. Real-worker regression checks cover up to 64 concurrent workers, parallel tools within one script and nested child-task waits.
- Complete queued cancellation, execution abort and timeout cleanup. Capacity is released after the worker actually exits, allowing replacement work to proceed without parent tasks exhausting runnable slots while waiting for children.
- Support legacy official Kimi Coding endpoints and updated tool declarations while preserving custom proxy URLs. Improve custom Responses tool-argument JSON repair, schema validation, error-image retention and streaming cancellation; reject late success after cancellation and incomplete tool calls.
- Add conversation sharing from project task and Recents menus. Review a fixed snapshot of the current branch and select individual messages. Tool details, thinking and images are excluded by default and can be enabled explicitly. Snapshots remove private workspace and model configuration and use a consistent redacted path across platforms.
- Export offline HTML or upload to Radius or a secret GitHub Gist, with share history, link copying and management actions. Uploads require an explicit action, support cancellation and prevent duplicate submissions. Secret Gists are unlisted; anyone with the link can read them.
- Redesign the sharing dialog, content selection and history actions, and fix blank previews. The isolated HTML preview follows light and dark themes with readable text, visible boundaries and a layout that adapts to narrow windows.
- Expand regression coverage for Pi 1.3.0 concurrency and cancellation, Kimi, custom Responses, snapshot redaction, sharing interactions and light/dark previews.
