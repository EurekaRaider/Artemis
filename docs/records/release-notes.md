# Artemis v1.6.12

## 中文

- **定时任务设置**：重新整理任务列表和编辑弹窗，将执行设置与时间设置分组。每个任务可选择可用模型及其支持的思考强度，保存后独立于全局默认模型；模型或思考强度变更按原有规则重新请求执行授权。不可用的模型会阻止保存并给出提示，保存失败时保留表单内容。
- **工作区状态保留**：按会话记住已打开的标签页、当前标签页和工作区面板展开状态，切换会话或重启后恢复。历史回放不会重新打开已关闭的 Office 标签页；新打开文档仍会展示对应工作区。
- **阅读偏好保留**：记住侧栏及项目分组展开状态、Markdown 富文本/源码模式，以及 Office 缩放、表格网格/打印视图和“自动定位到最新修改”偏好。查看批注时临时暂停自动定位，不改写用户的长期选择。
- **界面与兼容性**：定时任务支持窄窗口布局，新增说明覆盖全部 14 种界面语言；旧任务与数据库保留兼容，未指定模型的旧任务继续沿用已有默认行为，直到编辑保存。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Scheduled task settings**: reorganized the task list and editor into execution and schedule sections. Each automation can retain an available model and supported reasoning level independently of the global default. Model or effort changes renew execution authorization under the existing rules. Unavailable models block saving with an explanation, and failed saves preserve form inputs.
- **Workspace restoration**: open tabs, the active tab and dock visibility are retained per conversation across task switches and restarts. History replay keeps closed Office tabs closed, while newly opened documents still reveal their workspace.
- **Reading preferences**: sidebar and project-group visibility, Markdown rich/source mode, Office zoom, grid/print view and the **Go to latest change** preference are remembered. Reviewing a comment temporarily pauses automatic navigation without changing the saved preference.
- **UI and compatibility**: scheduled tasks adapt to narrow windows, and new copy is available in all 14 interface languages. Existing tasks and databases remain compatible; legacy tasks without an explicit model retain their previous default behavior until edited and saved.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
