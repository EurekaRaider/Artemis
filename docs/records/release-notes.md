# Artemis v1.7.5

## 中文

- 升级 Pi 至 1.0.4，保留旧 Azure 服务商 ID 的模型、会话和凭据兼容，补齐 Codemode 子代理的工具启用。
- 工作区读取支持 PNG、JPEG、WebP 和 GIF，校验图片头、文件大小和解码像素上限，按模型限制调整图片尺寸；附件与工作区读取为 Codemode 提供可显示的图片结果。
- 对话中的文件工具组显示图片输出，保留下载入口。
- 主程序升级后只检查 Office 和 Design 能力包更新，由用户主动安装；更新完成后清理不再使用的旧版本，卸载时移除全部已安装版本并保护正在使用的能力包。
- 资源中心在能力包更新或卸载后刷新状态；移除 Design 插件时使用正确的修订命名空间，并保留其他已安装来源共享的修订。
- 更新 README 顶部、浅色与深色徽章和移动版图形，同步版本元数据至 1.7.5。

## English

- Upgrade Pi to 1.0.4, retain legacy Azure provider IDs for saved models, sessions and credentials, and enable the Codemode tool for child agents.
- Read PNG, JPEG, WebP and GIF workspace files with image-header, file-size and decoded-pixel limits, resizing for the model. Attachment and workspace reads expose displayable image results in Codemode.
- Show image output and download links in conversation file-tool groups.
- Check Office and Design pack updates after a host upgrade and require the user to install them. Retire unused older versions after completed updates; remove all installed versions on uninstall while protecting packs in use.
- Refresh Resource Center state after pack updates or removal. Remove Design plugin revisions from their correct namespace and retain revisions shared by other installed sources.
- Refresh README headers, light and dark badges and mobile graphics, and synchronize release metadata to 1.7.5.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
