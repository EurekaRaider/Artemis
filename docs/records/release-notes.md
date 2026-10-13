# Artemis v1.7.16

## 中文

- Office 原生签名校验在子进程超时后最多重试一次，并保留退出码、信号和耗时；签名无效仍立即阻止安装。

- macOS Office 和 Computer Use 安装在 Apple 票据验证连接中断时有限重试，并保留失败诊断；无效票据仍阻止安装。

- 内置 Slack CLI 更新至 4.10.0，并重新验证三平台官方附件摘要与原生兼容性。

- 优化历史对话的可见性检测：普通滚动复用观察器结果，跨越预加载区域的大幅跳转仍及时显示内容，减少同步布局测量。
- 审查面板只加载当前选中的差异范围，减少未暂存和已暂存差异的重复预取。
- 已完成轮次的差异保持缓存，不再因新的 Agent 输出或文件变更计数而反复刷新；用户执行审查操作后仍刷新当前差异。

## English

- Retry Office native signature verification once after a subprocess timeout and preserve exit, signal, and timing diagnostics; invalid signatures still immediately block installation.

- Retry dropped Apple ticket-validation connections during macOS Office and Computer Use installation, preserving failure diagnostics and continuing to reject invalid tickets.

- Update the bundled Slack CLI to 4.10.0 and revalidate official archive digests and native compatibility on all three platforms.

- Reduce synchronous layout measurements while scrolling conversation history by reusing visibility observations, while keeping content visible after jumps beyond the preload buffer.
- Load only the selected review scope instead of prefetching unstaged and staged diffs.
- Keep completed-turn diffs cached as new agent output and file-change counts arrive; review actions still refresh the selected diff.
