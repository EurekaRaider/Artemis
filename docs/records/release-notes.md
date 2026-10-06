# Artemis v1.7.3

## 中文

- 保留服务商导航滚动绘制优化和侧栏边缘修复，新增 14 种语言的轮换欢迎消息。
- 设计模式统一使用项目工作区文件，提供路径化 HTML 写入、局部编辑、自动预览刷新和真实像素标记截图；临时会话不启用设计模式。
- 薄快照保留写前原始内容及外部编辑，支持连续撤销、重做和历史恢复，每个文件最多保留 50 份；原有托管文档保留在 scratch 中，不迁移到文件列表。
- 修复符号链接路径越界、空 find 覆盖整文件、并发编辑、快照命名冲突、游标重置和宿主操作重放结果遗漏；写入前重新检查任务模式、绑定和授权。
- 修复项目页面演示退出及注释编辑期间延迟刷新的行为，更新工作区、权限和持久化回归测试。
- 主程序修订号升至 1.7.3，design 插件升至 0.4.5，更新 README 和独立签名插件包。

## English

- Include provider navigation paint optimization and sidebar edge fixes, with rotating welcome messages localized in 14 languages.
- Design mode uses project workspace files with path-based HTML writes, targeted edits, automatic preview refresh and real-pixel markup capture. Temporary chats do not enable Design mode.
- Thin snapshots preserve original content and external edits, support repeated undo, redo and historical restore, and retain at most 50 snapshots per file. Existing hosted documents remain in scratch storage and are not migrated into the file list.
- Fix symlink escapes, empty-find whole-file replacements, concurrent edits, snapshot name collisions, cursor resets and missing host-operation replay results. Recheck task mode, binding and authorization before writes.
- Fix project presentation exit and deferred refresh while editing annotations; update workspace, permission and persistence regression coverage.
- Advance the application revision to 1.7.3 and the Design plugin to 0.4.5; update the README and independently signed plugin pack.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
