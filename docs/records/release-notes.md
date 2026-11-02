# Artemis v2.0.0

## 中文

- 更新 Nocturne 界面，统一侧边栏、会话、设置、资源中心和自动化页面的布局、图标与字体；支持持久保存玻璃或纯色界面偏好，并完善键盘焦点与菜单导航。
- 改进任务执行展示：结构化工作记录、计划与待确认操作更清晰，保留中断回复和任务终态；完善欢迎页继续任务、历史记录、群组上下文和消息时间显示。
- 优化工作区 Dock、文件与 Markdown 编辑、终端和代码审查布局，改善窄窗口、高缩放及从右到左语言下的显示与操作。
- 修复环境面板分支菜单背景透明、文字与后方内容重叠的问题，并确保高对比度和减少透明度模式下的侧边栏保持不透明。
- 完善本地检出与托管 worktree 的工作区操作，支持在项目界面编辑 AGENTS.md，并通过 Artemis 任务链接打开已有会话。
- 改进模型选择与配置、归档批量操作和更新提示，修复资源条目重复、状态显示、消息操作及多语言布局问题。
- 刷新随附 Slack CLI 至 v4.12.0，并补充离线字体授权与界面回归验证。
- 能力包按最低宿主版本判断兼容性，移除主版本上限；保留旧清单签名及既有平台、协议与沙箱验证，使已安装能力包可以继续用于 Artemis 2.0.0。

## English

- Introduce the Nocturne interface across the sidebar, conversations, settings, resource center and automations, with consistent layouts, icons and fonts. Save glass or solid appearance preferences and improve keyboard focus and menu navigation.
- Clarify task progress with structured work records, plans and pending decisions while preserving interrupted replies and final task states. Improve task resumption, history, group context and message timestamps.
- Refine the workspace dock, file and Markdown editors, terminal and code review layouts for narrow windows, high zoom and right-to-left languages.
- Restore the environment branch menu surface so its text stays readable over page content, and keep the sidebar opaque in high-contrast and reduced-transparency modes.
- Improve workspace operations for local checkouts and managed worktrees, add an in-app project AGENTS.md editor, and open existing conversations through Artemis task links.
- Improve model selection and configuration, batch archive actions and update notices. Fix duplicate resource entries, status presentation, message actions and localized layouts.
- Refresh the bundled Slack CLI to v4.12.0 and include offline font licensing and additional UI regression verification.
- Check capability compatibility against the minimum host version without a major-version ceiling. Preserve legacy manifest signatures and existing platform, protocol and sandbox verification so installed packs remain usable with Artemis 2.0.0.
