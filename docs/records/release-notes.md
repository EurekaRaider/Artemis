# Artemis v1.7.10

## 中文

- Windows 主窗口使用统一标题栏，在支持的系统上使用原生 Acrylic 玻璃材质，并保留系统窗口按钮。
- Windows 标题按钮始终在右侧预留空间，修复 RTL 高倍缩放时环境面板自动关闭的问题。
- Windows 环境弹窗在标题栏下方保留原有阅读空间，避免中等宽度窗口意外关闭面板。
- Windows 面板支持展开、收起与反向切换动画；拖动调整宽度时直接跟随指针，减少动态效果偏好禁用动画。
- 减少透明度、高对比度或强制颜色模式使用不透明表面；Computer Use 控件随窗口材质变化清除或恢复透明区域。
- 已固定在底部的聊天在展开内容及面板尺寸变化时及时跟随最新内容。
- Computer Use、Design 和 Office 独立运行时沿用现有已发布版本。

## English

- Use a unified Windows main-window title bar with native Acrylic surfaces on supported systems and retain the system caption buttons.
- Reserve Windows caption space on the physical right so the environment panel remains available in RTL layouts at high zoom.
- Keep the existing reading area below the Windows caption row so medium-width windows do not unexpectedly close the environment panel.
- Animate Windows panel opening, closing and reversals. Follow pointer resizing directly and disable animation when reduced motion is requested.
- Use opaque surfaces for reduced transparency, high contrast or forced colors. Remove or restore the Computer Use control cutout when the window material changes.
- Keep chats pinned to the latest content as disclosures expand and panels change size.
- Retain the existing published Computer Use, Design and Office runtime versions.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
