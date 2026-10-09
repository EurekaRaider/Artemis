# Artemis v1.7.8

## 中文

- 修复 Computer Use 后台浏览器输入：原生下拉选项可按观察到的选项 ID 或精确标签选择，复选框、文本及键盘操作验证实际结果；拒绝编辑只读、禁用或被遮挡的控件。
- 操作失败时保留批次已完成进度，返回新的观察和明确错误；原生 helper 拒绝宿主时报告配对原因，暂停状态按聊天和轮次隔离。
- Computer Use 原生能力包升至 1.2.2，要求 Artemis 1.7.8 或更新版本；开发 Electron 使用独立开发 helper，已打包客户端继续使用签名运行时。
- Design 对话遵循普通 Plan、Work 和 Codemode 工具策略，移除独立权限档位及切换界面；旧数据库迁移保留绑定、模式与历史。Plan 写入限制、插件内容信任、沙箱及审批继续生效。
- Computer Use 预览排列在环境面板下方；桌面悬浮窗避开环境面板，移除悬浮预览设置开关。环境摘要中的已结束代理在五秒后隐藏，详情保留完整记录。
- 插件市场采用 SVG Design 图标，并增加真实 Electron 后台表单输入验收。

## English

- Fix Computer Use background browser input: select native options by observed ID or exact label, verify checkbox, text and keyboard results, and reject readonly, disabled or covered controls.
- Preserve completed batch progress on action failure and return a fresh observation with an explicit error. Report native helper host-pairing failures and isolate paused status by chat and turn.
- Publish Computer Use runtime 1.2.2 for Artemis 1.7.8 or newer. Development Electron uses a separate development helper; packaged clients continue to use signed runtimes.
- Apply ordinary Plan, Work and Codemode tool policies to Design chats, removing separate permission tiers and their controls. Preserve bindings, modes and history during migration. Plan write restrictions, plugin content trust, sandboxing and approvals remain enforced.
- Place Computer Use previews below the environment panel and keep the desktop floating window clear of that panel. Remove the floating-preview settings toggle. Hide finished agents from the compact activity list after five seconds while retaining their detail records.
- Use the SVG Design marketplace icon and add real Electron acceptance for background form input.

发布验收结果以本版本关联的 CI、最终产物检查和实际平台测试为准；源码变更清单不替代验收证据。
Release acceptance is established by the associated CI, final artifact checks and recorded platform tests, not by these change notes alone.
