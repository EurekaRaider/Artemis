# Artemis v1.6.11

## 中文

- **精确批注（#240）**：进入批注模式后，可在 Office 页面文字上按字选择。批注引用保留实际选中的文字，不再把几个字扩大成整个 PDF 文本块；空白和图像区域继续支持框选。
- **定位开关（#238）**：“跟随更新”改为“自动定位到最新修改”，并解释它控制最新 AI 修改位置的跳转，不影响保存。
- **关闭与更新恢复（#237）**：保存失败时关闭标签页会显示原因，提供继续编辑、重试保存及明确确认后的保留草稿并关闭。草稿存储成功后才解除该编辑器的退出保存检查；重新打开文件恢复检查。保留草稿不等于已保存到文档。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。原始用户文件未提供，修复依据为源码验证和回归测试；不宣称所有复杂文档布局均已验证。

## English

- **Precise comments (#240)**: Office comment mode supports native character selection over page text. Quotes retain the selected characters instead of expanding to a whole PDF text run. Blank and image areas still support region selection.
- **Navigation switch (#238)**: “Go to latest change” explains that following the latest AI edit changes the reading position without affecting saving.
- **Close and update recovery (#237)**: failed tab saves show the error and actions to keep editing, retry, or explicitly retain an Office draft and close. Draft storage must succeed before that editor leaves the shutdown save gate; reopening restores the gate. Retention does not mean the document was saved.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Original reporter files were unavailable; fixes are grounded in source verification and regression tests, not universal complex-document layout acceptance.
