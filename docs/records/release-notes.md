# Artemis v2.0.12

## 中文

- 改善浏览历史对话时的滚动体验，尤其是同一条回复中带有多个 HTML 预览和 PDF 文件卡片时。快速滚动时延后加载 HTML，返回旧消息时保留已测量的预览高度，减少阅读位置跳动。
- 在 HTML 预览上滚动可继续浏览聊天记录。预览内的表格等区域优先响应滚动，到达边界后可接着滚动外层对话。
- 较早的对话记录按需分页加载。工作区快照优先处理本轮改动的文件，并修复 Windows 保存重试时的检查点写入问题。

## English

- Improve scrolling through conversation history, especially replies with multiple HTML previews and PDF file cards. HTML previews defer loading during fast scrolling and retain their measured space when revisited, reducing jumps in reading position.
- Scroll through the conversation with the pointer over an HTML preview. Scrollable regions inside the preview, such as tables, handle the gesture first and hand scrolling back to the conversation at their boundaries.
- Load older conversation pages on demand. Workspace snapshots focus on files changed during the turn, and checkpoint writes now use a writable handle when retrying a save on Windows.
