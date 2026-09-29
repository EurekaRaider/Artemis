# Artemis v1.6.13

## 中文

- **项目上下文保护**：对话已有内容、正在发送或加载历史时，Composer 锁定项目选择，避免意外离开当前项目；空白对话仍可切换项目。
- **大文件提示**：文件超过预览大小限制时，显示实际限制和拆分、减小文件或使用其他应用打开的建议，不再直接显示内部调用错误。覆盖全部 14 种界面语言。
- **本地视频预览**：工作区文件和对话中的本地视频支持内嵌播放、拖动进度和失败重试。视频按需流式读取，切换会话或关闭播放器后释放访问；格式和编解码支持取决于系统播放器能力。
- **布局与阅读**：右侧工作区支持更宽的调整范围并保留宽度设置；工具活动组默认收起；调整部分通知和操作区域的布局。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Project context protection**: the Composer project picker is locked while a conversation has content, is submitting, or is loading history. Empty conversations can still switch projects.
- **Large-file guidance**: oversized previews show the actual size limit and suggest splitting, reducing, or opening the file in another app instead of displaying an internal IPC error. Available in all 14 interface languages.
- **Local video preview**: workspace files and local videos embedded in conversations support inline playback, seeking and retry. Videos stream on demand, and access is released when players close or conversations change. Format and codec support depends on the platform playback capabilities.
- **Layout and reading**: the workspace panel can expand further and retains its width; tool activity groups start collapsed; notification and action layouts are refined.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
