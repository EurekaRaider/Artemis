# Artemis v1.6.10

## 中文

- **Office 批注**：Word、PPT、Excel 共用的批注面板支持拖动、清除选区和 Esc 取消；切换会话后恢复该文档会话的批注展开状态、草稿和选区。批注作为输入框卡片按文件分组，支持编辑、删除和返回来源；旧版本位置会显示提醒。
- **页面浏览**：Word、PPT 和 Excel 打印预览支持连续滚动，使用单一页码选择器，缩放控件更紧凑并恢复可见边框。仅对可见区域附近的页面绘制画布；PPT 保留幻灯片缩略导航，Excel 保留工作表与数据视图。
- **区域核对**：区域批注附带可读取的 PDF 文本片段和原始版本、页码、归一化坐标。执行时须核对当前内容，不将区域坐标猜测为段落或单元格索引。图像区域和无法准确提取的文字仍以区域坐标为准。
- **错误反馈**：Office 与 CSV 错误提示支持关闭，保留未保存草稿与保存入口；关闭提示不表示保存成功，也不会丢弃内容。

### 核实范围

#229、#231–#236 的界面问题已通过源码和回归测试确认并修复。#230 缺少原始文档，尚未复现其报告的具体偏移；本版增加可核对的选区文本、缩放坐标回归和防止猜测目标的约束，不宣称所有区域识别问题均已解决。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）和 Windows x64（未签名 ZIP）。复用已发布的 Office Runtime，不重建或替换运行时。Office 复杂格式保真及编辑范围限制保持原有约束。

## English

- **Office comments**: the shared Word, PowerPoint and Excel comment panel can be moved, and selections can be cleared explicitly or with Escape. Returning to a document session restores its comment state, draft and selection. Composer cards group comments by file and support editing, removal and source navigation, with warnings for older versions.
- **Page navigation**: Word, PowerPoint and Excel print previews scroll continuously with one page picker and a compact, bordered zoom control. Canvases render near the visible area. PowerPoint retains its slide strip; Excel retains worksheets and data view.
- **Region context**: region comments include readable PDF text runs when available, alongside the original version, page and normalized coordinates. The agent must verify current content instead of guessing native paragraph, object or cell indices from coordinates. Image regions retain their coordinates without fabricated text.
- **Errors**: Office and CSV error messages can be dismissed while preserving unsaved drafts and save controls. Dismissing a message does not mark changes as saved or discard them.

### Verification scope

The UI defects in #229 and #231–#236 were confirmed through source inspection and regression tests. The specific offset reported in #230 remains unconfirmed without its original document. This release adds verifiable text context, scaled-coordinate coverage and explicit target verification; it does not claim that every region recognition problem is resolved.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP). Existing published Office runtimes are reused without rebuilding or replacing them. Existing Office format-fidelity and editing limitations remain applicable.
