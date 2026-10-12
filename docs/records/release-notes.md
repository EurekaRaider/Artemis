# Artemis v1.7.15

## 中文

- 展开右侧工作区面板时隐藏 Computer Use 浮动预览和控制条，避免遮挡或挤压面板；收起后恢复预览。
- 环境面板等待工作区面板完成收起后再显示，并提前同步时间线、状态与输入区的预留空间，避免内容短暂伸到面板后再复位。
- 环境面板的位置随窗口与工作区面板尺寸变化同步更新，保留窄窗口自动收起、手动打开与减少动态效果设置。

- 修复退出期间 IM 状态刷新访问已关闭存储的问题；先停止后台活动，再在窗口关闭后释放状态存储。
- macOS 发布票据验证遇到 Apple CloudKit 连接中断时进行有限重试；错误票据仍立即阻止发布。

- 小附件的原件复制缓冲按文件大小分配，减少批量导入时不必要的内存分配。

## English

- Hide the floating Computer Use preview and controls while the workspace dock is open, and restore the preview when it closes.
- Wait for the dock to finish closing before showing the environment panel. Reserve space for the timeline, status and composer during the transition so content does not briefly extend behind the panel.
- Keep environment panel geometry synchronized with window and dock resizing while preserving automatic collapse in narrow windows, manual opening and reduced motion settings.
- Quiesce IM background work before quitting and keep its database available until windows close, so in-flight status requests can finish safely.
- Retry dropped Apple CloudKit connections during macOS release ticket validation, while still blocking publication immediately for invalid tickets.
- Size original-copy buffers to small files to reduce allocation pressure during bulk attachment import.
